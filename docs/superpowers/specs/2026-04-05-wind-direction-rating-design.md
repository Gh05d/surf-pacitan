# Wind Direction in Surfable Rating

## Problem

The surfable rating only considers wind speed, not direction. 20 km/h offshore (clean, holds up wave faces) and 20 km/h onshore (destroys wave shape) are rated identically. This makes the "best windows" recommendation unreliable on windy days.

## Solution

Incorporate wind direction into the surfable rating by using direction-dependent wind speed thresholds. Each spot gets a `facingDirection` (compass bearing toward the ocean). The angle between the incoming wind and the spot facing determines whether wind is onshore, cross-shore, or offshore, and each category has its own green/yellow max thresholds.

## Spot Facing Directions

| Spot | Facing Direction | Notes |
|------|-----------------|-------|
| Pancer Door | 180° (South) | South-facing sandbar break |
| Pancer | 200° (SSW) | South-southwest facing |
| Teleng Ria | 180° (South) | South-facing bay |

## Wind Angle Classification

Wind direction from Open-Meteo = meteorological convention (where wind comes FROM).

```
angleDiff = |windDirection - facingDirection|
if angleDiff > 180: angleDiff = 360 - angleDiff

onshore:    angleDiff < 60°   (wind blows from ocean onto beach)
cross-shore: 60° <= angleDiff <= 120°
offshore:   angleDiff > 120°  (wind blows from land toward ocean)
```

## Wind Thresholds per Category

### Pancer Door / Pancer

| Category | Green max (km/h) | Yellow max (km/h) |
|----------|------------------|--------------------|
| Offshore (>120°) | 30 | 45 |
| Cross-shore (60°-120°) | 20 | 30 |
| Onshore (<60°) | 10 | 20 |

### Teleng Ria (more sheltered)

| Category | Green max (km/h) | Yellow max (km/h) |
|----------|------------------|--------------------|
| Offshore (>120°) | 35 | 50 |
| Cross-shore (60°-120°) | 25 | 35 |
| Onshore (<60°) | 15 | 25 |

## Changes

### `config.ts`

Replace flat `WIND_GREEN_MAX` / `WIND_YELLOW_MAX` in `SpotThresholds` with:

```ts
interface WindDirectionThresholds {
  greenMax: number;
  yellowMax: number;
}

interface SpotThresholds {
  TIDE_GREEN_MIN: number;
  TIDE_GREEN_FALLING_MIN: number;
  TIDE_YELLOW_MIN: number;
  SWELL_GREEN_MIN: number;
  SWELL_YELLOW_MIN: number;
  facingDirection: number; // degrees, direction beach faces toward ocean
  wind: {
    offshore: WindDirectionThresholds;
    crossShore: WindDirectionThresholds;
    onshore: WindDirectionThresholds;
  };
}
```

### `surfable.ts`

1. Add `windDirection: number` to `SurfableInput`.
2. Add helper `getWindCategory(windDirection, facingDirection)` returning `"offshore" | "crossShore" | "onshore"`.
3. In `computeSurfable()`, resolve the wind category, pick the matching thresholds, and use them for the existing green/yellow/red checks.

### No changes to:

- Frontend (already displays wind direction in Conditions; best windows derive from the improved rating automatically)
- Data fetching (`wind_direction_10m` already fetched from Open-Meteo and stored in hourly data)
- Tide/swell logic
- API routes

### Tests

Update `tests/surfable.test.ts`:
- Existing tests need `windDirection` added to inputs and thresholds updated to new structure
- New test cases: same wind speed rated differently for onshore vs offshore vs cross-shore
- Edge cases: wind exactly at sector boundaries (60°, 120°)
