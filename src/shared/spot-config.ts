// Per-spot rating thresholds — SHARED between server (rating computation,
// candidate windows) and client (spot info sheets, limiting-factor display).
// This is pure data: no env reads, no server-only imports. Server code keeps
// importing these via src/server/config.ts re-exports.
import { ACTIVE_REGION } from "./active-region";
import type { CloseoutThresholds } from "./closeout";

export interface WindDirectionThresholds {
  greenMax: number;  // km/h
  yellowMax: number; // km/h
}

export interface SpotThresholds {
  tide: {
    greenMin: number;
    greenMax: number;
    yellowMin: number;
    yellowMax: number;
  };
  swellDir: {
    ideal: number;       // degrees, 0=N
    greenWindow: number; // ± degrees still green
    yellowWindow: number;// ± degrees still yellow
  };
  swellHeight: { greenMin: number; yellowMin: number };
  swellPeriod: { greenMin: number; yellowMin: number };
  facingDirection: number;
  wind: {
    offshore:   WindDirectionThresholds;
    crossShore: WindDirectionThresholds;
    onshore:    WindDirectionThresholds;
  };
  // Sandbar breaks need rising water: when true, a green hour on a falling
  // tide is capped to yellow. Not universal — point/reef breaks elsewhere
  // don't care, so this is per-spot config, not global logic.
  fallingTideCap: boolean;
  // Optional close-out risk heuristic — advisory only, never changes the
  // green/yellow/red rating. Absent → no flag for this spot. See
  // src/shared/closeout.ts.
  closeout?: CloseoutThresholds;
}

// Derived view over the active region pack. Server code reaches this via the
// src/server/config.ts re-export; the client imports it directly.
export const SPOT_THRESHOLDS: Record<string, SpotThresholds> = Object.fromEntries(
  ACTIVE_REGION.spots.map((s) => [s.id, s.thresholds]),
);
