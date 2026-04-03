import type { SwellData, WindData } from "../../../shared/types";

interface ConditionsProps {
  swell: SwellData;
  wind: WindData;
}

function degToCompass(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return dirs[index];
}

export function Conditions({ swell, wind }: ConditionsProps) {
  const swellDir = degToCompass(swell.direction);
  const windDir = degToCompass(wind.direction);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "0.75rem",
        padding: "0.75rem 1rem",
      }}
    >
      {/* Swell */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          padding: "0.75rem",
        }}
      >
        <div style={{ color: "var(--text-dim)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
          Swell
        </div>
        <div style={{ fontSize: "1.5rem", fontWeight: 700, lineHeight: 1 }}>
          {swell.height.toFixed(1)}m
        </div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
          @{swell.period}s
        </div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
          {swellDir} {swell.direction}°
        </div>
      </div>

      {/* Wind */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          padding: "0.75rem",
        }}
      >
        <div style={{ color: "var(--text-dim)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
          Wind
        </div>
        <div style={{ fontSize: "1.5rem", fontWeight: 700, lineHeight: 1 }}>
          {wind.speed} <span style={{ fontSize: "0.9rem", fontWeight: 400 }}>km/h</span>
        </div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
          {windDir} direction
        </div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
          Gusts {wind.gusts} km/h
        </div>
      </div>
    </div>
  );
}
