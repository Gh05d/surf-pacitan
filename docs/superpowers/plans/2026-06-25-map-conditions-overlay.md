# Live-conditions Map Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay the selected conditions block onto the bottom `SpotMap` — swell + wind arrows over the bay, per-spot rating rings, close-out badges — kept in sync with the `ConditionsPanel` time block.

**Architecture:** Lift the block-index state from `ConditionsPanel` up to `App` so the panel and map share one selected block. Extract the (currently in-component, untested) block helpers into a pure `src/client/blocks.ts`, add pure overlay-math helpers in `src/client/map-overlay.ts`, and render arrows/rings on the Leaflet map via rotated `divIcon`s updated by a reactive effect.

**Tech Stack:** TypeScript, React, Leaflet, Bun (`bun test`), Vite.

## Global Constraints

- Use **relative imports** (`../blocks`, `../../shared/surfable`), never `@shared/*` aliases.
- `bun test` is the verification gate, not `tsc` (known pre-existing tsc path errors are masked by the bundler).
- **No inline styles in React components** — use co-located `.css` with CSS nesting. (Dynamic Leaflet `divIcon` HTML strings are not React render; a `--rot`/`--arrow-color` CSS var on the icon HTML is the established dynamic-rotation pattern and is allowed.)
- **No new rating logic** — ratings come from `minQuality(...surfable)`, close-out from `closeoutSpotsForHours`, both existing shared helpers. The overlay never changes a rating.
- Swell/wind are **region-level**: exactly **one** swell arrow + **one** wind arrow over the bay — no per-spot arrows.
- Arrow convention: arrow **points the travel direction** (`from + 180`); the **text label shows the "from" compass** (surfer convention). Wind arrow color: offshore=green / cross=amber / onshore=red via `getWindCategory` against `ACTIVE_REGION.coastFacingDirection`.
- **Verification builds go to `/tmp`**: `bunx vite build --outDir /tmp/vite-check && rm -rf /tmp/vite-check`. **NEVER run `bun run build`** (it deploys live to `/var/www`) except in the deploy task.
- Behavior preservation: after the state lift, `ConditionsPanel` must behave identically (same default block per day, same nav, same cards).

## File Structure

| File | Responsibility |
|------|----------------|
| `src/client/blocks.ts` | **new** — pure: `TimeBlock`, `buildDaylightBlocks`, `averageBlock`, `getDefaultBlockIndex(…, nowHour)`, `bestWindowStartHour` |
| `tests/blocks.test.ts` | **new** — unit tests for the above |
| `src/client/map-overlay.ts` | **new** — pure: `travelBearing`, `swellLabel`, `windLabel`, `windCategoryColor` |
| `tests/map-overlay.test.ts` | **new** — unit tests |
| `src/client/App.tsx` | own `blockIndex`; build `blocks`; reset default on day change; thread to `DayView` + `SpotMap` |
| `src/client/components/DayView.tsx` | forward block props to `ConditionsPanel`; drop its `bestWindowStart` derivation |
| `src/client/components/ConditionsPanel.tsx` | drop internal block state/builders; render from props; import `averageBlock` from `blocks.ts` |
| `src/client/components/SpotMap.tsx` | new `day`/`block` props; swell+wind arrows, marker rings, ⚠️ badges; reactive update effect |
| `src/client/components/SpotMap.css` | arrow / ring / badge styles |
| `public/sw.js` | bump `CACHE_NAME` (deploy step) |

---

### Task 1: Extract block helpers to `src/client/blocks.ts`

**Files:**
- Create: `src/client/blocks.ts`
- Modify: `src/client/components/ConditionsPanel.tsx` (import from blocks.ts; remove local copies)
- Test: `tests/blocks.test.ts`

**Interfaces:**
- Consumes: `HourlyData`, `AstronomyData`, `SwellData`, `WindData`, `WeatherData` from `../shared/types`.
- Produces:
  - `interface TimeBlock { start: number; end: number; label: string; hours: HourlyData[] }`
  - `buildDaylightBlocks(hourly: HourlyData[], astronomy: AstronomyData): TimeBlock[]`
  - `averageBlock(hours: HourlyData[]): { swell: SwellData; wind: WindData; weather: WeatherData }`
  - `bestWindowStartHour(hourly: HourlyData[]): number | null`
  - `getDefaultBlockIndex(blocks: TimeBlock[], isToday: boolean, bestWindowStart: number | null, nowHour: number): number`

- [ ] **Step 1: Write the failing test**

Create `tests/blocks.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  buildDaylightBlocks,
  averageBlock,
  bestWindowStartHour,
  getDefaultBlockIndex,
  type TimeBlock,
} from "../src/client/blocks";
import type { HourlyData } from "../src/shared/types";

function h(hour: number, opts: Partial<HourlyData> = {}): HourlyData {
  return {
    hour,
    tide: { height: 0, rising: true },
    swell: { height: 1, period: 10, direction: 200 },
    wind: { speed: 10, direction: 100, gusts: 12 },
    weather: { temp: 27, condition: "clear", precipitation: 0 },
    surfable: {},
    ...opts,
  };
}

const astro = { sunrise: "05:49", sunset: "17:28" };

describe("buildDaylightBlocks", () => {
  test("emits only 3h blocks overlapping daylight, with hours", () => {
    const hourly = Array.from({ length: 24 }, (_, i) => h(i));
    const blocks = buildDaylightBlocks(hourly, astro);
    // sunrise hour 5, sunset hour 17 → blocks [3-6),[6-9),[9-12),[12-15),[15-18)
    expect(blocks.map((b) => b.start)).toEqual([3, 6, 9, 12, 15]);
    expect(blocks[0].label).toBe("03:00 – 06:00");
    expect(blocks.every((b) => b.hours.length > 0)).toBe(true);
  });
});

describe("averageBlock", () => {
  test("averages swell/wind and rounds", () => {
    const hours = [
      h(9, { swell: { height: 1.0, period: 10, direction: 200 }, wind: { speed: 10, direction: 100, gusts: 12 } }),
      h(10, { swell: { height: 2.0, period: 12, direction: 210 }, wind: { speed: 20, direction: 110, gusts: 18 } }),
    ];
    const a = averageBlock(hours);
    expect(a.swell.height).toBe(1.5);
    expect(a.swell.period).toBe(11);
    expect(a.wind.speed).toBe(15);
    expect(a.wind.gusts).toBe(18); // max
  });
});

describe("bestWindowStartHour", () => {
  test("earliest green hour wins", () => {
    const hourly = [h(7, { surfable: { p: "yellow" } }), h(9, { surfable: { p: "green" } })];
    expect(bestWindowStartHour(hourly)).toBe(9);
  });
  test("falls back to earliest yellow when no green", () => {
    const hourly = [h(7, { surfable: { p: "red" } }), h(8, { surfable: { p: "yellow" } })];
    expect(bestWindowStartHour(hourly)).toBe(8);
  });
  test("null when all red", () => {
    expect(bestWindowStartHour([h(7, { surfable: { p: "red" } })])).toBeNull();
  });
});

describe("getDefaultBlockIndex", () => {
  const blocks: TimeBlock[] = [
    { start: 6, end: 9, label: "", hours: [] },
    { start: 9, end: 12, label: "", hours: [] },
    { start: 12, end: 15, label: "", hours: [] },
  ];
  test("today → block containing nowHour", () => {
    expect(getDefaultBlockIndex(blocks, true, null, 10)).toBe(1);
  });
  test("today past last block → last block", () => {
    expect(getDefaultBlockIndex(blocks, true, null, 20)).toBe(2);
  });
  test("future day → block containing bestWindowStart", () => {
    expect(getDefaultBlockIndex(blocks, false, 13, 0)).toBe(2);
  });
  test("future day no window → midday block", () => {
    expect(getDefaultBlockIndex(blocks, false, null, 0)).toBe(2);
  });
  test("empty blocks → 0", () => {
    expect(getDefaultBlockIndex([], true, null, 10)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/blocks.test.ts`
Expected: FAIL — `Cannot find module '../src/client/blocks'`.

- [ ] **Step 3: Create `src/client/blocks.ts`**

```ts
// Pure time-block helpers shared by App, ConditionsPanel, and SpotMap.
// Extracted from ConditionsPanel so they can be unit-tested and reused.
import type { HourlyData, AstronomyData, SwellData, WindData, WeatherData } from "../shared/types";

export interface TimeBlock {
  start: number;
  end: number;
  label: string;
  hours: HourlyData[];
}

export function buildDaylightBlocks(hourly: HourlyData[], astronomy: AstronomyData): TimeBlock[] {
  const sunriseHour = parseInt(astronomy.sunrise.split(":")[0], 10);
  const sunsetHour = parseInt(astronomy.sunset.split(":")[0], 10);

  const blocks: TimeBlock[] = [];
  for (let start = 0; start < 24; start += 3) {
    const end = start + 3;
    if (end <= sunriseHour || start >= sunsetHour) continue;
    const hours = hourly.filter((x) => x.hour >= start && x.hour < end);
    if (hours.length === 0) continue;
    blocks.push({
      start,
      end,
      label: `${String(start).padStart(2, "0")}:00 – ${String(end).padStart(2, "0")}:00`,
      hours,
    });
  }
  return blocks;
}

function windCategory(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d >= 315 || d <= 45) return "offshore";
  if (d >= 135 && d <= 225) return "onshore";
  return "crossShore";
}

function getModeWindDirection(hours: HourlyData[]): number {
  const counts: Record<string, number> = {};
  const firstDir: Record<string, number> = {};
  for (const x of hours) {
    const cat = windCategory(x.wind.direction);
    counts[cat] = (counts[cat] || 0) + 1;
    if (!(cat in firstDir)) firstDir[cat] = x.wind.direction;
  }
  const modeCat = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return firstDir[modeCat];
}

function getModeCondition(hours: HourlyData[]): string {
  const counts: Record<string, number> = {};
  for (const x of hours) counts[x.weather.condition] = (counts[x.weather.condition] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export function averageBlock(hours: HourlyData[]): { swell: SwellData; wind: WindData; weather: WeatherData } {
  const n = hours.length;
  const swell: SwellData = {
    height: Math.round((hours.reduce((s, x) => s + x.swell.height, 0) / n) * 10) / 10,
    period: Math.round(hours.reduce((s, x) => s + x.swell.period, 0) / n),
    direction: hours[Math.floor(n / 2)].swell.direction,
  };
  const wind: WindData = {
    speed: Math.round((hours.reduce((s, x) => s + x.wind.speed, 0) / n) * 10) / 10,
    gusts: Math.round(Math.max(...hours.map((x) => x.wind.gusts))),
    direction: getModeWindDirection(hours),
  };
  const weather: WeatherData = {
    temp: Math.round(hours.reduce((s, x) => s + x.weather.temp, 0) / n),
    condition: getModeCondition(hours),
    precipitation: Math.round((hours.reduce((s, x) => s + x.weather.precipitation, 0) / n) * 10) / 10,
  };
  return { swell, wind, weather };
}

// Earliest hour where any spot is green, else earliest where any spot is yellow,
// else null. Matches DayView's "earliest primary-window start" for the default block.
export function bestWindowStartHour(hourly: HourlyData[]): number | null {
  const green = hourly.find((x) => Object.values(x.surfable).includes("green"));
  if (green) return green.hour;
  const yellow = hourly.find((x) => Object.values(x.surfable).includes("yellow"));
  return yellow ? yellow.hour : null;
}

export function getDefaultBlockIndex(
  blocks: TimeBlock[],
  isToday: boolean,
  bestWindowStart: number | null,
  nowHour: number,
): number {
  if (blocks.length === 0) return 0;
  if (isToday) {
    const idx = blocks.findIndex((b) => nowHour >= b.start && nowHour < b.end);
    return idx >= 0 ? idx : nowHour >= blocks[blocks.length - 1].end ? blocks.length - 1 : 0;
  }
  if (bestWindowStart !== null) {
    const idx = blocks.findIndex((b) => bestWindowStart >= b.start && bestWindowStart < b.end);
    return idx >= 0 ? idx : 0;
  }
  const middayIdx = blocks.findIndex((b) => b.start <= 12 && b.end > 12);
  return middayIdx >= 0 ? middayIdx : Math.floor(blocks.length / 2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/blocks.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire `ConditionsPanel.tsx` to use `blocks.ts` (no behavior change)**

In `src/client/components/ConditionsPanel.tsx`:

5a. Replace the local definitions. Remove the local `interface TimeBlock`, `buildDaylightBlocks`, `windCategory`, `getModeWindDirection`, `getModeCondition`, `averageBlock`, and `getDefaultBlockIndex` functions. Add an import near the other imports:

```ts
import { buildDaylightBlocks, averageBlock, getDefaultBlockIndex, type TimeBlock } from "../blocks";
```

5b. The `useState` initializer currently calls `getDefaultBlockIndex(blocks, isToday, bestWindowStart)` — add the `nowHour` arg:

```ts
  const [blockIndex, setBlockIndex] = useState(() =>
    getDefaultBlockIndex(blocks, isToday, bestWindowStart, new Date().getHours())
  );
```

Leave everything else (props, `spotBlockSummary`, the close-out note, render) unchanged.

- [ ] **Step 6: Verify the full suite + client build**

Run: `bun test`
Expected: PASS (existing + new blocks tests).

Run: `bunx vite build --outDir /tmp/vite-check && rm -rf /tmp/vite-check`
Expected: build succeeds (ConditionsPanel resolves the new imports).

- [ ] **Step 7: Commit**

```bash
git add src/client/blocks.ts tests/blocks.test.ts src/client/components/ConditionsPanel.tsx
git commit -m "refactor(blocks): extract testable time-block helpers from ConditionsPanel"
```

---

### Task 2: Pure overlay math `src/client/map-overlay.ts`

**Files:**
- Create: `src/client/map-overlay.ts`
- Test: `tests/map-overlay.test.ts`

**Interfaces:**
- Consumes: `SwellData`, `WindData` from `../shared/types`; `degreesToCompass`, `getWindCategory` from `../shared/surfable`.
- Produces:
  - `travelBearing(fromDeg: number): number`
  - `swellLabel(swell: SwellData): string`
  - `windLabel(wind: WindData): string`
  - `windCategoryColor(windDirection: number, facingDirection: number): string`

- [ ] **Step 1: Write the failing test**

Create `tests/map-overlay.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { travelBearing, swellLabel, windLabel, windCategoryColor } from "../src/client/map-overlay";

describe("travelBearing", () => {
  test("adds 180 and wraps", () => {
    expect(travelBearing(215)).toBe(35);
    expect(travelBearing(10)).toBe(190);
    expect(travelBearing(180)).toBe(0);
    expect(travelBearing(0)).toBe(180);
  });
});

describe("labels", () => {
  test("swellLabel = compass + height·period", () => {
    expect(swellLabel({ height: 1.04, period: 11.2, direction: 207 })).toBe("SW 1.0m·11s");
  });
  test("windLabel = compass + km/h", () => {
    expect(windLabel({ speed: 17.4, direction: 100, gusts: 20 })).toBe("E 17km/h");
  });
});

describe("windCategoryColor (facing 195)", () => {
  test("onshore (from 195) → red", () => {
    expect(windCategoryColor(195, 195)).toBe("#e06050");
  });
  test("offshore (from 15) → green", () => {
    expect(windCategoryColor(15, 195)).toBe("#2dd4a8");
  });
  test("cross-shore (from 105) → amber", () => {
    expect(windCategoryColor(105, 195)).toBe("#f0a830");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/map-overlay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/client/map-overlay.ts`**

```ts
// Pure helpers for the SpotMap conditions overlay. Arrow points the travel
// direction (from + 180); labels carry the surfer "from" compass.
import type { SwellData, WindData } from "../shared/types";
import { degreesToCompass, getWindCategory } from "../shared/surfable";

export function travelBearing(fromDeg: number): number {
  return (((fromDeg + 180) % 360) + 360) % 360;
}

export function swellLabel(swell: SwellData): string {
  return `${degreesToCompass(swell.direction)} ${swell.height.toFixed(1)}m·${Math.round(swell.period)}s`;
}

export function windLabel(wind: WindData): string {
  return `${degreesToCompass(wind.direction)} ${Math.round(wind.speed)}km/h`;
}

const WIND_CATEGORY_COLOR: Record<string, string> = {
  offshore: "#2dd4a8",
  crossShore: "#f0a830",
  onshore: "#e06050",
};

export function windCategoryColor(windDirection: number, facingDirection: number): string {
  return WIND_CATEGORY_COLOR[getWindCategory(windDirection, facingDirection)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/map-overlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/map-overlay.ts tests/map-overlay.test.ts
git commit -m "feat(map-overlay): pure travelBearing + label + wind-color helpers"
```

---

### Task 3: Lift block state from `ConditionsPanel` to `App`

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/components/DayView.tsx`
- Modify: `src/client/components/ConditionsPanel.tsx`

**Interfaces:**
- Consumes: `buildDaylightBlocks`, `getDefaultBlockIndex`, `bestWindowStartHour`, `TimeBlock` (Task 1).
- Produces: `ConditionsPanel` new props `{ day, blocks, blockIndex, onBlockChange, onSpotInfo }`; `DayView` new props `{ blocks, blockIndex, onBlockChange }` (plus existing `day`, `isToday`, `onSpotInfo`).

- [ ] **Step 1: `App.tsx` owns block state**

In `src/client/App.tsx`:

1a. Update the React import to include `useEffect`, and import the block helpers:

```ts
import { useState, useCallback, useRef, useEffect } from "react";
import { buildDaylightBlocks, getDefaultBlockIndex, bestWindowStartHour } from "./blocks";
```

1b. Add `blockIndex` state and compute `currentDay` **before** the early returns (hooks must run unconditionally). After the existing `const [infoSpot, ...]` line add:

```ts
  const [blockIndex, setBlockIndex] = useState(0);
  const currentDay = days.length ? days[Math.min(dayIndex, days.length - 1)] : undefined;

  // Reset the conditions block to the day's default when the displayed day changes.
  useEffect(() => {
    if (!currentDay) return;
    const blocks = buildDaylightBlocks(currentDay.hourly, currentDay.astronomy);
    setBlockIndex(
      getDefaultBlockIndex(blocks, dayIndex === 0, bestWindowStartHour(currentDay.hourly), new Date().getHours()),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDay?.date, dayIndex]);
```

1c. The existing `const currentDay = days[Math.min(dayIndex, days.length - 1)];` line (just before `dayLabel`, after the early returns) is now redundant — **remove that one line** (currentDay is already defined above). Immediately after `const dayLabel = ...`, derive the blocks and selected block:

```ts
  const day = currentDay!;
  const blocks = buildDaylightBlocks(day.hourly, day.astronomy);
  const safeBlockIndex = Math.min(blockIndex, Math.max(0, blocks.length - 1));
  const selectedBlock = blocks[safeBlockIndex] ?? null;
```

(Replace the remaining uses of `currentDay` in the JSX below — `dayLabel`, `currentDay.date`, `NowBanner`, `DayView` — with `day`. `selectedBlock` is wired into `SpotMap` in Task 4; for now it is unused, which is fine.)

1d. Pass block props into `DayView` (the `<DayView ... />` at the bottom):

```tsx
          <DayView
            key={day.date}
            day={day}
            isToday={dayIndex === 0}
            blocks={blocks}
            blockIndex={safeBlockIndex}
            onBlockChange={setBlockIndex}
            onSpotInfo={setInfoSpot}
          />
```

- [ ] **Step 2: `DayView.tsx` forwards block props, drops its `bestWindowStart`**

In `src/client/components/DayView.tsx`:

2a. Import the `TimeBlock` type:

```ts
import type { TimeBlock } from "../blocks";
```

2b. Extend `DayViewProps`:

```ts
interface DayViewProps {
  day: ForecastDay;
  isToday: boolean;
  blocks: TimeBlock[];
  blockIndex: number;
  onBlockChange: (index: number) => void;
  onSpotInfo: (spot: SpotName) => void;
}
```

2c. Update the component signature and remove the now-unused `bestWindowStart` derivation (the lines `const primaryWindows = ...` and `const bestWindowStart = ...`):

```ts
export function DayView({ day, isToday, blocks, blockIndex, onBlockChange, onSpotInfo }: DayViewProps) {
```

2d. Replace the `<ConditionsPanel ... />` element with:

```tsx
      <ConditionsPanel
        day={day}
        blocks={blocks}
        blockIndex={blockIndex}
        onBlockChange={onBlockChange}
        onSpotInfo={onSpotInfo}
      />
```

- [ ] **Step 3: `ConditionsPanel.tsx` renders from props**

In `src/client/components/ConditionsPanel.tsx`:

3a. Replace the props interface:

```ts
interface ConditionsPanelProps {
  day: ForecastDay;
  blocks: TimeBlock[];
  blockIndex: number;
  onBlockChange: (index: number) => void;
  onSpotInfo: (spot: SpotName) => void;
}
```

3b. Update the import from `../blocks` to drop `buildDaylightBlocks`/`getDefaultBlockIndex` (no longer used here) and keep `averageBlock` + the type:

```ts
import { averageBlock, type TimeBlock } from "../blocks";
```

3c. Replace the component header — remove the internal `useState`/`buildDaylightBlocks` and read from props:

```ts
export function ConditionsPanel({ day, blocks, blockIndex, onBlockChange, onSpotInfo }: ConditionsPanelProps) {
  if (blocks.length === 0) {
    return <div className="no-hourly">No conditions data available</div>;
  }

  const safeIndex = Math.min(blockIndex, blocks.length - 1);
  const currentBlock = blocks[safeIndex];
  const { swell, wind, weather } = averageBlock(currentBlock.hours);
```

(Delete the old `const blocks = buildDaylightBlocks(...)`, the old `const [blockIndex, setBlockIndex] = useState(...)`, and the old `if (blocks.length === 0)` block that sat after them — they are replaced by the above.)

3d. The two nav buttons now call `onBlockChange`:

```tsx
        <button
          className="conditions-panel-btn"
          onClick={() => onBlockChange(safeIndex - 1)}
          disabled={safeIndex === 0}
          aria-label="Previous time block"
        >
          ◀
        </button>
```
```tsx
        <button
          className="conditions-panel-btn"
          onClick={() => onBlockChange(safeIndex + 1)}
          disabled={safeIndex === blocks.length - 1}
          aria-label="Next time block"
        >
          ▶
        </button>
```

3e. Remove the now-unused `useState` import if nothing else in the file uses it (check: after this change `useState` is unused → drop it from `import { useState } from "react";`, deleting that line entirely).

- [ ] **Step 4: Verify build + full suite (behavior must be unchanged)**

Run: `bun test`
Expected: PASS.

Run: `bunx vite build --outDir /tmp/vite-check && rm -rf /tmp/vite-check`
Expected: build succeeds, no type errors from the prop changes.

- [ ] **Step 5: Manual behavior check**

Run `bun run dev:client`; confirm the conditions panel still defaults to the current block (today) / best-window (future days), the ◀▶ nav works, and swiping to another day resets the block to that day's default. (No visual change yet — this is a pure state lift.)

- [ ] **Step 6: Commit**

```bash
git add src/client/App.tsx src/client/components/DayView.tsx src/client/components/ConditionsPanel.tsx
git commit -m "refactor(conditions): lift block-index state from ConditionsPanel to App"
```

---

### Task 4: SpotMap props + swell/wind arrows

**Files:**
- Modify: `src/client/components/SpotMap.tsx`
- Modify: `src/client/components/SpotMap.css`
- Modify: `src/client/App.tsx` (pass `day` + `block` to `SpotMap`)

**Interfaces:**
- Consumes: `averageBlock`, `TimeBlock` (Task 1); `travelBearing`, `swellLabel`, `windLabel`, `windCategoryColor` (Task 2); `ForecastDay` from `../../shared/types`.
- Produces: `SpotMap` props `{ day: ForecastDay; block: TimeBlock | null; onSpotInfo }`.

- [ ] **Step 1: Add imports + props to `SpotMap.tsx`**

In `src/client/components/SpotMap.tsx`, extend the type import and add new imports:

```ts
import type { SpotName, ForecastDay } from "../../shared/types";
import type { TimeBlock } from "../blocks";
import { averageBlock } from "../blocks";
import { travelBearing, swellLabel, windLabel, windCategoryColor } from "../map-overlay";
```

Replace the props interface:

```ts
interface SpotMapProps {
  day: ForecastDay;
  block: TimeBlock | null;
  onSpotInfo: (spot: SpotName) => void;
}
```

- [ ] **Step 2: Add arrow anchors + icon factory (module level)**

After the `SPOTS` constant, add:

```ts
const [MAP_LAT, MAP_LNG] = ACTIVE_REGION.map.center as [number, number];
// Two anchors over the bay water, just below the spot row.
const SWELL_ANCHOR: L.LatLngExpression = [MAP_LAT - 0.006, MAP_LNG - 0.0045];
const WIND_ANCHOR: L.LatLngExpression = [MAP_LAT - 0.006, MAP_LNG + 0.0045];

function createArrowIcon(kind: "swell" | "wind", bearingDeg: number, label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: `cond-arrow cond-arrow-${kind}`,
    html:
      `<div class="cond-arrow-glyph" style="--rot:${bearingDeg}deg;--arrow-color:${color}">↑</div>` +
      `<div class="cond-arrow-label">${label}</div>`,
    iconSize: [64, 48],
    iconAnchor: [32, 24],
  });
}
```

- [ ] **Step 3: Add arrow refs + reactive effect**

Inside the component, add refs next to the existing ones:

```ts
  const swellArrowRef = useRef<L.Marker | null>(null);
  const windArrowRef = useRef<L.Marker | null>(null);
```

In the map-init effect's cleanup (the `return () => { map.remove(); ... }`), also null the arrow refs:

```ts
      swellArrowRef.current = null;
      windArrowRef.current = null;
```

Compute the block average in the component body (above the `return`):

```ts
  const overlay = block ? averageBlock(block.hours) : null;
  const overlaySig = overlay
    ? `${day.date}|${block!.start}|${overlay.swell.direction},${overlay.swell.height},${overlay.swell.period}|${overlay.wind.direction},${overlay.wind.speed}`
    : "";
```

Add a second effect (after the map-init effect) that draws/updates the arrows:

```ts
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !overlay) return;
    const facing = ACTIVE_REGION.coastFacingDirection;

    const swellIcon = createArrowIcon("swell", travelBearing(overlay.swell.direction), swellLabel(overlay.swell), "#38bdf8");
    if (swellArrowRef.current) swellArrowRef.current.setIcon(swellIcon);
    else swellArrowRef.current = L.marker(SWELL_ANCHOR, { icon: swellIcon, interactive: false }).addTo(map);

    const windColor = windCategoryColor(overlay.wind.direction, facing);
    const windIcon = createArrowIcon("wind", travelBearing(overlay.wind.direction), windLabel(overlay.wind), windColor);
    if (windArrowRef.current) windArrowRef.current.setIcon(windIcon);
    else windArrowRef.current = L.marker(WIND_ANCHOR, { icon: windIcon, interactive: false }).addTo(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlaySig]);
```

- [ ] **Step 4: Pass `day` + `block` from `App.tsx`**

In `src/client/App.tsx`, update the `<SpotMap .../>` element:

```tsx
      <SpotMap day={day} block={selectedBlock} onSpotInfo={setInfoSpot} />
```

- [ ] **Step 5: Arrow CSS**

Append to `src/client/components/SpotMap.css`:

```css
/* Conditions overlay arrows (Leaflet divIcons) */
.cond-arrow {
  background: none;
  border: none;
  text-align: center;
  pointer-events: none;
}

.cond-arrow-glyph {
  font-size: 28px;
  line-height: 1;
  font-weight: 700;
  color: var(--arrow-color, #38bdf8);
  transform: rotate(var(--rot, 0deg));
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8));
}

.cond-arrow-label {
  margin-top: 1px;
  font-family: var(--font-display);
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95);
}
```

- [ ] **Step 6: Verify build**

Run: `bunx vite build --outDir /tmp/vite-check && rm -rf /tmp/vite-check`
Expected: build succeeds.

Run: `bun test`
Expected: PASS (no test regressions; this task is UI-only).

- [ ] **Step 7: Manual visual check**

`bun run dev:client`: confirm a blue swell arrow + a wind arrow (colored by offshore/cross/onshore) appear over the bay with labels (e.g. "SW 1.0m·11s", "E 17km/h"), and that changing the ◀▶ block updates them. Tap a spot marker → popup still opens (arrows are `interactive:false`).

- [ ] **Step 8: Commit**

```bash
git add src/client/components/SpotMap.tsx src/client/components/SpotMap.css src/client/App.tsx
git commit -m "feat(map): swell + wind condition arrows on SpotMap, synced to the block"
```

---

### Task 5: Per-spot rating rings + close-out badges

**Files:**
- Modify: `src/client/components/SpotMap.tsx`
- Modify: `src/client/components/SpotMap.css`

**Interfaces:**
- Consumes: `minQuality` from `../../shared/surfable`; `closeoutSpotsForHours` from `../../shared/closeout`; `SPOT_THRESHOLDS` from `../../shared/spot-config`; `SurfableRating` from `../../shared/types`.

- [ ] **Step 1: Add imports**

In `src/client/components/SpotMap.tsx`, extend imports:

```ts
import type { SpotName, ForecastDay, SurfableRating } from "../../shared/types";
import { minQuality } from "../../shared/surfable";
import { closeoutSpotsForHours } from "../../shared/closeout";
import { SPOT_THRESHOLDS } from "../../shared/spot-config";
```

- [ ] **Step 2: Extend `createSpotIcon` with rating ring + close-out badge**

Replace the existing `createSpotIcon`:

```ts
function createSpotIcon(emoji: string, rating?: SurfableRating, closeout = false): L.DivIcon {
  const ring = rating ? ` rating-${rating}` : "";
  const badge = closeout ? `<span class="spot-marker-badge">⚠️</span>` : "";
  return L.divIcon({
    className: "spot-marker",
    html: `<span class="spot-marker-emoji${ring}">${emoji}</span>${badge}`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  });
}
```

(The map-init effect still calls `createSpotIcon(spot.emoji)` with no rating — markers render plain, then the effect below tints them.)

- [ ] **Step 3: Derive ratings/close-out + fold into the overlay effect**

In the component body, below the `overlay`/`overlaySig` from Task 4, add:

```ts
  const ratings: Record<string, SurfableRating> = {};
  if (block) for (const s of SPOTS) ratings[s.key] = minQuality(block.hours.map((h) => h.surfable[s.key]));
  const closeoutIds = block
    ? new Set(
        closeoutSpotsForHours(
          block.hours,
          SPOTS.map((s) => ({ id: s.key, closeout: SPOT_THRESHOLDS[s.key]?.closeout })),
        ),
      )
    : new Set<string>();
```

Extend `overlaySig` (Task 4) to include marker state so the effect re-runs when ratings/flags change — replace the `overlaySig` assignment with:

```ts
  const overlaySig = overlay
    ? `${day.date}|${block!.start}` +
      `|${overlay.swell.direction},${overlay.swell.height},${overlay.swell.period}` +
      `|${overlay.wind.direction},${overlay.wind.speed}` +
      `|${SPOTS.map((s) => ratings[s.key]).join("")}|${[...closeoutIds].sort().join(",")}`
    : "";
```

In the overlay effect (Task 4), after the wind-arrow block and before the closing `}`/deps, add the marker update:

```ts
    SPOTS.forEach((spot, i) => {
      markersRef.current[i]?.setIcon(createSpotIcon(spot.emoji, ratings[spot.key], closeoutIds.has(spot.key)));
    });
```

- [ ] **Step 4: Marker CSS — replace the `.spot-marker` block**

In `src/client/components/SpotMap.css`, the existing nested rule is:

```css
    .spot-marker {
      background: none;
      border: none;
      font-size: 24px;
      line-height: 1;
      filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
    }
```

Replace it with (still nested inside `.spot-map-container`):

```css
    .spot-marker {
      background: none;
      border: none;
    }

    .spot-marker-emoji {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      margin: 2px;
      border-radius: 50%;
      font-size: 20px;
      line-height: 1;
      filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));

      &.rating-green { box-shadow: 0 0 0 2px #2dd4a8, 0 0 8px rgba(45, 212, 168, 0.6); }
      &.rating-yellow { box-shadow: 0 0 0 2px #f0a830, 0 0 8px rgba(240, 168, 48, 0.55); }
      &.rating-red { box-shadow: 0 0 0 2px #e06050, 0 0 8px rgba(224, 96, 80, 0.5); }
    }

    .spot-marker-badge {
      position: absolute;
      top: -2px;
      right: -2px;
      font-size: 13px;
      line-height: 1;
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8));
    }
```

- [ ] **Step 5: Verify build**

Run: `bunx vite build --outDir /tmp/vite-check && rm -rf /tmp/vite-check`
Expected: build succeeds.

Run: `bun test`
Expected: PASS.

- [ ] **Step 6: Manual visual check**

`bun run dev:client`: confirm each spot marker shows a colored ring matching the block's rating (compare to the panel's spot rows / the chart strips), a ⚠️ badge appears on close-out-flagged spots for the block, ring colors update when changing the block, and tapping a marker still opens its popup.

- [ ] **Step 7: Commit**

```bash
git add src/client/components/SpotMap.tsx src/client/components/SpotMap.css
git commit -m "feat(map): per-spot rating rings + close-out badges on SpotMap"
```

---

### Task 6: Deploy

**Files:**
- Modify: `public/sw.js`

- [ ] **Step 1: Full test gate**

Run: `bun test`
Expected: PASS (entire suite).

- [ ] **Step 2: Bump the service-worker cache**

In `public/sw.js`, increment `CACHE_NAME` (e.g. `surf-pacitan-v15` → `surf-pacitan-v16`).

- [ ] **Step 3: Production build (live — writes to /var/www)**

Run: `bun run build`
Expected: assets emitted to `/var/www/surf-pacitan/`. nginx serves it immediately; this is a frontend-only change, so **no service restart is needed**.

- [ ] **Step 4: Verify deployed bundle + commit**

Run: `grep -l "cond-arrow" /var/www/surf-pacitan/assets/index-*.js`
Expected: one matching hashed bundle.

```bash
git add public/sw.js
git commit -m "chore(map): bump SW cache for conditions-overlay deploy"
```

- [ ] **Step 5: Final visual confirmation on the live site**

Load `https://surf-pacitan.yolo-goldgrube.pp.ua` (hard-refresh / wait for the SW `controllerchange` reload): arrows + rings appear on the map, sync with the ◀▶ block and day swipe, and the close-out badge shows on flagged spots today.

---

## Self-Review

**1. Spec coverage:**
- §Scope swell arrow + label → Task 4. ✓
- §Scope wind arrow + label + category color → Task 4 (`windCategoryColor`). ✓
- §Scope per-spot rating color → Task 5 (rings). ✓
- §Scope close-out flag → Task 5 (⚠️ badge). ✓
- §Architecture-1 lift block state + extract `blocks.ts` (`buildDaylightBlocks`, `averageBlock`, `getDefaultBlockIndex(nowHour)`, `bestWindowStartHour`) → Tasks 1 + 3. ✓
- §Architecture-2 `map-overlay.ts` (`travelBearing`/`swellLabel`/`windLabel`/`windCategoryColor`) → Task 2. ✓
- §Architecture-3 rotated divIcon + reactive effect, region-agnostic anchor/facing → Task 4 + 5. ✓
- §Data flow App→DayView→ConditionsPanel + App→SpotMap → Tasks 3 + 4. ✓
- §Testing `blocks.test.ts`, `map-overlay.test.ts`; Leaflet via /tmp build + visual → Tasks 1, 2, 4, 5. ✓
- §Out-of-scope (one swell + one wind arrow, no per-spot arrows, no slider/animation) → honored (single `SWELL_ANCHOR`/`WIND_ANCHOR`; no time UI added). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. The two `eslint-disable` comments are intentional (sig-string deps capturing the closure), not placeholders.

**3. Type consistency:** `TimeBlock` defined in Task 1, imported identically in Tasks 3/4. `getDefaultBlockIndex(blocks, isToday, bestWindowStart, nowHour)` — 4-arg signature used at both the Task 1 definition and the Task 1 Step 5 ConditionsPanel call and the Task 3 App call. `averageBlock(hours)` returns `{swell, wind, weather}` — used by ConditionsPanel and SpotMap. `createSpotIcon(emoji, rating?, closeout?)` — Task 5 signature; map-init call `createSpotIcon(spot.emoji)` stays valid (optional args). `SpotMapProps {day, block, onSpotInfo}` consistent between Task 4 definition and the Task 4 App call site. `overlaySig` defined in Task 4, extended in Task 5 (same variable). ✓
