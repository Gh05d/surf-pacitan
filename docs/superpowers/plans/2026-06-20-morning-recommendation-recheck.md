# Morning Recommendation Recheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At 05:00 WIB, regenerate today's AI surf report only when today's per-hour/per-spot rating categories have actually changed since the report was generated (not on numeric drift).

**Architecture:** A new tz-aware cron job mirrors the existing 20:00 `scheduleDailyRecommendation`. It re-fetches weather/swell (free Open-Meteo), compares a deterministic rating signature of today's forecast against a baseline stored when the report was generated, and regenerates via the existing provider chain only on a mismatch (or a missing report/baseline).

**Tech Stack:** Bun + TypeScript, Hono server, Redis (ioredis), `bun test`.

## Global Constraints

- Tests must stay Redis-free: never import `cache.ts` (transitively) in a unit test — module load opens a Redis connection. Pure logic goes in `src/shared/`.
- Use relative imports (`../shared/...`, `./config`), never `@shared/*` path aliases.
- Verification gate is `bun test`, not `tsc` (pre-existing tsc path failures). Plus the pre-restart bundle check `bun build src/server/index.ts --target bun --outdir /tmp/x`.
- The recheck job MUST NOT call `fetchAndCacheTides` — zero StormGlass cost.
- Region-scoping is automatic via `REDIS_RECOMMENDATION_KEY_PREFIX = surf:<region>:recommendation:`.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

### Task 1: Rating signature (pure)

**Files:**
- Create: `src/shared/rating-signature.ts`
- Test: `tests/rating-signature.test.ts`

**Interfaces:**
- Consumes: `ForecastDay` from `../shared/types` (has `hourly: HourlyData[]`, each `HourlyData.hour: number` and `HourlyData.surfable: Record<string, "red"|"yellow"|"green">`).
- Produces: `ratingSignature(forecast: ForecastDay): string` — deterministic, spot-key-order-independent, depends only on `hourly[].hour` and `hourly[].surfable`.

- [ ] **Step 1: Write the failing test**

Create `tests/rating-signature.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { ratingSignature } from "../src/shared/rating-signature";
import type { ForecastDay } from "../src/shared/types";

function fc(hourly: ForecastDay["hourly"]): ForecastDay {
  return {
    date: "2026-06-20",
    location: { name: "Pacitan", lat: -8.22, lng: 111.13 },
    astronomy: { sunrise: "05:30", sunset: "17:30" },
    tideExtremes: [],
    hourly,
  };
}

function hr(hour: number, surfable: Record<string, "red" | "yellow" | "green">): ForecastDay["hourly"][number] {
  return {
    hour,
    tide: { height: 1.0, rising: true },
    swell: { height: 1.5, period: 11, direction: 200 },
    wind: { speed: 8, direction: 30, gusts: 12 },
    weather: { temp: 27, condition: "clear", precipitation: 0 },
    surfable,
  };
}

describe("ratingSignature", () => {
  test("identical rating grids produce identical signatures", () => {
    const a = fc([hr(6, { telengRia: "yellow", pancer: "green", pancerDoor: "green" })]);
    const b = fc([hr(6, { telengRia: "yellow", pancer: "green", pancerDoor: "green" })]);
    expect(ratingSignature(a)).toBe(ratingSignature(b));
  });

  test("a single category flip changes the signature", () => {
    const a = fc([hr(8, { telengRia: "red", pancer: "red", pancerDoor: "green" })]);
    const b = fc([hr(8, { telengRia: "red", pancer: "red", pancerDoor: "red" })]);
    expect(ratingSignature(a)).not.toBe(ratingSignature(b));
  });

  test("numeric-only drift (same categories) keeps the signature stable", () => {
    const a = fc([hr(8, { telengRia: "yellow", pancer: "green", pancerDoor: "green" })]);
    const b = JSON.parse(JSON.stringify(a)) as ForecastDay;
    b.hourly[0].swell.height = 0.91; // changed value, same surfable categories
    b.hourly[0].wind.speed = 14;
    expect(ratingSignature(b)).toBe(ratingSignature(a));
  });

  test("signature is independent of spot-key insertion order", () => {
    const a = fc([hr(8, { telengRia: "yellow", pancer: "green", pancerDoor: "red" })]);
    const b = fc([hr(8, { pancerDoor: "red", pancer: "green", telengRia: "yellow" })]);
    expect(ratingSignature(a)).toBe(ratingSignature(b));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/rating-signature.test.ts`
Expected: FAIL — `Cannot find module '../src/shared/rating-signature'` (or `ratingSignature is not a function`).

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/rating-signature.ts`:

```ts
import type { ForecastDay } from "./types";

// Deterministic string of every hour's per-spot rating category. Used to detect
// whether the green/yellow/red grid changed (vs. mere numeric drift) since a
// recommendation was generated, so the morning recheck regenerates only on a
// real category flip. Spot ids are sorted so the signature is independent of
// object-key enumeration order.
export function ratingSignature(forecast: ForecastDay): string {
  return forecast.hourly
    .map((h) => {
      const spots = Object.keys(h.surfable).sort();
      return `${h.hour}:` + spots.map((s) => `${s}=${h.surfable[s]}`).join(",");
    })
    .join("|");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/rating-signature.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/rating-signature.ts tests/rating-signature.test.ts
git commit -m "feat(rec): rating signature for category-change detection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Baseline storage helpers + config constant

**Files:**
- Modify: `src/server/cache.ts` (add two helpers after `setRecommendation`, ~line 60)
- Modify: `src/server/config.ts` (add constant after `RECOMMENDATION_LOCAL_MINUTE`, ~line 85)

**Interfaces:**
- Consumes: `REDIS_RECOMMENDATION_KEY_PREFIX` and `RECOMMENDATION_TTL_SECONDS` (already imported in `cache.ts`), and the module-level `redis` client.
- Produces:
  - `getRatingSignature(date: string): Promise<string | null>`
  - `setRatingSignature(date: string, sig: string): Promise<void>`
  - `RECOMMENDATION_RECHECK_LOCAL_HOUR: number` (= 5), consumed by Task 4.

No unit test: `cache.ts` opens Redis at module load (Global Constraints — never imported by tests). The config constant is a literal. Both are exercised through Task 3's injected-deps tests and the Task 4 bundle check.

- [ ] **Step 1: Add the config constant**

In `src/server/config.ts`, immediately after `export const RECOMMENDATION_LOCAL_MINUTE = 0;`:

```ts
// Morning recheck: re-rate today and regenerate the report only if the rating
// categories drifted since it was generated (cron.ts → recheckTodayRecommendation).
export const RECOMMENDATION_RECHECK_LOCAL_HOUR = 5;
```

- [ ] **Step 2: Add the cache helpers**

In `src/server/cache.ts`, immediately after the `setRecommendation` function (before `export { redis };`):

```ts
// Baseline rating signature captured when a recommendation was generated — the
// morning recheck compares today's live signature against it. Same key
// namespace + TTL as the recommendation it belongs to.
export async function getRatingSignature(date: string): Promise<string | null> {
  return redis.get(`${REDIS_RECOMMENDATION_KEY_PREFIX}${date}:ratingsig`);
}

export async function setRatingSignature(date: string, sig: string): Promise<void> {
  const key = `${REDIS_RECOMMENDATION_KEY_PREFIX}${date}:ratingsig`;
  await redis.set(key, sig, "EX", RECOMMENDATION_TTL_SECONDS);
}
```

- [ ] **Step 3: Verify the suite still passes and the server bundles**

Run: `bun test`
Expected: PASS, same count as before plus Task 1's 4 tests, 0 fail.

Run: `bun build src/server/index.ts --target bun --outdir /tmp/x && rm -rf /tmp/x`
Expected: `Bundled N modules`, exit 0 (no import errors).

- [ ] **Step 4: Commit**

```bash
git add src/server/cache.ts src/server/config.ts
git commit -m "feat(rec): rating-signature cache helpers + recheck hour constant

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Baseline write + recheck function

**Files:**
- Modify: `src/server/recommendation.ts` (imports ~196-210; `GenerateDeps` ~212-237; `DEFAULT_DEPS` ~239-252; `generateTomorrowRecommendation` success path ~345; add `recheckTodayRecommendation` after it ~352)
- Modify: `tests/recommendation.test.ts` (extend `makeDeps` ~418-439; add a new `describe` block)

**Interfaces:**
- Consumes: `ratingSignature` (Task 1), `getRatingSignature`/`setRatingSignature`/`getRecommendation` from `./cache` (Task 2 + existing), `todayLocal` from `../shared/time`, `TIMEZONE` (already imported), `generateTomorrowRecommendation` (existing).
- Produces: `recheckTodayRecommendation(deps?: GenerateDeps): Promise<void>` (consumed by Task 4). `GenerateDeps` gains `getRecommendation`, `getRatingSignature`, `setRatingSignature`.

- [ ] **Step 1: Write the failing tests**

In `tests/recommendation.test.ts`, first extend `makeDeps` — add these three lines inside the returned object (e.g. after `setRecommendation: mock(async () => {}),`):

```ts
    getRecommendation: mock(async () => null),
    getRatingSignature: mock(async () => null),
    setRatingSignature: mock(async () => {}),
```

Then update the top import to also pull in `recheckTodayRecommendation` and `ratingSignature`:

```ts
import { generateTomorrowRecommendation, recheckTodayRecommendation, type GenerateDeps } from "../src/server/recommendation";
import { ratingSignature } from "../src/shared/rating-signature";
```

Then add this `describe` block at the end of the file:

```ts
describe("recheckTodayRecommendation", () => {
  test("regenerates when no rec exists for today", async () => {
    const setRecommendation = mock(async () => {});
    await recheckTodayRecommendation(
      makeDeps({ getRecommendation: mock(async () => null), setRecommendation }),
    );
    expect(setRecommendation).toHaveBeenCalledTimes(1);
  });

  test("does NOT regenerate when the rating signature is unchanged", async () => {
    const forecast = sampleForecast({ date: "2026-05-20" });
    const setRecommendation = mock(async () => {});
    await recheckTodayRecommendation(
      makeDeps({
        getCachedDay: mock(async () => forecast),
        getRecommendation: mock(async () => ({ forDate: "2026-05-19" }) as any),
        getRatingSignature: mock(async () => ratingSignature(forecast)),
        setRecommendation,
      }),
    );
    expect(setRecommendation).not.toHaveBeenCalled();
  });

  test("regenerates when the rating signature changed", async () => {
    const forecast = sampleForecast({ date: "2026-05-20" });
    const setRecommendation = mock(async () => {});
    await recheckTodayRecommendation(
      makeDeps({
        getCachedDay: mock(async () => forecast),
        getRecommendation: mock(async () => ({ forDate: "2026-05-19" }) as any),
        getRatingSignature: mock(async () => "stale-signature"),
        setRecommendation,
      }),
    );
    expect(setRecommendation).toHaveBeenCalledTimes(1);
  });

  test("regenerates when the baseline signature is missing", async () => {
    const forecast = sampleForecast({ date: "2026-05-20" });
    const setRecommendation = mock(async () => {});
    await recheckTodayRecommendation(
      makeDeps({
        getCachedDay: mock(async () => forecast),
        getRecommendation: mock(async () => ({ forDate: "2026-05-19" }) as any),
        getRatingSignature: mock(async () => null),
        setRecommendation,
      }),
    );
    expect(setRecommendation).toHaveBeenCalledTimes(1);
  });

  test("no-op when today's forecast is missing", async () => {
    const setRecommendation = mock(async () => {});
    await recheckTodayRecommendation(
      makeDeps({ getCachedDay: mock(async () => null), setRecommendation }),
    );
    expect(setRecommendation).not.toHaveBeenCalled();
  });

  test("generateTomorrowRecommendation writes a baseline signature on success", async () => {
    const setRatingSignature = mock(async () => {});
    await generateTomorrowRecommendation(
      makeDeps({ setRecommendation: mock(async () => {}), setRatingSignature }),
    );
    expect(setRatingSignature).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/recommendation.test.ts`
Expected: FAIL — `recheckTodayRecommendation` not exported, and the baseline-signature test fails because `setRatingSignature` is never called yet.

- [ ] **Step 3: Implement**

In `src/server/recommendation.ts`:

(a) Extend the `./cache` import (line ~196):

```ts
import {
  getCachedDay as defaultGetCachedDay,
  setRecommendation as defaultSetRecommendation,
  getRecommendation as defaultGetRecommendation,
  getRatingSignature as defaultGetRatingSignature,
  setRatingSignature as defaultSetRatingSignature,
} from "./cache";
```

(b) Add imports for the signature helper and the date helper (near the other shared imports):

```ts
import { ratingSignature } from "../shared/rating-signature";
import { todayLocal } from "../shared/time";
```

(c) Add three fields to the `GenerateDeps` interface (after `setRecommendation: typeof defaultSetRecommendation;`):

```ts
  getRecommendation: typeof defaultGetRecommendation;
  getRatingSignature: typeof defaultGetRatingSignature;
  setRatingSignature: typeof defaultSetRatingSignature;
```

(d) Add the three defaults to `DEFAULT_DEPS` (after `setRecommendation: defaultSetRecommendation,`):

```ts
  getRecommendation: defaultGetRecommendation,
  getRatingSignature: defaultGetRatingSignature,
  setRatingSignature: defaultSetRatingSignature,
```

(e) In `generateTomorrowRecommendation`, write the baseline right after the successful `await deps.setRecommendation(rec);`:

```ts
      await deps.setRecommendation(rec);
      await deps.setRatingSignature(forDate, ratingSignature(forecast));
      console.log(`[recommendation] wrote rec for ${forDate} via ${provider}${tokensNote}`);
      return;
```

(f) Add `recheckTodayRecommendation` immediately after `generateTomorrowRecommendation`'s closing brace:

```ts
// Morning recheck (cron at RECOMMENDATION_RECHECK_LOCAL_HOUR): regenerate today's
// rec only if its rating categories drifted since generation. The chart re-rates
// every 3h, so the 20:00 snapshot can contradict the morning chart (2026-06-20:
// a recommended-green 08:00 hour drifted to red overnight). A missing rec is
// generated (recovery for a missed evening run).
export async function recheckTodayRecommendation(
  deps: GenerateDeps = DEFAULT_DEPS,
): Promise<void> {
  const today = todayLocal(TIMEZONE, deps.now());
  const forecast = await deps.getCachedDay(today);
  if (!forecast) {
    console.warn(`[recommendation] recheck: no cached forecast for ${today}; skipping`);
    return;
  }

  const rec = await deps.getRecommendation(today);
  if (!rec) {
    console.log(`[recommendation] recheck: no rec for ${today}; generating`);
    await generateTomorrowRecommendation(deps, today);
    return;
  }

  const sigNow = ratingSignature(forecast);
  const sigBase = await deps.getRatingSignature(today);
  if (sigBase === sigNow) {
    console.log(`[recommendation] recheck: ratings unchanged for ${today}; keeping rec`);
    return;
  }

  console.log(
    `[recommendation] recheck: ratings changed for ${today} (baseline ${sigBase ? "differs" : "missing"}); regenerating`,
  );
  await generateTomorrowRecommendation(deps, today);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/recommendation.test.ts`
Expected: PASS — all existing tests plus the 6 new ones, 0 fail.

- [ ] **Step 5: Run the full suite**

Run: `bun test`
Expected: PASS, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/server/recommendation.ts tests/recommendation.test.ts
git commit -m "feat(rec): recheckTodayRecommendation + baseline signature write

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire the cron job

**Files:**
- Modify: `src/server/cron.ts` (imports ~10-14; `startScheduler` recommendation block ~268-273; add `scheduleMorningRecheck` after `scheduleDailyRecommendation` ~302)

**Interfaces:**
- Consumes: `recheckTodayRecommendation` (Task 3), `RECOMMENDATION_RECHECK_LOCAL_HOUR` (Task 2), existing `nextLocalFireMs`, `fetchAndCacheWeather`, `TIMEZONE`, `RECOMMENDATION_ENABLED`, `RECOMMENDATION_LOCAL_HOUR`.
- Produces: a registered 05:00 WIB recheck timer. No unit test — `cron.ts` is intentionally kept out of `bun test` (it transitively imports `cache.ts` → Redis). Verified by the bundle check + a live smoke check.

- [ ] **Step 1: Import the new symbols**

In `src/server/cron.ts`, add `recheckTodayRecommendation` to the recommendation import and `RECOMMENDATION_RECHECK_LOCAL_HOUR` to the config import. Find the existing import of `generateTomorrowRecommendation`:

```ts
import { generateTomorrowRecommendation, recheckTodayRecommendation } from "./recommendation";
```

and add `RECOMMENDATION_RECHECK_LOCAL_HOUR` to the existing `./config` import list (alongside `RECOMMENDATION_LOCAL_HOUR`).

- [ ] **Step 2: Register the job in `startScheduler`**

In the `if (RECOMMENDATION_ENABLED) { ... }` block, after `scheduleDailyRecommendation();`:

```ts
    scheduleDailyRecommendation();
    scheduleMorningRecheck();
    console.log(
      `[cron] recommendation cron registered (${RECOMMENDATION_LOCAL_HOUR}:00 + recheck ${RECOMMENDATION_RECHECK_LOCAL_HOUR}:00 ${TIMEZONE})`,
    );
```

(Replace the existing single `console.log(...recommendation cron registered...)` line with the version above.)

- [ ] **Step 3: Add the scheduler function**

Immediately after the `scheduleDailyRecommendation` function (before `scheduleMidnightTideFetch`):

```ts
// Morning recheck: re-fetch weather/swell (free Open-Meteo — NOT tides) so today
// is freshly rated, then regenerate the rec only if its rating categories drifted.
// refShiftMs guards against an early-firing timer double-running (see
// scheduleDailyRecommendation).
function scheduleMorningRecheck(refShiftMs = 0): void {
  const ms =
    nextLocalFireMs(
      new Date(Date.now() + refShiftMs),
      RECOMMENDATION_RECHECK_LOCAL_HOUR,
      0,
      TIMEZONE,
    ) + refShiftMs;
  console.log(`[cron] next recommendation recheck in ${Math.round(ms / 60000)} minutes`);
  setTimeout(() => {
    fetchAndCacheWeather()
      .then(() => recheckTodayRecommendation())
      .catch((err) => console.error("[cron] morning recheck error:", err));
    scheduleMorningRecheck(60_000);
  }, ms);
}
```

- [ ] **Step 4: Verify the server bundles**

Run: `bun build src/server/index.ts --target bun --outdir /tmp/x && rm -rf /tmp/x`
Expected: `Bundled N modules`, exit 0.

- [ ] **Step 5: Run the full suite**

Run: `bun test`
Expected: PASS, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/server/cron.ts
git commit -m "feat(rec): schedule 05:00 WIB morning recheck cron

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Deployment (after all tasks)

1. Pre-flight: `bun build src/server/index.ts --target bun --outdir /tmp/x && rm -rf /tmp/x`.
2. Check `stormglassQuota` at `/api/status` (restart re-fetches tides = 3 requests).
3. `systemctl restart surf-pacitan.service`.
4. Confirm the registration log: `journalctl -u surf-pacitan.service --since "2 min ago" | grep "recommendation cron registered"` — should show `20:00 + recheck 5:00 Asia/Jakarta`.
5. (Optional) Smoke-test the recheck path immediately, regardless of clock:
   `bun -e 'import("./src/server/cron.ts").then(c => c.fetchAndCacheWeather()).then(() => import("./src/server/recommendation.ts")).then(m => m.recheckTodayRecommendation()).then(() => process.exit(0))'`
   Expected log: either `ratings unchanged ... keeping rec` or `ratings changed ... regenerating`.

## Self-Review

- **Spec coverage:** trigger = any category flip → Task 1 signature + Task 3 compare ✓; missing report → Task 3 `!rec` branch ✓; fixed hour constant → Task 2 ✓; cron at 05:00 → Task 4 ✓; baseline = ratings rec was based on → Task 3 step (e) writes sig from the same `forecast` ✓; zero StormGlass → Task 4 uses `fetchAndCacheWeather` only ✓.
- **Placeholder scan:** none — every code/test step has complete code.
- **Type consistency:** `ratingSignature(forecast)` signature identical in Tasks 1/3; `recheckTodayRecommendation(deps?)` identical in Tasks 3/4; `getRatingSignature`/`setRatingSignature` names identical across Tasks 2/3; deps fields `getRecommendation`/`getRatingSignature`/`setRatingSignature` added in Task 3 match `makeDeps` extension.
