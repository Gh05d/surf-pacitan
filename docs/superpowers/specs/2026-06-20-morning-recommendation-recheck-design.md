# Morning Recommendation Recheck (05:00 WIB)

**Date:** 2026-06-20
**Status:** Approved

## Problem

The daily AI recommendation is a snapshot generated at 20:00 WIB for the next
day. The forecast re-fetches every 3h, so by morning the chart can re-rate hours
the report assumed (e.g. 2026-06-20: a recommended-green 08:00 hour drifted to
red overnight). The report then contradicts the live chart.

## Goal

At 05:00 WIB each morning, refresh today's ratings and regenerate the report
**only if the per-hour/per-spot rating categories actually changed** — never on
mere numeric drift that leaves every green/yellow/red category unchanged.

## Decisions (locked)

- **Change trigger:** any rating-category flip (green↔yellow↔red) at any hour for
  any spot, across the whole day. Pure numeric drift that flips no category does
  not trigger.
- **Missing report:** if no report exists for today at 05:00 (20:00 run missed),
  generate one (doubles as recovery for missed evening runs).
- **No env override** for the hour — a fixed constant, mirroring
  `RECOMMENDATION_LOCAL_HOUR`. (Can be made env-driven later if needed.)

## Architecture

A new scheduled job in `cron.ts`, mirroring `scheduleDailyRecommendation`,
firing at `RECOMMENDATION_RECHECK_LOCAL_HOUR = 5` (WIB) via the existing
DST-correct `nextLocalFireMs`. Registered only when `RECOMMENDATION_ENABLED`.

### Flow (05:00 WIB)

```
fetchAndCacheWeather()                 // Open-Meteo, free → re-rates today
  → recheckTodayRecommendation(deps):
      today    = todayLocal(TIMEZONE)
      forecast = getCachedDay(today)               // missing → log + return
      rec      = getRecommendation(today)
      if !rec                          → generate (recovery)
      else:
        sigNow  = ratingSignature(forecast)
        sigBase = getRatingSignature(today)         // baseline from rec-gen time
        if sigBase == null OR sigBase !== sigNow → regenerate
        else                                       → log "unchanged", no-op
```

Regeneration calls `generateTomorrowRecommendation(deps, today)`.

**Cost:** zero StormGlass — only Open-Meteo (weather/swell) and the Claude CLI,
both free. The job MUST NOT call `fetchAndCacheTides`.

## Components

1. **`ratingSignature(forecast: ForecastDay): string`** — pure, new file
   `src/shared/rating-signature.ts`. Deterministic string built from
   `forecast.hourly[].surfable` (each hour, each spot's category). Captures any
   category flip; ignores numeric drift. Spot keys iterated in a stable order so
   the signature is order-independent of object-key enumeration.

2. **Baseline storage** — `generateTomorrowRecommendation` writes the signature
   after a successful rec write. New cache helpers `setRatingSignature(date, sig)`
   / `getRatingSignature(date)`, Redis key
   `surf:<region>:recommendation:<date>:ratingsig`, TTL = same 36h as the rec.
   Baseline = exactly the ratings the rec was based on (set on both the 20:00 run
   and every regen).

3. **`recheckTodayRecommendation(deps)`** — new dep-injected function in
   `recommendation.ts`, testable with injected `getCachedDay`,
   `getRecommendation`, `getRatingSignature`, and a generate fn. Wired into
   `cron.ts` after `fetchAndCacheWeather()`.

4. **`scheduleMorningRecheck(refShiftMs?)`** in `cron.ts` — mirrors
   `scheduleDailyRecommendation`: `nextLocalFireMs(..., RECOMMENDATION_RECHECK_LOCAL_HOUR, 0, TIMEZONE)`,
   re-arms with `refShiftMs = 60_000` to guard double-fire.

## Config

- `RECOMMENDATION_RECHECK_LOCAL_HOUR = 5` in `config.ts`, next to
  `RECOMMENDATION_LOCAL_HOUR`.

## Error handling

Each cron step `.catch`-logged like the existing jobs. A failed regen preserves
the existing cached rec (existing `generateTomorrowRecommendation` behavior). A
failed `fetchAndCacheWeather` leaves the recheck comparing the last cached
forecast — acceptable, the comparison still runs.

## Testing

- **`ratingSignature`** (pure, no Redis): identical ratings → identical sig;
  one category flip → different sig; numeric-only change (same categories) →
  identical sig; stable across spot-key order.
- **`recheckTodayRecommendation`** (injected deps): unchanged sig → no regen;
  changed sig → regen; missing rec → regen; missing sig → regen; missing
  forecast → no-op.

Verification gate: `bun test` (Redis-free, per project convention) plus the
pre-restart `bun build src/server/index.ts` bundle check.

## Out of scope (YAGNI)

- Env-configurable recheck hour.
- Re-fetching tides at 05:00 (astronomical, unchanged intraday).
- Notifying the user when a regen happens (could be a later addition).
