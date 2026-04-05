# Wind Direction Rating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the surfable rating wind-direction-aware so onshore wind downgrades ratings and offshore wind is more tolerated.

**Architecture:** Add `facingDirection` and per-direction wind thresholds to each spot's config. A new `getWindCategory()` helper classifies wind as onshore/cross-shore/offshore based on the angle between wind direction and spot facing. `computeSurfable()` picks the matching thresholds. Three call sites in `cron.ts` pass `windDirection` through.

**Tech Stack:** TypeScript, Bun test runner

**Spec:** `docs/superpowers/specs/2026-04-05-wind-direction-rating-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/server/config.ts` | Modify | New `WindDirectionThresholds` interface, update `SpotThresholds`, update all 3 spot configs |
| `src/server/surfable.ts` | Modify | Add `windDirection` to input, add `getWindCategory()`, use direction-aware thresholds |
| `src/server/cron.ts` | Modify | Pass `windDirection` to `computeAllSpotRatings` at 3 call sites (lines 88, 164, 194) |
| `tests/surfable.test.ts` | Modify | Add `windDirection` to all existing inputs, add wind direction test cases |

---

### Task 1: Update config types and spot thresholds

**Files:**
- Modify: `src/server/config.ts`

- [ ] **Step 1: Replace wind fields in SpotThresholds interface**

In `src/server/config.ts`, replace the `SpotThresholds` interface (lines 33-41) with:

```ts
export interface WindDirectionThresholds {
  greenMax: number;  // km/h
  yellowMax: number; // km/h
}

export interface SpotThresholds {
  TIDE_GREEN_MIN: number;
  TIDE_GREEN_FALLING_MIN: number;
  TIDE_YELLOW_MIN: number;
  SWELL_GREEN_MIN: number;
  SWELL_YELLOW_MIN: number;
  facingDirection: number;
  wind: {
    offshore: WindDirectionThresholds;
    crossShore: WindDirectionThresholds;
    onshore: WindDirectionThresholds;
  };
}
```

- [ ] **Step 2: Update SURFABLE_TELENG_RIA**

Replace `SURFABLE_TELENG_RIA` (lines 43-51) with:

```ts
export const SURFABLE_TELENG_RIA: SpotThresholds = {
  TIDE_GREEN_MIN: 25,
  TIDE_GREEN_FALLING_MIN: 60,
  TIDE_YELLOW_MIN: 15,
  SWELL_GREEN_MIN: 0.4,
  SWELL_YELLOW_MIN: 0.2,
  facingDirection: 180,
  wind: {
    offshore:   { greenMax: 35, yellowMax: 50 },
    crossShore: { greenMax: 25, yellowMax: 35 },
    onshore:    { greenMax: 15, yellowMax: 25 },
  },
};
```

- [ ] **Step 3: Update SURFABLE_PANCER**

Replace `SURFABLE_PANCER` (lines 53-61) with:

```ts
export const SURFABLE_PANCER: SpotThresholds = {
  TIDE_GREEN_MIN: 40,
  TIDE_GREEN_FALLING_MIN: 75,
  TIDE_YELLOW_MIN: 25,
  SWELL_GREEN_MIN: 0.5,
  SWELL_YELLOW_MIN: 0.3,
  facingDirection: 200,
  wind: {
    offshore:   { greenMax: 30, yellowMax: 45 },
    crossShore: { greenMax: 20, yellowMax: 30 },
    onshore:    { greenMax: 10, yellowMax: 20 },
  },
};
```

- [ ] **Step 4: Update SURFABLE_PANCER_DOOR**

Replace `SURFABLE_PANCER_DOOR` (lines 63-71) with:

```ts
export const SURFABLE_PANCER_DOOR: SpotThresholds = {
  TIDE_GREEN_MIN: 50,
  TIDE_GREEN_FALLING_MIN: 80,
  TIDE_YELLOW_MIN: 30,
  SWELL_GREEN_MIN: 0.5,
  SWELL_YELLOW_MIN: 0.3,
  facingDirection: 180,
  wind: {
    offshore:   { greenMax: 30, yellowMax: 45 },
    crossShore: { greenMax: 20, yellowMax: 30 },
    onshore:    { greenMax: 10, yellowMax: 20 },
  },
};
```

- [ ] **Step 5: Verify config compiles**

Run: `cd /root/surf-pacitan && bun build src/server/config.ts --no-bundle 2>&1 | head -5`

Expected: Build succeeds (there will be type errors in surfable.ts since it still references old fields — that's expected at this step).

- [ ] **Step 6: Commit**

```bash
git add src/server/config.ts
git commit -m "refactor: replace flat wind thresholds with direction-aware config"
```

---

### Task 2: Add wind category helper and update surfable logic

**Files:**
- Modify: `src/server/surfable.ts`

- [ ] **Step 1: Write failing tests for getWindCategory**

Add these tests at the top of `tests/surfable.test.ts` (after the existing imports), importing `getWindCategory`:

```ts
import { computeSurfable, computeAllSpotRatings, getWindCategory } from "../src/server/surfable";
import { SPOT_THRESHOLDS } from "../src/server/config";

describe("getWindCategory", () => {
  // Pancer Door faces 180° (south)
  const facing = 180;

  test("onshore: wind from south (180°) into south-facing beach", () => {
    expect(getWindCategory(180, facing)).toBe("onshore");
  });

  test("onshore: wind from SSW (200°) into south-facing beach — within 60°", () => {
    expect(getWindCategory(200, facing)).toBe("onshore");
  });

  test("offshore: wind from north (0°) — blows from land", () => {
    expect(getWindCategory(0, facing)).toBe("offshore");
  });

  test("offshore: wind from north (360°) — same as 0°", () => {
    expect(getWindCategory(360, facing)).toBe("offshore");
  });

  test("offshore: wind from NNE (30°) into south-facing beach", () => {
    expect(getWindCategory(30, facing)).toBe("offshore");
  });

  test("cross-shore: wind from east (90°)", () => {
    expect(getWindCategory(90, facing)).toBe("crossShore");
  });

  test("cross-shore: wind from west (270°)", () => {
    expect(getWindCategory(270, facing)).toBe("crossShore");
  });

  test("boundary: exactly 60° is cross-shore", () => {
    expect(getWindCategory(240, facing)).toBe("crossShore");
  });

  test("boundary: exactly 120° is cross-shore", () => {
    expect(getWindCategory(300, facing)).toBe("crossShore");
  });

  test("Pancer faces 200° SSW — wind from 200° is onshore", () => {
    expect(getWindCategory(200, 200)).toBe("onshore");
  });

  test("Pancer faces 200° SSW — wind from 20° (NNE) is offshore", () => {
    expect(getWindCategory(20, 200)).toBe("offshore");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/surf-pacitan && bun test tests/surfable.test.ts 2>&1 | tail -10`

Expected: FAIL — `getWindCategory` is not exported / doesn't exist.

- [ ] **Step 3: Implement getWindCategory in surfable.ts**

Add this exported function before `computeSurfable` in `src/server/surfable.ts`:

```ts
export type WindCategory = "offshore" | "crossShore" | "onshore";

export function getWindCategory(windDirection: number, facingDirection: number): WindCategory {
  const raw = Math.abs(windDirection - facingDirection);
  const angleDiff = raw > 180 ? 360 - raw : raw;

  if (angleDiff < 60) return "onshore";
  if (angleDiff > 120) return "offshore";
  return "crossShore";
}
```

- [ ] **Step 4: Run getWindCategory tests to verify they pass**

Run: `cd /root/surf-pacitan && bun test tests/surfable.test.ts --grep "getWindCategory" 2>&1 | tail -10`

Expected: All 11 tests PASS.

- [ ] **Step 5: Update SurfableInput and computeSurfable**

Replace the `SurfableInput` interface and `computeSurfable` function in `src/server/surfable.ts`:

```ts
interface SurfableInput {
  hour: number;
  tidePercent: number;
  tideRising: boolean;
  swellHeight: number;
  windSpeed: number;
  windDirection: number;
  sunrise: string;
  sunset: string;
}

export function computeSurfable(input: SurfableInput, thresholds: SpotThresholds = SURFABLE): SurfableRating {
  const { hour, tidePercent, tideRising, swellHeight, windSpeed, windDirection, sunrise, sunset } = input;

  if (!isWithinDaylight(hour, sunrise, sunset)) return "red";
  if (swellHeight < thresholds.SWELL_YELLOW_MIN) return "red";
  if (tidePercent < thresholds.TIDE_YELLOW_MIN) return "red";

  const windCategory = getWindCategory(windDirection, thresholds.facingDirection);
  const windThresholds = thresholds.wind[windCategory];

  if (windSpeed > windThresholds.yellowMax) return "red";

  // Falling tide is never green — sandbar beachbreaks need rising water
  if (!tideRising) return "yellow";

  const tideGreen = tidePercent >= thresholds.TIDE_GREEN_MIN;
  const swellGreen = swellHeight >= thresholds.SWELL_GREEN_MIN;
  const windGreen = windSpeed <= windThresholds.greenMax;

  if (tideGreen && swellGreen && windGreen) return "green";

  return "yellow";
}
```

Note: The wind check order changed — `windSpeed > yellowMax → red` now uses direction-aware thresholds, so it must come after wind category resolution but before the tide-rising check.

- [ ] **Step 6: Commit**

```bash
git add src/server/surfable.ts tests/surfable.test.ts
git commit -m "feat: add wind direction to surfable rating logic"
```

---

### Task 3: Update existing tests for new input shape

**Files:**
- Modify: `tests/surfable.test.ts`

- [ ] **Step 1: Add windDirection to all existing computeSurfable test inputs**

Every existing `computeSurfable(...)` call needs `windDirection` added. Use `windDirection: 0` (North = offshore for all south-facing spots) to preserve the existing test intent — these tests were written for cross-shore-like thresholds, and offshore is the most permissive, so they should still pass.

Update the `computeSurfable` describe block — replace all test bodies:

```ts
describe("computeSurfable", () => {
  const sunrise = "05:42";
  const sunset = "17:31";

  test("green: rising tide > 50%, good swell, light wind, daylight", () => {
    expect(computeSurfable({ hour: 9, tidePercent: 70, tideRising: true, swellHeight: 1.2, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("green");
  });

  test("yellow: falling tide > 80% — falling is never green", () => {
    expect(computeSurfable({ hour: 11, tidePercent: 85, tideRising: false, swellHeight: 0.8, windSpeed: 15, windDirection: 0, sunrise, sunset })).toBe("yellow");
  });

  test("yellow: mid tide 30-50% rising", () => {
    expect(computeSurfable({ hour: 10, tidePercent: 40, tideRising: true, swellHeight: 0.8, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("yellow");
  });

  test("yellow: good tide but marginal swell 0.3-0.5m", () => {
    expect(computeSurfable({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 0.4, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("yellow");
  });

  test("yellow: good tide/swell but wind 20-30 km/h (cross-shore)", () => {
    // 90° = east = cross-shore for south-facing Pancer Door. crossShore greenMax=20, so 25 is yellow.
    expect(computeSurfable({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 25, windDirection: 90, sunrise, sunset })).toBe("yellow");
  });

  test("red: low tide < 30%", () => {
    expect(computeSurfable({ hour: 10, tidePercent: 15, tideRising: true, swellHeight: 1.0, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("red");
  });

  test("red: flat swell < 0.3m", () => {
    expect(computeSurfable({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 0.2, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("red");
  });

  test("red: blown out onshore wind > 20 km/h", () => {
    // 180° = south = onshore for south-facing Pancer Door. onshore yellowMax=20, so 25 is red.
    expect(computeSurfable({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 25, windDirection: 180, sunrise, sunset })).toBe("red");
  });

  test("red: outside daylight (before sunrise)", () => {
    expect(computeSurfable({ hour: 4, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("red");
  });

  test("red: outside daylight (after sunset)", () => {
    expect(computeSurfable({ hour: 18, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("red");
  });

  test("yellow: falling tide 50-80% range", () => {
    expect(computeSurfable({ hour: 12, tidePercent: 60, tideRising: false, swellHeight: 1.0, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("yellow");
  });
});
```

- [ ] **Step 2: Update computeAllSpotRatings test inputs**

Add `windDirection: 0` (offshore/north) to all inputs in the `computeAllSpotRatings` describe block:

```ts
describe("computeAllSpotRatings", () => {
  const sunrise = "05:42";
  const sunset = "17:31";

  test("Teleng Ria is more tolerant than Pancer Door at mid-tide", () => {
    const result = computeAllSpotRatings({ hour: 10, tidePercent: 30, tideRising: true, swellHeight: 0.8, windSpeed: 10, windDirection: 0, sunrise, sunset });
    expect(result.telengRia).toBe("green");
    expect(result.pancer).toBe("yellow");
    expect(result.pancerDoor).toBe("yellow");
  });

  test("all spots red when flat", () => {
    const result = computeAllSpotRatings({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 0.1, windSpeed: 10, windDirection: 0, sunrise, sunset });
    expect(result.telengRia).toBe("red");
    expect(result.pancer).toBe("red");
    expect(result.pancerDoor).toBe("red");
  });

  test("all spots green in ideal conditions", () => {
    const result = computeAllSpotRatings({ hour: 10, tidePercent: 85, tideRising: true, swellHeight: 1.5, windSpeed: 5, windDirection: 0, sunrise, sunset });
    expect(result.telengRia).toBe("green");
    expect(result.pancer).toBe("green");
    expect(result.pancerDoor).toBe("green");
  });

  test("Teleng Ria tolerates more wind (cross-shore)", () => {
    // 90° = cross-shore. Teleng Ria crossShore greenMax=25, Pancer/Door crossShore greenMax=20.
    const result = computeAllSpotRatings({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 22, windDirection: 90, sunrise, sunset });
    expect(result.telengRia).toBe("green");
    expect(result.pancer).toBe("yellow");
    expect(result.pancerDoor).toBe("yellow");
  });
});
```

- [ ] **Step 3: Run all tests to verify they pass**

Run: `cd /root/surf-pacitan && bun test tests/surfable.test.ts 2>&1`

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/surfable.test.ts
git commit -m "test: update existing tests for wind direction input"
```

---

### Task 4: Add wind direction-specific test cases

**Files:**
- Modify: `tests/surfable.test.ts`

- [ ] **Step 1: Add wind direction comparison tests**

Add a new describe block at the end of `tests/surfable.test.ts`:

```ts
describe("wind direction affects rating", () => {
  const sunrise = "05:42";
  const sunset = "17:31";
  // Base conditions: good tide, good swell, rising — only wind varies
  const base = { hour: 10, tidePercent: 70, tideRising: true, swellHeight: 1.0, sunrise, sunset };

  test("15 km/h onshore (180°) is yellow, same speed offshore (0°) is green", () => {
    // Pancer Door: onshore greenMax=10, offshore greenMax=30
    expect(computeSurfable({ ...base, windSpeed: 15, windDirection: 180 })).toBe("yellow");
    expect(computeSurfable({ ...base, windSpeed: 15, windDirection: 0 })).toBe("green");
  });

  test("25 km/h onshore (180°) is red, same speed offshore (0°) is green", () => {
    // Pancer Door: onshore yellowMax=20 → red; offshore greenMax=30 → green
    expect(computeSurfable({ ...base, windSpeed: 25, windDirection: 180 })).toBe("red");
    expect(computeSurfable({ ...base, windSpeed: 25, windDirection: 0 })).toBe("green");
  });

  test("25 km/h cross-shore (90°) is yellow", () => {
    // Pancer Door: crossShore greenMax=20, yellowMax=30 → yellow
    expect(computeSurfable({ ...base, windSpeed: 25, windDirection: 90 })).toBe("yellow");
  });

  test("40 km/h offshore (0°) is yellow, not red", () => {
    // Pancer Door: offshore greenMax=30, yellowMax=45 → yellow
    expect(computeSurfable({ ...base, windSpeed: 40, windDirection: 0 })).toBe("yellow");
  });

  test("50 km/h offshore (0°) is red — even offshore has limits", () => {
    // Pancer Door: offshore yellowMax=45 → red
    expect(computeSurfable({ ...base, windSpeed: 50, windDirection: 0 })).toBe("red");
  });

  test("Pancer (200° SSW facing) — wind from 200° is onshore", () => {
    // 15 km/h onshore: Pancer onshore greenMax=10 → yellow
    expect(computeSurfable({ ...base, windSpeed: 15, windDirection: 200 }, SPOT_THRESHOLDS.pancer)).toBe("yellow");
    // Same speed offshore (20°): Pancer offshore greenMax=30 → green
    expect(computeSurfable({ ...base, windSpeed: 15, windDirection: 20 }, SPOT_THRESHOLDS.pancer)).toBe("green");
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `cd /root/surf-pacitan && bun test tests/surfable.test.ts 2>&1`

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/surfable.test.ts
git commit -m "test: add wind direction comparison test cases"
```

---

### Task 5: Pass windDirection through cron.ts call sites

**Files:**
- Modify: `src/server/cron.ts`

There are 3 places where `computeAllSpotRatings` is called. Each needs `windDirection` added.

- [ ] **Step 1: Update call site 1 — fetchAndCacheTides (line ~88)**

This is the tide-only fetch (no weather data yet). Wind direction defaults to 0 (north = offshore for south-facing spots — safe default).

In `src/server/cron.ts`, find the `computeAllSpotRatings` call around line 88 and add `windDirection: 0`:

```ts
        surfable: computeAllSpotRatings({
          hour: sl.hour,
          tidePercent,
          tideRising: sl.rising,
          swellHeight: 0,
          windSpeed: 0,
          windDirection: 0,
          sunrise: astronomy.sunrise,
          sunset: astronomy.sunset,
        }),
```

- [ ] **Step 2: Update call site 2 — mergeWeatherIntoCache with existing tide data (line ~164)**

Here we have real wind data from `wind` variable. Use `wind.direction`:

```ts
        const surfable = computeAllSpotRatings({
          hour: h.hour,
          tidePercent,
          tideRising: h.tide.rising,
          swellHeight: swell.height,
          windSpeed: wind.speed,
          windDirection: wind.direction,
          sunrise: cachedDay.astronomy.sunrise,
          sunset: cachedDay.astronomy.sunset,
        });
```

- [ ] **Step 3: Update call site 3 — mergeWeatherIntoCache without prior cache (line ~194)**

Same pattern — `wind.direction` is available:

```ts
        const surfable = computeAllSpotRatings({
          hour,
          tidePercent: 50,
          tideRising: false,
          swellHeight: swell.height,
          windSpeed: wind.speed,
          windDirection: wind.direction,
          sunrise: "06:00",
          sunset: "18:00",
        });
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /root/surf-pacitan && bun build src/server/cron.ts --no-bundle 2>&1 | head -5`

Expected: No type errors.

- [ ] **Step 5: Run all tests**

Run: `cd /root/surf-pacitan && bun test 2>&1`

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/cron.ts
git commit -m "feat: pass wind direction to surfable rating in cron jobs"
```

---

### Task 6: Build, deploy, verify

- [ ] **Step 1: Run full test suite**

Run: `cd /root/surf-pacitan && bun test 2>&1`

Expected: All tests PASS.

- [ ] **Step 2: Build production frontend**

Run: `cd /root/surf-pacitan && bun run build 2>&1`

Expected: Build succeeds, output to `/var/www/surf-pacitan/`.

- [ ] **Step 3: Restart service**

Run: `systemctl restart surf-pacitan.service && systemctl status surf-pacitan.service`

Expected: Active (running).

- [ ] **Step 4: Verify API returns data**

Run: `curl -s http://localhost:3100/api/forecast | jq '.days[0].hourly[10].surfable'`

Expected: JSON with `telengRia`, `pancer`, `pancerDoor` ratings.

- [ ] **Step 5: Commit all and push**

```bash
git push github-surf-pacitan main
```
