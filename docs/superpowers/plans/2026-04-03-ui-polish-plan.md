# UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate the surf-pacitan frontend from dev-prototype to polished surf app — distinctive typography, glassmorphism cards, touch feedback, custom map markers, loading animation, and bug fixes.

**Architecture:** CSS-only changes where possible, minimal JS changes. Google Fonts loaded via `<link>` in `index.html`. All styles in co-located CSS files with nesting (no inline styles). Canvas drawing in TideGraph stays untouched.

**Tech Stack:** CSS (nesting, backdrop-filter, @keyframes), Google Fonts

---

## File Map

```
Modified files:
├── index.html                              # Google Fonts link
├── src/client/styles/global.css            # Font families, card variables, radius tokens
├── src/client/App.css                      # Touch feedback, loading animation
├── src/client/App.tsx                      # Loading spinner markup
├── src/client/components/Header.css        # Font, glassmorphism, hover state
├── src/client/components/Conditions.css    # Glassmorphism, radius, hover
├── src/client/components/Weather.css       # Glassmorphism, radius, hover
├── src/client/components/DayView.css       # Surf window glassmorphism
├── src/client/components/TideGraph.css     # Glassmorphism
├── src/client/components/SpotMap.css       # Bug fix --text-muted, custom markers, radius
├── src/client/components/SpotMap.tsx        # Custom marker icons (CSS class markers)
```

---

## Task 1: Typography — Google Fonts + Font Variables

**Files:**
- Modify: `index.html`
- Modify: `src/client/styles/global.css`

- [ ] **Step 1: Add Google Fonts link to index.html**

Add before `</head>` in `/root/surf-pacitan/index.html`:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
```

Outfit = display/heading font (geometric, modern, surfy). DM Sans = body font (clean, readable).

- [ ] **Step 2: Update global.css font families and add design tokens**

Replace the font-family line and add new variables in `/root/surf-pacitan/src/client/styles/global.css`:

```css
:root {
  --bg: #0a1628;
  --bg-card: rgba(15, 32, 53, 0.65);
  --bg-card-solid: #0f2035;
  --text: #e8dfd0;
  --text-dim: #8b9bb4;
  --green: #2dd4a8;
  --green-bg: rgba(45, 212, 168, 0.12);
  --yellow: #f0a830;
  --yellow-bg: rgba(240, 168, 48, 0.12);
  --red: #e06050;
  --red-bg: rgba(224, 96, 80, 0.12);
  --accent: #38bdf8;
  --border: rgba(56, 189, 248, 0.12);
  --sunrise: #f59e42;
  --sunset: #d9534f;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-pill: 20px;
  --font-display: 'Outfit', system-ui, sans-serif;
  --font-body: 'DM Sans', system-ui, sans-serif;
  --card-blur: blur(16px);
  --card-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
}
```

Update body font-family:

```css
html, body {
  background: linear-gradient(180deg, #1a0a2e 0%, #2d1b4e 8%, #5c2d5e 16%, #c75c3a 24%, #e8943a 32%, #c7873a 40%, #3d6a7a 52%, #1a5060 64%, #163d50 76%, #0f2a3d 88%, #0a1628 100%);
  background-attachment: fixed;
  min-height: 100vh;
  color: var(--text);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.5;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}
```

Key changes:
- `--bg-card` is now semi-transparent for glassmorphism
- `--bg-card-solid` for elements that need opaque backgrounds (like TideGraph which has canvas)
- `--border` is now a subtle glow instead of dark line
- Radius tokens: `--radius-sm` (8px), `--radius-md` (12px), `--radius-pill` (20px)
- Font tokens: `--font-display`, `--font-body`
- Card tokens: `--card-blur`, `--card-shadow`

- [ ] **Step 3: Commit**

```bash
git add index.html src/client/styles/global.css
git commit -m "feat: add Outfit + DM Sans fonts, glassmorphism design tokens"
```

---

## Task 2: Header Polish

**Files:**
- Modify: `src/client/components/Header.css`

- [ ] **Step 1: Update Header.css**

Replace `/root/surf-pacitan/src/client/components/Header.css` with:

```css
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1rem 0.5rem;
  border-bottom: 1px solid var(--border);

  & h1 {
    font-family: var(--font-display);
    font-size: 1.3rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  & .refresh-btn {
    background: var(--bg-card);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-family: var(--font-body);
    font-size: 0.75rem;
    padding: 0.35rem 0.65rem;
    cursor: pointer;
    line-height: 1.3;
    transition: background 0.15s, color 0.15s;

    &:active {
      background: rgba(56, 189, 248, 0.15);
      color: var(--text);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/components/Header.css
git commit -m "style: header with display font and glassmorphism refresh button"
```

---

## Task 3: Card Glassmorphism — Conditions + Weather

**Files:**
- Modify: `src/client/components/Conditions.css`
- Modify: `src/client/components/Weather.css`

- [ ] **Step 1: Update Conditions.css**

Replace `/root/surf-pacitan/src/client/components/Conditions.css` with:

```css
.conditions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
}

.conditions-card {
  background: var(--bg-card);
  backdrop-filter: var(--card-blur);
  -webkit-backdrop-filter: var(--card-blur);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.75rem;
  box-shadow: var(--card-shadow);
  transition: transform 0.15s, box-shadow 0.15s;

  &:active {
    transform: scale(0.97);
  }

  & .conditions-card-label {
    color: var(--text-dim);
    font-family: var(--font-display);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.5rem;
  }

  & .conditions-card-value {
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1;

    & .conditions-card-unit {
      font-size: 0.9rem;
      font-weight: 400;
    }
  }

  & .conditions-card-sub {
    color: var(--text-dim);
    font-size: 0.85rem;
    margin-top: 0.25rem;
  }

  & .conditions-card-sub + .conditions-card-sub {
    margin-top: 0;
  }

  & .wind-type {
    font-family: var(--font-display);
    font-size: 0.85rem;
    font-weight: 600;
    margin-top: 0.25rem;
  }
}
```

- [ ] **Step 2: Update Weather.css**

Replace `/root/surf-pacitan/src/client/components/Weather.css` with:

```css
.weather {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.75rem;
  padding: 0 1rem 1rem;
}

.weather-card {
  background: var(--bg-card);
  backdrop-filter: var(--card-blur);
  -webkit-backdrop-filter: var(--card-blur);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.75rem;
  text-align: center;
  box-shadow: var(--card-shadow);
  transition: transform 0.15s, box-shadow 0.15s;

  &:active {
    transform: scale(0.97);
  }

  & .weather-card-label {
    color: var(--text-dim);
    font-family: var(--font-display);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.4rem;
  }

  & .weather-card-value {
    font-family: var(--font-display);
    font-size: 1.1rem;
    font-weight: 700;

    & .weather-card-unit {
      font-size: 0.75rem;
      font-weight: 400;
    }
  }

  & .weather-card-text {
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 1.3;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/client/components/Conditions.css src/client/components/Weather.css
git commit -m "style: glassmorphism cards with shadows, display font, touch feedback"
```

---

## Task 4: TideGraph + DayView + Nav Polish

**Files:**
- Modify: `src/client/components/TideGraph.css`
- Modify: `src/client/components/DayView.css`
- Modify: `src/client/App.css`

- [ ] **Step 1: Update TideGraph.css**

Replace `/root/surf-pacitan/src/client/components/TideGraph.css` with:

```css
.tide-graph {
  padding: 0.5rem 0.5rem 0.25rem;
  background: var(--bg-card-solid);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  margin: 0.5rem 0;

  & .tide-graph-label {
    color: var(--text-dim);
    font-family: var(--font-display);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0 0.5rem 0.25rem;
  }

  & .tide-graph-container {
    width: 100%;
  }
}
```

- [ ] **Step 2: Update DayView.css astronomy and surf-window**

Replace `/root/surf-pacitan/src/client/components/DayView.css` with:

```css
.day-view {
  padding-bottom: 1.5rem;
}

/* Astronomy bar */
.astronomy-bar {
  padding: 0.75rem 1rem 0.5rem;

  & .astronomy-times {
    display: flex;
    justify-content: space-between;
    color: var(--text-dim);
    font-size: 0.75rem;
    margin-bottom: 0.25rem;
  }

  & .daylight-track {
    position: relative;
    height: 6px;
    background: rgba(15, 32, 53, 0.6);
    border-radius: 3px;
    overflow: hidden;

    & .daylight-fill {
      position: absolute;
      height: 100%;
      background: linear-gradient(90deg, #d9534f, #f59e42, #f0a830);
      border-radius: 3px;
    }
  }
}

/* Surf window box */
.surf-window {
  margin: 0 1rem 0.25rem;
  padding: 0.65rem 0.75rem;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  line-height: 1.5;
  backdrop-filter: var(--card-blur);
  -webkit-backdrop-filter: var(--card-blur);

  &.go {
    background: var(--green-bg);
  }

  &.nogo {
    background: var(--red-bg);
  }

  & .surf-window-title {
    font-family: var(--font-display);
    font-weight: 700;
    margin-bottom: 0.15rem;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  }

  &.go .surf-window-title {
    color: var(--green);
  }

  &.nogo .surf-window-title {
    color: var(--red);
  }

  & .surf-window-times {
    color: #fff;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  }

  & .surf-window-note {
    color: #fff;
    font-size: 0.78rem;
    margin-top: 0.2rem;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  }
}

/* No hourly data fallback */
.no-hourly {
  color: var(--text-dim);
  text-align: center;
  padding: 1rem;
}
```

- [ ] **Step 3: Update App.css — nav touch feedback + display font**

In `/root/surf-pacitan/src/client/App.css`, update these selectors:

Add to `.day-nav-btn`:
```css
.day-nav-btn {
  background: none;
  border: none;
  font-size: 1.25rem;
  padding: 0.25rem 0.5rem;
  color: var(--text);
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
```

Update `.day-nav-name` to use display font:
```css
.day-nav-label {
  text-align: center;

  & .day-nav-name {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1.1rem;
  }

  & .day-nav-date {
    color: var(--text-dim);
    font-size: 0.8rem;
  }
}
```

Update `.day-dot`:
```css
.day-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: none;
  background: var(--border);
  cursor: pointer;
  padding: 0;
  transition: background 0.15s, transform 0.15s;

  &.active {
    background: var(--accent);
    transform: scale(1.3);
  }
}
```

Update `.app-retry-btn`:
```css
  & .app-retry-btn {
    background: var(--accent);
    color: #0a1628;
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.5rem 1.5rem;
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.1s;

    &:active {
      transform: scale(0.95);
    }
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/client/components/TideGraph.css src/client/components/DayView.css src/client/App.css
git commit -m "style: polish TideGraph, DayView, nav with display font and touch states"
```

---

## Task 5: Loading Animation

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/App.css`

- [ ] **Step 1: Add loading spinner CSS to App.css**

Add to the bottom of `/root/surf-pacitan/src/client/App.css`:

```css
/* Loading spinner */
.loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 2: Update loading markup in App.tsx**

In `/root/surf-pacitan/src/client/App.tsx`, replace the loading return block:

```tsx
  if (loading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner" />
        <div className="app-loading-text">Loading forecast…</div>
      </div>
    );
  }
```

Also update the `.app-loading` style in App.css to be column layout:

```css
.app-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100dvh;

  & .app-loading-text {
    color: var(--text-dim);
    font-family: var(--font-display);
    font-size: 1rem;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/client/App.tsx src/client/App.css
git commit -m "feat: add loading spinner animation"
```

---

## Task 6: Custom Map Markers + Bug Fix

**Files:**
- Modify: `src/client/components/SpotMap.tsx`
- Modify: `src/client/components/SpotMap.css`

- [ ] **Step 1: Fix --text-muted bug and add custom marker + button styles**

Replace `/root/surf-pacitan/src/client/components/SpotMap.css` with:

```css
.spot-map {
  width: 100vw;
  margin-left: calc(-50vw + 50%);
  margin-top: 1.5rem;

  .spot-map-buttons {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    overflow-x: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .spot-btn {
    background: var(--bg-card);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    padding: 0.4rem 0.9rem;
    color: var(--text);
    font-family: var(--font-display);
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: var(--card-shadow);
    transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s;

    &.active {
      background: var(--accent);
      border-color: var(--accent);
      color: #0a1628;
      font-weight: 600;
    }

    &:active {
      transform: scale(0.95);
    }
  }

  .spot-map-container {
    height: 250px;
    width: 100%;

    /* Custom marker styling */
    .spot-marker {
      background: var(--accent);
      border: 2px solid #fff;
      border-radius: 50%;
      width: 14px;
      height: 14px;
      box-shadow: 0 0 8px rgba(56, 189, 248, 0.6);
    }

    /* Override Leaflet popup styles for dark theme */
    .leaflet-popup-content-wrapper {
      background: var(--bg-card-solid);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    }

    .leaflet-popup-content {
      font-family: var(--font-body);
      font-size: 0.85rem;
      margin: 0.6rem 0.8rem;
    }

    .leaflet-popup-tip {
      background: var(--bg-card-solid);
    }

    .leaflet-popup-close-button {
      color: var(--text-dim);

      &:hover {
        color: var(--text);
      }
    }
  }
}
```

- [ ] **Step 2: Replace default Leaflet markers with custom CSS markers in SpotMap.tsx**

In `/root/surf-pacitan/src/client/components/SpotMap.tsx`, remove the default marker icon imports and fix:

Remove these lines (6-15):
```ts
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});
```

Add after the imports a custom icon factory:

```ts
function createSpotIcon() {
  return L.divIcon({
    className: "spot-marker",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  });
}
```

Update the marker creation line (inside useEffect, where markers are created):

Change:
```ts
const marker = L.marker([spot.lat, spot.lng]).addTo(map);
```
To:
```ts
const marker = L.marker([spot.lat, spot.lng], { icon: createSpotIcon() }).addTo(map);
```

- [ ] **Step 3: Build and verify**

```bash
cd /root/surf-pacitan && bun run build
```

- [ ] **Step 4: Commit**

```bash
git add src/client/components/SpotMap.tsx src/client/components/SpotMap.css
git commit -m "style: custom map markers, fix --text-muted bug, glassmorphism buttons"
```

---

## Task 7: Build, Test, Push

- [ ] **Step 1: Run full build**

```bash
cd /root/surf-pacitan && bun run build
```

Expected: successful build.

- [ ] **Step 2: Run all tests**

```bash
cd /root/surf-pacitan && bun test
```

Expected: 18 tests pass (CSS changes don't affect tests).

- [ ] **Step 3: Push all commits**

```bash
cd /root/surf-pacitan && git push
```
