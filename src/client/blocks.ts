// Pure time-block helpers shared by App, ConditionsPanel, and SpotMap.
// Extracted from ConditionsPanel so they can be unit-tested and reused.
import type { HourlyData, AstronomyData, SwellData, WindData, WeatherData } from "../shared/types";

export interface TimeBlock {
  start: number;
  end: number;
  label: string;
  hours: HourlyData[];
}

export function buildDaylightBlocks(hourly: HourlyData[], astronomy: AstronomyData): TimeBlock[] {
  const sunriseHour = parseInt(astronomy.sunrise.split(":")[0], 10);
  const sunsetHour = parseInt(astronomy.sunset.split(":")[0], 10);

  const blocks: TimeBlock[] = [];
  for (let start = 0; start < 24; start += 3) {
    const end = start + 3;
    if (end <= sunriseHour || start >= sunsetHour) continue;
    const hours = hourly.filter((x) => x.hour >= start && x.hour < end);
    if (hours.length === 0) continue;
    blocks.push({
      start,
      end,
      label: `${String(start).padStart(2, "0")}:00 – ${String(end).padStart(2, "0")}:00`,
      hours,
    });
  }
  return blocks;
}

function windCategory(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d >= 315 || d <= 45) return "offshore";
  if (d >= 135 && d <= 225) return "onshore";
  return "crossShore";
}

function getModeWindDirection(hours: HourlyData[]): number {
  const counts: Record<string, number> = {};
  const firstDir: Record<string, number> = {};
  for (const x of hours) {
    const cat = windCategory(x.wind.direction);
    counts[cat] = (counts[cat] || 0) + 1;
    if (!(cat in firstDir)) firstDir[cat] = x.wind.direction;
  }
  const modeCat = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return firstDir[modeCat];
}

function getModeCondition(hours: HourlyData[]): string {
  const counts: Record<string, number> = {};
  for (const x of hours) counts[x.weather.condition] = (counts[x.weather.condition] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export function averageBlock(hours: HourlyData[]): { swell: SwellData; wind: WindData; weather: WeatherData } {
  const n = hours.length;
  const swell: SwellData = {
    height: Math.round((hours.reduce((s, x) => s + x.swell.height, 0) / n) * 10) / 10,
    period: Math.round(hours.reduce((s, x) => s + x.swell.period, 0) / n),
    direction: hours[Math.floor(n / 2)].swell.direction,
  };
  const wind: WindData = {
    speed: Math.round((hours.reduce((s, x) => s + x.wind.speed, 0) / n) * 10) / 10,
    gusts: Math.round(Math.max(...hours.map((x) => x.wind.gusts))),
    direction: getModeWindDirection(hours),
  };
  const weather: WeatherData = {
    temp: Math.round(hours.reduce((s, x) => s + x.weather.temp, 0) / n),
    condition: getModeCondition(hours),
    precipitation: Math.round((hours.reduce((s, x) => s + x.weather.precipitation, 0) / n) * 10) / 10,
  };
  return { swell, wind, weather };
}

// Earliest hour where any spot is green, else earliest where any spot is yellow,
// else null. Matches DayView's "earliest primary-window start" for the default block.
export function bestWindowStartHour(hourly: HourlyData[]): number | null {
  const green = hourly.find((x) => Object.values(x.surfable).includes("green"));
  if (green) return green.hour;
  const yellow = hourly.find((x) => Object.values(x.surfable).includes("yellow"));
  return yellow ? yellow.hour : null;
}

export function getDefaultBlockIndex(
  blocks: TimeBlock[],
  isToday: boolean,
  bestWindowStart: number | null,
  nowHour: number,
): number {
  if (blocks.length === 0) return 0;
  if (isToday) {
    const idx = blocks.findIndex((b) => nowHour >= b.start && nowHour < b.end);
    return idx >= 0 ? idx : nowHour >= blocks[blocks.length - 1].end ? blocks.length - 1 : 0;
  }
  if (bestWindowStart !== null) {
    const idx = blocks.findIndex((b) => bestWindowStart >= b.start && bestWindowStart < b.end);
    return idx >= 0 ? idx : 0;
  }
  const middayIdx = blocks.findIndex((b) => b.start <= 12 && b.end > 12);
  return middayIdx >= 0 ? middayIdx : Math.floor(blocks.length / 2);
}
