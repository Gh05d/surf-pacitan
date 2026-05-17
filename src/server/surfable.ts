import type { SurfableRating, SpotRatings } from "../shared/types";
import type { SpotThresholds } from "./config";
import { SURFABLE, SPOT_THRESHOLDS } from "./config";

interface SurfableInput {
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

function isWithinDaylight(hour: number, sunrise: string, sunset: string): boolean {
  const sunriseHour = parseInt(sunrise.split(":")[0], 10);
  const sunsetHour = parseInt(sunset.split(":")[0], 10);
  return hour >= sunriseHour && hour < sunsetHour;
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

export type WindCategory = "offshore" | "crossShore" | "onshore";

export function getWindCategory(windDirection: number, facingDirection: number): WindCategory {
  const raw = Math.abs(windDirection - facingDirection);
  const angleDiff = raw > 180 ? 360 - raw : raw;

  if (angleDiff < 60) return "onshore";
  if (angleDiff > 120) return "offshore";
  return "crossShore";
}

export function computeSurfable(input: SurfableInput, thresholds: SpotThresholds = SURFABLE): SurfableRating {
  const { hour, tidePercent, tideRising, swellHeight, windSpeed, windDirection, sunrise, sunset } = input;

  if (!isWithinDaylight(hour, sunrise, sunset)) return "red";
  if (swellHeight < thresholds.SWELL_YELLOW_MIN) return "red";
  if (tidePercent < thresholds.TIDE_YELLOW_MIN) return "red";

  const windCategory = getWindCategory(windDirection, thresholds.facingDirection);
  const windThresholds = thresholds.wind[windCategory];

  if (windSpeed > windThresholds.yellowMax) return "red";

  // Falling tide is never green — sandbar beachbreaks need rising water
  if (!tideRising) return "yellow";

  const tideGreen = tidePercent >= thresholds.TIDE_GREEN_MIN;
  const swellGreen = swellHeight >= thresholds.SWELL_GREEN_MIN;
  const windGreen = windSpeed <= windThresholds.greenMax;

  if (tideGreen && swellGreen && windGreen) return "green";

  return "yellow";
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
