# Recommendation Candidate Windows — Design

**Date:** 2026-06-07
**Status:** Approved by user (approach A: "Kandidaten + Override mit Begründung")

## Problem

The nightly AI recommendation (DeepSeek V4 Flash) scatters: 9 identical same-day
calls produced materially different picks (pancer 08–10 ×3, pancer 08–09,
pancer 06–08, pancerDoor 09–10, pancerDoor 09–11, telengRia 10–12 ×1). The
rating-optimal window per our own `surfable` logic (TR 10–12, the only
double-green) was picked exactly once.

Empirical probe findings (2026-06-07, cached 2026-06-08 payload):

| Config | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| temp=0, thinking on | pancer 08–09 | pancerDoor 09–10 | pancer 08–10 |
| temp=0, thinking off | pancer 08–10 | pancerDoor 09–11 | pancer 08–10 |

1. `temperature: 0` does NOT eliminate scatter — DeepSeek's reasoning chain is
   nondeterministic, and divergent chains reach different conclusions.
2. Thinking cannot be disabled: omitting the `thinking` body field still yields
   1.1k–2.4k reasoning tokens. The `DEEPSEEK_THINKING` env switch is a de facto
   no-op for V4 Flash.
3. Root cause is task design, not sampling: the system prompt called ratings
   "a sanity baseline, not ground truth" and licensed free overrides. Multiple
   defensible answers exist; each sampled reasoning path lands on a different one.

Conclusion: config knobs cannot fix this. The deterministic sub-problem (which
window is rating-optimal?) must be computed in code; the LLM picks/annotates.

## User policy decision

Ratings are binding by default, but the model may deviate **with an explicit,
data-grounded justification** (user-selected: "Override mit Begründung").

## Design

### 1. New pure module `src/server/candidates.ts`

```ts
export interface CandidateWindow {
  rank: number;          // 1..3, global
  spot: SpotName;
  start: string;         // "HH:00"
  end: string;           // "HH:00", exclusive; "10:00"–"12:00" covers hours 10, 11
  ratings: string;       // compact, e.g. "10g 11g"
  greens: number;
  risingShare: number;   // 0..1, fraction of window hours with tide.rising
  meanWind: number;      // km/h, rounded
}

export function computeCandidateWindows(forecast: ForecastDay): CandidateWindow[]
```

Algorithm:

- Per spot, scan hours whose rating is non-red (night hours are already red via
  the surfable sunrise/sunset logic, so no separate daylight filter).
- Within each contiguous non-red run, enumerate windows of length 2–3 hours;
  fall back to 1-hour windows only when no run reaches length 2.
- Score tuple, compared lexicographically:
  1. green hour count (desc)
  2. green fraction of window (desc)
  3. rising-tide share (desc)
  4. mean wind speed (asc)
  5. earlier start (asc) — morning bias, matches the local wind pattern
- Best window per spot → rank the (≤3) winners globally by the same tuple.
  Full determinism on ties: fall back to west-to-east spot order
  (telengRia, pancerDoor, pancer).
- A spot with zero non-red hours contributes no candidate; the list may be
  empty on a fully red day.

### 2. Payload & prompt

- `buildUserPayload` appends `candidateWindows` (calls `computeCandidateWindows`
  internally; stays pure).
- `knowledge-base.ts`: REMOVE "They are a sanity baseline, not ground truth"
  (the root of the scatter). New instructions:
  - Default: recommend candidate rank 1 unchanged.
  - Deviation (other candidate, shifted or free window) ONLY with a concrete
    reason from the hourly data; then `overrideReason` MUST cite that data with
    numbers (e.g. "wind jumps 12→22 km/h at 10:00"). When following candidate 1,
    omit `overrideReason`.
  - If `candidateWindows` is empty (fully red day), recommend the least-bad
    daylight window and warn clearly.
- Output schema gains optional `overrideReason` (string, ≤300 chars).

### 3. Validation (`validateRecommendation(raw, candidates)`)

Existing shape/bounds checks stay. Additional rules when `candidates` is
non-empty:

- **Red-hour floor (applies to follows-#1 and overrides alike):** every hour overlapped by
  `[start, end)` must be non-red for `bestSpot`. An hour h is overlapped when
  the window intersects `[h:00, h+1:00)` with positive duration.
- **Follows-#1 check:** pick counts as following candidate 1 when
  `bestSpot === c1.spot` and both `|Δstart| ≤ 60min` and `|Δend| ≤ 60min`
  (extra hours are covered by the red-hour floor). Then `overrideReason` is
  optional.
- **Deviation:** anything else requires non-empty `overrideReason` (≤300 chars),
  otherwise the result is rejected → existing 2-attempt retry loop (which since
  2026-06-07 also covers call failures).
- `candidates` empty → legacy behavior: no candidate checks (deliberate
  degradation for the rare all-red day).

### 4. Shared types & frontend

- `Recommendation` (shared/types.ts) gains optional `overrideReason`.
- `RecommendationCard` renders one extra line when present (label along the
  lines of "Abweichung vom Top-Fenster: …"). No other UI changes.
- Redis value is additive-optional — no migration; old cached recs stay valid.

### 5. Testing

- `tests/candidates.test.ts` (pure, Redis-free): synthetic `ForecastDay`
  fixtures — no greens, all red, single green hour (1h fallback), tie-breaks
  (rising share vs wind vs start), window length preference; plus a regression
  fixture from the real 2026-06-08 data expecting telengRia 10:00–12:00 at
  rank 1.
- `tests/recommendation.test.ts`: validation matrix — follows #1 (ok, no
  reason); follows #1 within ±1h (ok); other candidate with reason (ok); free
  window with reason but containing a red hour (reject); deviation without
  reason (reject → retry); empty candidates → legacy acceptance.
- Live verification after deploy: regenerate tomorrow's rec 2–3× via the
  documented `bun -e` one-liner; expected: stable candidate-#1 pick (or a
  justified override), scatter effectively gone.

## Risks & tunables

- **Override rate unknown until live.** If the model overrides too eagerly:
  sharpen the prompt, or narrow to variant B (override only within the
  candidate list). Both are cheap follow-ups; the validation hook is already
  in place.
- `temperature: 0.7` stays (prose quality; the pick is now structurally
  anchored). Revisit only if override chatter shows up.

## Out of scope

- No "no-surf day" product concept (all-red days degrade to legacy behavior).
- No multi-day recommendations.
- No temperature/thinking tuning.
