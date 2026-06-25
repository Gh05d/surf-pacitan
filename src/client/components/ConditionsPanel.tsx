import { useState } from "react";
import type { HourlyData, AstronomyData } from "../../shared/types";
import type { ForecastDay, SpotName, SurfableRating } from "../../shared/types";
import { buildDaylightBlocks, averageBlock, getDefaultBlockIndex, type TimeBlock } from "../blocks";
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
    getDefaultBlockIndex(blocks, isToday, bestWindowStart, new Date().getHours())
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
          ⚠️ Close-out risk — long-period swell (~{swell.period}s); waves may
          jack up and close out at {closeoutLabels}.
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
