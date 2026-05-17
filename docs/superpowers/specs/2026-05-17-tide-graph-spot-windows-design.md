# Tide Graph: At-a-Glance Spot Windows — Design

**Date:** 2026-05-17
**Status:** Draft, pending user review

## Problem

The tide chart currently shows surf quality only for **Pancer Door** (via background tinting of the plot area). Per-spot quality for Pancer and Teleng Ria lives in a separate 10px-tall strip below the chart, with green/yellow only (red hidden as default-dark), making the comparison hard to scan at a glance.

After the recent surf-model revision, the three spots produce meaningfully different ratings under the same conditions (e.g., today: Pancer red at peak high, PD/TR yellow). Surfacing that differentiation is the point of the redesign — the user needs to see "which spot works now and when" without parsing a tiny color strip.

## Design summary

Replace the chart's single-spot background tinting + separate below-chart strip with **three thin colored strips packed at the bottom of the chart's plot area**, sharing the same x-axis as the tide curve, labeled with short abbreviations (P / PD / TR). Update the "Best windows" panel to use the format `🏄 [spot-emoji] Name (Abbr)` with per-spot geographic emojis.

## Tide graph changes (`TideGraph.tsx`)

### Layout

The chart's container height (200/260/320px on mobile/tablet/desktop) stays the same. The strips occupy a **fixed ~46px** at the bottom of uPlot's `bbox` regardless of chart height: 14px × 3 strips + 2px × 2 separators = 44px, plus 1px top divider line.

The tide curve uses the **remainder** of the bbox above the strips. Implementation: pad the y-axis range so the tide curve never draws into the bottom 46px of the bbox (e.g., `scales.y.range` returns `[dataMin - pad, dataMax + (pad + stripExtraTop)]` so high-tide peaks stay above the strip zone).

Strips are drawn inside the canvas via the existing `draw` hook so they share the x-axis with the tide curve, and the dashed `now` marker extends through them.

### Strip ordering (top → bottom)

Follows the bay's west-to-east geography (matches the user's mental model and the [[spot-geography]] memory):

1. **Pancer** (top) — westernmost, river mouth
2. **Pancer Door** (middle) — long middle beach
3. **Teleng Ria** (bottom) — easternmost

### Strip labels

Tiny short abbreviation pinned to the left edge of each strip, in a ~22px left gutter:

- `P` — Pancer
- `PD` — Pancer Door
- `TR` — Teleng Ria

Font: ~9px monospace, dim gray (`#abc`), centered in the gutter.

### Strip colors

Per hour, per spot, fill the strip cell with:

- Green: `rgba(45, 212, 168, 0.55)`
- Yellow: `rgba(240, 168, 48, 0.5)`
- Red: `rgba(224, 96, 80, 0.45)` (**newly visible** — current spot-bands hides red as default-dark; the new strips show it explicitly)

### Night hours

The rating function returns `"red"` for hours outside daylight (sunrise→sunset). Showing those as red would conflate "outside daylight" with "bad daytime conditions". To distinguish: when drawing each strip cell, **check `hour` against `astronomy.sunrise/sunset` first** — if outside daylight, fill with the same night overlay color used on the chart background (`rgba(4, 10, 20, 0.45)`) instead of the rating color. Result: strips visually fade out at the edges of the day, matching the chart's night zones.

### What's removed

- The chart-background tinting that currently uses `pancerDoor` ratings (`TideGraph.tsx:81`, the `ratingByHour` map + the loop at lines 161–172).
- The HTML `spot-bands` block below the SVG (`TideGraph.tsx:440–456`) — replaced by canvas-drawn strips inside the plot.
- The `spot-bands`, `spot-band-row`, `spot-band-label`, `spot-band-bar`, `spot-band-seg` CSS rules in `TideGraph.css` (no longer used).

### What stays

- Tide curve, night overlay, now marker, H/L tide-extreme labels — unchanged behavior, just rendered into a shorter vertical band.
- The `hideSpotBands` prop is now redundant (no separate strip to hide). Remove it.
- Pinch-zoom inside `TideGraphModal` keeps working; the strips zoom with the chart.

## "Best windows" panel changes (`DayView.tsx`)

Update the spot name row format in `SPOT_INFO.map(...)` at `DayView.tsx:130–143`:

Current:
```tsx
<span className="surf-window-spot-name">🏄 {label}</span>
```

New:
```tsx
<span className="surf-window-spot-name">🏄 {emoji} {label} ({abbr})</span>
```

Where `emoji` and `abbr` come from a shared spot-info table (see below). Spot row text already uses `color: #fff` via `.surf-window-spot-row` in `DayView.css:103` — no CSS change.

## Shared spot-info constants

Create a single source of truth in `src/shared/types.ts` (or a new `src/shared/spots.ts` if cleaner) for the per-spot display data:

```ts
export interface SpotDisplayInfo {
  key: SpotName;
  label: string;       // full name
  abbr: string;        // short abbreviation
  emoji: string;       // descriptive emoji
}

export const SPOT_DISPLAY: readonly SpotDisplayInfo[] = [
  { key: "pancer",      label: "Pancer",       abbr: "P",  emoji: "🏞️" },
  { key: "pancerDoor",  label: "Pancer Door",  abbr: "PD", emoji: "🏖️" },
  { key: "telengRia",   label: "Teleng Ria",   abbr: "TR", emoji: "🌅" },
] as const;
```

**Ordering matches west-to-east geography** and is the same array used by both:
- `TideGraph.tsx` for strip rendering
- `DayView.tsx` for the "Best windows" panel rows

This replaces the current `SPOT_LABELS` constant in `TideGraph.tsx:28–32` and the local `SPOT_INFO` import in `DayView.tsx`.

### Emoji rationale

- **🏞️ Pancer** — river mouth landscape; matches "Pancer is at the river mouth, west end"
- **🏖️ Pancer Door** — open beach with umbrella; long middle beach, widest exposure
- **🌅 Teleng Ria** — sunrise; east-end spot that catches first light

## SpotMap markers (`SpotMap.tsx`)

Currently all three markers show a single 🏄 emoji (`SpotMap.tsx:9`). To preserve consistency with the new "describe the spot" emoji, replace the single icon factory with a per-spot icon that uses the spot's `emoji` field from `SPOT_DISPLAY`.

This means each map marker becomes visually distinct (🏞️, 🏖️, 🌅) instead of three identical 🏄 pins. Small change; map pins stay the same size.

## Visual mockup

Today's data (2026-05-17, sunrise 05:41, sunset 17:25):

```
┌─ Tide ────────────────── Reset ──── ⤢ Zoom ─┐
│  ░░░░░░░░ (night)                            │
│                                              │
│       High 1.08m                             │
│         ↑                                    │
│      ╱   ╲                          ╱── ── ─ │
│     ╱     ╲                 ╱──────         │
│    ╱       ╲              ╱                  │
│  ─┘         ╲___________╱        Low ↓       │
│                          0.0    -1.06m       │
├──────────────────────────────────────────────┤
│ P  ▓▓░░██████████░░██░░░░▓▓                   │  (Pancer)
│ PD ▓▓▓▓░░░░░░░░░░██░░░░░░▓▓                   │  (Pancer Door)
│ TR ▓▓▓▓░░░░░░░░░░██░░░░░░▓▓                   │  (Teleng Ria)
└────────────────────────────────────────────-─┘
   05    08    11    14    17    20    23
                  │                          
                  now (07:30)                
```

(`▓` = green, `░` = yellow, `█` = red, `night overlay` = dark)

## Out of scope

- Adding a fourth spot or making the strip count dynamic — the three spots are hard-coded; this design assumes that stays.
- Tap-on-strip interactions (e.g., to surface tooltip with per-spot conditions). Useful future feature; not required for at-a-glance scan.
- Color customization or accessibility palette swaps (red/green color-blind users get a hard time today already; orthogonal problem).
- Changes to `ConditionsPanel` — it displays current-time conditions per time block, separate from the per-spot windows view.
- Tide-graph modal (`TideGraphModal`) — inherits the new strip behavior automatically because it reuses `TideGraph`. No modal-specific work needed.

## Validation

After implementation, the chart on the home view should:

1. Show three labeled strips (P/PD/TR) at the bottom of the plot area, with the tide curve drawn above.
2. Today's strips should show: Pancer red 07–10 (drowned), PD yellow 07–10, TR yellow 07–10 — matching the user's observed conditions from the prior surf-model spec.
3. Red, yellow, and green all visible in the strips (current strip hides red).
4. "Best windows" panel rows display as `🏄 🏞️ Pancer (P) — 05:00–06:00`, etc.
5. Map markers visually distinct per spot (🏞️, 🏖️, 🌅 instead of three identical 🏄).

## Open questions

None for this iteration. Future polish (tap interactions, color-blind palette, animated transitions) is out of scope.
