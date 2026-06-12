import type { SpotName } from "./types";
import { ACTIVE_REGION } from "./active-region";

export interface SpotDisplayInfo {
  key: SpotName;
  label: string;   // full name shown in UI
  abbr: string;    // short code shown on tide-graph strips
  emoji: string;   // per-spot descriptive emoji
  character: string; // 1-2 sentence spot character for the info sheet
}

// Derived from the active region pack, in pack order (= display order and
// candidate tiebreak order; for Pacitan that's west-to-east along the bay).
export const SPOT_DISPLAY: readonly SpotDisplayInfo[] = ACTIVE_REGION.spots.map((s) => ({
  key: s.id,
  label: s.label,
  abbr: s.abbr,
  emoji: s.emoji,
  character: s.character,
}));
