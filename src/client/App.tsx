import { useState, useCallback, useRef } from "react";
import { useForecast } from "./hooks/useForecast";
import { Header } from "./components/Header";
import { DayView } from "./components/DayView";

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
    swipeStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const delta = swipeStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(delta) < 50) return;
    if (delta > 0) navigateTo(dayIndex + 1);
    else navigateTo(dayIndex - 1);
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
        <div style={{ color: "var(--text-dim)", fontSize: "1.1rem" }}>Loading forecast…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100dvh", gap: "1rem", padding: "1.5rem" }}>
        <div style={{ color: "var(--red)", fontSize: "1.1rem" }}>Failed to load forecast</div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.875rem" }}>{error}</div>
        <button
          onClick={refresh}
          style={{
            background: "var(--accent)",
            color: "var(--text)",
            border: "none",
            borderRadius: "8px",
            padding: "0.5rem 1.5rem",
            fontSize: "1rem",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
        <div style={{ color: "var(--text-dim)" }}>No forecast data available</div>
      </div>
    );
  }

  const currentDay = days[Math.min(dayIndex, days.length - 1)];
  const dayLabel = formatDayLabel(currentDay.date, dayIndex);

  return (
    <div
      style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <Header lastFetch={lastFetch} onRefresh={refresh} />

      {/* Day label + navigation */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1rem 0.25rem",
        }}
      >
        <button
          onClick={() => navigateTo(dayIndex - 1)}
          disabled={dayIndex === 0 || animating}
          style={{
            background: "none",
            border: "none",
            color: dayIndex === 0 ? "var(--border)" : "var(--text)",
            fontSize: "1.25rem",
            cursor: dayIndex === 0 ? "default" : "pointer",
            padding: "0.25rem 0.5rem",
          }}
          aria-label="Previous day"
        >
          ◀
        </button>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 600, fontSize: "1.1rem" }}>{dayLabel}</div>
          <div style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>{currentDay.date}</div>
        </div>

        <button
          onClick={() => navigateTo(dayIndex + 1)}
          disabled={dayIndex === days.length - 1 || animating}
          style={{
            background: "none",
            border: "none",
            color: dayIndex === days.length - 1 ? "var(--border)" : "var(--text)",
            fontSize: "1.25rem",
            cursor: dayIndex === days.length - 1 ? "default" : "pointer",
            padding: "0.25rem 0.5rem",
          }}
          aria-label="Next day"
        >
          ▶
        </button>
      </div>

      {/* Dot indicators */}
      <div style={{ display: "flex", justifyContent: "center", gap: "6px", padding: "0.5rem 0 0.25rem" }}>
        {days.map((_, i) => (
          <button
            key={i}
            onClick={() => navigateTo(i)}
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              border: "none",
              background: i === dayIndex ? "var(--text)" : "var(--border)",
              cursor: "pointer",
              padding: 0,
            }}
            aria-label={`Day ${i + 1}`}
          />
        ))}
      </div>

      {/* Main content */}
      <div style={{
        flex: 1,
        overflow: "hidden",
      }}>
        <div style={{
          transition: animating ? "transform 0.2s ease-out, opacity 0.2s ease-out" : "none",
          transform: slideDir === "left" ? "translateX(-30%)" : slideDir === "right" ? "translateX(30%)" : "translateX(0)",
          opacity: animating ? 0 : 1,
        }}>
          <DayView key={currentDay.date} day={currentDay} isToday={dayIndex === 0} />
        </div>
      </div>
    </div>
  );
}
