# Spot Map — Design Spec

## Overview

Interactive satellite map of the Pancer bay showing three tagged surf spots, placed at the bottom of the DayView. Full viewport width. Three spot buttons above the map that fly-to and zoom into the selected spot.

## Component

**New files:**
- `src/client/components/SpotMap.tsx`
- `src/client/components/SpotMap.css`

**Dependency:** `leaflet` (~40kb gzip) — add to `package.json` devDependencies.

## Tile Provider

Esri World Imagery (satellite tiles, free, no API key):
```
https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
```
Attribution: `Tiles &copy; Esri`

## Map Configuration

| Setting | Value |
|---------|-------|
| Center | Approx. middle of Pancer bay (~-8.220, 111.105) |
| Default zoom | 14 (whole bay visible) |
| Fly-to zoom | 17 (close-up on spot) |
| Height | 250px |
| Width | 100vw (breaks out of `max-width: 480px` parent) |
| Interactions | Zoom, pan, pinch-to-zoom enabled |

## Spots Data

Hardcoded array (coordinates to be verified on implementation):

```ts
const SPOTS = [
  { name: "Pancer Door", lat: -8.2175, lng: 111.115, desc: "River mouth sandbar, left" },
  { name: "Pancer", lat: -8.2195, lng: 111.105, desc: "Beachbreak, lefts & rights" },
  { name: "Teleng Ria", lat: -8.2185, lng: 111.095, desc: "Mellow beachbreak, beginner friendly" },
];
```

## Spot Buttons

Three buttons in a row above the map. Styled as pill-shaped, horizontally scrollable if needed. Active button highlighted when that spot is focused.

On click:
1. Map calls `flyTo([lat, lng], 17)` — smooth animation
2. Button gets active state styling
3. Marker popup opens

A "Reset" or clicking the already-active button flies back to default view (zoom 14, bay center).

## Markers

Leaflet default markers with popup containing:
- **Bold spot name**
- Description text (one line)

## Placement

Rendered inside `DayView.tsx`, below the Weather component. The map container uses `width: 100vw` with negative margin to break out of the parent's `max-width: 480px`.

## Out of Scope

- Dynamic spot data from API
- User's GPS location
- Directions/routing
- Multiple bays or spots outside Pancer
