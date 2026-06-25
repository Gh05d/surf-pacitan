// Pure helpers for the SpotMap conditions overlay. Arrow points the travel
// direction (from + 180); labels carry the surfer "from" compass.
import type { SwellData, WindData } from "../shared/types";
import { degreesToCompass, getWindCategory } from "../shared/surfable";

export function travelBearing(fromDeg: number): number {
  return (((fromDeg + 180) % 360) + 360) % 360;
}

export function swellLabel(swell: SwellData): string {
  return `${degreesToCompass(swell.direction)} ${swell.height.toFixed(1)}m·${Math.round(swell.period)}s`;
}

export function windLabel(wind: WindData): string {
  return `${degreesToCompass(wind.direction)} ${Math.round(wind.speed)}km/h`;
}

const WIND_CATEGORY_COLOR: Record<string, string> = {
  offshore: "#2dd4a8",
  crossShore: "#f0a830",
  onshore: "#e06050",
};

export function windCategoryColor(windDirection: number, facingDirection: number): string {
  return WIND_CATEGORY_COLOR[getWindCategory(windDirection, facingDirection)];
}
