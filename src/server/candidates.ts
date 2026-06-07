import type { ForecastDay, HourlyData, SpotName } from "../shared/types";
import { SPOT_DISPLAY } from "../shared/spots";

// A surfable window computed from the per-hour ratings, shipped to the LLM as
// a ranked candidate. rank 1 = best window of the day across all spots.
export interface CandidateWindow {
  rank: number;        // 1-based, global best-first
  spot: SpotName;
  start: string;       // "HH:00"
  end: string;         // "HH:00", exclusive — "10:00"–"12:00" covers hours 10 and 11.
                       // An hour-23 window would emit "24:00" (downstream parseHHMM rejects
                       // it); unreachable in practice since night hours are rated red.
  ratings: string;     // compact per-hour ratings, e.g. "10g 11g"
  greens: number;
  risingShare: number; // 0..1, rounded to 2 decimals
  meanWind: number;    // km/h, rounded
}

interface ScoredWindow {
  spot: SpotName;
  startHour: number;
  endHour: number; // exclusive
  hours: HourlyData[];
  greens: number;
  greenFraction: number;
  risingShare: number;
  meanWind: number; // unrounded — rounding only happens in the payload shape
}

const SPOT_ORDER: SpotName[] = SPOT_DISPLAY.map((s) => s.key);

// Lexicographic: more greens, denser greens, more rising tide, less wind,
// earlier start, shorter window. Negative when a is better.
function compareWindows(a: ScoredWindow, b: ScoredWindow): number {
  if (a.greens !== b.greens) return b.greens - a.greens;
  if (a.greenFraction !== b.greenFraction) return b.greenFraction - a.greenFraction;
  if (a.risingShare !== b.risingShare) return b.risingShare - a.risingShare;
  if (a.meanWind !== b.meanWind) return a.meanWind - b.meanWind;
  if (a.startHour !== b.startHour) return a.startHour - b.startHour;
  return a.endHour - b.endHour;
}

function scoreWindow(spot: SpotName, hours: HourlyData[]): ScoredWindow {
  const greens = hours.filter((h) => h.surfable[spot] === "green").length;
  const rising = hours.filter((h) => h.tide.rising).length;
  const windSum = hours.reduce((sum, h) => sum + h.wind.speed, 0);
  return {
    spot,
    startHour: hours[0].hour,
    endHour: hours[hours.length - 1].hour + 1,
    hours,
    greens,
    greenFraction: greens / hours.length,
    risingShare: rising / hours.length,
    meanWind: windSum / hours.length,
  };
}

// Contiguous runs of non-red hours for the spot. Night hours are already red
// via the surfable sunrise/sunset logic, so no separate daylight filter is
// needed. Gaps in hour numbers break runs.
function nonRedRuns(hourly: HourlyData[], spot: SpotName): HourlyData[][] {
  const sorted = [...hourly].sort((a, b) => a.hour - b.hour);
  const runs: HourlyData[][] = [];
  let run: HourlyData[] = [];
  for (const h of sorted) {
    const nonRed = h.surfable[spot] !== "red";
    const contiguous = run.length > 0 && h.hour === run[run.length - 1].hour + 1;
    if (nonRed && (run.length === 0 || contiguous)) {
      run.push(h);
    } else {
      if (run.length) runs.push(run);
      run = nonRed ? [h] : [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

function bestWindowForSpot(hourly: HourlyData[], spot: SpotName): ScoredWindow | null {
  const runs = nonRedRuns(hourly, spot);
  if (!runs.length) return null;

  const windows: ScoredWindow[] = [];
  for (const run of runs) {
    for (const len of [2, 3]) {
      for (let i = 0; i + len <= run.length; i += 1) {
        windows.push(scoreWindow(spot, run.slice(i, i + len)));
      }
    }
  }
  // 1-hour fallback only when no run reaches length 2 (then all runs are 1h).
  if (!windows.length) {
    for (const run of runs) windows.push(scoreWindow(spot, run));
  }
  windows.sort(compareWindows);
  return windows[0];
}

function toCandidate(w: ScoredWindow, rank: number): CandidateWindow {
  const hh = (n: number) => `${String(n).padStart(2, "0")}:00`;
  return {
    rank,
    spot: w.spot,
    start: hh(w.startHour),
    end: hh(w.endHour),
    ratings: w.hours
      .map((h) => `${String(h.hour).padStart(2, "0")}${h.surfable[w.spot][0]}`)
      .join(" "),
    greens: w.greens,
    risingShare: Math.round(w.risingShare * 100) / 100,
    meanWind: Math.round(w.meanWind),
  };
}

export function computeCandidateWindows(forecast: ForecastDay): CandidateWindow[] {
  const winners: ScoredWindow[] = [];
  for (const spot of SPOT_ORDER) {
    const best = bestWindowForSpot(forecast.hourly, spot);
    if (best) winners.push(best);
  }
  // Deterministic on full ties: west-to-east spot order.
  winners.sort(
    (a, b) => compareWindows(a, b) || SPOT_ORDER.indexOf(a.spot) - SPOT_ORDER.indexOf(b.spot),
  );
  return winners.map((w, i) => toCandidate(w, i + 1));
}
