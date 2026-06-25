# Close-out Risk Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an advisory per-hour/per-spot "close-out risk" flag (long-period swell over a shallow, low-tide bank) that surfaces as a TideGraph strip hatch, a ConditionsPanel note, and a deterministic warning on the daily AI recommendation — without changing the green/yellow/red rating.

**Architecture:** A pure shared heuristic (`src/shared/closeout.ts`) computes risk from data the app already caches (`tide.height`, `swell.period`, `swell.height`) against optional per-spot thresholds stored in the region pack. The client derives the flag on the fly (like factor breakdowns); the server reads the same function to inject a rec warning. No payload, Redis, or cron changes.

**Tech Stack:** TypeScript, Bun (`bun test`), React, uPlot (Canvas), Hono server, region packs.

## Global Constraints

- Use **relative imports** (`../shared/closeout`, `./config`) — never `@shared/*` path aliases (`bun test` doesn't resolve tsconfig paths).
- **`bun test` is the verification gate, not `tsc`** (pre-existing tsc path failures are masked by the bundler).
- **Never import `cache.ts` transitively in unit tests** (module-load opens Redis). `closeout.ts` imports only `./types` — keep it that way.
- **Verification builds go to `/tmp`**: client `bunx vite build --outDir /tmp/vite-check`; server `bun build src/server/index.ts --target bun --outdir /tmp/x`. A plain `bun run build` writes straight to `/var/www/surf-pacitan/` = a live deploy — never use it just to check.
- **Region facts live in `regions/<id>/`**, never hardcoded in `src/`. Threshold numbers go in the pack.
- **UI must not hardcode threshold/factor claims as text** — derive spot names/period from data + `SPOT_DISPLAY`.
- **No inline styles in React** — co-located `.css` with CSS nesting.
- The close-out flag is **advisory only** — it must never alter the green/yellow/red rating.
- Pacitan config values (calibrated to the 2026-06-24 Pancer/Pancer Door session): `{ tideHeightMax: 0.1, periodMin: 9, swellHeightMin: 0.6 }` on **Pancer and Pancer Door only** (Teleng Ria left unconfigured).

## File Structure

| File | Responsibility |
|------|----------------|
| `src/shared/closeout.ts` | **new** — pure heuristic: `CloseoutThresholds`, `closeoutRisk`, `closeoutWarningForPick`, `closeoutSpotsForHours` |
| `tests/closeout.test.ts` | **new** — unit tests for all of the above |
| `src/shared/spot-config.ts` | add optional `closeout?: CloseoutThresholds` to `SpotThresholds` |
| `src/shared/region.ts` | validate `closeout` when present |
| `tests/region.test.ts` | add a malformed-`closeout` validation case |
| `regions/pacitan/index.ts` | add `closeout` to Pancer + Pancer Door |
| `src/server/recommendation.ts` | inject deterministic close-out warning into `rec.warnings` |
| `src/client/components/TideGraph.tsx` | hatch overlay on flagged strip cells + HTML legend |
| `src/client/components/TideGraph.css` | legend style |
| `src/client/components/ConditionsPanel.tsx` | close-out note for the selected block |
| `src/client/components/ConditionsPanel.css` | note style |
| `public/sw.js` | bump `CACHE_NAME` (deploy step) |

---

### Task 1: Core heuristic `closeoutRisk`

**Files:**
- Create: `src/shared/closeout.ts`
- Test: `tests/closeout.test.ts`

**Interfaces:**
- Consumes: `HourlyData` from `./types`.
- Produces: `interface CloseoutThresholds { tideHeightMax: number; periodMin: number; swellHeightMin?: number }` and `closeoutRisk(hour: Pick<HourlyData, "tide" | "swell">, t: CloseoutThresholds | undefined): boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/closeout.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { closeoutRisk, type CloseoutThresholds } from "../src/shared/closeout";

const T: CloseoutThresholds = { tideHeightMax: 0.1, periodMin: 9, swellHeightMin: 0.6 };

function hour(tideHeight: number, period: number, height: number) {
  return {
    tide: { height: tideHeight, rising: true },
    swell: { height, period, direction: 207 },
  };
}

describe("closeoutRisk", () => {
  test("fires on a yesterday-like hour (shallow tide, long period, real size)", () => {
    expect(closeoutRisk(hour(0.0, 11, 1.0), T)).toBe(true);
  });

  test("no risk when the tide is deep", () => {
    expect(closeoutRisk(hour(0.5, 11, 1.0), T)).toBe(false);
  });

  test("no risk on short-period swell", () => {
    expect(closeoutRisk(hour(0.0, 7, 1.0), T)).toBe(false);
  });

  test("no risk below the swell-height floor", () => {
    expect(closeoutRisk(hour(0.0, 11, 0.4), T)).toBe(false);
  });

  test("no config → never flags", () => {
    expect(closeoutRisk(hour(0.0, 11, 1.0), undefined)).toBe(false);
  });

  test("boundaries are inclusive (exactly at the cutoffs flags)", () => {
    expect(closeoutRisk(hour(0.1, 9, 0.6), T)).toBe(true);
  });

  test("swellHeightMin omitted → height gate is skipped", () => {
    const noFloor: CloseoutThresholds = { tideHeightMax: 0.1, periodMin: 9 };
    expect(closeoutRisk(hour(0.0, 11, 0.1), noFloor)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/closeout.test.ts`
Expected: FAIL — `Cannot find module '../src/shared/closeout'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/closeout.ts`:

```ts
// Advisory close-out risk heuristic. Pure: imports only types, no Redis/env —
// callable from client (per-hour display) and server (recommendation warning).
// Models "long-period swell over a shallow bank" — the cause of close-outs the
// five-factor rating can't see. NEVER changes the green/yellow/red rating.
import type { HourlyData } from "./types";

export interface CloseoutThresholds {
  /** meters MSL — at/below this the bank is shallow enough to dump. */
  tideHeightMax: number;
  /** seconds — long-period energy jacks up steeply on a shallow bank. */
  periodMin: number;
  /** optional floor — below this the surf is too small for close-outs to matter. */
  swellHeightMin?: number;
}

/** true = elevated close-out risk for this hour at this spot. */
export function closeoutRisk(
  hour: Pick<HourlyData, "tide" | "swell">,
  t: CloseoutThresholds | undefined,
): boolean {
  if (!t) return false;
  if (hour.tide.height > t.tideHeightMax) return false;
  if (hour.swell.period < t.periodMin) return false;
  if (t.swellHeightMin != null && hour.swell.height < t.swellHeightMin) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/closeout.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/closeout.ts tests/closeout.test.ts
git commit -m "feat(closeout): pure closeoutRisk heuristic + tests"
```

---

### Task 2: Region-pack config + validation

**Files:**
- Modify: `src/shared/spot-config.ts` (add `closeout?` to `SpotThresholds`)
- Modify: `src/shared/region.ts` (validate `closeout` in `validateRegionConfig`)
- Modify: `regions/pacitan/index.ts` (Pancer + Pancer Door)
- Test: `tests/region.test.ts` (add a case)

**Interfaces:**
- Consumes: `CloseoutThresholds` from `./closeout` (Task 1).
- Produces: `SpotThresholds.closeout?: CloseoutThresholds`, surfaced on the client via the existing `SPOT_THRESHOLDS` view and on the server via the `src/server/config.ts` re-export (`export * from "../shared/spot-config"`). No new exports.

- [ ] **Step 1: Write the failing test**

In `tests/region.test.ts`, add inside the existing top-level `describe` (or as a new `describe`) — find a valid base config the file already builds; if it builds one via a helper, reuse it. If not, add this self-contained block at the end of the file:

```ts
import { describe, expect, test } from "bun:test";
import { validateRegionConfig, type RegionConfig } from "../src/shared/region";
import { PACITAN } from "../regions/pacitan";

describe("validateRegionConfig — closeout", () => {
  test("the Pacitan pack (with closeout config) validates clean", () => {
    expect(validateRegionConfig(PACITAN)).toEqual([]);
  });

  test("rejects closeout.periodMin <= 0", () => {
    const bad: RegionConfig = {
      ...PACITAN,
      spots: PACITAN.spots.map((s, i) =>
        i === 0
          ? { ...s, thresholds: { ...s.thresholds, closeout: { tideHeightMax: 0.1, periodMin: 0 } } }
          : s,
      ),
    };
    expect(validateRegionConfig(bad)).toContain(`${PACITAN.spots[0].id}: closeout.periodMin must be > 0`);
  });

  test("rejects negative closeout.swellHeightMin", () => {
    const bad: RegionConfig = {
      ...PACITAN,
      spots: PACITAN.spots.map((s, i) =>
        i === 0
          ? { ...s, thresholds: { ...s.thresholds, closeout: { tideHeightMax: 0.1, periodMin: 9, swellHeightMin: -1 } } }
          : s,
      ),
    };
    expect(validateRegionConfig(bad)).toContain(`${PACITAN.spots[0].id}: closeout.swellHeightMin must be >= 0`);
  });
});
```

> Note: if `tests/region.test.ts` already imports `validateRegionConfig`/`PACITAN`, do not duplicate the imports — add only the `describe` block.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/region.test.ts -t "closeout"`
Expected: FAIL — the "periodMin <= 0" and "negative swellHeightMin" cases fail because validation doesn't exist yet (and the `closeout` field isn't on the type, so the pacitan-pack edit in Step 3 is also required for the "validates clean" case).

- [ ] **Step 3: Write minimal implementation**

3a. In `src/shared/spot-config.ts`, add the import at the top (after the existing `import { ACTIVE_REGION }` line):

```ts
import type { CloseoutThresholds } from "./closeout";
```

And add the field to `SpotThresholds`, immediately after `fallingTideCap: boolean;`:

```ts
  // Optional close-out risk heuristic — advisory only, never changes the
  // green/yellow/red rating. Absent → no flag for this spot. See
  // src/shared/closeout.ts.
  closeout?: CloseoutThresholds;
```

3b. In `src/shared/region.ts`, inside `validateRegionConfig`, after the wind-threshold `for (const cat of ...)` loop (just before the closing `}` of the `for (const s of config.spots ...)` loop), add:

```ts
    if (t.closeout) {
      if (!(t.closeout.periodMin > 0)) {
        errors.push(`${s.id}: closeout.periodMin must be > 0`);
      }
      if (t.closeout.swellHeightMin != null && !(t.closeout.swellHeightMin >= 0)) {
        errors.push(`${s.id}: closeout.swellHeightMin must be >= 0`);
      }
    }
```

3c. In `regions/pacitan/index.ts`, add a `closeout` line after `fallingTideCap: true,` for **Pancer Door** (`id: "pancerDoor"`) and **Pancer** (`id: "pancer"`) — NOT Teleng Ria:

```ts
        fallingTideCap: true,
        closeout: { tideHeightMax: 0.1, periodMin: 9, swellHeightMin: 0.6 },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/region.test.ts -t "closeout"`
Expected: PASS (3 tests).

Run the full suite to confirm no regression in pack-loading tests:
Run: `bun test`
Expected: PASS (all existing tests + new ones).

- [ ] **Step 5: Commit**

```bash
git add src/shared/spot-config.ts src/shared/region.ts regions/pacitan/index.ts tests/region.test.ts
git commit -m "feat(closeout): per-spot closeout config + pack values for Pancer/Pancer Door"
```

---

### Task 3: Consumer helpers (rec warning + block spots)

**Files:**
- Modify: `src/shared/closeout.ts`
- Test: `tests/closeout.test.ts`

**Interfaces:**
- Consumes: `ForecastDay`, `HourlyData` from `./types`; `closeoutRisk`, `CloseoutThresholds` (Task 1).
- Produces:
  - `closeoutWarningForPick(day: ForecastDay, spotId: string, window: { start: string; end: string }, thresholds: CloseoutThresholds | undefined): string | null`
  - `closeoutSpotsForHours(hours: ReadonlyArray<Pick<HourlyData, "tide" | "swell">>, spots: ReadonlyArray<{ id: string; closeout: CloseoutThresholds | undefined }>): string[]`

- [ ] **Step 1: Write the failing test**

Append to `tests/closeout.test.ts`:

```ts
import { closeoutWarningForPick, closeoutSpotsForHours } from "../src/shared/closeout";
import type { ForecastDay, HourlyData } from "../src/shared/types";

function mkHour(h: number, tideHeight: number, period: number, height: number): HourlyData {
  return {
    hour: h,
    tide: { height: tideHeight, rising: true },
    swell: { height, period, direction: 207 },
    wind: { speed: 10, direction: 130, gusts: 15 },
    weather: { temp: 27, condition: "clear", precipitation: 0 },
    surfable: {},
  };
}

const DAY: ForecastDay = {
  date: "2026-06-25",
  location: { name: "Pacitan", lat: -8.22, lng: 111.13 },
  astronomy: { sunrise: "05:49", sunset: "17:28" },
  tideExtremes: [],
  // 14:00 deep, 15:00–16:00 shallow long-period (flag), 17:00 deep
  hourly: [
    mkHour(14, 0.5, 11, 1.0),
    mkHour(15, 0.0, 11, 1.0),
    mkHour(16, -0.02, 11, 1.0),
    mkHour(17, 0.4, 11, 1.0),
  ],
};

const T: CloseoutThresholds = { tideHeightMax: 0.1, periodMin: 9, swellHeightMin: 0.6 };

describe("closeoutWarningForPick", () => {
  test("returns a warning when the window overlaps a flagged hour", () => {
    const w = closeoutWarningForPick(DAY, "pancer", { start: "15:00", end: "17:00" }, T);
    expect(w).toBeTruthy();
    expect(w!.length).toBeLessThanOrEqual(200);
  });

  test("returns null when the window is entirely in deep water", () => {
    expect(closeoutWarningForPick(DAY, "pancer", { start: "17:00", end: "18:00" }, T)).toBeNull();
  });

  test("returns null without config", () => {
    expect(closeoutWarningForPick(DAY, "pancer", { start: "15:00", end: "17:00" }, undefined)).toBeNull();
  });
});

describe("closeoutSpotsForHours", () => {
  test("lists only the configured spots that flag in the given hours", () => {
    const flaggedHours = [DAY.hourly[1], DAY.hourly[2]]; // 15:00, 16:00
    const spots = [
      { id: "telengRia", closeout: undefined },
      { id: "pancerDoor", closeout: T },
      { id: "pancer", closeout: T },
    ];
    expect(closeoutSpotsForHours(flaggedHours, spots)).toEqual(["pancerDoor", "pancer"]);
  });

  test("returns [] when no hour flags", () => {
    const spots = [{ id: "pancer", closeout: T }];
    expect(closeoutSpotsForHours([DAY.hourly[3]], spots)).toEqual([]); // 17:00 deep
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/closeout.test.ts`
Expected: FAIL — `closeoutWarningForPick`/`closeoutSpotsForHours` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/shared/closeout.ts` (and add `ForecastDay` to the type import at the top — change the first line to `import type { ForecastDay, HourlyData } from "./types";`):

```ts
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseHHMM(s: string): number | null {
  const m = HHMM_RE.exec(s);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/**
 * Deterministic close-out warning for a recommended spot+window. Returns a
 * warning string (<= 200 chars, the rec `warnings` cap) when any daylight hour
 * the window overlaps flags for the spot, else null. Window-overlap matches
 * validateRecommendation: [start, end) touches hour H when floor(start/60) <= H
 * <= ceil(end/60) - 1.
 */
export function closeoutWarningForPick(
  day: ForecastDay,
  _spotId: string,
  window: { start: string; end: string },
  thresholds: CloseoutThresholds | undefined,
): string | null {
  if (!thresholds) return null;
  const startMin = parseHHMM(window.start);
  const endMin = parseHHMM(window.end);
  if (startMin === null || endMin === null || endMin <= startMin) return null;

  const firstHour = Math.floor(startMin / 60);
  const lastHour = Math.ceil(endMin / 60) - 1;
  const byHour = new Map(day.hourly.map((h) => [h.hour, h]));
  for (let hr = firstHour; hr <= lastHour; hr += 1) {
    const h = byHour.get(hr);
    if (h && closeoutRisk(h, thresholds)) {
      return "Close-out risk: long-period swell on a low tide — waves may jack up and close out.";
    }
  }
  return null;
}

/**
 * Of the given spots (each with its optional closeout config), which have at
 * least one flagged hour among `hours`. Used by ConditionsPanel for the
 * per-block note. Preserves input spot order.
 */
export function closeoutSpotsForHours(
  hours: ReadonlyArray<Pick<HourlyData, "tide" | "swell">>,
  spots: ReadonlyArray<{ id: string; closeout: CloseoutThresholds | undefined }>,
): string[] {
  const flagged: string[] = [];
  for (const s of spots) {
    if (hours.some((h) => closeoutRisk(h, s.closeout))) flagged.push(s.id);
  }
  return flagged;
}
```

> `_spotId` is currently unused (the warning text is spot-agnostic) but kept in the signature so the call site reads clearly and a future per-spot message needs no signature change.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/closeout.test.ts`
Expected: PASS (all Task 1 + Task 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/closeout.ts tests/closeout.test.ts
git commit -m "feat(closeout): closeoutWarningForPick + closeoutSpotsForHours helpers"
```

---

### Task 4: Inject close-out warning into the recommendation

**Files:**
- Modify: `src/server/recommendation.ts`

**Interfaces:**
- Consumes: `closeoutWarningForPick` (Task 3); `SPOT_THRESHOLDS` from `./config` (re-exported from `../shared/spot-config`).
- Produces: no new exports — appends a deterministic warning to `rec.warnings`.

- [ ] **Step 1: Add the imports**

In `src/server/recommendation.ts`, add to the top-of-file imports (next to the other `../shared` imports near line 1-4):

```ts
import { closeoutWarningForPick } from "../shared/closeout";
```

And add `SPOT_THRESHOLDS` to the existing `./config` import list (the `import { ... } from "./config"` block around lines 207-216):

```ts
  SPOT_THRESHOLDS,
```

- [ ] **Step 2: Merge the warning before building the rec**

In `generateTomorrowRecommendation`, inside the success branch, replace the `const rec: Recommendation = { ... }` construction (currently around lines 346-356) so the warning is merged. Insert immediately before `const rec: Recommendation = {`:

```ts
      const closeoutWarn = closeoutWarningForPick(
        forecast,
        validation.value.bestSpot,
        validation.value.bestWindow,
        SPOT_THRESHOLDS[validation.value.bestSpot]?.closeout,
      );
      const warnings =
        closeoutWarn && !validation.value.warnings.includes(closeoutWarn)
          ? [...validation.value.warnings, closeoutWarn].slice(0, 3)
          : validation.value.warnings;
```

Then change the `warnings:` line in the `rec` object from `warnings: validation.value.warnings,` to:

```ts
        warnings,
```

- [ ] **Step 3: Verify the server entry still bundles (catches import/syntax errors without booting or burning StormGlass quota)**

Run: `bun build src/server/index.ts --target bun --outdir /tmp/x && rm -rf /tmp/x`
Expected: builds with no errors (no output beyond the bundle summary).

- [ ] **Step 4: Run the full test suite (recommendation.test.ts exercises validateRecommendation; confirm no regression)**

Run: `bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/recommendation.ts
git commit -m "feat(closeout): deterministic close-out warning on the daily rec"
```

---

### Task 5: TideGraph hatch overlay + legend

**Files:**
- Modify: `src/client/components/TideGraph.tsx`
- Modify: `src/client/components/TideGraph.css`

**Interfaces:**
- Consumes: `closeoutRisk` (Task 1), `SPOT_THRESHOLDS` (Task 2 field), `SPOT_DISPLAY`.
- Produces: visual only — no exports.

- [ ] **Step 1: Add imports**

In `src/client/components/TideGraph.tsx`, after the existing `import { SPOT_DISPLAY } from "../../shared/spots";` line:

```ts
import { closeoutRisk } from "../../shared/closeout";
import { SPOT_THRESHOLDS } from "../../shared/spot-config";
```

- [ ] **Step 2: Add the hatch helper**

Add a module-level function after `formatSecHHmm` (around line 49):

```ts
// Diagonal caution hatch drawn OVER a strip cell — the rating color stays
// visible beneath. Clipped to the cell so lines never bleed past u.bbox.
function drawCloseoutHatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = "rgba(12, 14, 22, 0.6)";
  ctx.lineWidth = 1.5;
  for (let d = -h; d < w; d += 5) {
    ctx.beginPath();
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
    ctx.stroke();
  }
  ctx.restore();
}
```

- [ ] **Step 3: Build the hour lookup**

In the effect, right after the `ratingsBySpot` map is built (after line 88), add:

```ts
    const hourlyByHour = new Map(hourly.map((h) => [h.hour, h]));
```

- [ ] **Step 4: Draw the hatch in the strip loop**

In the per-hour strip loop, immediately after `ctx.fillRect(xStart, stripY, xEnd - xStart, STRIP_HEIGHT);` (around line 272), add:

```ts
                // Close-out risk: caution hatch over daylight cells (color shows through)
                if (!isNight) {
                  const hd = hourlyByHour.get(hour);
                  if (hd && closeoutRisk(hd, SPOT_THRESHOLDS[spot.key]?.closeout)) {
                    drawCloseoutHatch(ctx, xStart, stripY, xEnd - xStart, STRIP_HEIGHT);
                  }
                }
```

- [ ] **Step 5: Compute the legend flag + render it**

In the component body, after the `const containerClass = ...` line (around line 450), add:

```ts
  const hasCloseoutRisk = hourly.some((h) =>
    SPOT_DISPLAY.some((s) => closeoutRisk(h, SPOT_THRESHOLDS[s.key]?.closeout)),
  );
```

Then in the returned JSX, after the chart container `<div ref={containerRef} ... />` and before the closing `</div>` of `.tide-graph`, add:

```tsx
      {hasCloseoutRisk && (
        <div className="tide-graph-closeout-legend">
          <span className="tide-graph-closeout-swatch" aria-hidden="true" />
          close-out risk
        </div>
      )}
```

- [ ] **Step 6: Style the legend**

Append to `src/client/components/TideGraph.css`:

```css
.tide-graph-closeout-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 11px;
  color: rgba(170, 187, 204, 0.85);

  & .tide-graph-closeout-swatch {
    display: inline-block;
    width: 14px;
    height: 10px;
    background-image: repeating-linear-gradient(
      45deg,
      rgba(12, 14, 22, 0.85) 0 1.5px,
      transparent 1.5px 4px
    );
    background-color: rgba(240, 168, 48, 0.5);
    border-radius: 2px;
  }
}
```

- [ ] **Step 7: Verify the client build compiles (to /tmp — never `bun run build`)**

Run: `bunx vite build --outDir /tmp/vite-check && rm -rf /tmp/vite-check`
Expected: build succeeds, no TypeScript/bundler errors.

- [ ] **Step 8: Manual visual check**

Run the dev client (`bun run dev:client`, proxies to the server on :3100) and confirm on today's chart: flagged afternoon hours show the diagonal hatch over the P/PD strips (TR has none), the green/yellow/red is still visible underneath, and the "▦ close-out risk" legend appears below the chart. (Today 2026-06-25 has flagged afternoon hours per the spec — good live data.)

- [ ] **Step 9: Commit**

```bash
git add src/client/components/TideGraph.tsx src/client/components/TideGraph.css
git commit -m "feat(closeout): hatch overlay + legend on TideGraph spot strips"
```

---

### Task 6: ConditionsPanel close-out note

**Files:**
- Modify: `src/client/components/ConditionsPanel.tsx`
- Modify: `src/client/components/ConditionsPanel.css`

**Interfaces:**
- Consumes: `closeoutSpotsForHours` (Task 3), `SPOT_THRESHOLDS` (already imported in this file), `SPOT_DISPLAY` (already imported), `swell.period` from `averageBlock`.
- Produces: visual only.

- [ ] **Step 1: Add the import**

In `src/client/components/ConditionsPanel.tsx`, add to the `../../shared/surfable` import group or as its own line near the top:

```ts
import { closeoutSpotsForHours } from "../../shared/closeout";
```

- [ ] **Step 2: Compute flagged spots + labels for the current block**

In the `ConditionsPanel` component, after `const { swell, wind, weather } = averageBlock(currentBlock.hours);` (around line 181), add:

```ts
  const closeoutSpots = closeoutSpotsForHours(
    currentBlock.hours,
    SPOT_DISPLAY.map((s) => ({ id: s.key, closeout: SPOT_THRESHOLDS[s.key]?.closeout })),
  );
  const closeoutLabels = closeoutSpots
    .map((id) => SPOT_DISPLAY.find((s) => s.key === id)?.label ?? id)
    .join(", ");
```

- [ ] **Step 3: Render the note**

In the returned JSX, immediately after `<Weather weather={weather} />` (around line 205) and before the `{/* Per-spot ... */}` block, add:

```tsx
      {closeoutSpots.length > 0 && (
        <div className="conditions-panel-closeout" role="note">
          ⚠️ Close-out risk — long-period swell (~{swell.period}s) on a low tide;
          waves may jack up and close out at {closeoutLabels}.
        </div>
      )}
```

> Spot names and the period come from data (`SPOT_DISPLAY` + the block's `swell.period`) — no hardcoded spot list or threshold number, per the repo rule.

- [ ] **Step 4: Style the note**

Append to `src/client/components/ConditionsPanel.css`:

```css
.conditions-panel-closeout {
  margin: 8px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(240, 168, 48, 0.12);
  border: 1px solid rgba(240, 168, 48, 0.35);
  color: #f0c068;
  font-size: 12px;
  line-height: 1.4;
}
```

- [ ] **Step 5: Verify the client build compiles (to /tmp)**

Run: `bunx vite build --outDir /tmp/vite-check && rm -rf /tmp/vite-check`
Expected: build succeeds.

- [ ] **Step 6: Manual visual check**

In the dev client, navigate to an afternoon time block on today's view and confirm the amber note appears naming Pancer, Pancer Door, with the block's period; navigate to a deep-tide block (e.g. early morning) and confirm the note is absent.

- [ ] **Step 7: Commit**

```bash
git add src/client/components/ConditionsPanel.tsx src/client/components/ConditionsPanel.css
git commit -m "feat(closeout): per-block close-out note in ConditionsPanel"
```

---

### Task 7: Deploy

**Files:**
- Modify: `public/sw.js` (bump `CACHE_NAME`)

- [ ] **Step 1: Full test gate**

Run: `bun test`
Expected: PASS (entire suite).

- [ ] **Step 2: Bump the service-worker cache name**

In `public/sw.js`, increment the `CACHE_NAME` version string (e.g. `surf-pacitan-v23` → `surf-pacitan-v24`). This ships JS/CSS, so the SW must invalidate old caches on activate.

- [ ] **Step 3: Production build (writes to /var/www/surf-pacitan — this is the live deploy)**

Run: `bun run build`
Expected: build succeeds, assets emitted to `/var/www/surf-pacitan/`. nginx serves the new static bundle immediately (no restart needed for the frontend).

- [ ] **Step 4: Restart the server (the rec-warning change is server-side)**

Run: `systemctl restart surf-pacitan.service`
Then confirm it came up and didn't blow the StormGlass quota:
Run: `curl -s http://127.0.0.1:3100/api/status`
Expected: a JSON status with a sane `stormglassQuota`. (Each restart re-fetches tides = 3 StormGlass requests — fine here, just don't loop restarts.)

- [ ] **Step 5: Commit + verify deployed bundle**

```bash
git add public/sw.js
git commit -m "chore(closeout): bump SW cache for close-out flag deploy"
```

Confirm the new code is in the served bundle:
Run: `grep -l "close-out risk" /var/www/surf-pacitan/assets/index-*.js`
Expected: one matching hashed bundle file.

- [ ] **Step 6: (Optional) Regenerate today's rec to see the warning live**

The next 20:00 WIB cron (or 05:00 recheck) will pick it up automatically. To verify immediately:

```bash
cd /root/surf-pacitan && bun -e 'import("./src/server/recommendation.ts").then(m => m.generateTomorrowRecommendation(undefined, "2026-06-25")).then(() => process.exit(0))'
```
Then `curl -s http://127.0.0.1:3100/api/recommendation` and confirm `warnings` includes the close-out string if today's pick overlaps a flagged window. (This consumes no StormGlass quota — the rec only reads cache.)

---

## Self-Review

**1. Spec coverage:**
- §1 core heuristic → Task 1. ✓
- §2 config in pack + validation → Task 2. ✓
- §3 UI strip marker → Task 5; ConditionsPanel note → Task 6. ✓
- §4 rec integration (deterministic, dedup, ≤3) → Tasks 3 (helper) + 4 (wiring). ✓
- §5 data flow (no Redis/API/cron changes) → confirmed: client derives via `SPOT_THRESHOLDS`, server via `config` re-export; no `types.ts`/cron/cache edits in any task. ✓
- §6 tests (Redis-free) → Tasks 1, 3 (`closeout.test.ts`), Task 2 (`region.test.ts`). ✓
- §7 files touched table matches the per-task file lists. ✓
- Out-of-scope (no rating cap, no candidate re-ranking, binary, TR off) → honored: no edits to `computeSurfable`/`candidates.ts`; TR gets no `closeout`. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**3. Type consistency:** `CloseoutThresholds` defined in Task 1, imported by `spot-config.ts` (Task 2), used by helpers (Task 3), read via `SPOT_THRESHOLDS[...]?.closeout` (Tasks 4-6). `closeoutRisk(hour, t)`, `closeoutWarningForPick(day, spotId, window, thresholds)`, `closeoutSpotsForHours(hours, spots)` signatures are identical at definition and every call site. `spot.key` (SPOT_DISPLAY) used consistently as the spot id key into `SPOT_THRESHOLDS`. ✓
