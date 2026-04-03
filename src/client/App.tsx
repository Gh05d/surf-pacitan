import { useState, useCallback, useRef } from "react";
import { useForecast } from "./hooks/useForecast";
import { Header } from "./components/Header";
import { DayView } from "./components/DayView";
import { SpotMap } from "./components/SpotMap";
import "./App.css";

function formatDayLabel(dateStr: string, index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  // e.g. "Tuesday, Apr 5"
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export function App() {
  const { days, lastFetch, loading, error, refresh } = useForecast();
  const [dayIndex, setDayIndex] = useState(0);
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const [animating, setAnimating] = useState(false);
  const swipeStartX = useRef(0);

  function navigateTo(newIndex: number) {
    if (newIndex === dayIndex || newIndex < 0 || newIndex >= days.length || animating) return;
    setSlideDir(newIndex > dayIndex ? "left" : "right");
    setAnimating(true);
    setTimeout(() => {
      setDayIndex(newIndex);
      setSlideDir(null);
      setAnimating(false);
    }, 200);
  }

  function handleTouchStart(e: React.TouchEvent) {
    // Ignore touches inside the map
    if ((e.target as HTMLElement).closest(".spot-map")) return;
    swipeStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    // Ignore touches inside the map
    if ((e.target as HTMLElement).closest(".spot-map")) return;
    const delta = swipeStartX.current - e.changedTouches[0].clientX;
    swipeStartX.current = 0;
    if (Math.abs(delta) < 50) return;
    if (delta > 0) navigateTo(dayIndex + 1);
    else navigateTo(dayIndex - 1);
  }

  if (loading) {
    return (
      <div className="app-loading">
        <div className="app-loading-text">Loading forecast…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-error">
        <div className="app-error-title">Failed to load forecast</div>
        <div className="app-error-detail">{error}</div>
        <button onClick={refresh} className="app-retry-btn">
          Retry
        </button>
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <div className="app-empty">
        <div className="app-empty-text">No forecast data available</div>
      </div>
    );
  }

  const currentDay = days[Math.min(dayIndex, days.length - 1)];
  const dayLabel = formatDayLabel(currentDay.date, dayIndex);

  return (
    <div
      className="app-root"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <Header lastFetch={lastFetch} onRefresh={refresh} />

      {/* Day label + navigation */}
      <div className="day-nav">
        <button
          onClick={() => navigateTo(dayIndex - 1)}
          disabled={dayIndex === 0 || animating}
          className="day-nav-btn"
          aria-label="Previous day"
        >
          ◀
        </button>

        <div className="day-nav-label">
          <div className="day-nav-name">{dayLabel}</div>
          <div className="day-nav-date">{currentDay.date}</div>
        </div>

        <button
          onClick={() => navigateTo(dayIndex + 1)}
          disabled={dayIndex === days.length - 1 || animating}
          className="day-nav-btn"
          aria-label="Next day"
        >
          ▶
        </button>
      </div>

      {/* Dot indicators */}
      <div className="day-dots">
        {days.map((_, i) => (
          <button
            key={i}
            onClick={() => navigateTo(i)}
            className={`day-dot${i === dayIndex ? " active" : ""}`}
            aria-label={`Day ${i + 1}`}
          />
        ))}
      </div>

      {/* Main content */}
      <div className="day-content-outer">
        <div style={{
          transition: animating ? "transform 0.2s ease-out, opacity 0.2s ease-out" : "none",
          transform: slideDir === "left" ? "translateX(-30%)" : slideDir === "right" ? "translateX(30%)" : "translateX(0)",
          opacity: animating ? 0 : 1,
        }}>
          <DayView key={currentDay.date} day={currentDay} isToday={dayIndex === 0} />
        </div>
      </div>
      <SpotMap />
    </div>
  );
}
