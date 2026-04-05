# Conditions Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate Conditions and Weather card rows with a single unified panel that groups all 5 cards and lets the user navigate through 3-hour time blocks.

**Architecture:** New `ConditionsPanel` component wraps existing `Conditions` and `Weather` components. It divides the day into 3h blocks, filters to daylight hours, averages data per block, and provides arrow navigation. `DayView` passes the full hourly array and surf window info instead of a single hour's data.

**Tech Stack:** React, CSS (co-located file), existing Conditions + Weather components unchanged

**Spec:** `docs/superpowers/specs/2026-04-05-conditions-panel-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/client/components/ConditionsPanel.tsx` | Create | Time block logic, averaging, navigation state, renders Conditions + Weather |
| `src/client/components/ConditionsPanel.css` | Create | Panel container, time nav header, card style overrides inside panel |
| `src/client/components/DayView.tsx` | Modify | Remove `getActiveHourly()`, remove `conditions-weather-row`, render `ConditionsPanel` |
| `src/client/components/DayView.css` | Modify | Remove `conditions-weather-row` media query styles |

---

### Task 1: Create ConditionsPanel component

**Files:**
- Create: `src/client/components/ConditionsPanel.tsx`
- Create: `src/client/components/ConditionsPanel.css`

- [ ] **Step 1: Create ConditionsPanel.tsx**

Create `src/client/components/ConditionsPanel.tsx` with this content:

```tsx
import { useState } from "react";
import type { HourlyData, SwellData, WindData, WeatherData, AstronomyData } from "../../../shared/types";
import { Conditions } from "./Conditions";
import { Weather } from "./Weather";
import "./ConditionsPanel.css";

interface ConditionsPanelProps {
  hourly: HourlyData[];
  astronomy: AstronomyData;
  isToday: boolean;
  bestWindowStart: number | null;
}

interface TimeBlock {
  start: number;
  end: number;
  label: string;
  hours: HourlyData[];
}

function buildDaylightBlocks(hourly: HourlyData[], astronomy: AstronomyData): TimeBlock[] {
  const sunriseHour = parseInt(astronomy.sunrise.split(":")[0], 10);
  const sunsetHour = parseInt(astronomy.sunset.split(":")[0], 10);

  const blocks: TimeBlock[] = [];
  for (let start = 0; start < 24; start += 3) {
    const end = start + 3;
    if (end <= sunriseHour || start >= sunsetHour) continue;

    const hours = hourly.filter((h) => h.hour >= start && h.hour < end);
    if (hours.length === 0) continue;

    blocks.push({
      start,
      end,
      label: `${String(start).padStart(2, "0")}:00 – ${String(end).padStart(2, "0")}:00`,
      hours,
    });
  }
  return blocks;
}

function windCategory(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d >= 315 || d <= 45) return "offshore";
  if (d >= 135 && d <= 225) return "onshore";
  return "crossShore";
}

function getModeWindDirection(hours: HourlyData[]): number {
  const counts: Record<string, number> = {};
  const firstDir: Record<string, number> = {};
  for (const h of hours) {
    const cat = windCategory(h.wind.direction);
    counts[cat] = (counts[cat] || 0) + 1;
    if (!(cat in firstDir)) firstDir[cat] = h.wind.direction;
  }
  const modeCat = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return firstDir[modeCat];
}

function getModeCondition(hours: HourlyData[]): string {
  const counts: Record<string, number> = {};
  for (const h of hours) {
    counts[h.weather.condition] = (counts[h.weather.condition] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function averageBlock(hours: HourlyData[]): { swell: SwellData; wind: WindData; weather: WeatherData } {
  const n = hours.length;

  const swell: SwellData = {
    height: Math.round((hours.reduce((s, h) => s + h.swell.height, 0) / n) * 10) / 10,
    period: Math.round(hours.reduce((s, h) => s + h.swell.period, 0) / n),
    direction: hours[Math.floor(n / 2)].swell.direction,
  };

  const wind: WindData = {
    speed: Math.round((hours.reduce((s, h) => s + h.wind.speed, 0) / n) * 10) / 10,
    gusts: Math.round(Math.max(...hours.map((h) => h.wind.gusts))),
    direction: getModeWindDirection(hours),
  };

  const weather: WeatherData = {
    temp: Math.round(hours.reduce((s, h) => s + h.weather.temp, 0) / n),
    condition: getModeCondition(hours),
    precipitation: Math.round((hours.reduce((s, h) => s + h.weather.precipitation, 0) / n) * 10) / 10,
  };

  return { swell, wind, weather };
}

function getDefaultBlockIndex(
  blocks: TimeBlock[],
  isToday: boolean,
  bestWindowStart: number | null
): number {
  if (isToday) {
    const currentHour = new Date().getHours();
    const idx = blocks.findIndex((b) => currentHour >= b.start && currentHour < b.end);
    return idx >= 0 ? idx : 0;
  }

  if (bestWindowStart !== null) {
    const idx = blocks.findIndex((b) => bestWindowStart >= b.start && bestWindowStart < b.end);
    return idx >= 0 ? idx : 0;
  }

  // Closest to midday
  const middayIdx = blocks.findIndex((b) => b.start <= 12 && b.end > 12);
  return middayIdx >= 0 ? middayIdx : Math.floor(blocks.length / 2);
}

export function ConditionsPanel({ hourly, astronomy, isToday, bestWindowStart }: ConditionsPanelProps) {
  const blocks = buildDaylightBlocks(hourly, astronomy);
  const [blockIndex, setBlockIndex] = useState(() =>
    getDefaultBlockIndex(blocks, isToday, bestWindowStart)
  );

  if (blocks.length === 0) {
    return <div className="no-hourly">No conditions data available</div>;
  }

  const safeIndex = Math.min(blockIndex, blocks.length - 1);
  const currentBlock = blocks[safeIndex];
  const { swell, wind, weather } = averageBlock(currentBlock.hours);

  return (
    <div className="conditions-panel">
      <div className="conditions-panel-nav">
        <button
          className="conditions-panel-btn"
          onClick={() => setBlockIndex((i) => i - 1)}
          disabled={safeIndex === 0}
          aria-label="Previous time block"
        >
          ◀
        </button>
        <div className="conditions-panel-time">{currentBlock.label}</div>
        <button
          className="conditions-panel-btn"
          onClick={() => setBlockIndex((i) => i + 1)}
          disabled={safeIndex === blocks.length - 1}
          aria-label="Next time block"
        >
          ▶
        </button>
      </div>
      <Conditions swell={swell} wind={wind} />
      <Weather weather={weather} />
    </div>
  );
}
```

- [ ] **Step 2: Create ConditionsPanel.css**

Create `src/client/components/ConditionsPanel.css` with this content:

```css
.conditions-panel {
  margin: 0 1rem 1rem;
  background: rgba(15, 32, 53, 0.3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;

  & .conditions {
    padding: 0.5rem 0.75rem;
  }

  & .weather {
    padding: 0 0.75rem 0.75rem;
  }

  & .conditions-card,
  & .weather-card {
    background: rgba(15, 32, 53, 0.4);
    border-color: rgba(56, 189, 248, 0.06);
    box-shadow: none;
  }
}

.conditions-panel-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.conditions-panel-time {
  font-family: var(--font-display);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text);
  letter-spacing: 0.02em;
}

.conditions-panel-btn {
  background: none;
  border: none;
  color: var(--text);
  font-size: 0.9rem;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  transition: transform 0.1s, opacity 0.1s;

  &:disabled {
    color: var(--border);
    cursor: default;
  }

  &:active:not(:disabled) {
    transform: scale(0.85);
    opacity: 0.7;
  }
}

@media (min-width: 768px) {
  .conditions-panel {
    margin: 0 1.5rem 1rem;

    & .conditions {
      padding: 0.75rem 1rem;
    }

    & .weather {
      padding: 0 1rem 1rem;
    }
  }

  .conditions-panel-nav {
    padding: 0.75rem 1rem;
  }

  .conditions-panel-btn {
    font-size: 1rem;

    &:hover:not(:disabled) {
      color: var(--accent);
    }
  }

  .conditions-panel-time {
    font-size: 0.9rem;
  }
}

@media (min-width: 1024px) {
  .conditions-panel {
    margin: 0 2rem 1rem;

    & .conditions {
      padding: 0.75rem 1.25rem;
    }

    & .weather {
      padding: 0 1.25rem 1rem;
    }
  }

  .conditions-panel-nav {
    padding: 0.75rem 1.25rem;
  }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /root/surf-pacitan && bun build src/client/components/ConditionsPanel.tsx --no-bundle 2>&1 | head -5`

Expected: No errors (component is standalone, imports resolve).

- [ ] **Step 4: Commit**

```bash
git add src/client/components/ConditionsPanel.tsx src/client/components/ConditionsPanel.css
git commit -m "feat: create ConditionsPanel component with time block navigation"
```

---

### Task 2: Integrate ConditionsPanel into DayView

**Files:**
- Modify: `src/client/components/DayView.tsx`
- Modify: `src/client/components/DayView.css`

- [ ] **Step 1: Update DayView.tsx imports**

In `src/client/components/DayView.tsx`, replace the imports (lines 1-5):

```tsx
import type { ForecastDay, HourlyData, SurfableRating, SpotName } from "../../../shared/types";
import { TideGraph } from "./TideGraph";
import { ConditionsPanel } from "./ConditionsPanel";
import "./DayView.css";
```

Note: `Conditions` and `Weather` imports are removed — `ConditionsPanel` renders them internally.

- [ ] **Step 2: Remove getActiveHourly function**

Delete the entire `getActiveHourly` function (lines 82-101 in the current file):

```ts
// DELETE this entire function:
function getActiveHourly(day: ForecastDay, isToday: boolean): HourlyData | null {
  ...
}
```

- [ ] **Step 3: Update DayView component body**

Replace the `DayView` component function (from `export function DayView` to the end) with:

```tsx
export function DayView({ day, isToday }: DayViewProps) {
  const { windows, reason } = findSpotWindows(day.hourly);

  const sunriseMin = parseHHmm(day.astronomy.sunrise);
  const sunsetMin = parseHHmm(day.astronomy.sunset);
  const totalDaylight = sunsetMin - sunriseMin;

  const sunrisePercent = (sunriseMin / (24 * 60)) * 100;
  const sunsetPercent = (sunsetMin / (24 * 60)) * 100;
  const daylightWidth = sunsetPercent - sunrisePercent;

  // Best window start hour for ConditionsPanel default
  const bestWindowStart = windows.length > 0 ? Math.min(...windows.map((w) => w.start)) : null;

  return (
    <div className="day-view">
      {/* Astronomy bar */}
      <div className="astronomy-bar">
        <div className="astronomy-times">
          <span>Sunrise {day.astronomy.sunrise}</span>
          <span>{Math.floor(totalDaylight / 60)}h {totalDaylight % 60}m daylight</span>
          <span>Sunset {day.astronomy.sunset}</span>
        </div>
        <div className="daylight-track">
          <div
            className="daylight-fill"
            style={{ left: `${sunrisePercent}%`, width: `${daylightWidth}%` }}
          />
          {isToday && (() => {
            const now = new Date();
            const nowMin = now.getHours() * 60 + now.getMinutes();
            const nowPercent = (nowMin / (24 * 60)) * 100;
            const isDark = nowMin < sunriseMin || nowMin > sunsetMin;
            return <div className="daylight-now" style={{ left: `${nowPercent}%` }}>{isDark ? "🌙" : "☀️"}</div>;
          })()}
        </div>
      </div>

      {/* Best window recommendation */}
      <div className={`surf-window ${windows.length > 0 ? "go" : "nogo"}`}>
        {windows.length > 0 ? (
          <>
            <div className="surf-window-title">
              {windows.some((w) => w.rating === "green") ? "Best windows" : "Possible windows"}
            </div>
            <div className="surf-window-spots">
              {SPOT_INFO.map(({ key, label }) => {
                const spotWindows = windows.filter((w) => w.spotKey === key);
                if (spotWindows.length === 0) return null;
                return (
                  <div key={key} className="surf-window-spot-row">
                    <span className="surf-window-spot-name">🏄 {label}</span>
                    <span className="surf-window-spot-times">
                      {spotWindows.map((w, i) => (
                        <span key={i}>{i > 0 && ", "}{formatWindow(w.start, w.end)}</span>
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="surf-window-note">
              Rising tide + favorable wind direction.
            </div>
          </>
        ) : (
          <>
            <div className="surf-window-title">No surf window</div>
            <div className="surf-window-note">{reason}</div>
          </>
        )}
      </div>

      {/* Tide chart */}
      <TideGraph
        hourly={day.hourly}
        tideExtremes={day.tideExtremes}
        astronomy={day.astronomy}
        isToday={isToday}
      />

      {/* Conditions panel with time navigation */}
      <ConditionsPanel
        hourly={day.hourly}
        astronomy={day.astronomy}
        isToday={isToday}
        bestWindowStart={bestWindowStart}
      />
    </div>
  );
}
```

- [ ] **Step 4: Remove conditions-weather-row from DayView.css**

In `src/client/components/DayView.css`, delete the `conditions-weather-row` rule inside the `@media (min-width: 768px)` block (lines 144-149):

```css
/* DELETE these lines: */
  .conditions-weather-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    align-items: start;
  }
```

- [ ] **Step 5: Build and verify**

Run: `cd /root/surf-pacitan && bun run build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/DayView.tsx src/client/components/DayView.css
git commit -m "feat: integrate ConditionsPanel into DayView, remove single-hour display"
```

---

### Task 3: Build, deploy, verify

- [ ] **Step 1: Run tests**

Run: `cd /root/surf-pacitan && bun test 2>&1`

Expected: All tests pass (no server-side changes).

- [ ] **Step 2: Build production frontend**

Run: `cd /root/surf-pacitan && bun run build 2>&1`

Expected: Build succeeds, output to `/var/www/surf-pacitan/`.

- [ ] **Step 3: Verify in browser**

Open the app and check:
1. The panel shows a time block header with ◀ ▶ arrows
2. Swell + Wind cards are in the top row, Temp + Sky + Rain in the bottom row
3. Arrow buttons cycle through daylight time blocks
4. For today: initial block is the current time block
5. For tomorrow: initial block covers the best surf window
6. All cards update when changing time blocks
7. Cards are visually grouped inside the panel container

- [ ] **Step 4: Push**

```bash
git push origin main
```
