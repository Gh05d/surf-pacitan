import { useState } from "react";
import type { HourlyData, SwellData, WindData, WeatherData, AstronomyData } from "../../../shared/types";
import type { ForecastDay, SpotName, SurfableRating } from "../../shared/types";
import { SPOT_DISPLAY } from "../../shared/spots";
import { SPOT_THRESHOLDS } from "../../shared/spot-config";
import type { SpotThresholds } from "../../shared/spot-config";
import {
  computeFactorBreakdown,
  describeLimitingFactor,
  minQuality,
  moreSevereLimitingExample,
  surfableInputForHour,
  type LimitingFactor,
  type SurfableInput,
} from "../../shared/surfable";
import { closeoutSpotsForHours } from "../../shared/closeout";
import { Conditions } from "./Conditions";
import { Weather } from "./Weather";
import "./ConditionsPanel.css";

interface ConditionsPanelProps {
  day: ForecastDay;
  hourly: HourlyData[];
  astronomy: AstronomyData;
  isToday: boolean;
  bestWindowStart: number | null;
  onSpotInfo: (spot: SpotName) => void;
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

// Per-spot rating + dominant limiting factor for one time block. The block
// color is the min of the CACHED ratings (display source of truth); the
// explanation is recomputed from the raw hourly data via the same shared
// logic the server rates with.
function spotBlockSummary(
  day: ForecastDay,
  hours: HourlyData[],
  spot: SpotName,
): { rating: SurfableRating; text: string } {
  const thresholds: SpotThresholds = SPOT_THRESHOLDS[spot];
  const rating = minQuality(hours.map((h) => h.surfable[spot]));
  if (rating === "green") return { rating, text: "all factors green" };

  const counts = new Map<LimitingFactor, number>();
  const reps = new Map<LimitingFactor, SurfableInput>();
  const collect = (subset: HourlyData[]) => {
    for (const h of subset) {
      const input = surfableInputForHour(day, h);
      const breakdown = computeFactorBreakdown(input, thresholds);
      for (const factor of breakdown.limiting) {
        counts.set(factor, (counts.get(factor) ?? 0) + 1);
        const rep = reps.get(factor);
        if (!rep || moreSevereLimitingExample(factor, input, rep)) reps.set(factor, input);
      }
    }
  };

  // Explain from the hours actually sitting at the block's level; if the
  // recompute disagrees with the cached colors (3h-refresh drift), fall back
  // to all hours rather than showing nothing.
  collect(hours.filter((h) => h.surfable[spot] === rating));
  if (counts.size === 0) collect(hours);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!dominant) {
    return { rating, text: rating === "red" ? "not surfable" : "marginal conditions" };
  }
  return { rating, text: describeLimitingFactor(dominant[0], reps.get(dominant[0])!, thresholds) };
}

export function ConditionsPanel({ day, hourly, astronomy, isToday, bestWindowStart, onSpotInfo }: ConditionsPanelProps) {
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

  const closeoutSpots = closeoutSpotsForHours(
    currentBlock.hours,
    SPOT_DISPLAY.map((s) => ({ id: s.key, closeout: SPOT_THRESHOLDS[s.key]?.closeout })),
  );
  const closeoutLabels = closeoutSpots
    .map((id) => SPOT_DISPLAY.find((s) => s.key === id)?.label ?? id)
    .join(", ");

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
      {closeoutSpots.length > 0 && (
        <div className="conditions-panel-closeout" role="note">
          ⚠️ Close-out risk — long-period swell (~{swell.period}s) on a low tide;
          waves may jack up and close out at {closeoutLabels}.
        </div>
      )}
      {/* Per-spot "why this color" rows for the selected block */}
      <div className="conditions-panel-spots">
        {SPOT_DISPLAY.map(({ key, abbr, emoji }) => {
          const summary = spotBlockSummary(day, currentBlock.hours, key);
          return (
            <button
              key={key}
              className="conditions-spot-row"
              onClick={() => onSpotInfo(key)}
              aria-label={`${abbr} spot details`}
            >
              <span className="conditions-spot-name">{emoji} {abbr}</span>
              <span className={`conditions-spot-dot ${summary.rating}`} />
              <span className="conditions-spot-reason">{summary.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
