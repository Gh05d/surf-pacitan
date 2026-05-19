# DeepSeek Daily Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI-generated daily surf recommendation card to the app, driven by a 20:00 WIB cron that calls DeepSeek V4 Flash with a Pacitan-specific knowledge base. Gated by env vars so it can be disabled when not in Pacitan.

**Architecture:** Server-side: new `deepseek.ts` HTTP client + `knowledge-base.ts` constant + `recommendation.ts` orchestrator (with dependency-injected cache & client for testability). Wired into existing `cron.ts` and `routes.ts`. Client-side: new `useRecommendation` hook + `RecommendationCard` component at top of `App.tsx`. Feature gated by `RECOMMENDATION_ENABLED` env var.

**Tech Stack:** Bun, TypeScript, Hono, ioredis, React 19, Vite, `bun:test`. DeepSeek API via plain `fetch` (no SDK).

**Spec:** `docs/superpowers/specs/2026-05-19-deepseek-recommendation-design.md`

---

## File Structure

**Server-side new files:**
- `src/server/deepseek.ts` — HTTP client for DeepSeek API (single function `callDeepSeek`)
- `src/server/knowledge-base.ts` — exported `PACITAN_SURF_KNOWLEDGE` constant
- `src/server/recommendation.ts` — orchestrator: `buildUserPayload`, `validateRecommendation`, `generateTomorrowRecommendation`

**Server-side modified files:**
- `src/shared/types.ts` — add `Recommendation`, `RecommendationResponse` types
- `src/server/config.ts` — add `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_THINKING`, `RECOMMENDATION_ENABLED`, redis key prefix, TTL
- `src/server/cache.ts` — add `getRecommendation`, `setRecommendation`
- `src/server/cron.ts` — add `nextFireMs`, `scheduleDailyAt`, register recommendation cron conditionally
- `src/server/routes.ts` — add `GET /api/recommendation` endpoint

**Server-side new tests:**
- `tests/recommendation.test.ts` — `buildUserPayload`, `validateRecommendation`, `generateTomorrowRecommendation` (with DI mocks)
- `tests/deepseek.test.ts` — HTTP client with `globalThis.fetch` stub
- `tests/cron.test.ts` — `nextFireMs` pure function
- `tests/routes.test.ts` — `/api/recommendation` endpoint via Hono's `app.request()`

**Client-side new files:**
- `src/client/hooks/useRecommendation.ts`
- `src/client/components/RecommendationCard.tsx`
- `src/client/components/RecommendationCard.css`

**Client-side modified files:**
- `src/client/App.tsx` — render `<RecommendationCard />` above `<DayView />`

**Documentation:**
- `CLAUDE.md` — append env vars section + recommendation architecture note

---

## Task 1: Add Recommendation types to shared/types.ts

**Files:**
- Modify: `src/shared/types.ts` (append to bottom)

- [ ] **Step 1: Append types**

Open `src/shared/types.ts` and append at the bottom (after `StatusResponse`):

```typescript
export interface RecommendationWindow {
  start: string; // "HH:MM" local time (Asia/Jakarta)
  end: string;   // "HH:MM"
}

export interface Recommendation {
  forDate: string;                  // YYYY-MM-DD — the day the recommendation is FOR
  generatedAt: string;              // ISO timestamp of generation
  bestSpot: SpotName;
  bestWindow: RecommendationWindow;
  headline: string;                 // 1 sentence summary, German
  reasoning: string;                // 2-3 sentences, German, <= 600 chars
  warnings: string[];               // empty array or short warning strings
  modelUsed: string;                // e.g. "deepseek-v4-flash"
}

export interface RecommendationResponse {
  enabled: boolean;
  recommendation: Recommendation | null;
}
```

- [ ] **Step 2: Verify build still compiles**

Run: `cd /root/surf-pacitan && bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add Recommendation and RecommendationResponse types"
```

---

## Task 2: Add config constants

**Files:**
- Modify: `src/server/config.ts` (append to bottom)

- [ ] **Step 1: Append config block**

Append at the bottom of `src/server/config.ts`:

```typescript
// DeepSeek / AI recommendation
export const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? "";
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
export const DEEPSEEK_THINKING = process.env.DEEPSEEK_THINKING !== "false";
export const DEEPSEEK_TIMEOUT_MS = 15_000;

// Enabled default: true when API key is set, unless explicitly RECOMMENDATION_ENABLED=false
export const RECOMMENDATION_ENABLED =
  process.env.RECOMMENDATION_ENABLED === "true" ||
  (process.env.RECOMMENDATION_ENABLED !== "false" && DEEPSEEK_API_KEY !== "");

// Recommendation cron fires at 20:00 Asia/Jakarta (WIB = UTC+7) → 13:00 UTC
export const RECOMMENDATION_CRON_UTC_HOUR = 13;
export const RECOMMENDATION_CRON_UTC_MINUTE = 0;

// Recommendation Redis storage
export const REDIS_RECOMMENDATION_KEY_PREFIX = "surf:recommendation:";
export const RECOMMENDATION_TTL_SECONDS = 36 * 60 * 60; // 36h
```

- [ ] **Step 2: Verify build**

Run: `cd /root/surf-pacitan && bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/config.ts
git commit -m "feat(config): add DeepSeek and recommendation env vars and constants"
```

---

## Task 3: Add cache extensions

**Files:**
- Modify: `src/server/cache.ts` (append to bottom)

- [ ] **Step 1: Add imports and functions**

In `src/server/cache.ts`, update the existing `config` import line to include the new constants:

```typescript
import { REDIS_KEY_PREFIX, REDIS_META_KEY, REDIS_QUOTA_KEY, CACHE_TTL_SECONDS, REDIS_RECOMMENDATION_KEY_PREFIX, RECOMMENDATION_TTL_SECONDS } from "./config";
```

Also update the top type import to include `Recommendation`:

```typescript
import type { ForecastDay, Recommendation } from "../shared/types";
```

Append at the bottom (before the trailing `export { redis };`):

```typescript
export async function getRecommendation(date: string): Promise<Recommendation | null> {
  const raw = await redis.get(`${REDIS_RECOMMENDATION_KEY_PREFIX}${date}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function setRecommendation(rec: Recommendation): Promise<void> {
  const key = `${REDIS_RECOMMENDATION_KEY_PREFIX}${rec.forDate}`;
  await redis.set(key, JSON.stringify(rec), "EX", RECOMMENDATION_TTL_SECONDS);
}
```

- [ ] **Step 2: Verify build**

Run: `cd /root/surf-pacitan && bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/cache.ts
git commit -m "feat(cache): add getRecommendation and setRecommendation"
```

---

## Task 4: Implement and test `buildUserPayload`

**Files:**
- Create: `src/server/recommendation.ts`
- Create: `tests/recommendation.test.ts`

- [ ] **Step 1: Write failing test for tideRange computation**

Create `tests/recommendation.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { buildUserPayload } from "../src/server/recommendation";
import type { ForecastDay } from "../src/shared/types";

function sampleForecast(overrides: Partial<ForecastDay> = {}): ForecastDay {
  return {
    date: "2026-05-20",
    location: { name: "Pacitan", lat: -8.22, lng: 111.13 },
    astronomy: { sunrise: "05:30", sunset: "17:30" },
    tideExtremes: [
      { time: "03:12", height: 0.4, type: "low" },
      { time: "09:45", height: 1.9, type: "high" },
      { time: "15:30", height: 0.2, type: "low" },
      { time: "21:15", height: 2.0, type: "high" },
    ],
    hourly: [
      {
        hour: 6,
        tide: { height: 1.0, rising: true },
        swell: { height: 1.5, period: 11, direction: 200 },
        wind: { speed: 8, direction: 30, gusts: 12 },
        weather: { temp: 27, condition: "clear", precipitation: 0 },
        surfable: { telengRia: "yellow", pancer: "green", pancerDoor: "green" },
      },
    ],
    ...overrides,
  };
}

describe("buildUserPayload", () => {
  test("tideRange is computed as max minus min of tideExtremes", () => {
    const payload = buildUserPayload(sampleForecast());
    expect(payload.tideRange).toBeCloseTo(1.8, 5); // 2.0 - 0.2
  });

  test("tideRange handles empty extremes gracefully", () => {
    const payload = buildUserPayload(sampleForecast({ tideExtremes: [] }));
    expect(payload.tideRange).toBe(0);
  });

  test("payload omits weather.temp from hourly entries", () => {
    const payload = buildUserPayload(sampleForecast());
    const h = payload.hourly[0];
    expect(h.weather).toEqual({ condition: "clear", precipitation: 0 });
    expect((h.weather as any).temp).toBeUndefined();
  });

  test("payload preserves surfable baseline ratings per hour", () => {
    const payload = buildUserPayload(sampleForecast());
    expect(payload.hourly[0].surfable).toEqual({
      telengRia: "yellow",
      pancer: "green",
      pancerDoor: "green",
    });
  });

  test("payload includes forDate, astronomy, tideExtremes verbatim", () => {
    const fc = sampleForecast();
    const payload = buildUserPayload(fc);
    expect(payload.forDate).toBe("2026-05-20");
    expect(payload.astronomy).toEqual(fc.astronomy);
    expect(payload.tideExtremes).toEqual(fc.tideExtremes);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /root/surf-pacitan && bun test tests/recommendation.test.ts`
Expected: FAIL — module `../src/server/recommendation` not found.

- [ ] **Step 3: Implement `buildUserPayload` minimally to pass**

Create `src/server/recommendation.ts`:

```typescript
import type { ForecastDay, SpotRatings, TideExtreme } from "../shared/types";

export interface PayloadHourly {
  hour: number;
  tide: { height: number; rising: boolean };
  swell: { height: number; period: number; direction: number };
  wind: { speed: number; direction: number; gusts: number };
  weather: { condition: string; precipitation: number };
  surfable: SpotRatings;
}

export interface UserPayload {
  forDate: string;
  tideRange: number;
  astronomy: { sunrise: string; sunset: string };
  tideExtremes: TideExtreme[];
  hourly: PayloadHourly[];
}

export function buildUserPayload(forecast: ForecastDay): UserPayload {
  const heights = forecast.tideExtremes.map((t) => t.height);
  const tideRange = heights.length ? Math.max(...heights) - Math.min(...heights) : 0;

  return {
    forDate: forecast.date,
    tideRange,
    astronomy: forecast.astronomy,
    tideExtremes: forecast.tideExtremes,
    hourly: forecast.hourly.map((h) => ({
      hour: h.hour,
      tide: h.tide,
      swell: h.swell,
      wind: h.wind,
      weather: { condition: h.weather.condition, precipitation: h.weather.precipitation },
      surfable: h.surfable,
    })),
  };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `cd /root/surf-pacitan && bun test tests/recommendation.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/server/recommendation.ts tests/recommendation.test.ts
git commit -m "feat(recommendation): implement buildUserPayload with tideRange context"
```

---

## Task 5: Implement and test `validateRecommendation`

**Files:**
- Modify: `src/server/recommendation.ts`
- Modify: `tests/recommendation.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/recommendation.test.ts`:

```typescript
import { validateRecommendation } from "../src/server/recommendation";

function validRecRaw() {
  return {
    bestSpot: "pancerDoor",
    bestWindow: { start: "06:00", end: "09:00" },
    headline: "Pancer Door am besten morgens 06:00–09:00.",
    reasoning: "SW-Swell 1.8m@12s trifft auf steigende Tide. Wind dreht um 10:00 onshore — früh los.",
    warnings: ["Tide-Range nur 1.3m (Nipptide)"],
  };
}

describe("validateRecommendation", () => {
  test("accepts a valid recommendation", () => {
    const result = validateRecommendation(validRecRaw());
    expect(result.ok).toBe(true);
  });

  test("rejects invalid spot name", () => {
    const result = validateRecommendation({ ...validRecRaw(), bestSpot: "unknownBeach" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/bestSpot/);
  });

  test("rejects window with end before start", () => {
    const result = validateRecommendation({ ...validRecRaw(), bestWindow: { start: "09:00", end: "06:00" } });
    expect(result.ok).toBe(false);
  });

  test("rejects window with non-HH:MM string", () => {
    const result = validateRecommendation({ ...validRecRaw(), bestWindow: { start: "morning", end: "09:00" } });
    expect(result.ok).toBe(false);
  });

  test("rejects window with hour > 23", () => {
    const result = validateRecommendation({ ...validRecRaw(), bestWindow: { start: "06:00", end: "25:00" } });
    expect(result.ok).toBe(false);
  });

  test("rejects empty reasoning", () => {
    const result = validateRecommendation({ ...validRecRaw(), reasoning: "" });
    expect(result.ok).toBe(false);
  });

  test("rejects reasoning longer than 600 chars", () => {
    const long = "x".repeat(601);
    const result = validateRecommendation({ ...validRecRaw(), reasoning: long });
    expect(result.ok).toBe(false);
  });

  test("rejects warning string longer than 200 chars", () => {
    const long = "y".repeat(201);
    const result = validateRecommendation({ ...validRecRaw(), warnings: [long] });
    expect(result.ok).toBe(false);
  });

  test("accepts empty warnings array", () => {
    const result = validateRecommendation({ ...validRecRaw(), warnings: [] });
    expect(result.ok).toBe(true);
  });

  test("rejects missing required field", () => {
    const r: any = validRecRaw();
    delete r.headline;
    const result = validateRecommendation(r);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd /root/surf-pacitan && bun test tests/recommendation.test.ts`
Expected: import error / 10 new failures.

- [ ] **Step 3: Implement validator**

Append to `src/server/recommendation.ts`:

```typescript
import type { SpotName } from "../shared/types";

const VALID_SPOTS: SpotName[] = ["telengRia", "pancer", "pancerDoor"];
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ValidatedRecommendationFields {
  bestSpot: SpotName;
  bestWindow: { start: string; end: string };
  headline: string;
  reasoning: string;
  warnings: string[];
}

export type ValidationResult =
  | { ok: true; value: ValidatedRecommendationFields }
  | { ok: false; error: string };

function parseHHMM(s: string): number | null {
  const m = HHMM_RE.exec(s);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function validateRecommendation(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "raw is not an object" };
  const r = raw as Record<string, unknown>;

  if (typeof r.bestSpot !== "string" || !VALID_SPOTS.includes(r.bestSpot as SpotName)) {
    return { ok: false, error: `invalid bestSpot: ${String(r.bestSpot)}` };
  }
  const bestSpot = r.bestSpot as SpotName;

  if (!r.bestWindow || typeof r.bestWindow !== "object") {
    return { ok: false, error: "missing bestWindow" };
  }
  const w = r.bestWindow as Record<string, unknown>;
  if (typeof w.start !== "string" || typeof w.end !== "string") {
    return { ok: false, error: "bestWindow.start/end must be strings" };
  }
  const startMin = parseHHMM(w.start);
  const endMin = parseHHMM(w.end);
  if (startMin === null || endMin === null) {
    return { ok: false, error: "bestWindow times must be HH:MM" };
  }
  if (endMin <= startMin) {
    return { ok: false, error: "bestWindow.end must be after start" };
  }

  if (typeof r.headline !== "string" || r.headline.length === 0 || r.headline.length > 200) {
    return { ok: false, error: "headline must be non-empty <= 200 chars" };
  }
  if (typeof r.reasoning !== "string" || r.reasoning.length === 0 || r.reasoning.length > 600) {
    return { ok: false, error: "reasoning must be non-empty <= 600 chars" };
  }

  if (!Array.isArray(r.warnings)) {
    return { ok: false, error: "warnings must be an array" };
  }
  for (const wn of r.warnings) {
    if (typeof wn !== "string") return { ok: false, error: "warnings must be strings" };
    if (wn.length > 200) return { ok: false, error: "warning string too long (>200)" };
  }

  return {
    ok: true,
    value: {
      bestSpot,
      bestWindow: { start: w.start, end: w.end },
      headline: r.headline,
      reasoning: r.reasoning,
      warnings: r.warnings as string[],
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd /root/surf-pacitan && bun test tests/recommendation.test.ts`
Expected: 15 passing (5 from Task 4 + 10 new).

- [ ] **Step 5: Commit**

```bash
git add src/server/recommendation.ts tests/recommendation.test.ts
git commit -m "feat(recommendation): add validateRecommendation with shape and bounds checks"
```

---

## Task 6: Add Pacitan knowledge base

**Files:**
- Create: `src/server/knowledge-base.ts`

- [ ] **Step 1: Create the file**

Create `src/server/knowledge-base.ts`:

```typescript
export const PACITAN_SURF_KNOWLEDGE = `
Du bist ein lokaler Pacitan-Surf-Experte. Du erhältst Forecast-Daten für genau einen Tag und musst die beste Empfehlung für diesen Tag geben.

# Spot-Geographie (West nach Ost entlang der Bucht)

Wichtig: dies ist die LOKALE Konvention. Öffentliche Surf-Guides labeln teils anders — ignoriere diese.

1. **Pancer** (key: "pancer") — westlichster Spot, an der Flussmündung. Sandbar wird vom Fluss geformt und ändert sich saisonal.
   - Faces ca. 195° (SSW)
   - Westliche Klippe schirmt SW-Swell teilweise ab → bevorzugt eher direkt-südliche Swells (ideal ca. 195°)
   - Drowned bei Hochwasser → arbeitet am besten bei niedrig-mittlerer steigender Tide
2. **Pancer Door** (key: "pancerDoor") — mittlerer Spot, langer offener Strand
   - Faces ca. 195°
   - Toleriert höhere Tide besser als Pancer
   - Bevorzugt SW-Swell (ideal ca. 210°)
3. **Teleng Ria** (key: "telengRia") — östlichster Spot
   - Faces ca. 195°
   - Offen für SW-Swell (ideal ca. 215°)
   - Verträgt Peak-Hochwasser am besten

# Sandbar-Dynamik

Sandbar-Spots brauchen STEIGENDES Wasser für Form. Fallende Tide → Wasser zieht zurück, Wellen werden mushy/closed-out, selbst bei perfektem Swell und Wind. Eine "grüne" Bewertung bei fallender Tide ist immer mit Vorsicht zu genießen.

# Wind-Interpretation

- Offshore (Wind aus N/NE, weg vom Meer): bläst Wellen hohl, hält sie clean. Bestes Szenario.
- Cross-Shore (Wind aus E oder W): akzeptabel bis ~25 km/h
- Onshore (Wind aus S, zur Küste): bläst Wellen flach/chaotisch. Schlecht ab ~15 km/h.

Lokales Muster: Morgens oft Offshore (Land-zu-Meer-Brise), kippt typischerweise zwischen 10:00–13:00 auf Onshore (Sea-Breeze). Frühe Sessions sind fast immer sauberer.

# Tide-Range-Kontext

Das Feld \`tideRange\` ist der Tagesgang (Max−Min in Metern):
- >2.5m → Springflut: breites usable Window, aber starke Strömung. Strömt ggf. seitwärts ab.
- 1.5–2.5m → normaler Bereich, alles unauffällig
- <1.5m → Nipptide: enges Window, weniger Push, schwächere Wellen — schwierig wenn der Swell schon klein ist.

# Daten-Format Input

Du erhältst ein JSON-Objekt:
\`\`\`
{
  "forDate": "YYYY-MM-DD",
  "tideRange": number,            // Meter
  "astronomy": { "sunrise": "HH:MM", "sunset": "HH:MM" },
  "tideExtremes": [{ "time": "HH:MM", "height": m, "type": "high"|"low" }],
  "hourly": [{ "hour": 0-23, "tide": {height, rising}, "swell": {height, period, direction},
               "wind": {speed, direction, gusts}, "weather": {condition, precipitation},
               "surfable": { "telengRia": "green"|"yellow"|"red", "pancer": ..., "pancerDoor": ... } }]
}
\`\`\`

Die \`surfable\`-Ratings sind regelbasiert vorberechnet. Du DARFST sie überstimmen, wenn du gute Gründe siehst — erklär dann warum. Sie sind eine Sanity-Baseline, nicht die Wahrheit.

# Aufgabe

Empfiehl genau **einen** besten Spot und **ein** bestes Zeitfenster für \`forDate\`. Begründe in 2–3 Sätzen auf Deutsch. Liste max. 3 kurze Warnungen falls relevant (z.B. Wind kippt früh, starke Strömung, Regen). Sonst leere Liste.

# Anti-Hallucination

- Beziehe dich nur auf Werte aus dem übergebenen Forecast-Objekt
- Erfinde keine Zahlen, Trends, Swell-Pulse oder Wetterereignisse, die nicht in den Daten stehen
- Wenn Bedingungen marginal oder mehrdeutig sind, sag das explizit
- \`bestWindow\` start UND end MÜSSEN innerhalb 00:00–23:59 von \`forDate\` liegen
- Surfe nie nach Sonnenuntergang oder vor Sonnenaufgang — halte dich an \`astronomy\`

# Output

Antworte mit GENAU diesem JSON-Schema (keine zusätzlichen Felder, kein Markdown, kein Prosa-Text außerhalb):

\`\`\`
{
  "bestSpot": "telengRia" | "pancer" | "pancerDoor",
  "bestWindow": { "start": "HH:MM", "end": "HH:MM" },
  "headline": "ein kurzer Satz auf Deutsch, max. 200 Zeichen",
  "reasoning": "2–3 Sätze auf Deutsch warum genau dieser Spot in diesem Window, max. 600 Zeichen",
  "warnings": ["ggf. kurze Warnungen, max. 200 Zeichen pro Eintrag, max. 3 Einträge"]
}
\`\`\`
`.trim();
```

- [ ] **Step 2: Verify build**

Run: `cd /root/surf-pacitan && bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/knowledge-base.ts
git commit -m "feat(recommendation): add Pacitan surf knowledge base prompt"
```

---

## Task 7: Implement and test DeepSeek HTTP client

**Files:**
- Create: `src/server/deepseek.ts`
- Create: `tests/deepseek.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/deepseek.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { callDeepSeek, DeepSeekError } from "../src/server/deepseek";

interface FetchCallSnapshot {
  url: string;
  init: RequestInit;
}

const calls: FetchCallSnapshot[] = [];
let mockResponse: { status: number; body: any } = { status: 200, body: {} };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls.length = 0;
  mockResponse = { status: 200, body: {} };
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(mockResponse.body), { status: mockResponse.status });
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function okResponseWith(content: object) {
  return {
    id: "chatcmpl-x",
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

describe("callDeepSeek", () => {
  test("POSTs to the configured URL with bearer token", async () => {
    mockResponse = { status: 200, body: okResponseWith({ ok: true }) };
    await callDeepSeek({
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      systemPrompt: "you are helpful",
      userPayload: { hello: "world" },
      thinking: true,
      timeoutMs: 5000,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  test("sends the right body shape", async () => {
    mockResponse = { status: 200, body: okResponseWith({ ok: true }) };
    await callDeepSeek({
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      systemPrompt: "sys",
      userPayload: { hello: "world" },
      thinking: true,
      timeoutMs: 5000,
    });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(JSON.parse(body.messages[1].content)).toEqual({ hello: "world" });
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  test("returns the parsed JSON content from message", async () => {
    mockResponse = { status: 200, body: okResponseWith({ pick: "pancer" }) };
    const result = await callDeepSeek({
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      systemPrompt: "sys",
      userPayload: {},
      thinking: true,
      timeoutMs: 5000,
    });
    expect(result.content).toEqual({ pick: "pancer" });
    expect(result.usage.total_tokens).toBe(150);
  });

  test("throws DeepSeekError on non-2xx response", async () => {
    mockResponse = { status: 429, body: { error: "rate limited" } };
    try {
      await callDeepSeek({
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        systemPrompt: "sys",
        userPayload: {},
        thinking: true,
        timeoutMs: 5000,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DeepSeekError);
      expect((err as DeepSeekError).status).toBe(429);
    }
  });

  test("throws DeepSeekError if message content is not parseable JSON", async () => {
    mockResponse = {
      status: 200,
      body: { choices: [{ message: { content: "not json!" } }], usage: { total_tokens: 0 } },
    };
    try {
      await callDeepSeek({
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        systemPrompt: "sys",
        userPayload: {},
        thinking: true,
        timeoutMs: 5000,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DeepSeekError);
      expect((err as DeepSeekError).reason).toBe("parse");
    }
  });

  test("throws DeepSeekError if choices array is missing", async () => {
    mockResponse = { status: 200, body: { id: "x" } };
    try {
      await callDeepSeek({
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        systemPrompt: "sys",
        userPayload: {},
        thinking: true,
        timeoutMs: 5000,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DeepSeekError);
    }
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd /root/surf-pacitan && bun test tests/deepseek.test.ts`
Expected: Module not found.

- [ ] **Step 3: Implement client**

Create `src/server/deepseek.ts`:

```typescript
import { DEEPSEEK_API_URL } from "./config";

export interface DeepSeekUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface DeepSeekResult {
  content: unknown;          // parsed JSON from message.content
  usage: DeepSeekUsage;
}

export interface DeepSeekOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPayload: unknown;
  thinking: boolean;
  timeoutMs: number;
}

export class DeepSeekError extends Error {
  constructor(
    message: string,
    public readonly reason: "http" | "parse" | "shape" | "timeout",
    public readonly status?: number,
    public readonly bodyExcerpt?: string,
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

/**
 * NOTE: DeepSeek V4 thinking-mode parameter name is "thinking" at time of writing.
 * V3 used "enable_thinking". If V4 rejects the request shape, check the live API
 * response body for hints (it usually echoes the offending field) and adjust here.
 */
export async function callDeepSeek(opts: DeepSeekOptions): Promise<DeepSeekResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: JSON.stringify(opts.userPayload) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
    max_tokens: 4000,
  };
  if (opts.thinking) {
    body.thinking = { type: "enabled" };
  }

  let response: Response;
  try {
    response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      throw new DeepSeekError("DeepSeek request timed out", "timeout");
    }
    throw new DeepSeekError(`DeepSeek fetch failed: ${(err as Error).message}`, "http");
  }
  clearTimeout(timeout);

  const text = await response.text();

  if (!response.ok) {
    throw new DeepSeekError(
      `DeepSeek HTTP ${response.status}`,
      "http",
      response.status,
      text.slice(0, 500),
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DeepSeekError("DeepSeek response not JSON", "parse", response.status, text.slice(0, 500));
  }

  const message = parsed?.choices?.[0]?.message?.content;
  if (typeof message !== "string") {
    throw new DeepSeekError("DeepSeek response missing choices[0].message.content", "shape", response.status, text.slice(0, 500));
  }

  let content: unknown;
  try {
    content = JSON.parse(message);
  } catch {
    throw new DeepSeekError("DeepSeek message.content not valid JSON", "parse", response.status, message.slice(0, 500));
  }

  const usage: DeepSeekUsage = parsed.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  return { content, usage };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd /root/surf-pacitan && bun test tests/deepseek.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/server/deepseek.ts tests/deepseek.test.ts
git commit -m "feat(deepseek): add HTTP client with JSON-mode and typed errors"
```

---

## Task 8: Implement and test `generateTomorrowRecommendation`

**Files:**
- Modify: `src/server/recommendation.ts`
- Modify: `tests/recommendation.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/recommendation.test.ts`:

```typescript
import { generateTomorrowRecommendation, type GenerateDeps } from "../src/server/recommendation";
import type { Recommendation } from "../src/shared/types";
import { mock } from "bun:test";

function frozenNow(): Date {
  // 2026-05-19 20:00 WIB = 13:00 UTC
  return new Date("2026-05-19T13:00:00Z");
}

function validModelResponse() {
  return {
    bestSpot: "pancerDoor",
    bestWindow: { start: "06:00", end: "09:00" },
    headline: "Pancer Door am besten morgens.",
    reasoning: "Steigende Tide trifft Offshore-Wind und sauberen SW-Swell.",
    warnings: [],
  };
}

function makeDeps(overrides: Partial<GenerateDeps> = {}): GenerateDeps {
  return {
    getCachedDay: mock(async () => sampleForecast({ date: "2026-05-20" })),
    setRecommendation: mock(async () => {}),
    callDeepSeek: mock(async () => ({
      content: validModelResponse(),
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    })),
    now: () => frozenNow(),
    apiKey: "sk-test",
    model: "deepseek-v4-flash",
    thinking: true,
    timeoutMs: 5000,
    ...overrides,
  };
}

describe("generateTomorrowRecommendation", () => {
  test("computes tomorrow as today (WIB) + 1 and looks up that forecast", async () => {
    const getCachedDay = mock(async () => sampleForecast({ date: "2026-05-20" }));
    await generateTomorrowRecommendation(makeDeps({ getCachedDay }));
    expect(getCachedDay).toHaveBeenCalledTimes(1);
    expect((getCachedDay as any).mock.calls[0][0]).toBe("2026-05-20");
  });

  test("skips when forecast for tomorrow is missing", async () => {
    const getCachedDay = mock(async () => null);
    const setRecommendation = mock(async () => {});
    const callDeepSeek = mock(async () => ({ content: {}, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
    await generateTomorrowRecommendation(makeDeps({ getCachedDay, setRecommendation, callDeepSeek }));
    expect(callDeepSeek).not.toHaveBeenCalled();
    expect(setRecommendation).not.toHaveBeenCalled();
  });

  test("on success writes a complete Recommendation to cache", async () => {
    const captured: Recommendation[] = [];
    const setRecommendation = mock(async (rec: Recommendation) => { captured.push(rec); });
    await generateTomorrowRecommendation(makeDeps({ setRecommendation }));
    expect(captured).toHaveLength(1);
    const rec = captured[0];
    expect(rec.forDate).toBe("2026-05-20");
    expect(rec.bestSpot).toBe("pancerDoor");
    expect(rec.bestWindow).toEqual({ start: "06:00", end: "09:00" });
    expect(rec.modelUsed).toBe("deepseek-v4-flash");
    expect(rec.generatedAt).toBe(frozenNow().toISOString());
  });

  test("does NOT overwrite cache when DeepSeek throws", async () => {
    const setRecommendation = mock(async () => {});
    const callDeepSeek = mock(async () => { throw new Error("boom"); });
    await generateTomorrowRecommendation(makeDeps({ setRecommendation, callDeepSeek }));
    expect(setRecommendation).not.toHaveBeenCalled();
  });

  test("retries once when validation fails on first response, succeeds second", async () => {
    let nthCall = 0;
    const callDeepSeek = mock(async () => {
      nthCall += 1;
      if (nthCall === 1) {
        return { content: { bestSpot: "notARealSpot" }, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
      }
      return { content: validModelResponse(), usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
    });
    const setRecommendation = mock(async () => {});
    await generateTomorrowRecommendation(makeDeps({ callDeepSeek, setRecommendation }));
    expect(callDeepSeek).toHaveBeenCalledTimes(2);
    expect(setRecommendation).toHaveBeenCalledTimes(1);
  });

  test("does NOT overwrite cache when both attempts fail validation", async () => {
    const callDeepSeek = mock(async () => ({
      content: { bestSpot: "notARealSpot" },
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }));
    const setRecommendation = mock(async () => {});
    await generateTomorrowRecommendation(makeDeps({ callDeepSeek, setRecommendation }));
    expect(callDeepSeek).toHaveBeenCalledTimes(2);
    expect(setRecommendation).not.toHaveBeenCalled();
  });

  test("skips when apiKey is empty (defensive)", async () => {
    const callDeepSeek = mock(async () => ({ content: {}, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
    const setRecommendation = mock(async () => {});
    await generateTomorrowRecommendation(makeDeps({ apiKey: "", callDeepSeek, setRecommendation }));
    expect(callDeepSeek).not.toHaveBeenCalled();
    expect(setRecommendation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd /root/surf-pacitan && bun test tests/recommendation.test.ts`
Expected: 7 new failures (imports / functions missing).

- [ ] **Step 3: Implement `generateTomorrowRecommendation`**

Add to `src/server/recommendation.ts`:

```typescript
import { getCachedDay as defaultGetCachedDay, setRecommendation as defaultSetRecommendation } from "./cache";
import { callDeepSeek as defaultCallDeepSeek, type DeepSeekResult } from "./deepseek";
import { PACITAN_SURF_KNOWLEDGE } from "./knowledge-base";
import {
  DEEPSEEK_API_KEY,
  DEEPSEEK_MODEL,
  DEEPSEEK_THINKING,
  DEEPSEEK_TIMEOUT_MS,
} from "./config";
import type { Recommendation } from "../shared/types";

export interface GenerateDeps {
  getCachedDay: typeof defaultGetCachedDay;
  setRecommendation: typeof defaultSetRecommendation;
  callDeepSeek: (opts: {
    apiKey: string;
    model: string;
    systemPrompt: string;
    userPayload: unknown;
    thinking: boolean;
    timeoutMs: number;
  }) => Promise<DeepSeekResult>;
  now: () => Date;
  apiKey: string;
  model: string;
  thinking: boolean;
  timeoutMs: number;
}

const DEFAULT_DEPS: GenerateDeps = {
  getCachedDay: defaultGetCachedDay,
  setRecommendation: defaultSetRecommendation,
  callDeepSeek: defaultCallDeepSeek,
  now: () => new Date(),
  apiKey: DEEPSEEK_API_KEY,
  model: DEEPSEEK_MODEL,
  thinking: DEEPSEEK_THINKING,
  timeoutMs: DEEPSEEK_TIMEOUT_MS,
};

function tomorrowDateWIB(now: Date): string {
  // WIB = UTC+7. "Tomorrow" = today-WIB + 1 day.
  const wibNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const tomorrow = new Date(wibNow.getTime() + 24 * 60 * 60 * 1000);
  const y = tomorrow.getUTCFullYear();
  const mo = String(tomorrow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

export async function generateTomorrowRecommendation(deps: GenerateDeps = DEFAULT_DEPS): Promise<void> {
  if (!deps.apiKey) {
    console.warn("[recommendation] DEEPSEEK_API_KEY missing; skipping");
    return;
  }

  const forDate = tomorrowDateWIB(deps.now());
  const forecast = await deps.getCachedDay(forDate);
  if (!forecast) {
    console.warn(`[recommendation] no cached forecast for ${forDate}; skipping`);
    return;
  }

  const userPayload = buildUserPayload(forecast);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let result: DeepSeekResult;
    try {
      result = await deps.callDeepSeek({
        apiKey: deps.apiKey,
        model: deps.model,
        systemPrompt: PACITAN_SURF_KNOWLEDGE,
        userPayload,
        thinking: deps.thinking,
        timeoutMs: deps.timeoutMs,
      });
    } catch (err) {
      console.error(`[recommendation] attempt ${attempt} DeepSeek call failed:`, err);
      return; // do not retry on HTTP/parse error; preserves existing cached rec
    }

    const validation = validateRecommendation(result.content);
    if (!validation.ok) {
      console.warn(`[recommendation] attempt ${attempt} validation failed: ${validation.error}`);
      if (attempt === 2) {
        console.error("[recommendation] giving up after 2 failed validations");
        return;
      }
      continue;
    }

    const rec: Recommendation = {
      forDate,
      generatedAt: deps.now().toISOString(),
      bestSpot: validation.value.bestSpot,
      bestWindow: validation.value.bestWindow,
      headline: validation.value.headline,
      reasoning: validation.value.reasoning,
      warnings: validation.value.warnings,
      modelUsed: deps.model,
    };

    await deps.setRecommendation(rec);
    console.log(
      `[recommendation] wrote rec for ${forDate} (tokens used: ${result.usage.total_tokens})`,
    );
    return;
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd /root/surf-pacitan && bun test tests/recommendation.test.ts`
Expected: 22 passing total.

- [ ] **Step 5: Commit**

```bash
git add src/server/recommendation.ts tests/recommendation.test.ts
git commit -m "feat(recommendation): implement generateTomorrowRecommendation with retry"
```

---

## Task 9: Implement and test `nextFireMs` helper

**Files:**
- Create: `src/server/schedule.ts`
- Create: `tests/schedule.test.ts`

(Note: putting `nextFireMs` in its own file so the test doesn't transitively pull in cache.ts/redis at module-load. The existing tests never import cache.ts; we follow that pattern.)

- [ ] **Step 1: Write failing test**

Create `tests/schedule.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { nextFireMs } from "../src/server/schedule";

describe("nextFireMs", () => {
  test("when now is before target time same day, returns ms until same day", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    // target 13:00 UTC = next 60 minutes
    expect(nextFireMs(now, 13, 0)).toBe(60 * 60 * 1000);
  });

  test("when now is exactly at target time, returns ms until next day's target", () => {
    const now = new Date("2026-05-19T13:00:00Z");
    expect(nextFireMs(now, 13, 0)).toBe(24 * 60 * 60 * 1000);
  });

  test("when now is past target time, returns ms until next day's target", () => {
    const now = new Date("2026-05-19T14:00:00Z");
    expect(nextFireMs(now, 13, 0)).toBe(23 * 60 * 60 * 1000);
  });

  test("handles month boundary correctly", () => {
    const now = new Date("2026-05-31T14:00:00Z");
    const ms = nextFireMs(now, 13, 0);
    expect(ms).toBe(23 * 60 * 60 * 1000); // → 2026-06-01T13:00:00Z
  });

  test("handles minute offset", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    expect(nextFireMs(now, 12, 30)).toBe(30 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd /root/surf-pacitan && bun test tests/schedule.test.ts`
Expected: Module not found.

- [ ] **Step 3: Create `schedule.ts`**

Create `src/server/schedule.ts`:

```typescript
/**
 * Returns milliseconds from `now` until the next occurrence of `utcHour:utcMinute` UTC.
 * If `now` is at or past today's target, returns ms until tomorrow's target.
 */
export function nextFireMs(now: Date, utcHour: number, utcMinute: number): number {
  const next = new Date(now);
  next.setUTCHours(utcHour, utcMinute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd /root/surf-pacitan && bun test tests/schedule.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/server/schedule.ts tests/schedule.test.ts
git commit -m "feat(schedule): add nextFireMs helper for daily wall-clock scheduling"
```

---

## Task 10: Register recommendation cron in `startScheduler`

**Files:**
- Modify: `src/server/cron.ts`

- [ ] **Step 1: Add imports and scheduler registration**

In `src/server/cron.ts`, update the `./config` import to include the new vars:

```typescript
import {
  LOCATION, FORECAST_DAYS, WEATHER_FETCH_INTERVAL_MS,
  RECOMMENDATION_ENABLED, DEEPSEEK_API_KEY,
  RECOMMENDATION_CRON_UTC_HOUR, RECOMMENDATION_CRON_UTC_MINUTE,
} from "./config";
```

Add two new import lines below the existing imports:

```typescript
import { generateTomorrowRecommendation } from "./recommendation";
import { nextFireMs } from "./schedule";
```

Append after `function scheduleMidnightTideFetch()` (i.e. at the end of the file):

```typescript
function scheduleDailyRecommendation(): void {
  const ms = nextFireMs(new Date(), RECOMMENDATION_CRON_UTC_HOUR, RECOMMENDATION_CRON_UTC_MINUTE);
  console.log(
    `[cron] next recommendation generation in ${Math.round(ms / 60000)} minutes`,
  );
  setTimeout(() => {
    generateTomorrowRecommendation().catch((err) =>
      console.error("[cron] generateTomorrowRecommendation error:", err),
    );
    scheduleDailyRecommendation();
  }, ms);
}
```

Modify `startScheduler` to register the cron conditionally. Find the existing `console.log` summary line at the end of `startScheduler` and replace the function body to look like:

```typescript
export function startScheduler(): void {
  console.log("[cron] startScheduler: initializing");

  // Initial fetch on startup — tides first, then weather (weather merges into tide cache)
  fetchAndCacheTides()
    .then(() => fetchAndCacheWeather())
    .catch((err) => console.error("[cron] initial fetch error:", err));

  // Weather every 3 hours
  setInterval(() => {
    fetchAndCacheWeather().catch((err) =>
      console.error("[cron] scheduled weather fetch error:", err)
    );
  }, WEATHER_FETCH_INTERVAL_MS);

  // Tides once daily at midnight local (UTC+7 = 17:00 UTC)
  scheduleMidnightTideFetch();

  // Daily recommendation generation (20:00 WIB = 13:00 UTC), only if enabled
  if (RECOMMENDATION_ENABLED && DEEPSEEK_API_KEY) {
    scheduleDailyRecommendation();
    console.log("[cron] recommendation cron registered (20:00 WIB)");
  } else {
    console.log("[cron] recommendation cron NOT registered (RECOMMENDATION_ENABLED=false or no API key)");
  }

  console.log(
    `[cron] startScheduler: weather every ${WEATHER_FETCH_INTERVAL_MS / 3600000}h, tides daily at midnight WIB`
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /root/surf-pacitan && bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run full test suite to ensure no regressions**

Run: `cd /root/surf-pacitan && bun test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/cron.ts
git commit -m "feat(cron): register daily recommendation cron at 20:00 WIB when enabled"
```

---

## Task 11: Add `/api/recommendation` endpoint

**Files:**
- Modify: `src/server/routes.ts`
- Create: `tests/routes.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/routes.test.ts`. Note: `bun test` shares one module cache across all test files (the test runner is a single process), so `process.env` set at file top is unreliable — config.ts may already have been imported with the wrong env. We use `mock.module()` on both `./cache` and `./config` to deterministically control routes.ts's view of the world.

```typescript
import { describe, test, expect, beforeEach, mock } from "bun:test";

let mockGetRecommendation = mock(async (_date: string) => null as any);

// Mock config to force RECOMMENDATION_ENABLED=true regardless of test env state
mock.module("../src/server/config", () => ({
  FORECAST_DAYS: 3,
  RECOMMENDATION_ENABLED: true,
}));

mock.module("../src/server/cache", () => ({
  getRecommendation: (date: string) => mockGetRecommendation(date),
  getCachedDays: mock(async () => []),
  getCachedDay: mock(async () => null),
  getLastFetch: mock(async () => null),
  getCachedDateList: mock(async () => []),
  getQuotaRemaining: mock(async () => null),
}));

// Dynamic import AFTER mocks are registered
const { api } = await import("../src/server/routes");

describe("GET /api/recommendation (enabled)", () => {
  beforeEach(() => {
    mockGetRecommendation = mock(async () => null);
  });

  test("returns enabled:true and recommendation:null when none cached", async () => {
    const res = await api.request("/recommendation");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.recommendation).toBeNull();
  });

  test("returns the cached recommendation when present", async () => {
    const rec = {
      forDate: "2026-05-20",
      generatedAt: "2026-05-19T13:00:00Z",
      bestSpot: "pancerDoor",
      bestWindow: { start: "06:00", end: "09:00" },
      headline: "Pancer Door am besten morgens.",
      reasoning: "SW-Swell mit steigender Tide und Offshore-Wind.",
      warnings: [],
      modelUsed: "deepseek-v4-flash",
    };
    mockGetRecommendation = mock(async () => rec);

    const res = await api.request("/recommendation");
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.recommendation).toEqual(rec);
  });
});
```

We don't test the `enabled: false` branch here — that path is trivial and would require a second test file with a different config mock. Confidence is sufficient via the enabled branch + a manual check (start server with `RECOMMENDATION_ENABLED=false` and `curl /api/recommendation`).

- [ ] **Step 2: Run, verify fail**

Run: `cd /root/surf-pacitan && bun test tests/routes.test.ts`
Expected: route not found / 404.

- [ ] **Step 3: Implement the endpoint**

In `src/server/routes.ts`, update imports (add `getRecommendation`):

```typescript
import {
  getCachedDays,
  getCachedDay,
  getLastFetch,
  getCachedDateList,
  getQuotaRemaining,
  getRecommendation,
} from "./cache";
```

Add to the existing `config` import:

```typescript
import { FORECAST_DAYS, RECOMMENDATION_ENABLED } from "./config";
```

Add a new type import below the existing one:

```typescript
import type { ForecastResponse, StatusResponse, RecommendationResponse } from "../shared/types";
```

Add a helper near the top of the file (after the existing imports, before `const api = new Hono()`):

```typescript
function todayWIB(): string {
  const now = new Date();
  const localNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = localNow.getUTCFullYear();
  const mo = String(localNow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(localNow.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}
```

Add a new endpoint anywhere among the existing routes (e.g. above `// POST /api/refresh`):

```typescript
// GET /api/recommendation — daily AI surf recommendation, may be null
api.get("/recommendation", async (c) => {
  if (!RECOMMENDATION_ENABLED) {
    const body: RecommendationResponse = { enabled: false, recommendation: null };
    return c.json(body);
  }
  const rec = await getRecommendation(todayWIB());
  const body: RecommendationResponse = { enabled: true, recommendation: rec };
  return c.json(body);
});
```

- [ ] **Step 4: Run, verify pass**

Run: `cd /root/surf-pacitan && bun test tests/routes.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Run full suite**

Run: `cd /root/surf-pacitan && bun test`
Expected: All previous tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes.ts tests/routes.test.ts
git commit -m "feat(api): add /api/recommendation endpoint"
```

---

## Task 12: Frontend `useRecommendation` hook

**Files:**
- Create: `src/client/hooks/useRecommendation.ts`

- [ ] **Step 1: Implement the hook**

Create `src/client/hooks/useRecommendation.ts`:

```typescript
import { useState, useEffect } from "react";
import type { Recommendation, RecommendationResponse } from "../../shared/types";

interface UseRecommendationResult {
  enabled: boolean;
  recommendation: Recommendation | null;
  loading: boolean;
}

export function useRecommendation(): UseRecommendationResult {
  const [enabled, setEnabled] = useState(true);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/recommendation");
        if (!res.ok) {
          if (!cancelled) {
            setEnabled(false);
            setRecommendation(null);
          }
          return;
        }
        const data: RecommendationResponse = await res.json();
        if (cancelled) return;
        setEnabled(data.enabled);
        setRecommendation(data.recommendation);
      } catch {
        if (!cancelled) {
          setEnabled(false);
          setRecommendation(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { enabled, recommendation, loading };
}
```

- [ ] **Step 2: Verify build**

Run: `cd /root/surf-pacitan && bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/hooks/useRecommendation.ts
git commit -m "feat(client): add useRecommendation hook"
```

---

## Task 13: Frontend `RecommendationCard` component

**Files:**
- Create: `src/client/components/RecommendationCard.tsx`
- Create: `src/client/components/RecommendationCard.css`

- [ ] **Step 1: Implement component**

Create `src/client/components/RecommendationCard.tsx`:

```tsx
import { useState } from "react";
import type { Recommendation } from "../../shared/types";
import { SPOT_DISPLAY } from "../../shared/spots";
import "./RecommendationCard.css";

interface RecommendationCardProps {
  recommendation: Recommendation;
}

function findSpotDisplay(key: Recommendation["bestSpot"]) {
  return SPOT_DISPLAY.find((s) => s.key === key) ?? SPOT_DISPLAY[0];
}

export function RecommendationCard({ recommendation }: RecommendationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const spot = findSpotDisplay(recommendation.bestSpot);
  const { start, end } = recommendation.bestWindow;

  return (
    <section className="recommendation-card" aria-label="AI surf recommendation">
      <button
        className="recommendation-card-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="recommendation-card-header">
          <span className="recommendation-card-eyebrow">🌅 Empfehlung für morgen</span>
        </div>
        <div className="recommendation-card-hero">
          <span className="recommendation-card-emoji">{spot.emoji}</span>
          <span className="recommendation-card-spot">{spot.label}</span>
          <span className="recommendation-card-window">{start}–{end}</span>
          <span className="recommendation-card-chevron">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="recommendation-card-body">
          <p className="recommendation-card-reasoning">{recommendation.reasoning}</p>
          {recommendation.warnings.length > 0 && (
            <ul className="recommendation-card-warnings">
              {recommendation.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Create CSS**

Create `src/client/components/RecommendationCard.css`:

```css
.recommendation-card {
  margin: 0.75rem 1rem;
  background: var(--bg-card);
  backdrop-filter: var(--card-blur);
  -webkit-backdrop-filter: var(--card-blur);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;

  & .recommendation-card-toggle {
    width: 100%;
    background: transparent;
    border: none;
    padding: 0.75rem 1rem;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }

  & .recommendation-card-header {
    margin-bottom: 0.4rem;
  }

  & .recommendation-card-eyebrow {
    font-family: var(--font-display);
    font-size: 0.75rem;
    color: var(--text-dim);
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  & .recommendation-card-hero {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 600;

    & .recommendation-card-emoji {
      font-size: 1.4rem;
    }

    & .recommendation-card-spot {
      flex: 0 0 auto;
    }

    & .recommendation-card-window {
      color: var(--text-dim);
      font-weight: 500;
      flex: 1 1 auto;
    }

    & .recommendation-card-chevron {
      font-size: 0.75rem;
      color: var(--text-dim);
    }
  }

  & .recommendation-card-body {
    padding: 0 1rem 0.85rem;
    border-top: 1px solid var(--border);
    padding-top: 0.75rem;
  }

  & .recommendation-card-reasoning {
    color: var(--text);
    font-size: 0.9rem;
    line-height: 1.45;
    margin: 0 0 0.5rem 0;
  }

  & .recommendation-card-warnings {
    list-style: none;
    margin: 0;
    padding: 0;

    & li {
      color: var(--yellow, #fbbf24);
      font-size: 0.825rem;
      line-height: 1.35;
      padding: 0.15rem 0;
    }
  }
}

@media (min-width: 768px) {
  .recommendation-card {
    margin: 1rem 1.5rem;

    & .recommendation-card-toggle {
      padding: 1rem 1.25rem;
    }

    & .recommendation-card-hero {
      font-size: 1.15rem;
    }
  }
}
```

- [ ] **Step 3: Verify build**

Run: `cd /root/surf-pacitan && bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/RecommendationCard.tsx src/client/components/RecommendationCard.css
git commit -m "feat(client): add RecommendationCard component"
```

---

## Task 14: Wire `RecommendationCard` into `App.tsx`

**Files:**
- Modify: `src/client/App.tsx`

- [ ] **Step 1: Add imports**

In `src/client/App.tsx`, add after the existing component imports:

```typescript
import { RecommendationCard } from "./components/RecommendationCard";
import { useRecommendation } from "./hooks/useRecommendation";
```

- [ ] **Step 2: Use the hook**

Inside the `App()` component body, after the line `const { days, lastFetch, loading, error, refresh } = useForecast();`, add:

```typescript
  const { enabled: recEnabled, recommendation } = useRecommendation();
```

- [ ] **Step 3: Render the card**

Find the JSX block starting with `<Header lastFetch={lastFetch} onRefresh={refresh} />` and insert the card directly below it (before `{/* Day label + navigation */}`):

```tsx
      {recEnabled && recommendation && (
        <RecommendationCard recommendation={recommendation} />
      )}
```

- [ ] **Step 4: Verify build and dev run**

Run: `cd /root/surf-pacitan && bunx tsc --noEmit`
Expected: No errors.

Manually verify in browser (only if working interactively): start `bun run dev` and `bun run dev:client`, open http://localhost:5173 — if `DEEPSEEK_API_KEY` is unset, no card appears. If set and a recommendation has been generated, card appears at the top.

- [ ] **Step 5: Commit**

```bash
git add src/client/App.tsx
git commit -m "feat(client): render RecommendationCard at top of app"
```

---

## Task 15: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append env vars block**

In `CLAUDE.md`, locate the existing `## Environment Variables` section. Append the following bullets to the existing list:

```markdown
- `DEEPSEEK_API_KEY` — DeepSeek API key (enables the daily AI recommendation card)
- `DEEPSEEK_MODEL` — defaults to `deepseek-v4-flash`. Set to e.g. `deepseek-v4-pro` to use a stronger model.
- `DEEPSEEK_THINKING` — `"false"` to disable thinking mode. Default: enabled.
- `RECOMMENDATION_ENABLED` — `"false"` to disable the daily recommendation cron without removing the API key (e.g. when away from Pacitan). Default: enabled when `DEEPSEEK_API_KEY` is set.
```

- [ ] **Step 2: Append architecture note to `## Architecture` section**

In the `## Architecture` section, append a new paragraph at the end:

```markdown
**Daily AI recommendation:** Once daily at 20:00 WIB (`cron.ts` → `recommendation.ts`), the cached `ForecastDay` for *tomorrow* is fed to DeepSeek V4 Flash along with `src/server/knowledge-base.ts` (a Pacitan-specific system prompt). The model returns a structured JSON recommendation that's cached at `surf:recommendation:YYYY-MM-DD` (TTL 36h) and served via `/api/recommendation` to the `RecommendationCard` component at the top of the app. Validated for shape and bounds; failed validation retries once. Gated by `RECOMMENDATION_ENABLED` + `DEEPSEEK_API_KEY` — feature is fully no-op if either is missing.
```

- [ ] **Step 3: Final test run**

Run: `cd /root/surf-pacitan && bun test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document DeepSeek recommendation env vars and architecture"
```

---

## Self-Review Notes (for the implementing engineer)

**Things to verify at implementation time** (flagged in the spec):

1. **DeepSeek V4 thinking-mode field name** — the client uses `thinking: { type: "enabled" }`. If the API rejects this, the error body usually echoes the invalid field. Try `enable_thinking: true` (V3 syntax) as a fallback, or check `https://api-docs.deepseek.com/quick_start/pricing` for current field name.

2. **`response_format: { type: "json_object" }`** — assumed supported on V4 since V3 supported it. If V4 rejects, the model can still be prompted to return JSON via the system prompt alone (already done) and the client will parse `message.content` either way.

3. **Token usage telemetry** — after first live run, check the `[recommendation] wrote rec for ... (tokens used: N)` log line to verify the estimated cost holds (~$0.0007/day expected).

## Deployment Note

After Task 15 commit:
- Set `DEEPSEEK_API_KEY` in `/etc/systemd/system/surf-pacitan.service` env or in `/root/surf-pacitan/.env`
- `bun run build`
- `systemctl restart surf-pacitan.service`
- First recommendation generates at the next 20:00 WIB; verify via `curl -s http://127.0.0.1:3100/api/recommendation | jq` after that fires.
