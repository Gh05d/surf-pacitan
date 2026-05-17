import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import "./TideGraph.css";
import type { HourlyData, TideExtreme, AstronomyData, SurfableRating } from "../../../shared/types";

interface TideGraphProps {
  hourly: HourlyData[];
  tideExtremes: TideExtreme[];
  astronomy: AstronomyData;
  isToday: boolean;
  /** Enable pinch-zoom + 1-finger pan. Only used in the modal. */
  enableZoom?: boolean;
  /** Override automatic height calculation (px). */
  heightOverride?: number;
  /** When set, clicking the chart calls this (used for "tap to expand"). */
  onExpand?: () => void;
}

const RATING_COLORS: Record<SurfableRating, string> = {
  green: "rgba(45, 212, 168, 0.18)",
  yellow: "rgba(240, 168, 48, 0.18)",
  red: "rgba(224, 96, 80, 0.15)",
};

const FULL_MIN = 0;
const FULL_MAX = 23 * 3600;
const MIN_RANGE = 60 * 60; // 1h minimum visible range

function parseHHmm(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h + m / 60;
}

function formatSecHHmm(s: number): string {
  const totalMin = Math.round(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function TideGraph({
  hourly,
  tideExtremes,
  astronomy,
  isToday,
  enableZoom = false,
  heightOverride,
  onExpand,
}: TideGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const isZoomedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || hourly.length === 0) return;

    if (plotRef.current) {
      plotRef.current.destroy();
      plotRef.current = null;
    }

    const container = containerRef.current;
    const width = container.clientWidth || 340;
    const height =
      heightOverride ?? (window.innerWidth >= 1024 ? 320 : window.innerWidth >= 768 ? 260 : 200);

    const times = new Float64Array(hourly.map((h) => h.hour * 3600));
    const heights = new Float64Array(hourly.map((h) => h.tide.height));

    const sunriseHour = parseHHmm(astronomy.sunrise);
    const sunsetHour = parseHHmm(astronomy.sunset);

    const opts: uPlot.Options = {
      width,
      height,
      scales: {
        x: {
          time: false,
          // Function form (not static array) so setScale() can override at runtime.
          // Static arrays are wrapped via fnOrSelf and always return the original bounds,
          // silently reverting any setScale call.
          range: (_u, dataMin, dataMax) =>
            dataMin != null && dataMax != null ? [dataMin, dataMax] : [FULL_MIN, FULL_MAX],
        },
        y: {
          range: (_, dataMin, dataMax) => {
            const pad = 0.2;
            return [dataMin - pad, dataMax + pad];
          },
        },
      },
      axes: [
        {
          stroke: "#5a7a9a",
          grid: { stroke: "#132840", width: 1 },
          ticks: { stroke: "#1a3050" },
          splits: (_u, _axisIdx, scaleMin, scaleMax) => {
            const range = scaleMax - scaleMin;
            let stepSec: number;
            if (range >= 12 * 3600) stepSec = 3 * 3600;
            else if (range >= 6 * 3600) stepSec = 2 * 3600;
            else if (range >= 3 * 3600) stepSec = 3600;
            else if (range >= 90 * 60) stepSec = 30 * 60;
            else stepSec = 15 * 60;
            const start = Math.ceil(scaleMin / stepSec) * stepSec;
            const splits: number[] = [];
            for (let s = start; s <= scaleMax + 0.5; s += stepSec) splits.push(s);
            return splits;
          },
          values: (_u, splits) => splits.map(formatSecHHmm),
        },
        {
          stroke: "#5a7a9a",
          grid: { stroke: "#1a3050", width: 1 },
          ticks: { show: false },
          values: (_u, splits) => {
            if (splits.length < 2) return splits.map(() => "");
            const min = Math.min(...splits);
            const max = Math.max(...splits);
            return splits.map((s) => {
              if (s === max) return "High";
              if (s === min) return "Low";
              return "";
            });
          },
          size: 36,
        },
      ],
      series: [
        {},
        {
          label: "Tide",
          stroke: "#38bdf8",
          width: 2,
          fill: "rgba(56, 189, 248, 0.06)",
          spanGaps: false,
        },
      ],
      cursor: { show: false },
      legend: { show: false },
      hooks: {
        draw: [
          (u) => {
            const ctx = u.ctx;
            ctx.save();

            // --- Night overlay ---
            const nightColor = "rgba(4, 10, 20, 0.45)";
            const sunriseX = u.valToPos(sunriseHour * 3600, "x", true);
            const sunsetX = u.valToPos(sunsetHour * 3600, "x", true);
            const yTop = u.bbox.top;
            const yBot = u.bbox.top + u.bbox.height;

            ctx.fillStyle = nightColor;
            ctx.fillRect(u.bbox.left, yTop, sunriseX - u.bbox.left, yBot - yTop);
            ctx.fillRect(sunsetX, yTop, u.bbox.left + u.bbox.width - sunsetX, yBot - yTop);

            // --- "Now" vertical dashed line ---
            if (isToday) {
              const now = new Date();
              const nowSecs = (now.getHours() + now.getMinutes() / 60) * 3600;
              const nowX = u.valToPos(nowSecs, "x", true);
              if (nowX >= u.bbox.left && nowX <= u.bbox.left + u.bbox.width) {
                ctx.save();
                ctx.strokeStyle = "rgba(232, 223, 208, 0.7)";
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(nowX, yTop);
                ctx.lineTo(nowX, yBot);
                ctx.stroke();
                ctx.restore();
              }
            }

            // --- H/L tide extreme labels ---
            // Scale label size with chart height so the modal view (≥320px)
            // gets large, readable labels.
            const big = u.bbox.height >= 320;
            const mainFontPx = big ? 22 : 14;
            const subFontPx = big ? 20 : 12;
            const labelOffset = big ? 22 : 14;
            const subOffset = big ? 26 : 16;

            for (const extreme of tideExtremes) {
              const [hStr, mStr] = extreme.time.split(":");
              const extremeSecs = (parseInt(hStr, 10) + parseInt(mStr, 10) / 60) * 3600;
              const ex = u.valToPos(extremeSecs, "x", true);
              const ey = u.valToPos(extreme.height, "y", true);

              if (ex < u.bbox.left || ex > u.bbox.left + u.bbox.width) continue;

              const isHigh = extreme.type === "high";
              ctx.save();
              ctx.fillStyle = isHigh ? "#2dd4a8" : "#e06050";
              ctx.font = `bold ${mainFontPx}px system-ui, sans-serif`;
              ctx.textAlign = "center";

              const label = isHigh ? "High" : "Low";
              const timeLabel = extreme.time;
              const offsetY = isHigh ? -labelOffset : labelOffset + 4;

              ctx.fillText(label, ex, ey + offsetY);
              ctx.font = `${subFontPx}px system-ui, sans-serif`;
              ctx.fillStyle = isHigh ? "rgba(45, 212, 168, 0.85)" : "rgba(224, 96, 80, 0.85)";
              ctx.fillText(timeLabel, ex, ey + offsetY + (isHigh ? -subOffset : subOffset));
              ctx.restore();
            }

            ctx.restore();
          },
        ],
      },
    };

    const plot = new uPlot(opts, [times, heights] as unknown as uPlot.AlignedData, container);
    plotRef.current = plot;

    // Touch gestures only attach when zoom is enabled (i.e., inside the modal).
    if (!enableZoom) {
      const ro = new ResizeObserver(() => {
        if (plotRef.current && container) {
          const newHeight =
            heightOverride ??
            (window.innerWidth >= 1024 ? 320 : window.innerWidth >= 768 ? 260 : 200);
          plotRef.current.setSize({ width: container.clientWidth, height: newHeight });
        }
      });
      ro.observe(container);

      return () => {
        ro.disconnect();
        if (plotRef.current) {
          plotRef.current.destroy();
          plotRef.current = null;
        }
      };
    }

    // --- Touch gestures: pinch-zoom, pan-while-zoomed ---
    let pinchStartDist = 0;
    let pinchStartMin = FULL_MIN;
    let pinchStartMax = FULL_MAX;
    let panStartX = 0;
    let panStartMin = FULL_MIN;
    let panStartMax = FULL_MAX;
    let panActive = false;

    const updateZoomState = (min: number, max: number) => {
      plot.setScale("x", { min, max });
      const zoomed = !(min <= FULL_MIN + 0.5 && max >= FULL_MAX - 0.5);
      if (zoomed !== isZoomedRef.current) {
        isZoomedRef.current = zoomed;
        setIsZoomed(zoomed);
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Don't stopPropagation: let App see the 2nd-finger touchstart so it can mark multi-touch
        // and skip its swipe-detection logic on the eventual touchend.
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        pinchStartDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        pinchStartMin = plot.scales.x.min ?? FULL_MIN;
        pinchStartMax = plot.scales.x.max ?? FULL_MAX;
        panActive = false;
      } else if (e.touches.length === 1 && isZoomedRef.current) {
        // Hide single-finger pan from App's swipe handler.
        e.stopPropagation();
        panStartX = e.touches[0].clientX;
        panStartMin = plot.scales.x.min ?? FULL_MIN;
        panStartMax = plot.scales.x.max ?? FULL_MAX;
        panActive = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStartDist > 0) {
        e.preventDefault();
        e.stopPropagation();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        if (dist <= 0) return;
        const ratio = pinchStartDist / dist;
        const center = (t1.clientX + t2.clientX) / 2;
        const rect = plot.over.getBoundingClientRect();
        const centerFrac = Math.max(0, Math.min(1, (center - rect.left) / rect.width));
        const range = pinchStartMax - pinchStartMin;
        let newRange = range * ratio;
        newRange = Math.max(MIN_RANGE, Math.min(FULL_MAX - FULL_MIN, newRange));
        const centerVal = pinchStartMin + range * centerFrac;
        let newMin = centerVal - newRange * centerFrac;
        let newMax = centerVal + newRange * (1 - centerFrac);
        if (newMin < FULL_MIN) {
          newMax += FULL_MIN - newMin;
          newMin = FULL_MIN;
        }
        if (newMax > FULL_MAX) {
          newMin -= newMax - FULL_MAX;
          newMax = FULL_MAX;
        }
        newMin = Math.max(FULL_MIN, newMin);
        newMax = Math.min(FULL_MAX, newMax);
        updateZoomState(newMin, newMax);
      } else if (e.touches.length === 1 && panActive) {
        e.preventDefault();
        e.stopPropagation();
        const dx = e.touches[0].clientX - panStartX;
        const rect = plot.over.getBoundingClientRect();
        const range = panStartMax - panStartMin;
        const dval = -(dx / rect.width) * range;
        let newMin = panStartMin + dval;
        let newMax = panStartMax + dval;
        if (newMin < FULL_MIN) {
          newMax += FULL_MIN - newMin;
          newMin = FULL_MIN;
        }
        if (newMax > FULL_MAX) {
          newMin -= newMax - FULL_MAX;
          newMax = FULL_MAX;
        }
        newMin = Math.max(FULL_MIN, newMin);
        newMax = Math.min(FULL_MAX, newMax);
        updateZoomState(newMin, newMax);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchStartDist = 0;
      if (e.touches.length === 0) {
        panActive = false;
        panStartX = 0;
      }
    };

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd);
    container.addEventListener("touchcancel", onTouchEnd);

    const ro = new ResizeObserver(() => {
      if (plotRef.current && container) {
        const newHeight =
          heightOverride ??
          (window.innerWidth >= 1024 ? 320 : window.innerWidth >= 768 ? 260 : 200);
        plotRef.current.setSize({ width: container.clientWidth, height: newHeight });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }
    };
  }, [hourly, tideExtremes, astronomy, isToday, enableZoom, heightOverride]);

  function resetZoom() {
    if (plotRef.current) {
      plotRef.current.setScale("x", { min: FULL_MIN, max: FULL_MAX });
    }
    isZoomedRef.current = false;
    setIsZoomed(false);
  }

  const containerClass = `tide-graph-container${enableZoom ? " zoom-enabled" : ""}`;

  function handleContainerClick() {
    if (onExpand) onExpand();
  }

  return (
    <div className={`tide-graph${onExpand ? " expandable" : ""}`}>
      <div className="tide-graph-header">
        <div className="tide-graph-label">Tide</div>
        {enableZoom && isZoomed && (
          <button
            type="button"
            className="tide-graph-reset"
            onClick={resetZoom}
            aria-label="Reset zoom"
          >
            Reset zoom
          </button>
        )}
        {onExpand && (
          <button
            type="button"
            className="tide-graph-expand"
            onClick={onExpand}
            aria-label="Expand chart"
          >
            ⤢ Zoom
          </button>
        )}
      </div>
      <div
        ref={containerRef}
        className={containerClass}
        onClick={onExpand ? handleContainerClick : undefined}
        role={onExpand ? "button" : undefined}
        tabIndex={onExpand ? 0 : undefined}
      />
    </div>
  );
}
