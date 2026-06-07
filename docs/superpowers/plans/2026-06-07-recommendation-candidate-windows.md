# Recommendation Candidate Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the nightly AI surf recommendation deterministic-by-default: code computes ranked candidate windows from the per-hour `surfable` ratings; the LLM recommends candidate #1 unless it justifies a deviation in a new `overrideReason` field, enforced by validation.

**Architecture:** New pure module `src/server/candidates.ts` scores 2–3h windows per spot (greens → green density → rising tide → wind → earlier start) and ranks the per-spot winners globally. `buildUserPayload` ships them to DeepSeek; `knowledge-base.ts` instructs "default to rank 1, deviate only with cited data"; `validateRecommendation` gains a context parameter enforcing a red-hour floor and override discipline (rejects feed the existing 2-attempt retry). `Recommendation` gains optional `overrideReason`, rendered as one line in `RecommendationCard`.

**Tech Stack:** Bun + TypeScript, bun:test, Hono server (runs from source via systemd), React + Vite frontend, Redis cache.

**Spec:** `docs/superpowers/specs/2026-06-07-recommendation-candidate-windows-design.md`

**Spec deviation (intentional):** The spec wrote `validateRecommendation(raw, candidates)`. The red-hour floor needs the full day's per-hour ratings, which candidates alone don't carry. The signature is therefore `validateRecommendation(raw, context?)` with `context = { candidates, forecast }`. Semantics are exactly as specced.

**Conventions that bite here** (from CLAUDE.md):
- Relative imports only (`../shared/types`), no `@shared/*` aliases — `bun test` doesn't resolve tsconfig paths.
- Never import `cache.ts` (even transitively) in unit tests — it opens a Redis connection at module load. `candidates.ts` must stay pure.
- Verification gate is `bun test`, NOT `bunx tsc --noEmit` (pre-existing path errors in some client files; don't fix them in passing).
- Server runs from source (`ExecStart=bun run src/server/index.ts`) → server changes need `systemctl restart surf-pacitan.service`, no build. Frontend changes need `bun run build` + a `CACHE_NAME` bump in `public/sw.js`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/server/candidates.ts` | Create | Pure candidate-window computation + `CandidateWindow` type |
| `tests/candidates.test.ts` | Create | Unit tests incl. real-2026-06-08 regression fixture |
| `src/shared/types.ts` | Modify | `Recommendation.overrideReason?` (+ fix stale "German" comments) |
| `src/server/recommendation.ts` | Modify | `UserPayload.candidateWindows`, validation context + rules, wiring, `overrideReason` persistence |
| `tests/recommendation.test.ts` | Modify | Payload test, validation matrix, fixture updates |
| `src/server/knowledge-base.ts` | Modify | Candidate-window contract replaces "sanity baseline" license |
| `src/client/components/RecommendationCard.tsx` | Modify | Render `overrideReason` line |
| `src/client/components/RecommendationCard.css` | Modify | Style for the new line |
| `public/sw.js` | Modify | `CACHE_NAME` v11 → v12 |

---

### Task 1: Candidate-window module

**Files:**
- Create: `src/server/candidates.ts`
- Create: `tests/candidates.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/candidates.test.ts` with exactly:

```ts
import { describe, test, expect } from "bun:test";
import { computeCandidateWindows } from "../src/server/candidates";
import type { ForecastDay, HourlyData, SurfableRating } from "../src/shared/types";

interface HourSpec {
  h: number;
  p?: SurfableRating;   // pancer rating, default "red"
  pd?: SurfableRating;  // pancerDoor rating, default "red"
  tr?: SurfableRating;  // telengRia rating, default "red"
  rising?: boolean;     // default false
  wind?: number;        // km/h, default 10
}

function dayWith(hours: HourSpec[]): ForecastDay {
  const hourly: HourlyData[] = hours.map((s) => ({
    hour: s.h,
    tide: { height: 0, rising: s.rising ?? false },
    swell: { height: 1.5, period: 12, direction: 200 },
    wind: { speed: s.wind ?? 10, direction: 100, gusts: (s.wind ?? 10) + 5 },
    weather: { temp: 27, condition: "clear", precipitation: 0 },
    surfable: { telengRia: s.tr ?? "red", pancer: s.p ?? "red", pancerDoor: s.pd ?? "red" },
  }));
  return {
    date: "2026-06-08",
    location: { name: "Pacitan", lat: -8.22, lng: 111.13 },
    astronomy: { sunrise: "05:43", sunset: "17:24" },
    tideExtremes: [],
    hourly,
  };
}

describe("computeCandidateWindows", () => {
  test("regression: real 2026-06-08 ratings produce TR 10-12 > pancer 08-10 > PD 08-10", () => {
    // Transcribed from the live forecast that motivated this feature
    // (columns: pancer, pancerDoor, telengRia).
    const day = dayWith([
      { h: 5,  p: "yellow", pd: "yellow", tr: "yellow", rising: false, wind: 11 },
      { h: 6,  p: "yellow", pd: "yellow", tr: "yellow", rising: false, wind: 10 },
      { h: 7,  p: "yellow", pd: "yellow", tr: "red",    rising: false, wind: 12 },
      { h: 8,  p: "green",  pd: "yellow", tr: "yellow", rising: true,  wind: 17 },
      { h: 9,  p: "yellow", pd: "yellow", tr: "yellow", rising: true,  wind: 20 },
      { h: 10, p: "yellow", pd: "yellow", tr: "green",  rising: true,  wind: 20 },
      { h: 11, p: "yellow", pd: "yellow", tr: "green",  rising: true,  wind: 22 },
      { h: 12, p: "red",    pd: "yellow", tr: "yellow", rising: true,  wind: 21 },
      { h: 13, p: "red",    pd: "yellow", tr: "yellow", rising: true,  wind: 21 },
      { h: 14, p: "red",    pd: "yellow", tr: "yellow", rising: false, wind: 21 },
      { h: 15, p: "red",    pd: "yellow", tr: "yellow", rising: false, wind: 22 },
      { h: 16, p: "yellow", pd: "yellow", tr: "yellow", rising: false, wind: 17 },
      { h: 17, p: "red",    pd: "red",    tr: "red",    rising: false, wind: 10 },
      { h: 18, p: "red",    pd: "red",    tr: "red",    rising: false, wind: 9 },
    ]);
    const c = computeCandidateWindows(day);
    expect(c).toEqual([
      { rank: 1, spot: "telengRia",  start: "10:00", end: "12:00", ratings: "10g 11g", greens: 2, risingShare: 1, meanWind: 21 },
      { rank: 2, spot: "pancer",     start: "08:00", end: "10:00", ratings: "08g 09y", greens: 1, risingShare: 1, meanWind: 19 },
      { rank: 3, spot: "pancerDoor", start: "08:00", end: "10:00", ratings: "08y 09y", greens: 0, risingShare: 1, meanWind: 19 },
    ]);
  });

  test("denser green window beats longer window with same green count", () => {
    const day = dayWith([
      { h: 8, p: "green" },
      { h: 9, p: "green" },
      { h: 10, p: "yellow" },
    ]);
    const c = computeCandidateWindows(day);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ spot: "pancer", start: "08:00", end: "10:00", greens: 2 });
  });

  test("more greens beats denser: 3-green 3h window wins over 2-green 2h", () => {
    const day = dayWith([
      { h: 8, p: "green" },
      { h: 9, p: "green" },
      { h: 10, p: "green" },
    ]);
    const c = computeCandidateWindows(day);
    expect(c[0]).toMatchObject({ start: "08:00", end: "11:00", greens: 3 });
  });

  test("isolated single non-red hour falls back to a 1h window", () => {
    const day = dayWith([
      { h: 7, p: "red" },
      { h: 8, p: "green" },
      { h: 9, p: "red" },
    ]);
    const c = computeCandidateWindows(day);
    expect(c).toEqual([
      { rank: 1, spot: "pancer", start: "08:00", end: "09:00", ratings: "08g", greens: 1, risingShare: 0, meanWind: 10 },
    ]);
  });

  test("fully red day yields no candidates", () => {
    const day = dayWith([{ h: 8 }, { h: 9 }, { h: 10 }]);
    expect(computeCandidateWindows(day)).toEqual([]);
  });

  test("complete tie between spots resolves west-to-east (telengRia first)", () => {
    const day = dayWith([
      { h: 8, tr: "green", p: "green" },
      { h: 9, tr: "green", p: "green" },
    ]);
    const c = computeCandidateWindows(day);
    expect(c.map((x) => x.spot)).toEqual(["telengRia", "pancer"]);
    expect(c.map((x) => x.rank)).toEqual([1, 2]);
  });

  test("rising-tide share breaks green ties", () => {
    const day = dayWith([
      { h: 6, p: "green", rising: false },
      { h: 7, p: "green", rising: false },
      { h: 8 }, // red gap
      { h: 10, p: "green", rising: true },
      { h: 11, p: "green", rising: true },
    ]);
    const c = computeCandidateWindows(day);
    expect(c[0]).toMatchObject({ start: "10:00", end: "12:00", risingShare: 1 });
  });

  test("lower mean wind breaks rising ties", () => {
    const day = dayWith([
      { h: 6, p: "green", wind: 20 },
      { h: 7, p: "green", wind: 20 },
      { h: 8 }, // red gap
      { h: 10, p: "green", wind: 8 },
      { h: 11, p: "green", wind: 8 },
    ]);
    const c = computeCandidateWindows(day);
    expect(c[0]).toMatchObject({ start: "10:00", end: "12:00", meanWind: 8 });
  });

  test("earlier start breaks full ties", () => {
    const day = dayWith([
      { h: 6, p: "green" },
      { h: 7, p: "green" },
      { h: 8 }, // red gap
      { h: 10, p: "green" },
      { h: 11, p: "green" },
    ]);
    const c = computeCandidateWindows(day);
    expect(c[0]).toMatchObject({ start: "06:00", end: "08:00" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/candidates.test.ts`
Expected: FAIL — `Cannot find module '../src/server/candidates'` (or similar resolution error).

- [ ] **Step 3: Implement the module**

Create `src/server/candidates.ts` with exactly:

```ts
import type { ForecastDay, HourlyData, SpotName } from "../shared/types";
import { SPOT_DISPLAY } from "../shared/spots";

// A surfable window computed from the per-hour ratings, shipped to the LLM as
// a ranked candidate. rank 1 = best window of the day across all spots.
export interface CandidateWindow {
  rank: number;        // 1-based, global best-first
  spot: SpotName;
  start: string;       // "HH:00"
  end: string;         // "HH:00", exclusive — "10:00"–"12:00" covers hours 10 and 11
  ratings: string;     // compact per-hour ratings, e.g. "10g 11g"
  greens: number;
  risingShare: number; // 0..1, rounded to 2 decimals
  meanWind: number;    // km/h, rounded
}

interface ScoredWindow {
  spot: SpotName;
  startHour: number;
  endHour: number; // exclusive
  hours: HourlyData[];
  greens: number;
  greenFraction: number;
  risingShare: number;
  meanWind: number; // unrounded — rounding only happens in the payload shape
}

const SPOT_ORDER: SpotName[] = SPOT_DISPLAY.map((s) => s.key);

// Lexicographic: more greens, denser greens, more rising tide, less wind,
// earlier start, shorter window. Negative when a is better.
function compareWindows(a: ScoredWindow, b: ScoredWindow): number {
  if (a.greens !== b.greens) return b.greens - a.greens;
  if (a.greenFraction !== b.greenFraction) return b.greenFraction - a.greenFraction;
  if (a.risingShare !== b.risingShare) return b.risingShare - a.risingShare;
  if (a.meanWind !== b.meanWind) return a.meanWind - b.meanWind;
  if (a.startHour !== b.startHour) return a.startHour - b.startHour;
  return a.endHour - b.endHour;
}

function scoreWindow(spot: SpotName, hours: HourlyData[]): ScoredWindow {
  const greens = hours.filter((h) => h.surfable[spot] === "green").length;
  const rising = hours.filter((h) => h.tide.rising).length;
  const windSum = hours.reduce((sum, h) => sum + h.wind.speed, 0);
  return {
    spot,
    startHour: hours[0].hour,
    endHour: hours[hours.length - 1].hour + 1,
    hours,
    greens,
    greenFraction: greens / hours.length,
    risingShare: rising / hours.length,
    meanWind: windSum / hours.length,
  };
}

// Contiguous runs of non-red hours for the spot. Night hours are already red
// via the surfable sunrise/sunset logic, so no separate daylight filter is
// needed. Gaps in hour numbers break runs.
function nonRedRuns(hourly: HourlyData[], spot: SpotName): HourlyData[][] {
  const sorted = [...hourly].sort((a, b) => a.hour - b.hour);
  const runs: HourlyData[][] = [];
  let run: HourlyData[] = [];
  for (const h of sorted) {
    const nonRed = h.surfable[spot] !== "red";
    const contiguous = run.length > 0 && h.hour === run[run.length - 1].hour + 1;
    if (nonRed && (run.length === 0 || contiguous)) {
      run.push(h);
    } else {
      if (run.length) runs.push(run);
      run = nonRed ? [h] : [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

function bestWindowForSpot(hourly: HourlyData[], spot: SpotName): ScoredWindow | null {
  const runs = nonRedRuns(hourly, spot);
  if (!runs.length) return null;

  const windows: ScoredWindow[] = [];
  for (const run of runs) {
    for (const len of [2, 3]) {
      for (let i = 0; i + len <= run.length; i += 1) {
        windows.push(scoreWindow(spot, run.slice(i, i + len)));
      }
    }
  }
  // 1-hour fallback only when no run reaches length 2 (then all runs are 1h).
  if (!windows.length) {
    for (const run of runs) windows.push(scoreWindow(spot, run));
  }
  windows.sort(compareWindows);
  return windows[0];
}

function toCandidate(w: ScoredWindow, rank: number): CandidateWindow {
  const hh = (n: number) => `${String(n).padStart(2, "0")}:00`;
  return {
    rank,
    spot: w.spot,
    start: hh(w.startHour),
    end: hh(w.endHour),
    ratings: w.hours
      .map((h) => `${String(h.hour).padStart(2, "0")}${h.surfable[w.spot][0]}`)
      .join(" "),
    greens: w.greens,
    risingShare: Math.round(w.risingShare * 100) / 100,
    meanWind: Math.round(w.meanWind),
  };
}

export function computeCandidateWindows(forecast: ForecastDay): CandidateWindow[] {
  const winners: ScoredWindow[] = [];
  for (const spot of SPOT_ORDER) {
    const best = bestWindowForSpot(forecast.hourly, spot);
    if (best) winners.push(best);
  }
  // Deterministic on full ties: west-to-east spot order.
  winners.sort(
    (a, b) => compareWindows(a, b) || SPOT_ORDER.indexOf(a.spot) - SPOT_ORDER.indexOf(b.spot),
  );
  return winners.map((w, i) => toCandidate(w, i + 1));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/candidates.test.ts`
Expected: 9 pass, 0 fail.

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `bun test`
Expected: 141 pass (132 existing + 9 new), 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/server/candidates.ts tests/candidates.test.ts
git commit -m "feat(candidates): pure ranked candidate-window computation

Scores 2-3h windows per spot from the surfable ratings (greens, green
density, rising share, mean wind, earlier start; 1h fallback for isolated
non-red hours) and ranks per-spot winners globally, west-to-east on ties.
Groundwork for anchoring the AI recommendation to the computed ratings.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Ship candidates in the DeepSeek payload

**Files:**
- Modify: `src/server/recommendation.ts:1-18` (imports + `UserPayload`) and `buildUserPayload` (~line 93)
- Test: `tests/recommendation.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/recommendation.test.ts`, inside `describe("buildUserPayload", ...)` after the existing `test("payload includes forDate, astronomy, tideExtremes verbatim", ...)` block, add:

```ts
  test("payload includes ranked candidateWindows", () => {
    const payload = buildUserPayload(sampleForecast());
    // sampleForecast has a single hour (06): pancer+pancerDoor green, telengRia
    // yellow → three 1h-fallback candidates; pancer/pancerDoor tie resolves
    // west-to-east, so pancerDoor ranks first.
    expect(payload.candidateWindows).toHaveLength(3);
    expect(payload.candidateWindows[0]).toMatchObject({
      rank: 1,
      spot: "pancerDoor",
      start: "06:00",
      end: "07:00",
      greens: 1,
    });
    expect(payload.candidateWindows[1].spot).toBe("pancer");
    expect(payload.candidateWindows[2].spot).toBe("telengRia");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/recommendation.test.ts -t "buildUserPayload"`
Expected: FAIL — `candidateWindows` is `undefined`.

- [ ] **Step 3: Implement**

In `src/server/recommendation.ts`:

a) Add the import directly under the existing first import line:

```ts
import type { ForecastDay, SpotRatings, SpotName, TideExtreme } from "../shared/types";
import { computeCandidateWindows, type CandidateWindow } from "./candidates";
```

b) Extend `UserPayload`:

```ts
export interface UserPayload {
  forDate: string;
  tideRange: number;
  astronomy: { sunrise: string; sunset: string };
  tideExtremes: TideExtreme[];
  candidateWindows: CandidateWindow[];
  hourly: PayloadHourly[];
}
```

c) In `buildUserPayload`, add the field to the returned object:

```ts
  return {
    forDate: forecast.date,
    tideRange,
    astronomy: forecast.astronomy,
    tideExtremes: forecast.tideExtremes,
    candidateWindows: computeCandidateWindows(forecast),
    hourly: forecast.hourly.map((h) => ({
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test`
Expected: 142 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/server/recommendation.ts tests/recommendation.test.ts
git commit -m "feat(recommendation): include candidateWindows in DeepSeek payload

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Candidate discipline in `validateRecommendation`

**Files:**
- Modify: `src/shared/types.ts:74-83` (`Recommendation`)
- Modify: `src/server/recommendation.ts` (`ValidatedRecommendationFields`, new `ValidationContext`, `validateRecommendation`)
- Test: `tests/recommendation.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/recommendation.test.ts`, add the import at the top (next to the existing `buildUserPayload` import):

```ts
import { computeCandidateWindows } from "../src/server/candidates";
```

Then add a new describe block after `describe("validateRecommendation", ...)` (before the `generateTomorrowRecommendation` section):

```ts
describe("validateRecommendation with candidate context", () => {
  // pancerDoor green 06-07 → top candidate 06:00-08:00;
  // pancer green 09-10 → candidate 2 09:00-11:00; telengRia all red.
  function validationForecast(): ForecastDay {
    const mk = (h: number, p: "green" | "yellow" | "red", pd: "green" | "yellow" | "red") => ({
      hour: h,
      tide: { height: 0.5, rising: true },
      swell: { height: 1.5, period: 12, direction: 200 },
      wind: { speed: 10, direction: 100, gusts: 15 },
      weather: { temp: 27, condition: "clear", precipitation: 0 },
      surfable: { telengRia: "red" as const, pancer: p, pancerDoor: pd },
    });
    return sampleForecast({
      hourly: [
        mk(6, "yellow", "green"),
        mk(7, "yellow", "green"),
        mk(8, "yellow", "yellow"),
        mk(9, "green", "yellow"),
        mk(10, "green", "yellow"),
        mk(11, "yellow", "yellow"),
      ],
    });
  }

  function contextFor(forecast: ForecastDay) {
    return { candidates: computeCandidateWindows(forecast), forecast };
  }

  test("fixture sanity: top candidate is pancerDoor 06:00-08:00", () => {
    const ctx = contextFor(validationForecast());
    expect(ctx.candidates[0]).toMatchObject({ spot: "pancerDoor", start: "06:00", end: "08:00" });
    expect(ctx.candidates[1]).toMatchObject({ spot: "pancer", start: "09:00", end: "11:00" });
    expect(ctx.candidates).toHaveLength(2);
  });

  test("accepts a pick that follows the top candidate exactly, no overrideReason needed", () => {
    const f = validationForecast();
    const raw = { ...validRecRaw(), bestSpot: "pancerDoor", bestWindow: { start: "06:00", end: "08:00" } };
    const result = validateRecommendation(raw, contextFor(f));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.overrideReason).toBeUndefined();
  });

  test("accepts a pick within ±1h of the top candidate without overrideReason", () => {
    const f = validationForecast();
    const raw = { ...validRecRaw(), bestSpot: "pancerDoor", bestWindow: { start: "06:00", end: "09:00" } };
    expect(validateRecommendation(raw, contextFor(f)).ok).toBe(true);
  });

  test("rejects a deviation without overrideReason", () => {
    const f = validationForecast();
    const raw = { ...validRecRaw(), bestSpot: "pancer", bestWindow: { start: "09:00", end: "11:00" } };
    const result = validateRecommendation(raw, contextFor(f));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("overrideReason");
  });

  test("accepts a deviation with overrideReason and carries it through", () => {
    const f = validationForecast();
    const raw = {
      ...validRecRaw(),
      bestSpot: "pancer",
      bestWindow: { start: "09:00", end: "11:00" },
      overrideReason: "tide push stronger 09-11 while wind stays 10 km/h",
    };
    const result = validateRecommendation(raw, contextFor(f));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.overrideReason).toBe("tide push stronger 09-11 while wind stays 10 km/h");
  });

  test("rejects a window containing a red hour even with overrideReason", () => {
    const f = validationForecast();
    const raw = {
      ...validRecRaw(),
      bestSpot: "telengRia",
      bestWindow: { start: "06:00", end: "08:00" },
      overrideReason: "sheltered from the wind",
    };
    const result = validateRecommendation(raw, contextFor(f));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("red hour");
  });

  test("rejects a window reaching outside forecast hours", () => {
    const f = validationForecast();
    const raw = {
      ...validRecRaw(),
      bestSpot: "pancerDoor",
      bestWindow: { start: "04:00", end: "06:00" },
      overrideReason: "dawn patrol",
    };
    const result = validateRecommendation(raw, contextFor(f));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("outside forecast");
  });

  test("rejects overrideReason longer than 300 chars", () => {
    const f = validationForecast();
    const raw = {
      ...validRecRaw(),
      bestSpot: "pancer",
      bestWindow: { start: "09:00", end: "11:00" },
      overrideReason: "x".repeat(301),
    };
    expect(validateRecommendation(raw, contextFor(f)).ok).toBe(false);
  });

  test("empty candidates list degrades to legacy validation (no candidate checks)", () => {
    const f = validationForecast();
    const raw = { ...validRecRaw(), bestSpot: "telengRia", bestWindow: { start: "06:00", end: "08:00" } };
    const result = validateRecommendation(raw, { candidates: [], forecast: f });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/recommendation.test.ts -t "candidate context"`
Expected: FAIL — the deviation-without-reason / red-hour / outside-forecast / 301-chars rejection tests fail, and "carries it through" fails on `value.overrideReason` being undefined (current validator accepts everything shape-valid and ignores both the second argument and unknown fields). The fixture-sanity and follows-#1 tests already pass.

- [ ] **Step 3: Implement**

In `src/shared/types.ts`, replace the `Recommendation` interface body comments and add the field:

```ts
export interface Recommendation {
  forDate: string;                  // YYYY-MM-DD — the day the recommendation is FOR
  generatedAt: string;              // ISO timestamp of generation
  bestSpot: SpotName;
  bestWindow: RecommendationWindow;
  headline: string;                 // 1 sentence summary, English
  reasoning: string;                // 2-3 sentences, English, <= 600 chars
  warnings: string[];               // empty array or short warning strings
  overrideReason?: string;          // only when deviating from the top candidate window, <= 300 chars
  modelUsed: string;                // e.g. "deepseek-v4-flash"
}
```

In `src/server/recommendation.ts`:

a) Add `ValidationContext` and extend `ValidatedRecommendationFields` (replace the existing interface):

```ts
export interface ValidationContext {
  candidates: CandidateWindow[];
  forecast: ForecastDay;
}

export interface ValidatedRecommendationFields {
  bestSpot: SpotName;
  bestWindow: { start: string; end: string };
  headline: string;
  reasoning: string;
  warnings: string[];
  overrideReason?: string;
}
```

b) Change the `validateRecommendation` signature:

```ts
export function validateRecommendation(raw: unknown, context?: ValidationContext): ValidationResult {
```

c) After the existing `warnings` loop (the `for (const wn of r.warnings) { ... }` block) and BEFORE the final `return { ok: true, ... }`, insert:

```ts
  // overrideReason: optional, <= 300 chars
  let overrideReason: string | undefined;
  if (r.overrideReason !== undefined && r.overrideReason !== null && r.overrideReason !== "") {
    if (typeof r.overrideReason !== "string") {
      return { ok: false, error: "overrideReason must be a string" };
    }
    if (r.overrideReason.length > 300) {
      return { ok: false, error: "overrideReason too long (>300)" };
    }
    overrideReason = r.overrideReason;
  }

  // Candidate discipline (see 2026-06-07 candidate-windows spec): with
  // candidates present, the pick must follow the top candidate (±1h) or
  // justify the deviation; red hours are never allowed. Without context or
  // candidates (legacy callers, fully red day) these checks are skipped.
  if (context && context.candidates.length > 0) {
    const ratingsByHour = new Map(context.forecast.hourly.map((h) => [h.hour, h.surfable]));
    const firstHour = Math.floor(startMin / 60);
    const lastHour = Math.ceil(endMin / 60) - 1;
    for (let h = firstHour; h <= lastHour; h += 1) {
      const ratings = ratingsByHour.get(h);
      if (!ratings) {
        return { ok: false, error: `bestWindow hour ${h} outside forecast hours` };
      }
      if (ratings[bestSpot] === "red") {
        return { ok: false, error: `bestWindow contains red hour ${h} for ${bestSpot}` };
      }
    }

    const top = context.candidates[0];
    const topStart = parseHHMM(top.start);
    const topEnd = parseHHMM(top.end);
    const followsTop =
      bestSpot === top.spot &&
      topStart !== null &&
      topEnd !== null &&
      Math.abs(startMin - topStart) <= 60 &&
      Math.abs(endMin - topEnd) <= 60;
    if (!followsTop && !overrideReason) {
      return { ok: false, error: "deviates from top candidate without overrideReason" };
    }
  }
```

d) Extend the success return to carry the field:

```ts
  return {
    ok: true,
    value: {
      bestSpot,
      bestWindow: { start: w.start, end: w.end },
      headline: r.headline,
      reasoning: r.reasoning,
      warnings: r.warnings as string[],
      ...(overrideReason ? { overrideReason } : {}),
    },
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test`
Expected: 151 pass, 0 fail. (The existing no-context `validateRecommendation` tests must still pass untouched — `context` is optional.)

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/server/recommendation.ts tests/recommendation.test.ts
git commit -m "feat(recommendation): enforce candidate discipline in validation

With candidates present: red-hour floor always; picks deviating from the
top candidate (±1h tolerance) require a non-empty overrideReason (<=300
chars). Empty candidates / no context degrade to legacy validation.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire context through `generateTomorrowRecommendation`

**Files:**
- Modify: `src/server/recommendation.ts` (`generateTomorrowRecommendation`)
- Test: `tests/recommendation.test.ts` (fixture + assertions)

- [ ] **Step 1: Update fixtures and write the failing test**

In `tests/recommendation.test.ts`:

a) `validModelResponse()` currently returns `bestWindow: { start: "06:00", end: "09:00" }`. With candidate enforcement wired in, that deviates from `sampleForecast`'s top candidate (pancerDoor 06:00–07:00, Δend 120min) and would be rejected. Replace the function with:

```ts
function validModelResponse() {
  return {
    bestSpot: "pancerDoor",
    // Matches sampleForecast's top candidate (pancerDoor 06:00-07:00) so the
    // wired-in candidate enforcement accepts it without overrideReason.
    bestWindow: { start: "06:00", end: "07:00" },
    headline: "Pancer Door best in the morning.",
    reasoning: "Rising tide meets offshore wind and clean SW swell.",
    warnings: [],
  };
}
```

b) In the test `"on success writes a complete Recommendation to cache"`, change the window assertion to:

```ts
    expect(rec.bestWindow).toEqual({ start: "06:00", end: "07:00" });
```

c) Add two new tests at the end of `describe("generateTomorrowRecommendation", ...)`:

```ts
  test("rejects a deviating pick without overrideReason via candidate enforcement, then gives up", async () => {
    const callDeepSeek = mock(async () => ({
      // Deviates from sampleForecast's top candidate (pancerDoor 06:00-07:00)
      // with no overrideReason → validation must reject on both attempts.
      content: { ...validModelResponse(), bestSpot: "pancer" },
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }));
    const setRecommendation = mock(async () => {});
    await generateTomorrowRecommendation(makeDeps({ callDeepSeek, setRecommendation }));
    expect(callDeepSeek).toHaveBeenCalledTimes(2);
    expect(setRecommendation).not.toHaveBeenCalled();
  });

  test("persists overrideReason when the model justifies a deviation", async () => {
    const captured: Recommendation[] = [];
    const setRecommendation = mock(async (rec: Recommendation) => { captured.push(rec); });
    const callDeepSeek = mock(async () => ({
      content: {
        ...validModelResponse(),
        bestSpot: "pancer",
        overrideReason: "wind stays 8 km/h at pancer while pancerDoor gusts 25",
      },
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }));
    await generateTomorrowRecommendation(makeDeps({ callDeepSeek, setRecommendation }));
    expect(captured).toHaveLength(1);
    expect(captured[0].overrideReason).toBe("wind stays 8 km/h at pancer while pancerDoor gusts 25");
  });
```

Note for test 2: `sampleForecast`'s single hour 06 has pancer green, so the red-hour floor passes for the deviating pancer 06:00–07:00 pick.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun test tests/recommendation.test.ts -t "generateTomorrowRecommendation"`
Expected: the two new tests FAIL (no context is passed yet, so the deviation is accepted and `overrideReason` is dropped). All others pass.

- [ ] **Step 3: Implement**

In `generateTomorrowRecommendation` (src/server/recommendation.ts):

a) Replace the validation call:

```ts
    const validation = validateRecommendation(result.content, {
      candidates: userPayload.candidateWindows,
      forecast,
    });
```

b) Extend the `rec` object:

```ts
    const rec: Recommendation = {
      forDate,
      generatedAt: deps.now().toISOString(),
      bestSpot: validation.value.bestSpot,
      bestWindow: validation.value.bestWindow,
      headline: validation.value.headline,
      reasoning: validation.value.reasoning,
      warnings: validation.value.warnings,
      ...(validation.value.overrideReason ? { overrideReason: validation.value.overrideReason } : {}),
      modelUsed: deps.model,
    };
```

- [ ] **Step 4: Run the full suite**

Run: `bun test`
Expected: 153 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/server/recommendation.ts tests/recommendation.test.ts
git commit -m "feat(recommendation): wire candidate context into generation, persist overrideReason

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Knowledge-base prompt contract

**Files:**
- Modify: `src/server/knowledge-base.ts`

No unit test — prompt prose; behavior is covered by the live verification in Task 7.

- [ ] **Step 1: Add candidateWindows to the input-format sketch**

In the `# Input Data Format` JSON block, insert the `candidateWindows` line between `tideExtremes` and `hourly`:

```
  "tideExtremes": [{ "time": "HH:MM", "height": m, "type": "high"|"low" }],
  "candidateWindows": [{ "rank": 1, "spot": "telengRia"|"pancer"|"pancerDoor", "start": "HH:00", "end": "HH:00",
                         "ratings": "10g 11g", "greens": 2, "risingShare": 0..1, "meanWind": km/h }],
  "hourly": [{ "hour": 0-23, "tide": {height, rising}, "swell": {height, period, direction},
```

- [ ] **Step 2: Replace the "sanity baseline" license with the candidate contract**

Replace this exact paragraph (directly after the input-format code block):

```
The \`surfable\` ratings are rule-based and pre-computed. You ARE allowed to override them if you have good reason — explain why in that case. They are a sanity baseline, not ground truth.
```

with:

```
# Candidate Windows

\`candidateWindows\` are the best surf windows computed from the per-hour \`surfable\` ratings, ranked best-first (rank 1 = best window of the day).

- DEFAULT: recommend candidate rank 1 unchanged (same spot, same start/end).
- You MAY deviate (another candidate, a shifted or different window) ONLY when specific hourly data gives a concrete reason. Then you MUST fill \`overrideReason\`, citing that data with numbers (e.g. "wind jumps 12→22 km/h at 10:00").
- When you follow candidate rank 1, omit \`overrideReason\`.
- NEVER recommend a window that includes an hour rated "red" for the chosen spot.
- If \`candidateWindows\` is empty (fully red day), recommend the least-bad daylight window and warn clearly.
```

- [ ] **Step 3: Add overrideReason to the output schema block**

Replace the output schema JSON (inside `# Output`):

```
{
  "bestSpot": "telengRia" | "pancer" | "pancerDoor",
  "bestWindow": { "start": "HH:MM", "end": "HH:MM" },
  "headline": "one short sentence in English, max 200 chars",
  "reasoning": "2–3 sentences in English explaining why this spot in this window, max 600 chars",
  "warnings": ["short warnings in English, max 200 chars each, max 3 entries"],
  "overrideReason": "ONLY when deviating from candidate rank 1: the concrete data-grounded reason, max 300 chars. Omit otherwise."
}
```

- [ ] **Step 4: Run the full suite (no regressions)**

Run: `bun test`
Expected: 153 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/server/knowledge-base.ts
git commit -m "feat(knowledge-base): candidate-window contract replaces free-override license

'Sanity baseline, not ground truth' was the root of the nightly pick
scatter (see 2026-06-07 spec). The model now defaults to the computed
rank-1 window and must justify any deviation in overrideReason.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Show overrideReason on the card

**Files:**
- Modify: `src/client/components/RecommendationCard.tsx` (expanded body, after reasoning)
- Modify: `src/client/components/RecommendationCard.css`

No component test infrastructure exists in this repo — visual change verified in Task 7.

- [ ] **Step 1: Render the line**

In `RecommendationCard.tsx`, inside the `{expanded && (...)}` block, between the reasoning `<p>` and the warnings `<ul>`:

```tsx
          <p className="recommendation-card-reasoning">{recommendation.reasoning}</p>
          {recommendation.overrideReason && (
            <p className="recommendation-card-override">
              ⤷ Differs from the top-rated window: {recommendation.overrideReason}
            </p>
          )}
          {recommendation.warnings.length > 0 && (
```

- [ ] **Step 2: Style it**

In `RecommendationCard.css`, after the `.recommendation-card-reasoning` rule (matching the existing CSS-nesting style):

```css
  & .recommendation-card-override {
    color: var(--text-dim);
    font-size: 0.825rem;
    font-style: italic;
    line-height: 1.4;
    margin: 0 0 0.5rem 0;
  }
```

- [ ] **Step 3: Run the full suite**

Run: `bun test`
Expected: 153 pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/RecommendationCard.tsx src/client/components/RecommendationCard.css
git commit -m "feat(ui): show overrideReason on the recommendation card

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Deploy + live verification

**Files:**
- Modify: `public/sw.js:1` (`CACHE_NAME`)

- [ ] **Step 1: Bump the service-worker cache**

In `public/sw.js` line 1, change:

```js
const CACHE_NAME = "surf-pacitan-v11";
```

to:

```js
const CACHE_NAME = "surf-pacitan-v12";
```

(If the version is no longer `v11` at execution time, bump whatever it is by one.)

- [ ] **Step 2: Build the frontend**

Run: `bun run build`
Expected: Vite build succeeds, output lands in `/var/www/surf-pacitan/`.

- [ ] **Step 3: Restart the service (server runs from source)**

Run: `systemctl restart surf-pacitan.service && sleep 2 && systemctl is-active surf-pacitan.service`
Expected: `active`. Note: the restart re-fetches tides on startup (3 StormGlass requests of the 10/day quota) — expected, mention it in the report.

- [ ] **Step 4: Cross-check the computed top candidate**

From `/root/surf-pacitan/`, with `<DATE>` = tomorrow in WIB (`TZ=Asia/Jakarta date -d tomorrow +%F`):

```bash
bun -e 'import("./src/server/cache").then(async (c) => {
  const day = await c.getCachedDay("<DATE>");
  const { computeCandidateWindows } = await import("./src/server/candidates");
  console.log(JSON.stringify(computeCandidateWindows(day), null, 2));
  process.exit(0);
})'
```

Expected: a ranked candidate list; note candidate rank 1.

- [ ] **Step 5: Regenerate the recommendation 2-3 times and verify stability**

Run (each invocation overwrites the same Redis key — fine, same date):

```bash
bun -e 'import("./src/server/recommendation.ts").then(m => m.generateTomorrowRecommendation())'
curl -s http://127.0.0.1:3100/api/recommendation | python3 -m json.tool
```

Expected on EACH run: `bestSpot`/`bestWindow` equal to candidate rank 1 from Step 4 (±1h), and no `overrideReason` — OR a deviating pick WITH a concrete, data-citing `overrideReason`. The pre-feature scatter (3 different picks in 3 runs) must be gone. If a run logs `validation failed: deviates from top candidate without overrideReason` and then succeeds on attempt 2, that's the enforcement working — note it in the report.

- [ ] **Step 6: Commit**

```bash
git add public/sw.js
git commit -m "chore(sw): bump cache to v12 for recommendation card change

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Expected final state

- `bun test`: 153 pass, 0 fail (132 pre-existing + 9 candidates + 1 payload + 9 validation matrix + 2 generation wiring).
- Nightly 20:00 WIB rec follows the computed rank-1 window by default; deviations carry a visible, data-grounded `overrideReason`.
- 7 commits on `master`, working tree clean.
