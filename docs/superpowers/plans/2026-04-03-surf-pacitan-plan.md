# Surf Pacitan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first tide forecast web app for Pacitan surf spots with surfable window predictions, backed by StormGlass and Open-Meteo APIs with Redis caching.

**Architecture:** Hono API server (port 3100) fetches tide/weather data on a schedule, caches in Redis, serves to a React frontend via REST endpoints. Frontend renders swipeable daily tide graphs with color-coded surfable zones.

**Tech Stack:** Bun runtime, Hono (HTTP server), React + Vite (frontend), Redis (cache), uPlot (charts), StormGlass.io + Open-Meteo (data sources)

---

## File Map

```
/root/surf-pacitan/
├── package.json                    # Dependencies and scripts
├── tsconfig.json                   # TypeScript config
├── vite.config.ts                  # Vite config with proxy for dev
├── index.html                      # Vite HTML entry
├── CLAUDE.md                       # Project-specific dev context
├── src/
│   ├── shared/
│   │   └── types.ts                # Shared types (ForecastDay, HourlyData, etc.)
│   ├── server/
│   │   ├── index.ts                # Hono app entry + cron scheduler
│   │   ├── routes.ts               # API route handlers
│   │   ├── stormglass.ts           # StormGlass API client
│   │   ├── open-meteo.ts           # Open-Meteo fallback client
│   │   ├── cache.ts                # Redis read/write helpers
│   │   ├── surfable.ts             # Surfable window calculation
│   │   └── config.ts               # Location coords, thresholds, constants
│   └── client/
│       ├── main.tsx                # React entry
│       ├── App.tsx                 # Root component with swipe navigation
│       ├── components/
│       │   ├── TideGraph.tsx       # uPlot tide chart with surfable overlays
│       │   ├── DayView.tsx         # Single day container
│       │   ├── Conditions.tsx      # Swell + wind panel
│       │   ├── Weather.tsx         # Weather panel
│       │   └── Header.tsx          # Header + astronomy bar
│       ├── hooks/
│       │   └── useForecast.ts      # Data fetching hook
│       └── styles/
│           └── global.css          # Global styles, mobile-first
└── tests/
    ├── surfable.test.ts            # Surfable logic unit tests
    ├── stormglass.test.ts          # StormGlass response parsing tests
    └── open-meteo.test.ts          # Open-Meteo response parsing tests
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `CLAUDE.md`

- [ ] **Step 1: Initialize package.json**

```bash
cd /root/surf-pacitan
bun init -y
```

Then replace `package.json` with:

```json
{
  "name": "surf-pacitan",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "bun run --watch src/server/index.ts",
    "dev:client": "bunx vite",
    "build": "bunx vite build",
    "test": "bun test",
    "start": "bun run src/server/index.ts"
  },
  "dependencies": {
    "hono": "^4.10.0",
    "ioredis": "^5.8.0"
  },
  "devDependencies": {
    "@types/bun": "^1.3.0",
    "@vitejs/plugin-react": "^4.5.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "vite": "^6.3.0",
    "uplot": "^1.6.31",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd /root/surf-pacitan && bun install
```

- [ ] **Step 3: Create tsconfig.json**

Create `/root/surf-pacitan/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": ".",
    "paths": {
      "@shared/*": ["./src/shared/*"],
      "@server/*": ["./src/server/*"],
      "@client/*": ["./src/client/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create vite.config.ts**

Create `/root/surf-pacitan/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: ".",
  publicDir: "public",
  build: {
    outDir: "/var/www/surf-pacitan",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@client": path.resolve(__dirname, "src/client"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3100",
    },
  },
});
```

- [ ] **Step 5: Create index.html**

Create `/root/surf-pacitan/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <meta name="theme-color" content="#0f172a" />
    <title>Surf Pacitan</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create CLAUDE.md**

Create `/root/surf-pacitan/CLAUDE.md`:

```markdown
# Surf Pacitan

Tide forecast app for Pacitan surf spots (Pancer Door, Pancer).

## Stack
- Runtime: Bun
- Backend: Hono on port 3100
- Frontend: React + Vite, production build to /var/www/surf-pacitan/
- Cache: Redis (localhost:6379), keys prefixed with `surf:`
- Data: StormGlass.io (primary), Open-Meteo (weather fallback)

## Commands
- `bun run dev` — start server with watch mode
- `bun run dev:client` — start Vite dev server (proxies /api to :3100)
- `bun run build` — production build to /var/www/surf-pacitan/
- `bun test` — run tests
- `bun run start` — production server

## Key Files
- `src/server/index.ts` — Hono entry + cron scheduler
- `src/server/surfable.ts` — surfable window logic (green/yellow/red)
- `src/server/config.ts` — location, thresholds, constants
- `src/client/components/TideGraph.tsx` — main tide chart (uPlot)

## Environment Variables
- `STORMGLASS_API_KEY` — required for StormGlass API
- `PORT` — server port (default 3100)
- `REDIS_URL` — Redis connection (default redis://localhost:6379)
```

- [ ] **Step 7: Commit scaffolding**

```bash
cd /root/surf-pacitan
git add package.json bun.lockb tsconfig.json vite.config.ts index.html CLAUDE.md
git commit -m "chore: scaffold project with Bun, Hono, React, Vite"
```

---

## Task 2: Shared Types & Config

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/server/config.ts`

- [ ] **Step 1: Create shared types**

Create `/root/surf-pacitan/src/shared/types.ts`:

```ts
export interface TideExtreme {
  time: string; // HH:mm
  height: number; // meters
  type: "high" | "low";
}

export interface TideData {
  height: number; // meters relative to MSL
  rising: boolean;
}

export interface SwellData {
  height: number; // meters
  period: number; // seconds
  direction: number; // degrees, 0=N
}

export interface WindData {
  speed: number; // km/h
  direction: number; // degrees, 0=N
  gusts: number; // km/h
}

export interface WeatherData {
  temp: number; // Celsius
  condition: string; // "clear", "partly_cloudy", "cloudy", "rain", "thunderstorm", "fog"
  precipitation: number; // mm/h
}

export interface AstronomyData {
  sunrise: string; // HH:mm
  sunset: string; // HH:mm
}

export type SurfableRating = "green" | "yellow" | "red";

export interface HourlyData {
  hour: number; // 0-23
  tide: TideData;
  swell: SwellData;
  wind: WindData;
  weather: WeatherData;
  surfable: SurfableRating;
}

export interface ForecastDay {
  date: string; // YYYY-MM-DD
  location: { name: string; lat: number; lng: number };
  astronomy: AstronomyData;
  tideExtremes: TideExtreme[];
  hourly: HourlyData[];
}

export interface ForecastResponse {
  days: ForecastDay[];
  lastFetch: string | null; // ISO timestamp
}

export interface StatusResponse {
  lastFetch: string | null;
  cachedDays: string[];
  stormglassQuota: number | null;
}
```

- [ ] **Step 2: Create config**

Create `/root/surf-pacitan/src/server/config.ts`:

```ts
export const LOCATION = {
  name: "Pacitan",
  lat: -8.22,
  lng: 111.13,
} as const;

export const TIMEZONE = "Asia/Jakarta";

// StormGlass API
export const STORMGLASS_BASE_URL = "https://api.stormglass.io/v2";
export const STORMGLASS_WEATHER_PARAMS = [
  "swellHeight",
  "swellPeriod",
  "swellDirection",
  "windSpeed",
  "windDirection",
  "gust",
  "airTemperature",
  "precipitation",
  "cloudCover",
].join(",");

// Open-Meteo API
export const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";
export const OPEN_METEO_HOURLY_PARAMS = [
  "temperature_2m",
  "precipitation",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "weather_code",
  "cloud_cover",
].join(",");

// Surfable thresholds
export const SURFABLE = {
  // Tide range percentages
  TIDE_GREEN_MIN: 50, // rising tide must be above this %
  TIDE_GREEN_FALLING_MIN: 80, // falling tide still green above this %
  TIDE_YELLOW_MIN: 30, // mid-tide yellow zone
  // Swell (meters)
  SWELL_GREEN_MIN: 0.5,
  SWELL_YELLOW_MIN: 0.3,
  // Wind (km/h)
  WIND_GREEN_MAX: 20,
  WIND_YELLOW_MAX: 30,
} as const;

// Cron intervals
export const WEATHER_FETCH_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
export const TIDE_FETCH_HOUR = 0; // midnight local time

// Redis
export const REDIS_KEY_PREFIX = "surf:forecast:";
export const REDIS_META_KEY = "surf:meta:last_fetch";
export const REDIS_QUOTA_KEY = "surf:meta:stormglass_quota";
export const CACHE_TTL_SECONDS = 4 * 24 * 60 * 60; // 4 days

// Server
export const DEFAULT_PORT = 3100;
export const FORECAST_DAYS = 3;
```

- [ ] **Step 3: Commit types and config**

```bash
cd /root/surf-pacitan
git add src/shared/types.ts src/server/config.ts
git commit -m "feat: add shared types and server config"
```

---

## Task 3: Surfable Window Logic + Tests

**Files:**
- Create: `src/server/surfable.ts`
- Create: `tests/surfable.test.ts`

- [ ] **Step 1: Write surfable tests**

Create `/root/surf-pacitan/tests/surfable.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { computeSurfable } from "../src/server/surfable";

describe("computeSurfable", () => {
  const sunrise = "05:42";
  const sunset = "17:31";

  test("green: rising tide > 50%, good swell, light wind, daylight", () => {
    const result = computeSurfable({
      hour: 9,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.2,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("green");
  });

  test("green: falling tide > 80%, good swell, light wind", () => {
    const result = computeSurfable({
      hour: 11,
      tidePercent: 85,
      tideRising: false,
      swellHeight: 0.8,
      windSpeed: 15,
      sunrise,
      sunset,
    });
    expect(result).toBe("green");
  });

  test("yellow: mid tide 30-50% rising", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 40,
      tideRising: true,
      swellHeight: 0.8,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("yellow");
  });

  test("yellow: good tide but marginal swell 0.3-0.5m", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 0.4,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("yellow");
  });

  test("yellow: good tide/swell but wind 20-30 km/h", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 25,
      sunrise,
      sunset,
    });
    expect(result).toBe("yellow");
  });

  test("red: low tide < 30%", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 15,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("red: flat swell < 0.3m", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 0.2,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("red: blown out wind > 30 km/h", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 35,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("red: outside daylight (before sunrise)", () => {
    const result = computeSurfable({
      hour: 4,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("red: outside daylight (after sunset)", () => {
    const result = computeSurfable({
      hour: 18,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("red: falling tide 50-80% range (not green, not yellow-mid)", () => {
    const result = computeSurfable({
      hour: 12,
      tidePercent: 60,
      tideRising: false,
      swellHeight: 1.0,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("yellow");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /root/surf-pacitan && bun test tests/surfable.test.ts
```

Expected: FAIL — `computeSurfable` not found.

- [ ] **Step 3: Implement surfable logic**

Create `/root/surf-pacitan/src/server/surfable.ts`:

```ts
import type { SurfableRating } from "@shared/types";
import { SURFABLE } from "./config";

interface SurfableInput {
  hour: number;
  tidePercent: number; // 0-100
  tideRising: boolean;
  swellHeight: number; // meters
  windSpeed: number; // km/h
  sunrise: string; // "HH:mm"
  sunset: string; // "HH:mm"
}

function isWithinDaylight(hour: number, sunrise: string, sunset: string): boolean {
  const sunriseHour = parseInt(sunrise.split(":")[0], 10);
  const sunsetHour = parseInt(sunset.split(":")[0], 10);
  return hour >= sunriseHour && hour < sunsetHour;
}

export function computeSurfable(input: SurfableInput): SurfableRating {
  const { hour, tidePercent, tideRising, swellHeight, windSpeed, sunrise, sunset } = input;

  // Red: hard no-go conditions
  if (!isWithinDaylight(hour, sunrise, sunset)) return "red";
  if (swellHeight < SURFABLE.SWELL_YELLOW_MIN) return "red";
  if (windSpeed > SURFABLE.WIND_YELLOW_MAX) return "red";
  if (tidePercent < SURFABLE.TIDE_YELLOW_MIN) return "red";

  // Check if tide is in green zone
  const tideGreen =
    (tideRising && tidePercent >= SURFABLE.TIDE_GREEN_MIN) ||
    (!tideRising && tidePercent >= SURFABLE.TIDE_GREEN_FALLING_MIN);

  const swellGreen = swellHeight >= SURFABLE.SWELL_GREEN_MIN;
  const windGreen = windSpeed < SURFABLE.WIND_GREEN_MAX;

  // Green: all conditions met
  if (tideGreen && swellGreen && windGreen) return "green";

  // Yellow: everything else that passed the red gate
  return "yellow";
}

export function computeTidePercent(
  currentHeight: number,
  dailyMin: number,
  dailyMax: number
): number {
  const range = dailyMax - dailyMin;
  if (range === 0) return 50;
  return ((currentHeight - dailyMin) / range) * 100;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /root/surf-pacitan && bun test tests/surfable.test.ts
```

Expected: all 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /root/surf-pacitan
git add src/server/surfable.ts tests/surfable.test.ts
git commit -m "feat: implement surfable window logic with tests"
```

---

## Task 4: StormGlass API Client + Tests

**Files:**
- Create: `src/server/stormglass.ts`
- Create: `tests/stormglass.test.ts`

- [ ] **Step 1: Write StormGlass parsing tests**

Create `/root/surf-pacitan/tests/stormglass.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import {
  parseTideExtremes,
  parseSeaLevels,
  parseWeather,
  parseAstronomy,
} from "../src/server/stormglass";

describe("parseTideExtremes", () => {
  test("parses high/low tides with timezone conversion", () => {
    const raw = {
      data: [
        { height: 1.18, time: "2026-04-03T20:40:00+00:00", type: "high" },
        { height: -0.32, time: "2026-04-03T02:55:00+00:00", type: "low" },
      ],
    };
    const result = parseTideExtremes(raw, "2026-04-03");
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("high");
    expect(result[0].height).toBe(1.18);
    expect(result[0].time).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("parseSeaLevels", () => {
  test("parses hourly sea level values", () => {
    const raw = {
      data: [
        { sg: 0.62, time: "2026-04-03T00:00:00+00:00" },
        { sg: 0.85, time: "2026-04-03T01:00:00+00:00" },
        { sg: 1.1, time: "2026-04-03T02:00:00+00:00" },
      ],
    };
    const result = parseSeaLevels(raw, "2026-04-03");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]).toHaveProperty("hour");
    expect(result[0]).toHaveProperty("height");
    expect(result[0]).toHaveProperty("rising");
  });

  test("detects rising vs falling tide", () => {
    const raw = {
      data: [
        { sg: 0.5, time: "2026-04-03T00:00:00+00:00" },
        { sg: 0.8, time: "2026-04-03T01:00:00+00:00" },
        { sg: 0.6, time: "2026-04-03T02:00:00+00:00" },
      ],
    };
    const result = parseSeaLevels(raw, "2026-04-03");
    expect(result[0].rising).toBe(true); // 0.5 → 0.8
    expect(result[1].rising).toBe(true); // 0.8 > 0.5
    expect(result[2].rising).toBe(false); // 0.6 < 0.8
  });
});

describe("parseWeather", () => {
  test("parses hourly weather from sg source", () => {
    const raw = {
      hours: [
        {
          time: "2026-04-03T00:00:00+00:00",
          swellHeight: { sg: 1.2 },
          swellPeriod: { sg: 12 },
          swellDirection: { sg: 210 },
          windSpeed: { sg: 2.5 },
          windDirection: { sg: 135 },
          gust: { sg: 4.1 },
          airTemperature: { sg: 28 },
          precipitation: { sg: 0 },
          cloudCover: { sg: 45 },
        },
      ],
    };
    const result = parseWeather(raw, "2026-04-03");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].swell.height).toBe(1.2);
    expect(result[0].swell.period).toBe(12);
    expect(result[0].swell.direction).toBe(210);
    expect(result[0].wind.speed).toBeCloseTo(9, 0); // 2.5 m/s → ~9 km/h
    expect(result[0].wind.gusts).toBeCloseTo(14.76, 0); // 4.1 m/s → ~14.8 km/h
    expect(result[0].weather.temp).toBe(28);
    expect(result[0].weather.precipitation).toBe(0);
  });
});

describe("parseAstronomy", () => {
  test("parses sunrise and sunset", () => {
    const raw = {
      data: [
        {
          time: "2026-04-03T00:00:00+00:00",
          sunrise: "2026-04-02T22:42:00+00:00",
          sunset: "2026-04-03T10:31:00+00:00",
        },
      ],
    };
    const result = parseAstronomy(raw);
    expect(result.sunrise).toMatch(/^\d{2}:\d{2}$/);
    expect(result.sunset).toMatch(/^\d{2}:\d{2}$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /root/surf-pacitan && bun test tests/stormglass.test.ts
```

Expected: FAIL — imports not found.

- [ ] **Step 3: Implement StormGlass client**

Create `/root/surf-pacitan/src/server/stormglass.ts`:

```ts
import type { TideExtreme, SwellData, WindData, WeatherData, AstronomyData } from "@shared/types";
import { STORMGLASS_BASE_URL, STORMGLASS_WEATHER_PARAMS, LOCATION, FORECAST_DAYS } from "./config";

const TIMEZONE_OFFSET_HOURS = 7; // Asia/Jakarta = UTC+7

function toLocalTimeString(isoString: string): string {
  const d = new Date(isoString);
  d.setUTCHours(d.getUTCHours() + TIMEZONE_OFFSET_HOURS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function toLocalHour(isoString: string): number {
  const d = new Date(isoString);
  d.setUTCHours(d.getUTCHours() + TIMEZONE_OFFSET_HOURS);
  return d.getUTCHours();
}

function toLocalDateString(isoString: string): string {
  const d = new Date(isoString);
  d.setUTCHours(d.getUTCHours() + TIMEZONE_OFFSET_HOURS);
  return d.toISOString().slice(0, 10);
}

function getApiKey(): string {
  const key = process.env.STORMGLASS_API_KEY;
  if (!key) throw new Error("STORMGLASS_API_KEY is not set");
  return key;
}

function headers() {
  return { Authorization: getApiKey() };
}

// --- Fetchers ---

export async function fetchTideExtremes(start: Date, end: Date) {
  const url = new URL(`${STORMGLASS_BASE_URL}/tide/extremes/point`);
  url.searchParams.set("lat", String(LOCATION.lat));
  url.searchParams.set("lng", String(LOCATION.lng));
  url.searchParams.set("start", start.toISOString());
  url.searchParams.set("end", end.toISOString());

  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`StormGlass tide extremes: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function fetchSeaLevels(start: Date, end: Date) {
  const url = new URL(`${STORMGLASS_BASE_URL}/tide/sea-level/point`);
  url.searchParams.set("lat", String(LOCATION.lat));
  url.searchParams.set("lng", String(LOCATION.lng));
  url.searchParams.set("start", start.toISOString());
  url.searchParams.set("end", end.toISOString());

  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`StormGlass sea levels: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function fetchWeather(start: Date, end: Date) {
  const url = new URL(`${STORMGLASS_BASE_URL}/weather/point`);
  url.searchParams.set("lat", String(LOCATION.lat));
  url.searchParams.set("lng", String(LOCATION.lng));
  url.searchParams.set("params", STORMGLASS_WEATHER_PARAMS);
  url.searchParams.set("source", "sg");
  url.searchParams.set("start", start.toISOString());
  url.searchParams.set("end", end.toISOString());

  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`StormGlass weather: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function fetchAstronomy(start: Date, end: Date) {
  const url = new URL(`${STORMGLASS_BASE_URL}/astronomy/point`);
  url.searchParams.set("lat", String(LOCATION.lat));
  url.searchParams.set("lng", String(LOCATION.lng));
  url.searchParams.set("start", start.toISOString());
  url.searchParams.set("end", end.toISOString());

  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`StormGlass astronomy: ${res.status} ${await res.text()}`);
  return res.json();
}

// --- Parsers ---

export function parseTideExtremes(raw: any, targetDate: string): TideExtreme[] {
  return (raw.data || [])
    .filter((d: any) => toLocalDateString(d.time) === targetDate)
    .map((d: any) => ({
      time: toLocalTimeString(d.time),
      height: Math.round(d.height * 100) / 100,
      type: d.type as "high" | "low",
    }));
}

interface SeaLevelPoint {
  hour: number;
  height: number;
  rising: boolean;
}

export function parseSeaLevels(raw: any, targetDate: string): SeaLevelPoint[] {
  const allPoints = (raw.data || []).map((d: any) => ({
    hour: toLocalHour(d.time),
    height: d.sg,
    localDate: toLocalDateString(d.time),
  }));

  const dayPoints = allPoints.filter((p: any) => p.localDate === targetDate);

  return dayPoints.map((p: any, i: number) => {
    const prev = i > 0 ? dayPoints[i - 1] : allPoints.find((a: any) => a.localDate < targetDate);
    const rising = prev ? p.height >= prev.height : true;
    return { hour: p.hour, height: p.height, rising };
  });
}

function msToKmh(ms: number): number {
  return Math.round(ms * 3.6 * 100) / 100;
}

function cloudCoverToCondition(cloudCover: number, precipitation: number): string {
  if (precipitation > 5) return "rain";
  if (precipitation > 0) return "light_rain";
  if (cloudCover < 20) return "clear";
  if (cloudCover < 50) return "partly_cloudy";
  if (cloudCover < 80) return "cloudy";
  return "overcast";
}

interface ParsedWeatherHour {
  hour: number;
  swell: SwellData;
  wind: WindData;
  weather: WeatherData;
}

export function parseWeather(raw: any, targetDate: string): ParsedWeatherHour[] {
  return (raw.hours || [])
    .filter((h: any) => toLocalDateString(h.time) === targetDate)
    .map((h: any) => {
      const windSpeedMs = h.windSpeed?.sg ?? 0;
      const gustMs = h.gust?.sg ?? 0;
      const precip = h.precipitation?.sg ?? 0;
      const cloud = h.cloudCover?.sg ?? 0;

      return {
        hour: toLocalHour(h.time),
        swell: {
          height: h.swellHeight?.sg ?? 0,
          period: h.swellPeriod?.sg ?? 0,
          direction: Math.round(h.swellDirection?.sg ?? 0),
        },
        wind: {
          speed: msToKmh(windSpeedMs),
          direction: Math.round(h.windDirection?.sg ?? 0),
          gusts: msToKmh(gustMs),
        },
        weather: {
          temp: Math.round(h.airTemperature?.sg ?? 0),
          condition: cloudCoverToCondition(cloud, precip),
          precipitation: Math.round(precip * 10) / 10,
        },
      };
    });
}

export function parseAstronomy(raw: any): AstronomyData {
  const day = raw.data?.[0];
  if (!day) return { sunrise: "06:00", sunset: "18:00" };
  return {
    sunrise: toLocalTimeString(day.sunrise),
    sunset: toLocalTimeString(day.sunset),
  };
}

export function extractQuota(meta: any): number | null {
  if (meta?.dailyQuota != null && meta?.requestCount != null) {
    return meta.dailyQuota - meta.requestCount;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /root/surf-pacitan && bun test tests/stormglass.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /root/surf-pacitan
git add src/server/stormglass.ts tests/stormglass.test.ts
git commit -m "feat: implement StormGlass API client with parsing and tests"
```

---

## Task 5: Open-Meteo Fallback Client + Tests

**Files:**
- Create: `src/server/open-meteo.ts`
- Create: `tests/open-meteo.test.ts`

- [ ] **Step 1: Write Open-Meteo parsing tests**

Create `/root/surf-pacitan/tests/open-meteo.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { parseOpenMeteoWeather } from "../src/server/open-meteo";

describe("parseOpenMeteoWeather", () => {
  test("parses hourly weather for a target date", () => {
    const raw = {
      hourly: {
        time: [
          "2026-04-03T00:00",
          "2026-04-03T01:00",
          "2026-04-03T02:00",
        ],
        temperature_2m: [27, 26.5, 26],
        precipitation: [0, 0.5, 1.2],
        wind_speed_10m: [8, 12, 15],
        wind_direction_10m: [180, 190, 200],
        wind_gusts_10m: [14, 20, 25],
        weather_code: [0, 61, 80],
        cloud_cover: [20, 70, 90],
      },
    };
    const result = parseOpenMeteoWeather(raw, "2026-04-03");
    expect(result).toHaveLength(3);
    expect(result[0].weather.temp).toBe(27);
    expect(result[0].weather.condition).toBe("clear");
    expect(result[0].wind.speed).toBe(8);
    expect(result[1].weather.condition).toBe("rain");
    expect(result[2].weather.condition).toBe("rain");
  });

  test("maps WMO weather codes to conditions", () => {
    const raw = {
      hourly: {
        time: ["2026-04-03T00:00", "2026-04-03T01:00", "2026-04-03T02:00", "2026-04-03T03:00"],
        temperature_2m: [28, 28, 28, 28],
        precipitation: [0, 0, 0, 0],
        wind_speed_10m: [5, 5, 5, 5],
        wind_direction_10m: [0, 0, 0, 0],
        wind_gusts_10m: [8, 8, 8, 8],
        weather_code: [0, 2, 3, 95],
        cloud_cover: [0, 50, 100, 80],
      },
    };
    const result = parseOpenMeteoWeather(raw, "2026-04-03");
    expect(result[0].weather.condition).toBe("clear");
    expect(result[1].weather.condition).toBe("partly_cloudy");
    expect(result[2].weather.condition).toBe("overcast");
    expect(result[3].weather.condition).toBe("thunderstorm");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /root/surf-pacitan && bun test tests/open-meteo.test.ts
```

Expected: FAIL — imports not found.

- [ ] **Step 3: Implement Open-Meteo client**

Create `/root/surf-pacitan/src/server/open-meteo.ts`:

```ts
import type { WindData, WeatherData } from "@shared/types";
import { OPEN_METEO_BASE_URL, OPEN_METEO_HOURLY_PARAMS, LOCATION, FORECAST_DAYS } from "./config";

function wmoCodeToCondition(code: number): string {
  if (code === 0) return "clear";
  if (code === 1) return "clear";
  if (code === 2) return "partly_cloudy";
  if (code === 3) return "overcast";
  if (code >= 45 && code <= 48) return "fog";
  if (code >= 51 && code <= 55) return "light_rain";
  if (code >= 61 && code <= 65) return "rain";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 95) return "thunderstorm";
  return "cloudy";
}

export async function fetchOpenMeteoWeather() {
  const url = new URL(OPEN_METEO_BASE_URL);
  url.searchParams.set("latitude", String(LOCATION.lat));
  url.searchParams.set("longitude", String(LOCATION.lng));
  url.searchParams.set("hourly", OPEN_METEO_HOURLY_PARAMS);
  url.searchParams.set("timezone", "Asia/Jakarta");
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Open-Meteo: ${res.status} ${await res.text()}`);
  return res.json();
}

interface ParsedOpenMeteoHour {
  hour: number;
  wind: WindData;
  weather: WeatherData;
}

export function parseOpenMeteoWeather(raw: any, targetDate: string): ParsedOpenMeteoHour[] {
  const hourly = raw.hourly;
  if (!hourly?.time) return [];

  const results: ParsedOpenMeteoHour[] = [];

  for (let i = 0; i < hourly.time.length; i++) {
    const timeStr: string = hourly.time[i];
    if (!timeStr.startsWith(targetDate)) continue;

    const hour = parseInt(timeStr.slice(11, 13), 10);

    results.push({
      hour,
      wind: {
        speed: hourly.wind_speed_10m[i] ?? 0,
        direction: hourly.wind_direction_10m[i] ?? 0,
        gusts: hourly.wind_gusts_10m[i] ?? 0,
      },
      weather: {
        temp: Math.round(hourly.temperature_2m[i] ?? 0),
        condition: wmoCodeToCondition(hourly.weather_code[i] ?? 0),
        precipitation: Math.round((hourly.precipitation[i] ?? 0) * 10) / 10,
      },
    });
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /root/surf-pacitan && bun test tests/open-meteo.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /root/surf-pacitan
git add src/server/open-meteo.ts tests/open-meteo.test.ts
git commit -m "feat: implement Open-Meteo fallback client with tests"
```

---

## Task 6: Redis Cache Layer

**Files:**
- Create: `src/server/cache.ts`

- [ ] **Step 1: Implement Redis cache helpers**

Create `/root/surf-pacitan/src/server/cache.ts`:

```ts
import Redis from "ioredis";
import type { ForecastDay } from "@shared/types";
import { REDIS_KEY_PREFIX, REDIS_META_KEY, REDIS_QUOTA_KEY, CACHE_TTL_SECONDS } from "./config";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

export async function getCachedDay(date: string): Promise<ForecastDay | null> {
  const raw = await redis.get(`${REDIS_KEY_PREFIX}${date}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function getCachedDays(dates: string[]): Promise<(ForecastDay | null)[]> {
  if (dates.length === 0) return [];
  const keys = dates.map((d) => `${REDIS_KEY_PREFIX}${d}`);
  const values = await redis.mget(...keys);
  return values.map((v) => (v ? JSON.parse(v) : null));
}

export async function setCachedDay(day: ForecastDay): Promise<void> {
  const key = `${REDIS_KEY_PREFIX}${day.date}`;
  await redis.set(key, JSON.stringify(day), "EX", CACHE_TTL_SECONDS);
}

export async function setLastFetch(timestamp: string): Promise<void> {
  await redis.set(REDIS_META_KEY, timestamp);
}

export async function getLastFetch(): Promise<string | null> {
  return redis.get(REDIS_META_KEY);
}

export async function setQuotaRemaining(quota: number): Promise<void> {
  await redis.set(REDIS_QUOTA_KEY, String(quota), "EX", 24 * 60 * 60);
}

export async function getQuotaRemaining(): Promise<number | null> {
  const val = await redis.get(REDIS_QUOTA_KEY);
  return val != null ? parseInt(val, 10) : null;
}

export async function getCachedDateList(): Promise<string[]> {
  const keys = await redis.keys(`${REDIS_KEY_PREFIX}*`);
  return keys.map((k) => k.replace(REDIS_KEY_PREFIX, "")).sort();
}

export { redis };
```

- [ ] **Step 2: Commit**

```bash
cd /root/surf-pacitan
git add src/server/cache.ts
git commit -m "feat: implement Redis cache layer"
```

---

## Task 7: Forecast Fetch & Assembly (Cron Logic)

**Files:**
- Create: `src/server/cron.ts`

- [ ] **Step 1: Implement cron / fetch orchestration**

Create `/root/surf-pacitan/src/server/cron.ts`:

```ts
import type { ForecastDay, HourlyData } from "@shared/types";
import {
  fetchTideExtremes,
  fetchSeaLevels,
  fetchWeather,
  fetchAstronomy,
  parseTideExtremes,
  parseSeaLevels,
  parseWeather,
  parseAstronomy,
  extractQuota,
} from "./stormglass";
import { fetchOpenMeteoWeather, parseOpenMeteoWeather } from "./open-meteo";
import { setCachedDay, setLastFetch, setQuotaRemaining } from "./cache";
import { computeSurfable, computeTidePercent } from "./surfable";
import { LOCATION, FORECAST_DAYS, WEATHER_FETCH_INTERVAL_MS } from "./config";

function getDateRange(): { start: Date; end: Date; dates: string[] } {
  const now = new Date();
  // Start of today in UTC (we'll handle timezone in parsers)
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + FORECAST_DAYS * 24 * 60 * 60 * 1000);

  const dates: string[] = [];
  for (let i = 0; i < FORECAST_DAYS; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    dates.push(d.toISOString().slice(0, 10));
  }

  return { start, end, dates };
}

export async function fetchAndCacheTides(): Promise<void> {
  const { start, end, dates } = getDateRange();
  console.log(`[cron] Fetching tides for ${dates.join(", ")}`);

  try {
    const [extremesRaw, seaLevelsRaw, astronomyRaw] = await Promise.all([
      fetchTideExtremes(start, end),
      fetchSeaLevels(start, end),
      fetchAstronomy(start, end),
    ]);

    // Store quota info from any response meta
    const quota = extractQuota(extremesRaw.meta);
    if (quota != null) await setQuotaRemaining(quota);

    // Parse per day and update cache
    for (const date of dates) {
      const tideExtremes = parseTideExtremes(extremesRaw, date);
      const seaLevels = parseSeaLevels(seaLevelsRaw, date);

      // Find astronomy for this date
      const astroForDay = astronomyRaw.data?.find((_: any, i: number) => {
        const d = new Date(astronomyRaw.data[i].time);
        return d.toISOString().slice(0, 10) === date || i === 0;
      });
      const astronomy = parseAstronomy({ data: astroForDay ? [astroForDay] : astronomyRaw.data });

      // Build partial day (tide-only, weather gets merged in fetchAndCacheWeather)
      const existingDay: ForecastDay = {
        date,
        location: { ...LOCATION },
        astronomy,
        tideExtremes,
        hourly: seaLevels.map((sl) => ({
          hour: sl.hour,
          tide: { height: sl.height, rising: sl.rising },
          swell: { height: 0, period: 0, direction: 0 },
          wind: { speed: 0, direction: 0, gusts: 0 },
          weather: { temp: 0, condition: "clear", precipitation: 0 },
          surfable: "red" as const,
        })),
      };

      await setCachedDay(existingDay);
    }

    await setLastFetch(new Date().toISOString());
    console.log(`[cron] Tides cached for ${dates.join(", ")}`);
  } catch (err) {
    console.error(`[cron] Tide fetch failed:`, err);
  }
}

export async function fetchAndCacheWeather(): Promise<void> {
  const { start, end, dates } = getDateRange();
  console.log(`[cron] Fetching weather for ${dates.join(", ")}`);

  let weatherByDate: Map<string, ReturnType<typeof parseWeather>> = new Map();
  let usedFallback = false;

  try {
    const weatherRaw = await fetchWeather(start, end);
    const quota = extractQuota(weatherRaw.meta);
    if (quota != null) await setQuotaRemaining(quota);

    for (const date of dates) {
      weatherByDate.set(date, parseWeather(weatherRaw, date));
    }
  } catch (err) {
    console.warn(`[cron] StormGlass weather failed, trying Open-Meteo fallback:`, err);
    usedFallback = true;

    try {
      const fallbackRaw = await fetchOpenMeteoWeather();
      for (const date of dates) {
        const parsed = parseOpenMeteoWeather(fallbackRaw, date);
        // Open-Meteo doesn't have swell data, so we map to the same shape with zero swell
        weatherByDate.set(
          date,
          parsed.map((p) => ({
            hour: p.hour,
            swell: { height: 0, period: 0, direction: 0 },
            wind: p.wind,
            weather: p.weather,
          }))
        );
      }
    } catch (fallbackErr) {
      console.error(`[cron] Open-Meteo fallback also failed:`, fallbackErr);
      return;
    }
  }

  // Merge weather into existing cached days (which have tide data)
  const { getCachedDay } = await import("./cache");

  for (const date of dates) {
    const cached = await getCachedDay(date);
    if (!cached) {
      console.warn(`[cron] No cached tide data for ${date}, skipping weather merge`);
      continue;
    }

    const weatherHours = weatherByDate.get(date) || [];

    // Find daily min/max tide height for surfable calculation
    const tideHeights = cached.hourly.map((h) => h.tide.height);
    const dailyMin = Math.min(...tideHeights);
    const dailyMax = Math.max(...tideHeights);

    // Merge weather into hourly data
    for (const hourData of cached.hourly) {
      const wx = weatherHours.find((w) => w.hour === hourData.hour);
      if (wx) {
        hourData.swell = wx.swell;
        hourData.wind = wx.wind;
        hourData.weather = wx.weather;
      }

      // Recompute surfable rating
      const tidePercent = computeTidePercent(hourData.tide.height, dailyMin, dailyMax);
      hourData.surfable = computeSurfable({
        hour: hourData.hour,
        tidePercent,
        tideRising: hourData.tide.rising,
        swellHeight: hourData.swell.height,
        windSpeed: hourData.wind.speed,
        sunrise: cached.astronomy.sunrise,
        sunset: cached.astronomy.sunset,
      });
    }

    await setCachedDay(cached);
  }

  await setLastFetch(new Date().toISOString());
  console.log(`[cron] Weather cached for ${dates.join(", ")}${usedFallback ? " (Open-Meteo fallback)" : ""}`);
}

export function startScheduler() {
  console.log("[cron] Starting scheduler");

  // Initial fetch on startup
  fetchAndCacheTides().then(() => fetchAndCacheWeather());

  // Weather every 3 hours
  setInterval(() => {
    fetchAndCacheWeather();
  }, WEATHER_FETCH_INTERVAL_MS);

  // Tides once per day at midnight local (UTC+7 = 17:00 UTC)
  const scheduleNextTideFetch = () => {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 17, 0, 0));
    const delay = next.getTime() - now.getTime();
    setTimeout(() => {
      fetchAndCacheTides().then(() => fetchAndCacheWeather());
      scheduleNextTideFetch();
    }, delay);
    console.log(`[cron] Next tide fetch in ${Math.round(delay / 1000 / 60)} minutes`);
  };
  scheduleNextTideFetch();
}
```

- [ ] **Step 2: Commit**

```bash
cd /root/surf-pacitan
git add src/server/cron.ts
git commit -m "feat: implement forecast fetch scheduler with StormGlass + Open-Meteo fallback"
```

---

## Task 8: Hono API Server + Routes

**Files:**
- Create: `src/server/routes.ts`
- Create: `src/server/index.ts`

- [ ] **Step 1: Implement API routes**

Create `/root/surf-pacitan/src/server/routes.ts`:

```ts
import { Hono } from "hono";
import type { ForecastResponse, StatusResponse } from "@shared/types";
import { getCachedDays, getCachedDay, getLastFetch, getCachedDateList, getQuotaRemaining } from "./cache";
import { fetchAndCacheTides, fetchAndCacheWeather } from "./cron";
import { FORECAST_DAYS } from "./config";

const api = new Hono();

function getForecastDates(): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < FORECAST_DAYS; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

api.get("/api/forecast", async (c) => {
  const dates = getForecastDates();
  const days = await getCachedDays(dates);
  const lastFetch = await getLastFetch();

  const response: ForecastResponse = {
    days: days.filter((d): d is NonNullable<typeof d> => d !== null),
    lastFetch,
  };

  return c.json(response);
});

api.get("/api/forecast/:date", async (c) => {
  const date = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: "Invalid date format. Use YYYY-MM-DD" }, 400);
  }

  const day = await getCachedDay(date);
  if (!day) {
    return c.json({ error: "No data for this date" }, 404);
  }

  return c.json(day);
});

api.get("/api/status", async (c) => {
  const lastFetch = await getLastFetch();
  const cachedDays = await getCachedDateList();
  const stormglassQuota = await getQuotaRemaining();

  const response: StatusResponse = {
    lastFetch,
    cachedDays,
    stormglassQuota,
  };

  return c.json(response);
});

api.post("/api/refresh", async (c) => {
  try {
    await fetchAndCacheTides();
    await fetchAndCacheWeather();
    return c.json({ ok: true, message: "Forecast refreshed" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export { api };
```

- [ ] **Step 2: Implement server entry**

Create `/root/surf-pacitan/src/server/index.ts`:

```ts
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { api } from "./routes";
import { startScheduler } from "./cron";
import { DEFAULT_PORT } from "./config";

const app = new Hono();

app.use("*", cors());
app.route("/", api);

// In production, serve static files (Vite build output)
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "/var/www/surf-pacitan" }));
  app.get("*", serveStatic({ path: "/var/www/surf-pacitan/index.html" }));
}

const port = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

// Start the cron scheduler
startScheduler();

export default {
  port,
  fetch: app.fetch,
};

console.log(`[server] Surf Pacitan API running on :${port}`);
```

- [ ] **Step 3: Smoke test — start server**

```bash
cd /root/surf-pacitan && PORT=3100 STORMGLASS_API_KEY=test bun run src/server/index.ts &
sleep 2
curl -s http://localhost:3100/api/status | head -5
kill %1 2>/dev/null
```

Expected: JSON response with `lastFetch`, `cachedDays`, `stormglassQuota` (values may be null since API key is fake).

- [ ] **Step 4: Commit**

```bash
cd /root/surf-pacitan
git add src/server/routes.ts src/server/index.ts
git commit -m "feat: implement Hono API server with routes and scheduler"
```

---

## Task 9: React Frontend — Shell & Data Hook

**Files:**
- Create: `src/client/main.tsx`
- Create: `src/client/hooks/useForecast.ts`
- Create: `src/client/styles/global.css`
- Create: `src/client/App.tsx`

- [ ] **Step 1: Create React entry**

Create `/root/surf-pacitan/src/client/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 2: Create global styles**

Create `/root/surf-pacitan/src/client/styles/global.css`:

```css
:root {
  --bg: #0f172a;
  --bg-card: #1e293b;
  --text: #f1f5f9;
  --text-dim: #94a3b8;
  --green: #22c55e;
  --green-bg: rgba(34, 197, 94, 0.15);
  --yellow: #eab308;
  --yellow-bg: rgba(234, 179, 8, 0.15);
  --red: #ef4444;
  --red-bg: rgba(239, 68, 68, 0.15);
  --blue: #3b82f6;
  --border: #334155;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

#root {
  max-width: 480px;
  margin: 0 auto;
  min-height: 100dvh;
}
```

- [ ] **Step 3: Create data fetching hook**

Create `/root/surf-pacitan/src/client/hooks/useForecast.ts`:

```ts
import { useState, useEffect, useCallback } from "react";
import type { ForecastResponse, ForecastDay } from "@shared/types";

export function useForecast() {
  const [days, setDays] = useState<ForecastDay[]>([]);
  const [lastFetch, setLastFetch] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/forecast");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ForecastResponse = await res.json();
      setDays(data.days);
      setLastFetch(data.lastFetch);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await fetch("/api/refresh", { method: "POST" });
      await fetchData();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }, [fetchData]);

  useEffect(() => {
    fetchData();
    // Refetch every 30 minutes
    const interval = setInterval(fetchData, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { days, lastFetch, loading, error, refresh };
}
```

- [ ] **Step 4: Create App shell**

Create `/root/surf-pacitan/src/client/App.tsx`:

```tsx
import { useState, useRef, TouchEvent } from "react";
import { useForecast } from "./hooks/useForecast";
import { Header } from "./components/Header";
import { DayView } from "./components/DayView";

export function App() {
  const { days, lastFetch, loading, error, refresh } = useForecast();
  const [dayIndex, setDayIndex] = useState(0);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const handleTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50;

    if (diff > threshold && dayIndex < days.length - 1) {
      setDayIndex((i) => i + 1);
    } else if (diff < -threshold && dayIndex > 0) {
      setDayIndex((i) => i - 1);
    }
  };

  if (loading && days.length === 0) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100dvh" }}>
        <p style={{ color: "var(--text-dim)" }}>Loading forecast...</p>
      </div>
    );
  }

  if (error && days.length === 0) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100dvh", flexDirection: "column", gap: "1rem" }}>
        <p style={{ color: "var(--red)" }}>Failed to load: {error}</p>
        <button onClick={refresh} style={{ padding: "0.5rem 1rem", background: "var(--blue)", color: "white", border: "none", borderRadius: "0.5rem" }}>
          Retry
        </button>
      </div>
    );
  }

  const currentDay = days[dayIndex];
  if (!currentDay) return null;

  const dayLabel = (date: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (date === today) return "Today";
    if (date === tomorrow) return "Tomorrow";
    return new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <Header lastFetch={lastFetch} onRefresh={refresh} />
      <nav style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "0.75rem 1rem",
        borderBottom: "1px solid var(--border)",
      }}>
        <button
          onClick={() => setDayIndex((i) => Math.max(0, i - 1))}
          disabled={dayIndex === 0}
          style={{ background: "none", border: "none", color: dayIndex === 0 ? "var(--border)" : "var(--text)", fontSize: "1.25rem", cursor: "pointer" }}
        >
          ◀
        </button>
        <span style={{ fontWeight: 600 }}>
          {dayLabel(currentDay.date)}, {new Date(currentDay.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
        <button
          onClick={() => setDayIndex((i) => Math.min(days.length - 1, i + 1))}
          disabled={dayIndex === days.length - 1}
          style={{ background: "none", border: "none", color: dayIndex === days.length - 1 ? "var(--border)" : "var(--text)", fontSize: "1.25rem", cursor: "pointer" }}
        >
          ▶
        </button>
      </nav>
      <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", padding: "0.5rem 0" }}>
        {days.map((_, i) => (
          <div
            key={i}
            onClick={() => setDayIndex(i)}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: i === dayIndex ? "var(--blue)" : "var(--border)",
              cursor: "pointer",
            }}
          />
        ))}
      </div>
      <DayView day={currentDay} />
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
cd /root/surf-pacitan
git add src/client/main.tsx src/client/styles/global.css src/client/hooks/useForecast.ts src/client/App.tsx
git commit -m "feat: add React shell with swipe navigation and data hook"
```

---

## Task 10: Frontend Components — Header, Conditions, Weather

**Files:**
- Create: `src/client/components/Header.tsx`
- Create: `src/client/components/Conditions.tsx`
- Create: `src/client/components/Weather.tsx`

- [ ] **Step 1: Create Header component**

Create `/root/surf-pacitan/src/client/components/Header.tsx`:

```tsx
interface HeaderProps {
  lastFetch: string | null;
  onRefresh: () => void;
}

export function Header({ lastFetch, onRefresh }: HeaderProps) {
  const formatTime = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  return (
    <header style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "1rem",
      borderBottom: "1px solid var(--border)",
    }}>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>Surf Pacitan</h1>
      <button
        onClick={onRefresh}
        style={{
          background: "none",
          border: "1px solid var(--border)",
          color: "var(--text-dim)",
          padding: "0.25rem 0.75rem",
          borderRadius: "0.375rem",
          fontSize: "0.75rem",
          cursor: "pointer",
        }}
        title={`Last updated: ${formatTime(lastFetch)}`}
      >
        {formatTime(lastFetch)}
      </button>
    </header>
  );
}
```

- [ ] **Step 2: Create Conditions component**

Create `/root/surf-pacitan/src/client/components/Conditions.tsx`:

```tsx
import type { SwellData, WindData } from "@shared/types";

interface ConditionsProps {
  swell: SwellData;
  wind: WindData;
}

function degToCompass(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

export function Conditions({ swell, wind }: ConditionsProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "1rem",
      padding: "1rem",
      borderBottom: "1px solid var(--border)",
    }}>
      <div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.75rem", marginBottom: "0.25rem" }}>Swell</div>
        <div style={{ fontSize: "1.125rem", fontWeight: 600 }}>
          {swell.height.toFixed(1)}m
          <span style={{ color: "var(--text-dim)", fontSize: "0.875rem", fontWeight: 400 }}> @ {Math.round(swell.period)}s</span>
        </div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.75rem" }}>
          {degToCompass(swell.direction)} ({Math.round(swell.direction)}°)
        </div>
      </div>
      <div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.75rem", marginBottom: "0.25rem" }}>Wind</div>
        <div style={{ fontSize: "1.125rem", fontWeight: 600 }}>
          {Math.round(wind.speed)} km/h
          <span style={{ color: "var(--text-dim)", fontSize: "0.875rem", fontWeight: 400 }}> {degToCompass(wind.direction)}</span>
        </div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.75rem" }}>
          Gusts {Math.round(wind.gusts)} km/h
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create Weather component**

Create `/root/surf-pacitan/src/client/components/Weather.tsx`:

```tsx
import type { WeatherData } from "@shared/types";

interface WeatherProps {
  weather: WeatherData;
}

const conditionLabels: Record<string, string> = {
  clear: "Clear",
  partly_cloudy: "Partly Cloudy",
  cloudy: "Cloudy",
  overcast: "Overcast",
  fog: "Fog",
  light_rain: "Light Rain",
  rain: "Rain",
  thunderstorm: "Thunderstorm",
};

export function Weather({ weather }: WeatherProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: "1rem",
      padding: "1rem",
    }}>
      <div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.75rem" }}>Temp</div>
        <div style={{ fontSize: "1.125rem", fontWeight: 600 }}>{weather.temp}°C</div>
      </div>
      <div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.75rem" }}>Condition</div>
        <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>{conditionLabels[weather.condition] || weather.condition}</div>
      </div>
      <div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.75rem" }}>Rain</div>
        <div style={{ fontSize: "1.125rem", fontWeight: 600 }}>{weather.precipitation} mm</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
cd /root/surf-pacitan
git add src/client/components/Header.tsx src/client/components/Conditions.tsx src/client/components/Weather.tsx
git commit -m "feat: add Header, Conditions, and Weather components"
```

---

## Task 11: Tide Graph Component (uPlot)

**Files:**
- Create: `src/client/components/TideGraph.tsx`

- [ ] **Step 1: Create TideGraph component**

Create `/root/surf-pacitan/src/client/components/TideGraph.tsx`:

```tsx
import { useRef, useEffect, useMemo } from "react";
import type { HourlyData, TideExtreme, AstronomyData } from "@shared/types";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface TideGraphProps {
  hourly: HourlyData[];
  tideExtremes: TideExtreme[];
  astronomy: AstronomyData;
  isToday: boolean;
}

function getColorForRating(rating: string): string {
  switch (rating) {
    case "green": return "rgba(34, 197, 94, 0.25)";
    case "yellow": return "rgba(234, 179, 8, 0.2)";
    default: return "rgba(100, 116, 139, 0.08)";
  }
}

export function TideGraph({ hourly, tideExtremes, astronomy, isToday }: TideGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);

  const { times, heights, colors } = useMemo(() => {
    const t: number[] = [];
    const h: number[] = [];
    const c: string[] = [];

    for (const entry of hourly) {
      // Unix timestamp for the hour (we use a fake date, only hours matter for display)
      t.push(entry.hour * 3600);
      h.push(entry.tide.height);
      c.push(getColorForRating(entry.surfable));
    }

    return { times: t, heights: h, colors: c };
  }, [hourly]);

  useEffect(() => {
    if (!containerRef.current || times.length === 0) return;

    const width = containerRef.current.clientWidth;
    const height = Math.min(width * 0.65, 320);

    // Now marker (hour position)
    const nowHour = new Date().getHours();

    const opts: uPlot.Options = {
      width,
      height,
      padding: [16, 8, 0, 8],
      cursor: {
        x: true,
        y: false,
      },
      legend: { show: false },
      scales: {
        x: {
          time: false,
          min: 0,
          max: 23 * 3600,
        },
        y: {
          auto: true,
        },
      },
      axes: [
        {
          values: (_, ticks) =>
            ticks.map((t) => {
              const h = Math.floor(t / 3600);
              return `${h}:00`;
            }),
          stroke: "#94a3b8",
          grid: { stroke: "rgba(148, 163, 184, 0.1)" },
          ticks: { stroke: "rgba(148, 163, 184, 0.2)" },
          gap: 4,
          size: 32,
          font: "11px system-ui",
        },
        {
          stroke: "#94a3b8",
          grid: { stroke: "rgba(148, 163, 184, 0.1)" },
          ticks: { stroke: "rgba(148, 163, 184, 0.2)" },
          size: 40,
          font: "11px system-ui",
          values: (_, ticks) => ticks.map((v) => v.toFixed(1) + "m"),
        },
      ],
      series: [
        {},
        {
          stroke: "#3b82f6",
          width: 2,
          fill: "rgba(59, 130, 246, 0.08)",
        },
      ],
      hooks: {
        draw: [
          (u) => {
            const ctx = u.ctx;

            // Draw surfable zones as background bands
            for (let i = 0; i < colors.length; i++) {
              const x0 = u.valToPos(times[i] - 1800, "x", true);
              const x1 = u.valToPos(times[i] + 1800, "x", true);
              const y0 = u.valToPos(u.scales.y.max!, "y", true);
              const y1 = u.valToPos(u.scales.y.min!, "y", true);

              ctx.fillStyle = colors[i];
              ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
            }

            // Draw "now" marker
            if (isToday) {
              const nowX = u.valToPos(nowHour * 3600, "x", true);
              const y0 = u.valToPos(u.scales.y.max!, "y", true);
              const y1 = u.valToPos(u.scales.y.min!, "y", true);

              ctx.strokeStyle = "#f1f5f9";
              ctx.lineWidth = 1.5;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(nowX, y0);
              ctx.lineTo(nowX, y1);
              ctx.stroke();
              ctx.setLineDash([]);
            }

            // Draw H/L labels on extremes
            for (const ext of tideExtremes) {
              const [hStr, mStr] = ext.time.split(":");
              const extSec = parseInt(hStr) * 3600 + parseInt(mStr) * 60;
              const x = u.valToPos(extSec, "x", true);
              const y = u.valToPos(ext.height, "y", true);

              ctx.fillStyle = ext.type === "high" ? "#22c55e" : "#ef4444";
              ctx.font = "bold 11px system-ui";
              ctx.textAlign = "center";
              ctx.fillText(
                `${ext.type === "high" ? "H" : "L"} ${ext.height.toFixed(1)}m`,
                x,
                ext.type === "high" ? y - 8 : y + 16
              );
            }
          },
        ],
      },
    };

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    chartRef.current = new uPlot(opts, [new Float64Array(times), new Float64Array(heights)], containerRef.current);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [times, heights, colors, tideExtremes, isToday]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        const w = containerRef.current.clientWidth;
        const h = Math.min(w * 0.65, 320);
        chartRef.current.setSize({ width: w, height: h });
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div style={{ padding: "0.5rem 0" }}>
      <div ref={containerRef} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /root/surf-pacitan
git add src/client/components/TideGraph.tsx
git commit -m "feat: add TideGraph component with uPlot and surfable zone overlays"
```

---

## Task 12: DayView Component (Assembly)

**Files:**
- Create: `src/client/components/DayView.tsx`

- [ ] **Step 1: Create DayView component**

Create `/root/surf-pacitan/src/client/components/DayView.tsx`:

```tsx
import type { ForecastDay } from "@shared/types";
import { TideGraph } from "./TideGraph";
import { Conditions } from "./Conditions";
import { Weather } from "./Weather";

interface DayViewProps {
  day: ForecastDay;
}

export function DayView({ day }: DayViewProps) {
  const today = new Date().toISOString().slice(0, 10);
  const isToday = day.date === today;
  const currentHour = new Date().getHours();

  // Find the hourly entry closest to now (or midday for future days)
  const targetHour = isToday ? currentHour : 12;
  const currentEntry = day.hourly.reduce((closest, entry) =>
    Math.abs(entry.hour - targetHour) < Math.abs(closest.hour - targetHour) ? entry : closest
  , day.hourly[0]);

  if (!currentEntry) return null;

  return (
    <div>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "0.5rem 1rem",
        fontSize: "0.8rem",
        color: "var(--text-dim)",
        borderBottom: "1px solid var(--border)",
      }}>
        <span>Sunrise {day.astronomy.sunrise}</span>
        <span>Sunset {day.astronomy.sunset}</span>
      </div>

      <TideGraph
        hourly={day.hourly}
        tideExtremes={day.tideExtremes}
        astronomy={day.astronomy}
        isToday={isToday}
      />

      <Conditions swell={currentEntry.swell} wind={currentEntry.wind} />
      <Weather weather={currentEntry.weather} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /root/surf-pacitan
git add src/client/components/DayView.tsx
git commit -m "feat: add DayView component assembling graph and conditions"
```

---

## Task 13: Build & Verify Frontend

- [ ] **Step 1: Run Vite build**

```bash
cd /root/surf-pacitan && bun run build
```

Expected: successful build, output to `/var/www/surf-pacitan/`.

- [ ] **Step 2: Verify build output**

```bash
ls -la /var/www/surf-pacitan/
```

Expected: `index.html`, `assets/` directory with JS/CSS bundles.

- [ ] **Step 3: Fix any TypeScript or build errors**

If the build fails, fix errors and re-run. Common issues:
- Path alias resolution: check `vite.config.ts` resolve.alias
- Missing types: check imports from `@shared/types`

- [ ] **Step 4: Run all tests**

```bash
cd /root/surf-pacitan && bun test
```

Expected: all tests pass.

- [ ] **Step 5: Commit build config if any fixes were needed**

```bash
cd /root/surf-pacitan
git add -A
git commit -m "fix: resolve build issues"
```

(Skip if no fixes were needed.)

---

## Task 14: Deployment — systemd + nginx

**Files:**
- Create: `/etc/systemd/system/surf-pacitan.service`
- Create: `/etc/nginx/sites-enabled/surf-pacitan.conf`

- [ ] **Step 1: Create systemd service**

Create `/etc/systemd/system/surf-pacitan.service`:

```ini
[Unit]
Description=Surf Pacitan API
After=network.target redis.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/surf-pacitan
Environment="PORT=3100"
Environment="NODE_ENV=production"
Environment="STORMGLASS_API_KEY=<REPLACE_WITH_ACTUAL_KEY>"
ExecStart=/root/.bun/bin/bun run /root/surf-pacitan/src/server/index.ts
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**IMPORTANT:** Replace `<REPLACE_WITH_ACTUAL_KEY>` with the actual StormGlass API key. Ask the user for the key before proceeding.

- [ ] **Step 2: Create nginx config**

Create `/etc/nginx/sites-enabled/surf-pacitan.conf`:

```nginx
server {
  listen 80;
  server_name surf-pacitan.yolo-goldgrube.pp.ua;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name surf-pacitan.yolo-goldgrube.pp.ua;

  ssl_certificate     /etc/ssl/yolo-cert.pem;
  ssl_certificate_key /etc/ssl/yolo-key.pem;

  root /var/www/surf-pacitan;
  index index.html;

  # API proxy
  location /api {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Hashed assets: cache forever
  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  # SPA fallback
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

- [ ] **Step 3: Test nginx config**

```bash
nginx -t
```

Expected: `syntax is ok`, `test is successful`.

- [ ] **Step 4: Reload nginx and start service**

```bash
systemctl daemon-reload
systemctl enable surf-pacitan.service
systemctl start surf-pacitan.service
systemctl reload nginx
```

- [ ] **Step 5: Verify service is running**

```bash
systemctl status surf-pacitan.service
curl -s http://localhost:3100/api/status
```

Expected: service active, API responding with JSON.

- [ ] **Step 6: Verify HTTPS endpoint**

```bash
curl -s https://surf-pacitan.yolo-goldgrube.pp.ua/api/status
```

Expected: JSON response via HTTPS.

- [ ] **Step 7: Commit deployment configs**

```bash
cd /root/surf-pacitan
git add -A
git commit -m "feat: add deployment configs (systemd + nginx)"
```

---

## Task 15: DNS Setup

- [ ] **Step 1: Check if DNS record exists**

```bash
dig surf-pacitan.yolo-goldgrube.pp.ua +short
```

- [ ] **Step 2: Add DNS record if needed**

If no record exists, add an A record pointing `surf-pacitan.yolo-goldgrube.pp.ua` to the server IP. The method depends on the DNS provider (DuckDNS/Cloudflare/etc.) — ask the user for the correct approach.

---

## Task 16: End-to-End Smoke Test

- [ ] **Step 1: Verify API has data**

```bash
curl -s http://localhost:3100/api/forecast | python3 -m json.tool | head -30
```

Expected: JSON with `days` array containing forecast data.

- [ ] **Step 2: Verify frontend loads**

```bash
curl -s https://surf-pacitan.yolo-goldgrube.pp.ua/ | head -5
```

Expected: HTML with `<div id="root">`.

- [ ] **Step 3: Check logs for errors**

```bash
journalctl -u surf-pacitan.service --no-pager -n 50
```

Expected: startup logs, cron fetch logs, no errors.

- [ ] **Step 4: Verify StormGlass quota is not exhausted**

```bash
curl -s http://localhost:3100/api/status
```

Expected: `stormglassQuota` shows remaining requests.

- [ ] **Step 5: Final commit — update CLAUDE.md with service info**

Add the service to the server's CLAUDE.md services table and commit.
