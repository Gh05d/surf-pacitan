import type { ForecastDay, SpotRatings, SpotName, TideExtreme } from "../shared/types";

export interface PayloadHourly {
  hour: number;
  tide: { height: number; rising: boolean };
  swell: { height: number; period: number; direction: number };
  wind: { speed: number; direction: number; gusts: number };
  weather: { condition: string; precipitation: number };
  surfable: SpotRatings;
}

export interface UserPayload {
  forDate: string;
  tideRange: number;
  astronomy: { sunrise: string; sunset: string };
  tideExtremes: TideExtreme[];
  hourly: PayloadHourly[];
}

const VALID_SPOTS: SpotName[] = ["telengRia", "pancer", "pancerDoor"];
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ValidatedRecommendationFields {
  bestSpot: SpotName;
  bestWindow: { start: string; end: string };
  headline: string;
  reasoning: string;
  warnings: string[];
}

export type ValidationResult =
  | { ok: true; value: ValidatedRecommendationFields }
  | { ok: false; error: string };

function parseHHMM(s: string): number | null {
  const m = HHMM_RE.exec(s);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function validateRecommendation(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "raw is not an object" };
  const r = raw as Record<string, unknown>;

  if (typeof r.bestSpot !== "string" || !VALID_SPOTS.includes(r.bestSpot as SpotName)) {
    return { ok: false, error: `invalid bestSpot: ${String(r.bestSpot)}` };
  }
  const bestSpot = r.bestSpot as SpotName;

  if (!r.bestWindow || typeof r.bestWindow !== "object") {
    return { ok: false, error: "missing bestWindow" };
  }
  const w = r.bestWindow as Record<string, unknown>;
  if (typeof w.start !== "string" || typeof w.end !== "string") {
    return { ok: false, error: "bestWindow.start/end must be strings" };
  }
  const startMin = parseHHMM(w.start);
  const endMin = parseHHMM(w.end);
  if (startMin === null || endMin === null) {
    return { ok: false, error: "bestWindow times must be HH:MM" };
  }
  if (endMin <= startMin) {
    return { ok: false, error: "bestWindow.end must be after start" };
  }

  if (typeof r.headline !== "string" || r.headline.length === 0 || r.headline.length > 200) {
    return { ok: false, error: "headline must be non-empty <= 200 chars" };
  }
  if (typeof r.reasoning !== "string" || r.reasoning.length === 0 || r.reasoning.length > 600) {
    return { ok: false, error: "reasoning must be non-empty <= 600 chars" };
  }

  if (!Array.isArray(r.warnings)) {
    return { ok: false, error: "warnings must be an array" };
  }
  for (const wn of r.warnings) {
    if (typeof wn !== "string") return { ok: false, error: "warnings must be strings" };
    if (wn.length > 200) return { ok: false, error: "warning string too long (>200)" };
  }

  return {
    ok: true,
    value: {
      bestSpot,
      bestWindow: { start: w.start, end: w.end },
      headline: r.headline,
      reasoning: r.reasoning,
      warnings: r.warnings as string[],
    },
  };
}

export function buildUserPayload(forecast: ForecastDay): UserPayload {
  const heights = forecast.tideExtremes.map((t) => t.height);
  const tideRange = heights.length ? Math.max(...heights) - Math.min(...heights) : 0;

  return {
    forDate: forecast.date,
    tideRange,
    astronomy: forecast.astronomy,
    tideExtremes: forecast.tideExtremes,
    hourly: forecast.hourly.map((h) => ({
      hour: h.hour,
      tide: h.tide,
      swell: h.swell,
      wind: h.wind,
      weather: { condition: h.weather.condition, precipitation: h.weather.precipitation },
      surfable: h.surfable,
    })),
  };
}
