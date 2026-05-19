# DeepSeek Daily Surf Recommendation — Design

**Date:** 2026-05-19
**Status:** Draft, pending user review

## Problem

The app shows raw forecast data plus per-spot green/yellow/red ratings for every hour, but the user still has to scan three spots × ~12 daylight hours × the next day to figure out "where and when should I actually surf tomorrow?". The rule-based ratings in `surfable.ts` are good but can't weigh trade-offs (small swell but excellent period, marginal tide but perfect wind, etc.) or express *why* a window stands out in natural language.

We want a once-daily AI-generated recommendation for the next surf day, delivered as a card at the top of the app, with reasoning that goes beyond what `surfable.ts` mechanically produces — and that's cleanly disable-able when the user is away from Pacitan.

## Design summary

A nightly cron at **20:00 Asia/Jakarta** reads the cached `ForecastDay` for *tomorrow* from Redis, enriches it with a small tide-range context value, and calls the **DeepSeek V4 Flash** model (with thinking mode enabled) using a Pacitan-specific knowledge base as the system prompt. The model returns a structured JSON recommendation that's cached in Redis and served via a new `/api/recommendation` endpoint to a new `RecommendationCard` component at the top of the app. The whole feature is gated by `RECOMMENDATION_ENABLED` env var so the user can disable it when traveling.

## Architecture

```
20:00 WIB cron
  → recommendation.ts: generateTomorrowRecommendation()
     → cache.getCachedDay(tomorrowDate)         (existing)
     → buildPayload(forecast)                   (enrich with tideRange)
     → deepseek.callDeepSeek(systemPrompt, payload, schema)
     → cache.setRecommendation(forDate, rec)
GET /api/recommendation
  → cache.getRecommendation(targetDate)
  → respond { enabled, recommendation }
Frontend (App.tsx)
  → fetch /api/recommendation on mount
  → render <RecommendationCard /> at top if recommendation exists
```

## Components

### `src/server/deepseek.ts` (new, ~70 lines)

Thin HTTP client for DeepSeek's OpenAI-compatible chat completions endpoint.

```ts
export interface DeepSeekChatOptions {
  model: string;
  systemPrompt: string;
  userPayload: object;
  thinking: boolean;
  responseFormat: "json_object";
  timeoutMs: number;
}

export async function callDeepSeek<T>(opts: DeepSeekChatOptions): Promise<T>
```

- Reads `DEEPSEEK_API_KEY` from env at call-time (no module-level capture).
- POSTs to `https://api.deepseek.com/v1/chat/completions`.
- Sends `response_format: { type: "json_object" }` for robust parsing.
- Thinking mode toggled via the `enable_thinking` parameter (per DeepSeek V4 docs — verify exact field name at implementation time).
- 10s timeout. Throws on non-2xx, on parse failure, on shape mismatch.
- One retry with `temperature: 0.2` if first response fails JSON parsing.

### `src/server/knowledge-base.ts` (new, ~60 lines)

Exports a single constant `PACITAN_SURF_KNOWLEDGE: string` — a markdown-formatted system prompt covering:

- **Spot geography** (west → east): Pancer (river mouth), Pancer Door (middle), Teleng Ria (east) — with the local-naming caveat that contradicts public guides
- **Per-spot dynamics**: Pancer's western-headland shelter from SW, Pancer Door's high-tide tolerance, Teleng Ria's openness to SW swell
- **Sandbar mechanics**: rising vs falling tide effect, why falling-tide rarely produces shape
- **Wind interpretation**: offshore/cross-shore/onshore per spot's `facingDirection`, local sea-breeze patterns (typically onshore by early afternoon)
- **Tide range context**: how to interpret the supplied `tideRange` field (>2.5m = spring tide / wide window / strong currents; <1.5m = neap / narrow window / weak push)
- **Output format spec**: exact JSON schema the model must produce
- **Anti-hallucination instructions**: "Only reference values from the provided `forecast` object. Do not invent numbers, trends, or weather events not present in the data. If conditions are ambiguous, say so."

Stored as a TypeScript constant (not a separate `.md` file) so the build pipeline doesn't need extra asset handling. Easy to edit, no file IO, and changes ship via normal deploy.

### `src/server/recommendation.ts` (new, ~120 lines)

```ts
export async function generateTomorrowRecommendation(): Promise<void>
export function buildUserPayload(forecast: ForecastDay): RecommendationPayload
```

`generateTomorrowRecommendation`:
1. Compute `tomorrowDate` = today (Asia/Jakarta) + 1 day, format `YYYY-MM-DD`.
2. `cache.getCachedDay(tomorrowDate)` — if null, log warning and return (StormGlass quota or fetch failure problem; not ours to handle).
3. `buildUserPayload(forecast)` — produce the compact payload (see below).
4. `callDeepSeek({ model: DEEPSEEK_MODEL, systemPrompt: PACITAN_SURF_KNOWLEDGE, userPayload, thinking: DEEPSEEK_THINKING, responseFormat: "json_object", timeoutMs: 10_000 })`.
5. Validate response shape (Zod-style runtime check; we don't currently use Zod, so a hand-rolled `validateRecommendation()` is fine — keep it ~20 lines).
6. `cache.setRecommendation(tomorrowDate, rec)` with 36h TTL.
7. Log success with token usage from the response.

On any error: log, do NOT overwrite the existing cached recommendation, do NOT crash the cron loop.

`buildUserPayload` produces:
```ts
{
  forDate: string,                    // YYYY-MM-DD
  tideRange: number,                  // max - min of tideExtremes, meters
  astronomy: { sunrise, sunset },
  tideExtremes: TideExtreme[],
  hourly: Array<{
    hour: number,
    tide: { height, rising },
    swell: { height, period, direction },
    wind: { speed, direction, gusts },
    weather: { condition, precipitation },
    surfable: SpotRatings             // rules-based baseline
  }>
}
```

The rules-based `surfable` ratings are included as a **baseline sanity check** for the model — it can agree or override with reasoning. Weather `temp` is omitted (not relevant for surf decision in tropical climate).

### `src/server/cache.ts` (extend existing)

Add:
```ts
export async function getRecommendation(date: string): Promise<Recommendation | null>
export async function setRecommendation(date: string, rec: Recommendation): Promise<void>
```

Redis key pattern: `surf:recommendation:YYYY-MM-DD` (the date the recommendation is *for*, not when it was generated). TTL 36h — so a recommendation generated 20:00 today for tomorrow stays valid through tomorrow evening, then auto-expires.

### `src/server/cron.ts` (extend existing)

After existing schedules, add:

```ts
if (RECOMMENDATION_ENABLED && DEEPSEEK_API_KEY) {
  scheduleAt("20:00", "Asia/Jakarta", generateTomorrowRecommendation);
}
```

If either env var is missing/false, the cron entry is **not registered at all** — no idle code path, no risk of accidental call.

The existing `cron.ts` uses interval-based scheduling, not wall-clock. We'll add a small helper:
```ts
function scheduleDailyAt(timeHHMM: string, tz: "Asia/Jakarta", fn: () => Promise<void>): void
```
Computes the ms until next 20:00 WIB, calls `setTimeout`, after firing schedules the next one. Survives clock drift on a long-running process by recomputing each cycle.

### `src/server/routes.ts` (extend existing)

```ts
app.get("/api/recommendation", async (c) => {
  if (!RECOMMENDATION_ENABLED) {
    return c.json({ enabled: false, recommendation: null });
  }
  const targetDate = todayWIB();         // recommendation generated yesterday 20:00 is "for today" by 00:00
  const rec = await cache.getRecommendation(targetDate);
  return c.json({ enabled: true, recommendation: rec });
});
```

**Target date logic:** the endpoint always returns the recommendation for `todayWIB()`. The 20:00 cron on day N generates a rec keyed to day N+1; once day N+1 becomes "today" (after midnight WIB), the endpoint surfaces it. The previous day's rec (keyed N) is still cached until 20:00 + 36h ≈ next-morning 08:00, then expires — but the endpoint only ever looks up today, so old entries are inert. On the very first day after enabling the feature, the card stays hidden until the first 20:00 cron fires; from the next midnight onwards it's continuously available.

### `src/server/config.ts` (extend existing)

Add and export:
```ts
export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? "";
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
export const DEEPSEEK_THINKING = process.env.DEEPSEEK_THINKING !== "false";
export const RECOMMENDATION_ENABLED =
  process.env.RECOMMENDATION_ENABLED === "true" ||
  (process.env.RECOMMENDATION_ENABLED === undefined && DEEPSEEK_API_KEY !== "");
```

**Default behavior:** enabled if `DEEPSEEK_API_KEY` is set, unless explicitly `RECOMMENDATION_ENABLED=false`. Lets the user disable without unsetting the key.

### `src/shared/types.ts` (extend existing)

```ts
export interface Recommendation {
  forDate: string;                       // YYYY-MM-DD
  generatedAt: string;                   // ISO timestamp
  bestSpot: SpotName;                    // telengRia | pancer | pancerDoor
  bestWindow: { start: string; end: string };  // "HH:MM" local
  headline: string;                      // 1 sentence summary
  reasoning: string;                     // 2-3 sentences, German
  warnings: string[];                    // empty array or e.g. "Onshore-Wind ab 14:00"
  modelUsed: string;                     // for telemetry / debugging
}

export interface RecommendationResponse {
  enabled: boolean;
  recommendation: Recommendation | null;
}
```

### `src/client/components/RecommendationCard.tsx` + `.css` (new)

Renders at the top of `App.tsx`, above `ConditionsPanel`. Layout:

```
┌─────────────────────────────────────────┐
│ 🌅 Empfehlung für morgen                │
│                                          │
│ 🏖️ Pancer Door 06:00–09:00        ▼   │  (hero line, large)
│                                          │
│ ━━━━━━━━━━ (when expanded) ━━━━━━━━━━  │
│ SW-Swell 1.8m@12s mit leichtem Offshore │
│ trifft auf steigende Tide. Wind dreht   │
│ um 10:00 onshore — früh los.            │
│                                          │
│ ⚠ Tide-Range nur 1.3m (Nipptide)        │
└─────────────────────────────────────────┘
```

- Collapsed by default; tapping the chevron expands reasoning + warnings
- Hero line uses `SPOT_DISPLAY[bestSpot]` for label + emoji (per [[spot-geography]] memory + project convention)
- If `enabled === false` OR `recommendation === null`: render nothing (no empty state)
- No interaction with the day-swipe gesture: `RecommendationCard` is above the swipeable area, no `touchstart` handlers needed
- Co-located CSS using CSS nesting, no inline styles (per project convention)

Fetches `/api/recommendation` on mount, no polling — recommendation only updates once daily, refresh on page reload is fine.

## Data flow

1. **20:00 WIB**: cron fires → reads `surf:forecast:YYYY-MM-DD` for tomorrow from Redis → builds payload → DeepSeek call (~5–15s with thinking mode) → validates → writes `surf:recommendation:YYYY-MM-DD` with 36h TTL
2. **Anytime after**: client `GET /api/recommendation` → server looks up `surf:recommendation:todayWIB()` → returns to client → card renders
3. **Next 20:00 WIB**: previous recommendation auto-expires via TTL or is replaced when the new one is generated

## Error handling

| Scenario | Behavior |
|---|---|
| `DEEPSEEK_API_KEY` missing | Cron never registers. Endpoint returns `{ enabled: false, recommendation: null }`. Card hidden. |
| `RECOMMENDATION_ENABLED=false` | Same as above. |
| Tomorrow's forecast not in Redis at 20:00 | Log warning, skip this generation. Existing recommendation untouched. |
| DeepSeek HTTP error / timeout | Log error, skip. Existing recommendation untouched (still valid for "tomorrow" if cron was retried/cycled). |
| Invalid JSON response | 1 retry with `temperature: 0.2`. If still bad, log and skip. |
| Recommendation references invalid spot or out-of-range hour | Validation rejects → skip. |
| Frontend fetch fails | Card hidden silently — no error toast (this is a nice-to-have, not core functionality). |

## Anti-hallucination measures

In the system prompt:
> "Only reference values from the provided `forecast` object. Do not invent swell pulses, weather events, or numerical values not present in the data. If conditions are ambiguous or marginal, say so explicitly. Your `bestWindow` start and end times MUST fall within the 24 hours of `forDate`."

In validation:
- `bestWindow.start` and `.end` must be parseable `HH:MM`, with `end > start`, both within `00:00–23:59`
- `bestSpot` must be one of the three known `SpotName` values
- `reasoning` must be non-empty, ≤ 600 chars (keeps card compact)
- `warnings` must be an array of strings ≤ 200 chars each

If validation fails, treat as a generation failure (log, skip, keep prior).

## Testing

`tests/recommendation.test.ts`:
- `buildUserPayload` produces expected shape with `tideRange` derived correctly from extremes
- DeepSeek client mocked via `globalThis.fetch` mock
- Test: successful call writes to cache with correct key
- Test: API error does NOT overwrite existing cached recommendation
- Test: malformed JSON triggers one retry, then skip
- Test: validation rejects out-of-range hours, invalid spot names
- Test: when `RECOMMENDATION_ENABLED=false`, `generateTomorrowRecommendation` is a no-op (or not called)

`tests/cache.test.ts` extension:
- Test `getRecommendation` / `setRecommendation` round-trip with TTL

We don't test prompt quality or model output quality — that's not unit-testable, and the feature degrades gracefully if outputs are weak.

## Documentation

Append to `CLAUDE.md`:

- New env vars block: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_THINKING`, `RECOMMENDATION_ENABLED`
- Note: recommendation is a once-daily 20:00 WIB cron, cached in Redis, surfaced via `/api/recommendation` and the `RecommendationCard` component
- Note: knowledge base lives in `src/server/knowledge-base.ts` — edit and redeploy to update model behavior, no API key rotation needed

## Out of scope (YAGNI)

- Telegram delivery (user chose in-app only)
- Multi-day recommendations / day-after-tomorrow outlook
- Historical recommendation tracking ("was yesterday's call right?")
- User feedback loop
- A/B between flash and pro
- Per-spot recommendations (model picks ONE best spot per day)
- Streaming response (daily batch — no UX latency pressure)
- UI toggle for enabling/disabling (env var is sufficient — user changes it a few times per year)
- Custom prompts per user (single-user app)

## Open questions / verify at implementation time

- Exact DeepSeek V4 thinking-mode parameter name — docs may have shifted between V3 and V4 (V3 used `enable_thinking`, V4 may differ). Verify on first integration test against live API.
- Confirm DeepSeek V4 supports `response_format: json_object` (V3 did; reasonable to assume V4 inherits, but verify).
- Token-usage telemetry: capture `usage.total_tokens` from response and log per-call to track real-world cost vs estimate.
