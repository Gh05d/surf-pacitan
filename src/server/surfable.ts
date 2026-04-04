import type { SurfableRating, SpotRatings } from "../shared/types";
import type { SpotThresholds } from "./config";
import { SURFABLE, SPOT_THRESHOLDS } from "./config";

interface SurfableInput {
  hour: number;
  tidePercent: number;
  tideRising: boolean;
  swellHeight: number;
  windSpeed: number;
  sunrise: string;
  sunset: string;
}

function isWithinDaylight(hour: number, sunrise: string, sunset: string): boolean {
  const sunriseHour = parseInt(sunrise.split(":")[0], 10);
  const sunsetHour = parseInt(sunset.split(":")[0], 10);
  return hour >= sunriseHour && hour < sunsetHour;
}

export function computeSurfable(input: SurfableInput, thresholds: SpotThresholds = SURFABLE): SurfableRating {
  const { hour, tidePercent, tideRising, swellHeight, windSpeed, sunrise, sunset } = input;

  if (!isWithinDaylight(hour, sunrise, sunset)) return "red";
  if (swellHeight < thresholds.SWELL_YELLOW_MIN) return "red";
  if (windSpeed > thresholds.WIND_YELLOW_MAX) return "red";
  if (tidePercent < thresholds.TIDE_YELLOW_MIN) return "red";

  // Falling tide is never green — sandbar beachbreaks need rising water
  if (!tideRising) return "yellow";

  const tideGreen = tidePercent >= thresholds.TIDE_GREEN_MIN;
  const swellGreen = swellHeight >= thresholds.SWELL_GREEN_MIN;
  const windGreen = windSpeed < thresholds.WIND_GREEN_MAX;

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
