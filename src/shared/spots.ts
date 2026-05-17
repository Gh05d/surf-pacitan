import type { SpotName } from "./types";

export interface SpotDisplayInfo {
  key: SpotName;
  label: string;   // full name shown in UI
  abbr: string;    // short code shown on tide-graph strips
  emoji: string;   // per-spot descriptive emoji
}

// Ordered west-to-east along Pacitan bay (local naming convention).
// Public surf guides label these differently — see CLAUDE.md "Spot geography".
export const SPOT_DISPLAY: readonly SpotDisplayInfo[] = [
  { key: "pancer",     label: "Pancer",      abbr: "P",  emoji: "🏞️" },
  { key: "pancerDoor", label: "Pancer Door", abbr: "PD", emoji: "🏖️" },
  { key: "telengRia",  label: "Teleng Ria",  abbr: "TR", emoji: "🌅" },
] as const;
