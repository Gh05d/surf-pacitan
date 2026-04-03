import type { ForecastDay, HourlyData } from "../../../shared/types";
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
            background: "#1e293b",
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
              background: "linear-gradient(90deg, #f59e0b, #fbbf24)",
              borderRadius: "3px",
            }}
          />
        </div>
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
