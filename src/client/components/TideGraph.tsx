import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { HourlyData, TideExtreme, AstronomyData, SurfableRating } from "../../../shared/types";

interface TideGraphProps {
  hourly: HourlyData[];
  tideExtremes: TideExtreme[];
  astronomy: AstronomyData;
  isToday: boolean;
}

const RATING_COLORS: Record<SurfableRating, string> = {
  green: "rgba(45, 212, 168, 0.18)",
  yellow: "rgba(240, 168, 48, 0.18)",
  red: "rgba(224, 96, 80, 0.15)",
};

function parseHHmm(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h + m / 60;
}

export function TideGraph({ hourly, tideExtremes, astronomy, isToday }: TideGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!containerRef.current || hourly.length === 0) return;

    // Destroy any existing chart
    if (plotRef.current) {
      plotRef.current.destroy();
      plotRef.current = null;
    }

    const container = containerRef.current;
    const width = container.clientWidth || 340;
    const height = 200;

    // Build data arrays — x in seconds (hour * 3600), y = tide height
    const times = new Float64Array(hourly.map((h) => h.hour * 3600));
    const heights = new Float64Array(hourly.map((h) => h.tide.height));

    // Build a map from hour -> surfable rating for background bands
    const ratingByHour = new Map<number, SurfableRating>(hourly.map((h) => [h.hour, h.surfable]));

    const sunriseHour = parseHHmm(astronomy.sunrise);
    const sunsetHour = parseHHmm(astronomy.sunset);

    const opts: uPlot.Options = {
      width,
      height,
      scales: {
        x: {
          time: false,
          range: [0, 23 * 3600],
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
          // X axis — hours
          stroke: "#5a7a9a",
          grid: { stroke: "#132840", width: 1 },
          ticks: { stroke: "#1a3050" },
          incrs: [3 * 3600],
          values: (_u, splits) =>
            splits.map((s) => {
              const h = Math.round(s / 3600);
              return `${String(h).padStart(2, "0")}:00`;
            }),
        },
        {
          // Y axis — simplified High/Low
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
        {}, // x (time)
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

            // --- Background surfable zone bands ---
            for (let hour = 0; hour < 24; hour++) {
              const rating = ratingByHour.get(hour);
              if (!rating) continue;

              const xStart = u.valToPos(hour * 3600, "x", true);
              const xEnd = u.valToPos((hour + 1) * 3600, "x", true);
              const yTop = u.bbox.top;
              const yBot = u.bbox.top + u.bbox.height;

              ctx.fillStyle = RATING_COLORS[rating];
              ctx.fillRect(xStart, yTop, xEnd - xStart, yBot - yTop);
            }

            // --- Night overlay (before sunrise / after sunset) ---
            const nightColor = "rgba(4, 10, 20, 0.45)";
            const sunriseX = u.valToPos(sunriseHour * 3600, "x", true);
            const sunsetX = u.valToPos(sunsetHour * 3600, "x", true);
            const yTop = u.bbox.top;
            const yBot = u.bbox.top + u.bbox.height;

            ctx.fillStyle = nightColor;
            // Before sunrise
            ctx.fillRect(u.bbox.left, yTop, sunriseX - u.bbox.left, yBot - yTop);
            // After sunset
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
            for (const extreme of tideExtremes) {
              const [hStr, mStr] = extreme.time.split(":");
              const extremeSecs = (parseInt(hStr, 10) + parseInt(mStr, 10) / 60) * 3600;
              const ex = u.valToPos(extremeSecs, "x", true);
              const ey = u.valToPos(extreme.height, "y", true);

              if (ex < u.bbox.left || ex > u.bbox.left + u.bbox.width) continue;

              const isHigh = extreme.type === "high";
              ctx.save();
              ctx.fillStyle = isHigh ? "#2dd4a8" : "#e06050";
              ctx.font = "bold 11px system-ui, sans-serif";
              ctx.textAlign = "center";

              const label = isHigh ? "H" : "L";
              const heightLabel = `${extreme.height.toFixed(1)}m`;
              const offsetY = isHigh ? -18 : 22;

              ctx.fillText(label, ex, ey + offsetY);
              ctx.font = "10px system-ui, sans-serif";
              ctx.fillStyle = isHigh ? "rgba(45, 212, 168, 0.8)" : "rgba(224, 96, 80, 0.8)";
              ctx.fillText(heightLabel, ex, ey + offsetY + (isHigh ? -12 : 13));
              ctx.restore();
            }

            ctx.restore();
          },
        ],
      },
    };

    const plot = new uPlot(opts, [times, heights] as unknown as uPlot.AlignedData, container);
    plotRef.current = plot;

    // Resize handler
    const ro = new ResizeObserver(() => {
      if (plotRef.current && container) {
        plotRef.current.setSize({ width: container.clientWidth, height });
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
  }, [hourly, tideExtremes, astronomy, isToday]);

  return (
    <div
      style={{
        padding: "0.5rem 0.5rem 0.25rem",
        background: "var(--bg-card)",
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        margin: "0.5rem 0",
      }}
    >
      <div
        style={{
          color: "var(--text-dim)",
          fontSize: "0.7rem",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          padding: "0 0.5rem 0.25rem",
        }}
      >
        Tide
      </div>
      <div ref={containerRef} style={{ width: "100%" }} />
    </div>
  );
}
