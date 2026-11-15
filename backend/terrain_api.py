
from fastapi import FastAPI, HTTPException
from datetime import datetime, timedelta
from fastapi.middleware.cors import CORSMiddleware
import rasterio
from rasterio.windows import Window
from pyproj import CRS, Transformer
from pathlib import Path
import math
import numpy as np
from backend.solar_engine import (
    calculate_solar_elevation,
    calculate_earth_visibility,
    validate_coordinates,
)

app = FastAPI(title="LUNARIS Terrain API")

# Allow your React/Vite application to communicate with this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Location of the NASA LOLA elevation dataset.
DEM_PATH = Path.home() / "Downloads" / "LDEM_60S_240MPP_ADJ.tiff"

# Open the elevation raster once when the API starts.
if not DEM_PATH.exists():
    raise FileNotFoundError(f"LOLA dataset not found: {DEM_PATH}")

dem = rasterio.open(DEM_PATH)

# Convert lunar longitude/latitude into the DEM's projected coordinates.
lunar_geographic = CRS.from_proj4(
    "+proj=longlat +R=1737400 +no_defs"
)

coordinate_transformer = Transformer.from_crs(
    lunar_geographic,
    dem.crs,
    always_xy=True,
)


@app.get("/")
def home():
    return {
        "project": "LUNARIS",
        "service": "LOLA Terrain API",
        "status": "online",
        "dataset": DEM_PATH.name,
        "resolution_metres": 240,
    }


@app.get("/elevation")
def get_elevation(latitude: float, longitude: float):

    if not math.isfinite(latitude) or not math.isfinite(longitude):
        raise HTTPException(status_code=400, detail="Invalid coordinates")

    if latitude < -90 or latitude > -60:
        raise HTTPException(
            status_code=400,
            detail="This elevation dataset covers 60°S to 90°S."
        )

    if longitude < -180 or longitude > 180:
        raise HTTPException(status_code=400, detail="Invalid longitude")

    x, y = coordinate_transformer.transform(longitude, latitude)

    if not (
        dem.bounds.left <= x <= dem.bounds.right
        and dem.bounds.bottom <= y <= dem.bounds.top
    ):
        raise HTTPException(
            status_code=400,
            detail="Location is outside the elevation dataset."
        )

    row, col = dem.index(x, y)

    elevation = float(dem.read(1, window=Window(col, row, 1, 1))[0, 0])
    valid = dem.read_masks(1, window=Window(col, row, 1, 1))[0, 0] > 0

    if not valid or not math.isfinite(elevation) or abs(elevation) >= 20000:
        raise HTTPException(
            status_code=404,
            detail="No valid elevation measurement available at this location."
        )

    return {
        "latitude": latitude,
        "longitude": longitude,
        "elevation_metres": round(elevation, 2),
        "dataset": DEM_PATH.name,
        "source_resolution_metres": 240,
    }


@app.get("/terrain-horizon")
def get_terrain_horizon(
    latitude: float,
    longitude: float,
    azimuth: float,
    max_distance: float = 20000,
    step: float = 240,
):
    # Validate inputs.
    if not all(math.isfinite(v) for v in (
        latitude, longitude, azimuth, max_distance, step
    )):
        raise HTTPException(status_code=400, detail="Invalid inputs.")

    if not -90 <= latitude <= -60:
        raise HTTPException(status_code=400, detail="Latitude must be between 60°S and 90°S.")

    if not -180 <= longitude <= 180:
        raise HTTPException(status_code=400, detail="Invalid longitude.")

    if not 0 <= azimuth <= 360:
        raise HTTPException(status_code=400, detail="Azimuth must be between 0° and 360°.")

    if not 240 <= max_distance <= 50000:
        raise HTTPException(status_code=400, detail="Maximum distance must be between 240 and 50000 metres.")

    if not 1 <= step <= 1000:
        raise HTTPException(status_code=400, detail="Step must be between 1 and 1000 metres.")

    # Get the observer's elevation.
    x, y = coordinate_transformer.transform(longitude, latitude)

    if not (
        dem.bounds.left <= x <= dem.bounds.right
        and dem.bounds.bottom <= y <= dem.bounds.top
    ):
        raise HTTPException(status_code=400, detail="Location outside DEM.")

    row, col = dem.index(x, y)

    observer_window = Window(col, row, 1, 1)
    observer_elevation = float(dem.read(1, window=observer_window)[0, 0])
    observer_valid = dem.read_masks(1, window=observer_window)[0, 0] > 0

    if not observer_valid or not math.isfinite(observer_elevation) or abs(observer_elevation) >= 20000:
        raise HTTPException(status_code=404, detail="No valid observer elevation.")

    # Calculate terrain elevations along the selected azimuth.
    moon_radius = 1737400.0
    lat1 = math.radians(latitude)
    lon1 = math.radians(longitude)
    bearing = math.radians(azimuth)

    observer_radius = moon_radius + observer_elevation

    maximum_horizon_angle = 0.0
    horizon_distance = None
    valid_samples = 0

    distance = step

    while distance <= max_distance:
        angular_distance = distance / moon_radius

        lat2 = math.asin(
            math.sin(lat1) * math.cos(angular_distance)
            + math.cos(lat1) * math.sin(angular_distance) * math.cos(bearing)
        )

        lon2 = lon1 + math.atan2(
            math.sin(bearing) * math.sin(angular_distance) * math.cos(lat1),
            math.cos(angular_distance) - math.sin(lat1) * math.sin(lat2),
        )

        sample_latitude = math.degrees(lat2)
        sample_longitude = (
            math.degrees(lon2) + 180
        ) % 360 - 180

        sx, sy = coordinate_transformer.transform(
            sample_longitude,
            sample_latitude
        )

        if (
            dem.bounds.left <= sx <= dem.bounds.right
            and dem.bounds.bottom <= sy <= dem.bounds.top
        ):
            sample_row, sample_col = dem.index(sx, sy)

            sample_window = Window(sample_col, sample_row, 1, 1)

            elevation = float(
                dem.read(1, window=sample_window)[0, 0]
            )

            valid = (
                dem.read_masks(1, window=sample_window)[0, 0] > 0
                and math.isfinite(elevation)
                and abs(elevation) < 20000
            )

            if valid:
                target_radius = moon_radius + elevation

                horizontal = target_radius * math.sin(angular_distance)

                vertical = (
                    target_radius * math.cos(angular_distance)
                    - observer_radius
                )

                horizon_angle = math.degrees(
                    math.atan2(vertical, horizontal)
                )

                valid_samples += 1

                if horizon_angle > maximum_horizon_angle:
                    maximum_horizon_angle = horizon_angle
                    horizon_distance = distance

        distance += step

    if valid_samples == 0:
        raise HTTPException(
            status_code=404,
            detail="No valid terrain samples found."
        )

    return {
        "latitude": latitude,
        "longitude": longitude,
        "azimuth_degrees": azimuth,
        "terrain_horizon_angle_degrees": round(maximum_horizon_angle, 4),
        "horizon_distance_metres": (
            round(horizon_distance, 2)
            if horizon_distance is not None
            else None
        ),
        "valid_samples": valid_samples,
        "maximum_search_distance_metres": max_distance,
        "sampling_step_metres": step,
        "dataset": DEM_PATH.name,
        "method": "Radial LOLA terrain sampling with spherical lunar geometry",
    }

@app.get("/slope")
def get_slope(latitude: float, longitude: float):

    if not math.isfinite(latitude) or not math.isfinite(longitude):
        raise HTTPException(status_code=400, detail="Invalid coordinates")

    if latitude < -90 or latitude > -60:
        raise HTTPException(
            status_code=400,
            detail="This elevation dataset covers 60°S to 90°S."
        )

    if longitude < -180 or longitude > 180:
        raise HTTPException(status_code=400, detail="Invalid longitude")

    x, y = coordinate_transformer.transform(longitude, latitude)
    row, col = dem.index(x, y)

    if row < 1 or col < 1 or row >= dem.height - 1 or col >= dem.width - 1:
        raise HTTPException(
            status_code=400,
            detail="Not enough surrounding terrain data to calculate slope."
        )

    window = Window(col - 1, row - 1, 3, 3)
    raw = dem.read(1, window=window).astype(float)
    valid = (
        (dem.read_masks(1, window=window) > 0)
        & np.isfinite(raw)
        & (np.abs(raw) < 20000)
    )

    if not np.all(valid):
        raise HTTPException(
            status_code=404,
            detail="Missing or invalid elevation data around this location."
        )

    z1, z2, z3 = raw[0]
    z4, z5, z6 = raw[1]
    z7, z8, z9 = raw[2]

    dx = abs(dem.res[0])
    dy = abs(dem.res[1])

    dz_dx = ((z3 + 2*z6 + z9) - (z1 + 2*z4 + z7)) / (8 * dx)
    dz_dy = ((z7 + 2*z8 + z9) - (z1 + 2*z2 + z3)) / (8 * dy)

    slope_radians = math.atan(math.sqrt(dz_dx**2 + dz_dy**2))
    slope_degrees = math.degrees(slope_radians)

    return {
        "latitude": latitude,
        "longitude": longitude,
        "slope_degrees": round(slope_degrees, 2),
        "method": "Horn 3x3 terrain gradient",
        "dataset": DEM_PATH.name,
        "source_resolution_metres": 240,
    }


@app.get("/terrain-analysis")
def get_terrain_analysis(
    latitude: float,
    longitude: float,
    radius_metres: float = 1000,
):

    # Validate inputs.
    if not math.isfinite(latitude) or not math.isfinite(longitude):
        raise HTTPException(status_code=400, detail="Invalid coordinates")

    if latitude < -90 or latitude > -60:
        raise HTTPException(
            status_code=400,
            detail="This elevation dataset covers 60°S to 90°S."
        )

    if longitude < -180 or longitude > 180:
        raise HTTPException(status_code=400, detail="Invalid longitude")

    if not math.isfinite(radius_metres) or not 240 <= radius_metres <= 5000:
        raise HTTPException(
            status_code=400,
            detail="Analysis radius must be between 240 and 5000 metres."
        )

    # Convert lunar coordinates to DEM coordinates.
    x, y = coordinate_transformer.transform(longitude, latitude)
    row, col = dem.index(x, y)

    if row < 0 or col < 0 or row >= dem.height or col >= dem.width:
        raise HTTPException(
            status_code=400,
            detail="Location is outside the elevation dataset."
        )

    # Approximate local ground pixel spacing.
    scale_factor = 2 / (1 + math.sin(math.radians(abs(latitude))))
    dx = abs(dem.res[0]) / scale_factor
    dy = abs(dem.res[1]) / scale_factor

    half_pixels = math.ceil(radius_metres / min(dx, dy)) + 1

    row_start = max(0, row - half_pixels)
    row_end = min(dem.height, row + half_pixels + 1)
    col_start = max(0, col - half_pixels)
    col_end = min(dem.width, col + half_pixels + 1)

    if row_end - row_start < 3 or col_end - col_start < 3:
        raise HTTPException(
            status_code=400,
            detail="Not enough surrounding terrain data."
        )

    window = Window(
        col_start,
        row_start,
        col_end - col_start,
        row_end - row_start,
    )

    # Read raw elevation values and the explicit raster validity mask.
    raw_elevations = dem.read(1, window=window).astype(float)
    raster_mask = dem.read_masks(1, window=window) > 0

    # Reject missing, invalid, and implausible elevation values.
    valid_raster = (
        raster_mask
        & np.isfinite(raw_elevations)
        & (np.abs(raw_elevations) < 20000)
    )

    elevations = np.where(
        valid_raster,
        raw_elevations,
        np.nan
    )

    # Identify pixels within the analysis radius.
    rows, cols = np.indices(elevations.shape)

    center_row = row - row_start
    center_col = col - col_start

    distance = np.sqrt(
        ((cols - center_col) * dx) ** 2
        + ((rows - center_row) * dy) ** 2
    )

    area_mask = distance <= radius_metres
    valid_elevation = valid_raster & area_mask

    if not np.any(valid_elevation):
        raise HTTPException(
            status_code=404,
            detail="No valid elevation data in this analysis area."
        )

    # Calculate elevation statistics.
    area_elevations = elevations[valid_elevation]

    minimum_elevation = float(np.min(area_elevations))
    maximum_elevation = float(np.max(area_elevations))
    elevation_range = maximum_elevation - minimum_elevation

    # Prepare the surrounding 3x3 neighbourhoods.
    z1 = elevations[:-2, :-2]
    z2 = elevations[:-2, 1:-1]
    z3 = elevations[:-2, 2:]
    z4 = elevations[1:-1, :-2]
    z5 = elevations[1:-1, 1:-1]
    z6 = elevations[1:-1, 2:]
    z7 = elevations[2:, :-2]
    z8 = elevations[2:, 1:-1]
    z9 = elevations[2:, 2:]

    # All nine pixels must be valid for a neighbourhood calculation.
    valid_neighbourhood = (
        valid_raster[:-2, :-2]
        & valid_raster[:-2, 1:-1]
        & valid_raster[:-2, 2:]
        & valid_raster[1:-1, :-2]
        & valid_raster[1:-1, 1:-1]
        & valid_raster[1:-1, 2:]
        & valid_raster[2:, :-2]
        & valid_raster[2:, 1:-1]
        & valid_raster[2:, 2:]
    )

    # Calculate slope using the Horn 3x3 method.
    dz_dx = (
        (z3 + 2*z6 + z9) - (z1 + 2*z4 + z7)
    ) / (8 * dx)

    dz_dy = (
        (z7 + 2*z8 + z9) - (z1 + 2*z2 + z3)
    ) / (8 * dy)

    slope_grid = np.degrees(
        np.arctan(np.sqrt(dz_dx**2 + dz_dy**2))
    )

    slope_area = area_mask[1:-1, 1:-1]
    valid_slopes = valid_neighbourhood & slope_area

    if not np.any(valid_slopes):
        raise HTTPException(
            status_code=404,
            detail="Not enough valid neighbouring data to calculate slope."
        )

    area_slopes = slope_grid[valid_slopes]

    # Calculate roughness from the eight surrounding pixels.
    roughness_squared = (
        (z1 - z5)**2 + (z2 - z5)**2 + (z3 - z5)**2
        + (z4 - z5)**2 + (z6 - z5)**2
        + (z7 - z5)**2 + (z8 - z5)**2 + (z9 - z5)**2
    )

    roughness_grid = np.sqrt(roughness_squared)

    valid_roughness = valid_neighbourhood & slope_area
    area_roughness = roughness_grid[valid_roughness]

    return {
        "latitude": latitude,
        "longitude": longitude,
        "analysis_radius_metres": radius_metres,
        "minimum_elevation_metres": round(minimum_elevation, 2),
        "maximum_elevation_metres": round(maximum_elevation, 2),
        "elevation_range_metres": round(elevation_range, 2),
        "mean_slope_degrees": round(float(np.mean(area_slopes)), 2),
        "maximum_slope_degrees": round(float(np.max(area_slopes)), 2),
        "mean_terrain_roughness_metres": round(
            float(np.mean(area_roughness)), 2
        ),
        "valid_elevation_pixels": int(np.count_nonzero(valid_elevation)),
        "valid_slope_pixels": int(np.count_nonzero(valid_slopes)),
        "roughness_method": (
            "Root-sum-square elevation difference from eight neighbouring pixels"
        ),
        "slope_method": "Horn 3x3 terrain gradient",
        "dataset": DEM_PATH.name,
        "source_resolution_metres": 240,
    }
@app.get("/solar")
def get_solar_elevation(
    latitude: float,
    longitude: float,
    date: str,
    utc_time: str = "12:00:00"
):
    try:
        return calculate_solar_elevation(
            latitude,
            longitude,
            date,
            utc_time
        )
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error))

@app.get("/earth-visibility")
def get_earth_visibility(
    latitude: float,
    longitude: float,
    date: str,
    utc_time: str = "12:00:00"
):
    try:
        return calculate_earth_visibility(
            latitude,
            longitude,
            date,
            utc_time
        )
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error))

@app.get("/terrain-aware-visibility")
def get_terrain_aware_visibility(
    latitude: float,
    longitude: float,
    date: str,
    utc_time: str = "12:00:00",
    max_distance: float = 20000,
    step: float = 240,
):
    try:
        # 1. Calculate the apparent Sun position using SPICE.
        sun = calculate_solar_elevation(
            latitude,
            longitude,
            date,
            utc_time
        )

        # 2. Calculate the apparent Earth position using SPICE.
        earth = calculate_earth_visibility(
            latitude,
            longitude,
            date,
            utc_time
        )

        # 3. Find the terrain horizon in the Sun's direction.
        sun_horizon = get_terrain_horizon(
            latitude,
            longitude,
            sun["solar_azimuth_degrees"],
            max_distance,
            step
        )

        # 4. Find the terrain horizon in the Earth's direction.
        earth_horizon = get_terrain_horizon(
            latitude,
            longitude,
            earth["earth_azimuth_degrees"],
            max_distance,
            step
        )

        # 5. Compare the Sun's elevation with the terrain horizon.
        sun_visible = (
            sun["solar_elevation_degrees"]
            > sun_horizon["terrain_horizon_angle_degrees"]
        )

        # 6. Calculate the lower and upper edges of Earth's disk.
        earth_lower_limb = (
            earth["earth_elevation_degrees"]
            - earth["earth_angular_radius_degrees"]
        )

        earth_upper_limb = (
            earth["earth_elevation_degrees"]
            + earth["earth_angular_radius_degrees"]
        )

        terrain_angle = earth_horizon[
            "terrain_horizon_angle_degrees"
        ]

        # 7. Classify Earth's visibility.
        if earth_upper_limb <= terrain_angle:
            earth_status = "obstructed"
        elif earth_lower_limb > terrain_angle:
            earth_status = "fully_visible"
        else:
            earth_status = "partially_visible"

        return {
            "latitude": latitude,
            "longitude": longitude,
            "utc_datetime": sun["utc_datetime"],

            "sun": {
                "elevation_degrees":
                    sun["solar_elevation_degrees"],
                "azimuth_degrees":
                    sun["solar_azimuth_degrees"],
                "terrain_horizon_degrees":
                    sun_horizon["terrain_horizon_angle_degrees"],
                "terrain_horizon_distance_metres":
                    sun_horizon["horizon_distance_metres"],
                "visible_above_terrain": sun_visible,
                "status": (
                    "visible" if sun_visible else "obstructed"
                ),
            },

            "earth": {
                "centre_elevation_degrees":
                    earth["earth_elevation_degrees"],
                "azimuth_degrees":
                    earth["earth_azimuth_degrees"],
                "angular_radius_degrees":
                    earth["earth_angular_radius_degrees"],
                "lower_limb_elevation_degrees":
                    round(earth_lower_limb, 4),
                "upper_limb_elevation_degrees":
                    round(earth_upper_limb, 4),
                "terrain_horizon_degrees":
                    terrain_angle,
                "terrain_horizon_distance_metres":
                    earth_horizon["horizon_distance_metres"],
                "visibility_status": earth_status,
            },

            "terrain": {
                "dataset": DEM_PATH.name,
                "maximum_search_distance_metres": max_distance,
                "sampling_step_metres": step,
                "method": (
                    "Radial LOLA terrain sampling "
                    "with spherical lunar geometry"
                ),
            },

            "limitations": [
                "Terrain visibility is evaluated along the central azimuth.",
                "Earth disk visibility is approximated using its upper and lower limbs.",
                "Terrain sampling is limited by the 240-metre source resolution.",
                "This is geometric visibility, not a complete radio link analysis."
            ],
        }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

@app.get("/mission-timeline")
def get_mission_timeline(
    latitude: float,
    longitude: float,
    date: str,
    utc_time: str = "12:00:00",
    duration_hours: int = 24,
    interval_minutes: int = 60,
    max_distance: float = 20000,
    step: float = 240,
):
    try:
        # 1. Validate the simulation duration.
        if duration_hours not in (24, 48, 72):
            raise HTTPException(
                status_code=400,
                detail="Duration must be 24, 48, or 72 hours."
            )

        if interval_minutes not in (30, 60, 120):
            raise HTTPException(
                status_code=400,
                detail="Interval must be 30, 60, or 120 minutes."
            )

        # 2. Validate the starting date and UTC time.
        try:
            start_datetime = datetime.strptime(
                f"{date} {utc_time}",
                "%Y-%m-%d %H:%M:%S"
            )
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Invalid date or UTC time."
            )

        # 3. Validate the lunar coordinates.
        validate_coordinates(latitude, longitude)

        # 4. Prepare the timeline.
        interval = timedelta(minutes=interval_minutes)
        number_of_samples = (
            duration_hours * 60 // interval_minutes
        )

        samples = []

        sunlight_intervals = 0
        earth_visible_intervals = 0
        earth_fully_visible_intervals = 0

        # 5. Calculate conditions at each interval midpoint.
        for index in range(number_of_samples):

            sample_datetime = (
                start_datetime
                + interval * (index + 0.5)
            )

            sample_date = sample_datetime.strftime("%Y-%m-%d")
            sample_time = sample_datetime.strftime("%H:%M:%S")

            # Calculate apparent Sun position.
            sun = calculate_solar_elevation(
                latitude,
                longitude,
                sample_date,
                sample_time
            )

            # Calculate apparent Earth position.
            earth = calculate_earth_visibility(
                latitude,
                longitude,
                sample_date,
                sample_time
            )

            # Calculate terrain obstruction in the Sun's direction.
            sun_horizon = get_terrain_horizon(
                latitude,
                longitude,
                sun["solar_azimuth_degrees"],
                max_distance,
                step
            )

            # Calculate terrain obstruction in Earth's direction.
            earth_horizon = get_terrain_horizon(
                latitude,
                longitude,
                earth["earth_azimuth_degrees"],
                max_distance,
                step
            )

            # Determine whether the Sun clears local terrain.
            sun_visible = (
                sun["solar_elevation_degrees"]
                > sun_horizon["terrain_horizon_angle_degrees"]
            )

            # Calculate Earth's apparent disk boundaries.
            earth_lower_limb = (
                earth["earth_elevation_degrees"]
                - earth["earth_angular_radius_degrees"]
            )

            earth_upper_limb = (
                earth["earth_elevation_degrees"]
                + earth["earth_angular_radius_degrees"]
            )

            terrain_angle = earth_horizon[
                "terrain_horizon_angle_degrees"
            ]

            # Classify Earth's visibility.
            if earth_upper_limb <= terrain_angle:
                earth_status = "obstructed"

            elif earth_lower_limb > terrain_angle:
                earth_status = "fully_visible"

            else:
                earth_status = "partially_visible"

            # Count intervals with visible sunlight.
            if sun_visible:
                sunlight_intervals += 1

            # Count intervals with at least partial Earth visibility.
            if earth_status != "obstructed":
                earth_visible_intervals += 1

            if earth_status == "fully_visible":
                earth_fully_visible_intervals += 1

            # Save the results for this timeline interval.
            samples.append({
                "utc_datetime": sample_datetime.strftime(
                    "%Y-%m-%dT%H:%M:%S"
                ),

                "sun": {
                    "elevation_degrees":
                        sun["solar_elevation_degrees"],

                    "azimuth_degrees":
                        sun["solar_azimuth_degrees"],

                    "terrain_horizon_degrees":
                        sun_horizon["terrain_horizon_angle_degrees"],

                    "visible_above_terrain":
                        sun_visible,

                    "status": (
                        "visible" if sun_visible else "obstructed"
                    ),
                },

                "earth": {
                    "centre_elevation_degrees":
                        earth["earth_elevation_degrees"],

                    "angular_radius_degrees":
                        earth["earth_angular_radius_degrees"],

                    "azimuth_degrees":
                        earth["earth_azimuth_degrees"],

                    "terrain_horizon_degrees":
                        earth_horizon["terrain_horizon_angle_degrees"],

                    "visibility_status": earth_status,
                },
            })

        # 6. Convert interval counts into approximate hours.
        interval_hours = interval_minutes / 60

        sunlight_hours = (
            sunlight_intervals * interval_hours
        )

        earth_visible_hours = (
            earth_visible_intervals * interval_hours
        )

        earth_fully_visible_hours = (
            earth_fully_visible_intervals * interval_hours
        )

        # 7. Return the mission timeline.
        return {
            "latitude": latitude,
            "longitude": longitude,

            "start_datetime_utc":
                start_datetime.strftime("%Y-%m-%dT%H:%M:%S"),

            "duration_hours": duration_hours,
            "interval_minutes": interval_minutes,

            "summary": {
                "terrain_visible_sunlight_hours":
                    round(sunlight_hours, 2),

                "earth_visible_hours":
                    round(earth_visible_hours, 2),

                "earth_fully_visible_hours":
                    round(earth_fully_visible_hours, 2),

                "total_samples": len(samples),
            },

            "samples": samples,

            "terrain": {
                "dataset": DEM_PATH.name,
                "maximum_search_distance_metres": max_distance,
                "sampling_step_metres": step,
            },

            "limitations": [
                "Conditions are evaluated at interval midpoints.",
                "Visibility durations are approximate interval totals.",
                "Terrain visibility is evaluated along the central azimuth.",
                "Earth visibility is based on apparent disk limb geometry.",
                "Solar visibility does not calculate actual power generation.",
                "Earth visibility is not a complete radio link analysis.",
                "Terrain sampling is limited by the source DEM resolution."
            ],
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=str(error)
        )
