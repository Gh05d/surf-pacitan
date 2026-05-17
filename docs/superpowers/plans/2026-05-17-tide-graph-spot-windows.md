# Tide Graph Spot Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tide chart's single-spot background tinting with three labeled per-spot strips (P/PD/TR) at the bottom of the plot area, share spot-display metadata across the UI, and update the "Best windows" panel + map markers to use per-spot emojis.

**Architecture:** Add a shared `SPOT_DISPLAY` constant in `src/shared/spots.ts` (key/label/abbr/emoji). `TideGraph` draws three strips on the canvas via the existing `draw` hook and tightens the y-axis padding so the tide curve never enters the strip zone. `DayView` and `SpotMap` consume the same spot display data.

**Tech Stack:** TypeScript, React, uPlot (canvas chart), Leaflet (map). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-17-tide-graph-spot-windows-design.md`](../specs/2026-05-17-tide-graph-spot-windows-design.md)

**Testability note:** This is primarily a canvas-drawn visual change. Unit-testable pieces (the shared constant, basic helper functions) get tests; the canvas rendering itself is verified via dev server + production deploy in Task 7.

---

## File Map

- **Create** `src/shared/spots.ts` — shared `SPOT_DISPLAY` constant with per-spot display metadata
- **Create** `tests/spots.test.ts` — sanity test that `SPOT_DISPLAY` has the right shape
- **Modify** `src/client/components/DayView.tsx` — drop local `SPOT_INFO`, use `SPOT_DISPLAY`; update Best Windows row format
- **Modify** `src/client/components/SpotMap.tsx` — per-spot icon emoji (not all three identical 🏄)
- **Modify** `src/client/components/TideGraph.tsx` — remove chart-bg tinting + HTML spot-bands; add canvas-drawn strips; tighten y-axis padding
- **Modify** `src/client/components/TideGraph.css` — remove unused `.spot-bands*` rules

---

### Task 1: Shared `SPOT_DISPLAY` constant + test

**Files:**
- Create: `src/shared/spots.ts`
- Create: `tests/spots.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/spots.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { SPOT_DISPLAY } from "../src/shared/spots";
import type { SpotName } from "../src/shared/types";

describe("SPOT_DISPLAY", () => {
  test("has exactly three spots", () => {
    expect(SPOT_DISPLAY).toHaveLength(3);
  });

  test("covers all SpotName keys", () => {
    const keys = SPOT_DISPLAY.map((s) => s.key);
    const expected: SpotName[] = ["pancer", "pancerDoor", "telengRia"];
    for (const k of expected) {
      expect(keys).toContain(k);
    }
  });

  test("ordering is west-to-east (Pancer, Pancer Door, Teleng Ria)", () => {
    expect(SPOT_DISPLAY[0].key).toBe("pancer");
    expect(SPOT_DISPLAY[1].key).toBe("pancerDoor");
    expect(SPOT_DISPLAY[2].key).toBe("telengRia");
  });

  test("each spot has non-empty label, abbr, emoji", () => {
    for (const s of SPOT_DISPLAY) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.abbr.length).toBeGreaterThan(0);
      expect(s.emoji.length).toBeGreaterThan(0);
    }
  });

  test("abbreviations are unique", () => {
    const abbrs = SPOT_DISPLAY.map((s) => s.abbr);
    expect(new Set(abbrs).size).toBe(abbrs.length);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `cd /root/surf-pacitan && bun test tests/spots.test.ts 2>&1 | tail -10`
Expected: "Cannot find module" or import error — `src/shared/spots` does not exist yet.

- [ ] **Step 3: Create `src/shared/spots.ts`**

```ts
import type { SpotName } from "./types";

export interface SpotDisplayInfo {
  key: SpotName;
  label: string;   // full name shown in UI
  abbr: string;    // short code shown on tide-graph strips
  emoji: string;   // per-spot descriptive emoji
}

// Ordered west-to-east along Pacitan bay (local naming convention).
// Public surf guides label these differently — see CLAUDE.md "Spot geography".
export const SPOT_DISPLAY: readonly SpotDisplayInfo[] = [
  { key: "pancer",     label: "Pancer",      abbr: "P",  emoji: "🏞️" },
  { key: "pancerDoor", label: "Pancer Door", abbr: "PD", emoji: "🏖️" },
  { key: "telengRia",  label: "Teleng Ria",  abbr: "TR", emoji: "🌅" },
] as const;
```

- [ ] **Step 4: Run test, expect pass**

Run: `cd /root/surf-pacitan && bun test tests/spots.test.ts 2>&1 | tail -10`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git -C /root/surf-pacitan add src/shared/spots.ts tests/spots.test.ts
git -C /root/surf-pacitan commit -m "feat(shared): add SPOT_DISPLAY constant with label/abbr/emoji per spot"
```

---

### Task 2: Update DayView Best Windows panel

**Files:**
- Modify: `src/client/components/DayView.tsx`

The local `SPOT_INFO` constant (lines 26–30) gets replaced by `SPOT_DISPLAY`. The Best Windows row format gets the per-spot emoji and abbreviation.

- [ ] **Step 1: Inspect current state**

Run: `grep -n "SPOT_INFO\|surf-window-spot-name" /root/surf-pacitan/src/client/components/DayView.tsx`
Expected: matches at lines ~26, 57, 63, 130, 135.

- [ ] **Step 2: Replace import**

In `src/client/components/DayView.tsx`, change the imports block at the top of the file. Add the new import:

```ts
import { SPOT_DISPLAY } from "../../shared/spots";
```

- [ ] **Step 3: Delete the local `SPOT_INFO` constant**

In `src/client/components/DayView.tsx`, delete lines 26–30 (the `const SPOT_INFO: ...` declaration). All three usages will be replaced with `SPOT_DISPLAY`.

- [ ] **Step 4: Replace `SPOT_INFO` references with `SPOT_DISPLAY`**

In `src/client/components/DayView.tsx`:

- Line ~57: `for (const { key, label } of SPOT_INFO) {` → `for (const { key, label } of SPOT_DISPLAY) {`
- Line ~63: same replacement
- Line ~130: `{SPOT_INFO.map(({ key, label }) => {` → `{SPOT_DISPLAY.map(({ key, label, abbr, emoji }) => {`

- [ ] **Step 5: Update the Best Windows row format**

In `src/client/components/DayView.tsx`, find the `<span className="surf-window-spot-name">` at line ~135 and replace:

```tsx
<span className="surf-window-spot-name">🏄 {label}</span>
```

with:

```tsx
<span className="surf-window-spot-name">🏄 {emoji} {label} ({abbr})</span>
```

- [ ] **Step 6: Verify typecheck + tests pass**

Run: `cd /root/surf-pacitan && bunx tsc --noEmit 2>&1 | grep -E "DayView" | head -5`
Expected: No errors in DayView.tsx.

Run: `cd /root/surf-pacitan && bun test 2>&1 | tail -5`
Expected: All tests pass (no behavior tests for this component; SPOT_DISPLAY tests still pass).

- [ ] **Step 7: Commit**

```bash
git -C /root/surf-pacitan add src/client/components/DayView.tsx
git -C /root/surf-pacitan commit -m "feat(dayview): Best Windows panel uses per-spot emoji and abbreviation"
```

---

### Task 3: SpotMap per-spot emojis

**Files:**
- Modify: `src/client/components/SpotMap.tsx`

Currently `createSpotIcon()` (line 6) returns a fixed `🏄` icon used for all three markers. Change it to accept an emoji and use the per-spot emoji from `SPOT_DISPLAY`.

**Important:** Do NOT change the lat/lng coordinates in `SpotMap.tsx`'s local `SPOTS` array — they don't match the user's stated west-to-east convention (Teleng Ria is at the most western lng, Pancer Door at the most eastern), but resolving that contradiction is out of scope for this task. Flag it as an open question (see end of plan).

- [ ] **Step 1: Modify `createSpotIcon` to accept an emoji parameter**

In `src/client/components/SpotMap.tsx`, replace the function at line 6:

```ts
function createSpotIcon(emoji: string) {
  return L.divIcon({
    className: "spot-marker",
    html: emoji,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}
```

- [ ] **Step 2: Import `SPOT_DISPLAY` and build a lookup**

Add to imports at the top of `src/client/components/SpotMap.tsx`:

```ts
import { SPOT_DISPLAY } from "../../shared/spots";
```

- [ ] **Step 3: Add an `emoji` field per spot in `SPOTS`**

In `src/client/components/SpotMap.tsx`, replace the `SPOTS` constant at line 16 with:

```ts
const SPOTS = [
  { name: "Teleng Ria", lat: -8.2230, lng: 111.0790, desc: "Mellow beachbreak, beginner friendly", emoji: SPOT_DISPLAY.find((s) => s.key === "telengRia")!.emoji },
  { name: "Pancer", lat: -8.2215, lng: 111.0880, desc: "Beachbreak, lefts & rights", emoji: SPOT_DISPLAY.find((s) => s.key === "pancer")!.emoji },
  { name: "Pancer Door", lat: -8.2298, lng: 111.1026, desc: "River mouth sandbar, left", emoji: SPOT_DISPLAY.find((s) => s.key === "pancerDoor")!.emoji },
];
```

(The `find(...)!.emoji` pattern is OK here because `SPOT_DISPLAY` is a known-fixed constant; the assertion is safe at the file-evaluation boundary.)

- [ ] **Step 4: Pass the emoji into `createSpotIcon`**

In `src/client/components/SpotMap.tsx`, find the line that creates markers (~line 51):

```ts
const marker = L.marker([spot.lat, spot.lng], { icon: createSpotIcon() }).addTo(map);
```

and replace with:

```ts
const marker = L.marker([spot.lat, spot.lng], { icon: createSpotIcon(spot.emoji) }).addTo(map);
```

- [ ] **Step 5: Verify build**

Run: `cd /root/surf-pacitan && bunx tsc --noEmit 2>&1 | grep -E "SpotMap" | head -5`
Expected: No errors in SpotMap.tsx.

- [ ] **Step 6: Commit**

```bash
git -C /root/surf-pacitan add src/client/components/SpotMap.tsx
git -C /root/surf-pacitan commit -m "feat(spotmap): use per-spot emojis on map markers"
```

---

### Task 4: TideGraph — remove old visualization

**Files:**
- Modify: `src/client/components/TideGraph.tsx`

Strip out the now-obsolete visualization code: the chart-background tinting (single-spot, pancerDoor) and the HTML spot-bands block below the SVG. This leaves the chart visually emptier; Task 5 adds the new strips back as canvas drawing.

- [ ] **Step 1: Remove the chart-background tinting**

In `src/client/components/TideGraph.tsx`:

- Delete line 81: `const ratingByHour = new Map<number, SurfableRating>(hourly.map((h) => [h.hour, h.surfable.pancerDoor]));`
- Delete the entire `// --- Background surfable zone bands ---` section in the `draw` hook (lines ~160-172 — the `for (let hour = 0; hour < 24; hour++) { ... ratingByHour.get(hour) ... }` loop).

The remaining `draw` hook should still have night overlay, now marker, and H/L labels.

- [ ] **Step 2: Remove the HTML spot-bands JSX**

In `src/client/components/TideGraph.tsx`, find the spot-bands block (lines ~440-456) starting with `{!hideSpotBands && (` and ending with `)}`. Delete this entire block.

The returned JSX should now end after the `<div ref={containerRef} ... />` element, before the closing `</div>` of the outer `<div className="tide-graph...">`.

- [ ] **Step 3: Remove the `hideSpotBands` prop**

In `src/client/components/TideGraph.tsx`:

- In the `TideGraphProps` interface (line 7–20), delete the `hideSpotBands?: boolean` field and its comment.
- In the function parameter destructuring (line 50–59), remove `hideSpotBands = false,`.

- [ ] **Step 4: Remove `SPOT_LABELS` and the unused `SurfableRating` / `SpotName` imports**

In `src/client/components/TideGraph.tsx`:

- Delete lines 28–32 (the `SPOT_LABELS` constant).
- The `SurfableRating` import (line 5) is still used by `RATING_COLORS`. Keep it.
- `SpotName` is now only used in `SPOT_LABELS`, which is deleted. If unused after deletion, remove `SpotName` from the import on line 5.

Run: `cd /root/surf-pacitan && bunx tsc --noEmit 2>&1 | grep -E "TideGraph\.tsx" | head -10`
Expected: No "unused import" errors. (If `SpotName` is unused, remove it from the import.)

- [ ] **Step 5: Check for other call sites passing `hideSpotBands`**

Run: `grep -rn "hideSpotBands" /root/surf-pacitan/src/client/`
Expected: Only matches in `TideGraph.tsx` itself (already removed in step 3). If any caller (e.g., `TideGraphModal.tsx`) passes `hideSpotBands`, remove it there too — show that change in this task.

If `TideGraphModal.tsx` references `hideSpotBands`, find and delete those references.

- [ ] **Step 6: Verify build**

Run: `cd /root/surf-pacitan && bunx tsc --noEmit 2>&1 | tail -10`
Expected: No type errors.

Run: `cd /root/surf-pacitan && bun test 2>&1 | tail -5`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git -C /root/surf-pacitan add src/client/components/TideGraph.tsx src/client/components/TideGraphModal.tsx
git -C /root/surf-pacitan commit -m "refactor(tidegraph): remove single-spot tinting and HTML spot-bands"
```

(Only stage `TideGraphModal.tsx` if it was changed in step 5.)

---

### Task 5: TideGraph — add canvas-drawn spot strips

**Files:**
- Modify: `src/client/components/TideGraph.tsx`

Add three strips at the bottom of the canvas plot area, sharing the x-axis with the tide curve. Tighten the y-axis padding so the tide curve never enters the strip zone.

- [ ] **Step 1: Add constants for the strip layout**

In `src/client/components/TideGraph.tsx`, near the other module-level constants (after `MIN_RANGE` at line 36), add:

```ts
const STRIP_HEIGHT = 14; // px per spot strip
const STRIP_GAP = 2;     // px between strips
const STRIP_BLOCK_HEIGHT = STRIP_HEIGHT * 3 + STRIP_GAP * 2; // 46px total
const STRIP_TOP_DIVIDER = 1; // px top separator line
const STRIP_RESERVED = STRIP_BLOCK_HEIGHT + STRIP_TOP_DIVIDER; // 47px reserved
const STRIP_LEFT_GUTTER = 22; // px for abbreviation labels
```

- [ ] **Step 2: Reserve strip space at the bottom of the plot**

In `src/client/components/TideGraph.tsx`, find the `scales.y` block in `opts` (around line 98–103) and replace it with:

```ts
y: {
  range: (u, dataMin, dataMax) => {
    // Reserve STRIP_RESERVED px at the bottom of the bbox for the spot strips.
    // We do this by inflating dataMin downward so the tide curve's
    // visible range only fills (height - STRIP_RESERVED) of the bbox.
    const tidePadTop = 0.2;
    const usable = (u.height - STRIP_RESERVED) || 1;
    const dataRange = (dataMax - dataMin) || 1;
    const perPx = dataRange / usable;
    const tidePadBottom = STRIP_RESERVED * perPx;
    return [dataMin - tidePadBottom, dataMax + tidePadTop];
  },
},
```

This makes the visible y-range stretch downward by exactly `STRIP_RESERVED` px worth of data, so the tide curve occupies only the top `(u.height - STRIP_RESERVED)` px of the plot. The strips can safely paint in the bottom `STRIP_RESERVED` px without being overlapped by the curve.

- [ ] **Step 3: Build per-spot rating lookups**

In `src/client/components/TideGraph.tsx`, near the top of the `useEffect` body (where `times` and `heights` are built around lines 78–80), add:

```ts
import { SPOT_DISPLAY } from "../../shared/spots"; // add this to the file's import block
```

(Place it with the other imports at the top of the file, not inside the function.)

Then inside the `useEffect`, near the existing `times`/`heights` setup, add per-spot rating maps:

```ts
const ratingsBySpot = new Map<string, Map<number, SurfableRating>>();
for (const spot of SPOT_DISPLAY) {
  const m = new Map<number, SurfableRating>();
  for (const h of hourly) {
    m.set(h.hour, h.surfable[spot.key]);
  }
  ratingsBySpot.set(spot.key, m);
}
```

- [ ] **Step 4: Add strip drawing to the `draw` hook**

In `src/client/components/TideGraph.tsx`, inside the existing `draw` hook (the function that already draws night overlay, now marker, H/L labels), add a new section after the existing drawing code (just before the final `ctx.restore()`). Place it specifically **after the H/L labels block** and before `ctx.restore()`:

```ts
// --- Per-spot rating strips at the bottom of the plot area ---
const bboxBottom = u.bbox.top + u.bbox.height;
const stripsTop = bboxBottom - STRIP_RESERVED;

// Top separator line above strips
ctx.save();
ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(u.bbox.left, stripsTop);
ctx.lineTo(u.bbox.left + u.bbox.width, stripsTop);
ctx.stroke();
ctx.restore();

const sunriseHourNum = sunriseHour;
const sunsetHourNum = sunsetHour;

for (let i = 0; i < SPOT_DISPLAY.length; i++) {
  const spot = SPOT_DISPLAY[i];
  const ratings = ratingsBySpot.get(spot.key);
  if (!ratings) continue;

  const stripY = stripsTop + STRIP_TOP_DIVIDER + i * (STRIP_HEIGHT + STRIP_GAP);

  for (let hour = 0; hour < 24; hour++) {
    const rating = ratings.get(hour);
    const xStart = u.valToPos(hour * 3600, "x", true);
    const xEnd = u.valToPos((hour + 1) * 3600, "x", true);

    // Night hours: render as night-overlay color, not red
    const isNight = hour < Math.floor(sunriseHourNum) || hour >= Math.floor(sunsetHourNum);
    if (isNight) {
      ctx.fillStyle = "rgba(4, 10, 20, 0.45)";
    } else if (!rating) {
      continue; // no data — leave default background
    } else {
      ctx.fillStyle = RATING_COLORS[rating];
    }
    ctx.fillRect(xStart, stripY, xEnd - xStart, STRIP_HEIGHT);
  }

  // Abbreviation label in the left gutter
  ctx.save();
  ctx.fillStyle = "rgba(170, 187, 204, 0.85)";
  ctx.font = "9px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(spot.abbr, u.bbox.left + 4, stripY + STRIP_HEIGHT / 2);
  ctx.restore();
}
```

Note: `sunriseHour` and `sunsetHour` are already in scope from earlier in the `useEffect` (lines 83–84).

- [ ] **Step 5: Update `RATING_COLORS` opacity for strip visibility**

In `src/client/components/TideGraph.tsx`, find the `RATING_COLORS` constant (line 22). The current opacities are 0.18 (green/yellow) and 0.15 (red), tuned for chart background tinting. For the new strips (foreground elements), update to:

```ts
const RATING_COLORS: Record<SurfableRating, string> = {
  green: "rgba(45, 212, 168, 0.55)",
  yellow: "rgba(240, 168, 48, 0.5)",
  red: "rgba(224, 96, 80, 0.45)",
};
```

- [ ] **Step 6: Verify build**

Run: `cd /root/surf-pacitan && bunx tsc --noEmit 2>&1 | tail -10`
Expected: No errors.

Run: `cd /root/surf-pacitan && bun test 2>&1 | tail -5`
Expected: All tests pass.

- [ ] **Step 7: Visual smoke test via dev server**

The dev server is already running (per `surf-pacitan.service`). Build and reload:

```bash
cd /root/surf-pacitan && bun run build 2>&1 | tail -5
systemctl restart surf-pacitan.service
```

Open https://surf-pacitan.yolo-goldgrube.pp.ua in a browser. Expected:
- Tide curve drawn in the top portion of the chart.
- Three labeled strips (P, PD, TR top-to-bottom) at the bottom of the chart.
- Tide curve does NOT overlap the strips.
- Night hours render the strips in a dim color (not red).
- Daylight hours show green/yellow/red per spot per hour.
- Today specifically: Pancer strip red 07–10, PD/TR strips yellow 07–10 (matches the surf-model spec validation).

- [ ] **Step 8: Commit**

```bash
git -C /root/surf-pacitan add src/client/components/TideGraph.tsx
git -C /root/surf-pacitan commit -m "feat(tidegraph): add per-spot rating strips at bottom of plot area"
```

---

### Task 6: Clean up unused CSS

**Files:**
- Modify: `src/client/components/TideGraph.css`

The `.spot-bands*` rules in `TideGraph.css` are no longer used after Task 4 removed the HTML spot-bands block.

- [ ] **Step 1: Locate the unused rules**

Run: `grep -n "spot-bands\|spot-band-" /root/surf-pacitan/src/client/components/TideGraph.css`
Expected: matches at lines ~75–119 (the `& .spot-bands { ... }` block and child rules).

- [ ] **Step 2: Delete the unused rules**

In `src/client/components/TideGraph.css`, delete the entire `& .spot-bands { ... }` block (and all its child rules `& .spot-band-row`, `& .spot-band-label`, `& .spot-band-bar`, `& .spot-band-seg`). This is the block roughly at lines 75–119 in the current file.

- [ ] **Step 3: Verify CSS still parses**

Run: `cd /root/surf-pacitan && bun run build 2>&1 | tail -10`
Expected: Build succeeds, no CSS warnings.

- [ ] **Step 4: Commit**

```bash
git -C /root/surf-pacitan add src/client/components/TideGraph.css
git -C /root/surf-pacitan commit -m "chore(tidegraph): remove unused spot-bands CSS rules"
```

---

### Task 7: Deploy and verify

**Files:**
- None (build + deploy + verify)

- [ ] **Step 1: Bump service worker cache name**

Per `CLAUDE.md` "Service Worker / Cache Busting", bump `CACHE_NAME` in `public/sw.js` since this deploy ships JS/CSS changes.

In `/root/surf-pacitan/public/sw.js`, find the `CACHE_NAME` line and increment its version. Run:

```bash
grep -n "CACHE_NAME" /root/surf-pacitan/public/sw.js
```

Update the version (e.g., from `v3` to `v4` or whatever next integer applies).

- [ ] **Step 2: Build for production**

```bash
cd /root/surf-pacitan && bun run build 2>&1 | tail -10
```

Expected: build succeeds, writes to `/var/www/surf-pacitan/`.

- [ ] **Step 3: Restart the service**

```bash
systemctl restart surf-pacitan.service && sleep 3 && systemctl status surf-pacitan.service --no-pager | head -5
```

Expected: `active (running)`.

- [ ] **Step 4: Visually verify in browser**

Open https://surf-pacitan.yolo-goldgrube.pp.ua (hard-refresh once to let the new SW take over). Verify:

1. **Tide chart**: tide curve in top ~75%; three labeled strips (P/PD/TR) at the bottom.
2. **Strip colors**: green/yellow/red all visible; night hours dim.
3. **Today's pattern**: Pancer strip red roughly 07–10; PD and TR strips yellow in that window; all green in early morning + evening.
4. **Best windows panel**: rows display as `🏄 🏞️ Pancer (P) — 05:00–06:00`, etc.
5. **Map markers**: three distinct emojis (🏞️ Pancer, 🏖️ Pancer Door, 🌅 Teleng Ria) instead of three identical 🏄.
6. **Modal**: tap the chart or the `⤢ Zoom` button — the modal should also show the three strips. Pinch-zoom still works.

- [ ] **Step 5: Commit (if SW cache bump uncommitted)**

```bash
git -C /root/surf-pacitan status --short
```

If `public/sw.js` is uncommitted, commit it:

```bash
git -C /root/surf-pacitan add public/sw.js
git -C /root/surf-pacitan commit -m "chore: bump SW cache for tide-graph spot-windows deploy"
```

---

## Self-Review

**Spec coverage:**
- Spec "Tide graph changes — Layout" → Task 5 (y-axis padding + strip drawing).
- Spec "Tide graph changes — Strip ordering / labels / colors / night hours" → Task 1 (constant), Task 5 (drawing).
- Spec "What's removed (chart-bg tinting, HTML spot-bands, hideSpotBands prop)" → Task 4.
- Spec "What stays (tide curve, night overlay, now marker, H/L labels)" → confirmed in Task 4 not to delete them.
- Spec "Best windows panel changes" → Task 2.
- Spec "Shared spot-info constants" → Task 1.
- Spec "SpotMap markers" → Task 3.
- Spec "Validation" → Task 7 (visual verification points 1–6).
- Spec "Out of scope" — confirmed (no tap interactions, no color palette swap, no ConditionsPanel changes, modal inherits via reused TideGraph).

**Placeholder scan:** No "TBD"/"TODO" patterns. All code blocks are concrete. Visual verification steps name specific expected outcomes.

**Type consistency:**
- `SPOT_DISPLAY` interface `SpotDisplayInfo { key, label, abbr, emoji }` defined in Task 1, used identically in Tasks 2, 3, 5.
- `STRIP_HEIGHT`, `STRIP_GAP`, `STRIP_BLOCK_HEIGHT`, `STRIP_RESERVED`, `STRIP_TOP_DIVIDER`, `STRIP_LEFT_GUTTER` defined in Task 5 Step 1, used in Task 5 Step 4.
- `RATING_COLORS` updated in Task 5 Step 5 with new opacity values; consumed in Task 5 Step 4.

**Out-of-scope flag for the user (raised in plan, not silently fixed):**
- `SpotMap.tsx`'s lat/lng coordinates contradict the user's stated west-to-east convention. Teleng Ria has `lng: 111.0790` (most western) and Pancer Door has `lng: 111.1026` (most eastern), but the user said the opposite ordering. The plan **does not touch the coordinates** — only adds emojis to the existing markers. Resolving the geography contradiction is a follow-up task once we know which is right.
