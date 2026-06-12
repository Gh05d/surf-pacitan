# Region-Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the codebase reusable for arbitrary surf regions worldwide — one active region per deployment, selected via `REGION` env var, with Pacitan as the first region pack and **identical behavior** after migration.

**Architecture:** A typed `regions/<id>/` pack holds everything region-specific (spots + thresholds, coords, timezone, branding, LLM knowledge, swell-picker tuning). `src/shared/active-region.ts` resolves the active pack (server: `process.env.REGION`; client: Vite `define` at build time). All previously hardcoded UTC+7 math is replaced by IANA-timezone helpers (`Intl`-based, DST-correct). Redis keys gain the region id. The spec is `docs/superpowers/specs/2026-06-12-region-packs-design.md`.

**Tech Stack:** Bun + TypeScript, Hono, React 19, Vite 6, ioredis, `bun test`.

**Verification gates (apply throughout):**
- `bun test` — full suite must stay green after every task.
- NEVER boot the dev server or call `POST /api/refresh` to "check" — costs 3 of 10 daily StormGlass requests. Use `bun build src/server/index.ts --target bun --outdir /tmp/x && rm -rf /tmp/x` as the server bundle check instead.
- Existing convention: don't import `cache.ts` (transitively) in unit tests — it opens a Redis connection at module load. All new test files import only pure modules.
- Don't fix the pre-existing broken `../../../shared/types` import paths in client components in passing (CLAUDE.md rule). `bun test` is the gate, not `tsc`.

---

### Task 1: Timezone helpers (`src/shared/time.ts`)

Replaces all fixed `UTC+7` math with IANA-zone helpers. Pure module, no env reads, no Redis.

**Files:**
- Create: `src/shared/time.ts`
- Test: `tests/time.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/time.test.ts
import { describe, test, expect } from "bun:test";
import {
  localDateStr,
  localHHMM,
  localHour,
  todayLocal,
  tomorrowLocal,
  addDays,
  epochForLocal,
  nextLocalFireMs,
} from "../src/shared/time";

const WIB = "Asia/Jakarta";   // fixed UTC+7, no DST
const LISBON = "Europe/Lisbon"; // DST: UTC+0 winter / UTC+1 summer

describe("localDateStr / localHHMM / localHour", () => {
  test("converts UTC epoch to WIB local date and time", () => {
    // 2026-06-11T17:00:00Z = 2026-06-12 00:00 WIB
    const epoch = Date.parse("2026-06-11T17:00:00Z");
    expect(localDateStr(epoch, WIB)).toBe("2026-06-12");
    expect(localHHMM(epoch, WIB)).toBe("00:00");
    expect(localHour(epoch, WIB)).toBe(0);
  });

  test("matches the old +7h shift for an arbitrary instant", () => {
    // 2026-01-05T03:45:00Z = 10:45 WIB same day
    const epoch = Date.parse("2026-01-05T03:45:00Z");
    expect(localDateStr(epoch, WIB)).toBe("2026-01-05");
    expect(localHHMM(epoch, WIB)).toBe("10:45");
  });

  test("handles offset-suffixed input the same as Z input (same instant)", () => {
    // StormGlass sea-level echoes +07:00 timestamps; Date.parse normalizes.
    const a = Date.parse("2026-06-12T00:00:00+07:00");
    const b = Date.parse("2026-06-11T17:00:00Z");
    expect(a).toBe(b);
    expect(localDateStr(a, WIB)).toBe("2026-06-12");
  });

  test("DST: Lisbon is UTC+0 in winter, UTC+1 in summer", () => {
    expect(localHHMM(Date.parse("2026-01-15T12:00:00Z"), LISBON)).toBe("12:00");
    expect(localHHMM(Date.parse("2026-07-15T12:00:00Z"), LISBON)).toBe("13:00");
  });
});

describe("addDays / todayLocal / tomorrowLocal", () => {
  test("addDays handles month and year rollover", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-06-12", 3)).toBe("2026-06-15");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("todayLocal/tomorrowLocal use the zone's local date", () => {
    const now = new Date("2026-06-11T18:30:00Z"); // already 12th in WIB
    expect(todayLocal(WIB, now)).toBe("2026-06-12");
    expect(tomorrowLocal(WIB, now)).toBe("2026-06-13");
    expect(todayLocal(LISBON, now)).toBe("2026-06-11");
  });
});

describe("epochForLocal", () => {
  test("WIB local midnight equals 17:00 UTC the previous day", () => {
    expect(epochForLocal("2026-06-12", 0, 0, WIB)).toBe(Date.parse("2026-06-11T17:00:00Z"));
    expect(epochForLocal("2026-06-12", 20, 0, WIB)).toBe(Date.parse("2026-06-12T13:00:00Z"));
  });

  test("DST: Lisbon 20:00 local is 20:00 UTC in winter, 19:00 UTC in summer", () => {
    expect(epochForLocal("2026-01-15", 20, 0, LISBON)).toBe(Date.parse("2026-01-15T20:00:00Z"));
    expect(epochForLocal("2026-07-15", 20, 0, LISBON)).toBe(Date.parse("2026-07-15T19:00:00Z"));
  });

  test("roundtrip: localDateStr/localHHMM of epochForLocal returns the inputs", () => {
    const epoch = epochForLocal("2026-10-25", 6, 30, LISBON); // DST end day in EU
    expect(localDateStr(epoch, LISBON)).toBe("2026-10-25");
    expect(localHHMM(epoch, LISBON)).toBe("06:30");
  });
});

describe("nextLocalFireMs", () => {
  test("before today's target: fires later today (WIB 20:00)", () => {
    const now = new Date("2026-06-12T10:00:00Z"); // 17:00 WIB
    // next 20:00 WIB = 13:00 UTC → 3h
    expect(nextLocalFireMs(now, 20, 0, WIB)).toBe(3 * 3600 * 1000);
  });

  test("at/past today's target: fires tomorrow", () => {
    const now = new Date("2026-06-12T13:00:00Z"); // exactly 20:00 WIB
    expect(nextLocalFireMs(now, 20, 0, WIB)).toBe(24 * 3600 * 1000);
  });

  test("matches old hardcoded cron times for Asia/Jakarta", () => {
    const now = new Date("2026-06-12T00:00:00Z");
    // old: 17:00 UTC for midnight WIB → 17h; 13:00 UTC for 20:00 WIB → 13h
    expect(nextLocalFireMs(now, 0, 0, WIB)).toBe(17 * 3600 * 1000);
    expect(nextLocalFireMs(now, 20, 0, WIB)).toBe(13 * 3600 * 1000);
  });

  test("DST transition: interval across spring-forward is 23h, not 24h", () => {
    // EU spring forward 2026-03-29 01:00 UTC (Lisbon 01:00 → 02:00).
    // From 20:00 local on the 28th to 20:00 local on the 29th is 23 real hours.
    const now = new Date(epochForLocal("2026-03-28", 20, 0, LISBON) + 1000);
    const ms = nextLocalFireMs(now, 20, 0, LISBON);
    expect(ms).toBe(23 * 3600 * 1000 - 1000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/time.test.ts`
Expected: FAIL — `Cannot find module '../src/shared/time'`

- [ ] **Step 3: Implement `src/shared/time.ts`**

```typescript
// Timezone-aware date/time helpers driven by IANA zone names. Conversion is
// per-timestamp via Intl — never a fixed offset — so DST zones (Europe/Lisbon,
// Morocco, ...) stay correct year-round. Pure module: no env reads, no I/O.

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;  // 0-23
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function localParts(epochMs: number, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(epochMs);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function localDateStr(epochMs: number, timeZone: string): string {
  const p = localParts(epochMs, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function localHHMM(epochMs: number, timeZone: string): string {
  const p = localParts(epochMs, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function localHour(epochMs: number, timeZone: string): number {
  return localParts(epochMs, timeZone).hour;
}

export function todayLocal(timeZone: string, now: Date = new Date()): string {
  return localDateStr(now.getTime(), timeZone);
}

// Pure calendar arithmetic on a YYYY-MM-DD string — no timezone involved.
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function tomorrowLocal(timeZone: string, now: Date = new Date()): string {
  return addDays(todayLocal(timeZone, now), 1);
}

// Epoch (ms) of the wall-clock time `dateStr hour:minute` in `timeZone`.
// Two-pass offset correction: a nonexistent local time (spring-forward gap)
// resolves to the instant just after the jump — fine for cron scheduling.
export function epochForLocal(
  dateStr: string,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d, hour, minute);
  let guess = target;
  for (let i = 0; i < 2; i += 1) {
    const p = localParts(guess, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += target - asUtc;
  }
  return guess;
}

// Ms from `now` until the next wall-clock `hour:minute` in `timeZone`.
// If `now` is at or past today's target, returns ms until tomorrow's.
export function nextLocalFireMs(
  now: Date,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const today = todayLocal(timeZone, now);
  let fire = epochForLocal(today, hour, minute, timeZone);
  if (fire <= now.getTime()) {
    fire = epochForLocal(addDays(today, 1), hour, minute, timeZone);
  }
  return fire - now.getTime();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/time.test.ts`
Expected: PASS (all)

- [ ] **Step 5: Run the full suite, then commit**

Run: `bun test`
Expected: PASS (nothing else touched)

```bash
git add src/shared/time.ts tests/time.test.ts
git commit -m "feat(time): IANA-timezone helpers replacing fixed UTC+7 math"
```

---

### Task 2: Region types + `fallingTideCap` threshold + config validation

**Files:**
- Create: `src/shared/region.ts`
- Modify: `src/shared/spot-config.ts` (add `fallingTideCap` to `SpotThresholds` + the three Pacitan constants)
- Test: `tests/region.test.ts`

- [ ] **Step 1: Add `fallingTideCap` to `SpotThresholds`**

In `src/shared/spot-config.ts`, extend the interface (after the `wind` field, line 30):

```typescript
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
  // Sandbar breaks need rising water: when true, a green hour on a falling
  // tide is capped to yellow. Not universal — point/reef breaks elsewhere
  // don't care, so this is per-spot config, not global logic.
  fallingTideCap: boolean;
}
```

Then add `fallingTideCap: true,` to all three constants (`SURFABLE_TELENG_RIA`, `SURFABLE_PANCER`, `SURFABLE_PANCER_DOOR`), each directly after the `wind: { ... },` block. (All three Pacitan spots are sandbar-influenced beach breaks; the cap was previously global, so `true` everywhere preserves behavior.)

- [ ] **Step 2: Write the failing region tests**

```typescript
// tests/region.test.ts
import { describe, test, expect } from "bun:test";
import { validateRegionConfig, type RegionConfig } from "../src/shared/region";

function validRegion(): RegionConfig {
  return {
    id: "testland",
    branding: { appTitle: "Surf Testland", description: "Tide forecast for Testland" },
    location: { name: "Testland", lat: -8.0, lng: 111.0 },
    timezone: "Asia/Jakarta",
    coastFacingDirection: 195,
    map: { center: [-8.0, 111.0], zoom: 14 },
    weatherModel: "gfs_seamless",
    swellPicker: {
      secondaryMinHeightM: 0.3,
      secondaryPeriodRatio: 1.5,
      secondaryMinPrimaryRatio: 0.33,
    },
    spots: [
      {
        id: "mainBreak",
        label: "Main Break",
        abbr: "MB",
        emoji: "🏖️",
        character: "A beach break.",
        lat: -8.0,
        lng: 111.0,
        mapDesc: "Beach break",
        thresholds: {
          tide: { greenMin: 35, greenMax: 80, yellowMin: 20, yellowMax: 100 },
          swellDir: { ideal: 210, greenWindow: 25, yellowWindow: 45 },
          swellHeight: { greenMin: 0.5, yellowMin: 0.3 },
          swellPeriod: { greenMin: 8, yellowMin: 6 },
          facingDirection: 195,
          wind: {
            offshore: { greenMax: 30, yellowMax: 45 },
            crossShore: { greenMax: 20, yellowMax: 30 },
            onshore: { greenMax: 10, yellowMax: 20 },
          },
          fallingTideCap: true,
        },
      },
    ],
  };
}

describe("validateRegionConfig", () => {
  test("a well-formed region has no errors", () => {
    expect(validateRegionConfig(validRegion())).toEqual([]);
  });

  test("rejects empty spot list", () => {
    const r = { ...validRegion(), spots: [] };
    expect(validateRegionConfig(r)).toContain("at least one spot required");
  });

  test("rejects invalid IANA timezone", () => {
    const r = { ...validRegion(), timezone: "WIB+7" };
    expect(validateRegionConfig(r).some((e) => e.includes("invalid IANA timezone"))).toBe(true);
  });

  test("rejects duplicate spot ids", () => {
    const r = validRegion();
    r.spots = [r.spots[0], { ...r.spots[0] }];
    expect(validateRegionConfig(r).some((e) => e.includes("duplicate spot id"))).toBe(true);
  });

  test("rejects inverted tide window ordering", () => {
    const r = validRegion();
    r.spots[0].thresholds.tide = { greenMin: 80, greenMax: 35, yellowMin: 20, yellowMax: 100 };
    expect(validateRegionConfig(r).some((e) => e.includes("tide window ordering"))).toBe(true);
  });

  test("rejects inverted wind thresholds", () => {
    const r = validRegion();
    r.spots[0].thresholds.wind.onshore = { greenMax: 30, yellowMax: 10 };
    expect(validateRegionConfig(r).some((e) => e.includes("wind.onshore"))).toBe(true);
  });

  test("rejects bad region id", () => {
    const r = { ...validRegion(), id: "Test Land!" };
    expect(validateRegionConfig(r).some((e) => e.includes("invalid region id"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test tests/region.test.ts`
Expected: FAIL — `Cannot find module '../src/shared/region'`

- [ ] **Step 4: Implement `src/shared/region.ts`**

```typescript
// Region pack types + boot-time validation. A RegionConfig is everything
// region-specific the app needs; packs live in regions/<id>/. Pure module.
import type { SpotThresholds } from "./spot-config";

export interface SpotDef {
  /** Stable key used in SpotRatings payloads and the LLM schema. */
  id: string;
  label: string;     // full name shown in UI
  abbr: string;      // short code on tide-graph strips
  emoji: string;
  character: string; // 1-2 sentence spot character for the info sheet
  lat: number;       // map marker
  lng: number;
  mapDesc: string;   // one-liner in the map popup
  thresholds: SpotThresholds;
}

export interface RegionConfig {
  /** Lowercase slug — also the Redis key namespace (surf:<id>:...). */
  id: string;
  branding: { appTitle: string; description: string };
  /** Marine grid-cell coordinate used for StormGlass + Open-Meteo requests. */
  location: { name: string; lat: number; lng: number };
  /** IANA zone name, e.g. "Asia/Jakarta". */
  timezone: string;
  /** General coast orientation for the region-level wind label (Conditions card). */
  coastFacingDirection: number;
  map: { center: [number, number]; zoom: number };
  /** Open-Meteo `models` param — best_match can be wrong at specific coasts. */
  weatherModel: string;
  swellPicker: {
    secondaryMinHeightM: number;
    secondaryPeriodRatio: number;
    secondaryMinPrimaryRatio: number;
  };
  /** Wisuki forecast URL for scripts/verify-vs-wisuki.ts. Optional. */
  verifyWisukiUrl?: string;
  /** Ordered: display order AND candidate-ranking tiebreak order. */
  spots: SpotDef[];
}

export function validateRegionConfig(config: RegionConfig): string[] {
  const errors: string[] = [];

  if (!/^[a-z][a-z0-9-]*$/.test(config.id)) errors.push(`invalid region id: ${config.id}`);
  if (!config.branding?.appTitle) errors.push("branding.appTitle missing");
  if (!config.branding?.description) errors.push("branding.description missing");
  if (!config.spots?.length) errors.push("at least one spot required");

  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone });
  } catch {
    errors.push(`invalid IANA timezone: ${config.timezone}`);
  }

  const ids = new Set<string>();
  for (const s of config.spots ?? []) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(s.id)) errors.push(`invalid spot id: ${s.id}`);
    if (ids.has(s.id)) errors.push(`duplicate spot id: ${s.id}`);
    ids.add(s.id);
    if (!s.abbr) errors.push(`${s.id}: abbr missing`);
    if (!s.label) errors.push(`${s.id}: label missing`);

    const t = s.thresholds;
    if (!t) {
      errors.push(`${s.id}: thresholds missing`);
      continue;
    }
    if (
      !(
        t.tide.yellowMin <= t.tide.greenMin &&
        t.tide.greenMin < t.tide.greenMax &&
        t.tide.greenMax <= t.tide.yellowMax
      )
    ) {
      errors.push(`${s.id}: tide window ordering invalid`);
    }
    if (!(t.swellDir.greenWindow <= t.swellDir.yellowWindow)) {
      errors.push(`${s.id}: swellDir windows inverted`);
    }
    if (!(t.swellHeight.yellowMin <= t.swellHeight.greenMin)) {
      errors.push(`${s.id}: swellHeight thresholds inverted`);
    }
    if (!(t.swellPeriod.yellowMin <= t.swellPeriod.greenMin)) {
      errors.push(`${s.id}: swellPeriod thresholds inverted`);
    }
    for (const cat of ["offshore", "crossShore", "onshore"] as const) {
      if (!(t.wind[cat].greenMax <= t.wind[cat].yellowMax)) {
        errors.push(`${s.id}: wind.${cat} thresholds inverted`);
      }
    }
  }

  return errors;
}
```

- [ ] **Step 5: Run tests, full suite, commit**

Run: `bun test tests/region.test.ts` → PASS. Then `bun test` → PASS (the `fallingTideCap: true` additions keep all existing threshold consumers compiling; nothing reads the flag yet).

```bash
git add src/shared/region.ts src/shared/spot-config.ts tests/region.test.ts
git commit -m "feat(region): RegionConfig types, validation, fallingTideCap threshold"
```

---

### Task 3: Pacitan region pack + registry + active-region resolution

**Files:**
- Create: `regions/pacitan/index.ts`
- Create: `regions/index.ts`
- Create: `src/shared/active-region.ts`
- Test: append to `tests/region.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `tests/region.test.ts`)

```typescript
import { getRegion, REGIONS } from "../regions";
import { PACITAN } from "../regions/pacitan";
import { ACTIVE_REGION } from "../src/shared/active-region";

describe("region registry", () => {
  test("pacitan pack is registered and passes validation", () => {
    expect(getRegion("pacitan")).toBe(PACITAN);
    expect(validateRegionConfig(PACITAN)).toEqual([]);
  });

  test("unknown region throws with available ids", () => {
    expect(() => getRegion("atlantis")).toThrow(/Unknown REGION "atlantis"/);
    expect(() => getRegion("atlantis")).toThrow(/pacitan/);
  });

  test("ACTIVE_REGION defaults to pacitan (REGION env unset in tests)", () => {
    expect(ACTIVE_REGION.id).toBe("pacitan");
  });

  test("pacitan spots are west-to-east with the established thresholds", () => {
    expect(PACITAN.spots.map((s) => s.id)).toEqual(["telengRia", "pancerDoor", "pancer"]);
    const pancer = PACITAN.spots.find((s) => s.id === "pancer")!;
    expect(pancer.thresholds.tide).toEqual({ greenMin: 30, greenMax: 60, yellowMin: 15, yellowMax: 80 });
    expect(pancer.thresholds.swellDir.ideal).toBe(215);
    const telengRia = PACITAN.spots.find((s) => s.id === "telengRia")!;
    expect(telengRia.thresholds.swellDir).toEqual({ ideal: 195, greenWindow: 15, yellowWindow: 30 });
    expect(telengRia.thresholds.swellHeight.greenMin).toBe(0.4);
    for (const s of PACITAN.spots) expect(s.thresholds.fallingTideCap).toBe(true);
  });

  test("pacitan metadata matches the current deployment", () => {
    expect(PACITAN.timezone).toBe("Asia/Jakarta");
    expect(PACITAN.location).toEqual({ name: "Pacitan", lat: -8.22, lng: 111.13 });
    expect(PACITAN.weatherModel).toBe("gfs_seamless");
    expect(PACITAN.swellPicker).toEqual({
      secondaryMinHeightM: 0.3,
      secondaryPeriodRatio: 1.5,
      secondaryMinPrimaryRatio: 0.33,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/region.test.ts`
Expected: FAIL — `Cannot find module '../regions'`

- [ ] **Step 3: Create `regions/pacitan/index.ts`**

The data is moved verbatim from `src/shared/spot-config.ts` (thresholds), `src/shared/spots.ts` (display), `src/client/components/SpotMap.tsx` (coords, popup descriptions, map center/zoom), and `src/server/config.ts` (location, timezone, weather model, swell picker). The source files keep their copies until Tasks 4/6/10 rewire them — duplication is temporary within this plan.

```typescript
// Pacitan region pack — the original deployment. Geography user-confirmed
// 2026-05-29: west-to-east along the bay = Teleng Ria → Pancer Door → Pancer
// (Grindulu river mouth). See CLAUDE.md "Spot geography".
import type { RegionConfig } from "../../src/shared/region";

export const PACITAN: RegionConfig = {
  id: "pacitan",
  branding: {
    appTitle: "Surf Pacitan",
    description: "Tide forecast for Pacitan surf spots",
  },
  // Offshore marine grid cell (-8.291, 111.125) — deliberately NOT the bay
  // coordinate. Matches Wisuki/Surfline deep-water swell convention; the
  // coastal cell reads ~18% low. Investigated & kept 2026-05-29.
  location: { name: "Pacitan", lat: -8.22, lng: 111.13 },
  timezone: "Asia/Jakarta",
  // Pacitan beaches face ~south; 195° matches the per-spot facingDirection.
  coastFacingDirection: 195,
  map: { center: [-8.227, 111.088], zoom: 14 },
  // best_match returns suspect wind direction at this coastal point (NE 35°
  // while every other model says E 85-130°). GFS aligns with Wisuki/Surfline.
  weatherModel: "gfs_seamless",
  // Secondary-swell picker gates, verified via scripts/verify-vs-wisuki.ts.
  // See pickSurfSwell in src/server/open-meteo.ts for semantics.
  swellPicker: {
    secondaryMinHeightM: 0.3,
    secondaryPeriodRatio: 1.5,
    secondaryMinPrimaryRatio: 0.33,
  },
  verifyWisukiUrl: "https://wisuki.com/forecast/6041/pacitan",
  spots: [
    {
      // WESTERN end — sheltered by the western headland that tempers the main
      // SW dry-season swell; prefers direct S swell (wraps in with little
      // loss). Narrow southerly direction window; lowest height threshold on
      // purpose (covers the S-swell-works-small case — the narrow direction
      // window already penalizes shadowed SW days, don't double-count).
      id: "telengRia",
      label: "Teleng Ria",
      abbr: "TR",
      emoji: "🌅",
      character:
        "Sheltered behind the western headland — tame and beginner-friendly on a normal SW day. Direct S swell wraps in with little loss; handles peak high tide best of the three.",
      lat: -8.223,
      lng: 111.079,
      mapDesc: "Mellow beachbreak, beginner friendly",
      thresholds: {
        tide: { greenMin: 50, greenMax: 90, yellowMin: 30, yellowMax: 100 },
        swellDir: { ideal: 195, greenWindow: 15, yellowWindow: 30 },
        swellHeight: { greenMin: 0.4, yellowMin: 0.2 },
        swellPeriod: { greenMin: 7, yellowMin: 5 },
        facingDirection: 195,
        wind: {
          offshore: { greenMax: 35, yellowMax: 50 },
          crossShore: { greenMax: 25, yellowMax: 35 },
          onshore: { greenMax: 15, yellowMax: 25 },
        },
        fallingTideCap: true,
      },
    },
    {
      // MIDDLE — long open beach break, the all-rounder. Intermediate SW
      // exposure, tolerates higher tide than Pancer.
      id: "pancerDoor",
      label: "Pancer Door",
      abbr: "PD",
      emoji: "🏖️",
      character:
        "Long open beach break in the middle of the bay — the all-rounder. Tolerates higher tide than Pancer, likes SW swell.",
      lat: -8.2215,
      lng: 111.088,
      mapDesc: "Long open beach break",
      thresholds: {
        tide: { greenMin: 35, greenMax: 80, yellowMin: 20, yellowMax: 100 },
        swellDir: { ideal: 210, greenWindow: 25, yellowWindow: 45 },
        swellHeight: { greenMin: 0.5, yellowMin: 0.3 },
        swellPeriod: { greenMin: 8, yellowMin: 6 },
        facingDirection: 195,
        wind: {
          offshore: { greenMax: 30, yellowMax: 45 },
          crossShore: { greenMax: 20, yellowMax: 30 },
          onshore: { greenMax: 10, yellowMax: 20 },
        },
        fallingTideCap: true,
      },
    },
    {
      // EASTERN end — Grindulu river-mouth sandbar, most SW-exposed spot.
      // Drowns at high tide → low-to-mid rising window.
      id: "pancer",
      label: "Pancer",
      abbr: "P",
      emoji: "🏞️",
      character:
        "River-mouth sandbar at the east end, shaped by the Grindulu river and shifting seasonally. Most SW-exposed spot; best on low-to-mid rising tide — drowns at high tide.",
      lat: -8.2298,
      lng: 111.1026,
      mapDesc: "River-mouth sandbar, left",
      thresholds: {
        tide: { greenMin: 30, greenMax: 60, yellowMin: 15, yellowMax: 80 },
        swellDir: { ideal: 215, greenWindow: 25, yellowWindow: 45 },
        swellHeight: { greenMin: 0.5, yellowMin: 0.3 },
        swellPeriod: { greenMin: 8, yellowMin: 6 },
        facingDirection: 195,
        wind: {
          offshore: { greenMax: 30, yellowMax: 45 },
          crossShore: { greenMax: 20, yellowMax: 30 },
          onshore: { greenMax: 10, yellowMax: 20 },
        },
        fallingTideCap: true,
      },
    },
  ],
};
```

- [ ] **Step 4: Create `regions/index.ts`**

```typescript
import type { RegionConfig } from "../src/shared/region";
import { PACITAN } from "./pacitan";

export const REGIONS: Record<string, RegionConfig> = {
  [PACITAN.id]: PACITAN,
};

export function getRegion(id: string): RegionConfig {
  const region = REGIONS[id];
  if (!region) {
    throw new Error(
      `Unknown REGION "${id}" — available: ${Object.keys(REGIONS).join(", ")}`,
    );
  }
  return region;
}
```

- [ ] **Step 5: Create `src/shared/active-region.ts`**

```typescript
// Resolves the active region pack. The Bun server (and bun test) reads
// process.env.REGION; the Vite client build injects __REGION__ via `define`
// (esbuild replaces `typeof __REGION__` correctly). Default: pacitan.
// Fails fast on unknown region or invalid pack — at server boot AND at
// client build time, both of which import this module.
import { getRegion } from "../../regions";
import { validateRegionConfig } from "./region";

declare const __REGION__: string | undefined;

const regionId =
  typeof __REGION__ !== "undefined" && __REGION__
    ? __REGION__
    : (typeof process !== "undefined" ? process.env.REGION : undefined) ?? "pacitan";

export const ACTIVE_REGION = getRegion(regionId);

const errors = validateRegionConfig(ACTIVE_REGION);
if (errors.length) {
  throw new Error(
    `Region "${ACTIVE_REGION.id}" config invalid:\n  - ${errors.join("\n  - ")}`,
  );
}
```

- [ ] **Step 6: Run tests, full suite, commit**

Run: `bun test tests/region.test.ts` → PASS. `bun test` → PASS.

```bash
git add regions/ src/shared/active-region.ts tests/region.test.ts
git commit -m "feat(region): pacitan pack, registry, active-region resolution"
```

---

### Task 4: Dynamic spot system — `SpotName` → string, derived `SPOT_DISPLAY`/`SPOT_THRESHOLDS`, per-spot falling-tide cap

**Files:**
- Modify: `src/shared/types.ts:37`
- Modify: `src/shared/spots.ts` (derive from pack)
- Modify: `src/shared/spot-config.ts` (delete constants, derive `SPOT_THRESHOLDS`)
- Modify: `src/shared/surfable.ts` (required thresholds, cap from flag, dynamic `computeAllSpotRatings`)
- Test: append to `tests/surfable.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `tests/surfable.test.ts`)

```typescript
import { computeFactorBreakdown } from "../src/server/surfable";
import type { SurfableInput } from "../src/server/surfable";

describe("fallingTideCap flag (region-packs)", () => {
  // Self-contained input builder — the existing `input()` helpers in this
  // file are describe-block-scoped with differing arities; don't reuse them.
  function mkInput(hour: number, tidePercent: number, tideRising: boolean): SurfableInput {
    return {
      hour, tidePercent, tideRising,
      swellHeight: 1.5, swellPeriod: 12, swellDirection: 210,
      windSpeed: 5, windDirection: 10, // light offshore
      sunrise: "05:30", sunset: "17:30",
    };
  }

  const capped = { ...SPOT_THRESHOLDS.pancerDoor, fallingTideCap: true };
  const uncapped = { ...SPOT_THRESHOLDS.pancerDoor, fallingTideCap: false };

  test("baseline: these inputs are green on a rising tide", () => {
    expect(computeSurfable(mkInput(10, 50, true), capped)).toBe("green");
  });

  test("cap=true: would-be green on falling tide degrades to yellow", () => {
    expect(computeSurfable(mkInput(10, 50, false), capped)).toBe("yellow");
  });

  test("cap=false: green survives a falling tide", () => {
    expect(computeSurfable(mkInput(10, 50, false), uncapped)).toBe("green");
  });

  test("cap=false: breakdown has no fallingTide limiting factor", () => {
    const b = computeFactorBreakdown(mkInput(10, 50, false), uncapped);
    expect(b.final).toBe("green");
    expect(b.limiting).toEqual([]);
  });

  test("default: rates every active-region spot", () => {
    const ratings = computeAllSpotRatings(mkInput(10, 50, true));
    expect(Object.keys(ratings).sort()).toEqual(["pancer", "pancerDoor", "telengRia"]);
  });

  test("custom spot list: rates exactly those spots", () => {
    const spots = [{ id: "solo", thresholds: { ...SPOT_THRESHOLDS.pancer } }];
    const ratings = computeAllSpotRatings(mkInput(10, 50, true), spots);
    expect(Object.keys(ratings)).toEqual(["solo"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/surfable.test.ts`
Expected: FAIL — `computeAllSpotRatings` doesn't accept a spot list; `fallingTideCap` not read by `computeSurfable` (cap=false test gets "yellow").

- [ ] **Step 3: Change `SpotName` to string**

In `src/shared/types.ts` replace line 37:

```typescript
// Spot ids come from the active region pack (regions/<id>/index.ts) — no
// longer a closed union. Validity is enforced at runtime (region validation,
// validateRecommendation), not by the type system.
export type SpotName = string;
```

- [ ] **Step 4: Derive `SPOT_DISPLAY` from the pack**

Replace the whole body of `src/shared/spots.ts`:

```typescript
import type { SpotName } from "./types";
import { ACTIVE_REGION } from "./active-region";

export interface SpotDisplayInfo {
  key: SpotName;
  label: string;   // full name shown in UI
  abbr: string;    // short code shown on tide-graph strips
  emoji: string;   // per-spot descriptive emoji
  character: string; // 1-2 sentence spot character for the info sheet
}

// Derived from the active region pack, in pack order (= display order and
// candidate tiebreak order; for Pacitan that's west-to-east along the bay).
export const SPOT_DISPLAY: readonly SpotDisplayInfo[] = ACTIVE_REGION.spots.map((s) => ({
  key: s.id,
  label: s.label,
  abbr: s.abbr,
  emoji: s.emoji,
  character: s.character,
}));
```

- [ ] **Step 5: Derive `SPOT_THRESHOLDS`, delete the moved constants**

Replace `src/shared/spot-config.ts` content AFTER the `SpotThresholds` interface (keep `WindDirectionThresholds` + `SpotThresholds` exactly as of Task 2; delete `SURFABLE_TELENG_RIA`, `SURFABLE_PANCER`, `SURFABLE_PANCER_DOOR`, `SURFABLE`, and the old `SPOT_THRESHOLDS` literal) with:

```typescript
import { ACTIVE_REGION } from "./active-region";

// Derived view over the active region pack. Server code reaches this via the
// src/server/config.ts re-export; the client imports it directly.
export const SPOT_THRESHOLDS: Record<string, SpotThresholds> = Object.fromEntries(
  ACTIVE_REGION.spots.map((s) => [s.id, s.thresholds]),
);
```

(The `import` line goes at the top of the file. The interfaces stay. The header comment stays.)

- [ ] **Step 6: Rework `src/shared/surfable.ts`**

1. Replace the import on line 3: `import { SPOT_THRESHOLDS } from "./spot-config";` → 

```typescript
import { ACTIVE_REGION } from "./active-region";
import type { SpotDef } from "./region";
```

(Remove the `SURFABLE` import; `SPOT_THRESHOLDS` is no longer needed here.)

2. `computeSurfable` — thresholds becomes required, cap reads the flag:

```typescript
export function computeSurfable(input: SurfableInput, thresholds: SpotThresholds): Quality {
  if (!isWithinDaylight(input.hour, input.sunrise, input.sunset)) return "red";

  const tideQ      = computeTideQuality(input.tidePercent, thresholds.tide);
  const swellDirQ  = computeSwellDirQuality(input.swellDirection, thresholds.swellDir);
  const swellHQ    = computeSwellHeightQuality(input.swellHeight, thresholds.swellHeight);
  const swellPQ    = computeSwellPeriodQuality(input.swellPeriod, thresholds.swellPeriod);
  const windQ      = computeWindQuality(input.windSpeed, input.windDirection, thresholds);

  let final = minQuality([tideQ, swellDirQ, swellHQ, swellPQ, windQ]);

  // Falling-tide cap (per-spot flag): sandbar breaks need rising water —
  // green degrades to yellow.
  if (thresholds.fallingTideCap && !input.tideRising && final === "green") final = "yellow";

  return final;
}
```

3. `computeAllSpotRatings` — dynamic over the spot list (default: active region). Only `id` + `thresholds` are needed, so accept a narrow shape (keeps the variable-spot-count tests free of full `SpotDef` boilerplate):

```typescript
export function computeAllSpotRatings(
  input: SurfableInput,
  spots: ReadonlyArray<Pick<SpotDef, "id" | "thresholds">> = ACTIVE_REGION.spots,
): SpotRatings {
  const ratings: SpotRatings = {};
  for (const s of spots) ratings[s.id] = computeSurfable(input, s.thresholds);
  return ratings;
}
```

4. `computeFactorBreakdown` — thresholds required (drop `= SURFABLE`), cap conditional:

```typescript
export function computeFactorBreakdown(
  input: SurfableInput,
  thresholds: SpotThresholds,
): FactorBreakdown {
```

and inside, replace the green branch:

```typescript
  if (factorMin === "green") {
    if (thresholds.fallingTideCap && !input.tideRising) {
      return { final: "yellow", factors, limiting: ["fallingTide"], windCategory };
    }
    return { final: "green", factors, limiting: [], windCategory };
  }
```

- [ ] **Step 7: Run the full suite**

Run: `bun test`
Expected: PASS. Likely friction points to fix if they appear:
- `tests/spots.test.ts` asserts on `SPOT_DISPLAY` — the derived array carries identical data/order, should pass unchanged.
- Any test calling `computeSurfable`/`computeFactorBreakdown` without thresholds — grep first: `grep -n "computeSurfable(input([^)]*))\s*)" tests/` (audit on 2026-06-12 found none; all call sites pass `SPOT_THRESHOLDS.<spot>`).
- `tests/surfable.test.ts` existing falling-tide tests still pass because all pacitan spots have `fallingTideCap: true`.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/shared/spots.ts src/shared/spot-config.ts src/shared/surfable.ts tests/surfable.test.ts
git commit -m "feat(region): dynamic spot system — SpotName string, pack-derived display/thresholds, per-spot falling-tide cap"
```

---

### Task 5: Variable spot count in candidates

**Files:**
- Modify: `src/shared/candidates.ts:116-127`
- Test: append to `tests/candidates.test.ts`

- [ ] **Step 1: Write the failing test** (append to `tests/candidates.test.ts`; reuse the file's existing forecast-building helpers — read them first and construct hours the same way)

```typescript
describe("variable spot count (region-packs)", () => {
  // Self-contained forecast builder — independent of this file's other helpers.
  function mkForecast(hours: number[], surfable: Record<string, SurfableRating>): ForecastDay {
    return {
      date: "2026-06-13",
      location: { name: "Test", lat: 0, lng: 0 },
      astronomy: { sunrise: "05:30", sunset: "17:30" },
      tideExtremes: [],
      hourly: hours.map((hour) => ({
        hour,
        tide: { height: 1, rising: true },
        swell: { height: 1.5, period: 12, direction: 210 },
        wind: { speed: 5, direction: 10, gusts: 8 },
        weather: { temp: 28, condition: "clear", precipitation: 0 },
        surfable: { ...surfable },
      })),
    };
  }

  test("ranks windows for a 4-spot order and respects tiebreak order", () => {
    const surfable: Record<string, SurfableRating> = {
      alpha: "green", bravo: "green", charlie: "green", delta: "red",
    };
    const forecast = mkForecast([8, 9, 10, 11], surfable);
    const order = ["alpha", "bravo", "charlie", "delta"];
    const candidates = computeCandidateWindows(forecast, order);
    // alpha, bravo, charlie tie on every metric → resolved by spot order
    expect(candidates.map((c) => c.spot)).toEqual(["alpha", "bravo", "charlie"]);
    expect(candidates.map((c) => c.rank)).toEqual([1, 2, 3]);
  });

  test("single-spot order yields at most one candidate", () => {
    const forecast = mkForecast([8, 9, 10], { solo: "green" });
    const candidates = computeCandidateWindows(forecast, ["solo"]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].spot).toBe("solo");
  });
});
```

(`ForecastDay` and `SurfableRating` are already imported at the top of `tests/candidates.test.ts`.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/candidates.test.ts`
Expected: FAIL — `computeCandidateWindows` takes no second argument (TS error or candidates computed for pacitan spots only).

- [ ] **Step 3: Add the `spotOrder` parameter**

In `src/shared/candidates.ts`, change `computeCandidateWindows` (line 116):

```typescript
export function computeCandidateWindows(
  forecast: ForecastDay,
  spotOrder: readonly SpotName[] = SPOT_ORDER,
): CandidateWindow[] {
  const winners: ScoredWindow[] = [];
  for (const spot of spotOrder) {
    const best = bestWindowForSpot(forecast.hourly, spot);
    if (best) winners.push(best);
  }
  // Deterministic on full ties: pack order (west-to-east for Pacitan).
  winners.sort(
    (a, b) => compareWindows(a, b) || spotOrder.indexOf(a.spot) - spotOrder.indexOf(b.spot),
  );
  return winners.map((w, i) => toCandidate(w, i + 1));
}
```

`SPOT_ORDER` (line 30) stays as-is — it derives from `SPOT_DISPLAY`, which is now pack-derived. `bestRemainingWindow` keeps calling `computeCandidateWindows(...)` without the second arg (active region default).

- [ ] **Step 4: Run tests, full suite, commit**

Run: `bun test tests/candidates.test.ts` → PASS. `bun test` → PASS.

```bash
git add src/shared/candidates.ts tests/candidates.test.ts
git commit -m "feat(candidates): injectable spot order for variable spot counts"
```

---

### Task 6: Server config from the pack + region-scoped Redis keys

**Files:**
- Modify: `src/server/config.ts`

- [ ] **Step 1: Rewire `src/server/config.ts`**

Replace lines 1-7 (LOCATION/TIMEZONE) and the swell/model/Redis blocks. The full new top section:

```typescript
import { ACTIVE_REGION } from "../shared/active-region";

// Region pack (selected via REGION env, default "pacitan") — see
// regions/<id>/index.ts. These re-exports keep the established import
// surface (and the tests' mock.module spread pattern) unchanged.
export const REGION = ACTIVE_REGION;
export const LOCATION = ACTIVE_REGION.location;
export const TIMEZONE = ACTIVE_REGION.timezone;
```

Replace `OPEN_METEO_WEATHER_MODEL` (line 42, keep its explanatory comment but note it's per-region now):

```typescript
// Open-Meteo weather model — per-region: best_match can return suspect wind
// at specific coastal points (Pacitan: NE 35° while every other model says
// E 85-130°). Validate per region against a reference forecast.
export const OPEN_METEO_WEATHER_MODEL = ACTIVE_REGION.weatherModel;
```

Replace the three `SURF_SWELL_*` constants (lines 50-58, keep the long comment block above them):

```typescript
export const SURF_SWELL_SECONDARY_MIN_HEIGHT_M = ACTIVE_REGION.swellPicker.secondaryMinHeightM;
export const SURF_SWELL_SECONDARY_PERIOD_RATIO = ACTIVE_REGION.swellPicker.secondaryPeriodRatio;
export const SURF_SWELL_SECONDARY_MIN_PRIMARY_RATIO = ACTIVE_REGION.swellPicker.secondaryMinPrimaryRatio;
```

Replace the Redis key block (lines 70-74) and the recommendation key (line 120):

```typescript
// Redis — region-scoped so a region switch on the same server can't serve
// stale data from the previous region. (Old un-scoped surf:* keys from
// pre-region deployments expire via TTL; see the deploy notes in Task 14.)
export const REDIS_KEY_PREFIX = `surf:${ACTIVE_REGION.id}:forecast:`;
export const REDIS_META_KEY = `surf:${ACTIVE_REGION.id}:meta:last_fetch`;
export const REDIS_QUOTA_KEY = `surf:${ACTIVE_REGION.id}:meta:stormglass_quota`;
export const CACHE_TTL_SECONDS = 4 * 24 * 60 * 60; // 4 days
```

```typescript
export const REDIS_RECOMMENDATION_KEY_PREFIX = `surf:${ACTIVE_REGION.id}:recommendation:`;
```

Replace the cron-time constants — delete `TIDE_FETCH_HOUR` (line 68) and `RECOMMENDATION_CRON_UTC_HOUR`/`RECOMMENDATION_CRON_UTC_MINUTE` (lines 115-117), add in their place:

```typescript
// Cron times as LOCAL wall-clock times in REGION.timezone — converted to UTC
// per-firing by nextLocalFireMs (DST-correct). Tides at local midnight;
// recommendation at 20:00 local (read evening-of, plan tomorrow).
export const TIDE_FETCH_LOCAL_HOUR = 0;
export const RECOMMENDATION_LOCAL_HOUR = 20;
export const RECOMMENDATION_LOCAL_MINUTE = 0;
```

Everything else (StormGlass URL, Open-Meteo params, DeepSeek/CLI config, `REFRESH_TOKEN`, `DEFAULT_PORT`, `FORECAST_DAYS`, the `export * from "../shared/spot-config"`) stays unchanged.

- [ ] **Step 2: Run the full suite**

Run: `bun test`
Expected: `tests/open-meteo.test.ts` and `tests/routes.test.ts` PASS (derived values are identical for pacitan). `cron.ts` still imports the deleted `RECOMMENDATION_CRON_UTC_HOUR` — if `bun test` doesn't load `cron.ts` (it shouldn't, per the Redis rule), the suite is green but the bundle check fails:

Run: `bun build src/server/index.ts --target bun --outdir /tmp/x && rm -rf /tmp/x`
Expected: FAIL (cron.ts imports the removed constants) — that's the next task. Don't commit a broken bundle: do Task 6 and Task 7 in one commit **or** keep the old constants temporarily. Simplest: proceed straight to Task 7 and commit both together (single commit at end of Task 7).

---

### Task 7: Timezone-aware cron + routes + StormGlass parsers

**Files:**
- Modify: `src/server/stormglass.ts:1-26`
- Modify: `src/server/cron.ts` (getDateRange, both schedulers, log strings)
- Modify: `src/server/routes.ts:14-47, 94`
- Delete: `src/server/schedule.ts`, `tests/schedule.test.ts`
- Test: existing `tests/stormglass.test.ts` (must stay green unchanged — it pins both real timestamp formats)

- [ ] **Step 1: Make the StormGlass parsers tz-aware**

In `src/server/stormglass.ts`, replace lines 1-26 (imports + the three local helpers):

```typescript
import type { TideExtreme, AstronomyData } from "../shared/types";
import {
  LOCATION,
  STORMGLASS_BASE_URL,
  TIMEZONE,
} from "../server/config";
import { localDateStr, localHHMM, localHour } from "../shared/time";
```

Then update the three parsers to use epoch + zone (the epoch-based bucketing strategy is unchanged — only the offset math moves into the shared helpers):

```typescript
export function parseTideExtremes(raw: any, targetDate: string): TideExtreme[] {
  // Bucket by REGION-LOCAL date via epoch math — the extremes endpoint
  // returns UTC timestamps while sea-level echoes the request's offset, so a
  // raw string-prefix compare puts early-morning extremes on the wrong day.
  // Epoch-based conversion is correct for both formats.
  return (raw.data as any[])
    .filter((item) => localDateStr(Date.parse(item.time), TIMEZONE) === targetDate)
    .map((item) => ({
      time: localHHMM(Date.parse(item.time), TIMEZONE),
      height: item.height as number,
      type: item.type as "high" | "low",
    }));
}

export function parseSeaLevels(
  raw: any,
  targetDate: string
): { hour: number; height: number; rising: boolean }[] {
  // Build full indexed list for rising detection using adjacent entries.
  // Date bucketing uses epoch-based local conversion (NOT the raw timestamp
  // prefix) so it works whether the API returns +00:00 or +07:00 timestamps.
  const all = (raw.data as any[]).map((item, i) => {
    const epoch = Date.parse(item.time);
    return {
      idx: i,
      hour: localHour(epoch, TIMEZONE),
      height: item.sg as number,
      localDate: localDateStr(epoch, TIMEZONE),
    };
  });

  return all
    .filter((e) => e.localDate === targetDate)
    .map((e) => {
      const prev = all[e.idx - 1];
      const next = all[e.idx + 1];
      // Forward difference: "rising" describes the surf hour [H, H+1) — see
      // the convention note in CLAUDE.md. Fall back to backward diff at the
      // series end.
      const rising = next ? next.height > e.height : prev ? e.height > prev.height : false;
      return { hour: e.hour, height: e.height, rising };
    });
}

export function parseAstronomy(raw: any, targetDate?: string): AstronomyData {
  const entries = raw.data as any[];
  // Pick the entry whose sunrise falls on the target local date; the response
  // covers the whole forecast range, so data[0] is only day 1's astronomy.
  const match = targetDate
    ? entries.find((e) => localDateStr(Date.parse(e.sunrise), TIMEZONE) === targetDate)
    : undefined;
  const entry = match ?? entries[0];
  return {
    sunrise: localHHMM(Date.parse(entry.sunrise), TIMEZONE),
    sunset: localHHMM(Date.parse(entry.sunset), TIMEZONE),
  };
}
```

(`extractQuota` and everything below stays unchanged.)

Run: `bun test tests/stormglass.test.ts`
Expected: PASS — the fixtures pin both real formats (`+00:00` extremes, `+07:00` sea-level); for Asia/Jakarta the Intl conversion is numerically identical to the old `+7h` shift.

- [ ] **Step 2: Timezone-aware `getDateRange` + schedulers in `cron.ts`**

Replace the import block's config line and add time helpers:

```typescript
import {
  LOCATION, FORECAST_DAYS, WEATHER_FETCH_INTERVAL_MS, TIMEZONE,
  RECOMMENDATION_ENABLED,
  TIDE_FETCH_LOCAL_HOUR, RECOMMENDATION_LOCAL_HOUR, RECOMMENDATION_LOCAL_MINUTE,
} from "./config";
import { todayLocal, addDays, epochForLocal, nextLocalFireMs } from "../shared/time";
```

Remove `import { nextFireMs } from "./schedule";`.

Replace `getDateRange` (lines 26-50):

```typescript
function getDateRange(): { start: string; end: string; dates: string[] } {
  const today = todayLocal(TIMEZONE);
  const dates: string[] = [];
  for (let i = 0; i < FORECAST_DAYS; i++) dates.push(addDays(today, i));

  // Request window: local midnight of day 1 → local midnight after the last
  // day, sent as UTC instants (StormGlass accepts ISO-8601; these are the
  // same instants the old +07:00-suffixed strings encoded).
  const start = new Date(epochForLocal(dates[0], 0, 0, TIMEZONE)).toISOString();
  const end = new Date(epochForLocal(addDays(today, FORECAST_DAYS), 0, 0, TIMEZONE)).toISOString();

  return { start, end, dates };
}
```

Replace both schedulers (lines 297-340) — same refShift double-fire guard, local-time based:

```typescript
// refShiftMs is used by the re-arm path: shifting the reference past the fire
// time guards against a marginally-early timer (clock step/NTP) re-arming for
// "now" and running the job twice. The shift is added back to the delay so the
// timer still fires at the real target time. Initial arming uses no shift so a
// server start shortly before the target still catches today's run.
function scheduleDailyRecommendation(refShiftMs = 0): void {
  const ms =
    nextLocalFireMs(
      new Date(Date.now() + refShiftMs),
      RECOMMENDATION_LOCAL_HOUR,
      RECOMMENDATION_LOCAL_MINUTE,
      TIMEZONE,
    ) + refShiftMs;
  console.log(
    `[cron] next recommendation generation in ${Math.round(ms / 60000)} minutes`,
  );
  setTimeout(() => {
    generateTomorrowRecommendation().catch((err) =>
      console.error("[cron] generateTomorrowRecommendation error:", err),
    );
    scheduleDailyRecommendation(60_000);
  }, ms);
}

// refShiftMs: see scheduleDailyRecommendation — re-arm shifts the reference
// past the fire time so an early-firing timer can't double-fetch (each fetch
// costs 3 StormGlass requests).
function scheduleMidnightTideFetch(refShiftMs = 0): void {
  const ms =
    nextLocalFireMs(
      new Date(Date.now() + refShiftMs),
      TIDE_FETCH_LOCAL_HOUR,
      0,
      TIMEZONE,
    ) + refShiftMs;
  console.log(`[cron] next tide fetch scheduled in ${Math.round(ms / 60000)} minutes`);
  setTimeout(() => {
    fetchAndCacheTides().catch((err) =>
      console.error("[cron] midnight tide fetch error:", err)
    );
    scheduleMidnightTideFetch(60_000);
  }, ms);
}
```

Update the two log strings in `startScheduler`:
- `"[cron] recommendation cron registered (20:00 WIB)"` → `` `[cron] recommendation cron registered (${RECOMMENDATION_LOCAL_HOUR}:00 ${TIMEZONE})` ``
- `` `tides daily at midnight WIB` `` → `` `tides daily at midnight ${TIMEZONE}` ``

- [ ] **Step 3: Timezone-aware `routes.ts`**

Replace `todayWIB`/`tomorrowWIB` (lines 14-30) and the date loop in `/forecast` (lines 36-47):

```typescript
import { todayLocal, tomorrowLocal, addDays } from "../shared/time";
import { FORECAST_DAYS, RECOMMENDATION_ENABLED, REFRESH_TOKEN, TIMEZONE } from "./config";
```

`/forecast` handler:

```typescript
api.get("/forecast", async (c) => {
  const today = todayLocal(TIMEZONE);
  const dates: string[] = [];
  for (let i = 0; i < FORECAST_DAYS; i++) dates.push(addDays(today, i));

  const cachedDays = await getCachedDays(dates);
  const lastFetch = await getLastFetch();

  const response: ForecastResponse = {
    days: cachedDays.filter((d) => d !== null) as NonNullable<(typeof cachedDays)[number]>[],
    lastFetch,
  };

  return c.json(response);
});
```

`/recommendation` handler line 94:

```typescript
  const rec =
    (await getRecommendation(tomorrowLocal(TIMEZONE))) ??
    (await getRecommendation(todayLocal(TIMEZONE)));
```

Delete the `todayWIB`/`tomorrowWIB` function definitions.

- [ ] **Step 4: Delete `src/server/schedule.ts` and `tests/schedule.test.ts`**

`nextLocalFireMs` in `src/shared/time.ts` (tested in `tests/time.test.ts`, including the "matches old hardcoded cron times" case) replaces `nextFireMs` entirely.

```bash
git rm src/server/schedule.ts tests/schedule.test.ts
```

- [ ] **Step 5: Verify and commit (combined with Task 6)**

Run: `bun test`
Expected: PASS. `tests/routes.test.ts` mocks config via spread — derived values for pacitan are identical, so route behavior is unchanged.

Run: `bun build src/server/index.ts --target bun --outdir /tmp/x && rm -rf /tmp/x`
Expected: bundle succeeds (this catches the `cron.ts` import errors `bun test` can't see — cron is deliberately untested).

```bash
git add src/server/config.ts src/server/stormglass.ts src/server/cron.ts src/server/routes.ts
git commit -m "feat(region): pack-driven server config, region-scoped Redis keys, IANA-tz cron/routes/parsers"
```

---

### Task 8: Knowledge-base builder + region-aware recommendation

**Files:**
- Create: `regions/pacitan/knowledge-base.ts`
- Modify: `src/server/knowledge-base.ts` (becomes generic builder + registry)
- Modify: `src/server/recommendation.ts:22, 197, 251-259, 279, 297, 307`
- Test: append to `tests/recommendation.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `tests/recommendation.test.ts`)

```typescript
import { buildSystemPrompt } from "../src/server/knowledge-base";
import { PACITAN } from "../regions/pacitan";

describe("buildSystemPrompt (region-packs)", () => {
  test("composes regional knowledge with generic scaffold", () => {
    const prompt = buildSystemPrompt(PACITAN);
    // Regional part present
    expect(prompt).toContain("local Pacitan surf expert");
    expect(prompt).toContain("Grindulu river mouth");
    // Generic scaffold present
    expect(prompt).toContain("# Anti-Hallucination");
    expect(prompt).toContain("# Candidate Windows");
    expect(prompt).toContain("# Output");
  });

  test("spot-id unions are generated from the pack", () => {
    const prompt = buildSystemPrompt(PACITAN);
    expect(prompt).toContain('"telengRia" | "pancerDoor" | "pancer"');
    expect(prompt).not.toContain("yourSpotIdHere");
  });

  test("throws for a region without registered knowledge", () => {
    expect(() => buildSystemPrompt({ ...PACITAN, id: "atlantis" })).toThrow(/no knowledge base/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/recommendation.test.ts`
Expected: FAIL — `buildSystemPrompt` doesn't exist.

- [ ] **Step 3: Create `regions/pacitan/knowledge-base.ts`** (regional sections moved verbatim from the current `src/server/knowledge-base.ts` lines 2-38)

```typescript
// Pacitan-specific LLM knowledge: geography, sandbar dynamics, local wind
// pattern, tide-range interpretation. The generic prompt scaffold (input
// format, candidate rules, task, anti-hallucination, output schema) lives in
// src/server/knowledge-base.ts — this file is ONLY the regional expertise.
// Server-only: never import from client code (it would bundle the prompt).
export const PACITAN_KNOWLEDGE = `
You are a local Pacitan surf expert. You receive forecast data for exactly one day and must recommend the best surf window for that day.

# Spot Geography (west to east along the bay)

This matches the local layout (confirmed by the user) and the geographic/satellite evidence: standing on the beach facing the ocean, Teleng Ria is to the right (west), Pancer is to the left (east, at the Grindulu river mouth).

1. **Teleng Ria** (key: "telengRia") — westernmost spot
   - Faces ~195° (SSW)
   - Sheltered by the western headland, which tempers the main SW dry-season swell → prefers more directly southern swell (ideal ~195°). Shelter is direction-dependent: SW swell arrives shadowed and smaller (needs more open-ocean size on SW days — which is also why it's the tame beginner beach on a normal SW day), while direct S swell wraps in with little loss and works at smaller sizes
   - Handles peak high tide best
2. **Pancer Door** (key: "pancerDoor") — middle spot, long open beach
   - Faces ~195°
   - Intermediate SW exposure → prefers SW swell (ideal ~210°)
   - Tolerates higher tide than Pancer
3. **Pancer** (key: "pancer") — easternmost spot, at the Grindulu river mouth. Sandbar is shaped by the river and shifts seasonally.
   - Faces ~195°
   - Most SW-exposed spot (nothing shadows the SW swell) → favours SW swell over a wide window (ideal ~215°)
   - River-mouth sandbar drowns at high tide → works best at low-to-mid rising tide

# Sandbar Dynamics

Sandbar spots need RISING water for shape. Falling tide → water pulls back, waves go mushy or close out, even with perfect swell and wind. A "green" rating on a falling tide should always be taken with a grain of salt.

# Wind Interpretation

- Offshore (wind from N/NE, away from the sea): blows waves hollow, keeps them clean. Best scenario.
- Cross-shore (wind from E or W): acceptable up to ~25 km/h
- Onshore (wind from S, toward the coast): blows waves flat / chaotic. Bad above ~15 km/h.

Local pattern: mornings are often offshore (land-to-sea breeze), typically flipping to onshore between 10:00–13:00 (sea breeze). Early sessions are almost always cleaner.

# Tide Range Context

The \`tideRange\` field is the daily span (max − min in meters):
- >2.5m → spring tide: wide usable window, but strong currents. May sweep sideways.
- 1.5–2.5m → normal range, nothing unusual
- <1.5m → neap tide: narrow window, less push, weaker waves — hard if the swell is also small.
`.trim();
```

- [ ] **Step 4: Rewrite `src/server/knowledge-base.ts`** (generic scaffold, spot-id unions generated from the pack; the generic text is moved verbatim from the old lines 40-93)

```typescript
// Generic LLM prompt scaffold for the daily recommendation. Region expertise
// (geography, local wind pattern, tide ranges) comes from the region pack's
// knowledge-base file via the registry below; the input format, candidate
// rules, task, anti-hallucination rules, and output schema are
// region-independent and live here.
import type { RegionConfig } from "../shared/region";
import { ACTIVE_REGION } from "../shared/active-region";
import { PACITAN_KNOWLEDGE } from "../../regions/pacitan/knowledge-base";

// Server-only registry — keeps prompt text out of the client bundle (which is
// why RegionConfig has no knowledgeBase field).
const REGION_KNOWLEDGE: Record<string, string> = {
  pacitan: PACITAN_KNOWLEDGE,
};

export function buildSystemPrompt(region: RegionConfig = ACTIVE_REGION): string {
  const regional = REGION_KNOWLEDGE[region.id];
  if (!regional) {
    throw new Error(
      `no knowledge base registered for region "${region.id}" — add it to REGION_KNOWLEDGE in src/server/knowledge-base.ts`,
    );
  }

  const spotIdUnion = region.spots.map((s) => `"${s.id}"`).join(" | ");
  const surfableShape = region.spots
    .map((s, i) => (i === 0 ? `"${s.id}": "green"|"yellow"|"red"` : `"${s.id}": ...`))
    .join(", ");

  return `
${regional}

# Input Data Format

You receive a JSON object:
\`\`\`
{
  "forDate": "YYYY-MM-DD",
  "tideRange": number,            // meters
  "astronomy": { "sunrise": "HH:MM", "sunset": "HH:MM" },
  "tideExtremes": [{ "time": "HH:MM", "height": m, "type": "high"|"low" }],
  "candidateWindows": [{ "rank": 1, "spot": ${spotIdUnion}, "start": "HH:00", "end": "HH:00",
                         "ratings": "10g 11g", "greens": 2, "risingShare": 0..1, "meanWind": km/h }],
  "hourly": [{ "hour": 0-23, "tide": {height, rising}, "swell": {height, period, direction},
               "wind": {speed, direction, gusts}, "weather": {condition, precipitation},
               "surfable": { ${surfableShape} } }]
}
\`\`\`

# Candidate Windows

\`candidateWindows\` are the best surf windows computed from the per-hour \`surfable\` ratings, ranked best-first (rank 1 = best window of the day).

- DEFAULT: recommend candidate rank 1 unchanged (same spot, same start/end).
- You MAY deviate ONLY when specific hourly data gives a concrete reason. A deviation means: a different spot than rank 1, OR a window whose start or end moves more than 1 hour from rank 1's. (Nudging rank 1's own window by up to 1 hour is not a deviation — no reason needed.) For any real deviation you MUST fill \`overrideReason\`, citing the data with numbers (max 300 chars, e.g. "wind jumps 12→22 km/h at 10:00").
- When you follow candidate rank 1, omit \`overrideReason\`.
- NEVER recommend a window that includes an hour rated "red" for the chosen spot.
- A candidate can be the best window of the day even with \`greens: 0\` (all-yellow). On marginal days still DEFAULT to rank 1 — recommend it and note in \`warnings\` that conditions are marginal. If you genuinely prefer a different window, that is a deviation and requires \`overrideReason\`.
- If \`candidateWindows\` is empty (fully red day), recommend the least-bad daylight window and warn clearly.

# Task

Recommend exactly **one** best spot and **one** best window for \`forDate\`. Give 2–3 sentences of reasoning. Respond in **English**. List up to 3 short warnings if relevant (e.g. wind flipping early, strong current, rain). Otherwise leave the list empty.

# Anti-Hallucination

- Only reference values from the provided forecast object
- Do not invent numbers, trends, swell pulses, or weather events that aren't in the data
- If conditions are marginal or ambiguous, say so explicitly
- \`bestWindow\` start AND end MUST fall within 00:00–23:59 of \`forDate\`
- Never surf before sunrise or after sunset — respect \`astronomy\`

# Output

Respond with EXACTLY this JSON schema (no extra fields, no markdown, no prose outside). All string values must be in English:

\`\`\`
{
  "bestSpot": ${spotIdUnion},
  "bestWindow": { "start": "HH:MM", "end": "HH:MM" },
  "headline": "one short sentence in English, max 200 chars",
  "reasoning": "2–3 sentences in English explaining why this spot in this window, max 600 chars",
  "warnings": ["short warnings in English, max 200 chars each, max 3 entries"],
  "overrideReason": "ONLY when deviating from candidate rank 1: the concrete data-grounded reason, max 300 chars. Omit otherwise."
}
\`\`\`
`.trim();
}
```

Note: the old `PACITAN_SURF_KNOWLEDGE` export is gone — `recommendation.ts` is its only importer (verify with `grep -rn "PACITAN_SURF_KNOWLEDGE" src/ tests/ scripts/`).

- [ ] **Step 5: Region-aware `recommendation.ts`**

1. Line 22 — dynamic valid spots:

```typescript
import { ACTIVE_REGION } from "../shared/active-region";

const VALID_SPOTS: SpotName[] = ACTIVE_REGION.spots.map((s) => s.id);
```

2. Line 197 — `import { PACITAN_SURF_KNOWLEDGE } from "./knowledge-base";` → `import { buildSystemPrompt } from "./knowledge-base";`

3. Lines 251-259 — replace `tomorrowDateWIB` with the shared helper:

```typescript
import { tomorrowLocal } from "../shared/time";
import { TIMEZONE } from "./config";
```

Delete the `tomorrowDateWIB` function; line 279 becomes:

```typescript
  const forDate = forDateOverride ?? tomorrowLocal(TIMEZONE, deps.now());
```

4. Lines 297 and 307 — `systemPrompt: PACITAN_SURF_KNOWLEDGE,` → `systemPrompt: buildSystemPrompt(),` (both provider branches). Hoist it above the loop:

```typescript
  const systemPrompt = buildSystemPrompt();
```

and pass `systemPrompt` in both calls.

- [ ] **Step 6: Run tests, full suite, commit**

Run: `bun test tests/recommendation.test.ts` → PASS (existing validation tests use pacitan spot ids — unchanged). `bun test` → PASS.

```bash
git add regions/pacitan/knowledge-base.ts src/server/knowledge-base.ts src/server/recommendation.ts tests/recommendation.test.ts
git commit -m "feat(recommendation): region-pack knowledge base, generic prompt scaffold, dynamic spot ids"
```

---

### Task 9: Region-aware client components

**Files:**
- Modify: `src/client/components/SpotMap.tsx:22-33`
- Modify: `src/client/components/TideGraph.tsx:31-36`
- Modify: `src/client/components/RecommendationCard.tsx:14-26`
- Modify: `src/client/components/Conditions.tsx:15-25`
- Modify: `src/client/components/SpotInfoSheet.tsx:29-35`
- Modify: `src/client/components/Header.tsx:17`
- Modify: `src/client/components/NowBanner.tsx:15-17` (comment only)

No unit tests cover these components (no DOM test setup in this repo) — the gates are `bun test` (shared imports still resolve), the Vite build in Task 10, and the manual visual check in Task 14.

- [ ] **Step 1: SpotMap from the pack**

Replace lines 22-33 of `SpotMap.tsx`:

```typescript
import { ACTIVE_REGION } from "../../shared/active-region";

// Spot markers come from the active region pack, in pack order.
const SPOTS = ACTIVE_REGION.spots.map((s) => ({
  key: s.id as SpotName,
  name: s.label,
  lat: s.lat,
  lng: s.lng,
  desc: s.mapDesc,
  emoji: s.emoji,
}));

const DEFAULT_CENTER: L.LatLngExpression = ACTIVE_REGION.map.center;
const DEFAULT_ZOOM = ACTIVE_REGION.map.zoom;
const FLY_TO_ZOOM = DEFAULT_ZOOM + 1;
```

Remove the now-unused `import { SPOT_DISPLAY } from "../../shared/spots";` if nothing else in the file uses it.

- [ ] **Step 2: TideGraph strips scale with spot count**

Replace lines 31-36 of `TideGraph.tsx`:

```typescript
const STRIP_HEIGHT = 24; // px per spot strip
const STRIP_GAP = 2;     // px between strips
const SPOT_COUNT = SPOT_DISPLAY.length;
const STRIP_BLOCK_HEIGHT = STRIP_HEIGHT * SPOT_COUNT + STRIP_GAP * (SPOT_COUNT - 1);
const STRIP_TOP_DIVIDER = 1; // px top separator line
const STRIP_RESERVED = STRIP_BLOCK_HEIGHT + STRIP_TOP_DIVIDER;
const STRIP_LEFT_GUTTER = 22; // px for abbreviation labels (currently unused but reserved)
```

(The drawing loop already iterates `SPOT_DISPLAY` — no other change. For pacitan, `STRIP_RESERVED` stays exactly 77px.)

- [ ] **Step 3: RecommendationCard local-date helper**

Replace lines 14-22 of `RecommendationCard.tsx` (the `todayWIB` function) with:

```typescript
import { todayLocal } from "../../shared/time";
import { ACTIVE_REGION } from "../../shared/active-region";
```

```typescript
function eyebrowFor(forDate: string): string {
  return forDate === todayLocal(ACTIVE_REGION.timezone)
    ? "🌅 Recommendation for today"
    : "🌅 Recommendation for tomorrow";
}
```

- [ ] **Step 4: Conditions wind label from shared logic**

Replace lines 15-25 of `Conditions.tsx` (the hardcoded `windType`) with:

```typescript
import { getWindCategory } from "../../shared/surfable";
import { ACTIVE_REGION } from "../../shared/active-region";

// Region-level wind label (the rating engine judges per-spot via thresholds;
// this card is a single region-wide summary, so it uses the region's general
// coast orientation).
function windType(deg: number): { label: string; color: string } {
  const cat = getWindCategory(deg, ACTIVE_REGION.coastFacingDirection);
  if (cat === "offshore") return { label: "Offshore", color: "var(--green)" };
  if (cat === "onshore") return { label: "Onshore", color: "var(--red)" };
  return { label: "Cross-shore", color: "var(--yellow)" };
}
```

Known small display delta for Pacitan: boundaries move from the old hand-rolled 315–45/135–225 bands to `getWindCategory`'s ±60/±120 around 195° (e.g. wind from 230° now reads Onshore instead of Cross-shore). This makes the card consistent with the rating engine — intended.

- [ ] **Step 5: SpotInfoSheet falling-tide line conditional**

In `SpotInfoSheet.tsx` lines 29-35, build the list conditionally:

```typescript
  const lines = [
    tideLine(t.tide),
    `Swell direction: ideal ${degreesToCompass(t.swellDir.ideal)} (${t.swellDir.ideal}°), good within ±${t.swellDir.greenWindow}°, workable within ±${t.swellDir.yellowWindow}°.`,
    `Swell size: from ${t.swellHeight.greenMin} m at ${t.swellPeriod.greenMin}s+ period; below ${t.swellHeight.yellowMin} m or ${t.swellPeriod.yellowMin}s it won't break properly.`,
    `Wind: offshore fine up to ${t.wind.offshore.greenMax} km/h, cross-shore up to ${t.wind.crossShore.greenMax}, onshore only up to ${t.wind.onshore.greenMax}.`,
    ...(t.fallingTideCap
      ? ["Rising water is always better — falling tide caps any green hour to yellow."]
      : []),
  ];
```

- [ ] **Step 6: Header + NowBanner**

`Header.tsx` line 17 — add the import and replace the heading:

```typescript
import { ACTIVE_REGION } from "../../shared/active-region";
```

```tsx
      <h1>🏄 {ACTIVE_REGION.branding.appTitle}</h1>
```

(appTitle is "Surf Pacitan" — rendered output unchanged for the current deployment.)

`NowBanner.tsx` lines 15-17, update the comment only:

```typescript
// Today-only: the best remaining surf window from the current hour onwards.
// Uses device time — the app's user is on-site in the region, a deliberate
// simplification.
```

- [ ] **Step 7: Verify and commit**

Run: `bun test` → PASS.
Run: `bunx vite build --outDir /tmp/vite-check` then `rm -rf /tmp/vite-check`
Expected: build succeeds (catches client-side import/type errors that `bun test` never loads). Do NOT build to `/var/www/surf-pacitan` yet — that's the deploy step in Task 14.

```bash
git add src/client/components/
git commit -m "feat(client): region-pack-driven map, strips, wind label, branding"
```

---

### Task 10: Build-time region injection (Vite define, HTML placeholders, manifest template, configurable paths)

**Files:**
- Modify: `vite.config.ts`
- Modify: `index.html:9-11`
- Create: `src/client/manifest.template.json` (moved from `public/manifest.json`)
- Delete: `public/manifest.json`
- Modify: `src/server/index.ts:17-20, 26`

- [ ] **Step 1: HTML placeholders**

In `index.html` replace lines 9-11:

```html
    <meta name="apple-mobile-web-app-title" content="%REGION_TITLE%" />
    <meta name="description" content="%REGION_DESCRIPTION%" />
    <title>%REGION_TITLE%</title>
```

- [ ] **Step 2: Move the manifest to a template**

```bash
git mv public/manifest.json src/client/manifest.template.json
```

Content stays as-is — `name`, `short_name`, `description` are overwritten by the plugin; icons/colors are region-independent.

- [ ] **Step 3: Rewrite `vite.config.ts`**

```typescript
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "node:fs";
import { getRegion } from "./regions";

// Build-time region selection: REGION env at build time (default pacitan).
// The client bundle gets the id injected via define (__REGION__) so
// src/shared/active-region.ts resolves the same pack at runtime.
const region = getRegion(process.env.REGION ?? "pacitan");

function regionHtmlAndManifest(): Plugin {
  const manifestSource = () => {
    const base = JSON.parse(
      readFileSync(path.resolve(__dirname, "src/client/manifest.template.json"), "utf-8"),
    );
    base.name = region.branding.appTitle;
    base.short_name = region.branding.appTitle;
    base.description = region.branding.description;
    return JSON.stringify(base, null, 2);
  };

  return {
    name: "region-html-manifest",
    transformIndexHtml(html) {
      return html
        .replaceAll("%REGION_TITLE%", region.branding.appTitle)
        .replaceAll("%REGION_DESCRIPTION%", region.branding.description);
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.json", source: manifestSource() });
    },
    configureServer(server) {
      // Dev server: manifest.json no longer lives in public/.
      server.middlewares.use("/manifest.json", (_req, res) => {
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(manifestSource());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), regionHtmlAndManifest()],
  root: ".",
  publicDir: "public",
  define: {
    __REGION__: JSON.stringify(process.env.REGION ?? "pacitan"),
  },
  build: {
    // Per-deployment override: BUILD_OUT_DIR=/var/www/surf-<region> bun run build
    outDir: process.env.BUILD_OUT_DIR ?? "/var/www/surf-pacitan",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@client": path.resolve(__dirname, "src/client"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3100",
    },
  },
});
```

- [ ] **Step 4: Configurable static root in the server**

In `src/server/index.ts` replace lines 17-20 and the log line 26:

```typescript
// In production: serve static frontend files
const staticRoot = process.env.STATIC_ROOT ?? "/var/www/surf-pacitan";
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: staticRoot }));
  app.get("*", serveStatic({ path: `${staticRoot}/index.html` }));
}
```

```typescript
import { ACTIVE_REGION } from "../shared/active-region";
```

```typescript
console.log(`[server] surf (region: ${ACTIVE_REGION.id}) listening on port ${port}`);
```

- [ ] **Step 5: Verify and commit**

Run: `bun test` → PASS.
Run: `bunx vite build --outDir /tmp/vite-check`
Expected: build succeeds. Then verify the injection:

```bash
grep -o "<title>[^<]*</title>" /tmp/vite-check/index.html        # → <title>Surf Pacitan</title>
python3 -c "import json; m=json.load(open('/tmp/vite-check/manifest.json')); print(m['name'], '|', m['description'])"
grep -c "%REGION_TITLE%" /tmp/vite-check/index.html || true       # → 0 matches
rm -rf /tmp/vite-check
```

Run the server bundle check: `bun build src/server/index.ts --target bun --outdir /tmp/x && rm -rf /tmp/x` → succeeds.

```bash
# the public/manifest.json → src/client/manifest.template.json move is already staged by git mv (Step 2)
git add vite.config.ts index.html src/client/manifest.template.json src/server/index.ts
git commit -m "feat(build): build-time region injection — define, HTML/manifest templating, configurable paths"
```

---

### Task 11: Parameterize the Wisuki verify script

**Files:**
- Modify: `scripts/verify-vs-wisuki.ts:7-12, 20, 35-41`

- [ ] **Step 1: Read region data instead of hardcoded Pacitan**

Replace lines 7-12:

```typescript
import { pickSurfSwell } from "../src/server/open-meteo";
import { ACTIVE_REGION } from "../src/shared/active-region";

const LOCATION = ACTIVE_REGION.location;
const WISUKI_URL = ACTIVE_REGION.verifyWisukiUrl;
if (!WISUKI_URL) {
  console.error(
    `region "${ACTIVE_REGION.id}" has no verifyWisukiUrl — add one to regions/${ACTIVE_REGION.id}/index.ts`,
  );
  process.exit(1);
}

const CACHE_DIR = "/tmp";
const HTML_PATH = `${CACHE_DIR}/wisuki-${ACTIVE_REGION.id}.html`;
const OM_PATH = `${CACHE_DIR}/verify-wisuki-om-${ACTIVE_REGION.id}.json`;
```

Line 20: `const resp = await fetch("https://wisuki.com/forecast/6041/pacitan", {` → `const resp = await fetch(WISUKI_URL, {`

Line 39: `timezone: "Asia/Jakarta",` → `timezone: ACTIVE_REGION.timezone,`

(The old `import { LOCATION } from "../src/server/config";` is replaced by the const above — the rest of the script reads `LOCATION.lat/lng` unchanged.)

- [ ] **Step 2: Verify and commit**

Run: `bun run scripts/verify-vs-wisuki.ts`
Expected: completes with the usual agreement report; target **100% surfable-rating-bin agreement** (this is also the Task 14 regression gate — same picker, same thresholds, same coordinate). Uses cached `/tmp` files when present; no StormGlass quota involved (Wisuki + Open-Meteo only).

```bash
git add scripts/verify-vs-wisuki.ts
git commit -m "feat(verify): region-pack-driven wisuki verification"
```

---

### Task 12: Region onboarding guide

**Files:**
- Create: `regions/README.md`

- [ ] **Step 1: Write the guide**

```markdown
# Region Packs

One folder per region. Exactly ONE region is active per deployment, selected by
the `REGION` env var (server + `bun test`) and at build time for the client
(`REGION=<id> bun run build`). Default: `pacitan`.

A pack = `regions/<id>/index.ts` (a `RegionConfig`, see `src/shared/region.ts`)
+ `regions/<id>/knowledge-base.ts` (regional LLM expertise, server-only).
Register both: the config in `regions/index.ts` (`REGIONS`), the knowledge in
`src/server/knowledge-base.ts` (`REGION_KNOWLEDGE`).

## Adding a region — checklist

Thresholds and knowledge CANNOT be copied from another region — they encode
local geography. Budget a few hours of validation against a reference
forecast (Wisuki/Surfline) before trusting the ratings.

1. **Marine grid cell** — pick `location` for the Open-Meteo Marine API
   (~9 km grid). Compare candidate cells' swell height/direction/period
   against Wisuki/Surfline for the area. Prefer the offshore cell that
   matches the deep-water convention (Pacitan lesson 2026-05-29: the coastal
   cell read ~18% low with no rating benefit). StormGlass tides use the same
   coordinate — tides are far less grid-sensitive.
2. **Weather model** — check Open-Meteo's `best_match` wind direction at the
   coast against GFS/ECMWF/ICON and a reference forecast. If `best_match`
   diverges (Pacitan: NE 35° vs E 87-130° consensus), pin a model via
   `weatherModel` (e.g. `"gfs_seamless"`).
3. **Timezone** — IANA name (e.g. `"Europe/Lisbon"`). DST is handled
   automatically (`src/shared/time.ts`); cron times are local wall-clock.
4. **Spots** — per spot: coordinates (map markers), `facingDirection`
   (direction the beach faces toward the sea), `fallingTideCap` (true for
   sandbar breaks needing rising water, false for point/reef), and
   `thresholds` (tide window in % of daily range, swell direction
   ideal±windows, height/period minimums, wind limits per category). Order
   the array in natural display order (e.g. west-to-east) — it's also the
   candidate-ranking tiebreak order.
5. **Knowledge base** — write `regions/<id>/knowledge-base.ts`: who-you-are
   intro, spot geography (with the exact spot `id` keys), local wind pattern
   (sea/land breeze times), tide-range interpretation for the local tidal
   regime, any seasonal swell context. Mirror `regions/pacitan/knowledge-base.ts`
   in structure. NEVER import this from client code.
6. **Verify** — set `verifyWisukiUrl` (find the spot on wisuki.com) and run
   `REGION=<id> bun run scripts/verify-vs-wisuki.ts`. Target: 100%
   surfable-rating-bin agreement. Iterate thresholds until ratings match
   local reality. Note: StormGlass `sg`-blend aggregates dampen long-period
   swell in some regions — use Wisuki or NOAA WW3 as ground truth, not SG.
7. **Validation runs at boot** — `validateRegionConfig` rejects malformed
   packs at server start / client build with a list of errors.

## Deploying a region

Each region deployment needs:
- **StormGlass key**: ideally its own free-tier key (10 req/day; tides cost
  3/day + 3 per restart).
- **Env** (systemd unit / `.env`): `REGION=<id>`, `STATIC_ROOT=/var/www/surf-<id>`,
  plus the usual secrets (`STORMGLASS_API_KEY`, `DEEPSEEK_API_KEY`, ...).
- **Build**: `REGION=<id> BUILD_OUT_DIR=/var/www/surf-<id> bun run build`.
- **Redis**: keys are auto-namespaced `surf:<id>:*` — multiple regions can
  share one Redis. Switching regions on one server leaves the old region's
  keys to expire via TTL (4 days forecast / 36 h recommendation).
- **nginx**: new vhost + domain per deployment (see server CLAUDE.md "Neue
  Subdomain anlegen"); the app never references its own domain.
- **Service worker**: bump `CACHE_NAME` in `public/sw.js` (deploy convention).
```

- [ ] **Step 2: Commit**

```bash
git add regions/README.md
git commit -m "docs(regions): onboarding checklist for new region packs"
```

---

### Task 13: CLAUDE.md updates

**Files:**
- Modify: `/root/surf-pacitan/CLAUDE.md`

- [ ] **Step 1: Update stale references**

Apply these edits (surgical, keep everything else):

1. **Commands section** — after the `bun run build` line, add: `REGION=<id>` selects the region pack for server/build (default `pacitan`); `BUILD_OUT_DIR` / `STATIC_ROOT` override the static paths.
2. **Architecture intro** — replace "Mobile-first tide forecast app for Pacitan surf spots." with "Mobile-first tide forecast app for surf spots of the active region (region packs in `regions/<id>/`; Pacitan is the default region). One region per deployment, selected via `REGION` env (server) and at build time (client, Vite `define`)."
3. **Shared logic paragraph** — note that spot thresholds/display now LIVE in the region pack (`regions/pacitan/index.ts`); `src/shared/spot-config.ts` / `src/shared/spots.ts` are derived views over `ACTIVE_REGION`; `SpotName` is `string`, validity enforced by region validation + `validateRecommendation`.
4. **Cron paragraph** — replace "20:00 WIB ... 13:00 UTC" phrasing: cron times are local wall-clock in the region's IANA timezone, converted per-firing by `nextLocalFireMs` (`src/shared/time.ts`, DST-correct). `src/server/schedule.ts` is gone; the Redis-free pure-logic home for scheduling is `src/shared/time.ts` (tests: `tests/time.test.ts`).
5. **Key Conventions** — add: "Region-specific data (coords, thresholds, branding, KB, timezone) belongs in `regions/<id>/` — never hardcode region facts in `src/`. Client code imports region data ONLY via `src/shared/active-region.ts` (or the derived `SPOT_DISPLAY`/`SPOT_THRESHOLDS` views); `regions/<id>/knowledge-base.ts` is server-only (prompt must not enter the client bundle)."
6. **Redis keys** — anywhere `surf:recommendation:YYYY-MM-DD` or `surf:forecast` is mentioned, update to `surf:<region>:recommendation:YYYY-MM-DD` / `surf:<region>:forecast:` (e.g. the "Daily AI recommendation" section).
7. **Deployment section** — add `REGION`/`STATIC_ROOT`/`BUILD_OUT_DIR` to the env list and a pointer to `regions/README.md` for adding regions.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): region-packs architecture, tz-aware cron, region-scoped Redis keys"
```

---

### Task 14: Final verification + deploy

**Files:** none new — verification, deploy, and live checks.

- [ ] **Step 1: Full gates**

```bash
bun test                                                          # all green
bun build src/server/index.ts --target bun --outdir /tmp/x && rm -rf /tmp/x   # server bundles
bun run scripts/verify-vs-wisuki.ts                               # 100% rating-bin agreement
```

- [ ] **Step 2: Pre-restart snapshot + quota check**

```bash
curl -s http://127.0.0.1:3100/api/forecast > /tmp/forecast-before.json
curl -s http://127.0.0.1:3100/api/status | python3 -m json.tool   # check stormglassQuota ≥ 4
```

If `stormglassQuota` < 4, wait for the UTC-midnight quota reset (07:00 WIB) before restarting — the restart's startup fetch needs 3 requests.

- [ ] **Step 3: Build + deploy**

```bash
# Bump CACHE_NAME in public/sw.js first (deploy convention), commit it.
bun run build                       # REGION defaults to pacitan, outDir /var/www/surf-pacitan
systemctl restart surf-pacitan.service
```

No systemd unit changes needed for Pacitan: `REGION`, `STATIC_ROOT`, `BUILD_OUT_DIR` all default to the current values.

- [ ] **Step 4: Post-restart verification**

```bash
journalctl -u surf-pacitan.service -n 20 --no-pager   # expect "[server] surf (region: pacitan) listening", no region-validation errors
sleep 20 && curl -s http://127.0.0.1:3100/api/forecast > /tmp/forecast-after.json
python3 - <<'EOF'
import json
b = json.load(open("/tmp/forecast-before.json"))
a = json.load(open("/tmp/forecast-after.json"))
days_b = {d["date"]: d for d in b["days"]}
days_a = {d["date"]: d for d in a["days"]}
for date in sorted(set(days_b) & set(days_a)):
    hb = {h["hour"]: h["surfable"] for h in days_b[date]["hourly"]}
    ha = {h["hour"]: h["surfable"] for h in days_a[date]["hourly"]}
    diff = [h for h in hb if h in ha and hb[h] != ha[h]]
    print(date, "ratings differ at hours:", diff or "none")
    assert set(next(iter(ha.values())).keys()) == {"telengRia", "pancer", "pancerDoor"}
print("spot keys OK")
EOF
```

Expected: spot keys unchanged; rating diffs "none" or only drift explainable by the fresh weather fetch (the restart re-fetches — identical inputs ⇒ identical ratings is guaranteed by the test suite, not this smoke check).

The recommendation moved to a new Redis key prefix — restore today's/tomorrow's rec instead of regenerating (free):

```bash
# Redis ≥ 6.2; password comes from .env if set
redis-cli COPY "surf:recommendation:$(date +%F)" "surf:pacitan:recommendation:$(date +%F)"
redis-cli COPY "surf:recommendation:$(date -d tomorrow +%F)" "surf:pacitan:recommendation:$(date -d tomorrow +%F)"
curl -s http://127.0.0.1:3100/api/recommendation | python3 -m json.tool   # rec present
```

(If `COPY` returns 0 because no rec exists for those dates, regenerate with the `bun -e` one-liner from CLAUDE.md.)

Public smoke test: `curl -sI https://surf-pacitan.yolo-goldgrube.pp.ua/ | head -1` → `200`; open the site, verify chart strips (3 strips, P/PD/TR), map markers, spot sheets, title "Surf Pacitan".

- [ ] **Step 5: Sanity-check a second region resolves (no deploy)**

```bash
REGION=atlantis bun test tests/region.test.ts 2>&1 | head -5
```

Expected: immediate failure with `Unknown REGION "atlantis" — available: pacitan` (proves env-based selection is live). 

- [ ] **Step 6: Final commit (if any fixups) and wrap up**

```bash
git status   # clean or commit fixups with descriptive messages
```

Done when: all gates green, site verified live, rec present, CLAUDE.md current.
