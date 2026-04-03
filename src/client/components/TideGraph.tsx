import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import "./TideGraph.css";
import type { HourlyData, TideExtreme, AstronomyData, SurfableRating, SpotName } from "../../../shared/types";

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

const SPOT_LABELS: { key: SpotName; label: string }[] = [
  { key: "telengRia", label: "Teleng Ria" },
  { key: "pancer", label: "Pancer" },
  { key: "pancerDoor", label: "Pancer Door" },
];

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
    const bandSpace = 60; // space for 3 spot bands below X-axis
    const chartHeight = window.innerWidth >= 1024 ? 320 : window.innerWidth >= 768 ? 260 : 200;
    const height = chartHeight + bandSpace;

    // Build data arrays — x in seconds (hour * 3600), y = tide height
    const times = new Float64Array(hourly.map((h) => h.hour * 3600));
    const heights = new Float64Array(hourly.map((h) => h.tide.height));

    // Build a map from hour -> surfable rating for background bands
    const ratingByHour = new Map<number, SurfableRating>(hourly.map((h) => [h.hour, h.surfable.pancerDoor]));

    const sunriseHour = parseHHmm(astronomy.sunrise);
    const sunsetHour = parseHHmm(astronomy.sunset);

    const opts: uPlot.Options = {
      width,
      height,
      padding: [16, 8, bandSpace, 8],
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
          splits: () => [0, 3, 6, 9, 12, 15, 18, 21].map((h) => h * 3600),
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
              ctx.font = "bold 14px system-ui, sans-serif";
              ctx.textAlign = "center";

              const label = isHigh ? "High" : "Low";
              const timeLabel = extreme.time;
              const offsetY = isHigh ? -14 : 18;

              ctx.fillText(label, ex, ey + offsetY);
              ctx.font = "12px system-ui, sans-serif";
              ctx.fillStyle = isHigh ? "rgba(45, 212, 168, 0.85)" : "rgba(224, 96, 80, 0.85)";
              ctx.fillText(timeLabel, ex, ey + offsetY + (isHigh ? -16 : 16));
              ctx.restore();
            }

            // --- Per-spot surfable bands (in padding area below X-axis) ---
            const bh = 14;
            const bg = 3;
            // Reset clipping so we can draw in the padding area
            ctx.restore();
            ctx.save();
            for (let si = 0; si < SPOT_LABELS.length; si++) {
              const spotKey = SPOT_LABELS[si].key;
              const bandY = (height - bandSpace + 8 + si * (bh + bg));

              // Label
              ctx.fillStyle = "#8b9bb4";
              ctx.font = `10px 'Outfit', system-ui, sans-serif`;
              ctx.textAlign = "right";
              ctx.fillText(SPOT_LABELS[si].label, u.bbox.left - 4, bandY + bh - 3);

              // Segments
              for (let hour = 0; hour < 24; hour++) {
                const entry = hourly.find((h) => h.hour === hour);
                if (!entry) continue;

                const rating = entry.surfable[spotKey];
                if (rating === "red") continue;

                const xStart = u.valToPos(hour * 3600, "x", true);
                const xEnd = u.valToPos((hour + 1) * 3600, "x", true);

                ctx.fillStyle = rating === "green" ? "rgba(45, 212, 168, 0.5)" : "rgba(240, 168, 48, 0.35)";
                ctx.beginPath();
                ctx.roundRect(xStart, bandY, xEnd - xStart, bh, 2);
                ctx.fill();
              }
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
        const newChartHeight = window.innerWidth >= 1024 ? 320 : window.innerWidth >= 768 ? 260 : 200;
        plotRef.current.setSize({ width: container.clientWidth, height: newChartHeight + bandSpace });
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
    <div className="tide-graph">
      <div className="tide-graph-label">Tide</div>
      <div ref={containerRef} className="tide-graph-container" />
    </div>
  );
}
