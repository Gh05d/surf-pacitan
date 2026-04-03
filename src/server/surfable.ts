import type { SurfableRating } from "../shared/types";
import { SURFABLE } from "./config";

interface SurfableInput {
  hour: number;
  tidePercent: number; // 0-100
  tideRising: boolean;
  swellHeight: number; // meters
  windSpeed: number; // km/h
  sunrise: string; // "HH:mm"
  sunset: string; // "HH:mm"
}

function isWithinDaylight(hour: number, sunrise: string, sunset: string): boolean {
  const sunriseHour = parseInt(sunrise.split(":")[0], 10);
  const sunsetHour = parseInt(sunset.split(":")[0], 10);
  return hour >= sunriseHour && hour < sunsetHour;
}

export function computeSurfable(input: SurfableInput): SurfableRating {
  const { hour, tidePercent, tideRising, swellHeight, windSpeed, sunrise, sunset } = input;

  // Red: hard no-go conditions
  if (!isWithinDaylight(hour, sunrise, sunset)) return "red";
  if (swellHeight < SURFABLE.SWELL_YELLOW_MIN) return "red";
  if (windSpeed > SURFABLE.WIND_YELLOW_MAX) return "red";
  if (tidePercent < SURFABLE.TIDE_YELLOW_MIN) return "red";

  // Check if tide is in green zone
  const tideGreen =
    (tideRising && tidePercent >= SURFABLE.TIDE_GREEN_MIN) ||
    (!tideRising && tidePercent >= SURFABLE.TIDE_GREEN_FALLING_MIN);

  const swellGreen = swellHeight >= SURFABLE.SWELL_GREEN_MIN;
  const windGreen = windSpeed < SURFABLE.WIND_GREEN_MAX;

  // Green: all conditions met
  if (tideGreen && swellGreen && windGreen) return "green";

  // Yellow: everything else that passed the red gate
  return "yellow";
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
