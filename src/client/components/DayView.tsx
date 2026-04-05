import type { ForecastDay, HourlyData, SurfableRating, SpotName } from "../../../shared/types";
import { TideGraph } from "./TideGraph";
import { Conditions } from "./Conditions";
import { Weather } from "./Weather";
import "./DayView.css";

interface DayViewProps {
  day: ForecastDay;
  isToday: boolean;
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

const SPOT_INFO: { key: SpotName; label: string }[] = [
  { key: "telengRia", label: "Teleng Ria" },
  { key: "pancer", label: "Pancer" },
  { key: "pancerDoor", label: "Pancer Door" },
];

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

function findSpotWindows(hourly: HourlyData[]): { windows: SpotWindow[]; reason: string } {
  // Try green windows first
  let allWindows: SpotWindow[] = [];
  for (const { key, label } of SPOT_INFO) {
    allWindows.push(...findWindowsForRating(hourly, key, label, "green"));
  }

  // If no green, fall back to yellow
  if (allWindows.length === 0) {
    for (const { key, label } of SPOT_INFO) {
      allWindows.push(...findWindowsForRating(hourly, key, label, "yellow"));
    }
  }

  if (allWindows.length === 0) {
    const hasSwell = hourly.some((h) => h.swell.height >= 0.2);
    const hasLightWind = hourly.some((h) => h.wind.speed < 20);
    if (!hasSwell) return { windows: [], reason: "No swell — flat conditions all day." };
    if (!hasLightWind) return { windows: [], reason: "Too much wind — blown out all day." };
    return { windows: [], reason: "Conditions not aligned — check tide, wind direction, and swell." };
  }

  return { windows: allWindows, reason: "" };
}

function formatWindow(start: number, end: number): string {
  return `${String(start).padStart(2, "0")}:00–${String(end).padStart(2, "0")}:00`;
}

function getActiveHourly(day: ForecastDay, isToday: boolean): HourlyData | null {
  if (day.hourly.length === 0) return null;

  if (isToday) {
    const currentHour = new Date().getHours();
    const match = day.hourly.find((h) => h.hour === currentHour);
    if (match) return match;
    // Fall back to closest hour
    return day.hourly.reduce((prev, curr) =>
      Math.abs(curr.hour - currentHour) < Math.abs(prev.hour - currentHour) ? curr : prev
    );
  }

  // For future days, use midday (12:00) or closest
  const middayMatch = day.hourly.find((h) => h.hour === 12);
  if (middayMatch) return middayMatch;
  return day.hourly.reduce((prev, curr) =>
    Math.abs(curr.hour - 12) < Math.abs(prev.hour - 12) ? curr : prev
  );
}

export function DayView({ day, isToday }: DayViewProps) {
  const activeHourly = getActiveHourly(day, isToday);
  const { windows, reason } = findSpotWindows(day.hourly);

  const sunriseMin = parseHHmm(day.astronomy.sunrise);
  const sunsetMin = parseHHmm(day.astronomy.sunset);
  const totalDaylight = sunsetMin - sunriseMin;

  // Position as percentage of the 24h day
  const sunrisePercent = (sunriseMin / (24 * 60)) * 100;
  const sunsetPercent = (sunsetMin / (24 * 60)) * 100;
  const daylightWidth = sunsetPercent - sunrisePercent;

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

      {/* Best window recommendation */}
      <div className={`surf-window ${windows.length > 0 ? "go" : "nogo"}`}>
        {windows.length > 0 ? (
          <>
            <div className="surf-window-title">
              {windows.some((w) => w.rating === "green") ? "Best windows" : "Possible windows"}
            </div>
            <div className="surf-window-spots">
              {SPOT_INFO.map(({ key, label }) => {
                const spotWindows = windows.filter((w) => w.spotKey === key);
                if (spotWindows.length === 0) return null;
                return (
                  <div key={key} className="surf-window-spot-row">
                    <span className="surf-window-spot-name">🏄 {label}</span>
                    <span className="surf-window-spot-times">
                      {spotWindows.map((w, i) => (
                        <span key={i}>{i > 0 && ", "}{formatWindow(w.start, w.end)}</span>
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="surf-window-note">
              Rising tide + favorable wind direction.
            </div>
          </>
        ) : (
          <>
            <div className="surf-window-title">No surf window</div>
            <div className="surf-window-note">{reason}</div>
          </>
        )}
      </div>

      {/* Tide chart */}
      <TideGraph
        hourly={day.hourly}
        tideExtremes={day.tideExtremes}
        astronomy={day.astronomy}
        isToday={isToday}
      />

      {/* Conditions and weather */}
      {activeHourly ? (
        <div className="conditions-weather-row">
          <Conditions swell={activeHourly.swell} wind={activeHourly.wind} />
          <Weather weather={activeHourly.weather} />
        </div>
      ) : (
        <div className="no-hourly">No hourly data available</div>
      )}
    </div>
  );
}
