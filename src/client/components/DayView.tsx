import type { ForecastDay, HourlyData, SurfableRating } from "../../../shared/types";
import { TideGraph } from "./TideGraph";
import { Conditions } from "./Conditions";
import { Weather } from "./Weather";

interface DayViewProps {
  day: ForecastDay;
  isToday: boolean;
}

function parseHHmm(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

interface SurfWindow {
  start: number;
  end: number;
  rating: "green" | "yellow";
}

function findBestWindow(hourly: HourlyData[]): { windows: SurfWindow[]; reason: string } {
  // Group consecutive green/yellow hours into windows
  const windows: SurfWindow[] = [];
  let current: SurfWindow | null = null;

  for (const h of hourly) {
    if (h.surfable === "green" || h.surfable === "yellow") {
      const rating = h.surfable;
      if (current && (current.rating === rating || rating === "yellow" || current.rating === "yellow")) {
        // Extend window, upgrade rating if any hour is green
        current.end = h.hour + 1;
        if (rating === "green") current.rating = "green";
      } else {
        if (current) windows.push(current);
        current = { start: h.hour, end: h.hour + 1, rating };
      }
    } else {
      if (current) {
        windows.push(current);
        current = null;
      }
    }
  }
  if (current) windows.push(current);

  if (windows.length === 0) {
    // Figure out why
    const hasSwell = hourly.some((h) => h.swell.height >= 0.3);
    const hasLightWind = hourly.some((h) => h.wind.speed < 30);
    if (!hasSwell) return { windows: [], reason: "No swell — flat conditions all day." };
    if (!hasLightWind) return { windows: [], reason: "Too much wind — blown out all day." };
    return { windows: [], reason: "Low tide during daylight hours — sandbar too shallow." };
  }

  return { windows, reason: "" };
}

function formatWindow(w: SurfWindow): string {
  return `${String(w.start).padStart(2, "0")}:00–${String(w.end).padStart(2, "0")}:00`;
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
  const { windows, reason } = findBestWindow(day.hourly);

  const sunriseMin = parseHHmm(day.astronomy.sunrise);
  const sunsetMin = parseHHmm(day.astronomy.sunset);
  const totalDaylight = sunsetMin - sunriseMin;

  // Position as percentage of the 24h day
  const sunrisePercent = (sunriseMin / (24 * 60)) * 100;
  const sunsetPercent = (sunsetMin / (24 * 60)) * 100;
  const daylightWidth = sunsetPercent - sunrisePercent;

  return (
    <div style={{ paddingBottom: "1.5rem" }}>
      {/* Astronomy bar */}
      <div style={{ padding: "0.75rem 1rem 0.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-dim)", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
          <span>Sunrise {day.astronomy.sunrise}</span>
          <span>{Math.floor(totalDaylight / 60)}h {totalDaylight % 60}m daylight</span>
          <span>Sunset {day.astronomy.sunset}</span>
        </div>
        {/* Visual daylight bar */}
        <div
          style={{
            position: "relative",
            height: "6px",
            background: "#0f2035",
            borderRadius: "3px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: `${sunrisePercent}%`,
              width: `${daylightWidth}%`,
              height: "100%",
              background: "linear-gradient(90deg, #d9534f, #f59e42, #f0a830)",
              borderRadius: "3px",
            }}
          />
        </div>
      </div>

      {/* Best window recommendation */}
      <div style={{
        margin: "0 1rem 0.25rem",
        padding: "0.65rem 0.75rem",
        background: windows.length > 0 ? "var(--green-bg)" : "var(--red-bg)",
        border: `1px solid ${windows.length > 0 ? "var(--green)" : "var(--red)"}`,
        borderRadius: "8px",
        fontSize: "0.85rem",
        lineHeight: 1.5,
      }}>
        {windows.length > 0 ? (
          <>
            <div style={{ fontWeight: 700, color: "var(--green)", marginBottom: "0.15rem" }}>
              {windows.some((w) => w.rating === "green") ? "Best window" : "Possible window"}
            </div>
            <div>
              {windows.map((w, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <strong>{formatWindow(w)}</strong>
                </span>
              ))}
            </div>
            <div style={{ color: "var(--text-dim)", fontSize: "0.78rem", marginTop: "0.2rem" }}>
              Rising tide with enough water over the sandbar.{" "}
              {windows.some((w) => w.rating === "green") ? "Good swell and light wind." : "Marginal conditions."}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 700, color: "var(--red)", marginBottom: "0.15rem" }}>
              No surf window
            </div>
            <div style={{ color: "var(--text-dim)", fontSize: "0.78rem" }}>
              {reason}
            </div>
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
        <>
          <Conditions swell={activeHourly.swell} wind={activeHourly.wind} />
          <Weather weather={activeHourly.weather} />
        </>
      ) : (
        <div style={{ color: "var(--text-dim)", textAlign: "center", padding: "1rem" }}>
          No hourly data available
        </div>
      )}
    </div>
  );
}
