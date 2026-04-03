# Surf Pacitan — Design Spec

## Overview

Mobile-first web app showing tide forecasts with surfable window predictions for Pacitan, East Java, Indonesia. Primary spots: Pancer Door and Pancer (beachbreak/sandbar river mouth breaks).

The app serves a 3-day forecast with swipeable daily views centered on a tide graph with color-coded surfable zones. No authentication, no personalization — a single shared view for anyone who opens the page.

## Architecture

```
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐
│   Browser    │───▶│  Hono API    │───▶│  Redis Cache    │
│  (React/Vite)│    │  :3100       │    │  (existing)     │
└─────────────┘    └──────┬───────┘    └─────────────────┘
                          │ Cron: tides 1x/day, weather 8x/day
                   ┌──────▼───────┐
                   │  StormGlass  │  primary: tides, swell, wind, weather, astronomy
                   │  Open-Meteo  │  fallback: weather only
                   └──────────────┘
```

- **Runtime:** Bun
- **Backend:** Hono on port 3100
- **Frontend:** Vite + React, production build served from `/var/www/surf-pacitan/`
- **Cache:** Redis (existing instance on localhost:6379)
- **Reverse Proxy:** Nginx on `surf-pacitan.yolo-goldgrube.pp.ua` with SSL

## Data Sources

### StormGlass.io (Primary)

- Free tier: 10 requests/day
- Separate endpoints for tides vs weather/swell — each counts as 1 request
- **Tide fetch:** once per day at 00:00 (tides are astronomical predictions, don't change) — 1 request/day
- **Weather/swell fetch:** every 3 hours (8x/day) — 8 requests/day
- **Total:** 9 requests/day, leaving 1 request as buffer for manual refresh
- Provides: tide extremes + hourly sea level, swell (height/period/direction), wind (speed/direction/gusts), weather (temp/precipitation/condition), astronomy (sunrise/sunset)
- Coordinates: Pancer Door, Pacitan — approx. -8.22, 111.13

### Open-Meteo (Weather Fallback)

- Completely free, no API key required
- Used only when StormGlass weather data is unavailable or StormGlass is down
- Provides: temperature, precipitation, wind, weather condition
- Does NOT provide: tides, swell — no fallback for those

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/forecast` | All cached days (3-day forecast) |
| GET | `/api/forecast/:date` | Single day (YYYY-MM-DD) |
| GET | `/api/status` | Last fetch timestamp, cache health |
| POST | `/api/refresh` | Manual force-refresh (uses 1 API request) |

## Redis Data Model

**Key pattern:** `surf:forecast:{YYYY-MM-DD}`
**TTL:** 4 days (3-day forecast + 1 day buffer for "yesterday" review)

**Value structure per day (JSON):**

```json
{
  "date": "2026-04-03",
  "location": { "name": "Pacitan", "lat": -8.22, "lng": 111.13 },
  "astronomy": { "sunrise": "05:42", "sunset": "17:31" },
  "tideExtremes": [
    { "time": "03:12", "height": 0.3, "type": "low" },
    { "time": "09:45", "height": 1.8, "type": "high" },
    { "time": "15:30", "height": 0.4, "type": "low" },
    { "time": "21:55", "height": 1.7, "type": "high" }
  ],
  "hourly": [
    {
      "hour": 0,
      "tide": { "height": 0.8, "rising": false },
      "swell": { "height": 1.2, "period": 12, "direction": 210 },
      "wind": { "speed": 8, "direction": 135, "gusts": 12 },
      "weather": { "temp": 28, "condition": "partly_cloudy", "precipitation": 0 },
      "surfable": "green"
    }
  ]
}
```

**Meta key:** `surf:meta:last_fetch` — ISO timestamp of last successful StormGlass fetch

## Surfable Window Logic

Based on research of Pancer Door (river mouth sandbar break) and general Pacitan beachbreak characteristics. "Mid tide rising works best for beachies" is the established local knowledge.

### Tide Range Calculation

Tide range percentage is calculated relative to the daily min/max water levels:
`percentage = (current - dailyMin) / (dailyMax - dailyMin) * 100`

### Classification

**Green (Go):**
- Tide rising AND water level > 50% of tide range
- OR tide falling but still > 80% of tide range (shortly after high)
- AND swell >= 0.5m
- AND wind < 20 km/h
- AND within daylight hours (sunrise to sunset)

**Yellow (Meh):**
- Mid tide (30-50% range), rising or falling
- OR swell 0.3-0.5m (rideable but small)
- OR wind 20-30 km/h (choppy but doable)

**Red/Grey (No-Go):**
- Low tide (< 30% range) — sandbar too shallow
- OR swell < 0.3m — flat
- OR wind > 30 km/h — blown out
- OR outside daylight hours

### Rationale

- **Low tide bad:** Pancer Door is a sandbar break at a river mouth. At low tide the sandbar is too shallow, waves close out or don't break properly.
- **Rising to ~1h before high tide ideal:** More water over the sandbar creates better wave shape. The sweet spot is the upper portion of the rising tide.
- **Full high tide gets mushy:** Too much water over the sandbar, waves lose power.
- **Wind threshold 20 km/h:** Onshore wind above this chops up the face significantly on beachbreaks.
- **Daylight only:** No lights at Pancer Door, surfing in the dark is not practical.

## Frontend UI

### Layout (Mobile-First)

```
┌─────────────────────────────┐
│  Surf Pacitan           now │  Header
├─────────────────────────────┤
│  ◀  Today, Apr 3        ▶  │  Day Navigation (swipeable)
├─────────────────────────────┤
│  Sunrise 05:42  Sunset 17:31│  Astronomy Bar
├─────────────────────────────┤
│                             │
│   ~~~~ Tide Graph ~~~~      │  24h tide curve, ~60% viewport height
│   [green/yellow/red zones]  │  Surfable windows as colored overlays
│   H 1.8m        L 0.3m     │  High/low markers on curve
│          ▲now               │  "Now" vertical line marker
│                             │
├─────────────────────────────┤
│  Swell         Wind         │  Conditions (current hour)
│  1.2m @ 12s    8 km/h SE    │
├─────────────────────────────┤
│  Weather                    │
│  28°C  Partly Cloudy  0mm   │
└─────────────────────────────┘
```

### Interactions

- **Swipe left/right:** Navigate between days (3 days)
- **Tap on graph:** Show details for that hour (tide height, conditions)
- **"Now" marker:** Vertical line on today's graph showing current time
- **Pull-to-refresh:** Triggers `/api/refresh` for manual update

### Chart Library

Lightweight option — `uPlot` (~8kb gzipped) preferred over Chart.js for bundle size. Final choice during implementation.

### Responsive

- Mobile: Full-width, stacked layout as shown above
- Tablet/Desktop: Same layout, max-width constrained, centered

## Deployment

| Component | Detail |
|-----------|--------|
| systemd service | `surf-pacitan.service` — Hono API on :3100 |
| nginx config | `surf-pacitan.conf` — reverse proxy + static files |
| domain | `surf-pacitan.yolo-goldgrube.pp.ua` |
| SSL | Existing wildcard certs (`/etc/ssl/yolo-cert.pem`) |
| static files | `/var/www/surf-pacitan/` (Vite production build) |
| API key | `STORMGLASS_API_KEY` env var in systemd unit |
| safe to restart | Yes — no persistent state, only Redis cache |

## Project Structure

```
/root/surf-pacitan/
├── src/
│   ├── server/
│   │   ├── index.ts          # Hono app entry
│   │   ├── routes.ts         # API route handlers
│   │   ├── cron.ts           # Fetch scheduler (every 3h)
│   │   ├── stormglass.ts     # StormGlass API client
│   │   ├── open-meteo.ts     # Open-Meteo fallback client
│   │   ├── cache.ts          # Redis read/write helpers
│   │   └── surfable.ts       # Surfable window calculation
│   └── client/
│       ├── main.tsx          # React entry
│       ├── App.tsx           # Root component
│       ├── components/
│       │   ├── TideGraph.tsx  # Main tide chart
│       │   ├── DayView.tsx   # Single day container (swipeable)
│       │   ├── Conditions.tsx # Swell + wind panel
│       │   ├── Weather.tsx   # Weather panel
│       │   └── Header.tsx    # Header + astronomy
│       ├── hooks/
│       │   └── useForecast.ts # Data fetching hook
│       └── styles/
│           └── global.css
├── package.json
├── tsconfig.json
├── vite.config.ts
├── CLAUDE.md
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-04-03-surf-pacitan-design.md
```

## Extensibility (Future)

- **Multiple spots:** Location config as array, spot selector in UI, per-spot Redis keys
- **i18n:** String extraction into locale files, language toggle
- **Historical data:** Move from Redis-only to PostgreSQL for long-term storage + trend charts
- **PWA:** Service worker for offline access to cached forecasts
- **Notifications:** Push notification when surfable window approaches

## Out of Scope (MVP)

- User accounts / authentication
- Multiple spot selection
- Historical data / trend analysis
- PWA / offline mode
- i18n / localization
- Dev service (no separate Vite HMR service)
- Surf cam integration
- Community features (reports, ratings)
