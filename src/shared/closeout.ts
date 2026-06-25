// Advisory close-out risk heuristic. Pure: imports only types, no Redis/env —
// callable from client (per-hour display) and server (recommendation warning).
// Models "long-period swell over a shallow bank" — the cause of close-outs the
// five-factor rating can't see. NEVER changes the green/yellow/red rating.
import type { ForecastDay, HourlyData } from "./types";

export interface CloseoutThresholds {
  /** meters MSL — at/below this the bank is shallow enough to dump. */
  tideHeightMax: number;
  /** seconds — long-period energy jacks up steeply on a shallow bank. */
  periodMin: number;
  /** optional floor — below this the surf is too small for close-outs to matter. */
  swellHeightMin?: number;
}

/** true = elevated close-out risk for this hour at this spot. */
export function closeoutRisk(
  hour: Pick<HourlyData, "tide" | "swell">,
  t: CloseoutThresholds | undefined,
): boolean {
  if (!t) return false;
  if (hour.tide.height > t.tideHeightMax) return false;
  if (hour.swell.period < t.periodMin) return false;
  if (t.swellHeightMin != null && hour.swell.height < t.swellHeightMin) return false;
  return true;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseHHMM(s: string): number | null {
  const m = HHMM_RE.exec(s);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/**
 * Deterministic close-out warning for a recommended spot+window. Returns a
 * warning string (<= 200 chars, the rec `warnings` cap) when any daylight hour
 * the window overlaps flags for the spot, else null. Window-overlap matches
 * validateRecommendation: [start, end) touches hour H when floor(start/60) <= H
 * <= ceil(end/60) - 1.
 */
export function closeoutWarningForPick(
  day: ForecastDay,
  _spotId: string,
  window: { start: string; end: string },
  thresholds: CloseoutThresholds | undefined,
): string | null {
  if (!thresholds) return null;
  const startMin = parseHHMM(window.start);
  const endMin = parseHHMM(window.end);
  if (startMin === null || endMin === null || endMin <= startMin) return null;

  const firstHour = Math.floor(startMin / 60);
  const lastHour = Math.ceil(endMin / 60) - 1;
  const byHour = new Map(day.hourly.map((h) => [h.hour, h]));
  for (let hr = firstHour; hr <= lastHour; hr += 1) {
    const h = byHour.get(hr);
    if (h && closeoutRisk(h, thresholds)) {
      return "Close-out risk: long-period swell on a low tide — waves may jack up and close out.";
    }
  }
  return null;
}

/**
 * Of the given spots (each with its optional closeout config), which have at
 * least one flagged hour among `hours`. Used by ConditionsPanel for the
 * per-block note. Preserves input spot order.
 */
export function closeoutSpotsForHours(
  hours: ReadonlyArray<Pick<HourlyData, "tide" | "swell">>,
  spots: ReadonlyArray<{ id: string; closeout: CloseoutThresholds | undefined }>,
): string[] {
  const flagged: string[] = [];
  for (const s of spots) {
    if (hours.some((h) => closeoutRisk(h, s.closeout))) flagged.push(s.id);
  }
  return flagged;
}
