
import { useState } from "react";
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

import "./App.css";

const initialScenario = {
  id: 1,
  name: "Primary Mission",
  site: "Lunar South Pole",
  latitude: "",
  longitude: "",
  date: "2026-11-14",
};

function App() {
  const [scenarios, setScenarios] = useState([
    initialScenario,
  ]);

  const [activeScenario, setActiveScenario] = useState(1);

  const currentScenario = scenarios.find(
    (scenario) => scenario.id === activeScenario
  );

  function updateScenario(field, value) {
    setScenarios((previous) =>
      previous.map((scenario) =>
        scenario.id === activeScenario
          ? { ...scenario, [field]: value }
          : scenario
      )
    );
  }

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
                    max="90"
                    step="any"
                    value={currentScenario.latitude}
                    onChange={(event) =>
                      updateScenario("latitude", event.target.value)
                    }
                    placeholder="e.g. -89.9"
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
                    placeholder="e.g. 0.0"
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

              <div className="notice">
                <Activity size={17} />
                <div>
                  <strong>Scientific data not connected yet</strong>
                  <p>
                    This scenario is currently a configuration.
                    Astronomical measurements will appear after
                    the JPL Horizons integration is implemented.
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>

        <section className="metrics-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">MISSION ENVIRONMENT</span>
              <h2>Environmental assessment</h2>
            </div>
            <span className="draft-label">Awaiting data</span>
          </div>

          <div className="metrics-grid">
            <MetricCard
              icon={<Sun />}
              title="Solar elevation"
              description="Sun position relative to the local horizon"
            />

            <MetricCard
              icon={<Globe />}
              title="Earth visibility"
              description="Earth position relative to the local horizon"
            />

            <MetricCard
              icon={<Radio />}
              title="Communication"
              description="Direct-to-Earth visibility windows"
            />

            <MetricCard
              icon={<Activity />}
              title="Illumination"
              description="Solar availability over the mission period"
            />
          </div>
        </section>

        <footer>
          <span>LUNARIS · Lunar Mission Intelligence</span>
          <span>Scientific measurements pending integration</span>
        </footer>
      </section>
    </main>
  );
}

function MetricCard({ icon, title, description }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <h3>{title}</h3>
      <div className="metric-placeholder">—</div>
      <p>{description}</p>
    </article>
  );
}

export default App;
