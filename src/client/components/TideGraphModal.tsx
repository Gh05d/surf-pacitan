import { useEffect, useState } from "react";
import { TideGraph } from "./TideGraph";
import "./TideGraphModal.css";
import type { HourlyData, TideExtreme, AstronomyData } from "../../../shared/types";

interface TideGraphModalProps {
  open: boolean;
  onClose: () => void;
  hourly: HourlyData[];
  tideExtremes: TideExtreme[];
  astronomy: AstronomyData;
  isToday: boolean;
  date: string;
}

export function TideGraphModal({
  open,
  onClose,
  hourly,
  tideExtremes,
  astronomy,
  isToday,
  date,
}: TideGraphModalProps) {
  const [chartHeight, setChartHeight] = useState(() => Math.round(window.innerHeight * 0.55));

  useEffect(() => {
    if (!open) return;

    function recompute() {
      // Cap so the chart doesn't push the help text off-screen on tall viewports.
      const h = Math.min(Math.round(window.innerHeight * 0.6), 520);
      setChartHeight(h);
    }
    recompute();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", recompute);
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", recompute);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  // Stop touch events from bubbling to App's day-swipe handler.
  const stopTouch = (e: React.TouchEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="tide-modal-backdrop"
      onClick={onClose}
      onTouchStart={stopTouch}
      onTouchEnd={stopTouch}
      role="dialog"
      aria-modal="true"
      aria-label="Tide chart zoomed"
    >
      <div
        className="tide-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tide-modal-header">
          <div className="tide-modal-title">
            <span className="tide-modal-title-main">Tide</span>
            <span className="tide-modal-title-date">{date}</span>
          </div>
          <button
            type="button"
            className="tide-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="tide-modal-chart">
          <TideGraph
            hourly={hourly}
            tideExtremes={tideExtremes}
            astronomy={astronomy}
            isToday={isToday}
            enableZoom
            heightOverride={chartHeight}
            hideSpotBands
          />
        </div>

        <div className="tide-modal-hint">
          Pinch to zoom · drag with one finger to pan · tap “Reset zoom” to
          restore the full day.
        </div>
      </div>
    </div>
  );
}
