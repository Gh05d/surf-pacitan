# Live-conditions map overlay — design

**Date:** 2026-06-25
**Status:** approved (brainstorming), pending implementation plan

## Motivation

The bottom `SpotMap` is currently static geography (satellite tiles + emoji spot
markers + popups). The user wants the day's live conditions made **spatially**
visible — "alles easy visualisierbar" — by overlaying wind/swell direction and
per-spot state on the map, in sync with the conditions cards above it.

## Scope

Overlay the **selected 3h conditions block** onto the map:

1. **Swell arrow** over the bay + label (height·period).
2. **Wind arrow** over the bay + label (speed), colored offshore/cross/onshore.
3. **Per-spot rating color** — tint each spot marker green/yellow/red for the block.
4. **Close-out flag** — caution badge on spots flagged for close-out in the block.

The map **mirrors the `ConditionsPanel` time block** (Option A): changing the
◀▶ block updates the arrows + marker tints; day-swipe updates the day. This
requires lifting the block-index state out of `ConditionsPanel` into `App` so
the panel and map share one selected block.

### Out of scope (YAGNI)

- No animation, no map-resident time slider (the panel ◀▶ nav is the control).
- No **per-spot** swell/wind arrows — swell and wind are **region-level** (one
  value per hour from the offshore marine cell); one swell + one wind arrow over
  the bay is honest to the data.
- No new rating logic — ratings/close-out come from the existing shared helpers.

## Architecture

### 1. Lift block state to `App` + extract block utilities

The block helpers currently live inside `ConditionsPanel.tsx`
(`buildDaylightBlocks`, `averageBlock` + its mode helpers, `getDefaultBlockIndex`).
Extract the **pure** ones into a new client module `src/client/blocks.ts` so
`App`, `ConditionsPanel`, and `SpotMap` can all use them (and so they become
unit-testable — they aren't today). `spotBlockSummary` stays in `ConditionsPanel`
(it's display-specific).

- `App` owns `blockIndex` state. It builds `blocks = buildDaylightBlocks(currentDay.hourly, currentDay.astronomy)` and resets `blockIndex` to `getDefaultBlockIndex(...)` when the **displayed day changes** (a `useEffect` on `currentDay.date`) — preserving today's "current block" / future-day "best window" defaults that the per-day remount gives now.
- `App` passes `blocks`, `blockIndex`, `onBlockChange` down to `ConditionsPanel` (via `DayView`), which **drops** its internal `useState` + `buildDaylightBlocks` and renders from props.
- `App` passes `currentDay` + the **selected block** (`blocks[safeIndex]`) to `SpotMap`.
- **`bestWindowStart` for the default block:** `DayView` currently derives it from its green/yellow window scan (`findWindows` → earliest primary-window start). Extract just that scalar derivation into `blocks.ts` as a pure `bestWindowStartHour(hourly): number | null` (earliest green-else-yellow hour across spots). `App` calls it to seed `getDefaultBlockIndex`; `DayView` calls the same helper for its surf-window box, so the logic isn't duplicated. `DayView` keeps `findWindows` + the box rendering; it no longer owns the panel's default.

### 2. Overlay math — `src/client/map-overlay.ts` (new, pure, tested)

Small pure helpers consumed by `SpotMap`, reusing `degreesToCompass` and
`getWindCategory` from `../shared/surfable`:

```ts
travelBearing(fromDeg: number): number        // (fromDeg + 180) % 360 — arrow points where it travels
swellLabel(swell): string                     // e.g. "SW 1.0m·11s"  (compass FROM + height·period)
windLabel(wind): string                       // e.g. "E 17km/h"
windCategoryColor(windDir, facingDir): string // offshore→green / cross→amber / onshore→red token
```

Convention: the arrow **points in the direction of travel** (swell/wind heading
into the bay); the **text label carries the surfer-familiar "from" compass**
(SW swell, E wind). Swell `direction`/wind `direction` in the data are
meteorological "from" degrees, so travel bearing = `from + 180`.

### 3. `SpotMap` rendering — Approach A (rotated `divIcon` + tooltips)

`SpotMap` gains props: the selected block's averaged `swell {height, period, direction}`,
`wind {speed, direction}`, the per-spot ratings for the block, and the per-spot
close-out booleans.

- **Arrows:** two `L.marker`s with **rotated `divIcon`** arrow glyphs anchored at
  fixed points over the bay water (offsets from `ACTIVE_REGION.map.center`), with
  `L.tooltip` (permanent) labels. Swell = blue; wind = `windCategoryColor`.
  Rotation = `travelBearing(direction)` deg.
- **Spot markers:** keep the emoji `divIcon`; add a **colored ring** (green/yellow/red)
  for the block rating and a small **⚠️ corner badge** when close-out-flagged.
  Popups / tap-to-profile unchanged.
- **Reactivity:** the map-init effect stays `[]`. A **second effect** keyed on the
  block conditions + ratings (re)creates the arrow markers and `setIcon`s the spot
  markers — no full map rebuild. Arrow markers + spot markers held in refs.
- Per-spot rating for the block = `minQuality(block.hours.map(h => h.surfable[spotId]))`;
  close-out flags = `closeoutSpotsForHours(block.hours, spots)` (existing shared helpers).

Region-agnostic: arrows use `ACTIVE_REGION.coastFacingDirection` for the wind
category and `ACTIVE_REGION.map.center` for the anchor.

## Data flow

```
App (owns blockIndex; builds blocks from currentDay)
 ├── blocks, blockIndex, onBlockChange ──► DayView ──► ConditionsPanel (renders from props)
 └── currentDay + selectedBlock ─────────► SpotMap
                                             ├── averageBlock(block.hours)      → arrows (map-overlay.ts)
                                             ├── minQuality per spot            → marker rings
                                             └── closeoutSpotsForHours(...)     → ⚠️ badges
```

No server/API/Redis changes. `ForecastDay`/`HourlyData` unchanged.

## Error handling / edge cases

- A block with no daylight hours never occurs (`buildDaylightBlocks` only emits
  daylight blocks); `App` clamps `blockIndex` to `blocks.length - 1`.
- Fully-red day: marker rings all red, no close-out badges unless flagged — fine.
- Spot without close-out config → never flagged (existing `closeoutRisk` guard).
- Map init failure / no container → existing guard (`if (!containerRef.current) return`).

## Testing

- `tests/blocks.test.ts` (new) — `buildDaylightBlocks` (daylight filtering, block
  boundaries) and `averageBlock` (swell/wind/weather averaging, mode wind direction).
  These become testable for the first time via the extraction. `getDefaultBlockIndex`
  gets a `nowHour` param so its today-default is testable without faking `Date`.
- `tests/map-overlay.test.ts` (new) — `travelBearing` (e.g. 215° → 35°, wrap at
  360), `swellLabel`/`windLabel` formatting, `windCategoryColor` per category.
- Leaflet rendering (arrows, rings, badges, reactive update) — no DOM test infra;
  verified by `/tmp` client build + manual visual check (change the block → arrows
  + rings update; day swipe → map follows; tap marker → popup still works).
- `bun test` is the gate. Existing `ConditionsPanel` behavior must be unchanged
  after the state lift (same default block, same cards) — verify visually.

## Files touched

| File | Change |
|------|--------|
| `src/client/blocks.ts` | **new** — extracted `buildDaylightBlocks`, `averageBlock` (+ mode helpers), `getDefaultBlockIndex(nowHour)`, `bestWindowStartHour(hourly)` |
| `tests/blocks.test.ts` | **new** — pure tests for the above |
| `src/client/map-overlay.ts` | **new** — `travelBearing`, `swellLabel`, `windLabel`, `windCategoryColor` |
| `tests/map-overlay.test.ts` | **new** — pure tests |
| `src/client/App.tsx` | own `blockIndex`; build `blocks`; reset default on day change; thread to `DayView` + `SpotMap` |
| `src/client/components/DayView.tsx` | forward block props to `ConditionsPanel`; use `bestWindowStartHour` from `blocks.ts` for its box (App derives the panel default from the same helper) |
| `src/client/components/ConditionsPanel.tsx` | drop internal block state/builders; render from `blocks`/`blockIndex`/`onBlockChange` props; import `averageBlock` from `blocks.ts` |
| `src/client/components/SpotMap.tsx` | new props; render swell+wind arrows, marker rings, ⚠️ badges; reactive update effect |
| `src/client/components/SpotMap.css` | arrow / tooltip / ring / badge styles (co-located, CSS nesting) |

SW `CACHE_NAME` bump on deploy (ships JS/CSS); `bun run build` + the frontend is
served by nginx (no service restart needed for a frontend-only change).
