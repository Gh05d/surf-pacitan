import type { WeatherData } from "../../../shared/types";

interface WeatherProps {
  weather: WeatherData;
}

const CONDITION_LABELS: Record<string, string> = {
  clear: "Clear",
  partly_cloudy: "Partly Cloudy",
  cloudy: "Cloudy",
  rain: "Rain",
  thunderstorm: "Thunderstorm",
  fog: "Fog",
};

function formatCondition(condition: string): string {
  return CONDITION_LABELS[condition] ?? condition.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Weather({ weather }: WeatherProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: "0.75rem",
        padding: "0 1rem 1rem",
      }}
    >
      {/* Temp */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          padding: "0.75rem",
          textAlign: "center",
        }}
      >
        <div style={{ color: "var(--text-dim)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>
          Temp
        </div>
        <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{weather.temp}°C</div>
      </div>

      {/* Condition */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          padding: "0.75rem",
          textAlign: "center",
        }}
      >
        <div style={{ color: "var(--text-dim)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>
          Sky
        </div>
        <div style={{ fontSize: "0.8rem", fontWeight: 600, lineHeight: 1.3 }}>
          {formatCondition(weather.condition)}
        </div>
      </div>

      {/* Rain */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          padding: "0.75rem",
          textAlign: "center",
        }}
      >
        <div style={{ color: "var(--text-dim)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>
          Rain
        </div>
        <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{weather.precipitation} <span style={{ fontSize: "0.75rem", fontWeight: 400 }}>mm</span></div>
      </div>
    </div>
  );
}
