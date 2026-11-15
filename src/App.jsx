

import { useState, useCallback, useEffect } from "react";
import {
  Moon,
  Sun,
  Globe,
  Radio,
  MapPin,
  CalendarDays,
  Plus,
  Trash2,
  Activity,
  Telescope,
  ChevronRight,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import "./App.css";
import LunarMap from "./Components/LunarMap";

const initialScenario = {
  id: 1,
  name: "Primary Mission",
  site: "Lunar South Pole",
  latitude: "-70.3155",
  longitude: "-50.3408",
  date: "2026-11-14",
};
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
function App() {
  const [scenarios, setScenarios] = useState([initialScenario]);
  const [activeScenario, setActiveScenario] = useState(1);

  // NASA LOLA elevation data
  const [elevationData, setElevationData] = useState(null);
  const [elevationLoading, setElevationLoading] = useState(false);
  const [elevationError, setElevationError] = useState("");

  // NASA LOLA landing-area terrain analysis
  const [terrainData, setTerrainData] = useState(null);
  const [terrainLoading, setTerrainLoading] = useState(false);
  const [terrainError, setTerrainError] = useState("");
  // Terrain data for all scenarios in the comparison
  const [comparisonTerrainData, setComparisonTerrainData] = useState({});
  // Mission timeline data for every candidate landing site.
  const [comparisonTimelineData, setComparisonTimelineData] = useState({});

  // Combined terrain-aware Sun and Earth visibility
  const [visibilityData, setVisibilityData] = useState(null);
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [visibilityError, setVisibilityError] = useState("");
  const [timelineData, setTimelineData] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [missionDuration, setMissionDuration] = useState(24);
  const solarChartData = (timelineData?.samples ?? []).map((sample) => ({
    time: sample.utc_datetime.slice(11, 16),
    elevation: sample.sun.elevation_degrees,
    terrainHorizon: sample.sun.terrain_horizon_degrees,
  }));
  const solarVisibilityStatus = (() => {
    if (!solarChartData.length) return null;

  const allClear = solarChartData.every(
    (sample) => sample.elevation > sample.terrainHorizon
  );

  const anyClear = solarChartData.some(
    (sample) => sample.elevation > sample.terrainHorizon
  );

    if (allClear) return "Continuous illumination";
    if (anyClear) return "Intermittent illumination";

    return "No direct illumination";
  })();
  const earthClearanceData = (timelineData?.samples ?? []).map((sample) => ({
    time: sample.utc_datetime.slice(11, 16),
    clearance:
      sample.earth.centre_elevation_degrees -
      sample.earth.terrain_horizon_degrees -
    sample.earth.angular_radius_degrees,
  }));

const earthVisibilityStatus = (() => {
  if (!earthClearanceData.length) return null;

  const allClear = earthClearanceData.every(
    (sample) => sample.clearance > 0
  );

  return allClear ? "Fully visible" : "Terrain obstruction";
})();

// Identify the strongest terrain candidate for each metric.
const comparisonMetrics = [
  {
    key: "elevation_range_metres",
    label: "Lowest elevation range",
    unit: "m",
  },
  {
    key: "mean_slope_degrees",
    label: "Lowest mean slope",
    unit: "°",
  },
  {
    key: "maximum_slope_degrees",
    label: "Lowest maximum slope",
    unit: "°",
  },
  {
    key: "mean_terrain_roughness_metres",
    label: "Lowest terrain roughness",
    unit: "m",
  },
];
// Calculate relative terrain scores and mission-environment scores.
const suitabilityAssessments = scenarios.map((scenario) => {
  const terrain = comparisonTerrainData[scenario.id];
  const timeline = comparisonTimelineData[scenario.id];

  if (
    !terrain ||
    terrain.error ||
    !timeline ||
    timeline.error
  ) {
    return {
      id: scenario.id,
      name: scenario.name,
      loading: true,
    };
  }

  const terrainKeys = [
    "elevation_range_metres",
    "mean_slope_degrees",
    "maximum_slope_degrees",
    "mean_terrain_roughness_metres",
  ];

  const terrainValues = terrainKeys.map((key) =>
    Number(terrain[key])
  );

  if (!terrainValues.every(Number.isFinite)) {
    return {
      id: scenario.id,
      name: scenario.name,
      loading: true,
    };
  }

  const terrainScore = terrainKeys.reduce((total, key) => {
    const values = scenarios
      .map((item) => comparisonTerrainData[item.id]?.[key])
      .filter((value) => Number.isFinite(value));

    const minimum = Math.min(...values);
    const maximum = Math.max(...values);

    const score =
      maximum === minimum
        ? 100
        : ((maximum - terrain[key]) / (maximum - minimum)) * 100;

    return total + score / terrainKeys.length;
  }, 0);

  const duration = timeline.duration_hours || 24;

  const solarScore =
    (timeline.summary.terrain_visible_sunlight_hours / duration) * 100;

  const communicationsScore =
    (timeline.summary.earth_fully_visible_hours / duration) * 100;

  const overallScore =
    terrainScore * 0.4 +
    solarScore * 0.3 +
    communicationsScore * 0.3;

  return {
    id: scenario.id,
    name: scenario.name,
    loading: false,
    terrainScore,
    solarScore,
    communicationsScore,
    overallScore,
  };
});

// Identify the highest-scoring candidate landing site.
const rankedAssessments = suitabilityAssessments
  .filter((assessment) => !assessment.loading)
  .sort((a, b) => b.overallScore - a.overallScore);

const recommendedSite =
  rankedAssessments.length >= 2
    ? rankedAssessments[0]
    : null;

// Identify the strongest and weakest factors for the winner.
const recommendationFactors = recommendedSite
  ? [
      {
        label: "Terrain profile",
        score: recommendedSite.terrainScore,
      },
      {
        label: "Solar visibility",
        score: recommendedSite.solarScore,
      },
      {
        label: "Earth visibility",
        score: recommendedSite.communicationsScore,
      },
    ]
  : [];

const strongestFactor = recommendationFactors.reduce(
  (best, factor) =>
    !best || factor.score > best.score ? factor : best,
  null
);

const mainLimitation = recommendationFactors.reduce(
  (worst, factor) =>
    !worst || factor.score < worst.score ? factor : worst,
  null
);

const comparisonInsights = comparisonMetrics.map((metric) => {
  const candidates = scenarios
    .map((scenario) => ({
      name: scenario.name,
      data: comparisonTerrainData[scenario.id],
    }))
    .filter(
      (candidate) =>
        candidate.data &&
        !candidate.data.error &&
        Number.isFinite(candidate.data[metric.key])
    );

  const best = candidates.reduce(
    (lowest, candidate) =>
      !lowest || candidate.data[metric.key] < lowest.data[metric.key]
        ? candidate
        : lowest,
    null
  );

  return {
    ...metric,
    best,
  };
});

  const currentScenario = scenarios.find(
    (scenario) => scenario.id === activeScenario
  );

  // Get the selected scenario's coordinates.
  const latitude = currentScenario?.latitude ?? "";
  const longitude = currentScenario?.longitude ?? "";

  // Retrieve real LOLA elevation whenever coordinates change.
  useEffect(() => {
    if (latitude === "" || longitude === "") {
      setElevationData(null);
      setElevationError("");
      setElevationLoading(false);
      return;
    }

    const lat = Number(latitude);
    const lon = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }

    const controller = new AbortController();

    setElevationLoading(true);
    setElevationError("");
    setElevationData(null);

    const url = new URL(`${API_BASE_URL}/elevation`);
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || "Unable to retrieve elevation.");
        }

        return data;
      })
      .then((data) => {
        setElevationData(data);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setElevationError(error.message);
          setElevationData(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setElevationLoading(false);
        }
      });

    return () => controller.abort();
  }, [latitude, longitude]);

  // Retrieve NASA LOLA landing-area terrain analysis.
  useEffect(() => {
    if (latitude === "" || longitude === "") {
      setTerrainData(null);
      setTerrainError("");
      setTerrainLoading(false);
      return;
    }
    

    const lat = Number(latitude);
    const lon = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }

    const controller = new AbortController();

    setTerrainLoading(true);
    setTerrainError("");
    setTerrainData(null);

    const url = new URL(`${API_BASE_URL}/terrain-analysis`);

    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("radius_metres", 1000);

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.detail || "Unable to retrieve terrain analysis."
          );
        }

        return data;
      })
      .then((data) => {
        setTerrainData(data);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setTerrainError(error.message);
          setTerrainData(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setTerrainLoading(false);
        }
      });

    return () => controller.abort();
  }, [latitude, longitude]);
  // Retrieve terrain analysis for every mission scenario.
useEffect(() => {
  const controller = new AbortController();

  const fetchAllTerrainData = async () => {
    const results = {};

    await Promise.all(
      scenarios.map(async (scenario) => {
        const lat = Number(scenario.latitude);
        const lon = Number(scenario.longitude);

        if (
          scenario.latitude === "" ||
          scenario.longitude === "" ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lon)
        ) {
          return;
        }

        try {
          const url = new URL(
            `${API_BASE_URL}/terrain-analysis`
          );

          url.searchParams.set("latitude", lat);
          url.searchParams.set("longitude", lon);
          url.searchParams.set("radius_metres", 1000);

          const response = await fetch(url, {
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error("Terrain analysis failed.");
          }

          results[scenario.id] = await response.json();
        } catch (error) {
          if (error.name !== "AbortError") {
            results[scenario.id] = { error: error.message };
          }
        }
      })
    );

    if (!controller.signal.aborted) {
      setComparisonTerrainData(results);
    }
  };

  fetchAllTerrainData();

  return () => controller.abort();
}, [scenarios]);

// Retrieve solar and Earth visibility data for every mission scenario.
useEffect(() => {
  const controller = new AbortController();

  const fetchAllTimelineData = async () => {
    const results = {};

    await Promise.all(
      scenarios.map(async (scenario) => {
        const lat = Number(scenario.latitude);
        const lon = Number(scenario.longitude);

        if (
          scenario.latitude === "" ||
          scenario.longitude === "" ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          !scenario.date
        ) {
          return;
        }

        try {
          const params = new URLSearchParams({
            latitude: String(lat),
            longitude: String(lon),
            date: scenario.date,
            utc_time: "12:00:00",
            duration_hours: "24",
            interval_minutes: "120",
            max_distance: "20000",
            step: "240",
          });

          const response = await fetch(
            `${API_BASE_URL}/mission-timeline?${params}`,
            { signal: controller.signal }
          );

          if (!response.ok) {
            throw new Error("Mission timeline request failed.");
          }

          results[scenario.id] = await response.json();
        } catch (error) {
          if (error.name !== "AbortError") {
            results[scenario.id] = { error: error.message };
          }
        }
      })
    );

    if (!controller.signal.aborted) {
      setComparisonTimelineData(results);
    }
  };

  fetchAllTimelineData();

  return () => controller.abort();
}, [scenarios]);

  // Retrieve combined terrain-aware Sun and Earth visibility.
  useEffect(() => {
    if (
      latitude === "" ||
      longitude === "" ||
      !currentScenario?.date
    ) {
      setVisibilityData(null);
      setVisibilityError("");
      setVisibilityLoading(false);
      return;
    }

    const lat = Number(latitude);
    const lon = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }

    const controller = new AbortController();

    setVisibilityLoading(true);
    setVisibilityError("");
    setVisibilityData(null);

    const url = new URL(
      `${API_BASE_URL}/terrain-aware-visibility`
    );
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("date", currentScenario.date);
    url.searchParams.set("utc_time", "12:00:00");
    url.searchParams.set("max_distance", 20000);
    url.searchParams.set("step", 240);

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.detail ||
              "Unable to retrieve terrain-aware visibility."
          );
        }

        return data;
      })
      .then((data) => {
        setVisibilityData(data);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setVisibilityError(error.message);
          setVisibilityData(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setVisibilityLoading(false);
        }
      });

    return () => controller.abort();
  }, [latitude, longitude, currentScenario?.date]);


useEffect(() => {
  if (!currentScenario) return;

  let cancelled = false;

  const fetchTimeline = async () => {
    setTimelineLoading(true);
    setTimelineError("");

    try {
      const params = new URLSearchParams({
        latitude: currentScenario.latitude,
        longitude: currentScenario.longitude,
        date: currentScenario.date,
        utc_time: "12:00:00",
        duration_hours: String(missionDuration),
        interval_minutes: "60",
        max_distance: "20000",
        step: "240",
      });

      const response = await fetch(
        `${API_BASE_URL}/mission-timeline?${params}`
      );

      if (!response.ok) {
        throw new Error("Could not load mission timeline.");
      }

      const data = await response.json();

      if (!cancelled) {
        setTimelineData(data);
      }
    } catch (error) {
      if (!cancelled) {
        setTimelineError(error.message);
      }
    } finally {
      if (!cancelled) {
        setTimelineLoading(false);
      }
    }
  };

  fetchTimeline();

  return () => {
    cancelled = true;
  };
}, [
  currentScenario?.latitude,
  currentScenario?.longitude,
  currentScenario?.date,
  missionDuration,
]);


  // Update the active scenario when a map location is selected.
  const handleLocationSelect = useCallback(
    ({ latitude, longitude }) => {
      setScenarios((previousScenarios) =>
        previousScenarios.map((scenario) =>
          scenario.id === activeScenario
            ? {
                ...scenario,
                latitude: latitude.toFixed(4),
                longitude: longitude.toFixed(4),
              }
            : scenario
        )
      );
    },
    [activeScenario]
  );

  // Update a scenario field.
  function updateScenario(field, value) {
    setScenarios((previous) =>
      previous.map((scenario) =>
        scenario.id === activeScenario
          ? { ...scenario, [field]: value }
          : scenario
      )
    );
  }

  // Create a new mission scenario.
  function addScenario() {
    const newId = Date.now();

    const newScenario = {
      id: newId,
      name: `Alternative ${scenarios.length}`,
      site: "Lunar South Pole",
      latitude: "",
      longitude: "",
      date: "2026-11-14",
    };

    setScenarios((previous) => [...previous, newScenario]);
    setActiveScenario(newId);
  }

  // Delete a mission scenario.
  function removeScenario(id) {
    if (scenarios.length === 1) return;

    const remaining = scenarios.filter(
      (scenario) => scenario.id !== id
    );

    setScenarios(remaining);

    if (activeScenario === id) {
      setActiveScenario(remaining[0].id);
    }
  }

  const visibilityStatus = visibilityLoading
    ? "Calculating"
    : visibilityError
    ? "Calculation error"
    : visibilityData
    ? "Analysis ready"
    : "Awaiting data";

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Moon size={25} />
          </div>
          <div>
            <h1>LUNARIS</h1>
            <span>MISSION INTELLIGENCE</span>
          </div>
        </div>

        <div className="sidebar-label">WORKSPACE</div>

        <nav>
          <a className="nav-item active" href="#dashboard">
            <Activity size={18} />
            Mission Dashboard
          </a>

          <a className="nav-item" href="#planner">
            <MapPin size={18} />
            Site Selection
          </a>

          <a className="nav-item" href="#comparison">
            <Telescope size={18} />
            Scenario Comparison
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="status-dot" />
          <span>Mission workspace initialized</span>
        </div>
      </aside>

      <section className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">LUNAR EXPLORATION SYSTEM</span>
            <h2>Mission Planning</h2>
          </div>

          <div className="topbar-status">
            <span className="status-dot" />
            Development Environment
          </div>
        </header>

        <section className="welcome-section" id="dashboard">
          <div>
            <span className="eyebrow">LUNAR SOUTH POLE</span>
            <h2>Understand your mission environment.</h2>
            <p>
              Evaluate candidate landing locations, solar
              illumination and direct-to-Earth visibility
              through comparative mission scenarios.
            </p>
          </div>

          <div className="moon-decoration">
            <Moon size={105} strokeWidth={0.8} />
          </div>
        </section>

        <section className="section-heading" id="planner">
          <div>
            <span className="eyebrow">MISSION CONFIGURATION</span>
            <h2>Scenario workspace</h2>
          </div>

          <button className="primary-button" onClick={addScenario}>
            <Plus size={17} />
            Add scenario
          </button>
        </section>

        <div className="workspace">
          <section className="scenario-list">
            <h3>Mission scenarios</h3>

            {scenarios.map((scenario) => (
              <div
                key={scenario.id}
                className={`scenario-item ${
                  activeScenario === scenario.id ? "selected" : ""
                }`}
                onClick={() => setActiveScenario(scenario.id)}
              >
                <div className="scenario-icon">
                  <Moon size={19} />
                </div>

                <div className="scenario-info">
                  <strong>{scenario.name}</strong>
                  <span>{scenario.site}</span>
                </div>

                <button
                  className="delete-button"
                  aria-label={`Delete ${scenario.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeScenario(scenario.id);
                  }}
                >
                  <Trash2 size={15} />
                </button>

                <ChevronRight size={16} />
              </div>
            ))}
          </section>

          {currentScenario && (
            <section className="configuration-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">SCENARIO SETTINGS</span>
                  <h3>{currentScenario.name}</h3>
                </div>
                <span className="draft-label">Draft</span>
              </div>

              <label>
                Landing site
                <input
                  value={currentScenario.site}
                  onChange={(event) =>
                    updateScenario("site", event.target.value)
                  }
                  placeholder="Enter landing site"
                />
              </label>

              <div className="input-grid">
                <label>
                  Latitude (degrees)
                  <input
                    type="number"
                    min="-90"
                    max="-60"
                    step="any"
                    value={currentScenario.latitude}
                    onChange={(event) =>
                      updateScenario("latitude", event.target.value)
                    }
                    placeholder="e.g. -70.3155"
                  />
                </label>

                <label>
                  Longitude (degrees)
                  <input
                    type="number"
                    min="-180"
                    max="180"
                    step="any"
                    value={currentScenario.longitude}
                    onChange={(event) =>
                      updateScenario("longitude", event.target.value)
                    }
                    placeholder="e.g. -50.3408"
                  />
                </label>
              </div>

              <label>
                <CalendarDays size={15} />
                Landing date
                <input
                  type="date"
                  value={currentScenario.date}
                  onChange={(event) =>
                    updateScenario("date", event.target.value)
                  }
                />
              </label>

              {/* NASA LOLA ELEVATION MEASUREMENT */}
              <div className="notice">
                <Activity size={17} />

                <div>
                  <strong>NASA LOLA Terrain Assessment</strong>

                  {elevationLoading && (
                    <p>Retrieving elevation from NASA LOLA data...</p>
                  )}

                  {elevationError && (
                    <p>Elevation unavailable: {elevationError}</p>
                  )}

                  {!elevationLoading &&
                    !elevationError &&
                    elevationData && (
                      <>
                        <p>Selected site elevation:</p>

                        <h2>
                          {elevationData.elevation_metres.toLocaleString(
                            undefined,
                            { maximumFractionDigits: 2 }
                          )}{" "}
                          m
                        </h2>

                        <p>
                          Source: {elevationData.dataset}
                          <br />
                          Resolution:{" "}
                          {elevationData.source_resolution_metres} m
                        </p>
                      </>
                    )}

                  {!elevationLoading &&
                    !elevationError &&
                    !elevationData && (
                      <p>
                        Select a location on the map to retrieve
                        its actual lunar elevation.
                      </p>
                    )}
                </div>
              </div>
            </section>
          )}
        </div>

        {/* LUNAR SOUTH POLE MAP */}
        {currentScenario && (
          <section className="map-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">LANDING SITE SELECTION</span>
                <h2>Lunar South Pole Map</h2>
                <p>
                  Select a point on the map to update your landing
                  coordinates and retrieve NASA LOLA elevation.
                </p>
              </div>
            </div>

            <LunarMap
              selectedLocation={{
                latitude: currentScenario.latitude,
                longitude: currentScenario.longitude,
              }}
              onLocationSelect={handleLocationSelect}
            />

            <p className="map-disclaimer">
              Basemap: NASA LROC WAC. Elevation measurements:
              NASA LOLA, 240 m source resolution.
            </p>
          </section>
        )}

        {/* LANDING-AREA TERRAIN INTELLIGENCE */}
        {currentScenario && (
          <section className="metrics-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">NASA LOLA DATA</span>
                <h2>Landing-area terrain intelligence</h2>
                <p>
                  Regional terrain analysis within a 1 km radius
                  of the selected location.
                </p>
              </div>

              <span className="draft-label">
                {terrainLoading
                  ? "Analysing"
                  : terrainData
                  ? "Analysis ready"
                  : "Awaiting data"}
              </span>
            </div>

            {terrainLoading && (
              <div className="notice">
                <Activity size={17} />
                <div>
                  <strong>Analysing lunar terrain...</strong>
                  <p>
                    Retrieving elevation measurements from NASA LOLA.
                  </p>
                </div>
              </div>
            )}

            {terrainError && (
              <div className="notice">
                <Activity size={17} />
                <div>
                  <strong>Terrain analysis unavailable</strong>
                  <p>{terrainError}</p>
                </div>
              </div>
            )}

            {!terrainLoading && !terrainError && terrainData && (
              <div className="metrics-grid">
                <MetricCard
                  icon={<Activity />}
                  title="Elevation range"
                  value={`${terrainData.elevation_range_metres.toFixed(2)} m`}
                  description={`Minimum: ${terrainData.minimum_elevation_metres.toFixed(2)} m · Maximum: ${terrainData.maximum_elevation_metres.toFixed(2)} m`}
                />

                <MetricCard
                  icon={<Activity />}
                  title="Mean slope"
                  value={`${terrainData.mean_slope_degrees.toFixed(2)}°`}
                  description="Average terrain slope across the analysis area"
                />

                <MetricCard
                  icon={<Activity />}
                  title="Maximum slope"
                  value={`${terrainData.maximum_slope_degrees.toFixed(2)}°`}
                  description="Steepest measured terrain in the analysis area"
                />

                <MetricCard
                  icon={<Activity />}
                  title="Terrain roughness index"
                  value={`${terrainData.mean_terrain_roughness_metres.toFixed(2)} m`}
                  description="Mean local elevation-difference index"
                />
              </div>
            )}

            {!terrainLoading && !terrainError && !terrainData && (
              <div className="notice">
                <Activity size={17} />
                <div>
                  <strong>Awaiting terrain coordinates</strong>
                  <p>
                    Select a location on the lunar map to retrieve
                    its landing-area terrain assessment.
                  </p>
                </div>
              </div>
            )}

            {terrainData && (
              <p className="map-disclaimer">
                {terrainData.valid_elevation_pixels} valid elevation
                pixels · {terrainData.source_resolution_metres} m
                source resolution · {terrainData.dataset}
              </p>
            )}
          </section>
        )}

        {/* TERRAIN-AWARE ENVIRONMENTAL ASSESSMENT */}
        <section className="metrics-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">MISSION ENVIRONMENT</span>
              <h2>Environmental assessment</h2>
              <p>
                Apparent Sun and Earth positions evaluated against
                the surrounding lunar terrain.
              </p>
            </div>

            <span className="draft-label">
              {visibilityStatus}
            </span>
          </div>

          {visibilityError && (
            <div className="notice">
              <Activity size={17} />
              <div>
                <strong>Visibility analysis unavailable</strong>
                <p>{visibilityError}</p>
              </div>
            </div>
          )}

          <div className="metrics-grid">
            <MetricCard
              icon={<Sun />}
              title="Solar elevation"
              value={
                visibilityLoading
                  ? "Calculating..."
                  : visibilityData
                  ? `${visibilityData.sun.elevation_degrees.toFixed(2)}°`
                  : "—"
              }
              description={
                visibilityError
                  ? "Solar visibility calculation unavailable"
                  : visibilityData
                  ? `${
                      visibilityData.sun.status === "visible"
                        ? "Visible"
                        : "Obstructed"
                    } by terrain · Terrain horizon: ${visibilityData.sun.terrain_horizon_degrees.toFixed(2)}°`
                  : "Sun position relative to local terrain horizon"
              }
            />

            <MetricCard
              icon={<Globe />}
              title="Earth visibility"
              value={
                visibilityLoading
                  ? "Calculating..."
                  : visibilityData
                  ? `${visibilityData.earth.centre_elevation_degrees.toFixed(2)}°`
                  : "—"
              }
              description={
                visibilityError
                  ? "Earth visibility calculation unavailable"
                  : visibilityData
                  ? `${
                      visibilityData.earth.visibility_status.replace(
                        "_",
                        " "
                      )
                    } · Terrain horizon: ${visibilityData.earth.terrain_horizon_degrees.toFixed(2)}°`
                  : "Earth position relative to local terrain horizon"
              }
            />

            <MetricCard
              icon={<Radio />}
              title="Communication"
              value={
                visibilityData
                  ? visibilityData.earth.visibility_status === "obstructed"
                    ? "Blocked"
                    : "Geometric LOS"
                  : "—"
              }
              description={
                visibilityData
                  ? "Terrain-aware geometric Earth visibility; not a complete radio link analysis"
                  : "Direct-to-Earth visibility assessment"
              }
            />

            <MetricCard
              icon={<Activity />}
              title="Illumination"
              value={
                visibilityData
                  ? visibilityData.sun.visible_above_terrain
                    ? "Sun visible"
                    : "In shadow"
                  : "—"
              }
              description={
                visibilityData
                  ? "Instantaneous terrain-aware solar visibility at the selected UTC time"
                  : "Solar availability relative to local terrain"
              }
            />
          </div>

          {visibilityData && (
            <p className="map-disclaimer">
              Calculation time: {visibilityData.utc_datetime} UTC ·
              Terrain source: {visibilityData.terrain.dataset} ·
              Radial terrain sampling:{" "}
              {visibilityData.terrain.sampling_step_metres} m ·
              Maximum search distance:{" "}
              {visibilityData.terrain.maximum_search_distance_metres / 1000} km
            </p>
          )}
        </section>
          
        {/* MISSION TIMELINE */}
        <section className="metrics-section mission-timeline">
          <div className="section-heading">
            <div>
              <span className="eyebrow">MISSION SIMULATION</span>
              <h2>Mission timeline</h2>
              <p>
                Projected solar illumination and Earth visibility
                throughout the selected mission window.
              </p>
            </div>

            <span className="draft-label">
              {timelineLoading ? "SIMULATING..." : "TIMELINE"}
            </span>
          </div>

          {/* DURATION SELECTOR */}
          <div className="timeline-controls">
            <span>Simulation duration</span>

            <div className="duration-options">
              {[24, 48, 72].map((hours) => (
                <button
                  key={hours}
                  className={
                    missionDuration === hours
                      ? "duration-button active"
                      : "duration-button"
                  }
                  onClick={() => setMissionDuration(hours)}
                  disabled={timelineLoading}
                >
                  {hours} hours
                </button>
              ))}
            </div>
          </div>

          {timelineError && (
            <div className="notice">
              <Activity size={17} />
              <div>
                <strong>Timeline unavailable</strong>
                <p>{timelineError}</p>
              </div>
            </div>
          )}

          {timelineLoading && (
            <p className="timeline-message">
              Calculating lunar illumination and Earth visibility...
            </p>
          )}

          {!timelineLoading && timelineData && (
            <>
              {/* SUMMARY */}
              <div className="timeline-summary">
                <article className="timeline-stat">
                  <span>Terrain-visible sunlight</span>
                  <strong>
                    {timelineData.summary.terrain_visible_sunlight_hours} h
                  </strong>
                </article>

                <article className="timeline-stat">
                  <span>Earth visible</span>
                  <strong>
                    {timelineData.summary.earth_visible_hours} h
                  </strong>
                </article>

                <article className="timeline-stat">
                  <span>Earth fully visible</span>
                  <strong>
                    {timelineData.summary.earth_fully_visible_hours} h
                  </strong>
                </article>
              </div>

              {/* EARTH VISIBILITY CLEARANCE */}
              <div className="timeline-chart">
                
<div className="timeline-chart-heading">
  <div>
    <h3>Earth visibility clearance</h3>
    <span>Degrees · UTC</span>
  </div>

  {earthVisibilityStatus && (
    <span
      className={`visibility-status ${
        earthVisibilityStatus === "Fully visible"
          ? "visible"
          : "obstructed"
      }`}
    >
      {earthVisibilityStatus}
    </span>
  )}
</div>


                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={earthClearanceData}
                      margin={{ top: 15, right: 20, left: 5, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#263449" />

                      <XAxis
                        dataKey="time"
                        stroke="#94a3b8"
                        tick={{ fontSize: 11 }}
                        interval="preserveStartEnd"
                      />

                      <YAxis
                        stroke="#94a3b8"
                        tick={{ fontSize: 11 }}
                        label={{
                          value: "Clearance (°)",
                          angle: -90,
                          position: "insideLeft",
                          fill: "#94a3b8",
                        }}
                      />

                      <Tooltip
                        contentStyle={{
                          background: "#111c2d",
                          border: "1px solid #334155",
                          borderRadius: "8px",
                        }}
                        formatter={(value) => [
                          `${Number(value).toFixed(4)}°`,
                          "Earth lower-limb clearance",
                        ]}
                        labelFormatter={(label) => `${label} UTC`}
                      />

                      <ReferenceLine
                        y={0}
                        stroke="#e87979"
                        strokeDasharray="5 5"
                      />

                      <Line
                        type="monotone"
                        dataKey="clearance"
                        name="Earth clearance"
                        stroke="#55c7b0"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <p className="map-disclaimer">
                  Positive values indicate that Earth's apparent lower
                  limb clears the sampled terrain horizon. Negative values
                  indicate terrain obstruction of the lower limb.
                </p>
              </div>

              {/* HOURLY VISIBILITY */}

<div className="timeline-chart">
  <div className="timeline-chart-heading">
    <div>
      <h3>Solar elevation profile</h3>
      <span>Degrees · UTC</span>
    </div>

    {solarVisibilityStatus && (
      <span
        className={`visibility-status ${
          solarVisibilityStatus === "Continuous illumination"
            ? "visible"
            : solarVisibilityStatus === "No direct illumination"
            ? "obstructed"
            : ""
        }`}
      >
        {solarVisibilityStatus}
      </span>
    )}
  </div>

  <div style={{ width: "100%", height: 300 }}>
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={solarChartData}
        margin={{ top: 15, right: 20, left: 5, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#263449" />

        <XAxis
          dataKey="time"
          stroke="#94a3b8"
          tick={{ fontSize: 11 }}
          interval="preserveStartEnd"
        />

        <YAxis
          stroke="#94a3b8"
          tick={{ fontSize: 11 }}
          label={{
            value: "Elevation (°)",
            angle: -90,
            position: "insideLeft",
            fill: "#94a3b8",
          }}
        />

        <Tooltip
          contentStyle={{
            background: "#111c2d",
            border: "1px solid #334155",
            borderRadius: "8px",
          }}
          formatter={(value, name) => [
            `${Number(value).toFixed(2)}°`,
            name === "elevation" ? "Solar elevation" : "Terrain horizon",
          ]}
          labelFormatter={(label) => `${label} UTC`}
        />

        <ReferenceLine
          y={0}
          stroke="#94a3b8"
          strokeDasharray="5 5"
        />

        <Line
          type="monotone"
          dataKey="elevation"
          name="Solar elevation"
          stroke="#f5b942"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5 }}
        />

        <Line
          type="monotone"
          dataKey="terrainHorizon"
          name="Terrain horizon"
          stroke="#e87979"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  </div>
</div>

              <div className="timeline-chart">
                <div className="timeline-chart-heading">
                  <h3>Hourly environmental conditions</h3>
                  <span>
                    {timelineData.samples.length} samples
                  </span>
                </div>

                <div className="timeline-legend">
                  <span><i className="legend-sun" /> Sun visible</span>
                  <span><i className="legend-earth" /> Earth fully visible</span>
                  <span><i className="legend-partial" /> Earth partially visible</span>
                  <span><i className="legend-hidden" /> Obstructed</span>
                </div>

                <div className="timeline-scroll">
                  <div className="timeline-hour-grid">
                    {timelineData.samples.map((sample, index) => (
                      <div
                        className="timeline-hour"
                        key={sample.utc_datetime}
                        title={`${sample.utc_datetime} UTC`}
                      >
                        <span className="timeline-hour-label">
                          {index % 2 === 0
                            ? sample.utc_datetime.slice(11, 16)
                            : ""}
                        </span>

                        <div
                          className={
                            sample.sun.visible_above_terrain
                              ? "timeline-cell sun-visible"
                              : "timeline-cell obstructed"
                          }
                          title={`Sun: ${sample.sun.status}`}
                        />

                        <div
                          className={
                            sample.earth.visibility_status === "fully_visible"
                              ? "timeline-cell earth-visible"
                              : sample.earth.visibility_status === "partially_visible"
                              ? "timeline-cell earth-partial"
                              : "timeline-cell obstructed"
                          }
                          title={`Earth: ${sample.earth.visibility_status.replace("_", " ")}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="timeline-row-labels">
                  <span>Top row: Sun</span>
                  <span>Bottom row: Earth</span>
                  <span>All times UTC</span>
                </div>
              </div>

              <p className="map-disclaimer">
                Start: {timelineData.start_datetime_utc} UTC ·
                Duration: {timelineData.duration_hours} hours ·
                Conditions sampled every {timelineData.interval_minutes} minutes.
                Visibility durations are approximate.
              </p>
            </>
          )}
        </section>
{/* SCENARIO COMPARISON */}
<section className="metrics-section" id="comparison">
  <div className="section-heading">
    <div>
      <span className="eyebrow">MISSION ANALYSIS</span>
      <h2>Landing-site comparison</h2>
      <p>
        Compare NASA LOLA terrain measurements across
        your candidate landing locations.
      </p>
    </div>
  </div>

  <div className="comparison-grid">
    {scenarios.map((scenario) => {
      const data = comparisonTerrainData[scenario.id];

      return (
        <article className="comparison-card" key={scenario.id}>
          <h3>{scenario.name}</h3>
          <p>{scenario.site}</p>

          {!scenario.latitude || !scenario.longitude ? (
            <p>Coordinates required</p>
          ) : !data ? (
            <p>Loading terrain measurements...</p>
          ) : data.error ? (
            <p>{data.error}</p>
          ) : (
            <>
              <div className="comparison-value">
                <span>Elevation range</span>
                <strong>
                  {data.elevation_range_metres.toFixed(2)} m
                </strong>
              </div>

              <div className="comparison-value">
                <span>Mean slope</span>
                <strong>
                  {data.mean_slope_degrees.toFixed(2)}°
                </strong>
              </div>

              <div className="comparison-value">
                <span>Maximum slope</span>
                <strong>
                  {data.maximum_slope_degrees.toFixed(2)}°
                </strong>
              </div>

              <div className="comparison-value">
                <span>Terrain roughness</span>
                <strong>
                  {data.mean_terrain_roughness_metres.toFixed(2)} m
                </strong>
              </div>
            </>
          )}
        </article>
      );
    })}
  </div>
</section>
{/* AUTOMATIC TERRAIN INSIGHTS */}
<section className="metrics-section">
  <div className="section-heading">
    <div>
      <span className="eyebrow">DECISION SUPPORT</span>
      <h2>Automatic terrain assessment</h2>
      <p>
        Identifying the strongest candidate across each
        NASA LOLA terrain measurement.
      </p>
    </div>
  </div>
  {/* OVERALL TERRAIN ASSESSMENT */}
<div className="overall-assessment">
  <div>
    <span className="eyebrow">OVERALL TERRAIN ASSESSMENT</span>

    <h3>
      {comparisonInsights.every(
        (insight) => insight.best?.name === comparisonInsights[0]?.best?.name
      ) && comparisonInsights[0]?.best
        ? comparisonInsights[0].best.name
        : "No overall leader yet"}
    </h3>

    <p>
      {comparisonInsights.every(
        (insight) => insight.best?.name === comparisonInsights[0]?.best?.name
      ) && comparisonInsights[0]?.best
        ? "Best terrain profile across all four measured criteria."
        : "Terrain results are still loading or different sites lead individual metrics."}
    </p>
  </div>

  <span className="assessment-score">
    {comparisonInsights.filter((insight) => insight.best).length}/4
    metrics assessed
  </span>
</div>

  <div className="comparison-grid">
    {comparisonInsights.map((insight) => (
      <article className="comparison-card" key={insight.key}>
        <span className="eyebrow">{insight.label}</span>

        {insight.best ? (
          <>
            <h3>{insight.best.name}</h3>
            <div className="comparison-value">
              <span>Measured value</span>
              <strong>
                {insight.best.data[insight.key].toFixed(2)}
                {" "}{insight.unit}
              </strong>
            </div>
          </>
        ) : (
          <p>Waiting for terrain measurements...</p>
        )}
      </article>
    ))}
  </div>
</section>
{/* MULTI-FACTOR LANDING SITE ASSESSMENT */}
<section className="metrics-section">
  <div className="section-heading">
    <div>
      <span className="eyebrow">MISSION DECISION SUPPORT</span>
      <h2>Landing-site suitability</h2>
      <p>
        Comparing terrain, solar illumination, and
        direct-to-Earth visibility across candidate sites.
      </p>
    </div>
  </div>
{/* RECOMMENDED LANDING SITE */}
<div className="overall-assessment">
  <div>
    <span className="eyebrow">RECOMMENDED CANDIDATE</span>

    <h3>
      {recommendedSite
        ? recommendedSite.name
        : "Awaiting candidate analysis"}
    </h3>

    <p>
      {recommendedSite
        ? `Highest provisional suitability score: ${recommendedSite.overallScore.toFixed(1)} out of 100.`
        : "At least two successfully analyzed sites are required."}
    </p>

    {recommendedSite && (
      <>
        <p>
          Strongest factor: {strongestFactor?.label}
          {" "}({strongestFactor?.score.toFixed(1)}%).
        </p>

        <p>
          Main limitation: {mainLimitation?.label}
          {" "}({mainLimitation?.score.toFixed(1)}%).
        </p>
      </>
    )}
  </div>

  {recommendedSite && (
    <span className="assessment-score">
      {recommendedSite.overallScore.toFixed(1)} / 100
    </span>
  )}
</div>
  <div className="comparison-grid">
    {suitabilityAssessments.map((assessment) => (
      <article className="comparison-card" key={assessment.id}>
        <span className="eyebrow">{assessment.name}</span>

        {assessment.loading ? (
          <p>Waiting for mission analysis...</p>
        ) : (
          <>
            <h3>
              {assessment.overallScore.toFixed(1)} / 100
            </h3>

            <div className="comparison-value">
              <span>Terrain (40%)</span>
              <strong>{assessment.terrainScore.toFixed(1)}%</strong>
            </div>

            <div className="comparison-value">
              <span>Solar visibility (30%)</span>
              <strong>{assessment.solarScore.toFixed(1)}%</strong>
            </div>

            <div className="comparison-value">
              <span>Full Earth visibility (30%)</span>
              <strong>
                {assessment.communicationsScore.toFixed(1)}%
              </strong>
            </div>
          </>
        )}
      </article>
    ))}
  </div>

  <p className="assessment-note">
    Scores are provisional comparative indicators, not
    engineering certification. Terrain is normalized against
    the current candidate sites. Solar and Earth visibility
    are estimated over a 24-hour interval.
  </p>
</section>
        <footer>
          <span>LUNARIS · Lunar Mission Intelligence</span>
          <span>NASA LOLA terrain and NASA/JPL SPICE integration</span>
        </footer>
      </section>
    </main>
  );
}

function MetricCard({ icon, title, value, description }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <h3>{title}</h3>
      <div className="metric-placeholder">
        {value ?? "—"}
      </div>
      <p>{description}</p>
    </article>
  );
}

export default App;
