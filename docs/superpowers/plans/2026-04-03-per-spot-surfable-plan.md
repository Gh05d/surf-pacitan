# Per-Spot Surfable Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show per-spot surfable windows on the tide graph (as horizontal bands below the chart) and in an expanded recommendation box, so users can see which spot works best at which time.

**Architecture:** Add per-spot threshold configs, extend `computeSurfable` to accept threshold overrides, change `HourlyData.surfable` from a single rating to a per-spot map, draw spot bands in TideGraph canvas, and update the DayView recommendation box.

**Tech Stack:** TypeScript, Canvas API (uPlot hooks), CSS

---

## File Map

```
Modified files:
├── src/shared/types.ts              # surfable → SpotRatings type
├── src/server/config.ts             # per-spot threshold configs
├── src/server/surfable.ts           # accept threshold param
├── src/server/cron.ts               # compute per-spot ratings
├── src/client/components/TideGraph.tsx  # draw spot bands below chart
├── src/client/components/TideGraph.css  # spot band label styles
├── src/client/components/DayView.tsx    # per-spot recommendation box
├── tests/surfable.test.ts           # update tests for new signature
```

---

## Task 1: Types + Config — Per-Spot Thresholds

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/server/config.ts`

- [ ] **Step 1: Update types**

In `/root/surf-pacitan/src/shared/types.ts`, replace the `surfable` field in `HourlyData`:

Change:
```ts
export type SurfableRating = "green" | "yellow" | "red";

export interface HourlyData {
  hour: number; // 0-23
  tide: TideData;
  swell: SwellData;
  wind: WindData;
  weather: WeatherData;
  surfable: SurfableRating;
}
```

To:
```ts
export type SurfableRating = "green" | "yellow" | "red";

export type SpotName = "telengRia" | "pancer" | "pancerDoor";

export type SpotRatings = Record<SpotName, SurfableRating>;

export interface HourlyData {
  hour: number; // 0-23
  tide: TideData;
  swell: SwellData;
  wind: WindData;
  weather: WeatherData;
  surfable: SpotRatings;
}
```

- [ ] **Step 2: Add per-spot thresholds to config**

In `/root/surf-pacitan/src/server/config.ts`, replace the `SURFABLE` constant:

```ts
export interface SpotThresholds {
  TIDE_GREEN_MIN: number;
  TIDE_GREEN_FALLING_MIN: number;
  TIDE_YELLOW_MIN: number;
  SWELL_GREEN_MIN: number;
  SWELL_YELLOW_MIN: number;
  WIND_GREEN_MAX: number;
  WIND_YELLOW_MAX: number;
}

// Teleng Ria: most tolerant — mellow beachbreak, works at most tides
export const SURFABLE_TELENG_RIA: SpotThresholds = {
  TIDE_GREEN_MIN: 25,
  TIDE_GREEN_FALLING_MIN: 60,
  TIDE_YELLOW_MIN: 15,
  SWELL_GREEN_MIN: 0.4,
  SWELL_YELLOW_MIN: 0.2,
  WIND_GREEN_MAX: 25,
  WIND_YELLOW_MAX: 35,
};

// Pancer: standard beachbreak
export const SURFABLE_PANCER: SpotThresholds = {
  TIDE_GREEN_MIN: 40,
  TIDE_GREEN_FALLING_MIN: 75,
  TIDE_YELLOW_MIN: 25,
  SWELL_GREEN_MIN: 0.5,
  SWELL_YELLOW_MIN: 0.3,
  WIND_GREEN_MAX: 20,
  WIND_YELLOW_MAX: 30,
};

// Pancer Door: most sensitive — river mouth sandbar
export const SURFABLE_PANCER_DOOR: SpotThresholds = {
  TIDE_GREEN_MIN: 50,
  TIDE_GREEN_FALLING_MIN: 80,
  TIDE_YELLOW_MIN: 30,
  SWELL_GREEN_MIN: 0.5,
  SWELL_YELLOW_MIN: 0.3,
  WIND_GREEN_MAX: 20,
  WIND_YELLOW_MAX: 30,
};

// Keep a default for backward compatibility in tests
export const SURFABLE = SURFABLE_PANCER_DOOR;

export const SPOT_THRESHOLDS = {
  telengRia: SURFABLE_TELENG_RIA,
  pancer: SURFABLE_PANCER,
  pancerDoor: SURFABLE_PANCER_DOOR,
} as const;
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts src/server/config.ts
git commit -m "feat: add per-spot types and threshold configs"
```

---

## Task 2: Surfable Logic — Accept Thresholds Param + Tests

**Files:**
- Modify: `src/server/surfable.ts`
- Modify: `tests/surfable.test.ts`

- [ ] **Step 1: Update surfable.ts to accept thresholds**

Replace `/root/surf-pacitan/src/server/surfable.ts` with:

```ts
import type { SurfableRating, SpotRatings, SpotName } from "../shared/types";
import type { SpotThresholds } from "./config";
import { SURFABLE, SPOT_THRESHOLDS } from "./config";

interface SurfableInput {
  hour: number;
  tidePercent: number; // 0-100
  tideRising: boolean;
  swellHeight: number; // meters
  windSpeed: number; // km/h
  sunrise: string; // "HH:mm"
  sunset: string; // "HH:mm"
}

function isWithinDaylight(hour: number, sunrise: string, sunset: string): boolean {
  const sunriseHour = parseInt(sunrise.split(":")[0], 10);
  const sunsetHour = parseInt(sunset.split(":")[0], 10);
  return hour >= sunriseHour && hour < sunsetHour;
}

export function computeSurfable(input: SurfableInput, thresholds: SpotThresholds = SURFABLE): SurfableRating {
  const { hour, tidePercent, tideRising, swellHeight, windSpeed, sunrise, sunset } = input;

  // Red: hard no-go conditions
  if (!isWithinDaylight(hour, sunrise, sunset)) return "red";
  if (swellHeight < thresholds.SWELL_YELLOW_MIN) return "red";
  if (windSpeed > thresholds.WIND_YELLOW_MAX) return "red";
  if (tidePercent < thresholds.TIDE_YELLOW_MIN) return "red";

  // Check if tide is in green zone
  const tideGreen =
    (tideRising && tidePercent >= thresholds.TIDE_GREEN_MIN) ||
    (!tideRising && tidePercent >= thresholds.TIDE_GREEN_FALLING_MIN);

  const swellGreen = swellHeight >= thresholds.SWELL_GREEN_MIN;
  const windGreen = windSpeed < thresholds.WIND_GREEN_MAX;

  // Green: all conditions met
  if (tideGreen && swellGreen && windGreen) return "green";

  // Yellow: everything else that passed the red gate
  return "yellow";
}

export function computeAllSpotRatings(input: SurfableInput): SpotRatings {
  return {
    telengRia: computeSurfable(input, SPOT_THRESHOLDS.telengRia),
    pancer: computeSurfable(input, SPOT_THRESHOLDS.pancer),
    pancerDoor: computeSurfable(input, SPOT_THRESHOLDS.pancerDoor),
  };
}

export function computeTidePercent(
  currentHeight: number,
  dailyMin: number,
  dailyMax: number
): number {
  const range = dailyMax - dailyMin;
  if (range === 0) return 50;
  return ((currentHeight - dailyMin) / range) * 100;
}
```

- [ ] **Step 2: Update tests**

Replace `/root/surf-pacitan/tests/surfable.test.ts` with:

```ts
import { describe, test, expect } from "bun:test";
import { computeSurfable, computeAllSpotRatings } from "../src/server/surfable";

describe("computeSurfable", () => {
  const sunrise = "05:42";
  const sunset = "17:31";

  test("green: rising tide > 50%, good swell, light wind, daylight", () => {
    const result = computeSurfable({
      hour: 9,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.2,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("green");
  });

  test("green: falling tide > 80%, good swell, light wind", () => {
    const result = computeSurfable({
      hour: 11,
      tidePercent: 85,
      tideRising: false,
      swellHeight: 0.8,
      windSpeed: 15,
      sunrise,
      sunset,
    });
    expect(result).toBe("green");
  });

  test("yellow: mid tide 30-50% rising", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 40,
      tideRising: true,
      swellHeight: 0.8,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("yellow");
  });

  test("yellow: good tide but marginal swell 0.3-0.5m", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 0.4,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("yellow");
  });

  test("yellow: good tide/swell but wind 20-30 km/h", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 25,
      sunrise,
      sunset,
    });
    expect(result).toBe("yellow");
  });

  test("red: low tide < 30%", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 15,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("red: flat swell < 0.3m", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 0.2,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("red: blown out wind > 30 km/h", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 35,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("red: outside daylight (before sunrise)", () => {
    const result = computeSurfable({
      hour: 4,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("red: outside daylight (after sunset)", () => {
    const result = computeSurfable({
      hour: 18,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("yellow: falling tide 50-80% range", () => {
    const result = computeSurfable({
      hour: 12,
      tidePercent: 60,
      tideRising: false,
      swellHeight: 1.0,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("yellow");
  });
});

describe("computeAllSpotRatings", () => {
  const sunrise = "05:42";
  const sunset = "17:31";

  test("Teleng Ria is more tolerant than Pancer Door at mid-tide", () => {
    const result = computeAllSpotRatings({
      hour: 10,
      tidePercent: 30,
      tideRising: true,
      swellHeight: 0.8,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    // Teleng Ria: 30% rising is green (green min = 25%)
    expect(result.telengRia).toBe("green");
    // Pancer: 30% rising is yellow (green min = 40%)
    expect(result.pancer).toBe("yellow");
    // Pancer Door: 30% rising is yellow (green min = 50%)
    expect(result.pancerDoor).toBe("yellow");
  });

  test("all spots red when flat", () => {
    const result = computeAllSpotRatings({
      hour: 10,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 0.1,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result.telengRia).toBe("red");
    expect(result.pancer).toBe("red");
    expect(result.pancerDoor).toBe("red");
  });

  test("all spots green in ideal conditions", () => {
    const result = computeAllSpotRatings({
      hour: 10,
      tidePercent: 85,
      tideRising: true,
      swellHeight: 1.5,
      windSpeed: 5,
      sunrise,
      sunset,
    });
    expect(result.telengRia).toBe("green");
    expect(result.pancer).toBe("green");
    expect(result.pancerDoor).toBe("green");
  });

  test("Teleng Ria tolerates more wind", () => {
    const result = computeAllSpotRatings({
      hour: 10,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 22,
      sunrise,
      sunset,
    });
    // Teleng Ria: 22 km/h < 25 green max → green
    expect(result.telengRia).toBe("green");
    // Pancer: 22 > 20 green max → yellow
    expect(result.pancer).toBe("yellow");
    // Pancer Door: 22 > 20 green max → yellow
    expect(result.pancerDoor).toBe("yellow");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /root/surf-pacitan && bun test tests/surfable.test.ts
```

Expected: all 15 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/surfable.ts tests/surfable.test.ts
git commit -m "feat: computeSurfable accepts per-spot thresholds, add computeAllSpotRatings"
```

---

## Task 3: Cron — Compute Per-Spot Ratings

**Files:**
- Modify: `src/server/cron.ts`

- [ ] **Step 1: Update cron.ts to use computeAllSpotRatings**

In `/root/surf-pacitan/src/server/cron.ts`, update the imports to use `computeAllSpotRatings` instead of `computeSurfable`:

Change the import line:
```ts
import { computeSurfable, computeTidePercent } from "./surfable";
```
To:
```ts
import { computeAllSpotRatings, computeTidePercent } from "./surfable";
```

Then in `fetchAndCacheTides` (the section that builds hourly entries), change:
```ts
        surfable: computeSurfable({
          hour: sl.hour,
          tidePercent,
          tideRising: sl.rising,
          swellHeight: 0,
          windSpeed: 0,
          sunrise: astronomy.sunrise,
          sunset: astronomy.sunset,
        }),
```
To:
```ts
        surfable: computeAllSpotRatings({
          hour: sl.hour,
          tidePercent,
          tideRising: sl.rising,
          swellHeight: 0,
          windSpeed: 0,
          sunrise: astronomy.sunrise,
          sunset: astronomy.sunset,
        }),
```

And in `fetchAndCacheWeather` (the section that merges weather and recomputes surfable), change:
```ts
        const surfable = computeSurfable({
          hour: h.hour,
          tidePercent,
          tideRising: h.tide.rising,
          swellHeight: swell.height,
          windSpeed: wind.speed,
          sunrise: cachedDay.astronomy.sunrise,
          sunset: cachedDay.astronomy.sunset,
        });
```
To:
```ts
        const surfable = computeAllSpotRatings({
          hour: h.hour,
          tidePercent,
          tideRising: h.tide.rising,
          swellHeight: swell.height,
          windSpeed: wind.speed,
          sunrise: cachedDay.astronomy.sunrise,
          sunset: cachedDay.astronomy.sunset,
        });
```

Also find the fallback case (weather-only, no tide data cached) and make the same change:
```ts
        const surfable = computeSurfable({
```
To:
```ts
        const surfable = computeAllSpotRatings({
```

- [ ] **Step 2: Run tests**

```bash
cd /root/surf-pacitan && bun test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/server/cron.ts
git commit -m "feat: compute per-spot surfable ratings in cron"
```

---

## Task 4: TideGraph — Spot Bands Below Chart

**Files:**
- Modify: `src/client/components/TideGraph.tsx`
- Modify: `src/client/components/TideGraph.css`

- [ ] **Step 1: Update TideGraph props and add spot bands**

In `/root/surf-pacitan/src/client/components/TideGraph.tsx`:

Update the import to include `SpotName`:
```ts
import type { HourlyData, TideExtreme, AstronomyData, SurfableRating, SpotName } from "../../../shared/types";
```

Add after the `RATING_COLORS` constant:
```ts
const SPOT_LABELS: { key: SpotName; label: string }[] = [
  { key: "telengRia", label: "Teleng Ria" },
  { key: "pancer", label: "Pancer" },
  { key: "pancerDoor", label: "Pancer Door" },
];

const SPOT_BAND_COLORS: Record<SurfableRating, string> = {
  green: "rgba(45, 212, 168, 0.5)",
  yellow: "rgba(240, 168, 48, 0.35)",
  red: "transparent",
};
```

In the `hooks.draw` callback, **after** the H/L tide extreme labels section and **before** `ctx.restore()`, add:

```ts
            // --- Per-spot surfable bands below chart ---
            const bandHeight = 14;
            const bandGap = 2;
            const bandStartY = u.bbox.top + u.bbox.height + 4;

            for (let si = 0; si < SPOT_LABELS.length; si++) {
              const spotKey = SPOT_LABELS[si].key;
              const bandY = bandStartY + si * (bandHeight + bandGap);

              // Draw label
              ctx.fillStyle = "#8b9bb4";
              ctx.font = "10px 'Outfit', system-ui, sans-serif";
              ctx.textAlign = "right";
              ctx.fillText(SPOT_LABELS[si].label, u.bbox.left - 4, bandY + bandHeight - 3);

              // Draw hourly segments
              for (let hour = 0; hour < 24; hour++) {
                const entry = hourly.find((h) => h.hour === hour);
                if (!entry) continue;

                const rating = entry.surfable[spotKey];
                const color = SPOT_BAND_COLORS[rating];
                if (color === "transparent") continue;

                const xStart = u.valToPos(hour * 3600, "x", true);
                const xEnd = u.valToPos((hour + 1) * 3600, "x", true);

                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.roundRect(xStart, bandY, xEnd - xStart, bandHeight, 2);
                ctx.fill();
              }
            }
```

Update the chart height to accommodate the bands. Change the height calculation:
```ts
    const height = window.innerWidth >= 1024 ? 320 : window.innerWidth >= 768 ? 260 : 200;
```
To:
```ts
    const bandSpace = 3 * (14 + 2) + 8; // 3 bands × (14px + 2px gap) + 8px padding
    const chartHeight = window.innerWidth >= 1024 ? 320 : window.innerWidth >= 768 ? 260 : 200;
    const height = chartHeight + bandSpace;
```

Also update the Y-axis size to make room for labels. Find:
```ts
          size: 36,
```
Change to:
```ts
          size: 70,
```

And the same in the ResizeObserver:
```ts
        const newHeight = window.innerWidth >= 1024 ? 320 : window.innerWidth >= 768 ? 260 : 200;
```
To:
```ts
        const bandSpace = 3 * (14 + 2) + 8;
        const newChartHeight = window.innerWidth >= 1024 ? 320 : window.innerWidth >= 768 ? 260 : 200;
        const newHeight = newChartHeight + bandSpace;
```

Also update the existing background bands to use `pancerDoor` rating (the most conservative) for the main chart background:

Change:
```ts
    const ratingByHour = new Map<number, SurfableRating>(hourly.map((h) => [h.hour, h.surfable]));
```
To:
```ts
    const ratingByHour = new Map<number, SurfableRating>(hourly.map((h) => [h.hour, h.surfable.pancerDoor]));
```

- [ ] **Step 2: Build and verify**

```bash
cd /root/surf-pacitan && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add src/client/components/TideGraph.tsx
git commit -m "feat: draw per-spot surfable bands below tide chart"
```

---

## Task 5: DayView — Per-Spot Recommendation Box

**Files:**
- Modify: `src/client/components/DayView.tsx`

- [ ] **Step 1: Update findBestWindow and recommendation box**

In `/root/surf-pacitan/src/client/components/DayView.tsx`:

Update the import:
```ts
import type { ForecastDay, HourlyData, SurfableRating, SpotName } from "../../../shared/types";
```

Replace the `findBestWindow` function and `SurfWindow` interface with:

```ts
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

function findSpotWindows(hourly: HourlyData[]): { windows: SpotWindow[]; reason: string } {
  const allWindows: SpotWindow[] = [];

  for (const { key, label } of SPOT_INFO) {
    let current: SpotWindow | null = null;

    for (const h of hourly) {
      const rating = h.surfable[key];
      if (rating === "green" || rating === "yellow") {
        if (current) {
          current.end = h.hour + 1;
          if (rating === "green") current.rating = "green";
        } else {
          current = { spot: label, spotKey: key, start: h.hour, end: h.hour + 1, rating };
        }
      } else {
        if (current) {
          allWindows.push(current);
          current = null;
        }
      }
    }
    if (current) allWindows.push(current);
  }

  if (allWindows.length === 0) {
    const hasSwell = hourly.some((h) => h.swell.height >= 0.2);
    const hasLightWind = hourly.some((h) => h.wind.speed < 35);
    if (!hasSwell) return { windows: [], reason: "No swell — flat conditions all day." };
    if (!hasLightWind) return { windows: [], reason: "Too much wind — blown out all day." };
    return { windows: [], reason: "Low tide during daylight hours — sandbar too shallow." };
  }

  return { windows: allWindows, reason: "" };
}

function formatWindow(start: number, end: number): string {
  return `${String(start).padStart(2, "0")}:00–${String(end).padStart(2, "0")}:00`;
}
```

Then update the render section. Replace the surf-window box content with:

```tsx
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
              Rising tide with enough water over the sandbar.
            </div>
          </>
        ) : (
          <>
            <div className="surf-window-title">No surf window</div>
            <div className="surf-window-note">{reason}</div>
          </>
        )}
      </div>
```

Also update the call at the top of the component. Change:
```ts
  const { windows, reason } = findBestWindow(day.hourly);
```
To:
```ts
  const { windows, reason } = findSpotWindows(day.hourly);
```

- [ ] **Step 2: Add CSS for spot rows**

In `/root/surf-pacitan/src/client/components/DayView.css`, add inside the `.surf-window` block:

```css
  & .surf-window-spots {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-bottom: 0.25rem;
  }

  & .surf-window-spot-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: #fff;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  }

  & .surf-window-spot-name {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.85rem;
  }

  & .surf-window-spot-times {
    font-weight: 700;
    font-size: 0.85rem;
  }
```

- [ ] **Step 3: Build and verify**

```bash
cd /root/surf-pacitan && bun run build
```

- [ ] **Step 4: Commit**

```bash
git add src/client/components/DayView.tsx src/client/components/DayView.css
git commit -m "feat: per-spot recommendation box with individual time windows"
```

---

## Task 6: Build, Test, Push

- [ ] **Step 1: Run all tests**

```bash
cd /root/surf-pacitan && bun test
```

Expected: 15 tests pass (11 original + 4 new).

- [ ] **Step 2: Full build**

```bash
cd /root/surf-pacitan && bun run build
```

- [ ] **Step 3: Restart service (type change affects cached data)**

```bash
systemctl restart surf-pacitan.service
```

The service restart is needed because the cached Redis data has the old `surfable: "red"` format. On restart, the cron will re-fetch and cache the new `surfable: { telengRia, pancer, pancerDoor }` format.

- [ ] **Step 4: Verify API returns per-spot data**

```bash
curl -s http://localhost:3100/api/forecast/$(date +%Y-%m-%d) | python3 -c "
import json, sys
data = json.load(sys.stdin)
h = data['hourly'][10]
print('Hour 10 surfable:', json.dumps(h['surfable'], indent=2))
"
```

Expected: `{ "telengRia": "...", "pancer": "...", "pancerDoor": "..." }`

- [ ] **Step 5: Push**

```bash
cd /root/surf-pacitan && git push
```
