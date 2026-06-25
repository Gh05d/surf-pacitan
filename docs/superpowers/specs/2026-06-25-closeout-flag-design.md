# Close-out risk flag — design

**Date:** 2026-06-25
**Status:** approved (brainstorming), pending implementation plan

## Motivation

The green/yellow/red rating judges five factors (tide-%, swell direction, swell
height, swell period, wind) — necessary-but-not-sufficient conditions for a
*rideable* wave. None of them sees whether a wave **peels or closes out**, which
is governed by sandbar/bottom shape (unmeasured) plus how steeply the swell jacks
up over that bank.

Ground truth (user, 2026-06-24): surfed Pancer + Pancer Door **15:30–17:10** on a
shallow, *rising* afternoon tide (water ≈ 0 m / just below MSL; the day's afternoon
high was only ~+0.03 m) with an ~11 s groundswell. Waves were sometimes overhead
but **closed out almost the whole session**. The app rated those hours green/yellow;
Surfline rated the rest of that day "poor". The existing `fallingTideCap` could
never have caught it — the tide was rising.

The lesson: a long-period swell over a **shallow bank** stands up tall and dumps.
The measurable proxy is **absolute water depth + swell period**, not rising/falling
and not the relative tide-%.

## Scope

A **close-out risk flag**: an advisory, per-hour, per-spot signal that does **not**
change the green/yellow/red rating, surfaced as (a) an on-chart marker, (b) a
ConditionsPanel note, and (c) a deterministic warning on the daily AI
recommendation. Pure heuristic, honestly labelled "risk" (the real cause — bank
shape — is unmeasurable, so it can never be a guarantee).

### Out of scope

- Changing the validated green/yellow/red rating (no rating cap). Keeps the
  Wisuki-verified pipeline intact.
- Re-ranking candidate windows to *avoid* close-outs. Warning only.
- Graded risk levels (binary risk/no-risk for v1 — avoids false precision).
- Teleng Ria config — no ground truth there yet (sheltered, higher-tide spot);
  left unconfigured until a real TR close-out session calibrates it.

## 1. Core heuristic — `src/shared/closeout.ts` (new, pure, tested)

Same shape/discipline as `computeFactorBreakdown` in `surfable.ts`: pure, no Redis,
no env, importable by both client and server.

```ts
import type { HourlyData } from "./types";

export interface CloseoutThresholds {
  tideHeightMax: number;    // meters MSL — at/below this the bank is shallow enough to dump
  periodMin: number;        // seconds — long-period energy jacks up on a shallow bank
  swellHeightMin?: number;  // optional floor — below this the surf is too small to matter
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

- Binary. No config → always `false` (other spots/regions untouched).
- Ignores `tide.rising` and `tidePercent` on purpose — the calibration session was
  rising yet closed out.

## 2. Config in the region pack

Add an **optional** field to `SpotThresholds` (`src/shared/spot-config.ts`):

```ts
closeout?: CloseoutThresholds;
```

It reaches the client through the existing `SPOT_THRESHOLDS` derived view and the
server through the `src/server/config.ts` re-export. **No `types.ts` payload change,
no Redis schema change, no cron change** — the client derives the flag on the fly
from data it already has (exactly like factor breakdowns).

Pacitan pack values (`regions/pacitan/index.ts`), calibrated to the 2026-06-24
session:

```
Pancer:       { tideHeightMax: 0.1, periodMin: 9, swellHeightMin: 0.6 }
Pancer Door:  { tideHeightMax: 0.1, periodMin: 9, swellHeightMin: 0.6 }
Teleng Ria:   (omitted — no config, no flag)
```

### Why these numbers

- **`tideHeightMax: 0.1 m`** — the key knob. Calibrated so a repeat of the
  2026-06-24 session (water ≈ 0–0.03 m) fires. On freak low-range days (e.g.
  2026-06-25, afternoon high only +0.03 m) it flags most of the afternoon
  (correct — Surfline agrees "poor"). On normal days, the afternoon pushes well
  above +0.1 m, so only the genuine low flags and the deeper mid-push stays clean.
- **`periodMin: 9 s`** — excludes short-period windsea (which crumbles rather than
  closes out; Pacitan windsea sits ≤7–8 s per the pack's `windseaPeriodMax`),
  includes real Indian-Ocean groundswell (≥8 s). 9 s sits safely below the
  calibration session's ~11 s.
- **`swellHeightMin: 0.6 m`** — below knee-ish offshore height, a "close-out" is
  moot; suppresses noise on flat days.

### Validation

`validateRegionConfig` (`src/shared/region.ts`) gains a light optional check: when
`closeout` is present, require `periodMin > 0` and `swellHeightMin` (if set) `>= 0`.
`tideHeightMax` is unconstrained (datum-relative, may be negative).

## 3. UI — strip marker + panel note

**TideGraph (`src/client/components/TideGraph.tsx`):**
- In `hooks.draw`, after the per-spot rating strips are drawn, overlay a **caution
  hatch** (diagonal lines) on the cells of hours where `closeoutRisk` is true for
  that spot. The underlying green/yellow/red color stays visible beneath the hatch.
- Stays **inside** the existing reserved strip band (`STRIP_RESERVED`) — no drawing
  past `u.bbox`, no change to the y-range reservation.
- Add one legend key "▦ close-out risk" wherever the strip legend lives.

**ConditionsPanel (`src/client/components/ConditionsPanel.tsx`):**
- For the currently selected 3h block, if any hour/spot flags, render a note line:
  *"⚠️ Close-out risk — ~11 s swell on a low tide (≤ 0.1 m); waves may jack up and
  close out at Pancer, Pancer Door."*
- Spot names, period, and the tide cutoff are **derived from data + `SPOT_DISPLAY`**,
  never hardcoded (per the repo's "no hardcoded factor claims in UI" rule).

## 4. Recommendation integration (hybrid half)

Second pure helper in `src/shared/closeout.ts`:

```ts
export function closeoutWarningForPick(
  day: ForecastDay,
  spotId: string,
  window: { start: string; end: string },
  thresholds: CloseoutThresholds | undefined,
): string | null
```

Returns a warning string when any daylight hour inside the picked window flags for
the picked spot, else null.

In `src/server/recommendation.ts`, after the rec validates, call it for the chosen
spot+window; if non-null, append to `recommendation.warnings` (dedup-guarded so it
doesn't double up with an LLM-authored warning). **Deterministic** — independent of
whether the model noticed.

## 5. Data flow summary

```
regions/pacitan/index.ts  (closeout config per spot)
        │
        ├── SPOT_THRESHOLDS (shared view) ──► client: closeoutRisk(hour, cfg)
        │                                       ├── TideGraph hatch overlay
        │                                       └── ConditionsPanel note
        │
        └── src/server/config.ts re-export ──► server: recommendation.ts
                                                 └── closeoutWarningForPick → rec.warnings
```

No new Redis keys, no API schema change, no cron change.

## 6. Testing (`tests/closeout.test.ts`, Redis-free)

- `closeoutRisk`:
  - yesterday-like fixture (tide 0.0 m, period 11 s, height 1.0 m) → `true`
  - deep tide (0.5 m, 11 s, 1.0 m) → `false`
  - short period (0.0 m, 7 s, 1.0 m) → `false`
  - below `swellHeightMin` (0.0 m, 11 s, 0.4 m) → `false`
  - `undefined` config → `false`
  - boundary: exactly `tideHeightMax` → `true`; exactly `periodMin` → `true`
- `closeoutWarningForPick`: crafted `ForecastDay` where the window overlaps flagged
  hours → non-null; window entirely in deep water → null.
- (Optional) a `validateRegionConfig` case for a malformed `closeout`.

`bun test` is the verification gate (per CLAUDE.md, not `tsc`).

## 7. Files touched

| File | Change |
|------|--------|
| `src/shared/closeout.ts` | **new** — `closeoutRisk`, `closeoutWarningForPick`, types |
| `src/shared/spot-config.ts` | add optional `closeout?: CloseoutThresholds` to `SpotThresholds` |
| `regions/pacitan/index.ts` | add `closeout` to Pancer + Pancer Door |
| `src/shared/region.ts` | light optional validation of `closeout` |
| `src/server/recommendation.ts` | inject deterministic close-out warning into `rec.warnings` |
| `src/client/components/TideGraph.tsx` | hatch overlay on flagged strip cells + legend key |
| `src/client/components/ConditionsPanel.tsx` | close-out note for selected block |
| co-located `.css` | marker / note styling as needed |
| `tests/closeout.test.ts` | **new** — pure tests |

Service-worker `CACHE_NAME` bump on deploy (ships JS/CSS). Frontend changes need a
`bun run build`; the rec-warning server change needs a `surf-pacitan.service`
restart.
