# Surf Model Revision — Design

**Date:** 2026-05-17
**Status:** Approved, ready for implementation plan
**Triggering observation:** 2026-05-17 ~07:40–09:00 at Pancer: model rated green, spot was flat. Pancer Door and Teleng Ria worked fine in the same window (Pancer Door mushy with outside closeouts but surfable inside, Teleng Ria conditions described as "ideal").

## Problem

The current `computeSurfable` (`src/server/surfable.ts`) rates each hour as green / yellow / red using tide percent, swell height, wind, and daylight. Three factors that strongly drive Pacitan surf quality are not used:

1. **Swell direction** — fetched (Open-Meteo Marine), stored in `SwellData.direction`, but never reaches the rating function. Each Pacitan spot has a different ideal direction because of bay geometry; today's 201° SSW worked for Teleng Ria but not for Pancer.
2. **Swell period** — also fetched and stored, also unused. An 11s groundswell and a 6s windswell of the same height produce very different waves.
3. **Tide upper bound** — the rating treats any `tidePercent >= TIDE_GREEN_MIN` (50% for Pancer Door) as green up to 100%. Sandbar breaks have an upper drowning threshold: today at 07:00 the tide was at 92% of daily range and Pancer (river-mouth sandbar) was completely flat.

A fourth problem: the per-spot config uses one flat tide ramp for all three spots. Pancer Door, Pancer, and Teleng Ria each have different ideal tide windows (Pancer wants lower-mid rising, Teleng Ria handles higher tide). The current code can't express that.

A fifth: `TIDE_GREEN_FALLING_MIN` is in the config interface but the function never reads it — dead field.

## Spot geography (local, overrides surf-guide naming)

West to east along Pacitan bay:

- **Pancer** — westernmost, at the river mouth. Sheltered from SW swells by the western headland; prefers more southerly (S/SSW) swells that wrap in. River-mouth sandbar drowns at very high tide.
- **Pancer Door** — middle, longest stretch of open beach. Widest swell exposure; handles S through SW.
- **Teleng Ria** — easternmost. Sheltered from SE by the eastern headland; SW/SSW swells angle in well. Per surf guides, pure-south swells "limit options" — prefers more SW. Tolerates high tide better than the other two.

Note that public surf guides (surfindonesia, surfline) label the river-mouth break as "Pancer" or "Pancer Door" interchangeably and place it at the *eastern* end of the bay. That naming conflicts with the local convention used in this app; the local convention wins.

## Approach

Extend the existing per-spot threshold model (`SpotThresholds` in `config.ts`) with new fields for swell direction, swell period, and a per-spot tide bell curve. The rating function becomes a "weakest link" cascade across per-factor quality judgments.

Considered and rejected:
- **Weighted scoring (sum/product of 0–1 per-factor scores).** More nuanced but harder to debug ("why was this rated red?") and loses the clean daylight gating.
- **Per-spot custom rating functions.** Most accurate but overkill — the three spots differ in degree (different thresholds), not in kind (same factor set).

## Inputs & types

Add `swellPeriod` and `swellDirection` to `SurfableInput`:

```ts
interface SurfableInput {
  hour: number;
  tidePercent: number;
  tideRising: boolean;
  swellHeight: number;
  swellPeriod: number;       // NEW — seconds
  swellDirection: number;    // NEW — degrees, 0=N
  windSpeed: number;
  windDirection: number;
  sunrise: string;
  sunset: string;
}
```

In `cron.ts` (three call sites at lines ~88, ~165, ~196), pass `h.swell.period` and `h.swell.direction` through. `SwellData` already carries both.

## Per-spot threshold structure

Replace the existing `SpotThresholds` with:

```ts
export interface SpotThresholds {
  tide: {
    greenMin: number; greenMax: number;
    yellowMin: number; yellowMax: number;
  };
  swellDir: {
    ideal: number;
    greenWindow: number;
    yellowWindow: number;
  };
  swellHeight: { greenMin: number; yellowMin: number };
  swellPeriod: { greenMin: number; yellowMin: number };
  facingDirection: number;
  wind: {
    offshore:   { greenMax: number; yellowMax: number };
    crossShore: { greenMax: number; yellowMax: number };
    onshore:    { greenMax: number; yellowMax: number };
  };
}
```

Drop the obsolete flat fields `TIDE_GREEN_MIN`, `TIDE_GREEN_FALLING_MIN`, `TIDE_YELLOW_MIN`, `SWELL_GREEN_MIN`, `SWELL_YELLOW_MIN`.

## Rating logic

```
1. Daylight gate: if hour outside [sunrise, sunset) → return red.
2. Compute per-factor quality (red | yellow | green):
   - tide:
       red    if tidePercent < tide.yellowMin OR tidePercent > tide.yellowMax
       green  if tidePercent in [tide.greenMin, tide.greenMax]
       yellow otherwise
   - swellDir: d = angularDistance(swellDirection, swellDir.ideal)
       red    if d > swellDir.yellowWindow
       green  if d ≤ swellDir.greenWindow
       yellow otherwise
   - swellHeight:
       red    if swellHeight < swellHeight.yellowMin
       green  if swellHeight ≥ swellHeight.greenMin
       yellow otherwise
   - swellPeriod:
       red    if swellPeriod < swellPeriod.yellowMin
       green  if swellPeriod ≥ swellPeriod.greenMin
       yellow otherwise
   - wind: category from facingDirection (existing getWindCategory)
       red    if windSpeed > wind[category].yellowMax
       green  if windSpeed ≤ wind[category].greenMax
       yellow otherwise
3. Final = min(all factor qualities) under red < yellow < green ordering.
4. Falling-tide cap: if !tideRising and the final is green, downgrade to yellow.
   (Sandbar breaks need rising water — spot-independent rule, kept from current CLAUDE.md.
   Reds stay red.)
```

Helper:

```ts
function angularDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}
```

Each per-factor judgment becomes a tiny, individually testable function (`computeTideQuality`, `computeSwellDirQuality`, etc.).

## Initial per-spot tuning values

These are starting points. They will need refinement from observation; the design supports easy tuning.

### Pancer (west, river mouth — drowns at full high)

```ts
{
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
}
```

### Pancer Door (middle, long beach — widest exposure)

```ts
{
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
}
```

### Teleng Ria (east, sheltered from SE — higher-tide tolerant)

```ts
{
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
}
```

## Validation against 2026-05-17 observations

Conditions: sunrise 05:41, sunset 17:25. Daily tide range -1.06m → +1.08m (range 2.14m). Swell 1.4–1.6m @ 10.6–11.4s, direction 200–202° (SSW). Wind 6–12 km/h from 75–155°.

Observed:
- Pancer flat from 07:40 through 09:00 (whole time user was there).
- Pancer Door working, mushy, outside closeouts, inside surfable, through 09:30.
- Teleng Ria described as "ideal" today.

Expected model output:

| Hour | Tide % | Pancer | Pancer Door | Teleng Ria |
|------|--------|--------|-------------|------------|
| 05 | 57 rising | GREEN | GREEN | GREEN |
| 06 | 76 rising | YELLOW (tide > 60 greenMax) | GREEN | GREEN |
| 07 | 92 rising | **RED** (tide > 80 yellowMax) | **YELLOW** (tide in [80,95]) | **YELLOW** (tide > 90 greenMax) |
| 08 | 100 peak | **RED** | **YELLOW** | **YELLOW** |
| 09 | 98 falling | **RED** + falling cap | **YELLOW** (falling cap) | **YELLOW** (falling cap) |
| 10 | 86 falling | RED (tide >80) | YELLOW | YELLOW |
| 11 | 67 falling | YELLOW (falling cap) | YELLOW (falling cap) | YELLOW (falling cap) |

This matches the day's reality: Pancer dead through the high-tide window, Pancer Door surfable but mushy, Teleng Ria the best of the three.

## Tests

Unit-test each per-factor function in isolation:

- `computeTideQuality`: red below yellowMin, red above yellowMax, green inside [greenMin, greenMax], yellow in the two side bands.
- `computeSwellDirQuality`: green inside ±greenWindow, yellow inside ±yellowWindow, red beyond; wraparound at 0°/360°.
- `computeSwellHeightQuality`: standard threshold.
- `computeSwellPeriodQuality`: standard threshold.
- `computeWindQuality`: category-aware threshold (delegates to existing `getWindCategory`).
- `angularDistance`: wraparound cases (0°/360°, 350° vs 10°, 180° vs 0°).

Integration tests for `computeSurfable`:

- Daylight gate (red outside sunrise→sunset).
- Falling-tide cap (any otherwise-green hour drops to yellow on falling tide).
- Each per-spot threshold case against the 2026-05-17 validation table above.

## Out of scope

- Changing data sources (Open-Meteo / StormGlass).
- Frontend rendering changes (the API stays the same shape — only the rating values change).
- Wind gust handling (`windGusts` is fetched but unused; out of scope here).
- Adjusting `facingDirection` per spot (set to 195 across the board for now; the bay opens to the south-southwest, all three spots are roughly the same orientation for wind-category purposes).

## Open questions for tuning (after first deploy)

- Pancer's `swellDir.greenWindow` of 15° may be too narrow; widen if observations show false reds for slightly-off-ideal swell directions.
- Period thresholds (8s green, 6s yellow) are conservative; can tighten if observation shows period matters less at this region.
- Pancer Door's `tide.yellowMax: 95` may be too generous if days with tide >90% turn out unsurfable rather than mushy-but-surfable.
