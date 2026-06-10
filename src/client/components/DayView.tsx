import { useState } from "react";
import type { ForecastDay, HourlyData, SpotName } from "../../../shared/types";
import { SPOT_DISPLAY } from "../../shared/spots";
import { SPOT_THRESHOLDS } from "../../shared/spot-config";
import type { SpotThresholds } from "../../shared/spot-config";
import {
  computeFactorBreakdown,
  describeLimitingFactor,
  moreSevereLimitingExample,
  surfableInputForHour,
  type LimitingFactor,
  type SurfableInput,
} from "../../shared/surfable";
import { TideGraph } from "./TideGraph";
import { TideGraphModal } from "./TideGraphModal";
import { ConditionsPanel } from "./ConditionsPanel";
import "./DayView.css";

interface DayViewProps {
  day: ForecastDay;
  isToday: boolean;
  onSpotInfo: (spot: SpotName) => void;
}

function parseHHmm(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

interface SpotWindow {
  spot: string;
  spotKey: SpotName;
  start: number;
  end: number;
  rating: "green" | "yellow";
}

function findWindowsForRating(hourly: HourlyData[], spotKey: SpotName, label: string, targetRating: "green" | "yellow"): SpotWindow[] {
  const windows: SpotWindow[] = [];
  let current: SpotWindow | null = null;

  for (const h of hourly) {
    if (h.surfable[spotKey] === targetRating) {
      if (current) {
        current.end = h.hour + 1;
      } else {
        current = { spot: label, spotKey, start: h.hour, end: h.hour + 1, rating: targetRating };
      }
    } else {
      if (current) {
        windows.push(current);
        current = null;
      }
    }
  }
  if (current) windows.push(current);
  return windows;
}

function findWindows(hourly: HourlyData[], targetRating: "green" | "yellow"): SpotWindow[] {
  const all: SpotWindow[] = [];
  for (const { key, label } of SPOT_DISPLAY) {
    all.push(...findWindowsForRating(hourly, key, label, targetRating));
  }
  return all;
}

function noWindowReason(hourly: HourlyData[]): string {
  const hasSwell = hourly.some((h) => h.swell.height >= 0.2);
  const hasLightWind = hourly.some((h) => h.wind.speed < 20);
  if (!hasSwell) return "No swell — flat conditions all day.";
  if (!hasLightWind) return "Too much wind — blown out all day.";
  return "Conditions not aligned — check tide, wind direction, and swell.";
}

// The dominant limiting factor across all hours of the given yellow windows —
// replaces the old hardcoded (and wrong) "Rising tide + favorable wind" note.
function limitingNote(day: ForecastDay, windows: SpotWindow[]): string | null {
  const counts = new Map<LimitingFactor, number>();
  const reps = new Map<LimitingFactor, { input: SurfableInput; thresholds: SpotThresholds }>();

  for (const w of windows) {
    const thresholds = SPOT_THRESHOLDS[w.spotKey];
    for (const h of day.hourly) {
      if (h.hour < w.start || h.hour >= w.end) continue;
      const input = surfableInputForHour(day, h);
      const breakdown = computeFactorBreakdown(input, thresholds);
      for (const factor of breakdown.limiting) {
        counts.set(factor, (counts.get(factor) ?? 0) + 1);
        const rep = reps.get(factor);
        if (!rep || moreSevereLimitingExample(factor, input, rep.input)) {
          reps.set(factor, { input, thresholds });
        }
      }
    }
  }

  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!dominant) return null;
  const rep = reps.get(dominant[0])!;
  return `Limited by ${describeLimitingFactor(dominant[0], rep.input, rep.thresholds)}.`;
}

function formatWindow(start: number, end: number): string {
  return `${String(start).padStart(2, "0")}:00–${String(end).padStart(2, "0")}:00`;
}

function SpotWindowRows({ windows, onSpotInfo }: { windows: SpotWindow[]; onSpotInfo: (spot: SpotName) => void }) {
  return (
    <div className="surf-window-spots">
      {SPOT_DISPLAY.map(({ key, label, abbr, emoji }) => {
        const spotWindows = windows.filter((w) => w.spotKey === key);
        if (spotWindows.length === 0) return null;
        return (
          <div key={key} className="surf-window-spot-row">
            <button className="surf-window-spot-name" onClick={() => onSpotInfo(key)}>
              🏄 {emoji} {label} ({abbr})
            </button>
            <span className="surf-window-spot-times">
              {spotWindows.map((w, i) => (
                <span key={i}>{i > 0 && ", "}{formatWindow(w.start, w.end)}</span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function DayView({ day, isToday, onSpotInfo }: DayViewProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const greenWindows = findWindows(day.hourly, "green");
  const allYellow = findWindows(day.hourly, "yellow");
  const hasGreen = greenWindows.length > 0;
  // With green windows present, yellow is secondary context — hide short
  // 1h slivers to keep the box calm. Without green, yellow IS the day.
  const yellowWindows = hasGreen ? allYellow.filter((w) => w.end - w.start >= 2) : allYellow;
  const hasAny = hasGreen || yellowWindows.length > 0;

  const yellowNote = yellowWindows.length > 0 ? limitingNote(day, yellowWindows) : null;

  const sunriseMin = parseHHmm(day.astronomy.sunrise);
  const sunsetMin = parseHHmm(day.astronomy.sunset);
  const totalDaylight = sunsetMin - sunriseMin;

  const sunrisePercent = (sunriseMin / (24 * 60)) * 100;
  const sunsetPercent = (sunsetMin / (24 * 60)) * 100;
  const daylightWidth = sunsetPercent - sunrisePercent;

  // Best window start hour for ConditionsPanel default
  const primaryWindows = hasGreen ? greenWindows : yellowWindows;
  const bestWindowStart = primaryWindows.length > 0 ? Math.min(...primaryWindows.map((w) => w.start)) : null;

  return (
    <div className="day-view">
      {/* Astronomy bar */}
      <div className="astronomy-bar">
        <div className="astronomy-times">
          <span>Sunrise {day.astronomy.sunrise}</span>
          <span>{Math.floor(totalDaylight / 60)}h {totalDaylight % 60}m daylight</span>
          <span>Sunset {day.astronomy.sunset}</span>
        </div>
        <div className="daylight-track">
          <div
            className="daylight-fill"
            style={{ left: `${sunrisePercent}%`, width: `${daylightWidth}%` }}
          />
          {isToday && (() => {
            const now = new Date();
            const nowMin = now.getHours() * 60 + now.getMinutes();
            const nowPercent = (nowMin / (24 * 60)) * 100;
            const isDark = nowMin < sunriseMin || nowMin > sunsetMin;
            return <div className="daylight-now" style={{ left: `${nowPercent}%` }}>{isDark ? "🌙" : "☀️"}</div>;
          })()}
        </div>
      </div>

      {/* Surf windows: green ("Best") prominent, yellow ("Possible") dimmed below */}
      <div className={`surf-window ${hasAny ? (hasGreen ? "go" : "marginal") : "nogo"}`}>
        {hasAny ? (
          <>
            {hasGreen && (
              <div className="surf-window-section">
                <div className="surf-window-title">Best windows</div>
                <SpotWindowRows windows={greenWindows} onSpotInfo={onSpotInfo} />
              </div>
            )}
            {yellowWindows.length > 0 && (
              <div className={`surf-window-section possible${hasGreen ? " dimmed" : ""}`}>
                <div className="surf-window-title">Possible windows</div>
                <SpotWindowRows windows={yellowWindows} onSpotInfo={onSpotInfo} />
                {yellowNote && <div className="surf-window-note">{yellowNote}</div>}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="surf-window-title">No surf window</div>
            <div className="surf-window-note">{noWindowReason(day.hourly)}</div>
          </>
        )}
      </div>

      {/* Tide chart */}
      <TideGraph
        hourly={day.hourly}
        tideExtremes={day.tideExtremes}
        astronomy={day.astronomy}
        isToday={isToday}
        onExpand={() => setModalOpen(true)}
      />

      {/* Conditions panel with time navigation */}
      <ConditionsPanel
        day={day}
        hourly={day.hourly}
        astronomy={day.astronomy}
        isToday={isToday}
        bestWindowStart={bestWindowStart}
        onSpotInfo={onSpotInfo}
      />

      <TideGraphModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        hourly={day.hourly}
        tideExtremes={day.tideExtremes}
        astronomy={day.astronomy}
        isToday={isToday}
        date={day.date}
      />
    </div>
  );
}
