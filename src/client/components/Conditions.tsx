import type { SwellData, WindData } from "../../../shared/types";
import "./Conditions.css";

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
    <div className="conditions">
      {/* Swell */}
      <div className="conditions-card">
        <div className="conditions-card-label">Swell</div>
        <div className="conditions-card-value">{swell.height.toFixed(1)}m</div>
        <div className="conditions-card-sub">@{swell.period}s</div>
        <div className="conditions-card-sub">{swellDir} {swell.direction}°</div>
      </div>

      {/* Wind */}
      <div className="conditions-card">
        <div className="conditions-card-label">Wind</div>
        <div className="conditions-card-value">
          {wind.speed} <span className="conditions-card-unit">km/h</span>
        </div>
        <div className="wind-type" style={{ color: wt.color }}>{wt.label}</div>
        <div className="conditions-card-sub">{windDir} · Gusts {Math.round(wind.gusts)} km/h</div>
      </div>
    </div>
  );
}
