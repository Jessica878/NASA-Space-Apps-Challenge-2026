
import math
import threading
from functools import wraps
from pathlib import Path

import numpy as np
import spiceypy as spice


# --------------------------------------------------
# LUNARIS SOLAR AND EARTH POSITION ENGINE
# NASA/JPL SPICE
# --------------------------------------------------

KERNEL_DIR = Path(__file__).resolve().parent / "kernels"

KERNEL_FILES = [
    "latest_leapseconds.tls",
    "pck00011.tpc",
    "moon_de440_250416.tf",
    "moon_pa_de440_200625.bpc",
    "de440s.bsp",
]

MOON_RADIUS_KM = 1737.4
EARTH_RADIUS_KM = 6378.1366

REFERENCE_FRAME = "MOON_PA_DE440"

_kernels_loaded = False

# A re-entrant lock protects all SPICE operations.
# This also allows load_kernels() to be called from
# inside a locked calculation.
_spice_lock = threading.RLock()


# --------------------------------------------------
# SPICE THREAD SAFETY
# --------------------------------------------------

def serialize_spice(function):
    """
    Ensure that only one calculation uses SPICE
    at a time within this Python process.
    """

    @wraps(function)
    def wrapper(*args, **kwargs):
        with _spice_lock:
            return function(*args, **kwargs)

    return wrapper


# --------------------------------------------------
# LOAD NASA/JPL SPICE KERNELS
# --------------------------------------------------

@serialize_spice
def load_kernels():
    global _kernels_loaded

    if _kernels_loaded:
        return

    for filename in KERNEL_FILES:
        kernel_path = KERNEL_DIR / filename

        if not kernel_path.exists():
            raise FileNotFoundError(
                f"Missing SPICE kernel: {kernel_path}"
            )

        spice.furnsh(str(kernel_path))

    _kernels_loaded = True


# --------------------------------------------------
# LOCAL LUNAR COORDINATE SYSTEM
# --------------------------------------------------

def get_lunar_site_position(latitude, longitude):

    lat_rad = math.radians(latitude)
    lon_rad = math.radians(longitude)

    site_position = np.array([
        MOON_RADIUS_KM * math.cos(lat_rad) * math.cos(lon_rad),
        MOON_RADIUS_KM * math.cos(lat_rad) * math.sin(lon_rad),
        MOON_RADIUS_KM * math.sin(lat_rad),
    ])

    up = site_position / np.linalg.norm(site_position)

    east = np.array([
        -math.sin(lon_rad),
        math.cos(lon_rad),
        0.0,
    ])

    north = np.array([
        -math.sin(lat_rad) * math.cos(lon_rad),
        -math.sin(lat_rad) * math.sin(lon_rad),
        math.cos(lat_rad),
    ])

    return site_position, up, east, north


def validate_coordinates(latitude, longitude):

    if not math.isfinite(latitude) or not math.isfinite(longitude):
        raise ValueError("Coordinates must be finite numbers.")

    if not -90 <= latitude <= -60:
        raise ValueError(
            "Latitude must be between 60°S and 90°S."
        )

    if not -180 <= longitude <= 180:
        raise ValueError("Invalid lunar longitude.")


def get_utc_datetime(date, utc_time):

    utc_datetime = f"{date}T{utc_time}"

    # Validate and convert the requested time.
    et = spice.str2et(utc_datetime)

    return utc_datetime, et


def calculate_local_angles(direction, up, east, north):

    up_component = float(np.dot(direction, up))
    east_component = float(np.dot(direction, east))
    north_component = float(np.dot(direction, north))

    elevation = math.degrees(
        math.asin(np.clip(up_component, -1.0, 1.0))
    )

    azimuth = (
        math.degrees(
            math.atan2(east_component, north_component)
        ) + 360
    ) % 360

    return elevation, azimuth


# --------------------------------------------------
# SOLAR ELEVATION
# --------------------------------------------------

@serialize_spice
def calculate_solar_elevation(
    latitude: float,
    longitude: float,
    date: str,
    utc_time: str = "12:00:00",
):
    """
    Calculate the Sun's apparent elevation and azimuth
    relative to the spherical lunar horizon.

    Latitude and longitude are lunar coordinates.
    Date format: YYYY-MM-DD.
    Time format: HH:MM:SS UTC.

    Terrain occlusion is not included.
    """

    validate_coordinates(latitude, longitude)

    load_kernels()

    utc_datetime, et = get_utc_datetime(date, utc_time)

    site_position, up, east, north = get_lunar_site_position(
        latitude,
        longitude,
    )

    sun_position, light_time = spice.spkpos(
        "SUN",
        et,
        REFERENCE_FRAME,
        "LT+S",
        "MOON",
    )

    sun_vector = np.array(sun_position) - site_position

    sun_distance = float(np.linalg.norm(sun_vector))

    if sun_distance == 0:
        raise ValueError("Invalid Sun position.")

    sun_direction = sun_vector / sun_distance

    solar_elevation, solar_azimuth = calculate_local_angles(
        sun_direction,
        up,
        east,
        north,
    )

    return {
        "latitude": latitude,
        "longitude": longitude,
        "utc_datetime": utc_datetime,
        "solar_elevation_degrees": round(
            solar_elevation, 4
        ),
        "solar_azimuth_degrees": round(
            solar_azimuth, 4
        ),
        "sun_distance_km": round(sun_distance, 2),
        "sun_above_geometric_horizon": solar_elevation > 0,
        "reference_frame": REFERENCE_FRAME,
        "aberration_correction": "LT+S",
        "calculation_method": (
            "NASA/JPL SPICE apparent Sun position "
            "resolved into local lunar coordinates"
        ),
        "terrain_occlusion_included": False,
    }


# --------------------------------------------------
# EARTH VISIBILITY
# --------------------------------------------------

@serialize_spice
def calculate_earth_visibility(
    latitude: float,
    longitude: float,
    date: str,
    utc_time: str = "12:00:00",
):
    """
    Calculate Earth's apparent position relative to a
    lunar landing site and estimate geometric visibility.

    The Earth is treated as a spherical disk using
    its adopted radius.

    Terrain occlusion is not included.
    """

    validate_coordinates(latitude, longitude)

    load_kernels()

    utc_datetime, et = get_utc_datetime(date, utc_time)

    site_position, up, east, north = get_lunar_site_position(
        latitude,
        longitude,
    )

    earth_position, light_time = spice.spkpos(
        "EARTH",
        et,
        REFERENCE_FRAME,
        "LT+S",
        "MOON",
    )

    earth_vector = np.array(earth_position) - site_position

    earth_distance = float(np.linalg.norm(earth_vector))

    if earth_distance <= EARTH_RADIUS_KM:
        raise ValueError("Invalid Earth distance.")

    earth_direction = earth_vector / earth_distance

    earth_elevation, earth_azimuth = calculate_local_angles(
        earth_direction,
        up,
        east,
        north,
    )

    earth_angular_radius = math.degrees(
        math.asin(EARTH_RADIUS_KM / earth_distance)
    )

    upper_limb_elevation = (
        earth_elevation + earth_angular_radius
    )

    return {
        "latitude": latitude,
        "longitude": longitude,
        "utc_datetime": utc_datetime,
        "earth_elevation_degrees": round(
            earth_elevation, 4
        ),
        "earth_azimuth_degrees": round(
            earth_azimuth, 4
        ),
        "earth_distance_km": round(
            earth_distance, 2
        ),
        "earth_angular_radius_degrees": round(
            earth_angular_radius, 4
        ),
        "earth_upper_limb_elevation_degrees": round(
            upper_limb_elevation, 4
        ),
        "earth_centre_above_geometric_horizon": (
            earth_elevation > 0
        ),
        "earth_visible_above_geometric_horizon": (
            upper_limb_elevation > 0
        ),
        "reference_frame": REFERENCE_FRAME,
        "aberration_correction": "LT+S",
        "terrain_occlusion_included": False,
        "calculation_method": (
            "NASA/JPL SPICE apparent Earth position "
            "resolved into local lunar coordinates"
        ),
    }

