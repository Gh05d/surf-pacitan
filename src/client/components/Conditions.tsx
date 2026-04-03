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

// Pacitan beaches face south (~180°). Wind "direction" = where it comes FROM.
// Offshore = from land (N) = good. Onshore = from sea (S) = bad.
function windType(deg: number): { label: string; color: string } {
  const d = ((deg % 360) + 360) % 360;
  // Offshore: 315-45 (from N)
  if (d >= 315 || d <= 45) return { label: "Offshore", color: "var(--green)" };
  // Onshore: 135-225 (from S)
  if (d >= 135 && d <= 225) return { label: "Onshore", color: "var(--red)" };
  // Cross-shore: everything else
  return { label: "Cross-shore", color: "var(--yellow)" };
}

export function Conditions({ swell, wind }: ConditionsProps) {
  const swellDir = degToCompass(swell.direction);
  const windDir = degToCompass(wind.direction);
  const wt = windType(wind.direction);

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
        <div style={{ color: wt.color, fontSize: "0.85rem", fontWeight: 600, marginTop: "0.25rem" }}>
          {wt.label}
        </div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
          {windDir} · Gusts {Math.round(wind.gusts)} km/h
        </div>
      </div>
    </div>
  );
}
