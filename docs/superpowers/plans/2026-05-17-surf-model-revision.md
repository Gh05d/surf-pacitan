# Surf Model Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the surfable rating function with a per-factor cascade that uses swell direction, swell period, and per-spot tide bell curves, so each Pacitan spot is rated according to its own ideal conditions.

**Architecture:** Extend `SpotThresholds` in `src/server/config.ts` with structured per-factor windows (`tide`, `swellDir`, `swellHeight`, `swellPeriod`). Refactor `src/server/surfable.ts` into small per-factor quality functions whose results are min-combined into the final red/yellow/green rating. Wire `swellDirection` and `swellPeriod` through `cron.ts`.

**Tech Stack:** TypeScript (Bun runtime), Bun test runner. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-17-surf-model-revision-design.md`](../specs/2026-05-17-surf-model-revision-design.md)

---

## File Map

- **Modify** `src/server/config.ts` — replace `SpotThresholds` interface and `SURFABLE_*` constants with new structure
- **Modify** `src/server/surfable.ts` — add `Quality`, `angularDistance`, per-factor `compute*Quality` helpers, refactor `computeSurfable` into cascade
- **Modify** `src/server/cron.ts` — pass `swellPeriod` and `swellDirection` through the three `computeAllSpotRatings` call sites (lines ~88, ~165, ~196)
- **Modify** `tests/surfable.test.ts` — rewrite to test per-factor functions and the validation table from the spec
- **Modify** `CLAUDE.md` — update Pancer Door tide note (current "low = too shallow, rising to high = ideal" is wrong; Pancer Door drowns at full high)

---

### Task 1: Update SurfableInput and SpotThresholds types

**Files:**
- Modify: `src/server/surfable.ts:5-14` (SurfableInput)
- Modify: `src/server/config.ts:33-50` (SpotThresholds interface)

- [ ] **Step 1: Extend `SurfableInput` with new fields**

In `src/server/surfable.ts`, replace lines 5–14:

```ts
interface SurfableInput {
  hour: number;
  tidePercent: number;
  tideRising: boolean;
  swellHeight: number;
  swellPeriod: number;       // seconds
  swellDirection: number;    // degrees, 0=N
  windSpeed: number;
  windDirection: number;
  sunrise: string;
  sunset: string;
}
```

- [ ] **Step 2: Replace `SpotThresholds` interface**

In `src/server/config.ts`, replace lines 33–50 with:

```ts
export interface WindDirectionThresholds {
  greenMax: number;  // km/h
  yellowMax: number; // km/h
}

export interface SpotThresholds {
  tide: {
    greenMin: number;
    greenMax: number;
    yellowMin: number;
    yellowMax: number;
  };
  swellDir: {
    ideal: number;       // degrees, 0=N
    greenWindow: number; // ± degrees still green
    yellowWindow: number;// ± degrees still yellow
  };
  swellHeight: { greenMin: number; yellowMin: number };
  swellPeriod: { greenMin: number; yellowMin: number };
  facingDirection: number;
  wind: {
    offshore:   WindDirectionThresholds;
    crossShore: WindDirectionThresholds;
    onshore:    WindDirectionThresholds;
  };
}
```

(`WindDirectionThresholds` stays the same; the `wind` block keeps its existing shape.)

- [ ] **Step 3: Verify compile fails**

Run: `bun run build 2>&1 | head -40`
Expected: Many TypeScript errors in `surfable.ts` (uses `thresholds.SWELL_YELLOW_MIN` etc. which no longer exist) and in `cron.ts` (call sites missing `swellPeriod`/`swellDirection`). This is expected — we'll fix in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git -C /root/surf-pacitan add src/server/surfable.ts src/server/config.ts
git -C /root/surf-pacitan commit -m "refactor: extend SurfableInput and SpotThresholds types for revised rating model"
```

---

### Task 2: Add `Quality` type, `minQuality`, and `angularDistance` helpers

**Files:**
- Modify: `tests/surfable.test.ts` (add new tests at top)
- Modify: `src/server/surfable.ts` (add helpers after line 14)

- [ ] **Step 1: Write the failing tests**

Add to top of `tests/surfable.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import {
  computeSurfable,
  computeAllSpotRatings,
  getWindCategory,
  angularDistance,
  minQuality,
} from "../src/server/surfable";
import { SPOT_THRESHOLDS } from "../src/server/config";

describe("angularDistance", () => {
  test("same direction", () => {
    expect(angularDistance(180, 180)).toBe(0);
  });
  test("small positive delta", () => {
    expect(angularDistance(200, 195)).toBe(5);
  });
  test("small negative delta", () => {
    expect(angularDistance(195, 200)).toBe(5);
  });
  test("wraparound at 0/360", () => {
    expect(angularDistance(350, 10)).toBe(20);
    expect(angularDistance(10, 350)).toBe(20);
  });
  test("opposite directions", () => {
    expect(angularDistance(0, 180)).toBe(180);
  });
  test("values > 360 (defensive)", () => {
    expect(angularDistance(370, 10)).toBe(0);
  });
});

describe("minQuality", () => {
  test("all green → green", () => {
    expect(minQuality(["green", "green", "green"])).toBe("green");
  });
  test("one yellow → yellow", () => {
    expect(minQuality(["green", "yellow", "green"])).toBe("yellow");
  });
  test("one red → red", () => {
    expect(minQuality(["green", "yellow", "red"])).toBe("red");
  });
  test("single value", () => {
    expect(minQuality(["yellow"])).toBe("yellow");
  });
});
```

(Note: this also changes the import to add the new exports. The rest of the file imports will be updated in later tasks.)

- [ ] **Step 2: Run tests, expect failure**

Run: `bun test tests/surfable.test.ts 2>&1 | head -30`
Expected: Import error — `angularDistance` and `minQuality` are not exported from `surfable.ts`.

- [ ] **Step 3: Implement helpers**

In `src/server/surfable.ts`, add after the existing `isWithinDaylight` function:

```ts
export type Quality = "red" | "yellow" | "green";

const QUALITY_ORDER: Record<Quality, number> = { red: 0, yellow: 1, green: 2 };

export function minQuality(qs: Quality[]): Quality {
  return qs.reduce((a, b) => (QUALITY_ORDER[a] < QUALITY_ORDER[b] ? a : b));
}

export function angularDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}
```

- [ ] **Step 4: Run tests, expect angularDistance + minQuality tests pass**

Run: `bun test tests/surfable.test.ts -t "angularDistance|minQuality" 2>&1 | tail -10`
Expected: All angularDistance and minQuality tests pass. (Other tests may still fail — ignore for now.)

- [ ] **Step 5: Commit**

```bash
git -C /root/surf-pacitan add src/server/surfable.ts tests/surfable.test.ts
git -C /root/surf-pacitan commit -m "feat(surfable): add Quality, minQuality, angularDistance helpers"
```

---

### Task 3: Add `computeTideQuality`

**Files:**
- Modify: `tests/surfable.test.ts` (append new describe block)
- Modify: `src/server/surfable.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/surfable.test.ts`:

```ts
import { computeTideQuality } from "../src/server/surfable";

describe("computeTideQuality", () => {
  const t = { greenMin: 30, greenMax: 60, yellowMin: 15, yellowMax: 80 };

  test("inside green window", () => {
    expect(computeTideQuality(45, t)).toBe("green");
  });
  test("at green lower edge", () => {
    expect(computeTideQuality(30, t)).toBe("green");
  });
  test("at green upper edge", () => {
    expect(computeTideQuality(60, t)).toBe("green");
  });
  test("between green and yellow upper", () => {
    expect(computeTideQuality(70, t)).toBe("yellow");
  });
  test("between yellow lower and green lower", () => {
    expect(computeTideQuality(20, t)).toBe("yellow");
  });
  test("above yellowMax → red", () => {
    expect(computeTideQuality(85, t)).toBe("red");
  });
  test("below yellowMin → red", () => {
    expect(computeTideQuality(10, t)).toBe("red");
  });
});
```

(Note: the import line at the top of the test file should already exist from Task 2; adjust the import statement to add `computeTideQuality`. To avoid duplicate imports, merge into the existing import.)

- [ ] **Step 2: Run tests, expect failure**

Run: `bun test tests/surfable.test.ts -t "computeTideQuality" 2>&1 | tail -15`
Expected: Import error or "computeTideQuality is not a function".

- [ ] **Step 3: Implement**

In `src/server/surfable.ts`, add after `angularDistance`:

```ts
export function computeTideQuality(
  tidePercent: number,
  t: SpotThresholds["tide"]
): Quality {
  if (tidePercent < t.yellowMin || tidePercent > t.yellowMax) return "red";
  if (tidePercent >= t.greenMin && tidePercent <= t.greenMax) return "green";
  return "yellow";
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `bun test tests/surfable.test.ts -t "computeTideQuality" 2>&1 | tail -10`
Expected: All `computeTideQuality` tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /root/surf-pacitan add src/server/surfable.ts tests/surfable.test.ts
git -C /root/surf-pacitan commit -m "feat(surfable): add computeTideQuality"
```

---

### Task 4: Add `computeSwellDirQuality`

**Files:**
- Modify: `tests/surfable.test.ts`
- Modify: `src/server/surfable.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/surfable.test.ts`:

```ts
import { computeSwellDirQuality } from "../src/server/surfable";

describe("computeSwellDirQuality", () => {
  const t = { ideal: 195, greenWindow: 15, yellowWindow: 30 };

  test("exactly on ideal", () => {
    expect(computeSwellDirQuality(195, t)).toBe("green");
  });
  test("within green window", () => {
    expect(computeSwellDirQuality(205, t)).toBe("green");
  });
  test("at green edge", () => {
    expect(computeSwellDirQuality(210, t)).toBe("green");
  });
  test("just outside green, inside yellow", () => {
    expect(computeSwellDirQuality(215, t)).toBe("yellow");
  });
  test("at yellow edge", () => {
    expect(computeSwellDirQuality(225, t)).toBe("yellow");
  });
  test("outside yellow → red", () => {
    expect(computeSwellDirQuality(230, t)).toBe("red");
  });
  test("wraparound: ideal 10°, swell at 350° (Δ=20°)", () => {
    const wrap = { ideal: 10, greenWindow: 15, yellowWindow: 30 };
    expect(computeSwellDirQuality(350, wrap)).toBe("yellow");
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `bun test tests/surfable.test.ts -t "computeSwellDirQuality" 2>&1 | tail -10`
Expected: Import error.

- [ ] **Step 3: Implement**

In `src/server/surfable.ts`, add after `computeTideQuality`:

```ts
export function computeSwellDirQuality(
  swellDirection: number,
  t: SpotThresholds["swellDir"]
): Quality {
  const d = angularDistance(swellDirection, t.ideal);
  if (d > t.yellowWindow) return "red";
  if (d <= t.greenWindow) return "green";
  return "yellow";
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `bun test tests/surfable.test.ts -t "computeSwellDirQuality" 2>&1 | tail -10`
Expected: All `computeSwellDirQuality` tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /root/surf-pacitan add src/server/surfable.ts tests/surfable.test.ts
git -C /root/surf-pacitan commit -m "feat(surfable): add computeSwellDirQuality"
```

---

### Task 5: Add `computeSwellHeightQuality`

**Files:**
- Modify: `tests/surfable.test.ts`
- Modify: `src/server/surfable.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/surfable.test.ts`:

```ts
import { computeSwellHeightQuality } from "../src/server/surfable";

describe("computeSwellHeightQuality", () => {
  const t = { greenMin: 0.5, yellowMin: 0.3 };

  test("above greenMin → green", () => {
    expect(computeSwellHeightQuality(1.5, t)).toBe("green");
  });
  test("at greenMin → green", () => {
    expect(computeSwellHeightQuality(0.5, t)).toBe("green");
  });
  test("between yellow and green → yellow", () => {
    expect(computeSwellHeightQuality(0.4, t)).toBe("yellow");
  });
  test("at yellowMin → yellow", () => {
    expect(computeSwellHeightQuality(0.3, t)).toBe("yellow");
  });
  test("below yellowMin → red", () => {
    expect(computeSwellHeightQuality(0.1, t)).toBe("red");
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `bun test tests/surfable.test.ts -t "computeSwellHeightQuality" 2>&1 | tail -10`
Expected: Import error.

- [ ] **Step 3: Implement**

In `src/server/surfable.ts`, add after `computeSwellDirQuality`:

```ts
export function computeSwellHeightQuality(
  swellHeight: number,
  t: SpotThresholds["swellHeight"]
): Quality {
  if (swellHeight < t.yellowMin) return "red";
  if (swellHeight >= t.greenMin) return "green";
  return "yellow";
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `bun test tests/surfable.test.ts -t "computeSwellHeightQuality" 2>&1 | tail -10`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /root/surf-pacitan add src/server/surfable.ts tests/surfable.test.ts
git -C /root/surf-pacitan commit -m "feat(surfable): add computeSwellHeightQuality"
```

---

### Task 6: Add `computeSwellPeriodQuality`

**Files:**
- Modify: `tests/surfable.test.ts`
- Modify: `src/server/surfable.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/surfable.test.ts`:

```ts
import { computeSwellPeriodQuality } from "../src/server/surfable";

describe("computeSwellPeriodQuality", () => {
  const t = { greenMin: 8, yellowMin: 6 };

  test("groundswell 11s → green", () => {
    expect(computeSwellPeriodQuality(11, t)).toBe("green");
  });
  test("at greenMin → green", () => {
    expect(computeSwellPeriodQuality(8, t)).toBe("green");
  });
  test("mid swell 7s → yellow", () => {
    expect(computeSwellPeriodQuality(7, t)).toBe("yellow");
  });
  test("at yellowMin → yellow", () => {
    expect(computeSwellPeriodQuality(6, t)).toBe("yellow");
  });
  test("windswell 5s → red", () => {
    expect(computeSwellPeriodQuality(5, t)).toBe("red");
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `bun test tests/surfable.test.ts -t "computeSwellPeriodQuality" 2>&1 | tail -10`
Expected: Import error.

- [ ] **Step 3: Implement**

In `src/server/surfable.ts`, add after `computeSwellHeightQuality`:

```ts
export function computeSwellPeriodQuality(
  swellPeriod: number,
  t: SpotThresholds["swellPeriod"]
): Quality {
  if (swellPeriod < t.yellowMin) return "red";
  if (swellPeriod >= t.greenMin) return "green";
  return "yellow";
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `bun test tests/surfable.test.ts -t "computeSwellPeriodQuality" 2>&1 | tail -10`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /root/surf-pacitan add src/server/surfable.ts tests/surfable.test.ts
git -C /root/surf-pacitan commit -m "feat(surfable): add computeSwellPeriodQuality"
```

---

### Task 7: Add `computeWindQuality`

**Files:**
- Modify: `tests/surfable.test.ts`
- Modify: `src/server/surfable.ts`

This wraps the existing `getWindCategory` + threshold lookup into a single quality function. `getWindCategory` itself stays unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/surfable.test.ts`:

```ts
import { computeWindQuality } from "../src/server/surfable";

describe("computeWindQuality", () => {
  // Facing 195°. Use Pancer Door's wind block.
  const t = {
    facingDirection: 195,
    wind: {
      offshore:   { greenMax: 30, yellowMax: 45 },
      crossShore: { greenMax: 20, yellowMax: 30 },
      onshore:    { greenMax: 10, yellowMax: 20 },
    },
  };

  test("light onshore (wind from 195°, 6 km/h) → green", () => {
    expect(computeWindQuality(6, 195, t as any)).toBe("green");
  });
  test("medium onshore (15 km/h) → yellow", () => {
    expect(computeWindQuality(15, 195, t as any)).toBe("yellow");
  });
  test("strong onshore (25 km/h) → red", () => {
    expect(computeWindQuality(25, 195, t as any)).toBe("red");
  });
  test("light offshore (wind from 15° ≈ N, 6 km/h) → green", () => {
    expect(computeWindQuality(6, 15, t as any)).toBe("green");
  });
  test("very strong offshore (50 km/h) → red", () => {
    expect(computeWindQuality(50, 15, t as any)).toBe("red");
  });
  test("cross-shore at greenMax boundary", () => {
    // East wind 90° from 195° facing: angleDiff = 105 → crossShore. 20 km/h ≤ 20 greenMax → green.
    expect(computeWindQuality(20, 90, t as any)).toBe("green");
  });
});
```

(The `as any` cast is because `computeWindQuality` takes the full `SpotThresholds` but we're constructing a minimal partial. Alternative: define the test thresholds with all required fields. Up to implementer; cast is fine for unit tests.)

- [ ] **Step 2: Run tests, expect failure**

Run: `bun test tests/surfable.test.ts -t "computeWindQuality" 2>&1 | tail -10`
Expected: Import error.

- [ ] **Step 3: Implement**

In `src/server/surfable.ts`, add after `computeSwellPeriodQuality`:

```ts
export function computeWindQuality(
  windSpeed: number,
  windDirection: number,
  thresholds: SpotThresholds
): Quality {
  const category = getWindCategory(windDirection, thresholds.facingDirection);
  const w = thresholds.wind[category];
  if (windSpeed > w.yellowMax) return "red";
  if (windSpeed <= w.greenMax) return "green";
  return "yellow";
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `bun test tests/surfable.test.ts -t "computeWindQuality" 2>&1 | tail -10`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /root/surf-pacitan add src/server/surfable.ts tests/surfable.test.ts
git -C /root/surf-pacitan commit -m "feat(surfable): add computeWindQuality"
```

---

### Task 8: Update `SPOT_THRESHOLDS` with new per-spot values

**Files:**
- Modify: `src/server/config.ts:52-100` (replace the three `SURFABLE_*` constants)

- [ ] **Step 1: Replace the three spot constants**

In `src/server/config.ts`, replace lines 52–100 with:

```ts
export const SURFABLE_TELENG_RIA: SpotThresholds = {
  tide:        { greenMin: 50, greenMax: 90, yellowMin: 30, yellowMax: 98 },
  swellDir:    { ideal: 215, greenWindow: 25, yellowWindow: 45 },
  swellHeight: { greenMin: 0.4, yellowMin: 0.2 },
  swellPeriod: { greenMin: 7,   yellowMin: 5 },
  facingDirection: 195,
  wind: {
    offshore:   { greenMax: 35, yellowMax: 50 },
    crossShore: { greenMax: 25, yellowMax: 35 },
    onshore:    { greenMax: 15, yellowMax: 25 },
  },
};

export const SURFABLE_PANCER: SpotThresholds = {
  tide:        { greenMin: 30, greenMax: 60, yellowMin: 15, yellowMax: 80 },
  swellDir:    { ideal: 195, greenWindow: 15, yellowWindow: 30 },
  swellHeight: { greenMin: 0.5, yellowMin: 0.3 },
  swellPeriod: { greenMin: 8,   yellowMin: 6 },
  facingDirection: 195,
  wind: {
    offshore:   { greenMax: 30, yellowMax: 45 },
    crossShore: { greenMax: 20, yellowMax: 30 },
    onshore:    { greenMax: 10, yellowMax: 20 },
  },
};

export const SURFABLE_PANCER_DOOR: SpotThresholds = {
  tide:        { greenMin: 35, greenMax: 80, yellowMin: 20, yellowMax: 95 },
  swellDir:    { ideal: 210, greenWindow: 25, yellowWindow: 45 },
  swellHeight: { greenMin: 0.5, yellowMin: 0.3 },
  swellPeriod: { greenMin: 8,   yellowMin: 6 },
  facingDirection: 195,
  wind: {
    offshore:   { greenMax: 30, yellowMax: 45 },
    crossShore: { greenMax: 20, yellowMax: 30 },
    onshore:    { greenMax: 10, yellowMax: 20 },
  },
};

export const SURFABLE = SURFABLE_PANCER_DOOR;

export const SPOT_THRESHOLDS = {
  telengRia: SURFABLE_TELENG_RIA,
  pancer: SURFABLE_PANCER,
  pancerDoor: SURFABLE_PANCER_DOOR,
} as const;
```

- [ ] **Step 2: Verify types compile**

Run: `bun run build 2>&1 | grep -E "error TS|config\.ts" | head -10`
Expected: No errors in `config.ts`. `surfable.ts` and `cron.ts` may still error — that's fine.

- [ ] **Step 3: Commit**

```bash
git -C /root/surf-pacitan add src/server/config.ts
git -C /root/surf-pacitan commit -m "feat(config): per-spot tide bell curves and swell direction windows"
```

---

### Task 9: Refactor `computeSurfable` to use the cascade

**Files:**
- Modify: `src/server/surfable.ts` (replace the body of `computeSurfable`, lines 33–55)

- [ ] **Step 1: Write the failing integration tests**

Append to `tests/surfable.test.ts` (note: the existing `describe("computeSurfable", ...)` block from the current file will be replaced; for now, append a new block with the validation-table cases):

```ts
describe("computeSurfable — 2026-05-17 validation table", () => {
  // From the spec validation: sunrise 05:41, sunset 17:25.
  // Swell 1.50m @ 11s, direction 201°. Wind light from E.
  const sunrise = "05:41";
  const sunset = "17:25";

  // Build a helper because input fields are many.
  function input(hour: number, tidePercent: number, tideRising: boolean) {
    return {
      hour,
      tidePercent,
      tideRising,
      swellHeight: 1.5,
      swellPeriod: 11,
      swellDirection: 201,
      windSpeed: 6,
      windDirection: 90,
      sunrise,
      sunset,
    };
  }

  test("Pancer 05:00 tide 57% rising → green", () => {
    expect(computeSurfable(input(5, 57, true), SPOT_THRESHOLDS.pancer)).toBe("green");
  });
  test("Pancer 06:00 tide 76% rising → yellow (above greenMax 60)", () => {
    expect(computeSurfable(input(6, 76, true), SPOT_THRESHOLDS.pancer)).toBe("yellow");
  });
  test("Pancer 07:00 tide 92% rising → red (above yellowMax 80)", () => {
    expect(computeSurfable(input(7, 92, true), SPOT_THRESHOLDS.pancer)).toBe("red");
  });
  test("Pancer 08:00 tide 100% peak → red", () => {
    expect(computeSurfable(input(8, 100, true), SPOT_THRESHOLDS.pancer)).toBe("red");
  });
  test("Pancer 09:00 tide 98% falling → red (still above yellowMax)", () => {
    expect(computeSurfable(input(9, 98, false), SPOT_THRESHOLDS.pancer)).toBe("red");
  });

  test("Pancer Door 05:00 tide 57% rising → green", () => {
    expect(computeSurfable(input(5, 57, true), SPOT_THRESHOLDS.pancerDoor)).toBe("green");
  });
  test("Pancer Door 06:00 tide 76% rising → green", () => {
    expect(computeSurfable(input(6, 76, true), SPOT_THRESHOLDS.pancerDoor)).toBe("green");
  });
  test("Pancer Door 07:00 tide 92% rising → yellow (in 80-95 band)", () => {
    expect(computeSurfable(input(7, 92, true), SPOT_THRESHOLDS.pancerDoor)).toBe("yellow");
  });
  test("Pancer Door 09:00 tide 98% falling → red (above yellowMax 95)", () => {
    expect(computeSurfable(input(9, 98, false), SPOT_THRESHOLDS.pancerDoor)).toBe("red");
  });
  test("Pancer Door 11:00 tide 67% falling → yellow (green capped by falling)", () => {
    expect(computeSurfable(input(11, 67, false), SPOT_THRESHOLDS.pancerDoor)).toBe("yellow");
  });

  test("Teleng Ria 05:00 tide 57% rising → green", () => {
    expect(computeSurfable(input(5, 57, true), SPOT_THRESHOLDS.telengRia)).toBe("green");
  });
  test("Teleng Ria 07:00 tide 92% rising → yellow (above greenMax 90)", () => {
    expect(computeSurfable(input(7, 92, true), SPOT_THRESHOLDS.telengRia)).toBe("yellow");
  });
  test("Teleng Ria 08:00 tide 100% peak → yellow", () => {
    expect(computeSurfable(input(8, 100, true), SPOT_THRESHOLDS.telengRia)).toBe("yellow");
  });
  test("Teleng Ria 09:00 tide 98% falling → yellow", () => {
    expect(computeSurfable(input(9, 98, false), SPOT_THRESHOLDS.telengRia)).toBe("yellow");
  });

  test("All spots red before sunrise", () => {
    expect(computeSurfable(input(4, 50, true), SPOT_THRESHOLDS.pancer)).toBe("red");
    expect(computeSurfable(input(4, 50, true), SPOT_THRESHOLDS.pancerDoor)).toBe("red");
    expect(computeSurfable(input(4, 50, true), SPOT_THRESHOLDS.telengRia)).toBe("red");
  });

  test("Falling-tide cap: green factors capped to yellow on falling tide", () => {
    // Pancer Door, hour 10, tide 50% (well within green window), all other factors green, falling.
    expect(computeSurfable(input(10, 50, false), SPOT_THRESHOLDS.pancerDoor)).toBe("yellow");
  });
});
```

- [ ] **Step 2: Run, expect failures (current `computeSurfable` uses old fields)**

Run: `bun test tests/surfable.test.ts -t "2026-05-17 validation table" 2>&1 | tail -20`
Expected: Compile errors or runtime errors — `computeSurfable` body references the obsolete `thresholds.SWELL_YELLOW_MIN` etc.

- [ ] **Step 3: Replace `computeSurfable` body**

In `src/server/surfable.ts`, replace the entire `computeSurfable` function (currently lines 33–55) with:

```ts
export function computeSurfable(input: SurfableInput, thresholds: SpotThresholds = SURFABLE): Quality {
  if (!isWithinDaylight(input.hour, input.sunrise, input.sunset)) return "red";

  const tideQ      = computeTideQuality(input.tidePercent, thresholds.tide);
  const swellDirQ  = computeSwellDirQuality(input.swellDirection, thresholds.swellDir);
  const swellHQ    = computeSwellHeightQuality(input.swellHeight, thresholds.swellHeight);
  const swellPQ    = computeSwellPeriodQuality(input.swellPeriod, thresholds.swellPeriod);
  const windQ      = computeWindQuality(input.windSpeed, input.windDirection, thresholds);

  let final = minQuality([tideQ, swellDirQ, swellHQ, swellPQ, windQ]);

  // Falling-tide cap: sandbar breaks need rising water — green degrades to yellow.
  if (!input.tideRising && final === "green") final = "yellow";

  return final;
}
```

Note: return type narrows from `SurfableRating` to `Quality`. They're equivalent string unions; if TypeScript complains in `computeAllSpotRatings`, update its return type to use `Quality` or keep `SurfableRating` (they're structurally identical — pick one and align).

Recommended: in `src/shared/types.ts`, leave `SurfableRating` as-is (it's the public-API type used in `SpotRatings`). In `surfable.ts`, alias: `export type Quality = SurfableRating;` instead of redefining. Adjust Task 2's step 3 retroactively if needed (the redefinition will type-check identically but the alias is cleaner).

If you went with the redefinition and want to clean up: replace the `Quality` definition in `surfable.ts` with:

```ts
import type { SurfableRating } from "../shared/types";
export type Quality = SurfableRating;
```

- [ ] **Step 4: Run validation-table tests, expect pass**

Run: `bun test tests/surfable.test.ts -t "2026-05-17 validation table" 2>&1 | tail -25`
Expected: All 16 validation-table tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /root/surf-pacitan add src/server/surfable.ts tests/surfable.test.ts
git -C /root/surf-pacitan commit -m "feat(surfable): refactor computeSurfable to per-factor cascade"
```

---

### Task 10: Wire `swellPeriod` and `swellDirection` through `cron.ts`

**Files:**
- Modify: `src/server/cron.ts` at the three `computeAllSpotRatings({...})` call sites

- [ ] **Step 1: Inspect call sites**

Run: `grep -n "computeAllSpotRatings" /root/surf-pacitan/src/server/cron.ts`
Expected output: three matches around lines 88, 165, 196.

- [ ] **Step 2: Update first call site (~line 88, inside `fetchAndCacheTides`)**

In `src/server/cron.ts`, find the block starting `surfable: computeAllSpotRatings({` (currently ~line 88). The block passes tide-only fields (swell/wind are still zero at this stage — tides run first, weather merges later). Update the call to:

```ts
surfable: computeAllSpotRatings({
  hour: sl.hour,
  tidePercent,
  tideRising: sl.rising,
  swellHeight: 0,
  swellPeriod: 0,
  swellDirection: 0,
  windSpeed: 0,
  windDirection: 0,
  sunrise: astronomy.sunrise,
  sunset: astronomy.sunset,
}),
```

This first-pass rating will be all-red (swellPeriod=0 < yellowMin=5, swellHeight=0 < yellowMin=0.2, etc.), but that's fine — `fetchAndCacheWeather` runs immediately after on startup (see `src/server/cron.ts` `startScheduler`) and overwrites the rating with real values. The all-red interim state is invisible to users.

- [ ] **Step 3: Update second call site (~line 165, inside `fetchAndCacheWeather` merge path)**

In `src/server/cron.ts`, find the call site that already has `swellHeight: swell.height` (currently ~line 165). Add the two new fields:

```ts
const surfable = computeAllSpotRatings({
  hour: h.hour,
  tidePercent,
  tideRising: h.tide.rising,
  swellHeight: swell.height,
  swellPeriod: swell.period,
  swellDirection: swell.direction,
  windSpeed: wind.speed,
  windDirection: wind.direction,
  sunrise: cachedDay.astronomy.sunrise,
  sunset: cachedDay.astronomy.sunset,
});
```

- [ ] **Step 4: Update third call site (~line 196, `fetchAndCacheWeather` cache-miss path)**

In `src/server/cron.ts`, find the third call (cache-miss branch, currently ~line 196). Update:

```ts
const surfable = computeAllSpotRatings({
  hour,
  tidePercent: 50,
  tideRising: false,
  swellHeight: swell.height,
  swellPeriod: swell.period,
  swellDirection: swell.direction,
  windSpeed: wind.speed,
  windDirection: wind.direction,
  sunrise: "06:00",
  sunset: "18:00",
});
```

- [ ] **Step 5: Verify build clean**

Run: `bun run build 2>&1 | grep -E "error TS" | head -20`
Expected: No TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git -C /root/surf-pacitan add src/server/cron.ts
git -C /root/surf-pacitan commit -m "feat(cron): pass swellPeriod and swellDirection to rating function"
```

---

### Task 11: Clean up obsolete tests and add validation-table-only existing tests

**Files:**
- Modify: `tests/surfable.test.ts` (remove obsolete `describe("computeSurfable", …)` and `describe("computeAllSpotRatings", …)` and `describe("wind direction affects rating", …)` blocks that reference the old threshold structure; replace with updated versions)

- [ ] **Step 1: Audit existing tests for stale assumptions**

Run: `bun test tests/surfable.test.ts 2>&1 | tail -40`
Expected: Some tests still pass (`getWindCategory`, helpers, validation table), but the old `computeSurfable` / `computeAllSpotRatings` / `wind direction` describe blocks fail because their input fixtures lack `swellPeriod`/`swellDirection` and their threshold expectations are obsolete.

- [ ] **Step 2: Delete obsolete describe blocks**

In `tests/surfable.test.ts`, delete the three legacy describe blocks (originally lines ~54–178):

- `describe("computeSurfable", () => { ... })`
- `describe("computeAllSpotRatings", () => { ... })`
- `describe("wind direction affects rating", () => { ... })`

Keep the `describe("getWindCategory", …)` block at the top (it still tests valid public API).

- [ ] **Step 3: Add a focused `computeAllSpotRatings` integration test**

Append to `tests/surfable.test.ts`:

```ts
describe("computeAllSpotRatings — 2026-05-17 differentiation", () => {
  const sunrise = "05:41";
  const sunset = "17:25";

  test("07:00 high tide differentiates the three spots", () => {
    // Exactly the conditions observed today @ 07:00.
    const result = computeAllSpotRatings({
      hour: 7,
      tidePercent: 92,
      tideRising: true,
      swellHeight: 1.5,
      swellPeriod: 11,
      swellDirection: 201,
      windSpeed: 6,
      windDirection: 90,
      sunrise,
      sunset,
    });
    expect(result.pancer).toBe("red");       // drowned river-mouth sandbar
    expect(result.pancerDoor).toBe("yellow"); // mushy, surfable inside
    expect(result.telengRia).toBe("yellow");  // edge of green window
  });

  test("05:00 rising-tide morning works for everyone", () => {
    const result = computeAllSpotRatings({
      hour: 5,
      tidePercent: 57,
      tideRising: true,
      swellHeight: 1.5,
      swellPeriod: 11,
      swellDirection: 201,
      windSpeed: 6,
      windDirection: 90,
      sunrise,
      sunset,
    });
    expect(result.pancer).toBe("green");
    expect(result.pancerDoor).toBe("green");
    expect(result.telengRia).toBe("green");
  });
});
```

- [ ] **Step 4: Run full test file**

Run: `bun test tests/surfable.test.ts 2>&1 | tail -15`
Expected: All tests pass.

- [ ] **Step 5: Run the whole test suite to catch regressions elsewhere**

Run: `bun test 2>&1 | tail -10`
Expected: All tests pass across `surfable.test.ts`, `open-meteo.test.ts`, `stormglass.test.ts`.

- [ ] **Step 6: Commit**

```bash
git -C /root/surf-pacitan add tests/surfable.test.ts
git -C /root/surf-pacitan commit -m "test(surfable): replace obsolete tests with per-factor + validation-table suite"
```

---

### Task 12: Update CLAUDE.md note on Pancer Door tide

**Files:**
- Modify: `CLAUDE.md`

The current note says: *"Pancer Door is a south-facing sandbar break — low tide = too shallow, rising to high tide = ideal. Falling tide is never green (sandbar beachbreaks need rising water)."* This is inaccurate: Pancer (the river-mouth sandbar at the western end of the bay) drowns at full high tide. The new model expresses per-spot tide bell curves; the doc should reflect that.

- [ ] **Step 1: Locate the Pancer Door / surfable note in CLAUDE.md**

Run: `grep -n "Pancer Door is a south-facing\|Falling tide is never green" /root/surf-pacitan/CLAUDE.md`
Expected: One match in the "Surfable logic" paragraph in the Architecture section.

- [ ] **Step 2: Replace the paragraph**

Find the surfable-logic paragraph (begins with `**Surfable logic (\`surfable.ts\`):**`) and replace it with:

```md
**Surfable logic (`surfable.ts`):** Rates each hour green/yellow/red as the weakest link across five per-factor judgments: tide bell curve, swell direction window, swell height, swell period, and wind speed (categorized as offshore/cross-shore/onshore via `getWindCategory` against `facingDirection`). Each spot has its own thresholds in `config.ts`. **Tide curves are per-spot**: Pancer (river-mouth sandbar at the western end of the bay) drowns at high tide and works best at lower-mid rising; Pancer Door (middle, long open beach) tolerates higher tide; Teleng Ria (east end) handles peak high best. **Swell direction is per-spot**: Pancer is sheltered from SW by the western headland and prefers more southerly swells; Teleng Ria prefers SW. A global falling-tide cap downgrades any green result to yellow because sandbar breaks need rising water.
```

- [ ] **Step 3: Commit**

```bash
git -C /root/surf-pacitan add CLAUDE.md
git -C /root/surf-pacitan commit -m "docs: update CLAUDE.md to describe per-factor cascade and per-spot tide curves"
```

---

### Task 13: Build, deploy, and verify against live API

**Files:**
- None (deploy + verify)

- [ ] **Step 1: Build production bundle**

Run: `cd /root/surf-pacitan && bun run build 2>&1 | tail -20`
Expected: Build succeeds, files written to `/var/www/surf-pacitan/`.

- [ ] **Step 2: Restart the service**

Run: `systemctl restart surf-pacitan.service && sleep 3 && systemctl status surf-pacitan.service --no-pager | head -10`
Expected: `active (running)`.

- [ ] **Step 3: Query today's forecast and compare to expected**

Run:
```bash
curl -s http://127.0.0.1:3100/api/forecast 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
today = next((day for day in d['days'] if day['date'] == '2026-05-17'), None)
if not today:
    print('No 2026-05-17 in cache'); sys.exit()
print('Hours 5-11 (today, 2026-05-17):')
for h in today['hourly']:
    if 5 <= h['hour'] <= 11:
        r = h['surfable']
        print(f\"  h={h['hour']:02d}: tide={h['tide']['height']:.2f}m rising={h['tide']['rising']} swell {h['swell']['height']:.2f}m@{h['swell']['period']:.1f}s {h['swell']['direction']:3d}° → P={r['pancer']:6s} PD={r['pancerDoor']:6s} TR={r['telengRia']}\")"
```

Expected output shape (the exact ratings should match the validation table):
```
h=05: ... → P=green  PD=green  TR=green
h=06: ... → P=yellow PD=green  TR=green
h=07: ... → P=red    PD=yellow TR=yellow
h=08: ... → P=red    PD=yellow TR=yellow
h=09: ... → P=red    PD=yellow TR=yellow
h=10: ... → P=red    PD=yellow TR=yellow
h=11: ... → P=yellow PD=yellow TR=yellow
```

(Note: actual values depend on the live Open-Meteo data at request time, not the snapshot used when writing the plan. The point is to confirm differentiation: Pancer should be red 07-10, Pancer Door and Teleng Ria should be yellow in that window.)

- [ ] **Step 4: Sanity check the cache-rewrite happened**

Run: `curl -s http://127.0.0.1:3100/api/status 2>/dev/null | python3 -m json.tool`
Expected: `lastFetch` shows a recent timestamp (since the service restart triggered a fresh fetch).

- [ ] **Step 5: Final commit (if any uncommitted changes remain — sometimes nothing to commit here)**

Run: `git -C /root/surf-pacitan status --short`
If there are no surfable/config/cron/test/CLAUDE.md changes uncommitted, skip the commit. If anything's leftover, commit it.

---

## Self-Review

**Spec coverage:**
- Spec "Inputs & types" → Task 1 ✓
- Spec "Per-spot threshold structure" → Task 1 (interface) + Task 8 (values) ✓
- Spec "Rating logic" → Tasks 2–7 (per-factor helpers) + Task 9 (cascade) ✓
- Spec "Initial per-spot tuning values" → Task 8 ✓
- Spec "Validation against 2026-05-17 observations" → Task 9 (integration tests) + Task 13 (live check) ✓
- Spec "Tests" → Tasks 2–7 unit tests + Tasks 9, 11 integration tests ✓
- Spec geography note → Task 12 (CLAUDE.md update) ✓
- Spec "Open questions for tuning" → carried forward in code comments / future commits; not implemented (correct: they're tuning questions for after first deploy)

**Placeholder scan:** No TBDs or "implement later" — all code blocks are concrete.

**Type consistency:**
- `Quality` introduced in Task 2, used throughout. Note in Task 9 reminds the implementer that `Quality === SurfableRating` (alias recommended over redefinition).
- `SpotThresholds["tide"]`, `["swellDir"]`, etc. used as parameter types in Tasks 3–6 — they index into the interface defined in Task 1.
- `computeWindQuality` takes full `SpotThresholds` (not just the `wind` sub-block) because it needs `facingDirection`. Tests in Task 7 reflect that with a partial object + `as any` cast.

**Out of scope (per spec):** No frontend changes, no gust handling, no API shape changes — all confirmed.
