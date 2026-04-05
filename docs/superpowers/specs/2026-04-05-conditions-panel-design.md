# Unified Conditions Panel with Time Navigation

## Problem

The Conditions cards (Swell, Wind) and Weather cards (Temp, Sky, Rain) are visually separate blocks, but all show data for the same hour. There's no indication they belong together. Worse, for future days the displayed hour is hardcoded to 12:00 — the user can't see conditions at the recommended surf window or any other time.

## Solution

Merge Conditions and Weather into a single "Conditions Panel" component with a 3-hour time block navigator. The user can cycle through 3h blocks with arrow buttons. The default block is the one overlapping the best surf window.

## Layout

```
┌──────────────────────────────────────┐
│  ◀   06:00 – 09:00            ▶     │  ← time nav header
├──────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐           │
│  │  Swell   │  │  Wind    │          │  ← top row (2 cards)
│  │  1.2m    │  │  10 km/h │          │
│  │  @12s    │  │ Offshore │          │
│  │  S 180°  │  │  NE · G15│          │
│  └─────────┘  └─────────┘           │
│  ┌──────┐  ┌──────┐  ┌──────┐       │
│  │ 28°C │  │Cloudy│  │ 0 mm │       │  ← bottom row (3 cards)
│  └──────┘  └──────┘  └──────┘       │
└──────────────────────────────────────┘
```

## Time Blocks

Divide 24 hours into 8 blocks of 3 hours: `00–03`, `03–06`, `06–09`, `09–12`, `12–15`, `15–18`, `18–21`, `21–00`.

Only show blocks that have hourly data AND overlap with daylight (sunrise–sunset). For a typical 06:00–18:00 day, that's blocks `06–09`, `09–12`, `12–15`, `15–18`.

**Displayed values:** Average of the hourly data within the block. For a block `06–09`, average hours 6, 7, 8. For wind direction, use the most common wind category (onshore/cross-shore/offshore) in the block rather than averaging degrees.

**Default block:** The 3h block that overlaps with the first green window of the best-rated spot. If no green window exists, the first yellow window. If no windows at all, the block closest to midday.

## Navigation

- Left/right arrow buttons in the header
- Arrows disabled at the edges (first/last visible block)
- Today: initial block = current time block (not best window — user wants to see "now")
- Tomorrow+: initial block = best surf window block

## Component Changes

### New: `ConditionsPanel.tsx` + `ConditionsPanel.css`

Replaces the `conditions-weather-row` div in `DayView.tsx`. Contains:
- Time navigation state (current block index)
- Computes average values for the active 3h block
- Renders the outer container with time nav header
- Renders existing `Conditions` and `Weather` components inside

### Modified: `DayView.tsx`

- Remove `getActiveHourly()` function
- Remove `conditions-weather-row` wrapper
- Pass full `hourly` array + `isToday` + surf windows info to `ConditionsPanel`

### Unchanged: `Conditions.tsx`, `Weather.tsx`

These components still receive single `SwellData`, `WindData`, `WeatherData` props. The panel computes averages and passes them down. No changes to existing card components.

## Styling

The panel container gets a subtle border (`var(--border)`) and a slightly different background (`var(--bg-card)`) to visually group all cards. The time nav header sits inside this container. Existing card styles are preserved — they just live inside the new container now.

The time nav uses the same font and button style as the day nav in `App.tsx` for consistency, but smaller (since it's a secondary navigation within the page).
