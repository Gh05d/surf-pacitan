import type { SpotName } from "./types";

export interface SpotDisplayInfo {
  key: SpotName;
  label: string;   // full name shown in UI
  abbr: string;    // short code shown on tide-graph strips
  emoji: string;   // per-spot descriptive emoji
}

// Ordered west-to-east along Pacitan bay: Teleng Ria (west, sheltered) →
// Pancer Door (middle, long beach) → Pancer (east, Grindulu river mouth).
// Geography confirmed by the user 2026-05-29 — see CLAUDE.md "Spot geography".
export const SPOT_DISPLAY: readonly SpotDisplayInfo[] = [
  { key: "telengRia",  label: "Teleng Ria",  abbr: "TR", emoji: "🌅" },
  { key: "pancerDoor", label: "Pancer Door", abbr: "PD", emoji: "🏖️" },
  { key: "pancer",     label: "Pancer",      abbr: "P",  emoji: "🏞️" },
] as const;
