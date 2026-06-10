import type { SpotName } from "./types";

export interface SpotDisplayInfo {
  key: SpotName;
  label: string;   // full name shown in UI
  abbr: string;    // short code shown on tide-graph strips
  emoji: string;   // per-spot descriptive emoji
  character: string; // 1-2 sentence spot character for the info sheet (curated,
                     // distilled from src/server/knowledge-base.ts — threshold
                     // numbers are NOT repeated here, they render data-driven
                     // from SPOT_THRESHOLDS)
}

// Ordered west-to-east along Pacitan bay: Teleng Ria (west, sheltered) →
// Pancer Door (middle, long beach) → Pancer (east, Grindulu river mouth).
// Geography confirmed by the user 2026-05-29 — see CLAUDE.md "Spot geography".
export const SPOT_DISPLAY: readonly SpotDisplayInfo[] = [
  {
    key: "telengRia",
    label: "Teleng Ria",
    abbr: "TR",
    emoji: "🌅",
    character:
      "Sheltered behind the western headland — tame and beginner-friendly on a normal SW day. Direct S swell wraps in with little loss; handles peak high tide best of the three.",
  },
  {
    key: "pancerDoor",
    label: "Pancer Door",
    abbr: "PD",
    emoji: "🏖️",
    character:
      "Long open beach break in the middle of the bay — the all-rounder. Tolerates higher tide than Pancer, likes SW swell.",
  },
  {
    key: "pancer",
    label: "Pancer",
    abbr: "P",
    emoji: "🏞️",
    character:
      "River-mouth sandbar at the east end, shaped by the Grindulu river and shifting seasonally. Most SW-exposed spot; best on low-to-mid rising tide — drowns at high tide.",
  },
] as const;
