import type { SpotName } from "../../shared/types";
import { SPOT_DISPLAY } from "../../shared/spots";
import { SPOT_THRESHOLDS, type SpotThresholds } from "../../shared/spot-config";
import { degreesToCompass } from "../../shared/surfable";
import "./SpotInfoSheet.css";

interface SpotInfoSheetProps {
  spot: SpotName | null;
  onClose: () => void;
}

// Everything numeric below renders straight from SPOT_THRESHOLDS — the same
// data the rating engine uses — so this sheet can never drift from the colors
// on the chart. Only the `character` line is curated text (spots.ts).

function tideLine(t: SpotThresholds["tide"]): string {
  const where =
    t.greenMax >= 90 ? "handles peak high tide" :
    t.greenMax >= 80 ? "tolerates fairly high tide" :
    "drowns at high tide";
  return `Tide: best at ${t.greenMin}–${t.greenMax}% of the daily range — ${where}. Outside ${t.yellowMin}–${t.yellowMax}% it's off.`;
}

export function SpotInfoSheet({ spot, onClose }: SpotInfoSheetProps) {
  if (!spot) return null;
  const display = SPOT_DISPLAY.find((s) => s.key === spot)!;
  const t = SPOT_THRESHOLDS[spot];

  const lines = [
    tideLine(t.tide),
    `Swell direction: ideal ${degreesToCompass(t.swellDir.ideal)} (${t.swellDir.ideal}°), good within ±${t.swellDir.greenWindow}°, workable within ±${t.swellDir.yellowWindow}°.`,
    `Swell size: from ${t.swellHeight.greenMin} m at ${t.swellPeriod.greenMin}s+ period; below ${t.swellHeight.yellowMin} m or ${t.swellPeriod.yellowMin}s it won't break properly.`,
    `Wind: offshore fine up to ${t.wind.offshore.greenMax} km/h, cross-shore up to ${t.wind.crossShore.greenMax}, onshore only up to ${t.wind.onshore.greenMax}.`,
    ...(t.fallingTideCap
      ? ["Rising water is always better — falling tide caps any green hour to yellow."]
      : []),
  ];

  return (
    <div className="spot-sheet-backdrop" onClick={onClose}>
      <div className="spot-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="spot-sheet-header">
          <div className="spot-sheet-title">
            <span className="spot-sheet-title-main">Spot profile</span>
            <span className="spot-sheet-title-name">{display.emoji} {display.label}</span>
          </div>
          <button className="spot-sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="spot-sheet-body">
          <p className="spot-sheet-character">{display.character}</p>
          <ul className="spot-sheet-needs">
            {lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
