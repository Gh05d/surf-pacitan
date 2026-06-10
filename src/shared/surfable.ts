import type { SurfableRating, SpotRatings, ForecastDay, HourlyData } from "./types";
import type { SpotThresholds } from "./spot-config";
import { SURFABLE, SPOT_THRESHOLDS } from "./spot-config";

export interface SurfableInput {
  hour: number;
  tidePercent: number;
  tideRising: boolean;
  swellHeight: number;
  swellPeriod: number;       // seconds
  swellDirection: number;    // degrees, 0=N
  windSpeed: number;
  windDirection: number;
  sunrise: string;
  sunset: string;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

// An hour counts as daylight when its CENTER lies between sunrise and sunset
// (≈ at least 30 min of light in [H, H+1)). Hour-granular truncation erased
// the dusk session (sunset 17:55 → h17 red) while rating a pitch-dark 05:00.
function isWithinDaylight(hour: number, sunrise: string, sunset: string): boolean {
  const center = hour * 60 + 30;
  return center >= hhmmToMinutes(sunrise) && center < hhmmToMinutes(sunset);
}

export type Quality = SurfableRating;

const QUALITY_ORDER: Record<Quality, number> = { red: 0, yellow: 1, green: 2 };

export function minQuality(qs: Quality[]): Quality {
  return qs.reduce((a, b) => (QUALITY_ORDER[a] < QUALITY_ORDER[b] ? a : b));
}

export function angularDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

export function computeTideQuality(
  tidePercent: number,
  t: SpotThresholds["tide"]
): Quality {
  if (tidePercent < t.yellowMin || tidePercent > t.yellowMax) return "red";
  if (tidePercent >= t.greenMin && tidePercent <= t.greenMax) return "green";
  return "yellow";
}

export function computeSwellDirQuality(
  swellDirection: number,
  t: SpotThresholds["swellDir"]
): Quality {
  const d = angularDistance(swellDirection, t.ideal);
  if (d > t.yellowWindow) return "red";
  if (d <= t.greenWindow) return "green";
  return "yellow";
}

export function computeSwellHeightQuality(
  swellHeight: number,
  t: SpotThresholds["swellHeight"]
): Quality {
  if (swellHeight < t.yellowMin) return "red";
  if (swellHeight >= t.greenMin) return "green";
  return "yellow";
}

export function computeSwellPeriodQuality(
  swellPeriod: number,
  t: SpotThresholds["swellPeriod"]
): Quality {
  if (swellPeriod < t.yellowMin) return "red";
  if (swellPeriod >= t.greenMin) return "green";
  return "yellow";
}

export type WindCategory = "offshore" | "crossShore" | "onshore";

export function getWindCategory(windDirection: number, facingDirection: number): WindCategory {
  const raw = Math.abs(windDirection - facingDirection);
  const angleDiff = raw > 180 ? 360 - raw : raw;

  if (angleDiff < 60) return "onshore";
  if (angleDiff > 120) return "offshore";
  return "crossShore";
}

export function computeWindQuality(
  windSpeed: number,
  windDirection: number,
  thresholds: SpotThresholds
): Quality {
  const category = getWindCategory(windDirection, thresholds.facingDirection);
  const w = thresholds.wind[category];
  if (windSpeed > w.yellowMax) return "red";
  if (windSpeed <= w.greenMax) return "green";
  return "yellow";
}

export function computeSurfable(input: SurfableInput, thresholds: SpotThresholds = SURFABLE): Quality {
  if (!isWithinDaylight(input.hour, input.sunrise, input.sunset)) return "red";

  const tideQ      = computeTideQuality(input.tidePercent, thresholds.tide);
  const swellDirQ  = computeSwellDirQuality(input.swellDirection, thresholds.swellDir);
  const swellHQ    = computeSwellHeightQuality(input.swellHeight, thresholds.swellHeight);
  const swellPQ    = computeSwellPeriodQuality(input.swellPeriod, thresholds.swellPeriod);
  const windQ      = computeWindQuality(input.windSpeed, input.windDirection, thresholds);

  let final = minQuality([tideQ, swellDirQ, swellHQ, swellPQ, windQ]);

  // Falling-tide cap: sandbar breaks need rising water — green degrades to yellow.
  if (!input.tideRising && final === "green") final = "yellow";

  return final;
}

export function computeAllSpotRatings(input: SurfableInput): SpotRatings {
  return {
    telengRia: computeSurfable(input, SPOT_THRESHOLDS.telengRia),
    pancer: computeSurfable(input, SPOT_THRESHOLDS.pancer),
    pancerDoor: computeSurfable(input, SPOT_THRESHOLDS.pancerDoor),
  };
}

export function computeTidePercent(
  currentHeight: number,
  dailyMin: number,
  dailyMax: number
): number {
  const range = dailyMax - dailyMin;
  if (range === 0) return 50;
  return ((currentHeight - dailyMin) / range) * 100;
}

// ---------------------------------------------------------------------------
// Factor breakdown — "why is this hour yellow/red?" for the UI
// ---------------------------------------------------------------------------

export type FactorName = "tide" | "swellDir" | "swellHeight" | "swellPeriod" | "wind";
export type LimitingFactor = FactorName | "daylight" | "fallingTide";

export interface FactorBreakdown {
  /** Identical to computeSurfable(input, thresholds) — pinned by tests. */
  final: Quality;
  factors: Record<FactorName, Quality>;
  /**
   * What holds the rating down: empty when final is green; ["daylight"] when
   * the hour is dark; ["fallingTide"] when only the falling-tide cap demoted
   * a would-be green; otherwise every factor sitting at the final level.
   */
  limiting: LimitingFactor[];
  windCategory: WindCategory;
}

export function computeFactorBreakdown(
  input: SurfableInput,
  thresholds: SpotThresholds = SURFABLE,
): FactorBreakdown {
  const windCategory = getWindCategory(input.windDirection, thresholds.facingDirection);
  const factors: Record<FactorName, Quality> = {
    tide: computeTideQuality(input.tidePercent, thresholds.tide),
    swellDir: computeSwellDirQuality(input.swellDirection, thresholds.swellDir),
    swellHeight: computeSwellHeightQuality(input.swellHeight, thresholds.swellHeight),
    swellPeriod: computeSwellPeriodQuality(input.swellPeriod, thresholds.swellPeriod),
    wind: computeWindQuality(input.windSpeed, input.windDirection, thresholds),
  };

  if (!isWithinDaylight(input.hour, input.sunrise, input.sunset)) {
    return { final: "red", factors, limiting: ["daylight"], windCategory };
  }

  const names = Object.keys(factors) as FactorName[];
  const factorMin = minQuality(names.map((n) => factors[n]));

  if (factorMin === "green") {
    if (!input.tideRising) {
      return { final: "yellow", factors, limiting: ["fallingTide"], windCategory };
    }
    return { final: "green", factors, limiting: [], windCategory };
  }

  return {
    final: factorMin,
    factors,
    limiting: names.filter((n) => factors[n] === factorMin),
    windCategory,
  };
}

/**
 * Build a SurfableInput for one cached hour of a ForecastDay — lets the client
 * recompute factor breakdowns from the same data the server rated. tidePercent
 * is relative to the day's hourly min/max, matching the server (cron.ts).
 */
export function surfableInputForHour(day: ForecastDay, h: HourlyData): SurfableInput {
  const heights = day.hourly.map((x) => x.tide.height);
  const dailyMin = heights.length ? Math.min(...heights) : 0;
  const dailyMax = heights.length ? Math.max(...heights) : 1;
  return {
    hour: h.hour,
    tidePercent: computeTidePercent(h.tide.height, dailyMin, dailyMax),
    tideRising: h.tide.rising,
    swellHeight: h.swell.height,
    swellPeriod: h.swell.period,
    swellDirection: h.swell.direction,
    windSpeed: h.wind.speed,
    windDirection: h.wind.direction,
    sunrise: day.astronomy.sunrise,
    sunset: day.astronomy.sunset,
  };
}

// ---------------------------------------------------------------------------
// Display helpers (UI language is English, matching the rest of the app)
// ---------------------------------------------------------------------------

const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

export function degreesToCompass(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  return COMPASS[Math.round(normalized / 22.5) % 16];
}

/**
 * Is `candidate` a more severe example of `factor` than `current`? Used by the
 * UI to pick the representative hour for a limiting-factor note (e.g. the
 * windiest hour of a yellow window).
 */
export function moreSevereLimitingExample(
  factor: LimitingFactor,
  candidate: SurfableInput,
  current: SurfableInput,
): boolean {
  switch (factor) {
    case "wind": return candidate.windSpeed > current.windSpeed;
    case "swellHeight": return candidate.swellHeight < current.swellHeight;
    case "swellPeriod": return candidate.swellPeriod < current.swellPeriod;
    case "tide": return Math.abs(candidate.tidePercent - 50) > Math.abs(current.tidePercent - 50);
    default: return false;
  }
}

const WIND_CATEGORY_LABEL: Record<WindCategory, string> = {
  offshore: "offshore",
  crossShore: "cross-shore",
  onshore: "onshore",
};

/** Short English phrase for one limiting factor, e.g. "onshore wind 16 km/h". */
export function describeLimitingFactor(
  factor: LimitingFactor,
  input: SurfableInput,
  thresholds: SpotThresholds,
): string {
  switch (factor) {
    case "daylight":
      return "dark — outside daylight";
    case "fallingTide":
      return "falling tide — sandbars need rising water";
    case "tide": {
      const pct = Math.round(input.tidePercent);
      return input.tidePercent > thresholds.tide.greenMax
        ? `tide too high (${pct}% of daily range)`
        : `tide too low (${pct}% of daily range)`;
    }
    case "swellDir":
      return `swell from ${degreesToCompass(input.swellDirection)} ${Math.round(input.swellDirection)}° — ideal is ${degreesToCompass(thresholds.swellDir.ideal)} ${thresholds.swellDir.ideal}°`;
    case "swellHeight":
      return `swell too small (${input.swellHeight.toFixed(1)} m)`;
    case "swellPeriod":
      return `short swell period (${Math.round(input.swellPeriod)}s)`;
    case "wind": {
      const cat = getWindCategory(input.windDirection, thresholds.facingDirection);
      return `${WIND_CATEGORY_LABEL[cat]} wind ${Math.round(input.windSpeed)} km/h`;
    }
  }
}
