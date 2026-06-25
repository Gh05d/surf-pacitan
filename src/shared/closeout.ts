// Advisory close-out risk heuristic. Pure: imports only types, no Redis/env —
// callable from client (per-hour display) and server (recommendation warning).
// Models "long-period swell over a shallow bank" — the cause of close-outs the
// five-factor rating can't see. NEVER changes the green/yellow/red rating.
import type { HourlyData } from "./types";

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
