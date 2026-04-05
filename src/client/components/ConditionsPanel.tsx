import { useState } from "react";
import type { HourlyData, SwellData, WindData, WeatherData, AstronomyData } from "../../../shared/types";
import { Conditions } from "./Conditions";
import { Weather } from "./Weather";
import "./ConditionsPanel.css";

interface ConditionsPanelProps {
  hourly: HourlyData[];
  astronomy: AstronomyData;
  isToday: boolean;
  bestWindowStart: number | null;
}

interface TimeBlock {
  start: number;
  end: number;
  label: string;
  hours: HourlyData[];
}

function buildDaylightBlocks(hourly: HourlyData[], astronomy: AstronomyData): TimeBlock[] {
  const sunriseHour = parseInt(astronomy.sunrise.split(":")[0], 10);
  const sunsetHour = parseInt(astronomy.sunset.split(":")[0], 10);

  const blocks: TimeBlock[] = [];
  for (let start = 0; start < 24; start += 3) {
    const end = start + 3;
    if (end <= sunriseHour || start >= sunsetHour) continue;

    const hours = hourly.filter((h) => h.hour >= start && h.hour < end);
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
  for (const h of hours) {
    const cat = windCategory(h.wind.direction);
    counts[cat] = (counts[cat] || 0) + 1;
    if (!(cat in firstDir)) firstDir[cat] = h.wind.direction;
  }
  const modeCat = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return firstDir[modeCat];
}

function getModeCondition(hours: HourlyData[]): string {
  const counts: Record<string, number> = {};
  for (const h of hours) {
    counts[h.weather.condition] = (counts[h.weather.condition] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function averageBlock(hours: HourlyData[]): { swell: SwellData; wind: WindData; weather: WeatherData } {
  const n = hours.length;

  const swell: SwellData = {
    height: Math.round((hours.reduce((s, h) => s + h.swell.height, 0) / n) * 10) / 10,
    period: Math.round(hours.reduce((s, h) => s + h.swell.period, 0) / n),
    direction: hours[Math.floor(n / 2)].swell.direction,
  };

  const wind: WindData = {
    speed: Math.round((hours.reduce((s, h) => s + h.wind.speed, 0) / n) * 10) / 10,
    gusts: Math.round(Math.max(...hours.map((h) => h.wind.gusts))),
    direction: getModeWindDirection(hours),
  };

  const weather: WeatherData = {
    temp: Math.round(hours.reduce((s, h) => s + h.weather.temp, 0) / n),
    condition: getModeCondition(hours),
    precipitation: Math.round((hours.reduce((s, h) => s + h.weather.precipitation, 0) / n) * 10) / 10,
  };

  return { swell, wind, weather };
}

function getDefaultBlockIndex(
  blocks: TimeBlock[],
  isToday: boolean,
  bestWindowStart: number | null
): number {
  if (isToday) {
    const currentHour = new Date().getHours();
    const idx = blocks.findIndex((b) => currentHour >= b.start && currentHour < b.end);
    // Past last block → show most recent; before first → show first
    return idx >= 0 ? idx : currentHour >= blocks[blocks.length - 1].end ? blocks.length - 1 : 0;
  }

  if (bestWindowStart !== null) {
    const idx = blocks.findIndex((b) => bestWindowStart >= b.start && bestWindowStart < b.end);
    return idx >= 0 ? idx : 0;
  }

  const middayIdx = blocks.findIndex((b) => b.start <= 12 && b.end > 12);
  return middayIdx >= 0 ? middayIdx : Math.floor(blocks.length / 2);
}

export function ConditionsPanel({ hourly, astronomy, isToday, bestWindowStart }: ConditionsPanelProps) {
  const blocks = buildDaylightBlocks(hourly, astronomy);
  const [blockIndex, setBlockIndex] = useState(() =>
    getDefaultBlockIndex(blocks, isToday, bestWindowStart)
  );

  if (blocks.length === 0) {
    return <div className="no-hourly">No conditions data available</div>;
  }

  const safeIndex = Math.min(blockIndex, blocks.length - 1);
  const currentBlock = blocks[safeIndex];
  const { swell, wind, weather } = averageBlock(currentBlock.hours);

  return (
    <div className="conditions-panel">
      <div className="conditions-panel-nav">
        <button
          className="conditions-panel-btn"
          onClick={() => setBlockIndex((i) => i - 1)}
          disabled={safeIndex === 0}
          aria-label="Previous time block"
        >
          ◀
        </button>
        <div className="conditions-panel-time">{currentBlock.label}</div>
        <button
          className="conditions-panel-btn"
          onClick={() => setBlockIndex((i) => i + 1)}
          disabled={safeIndex === blocks.length - 1}
          aria-label="Next time block"
        >
          ▶
        </button>
      </div>
      <Conditions swell={swell} wind={wind} />
      <Weather weather={weather} />
    </div>
  );
}
