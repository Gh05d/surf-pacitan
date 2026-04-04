# Open-Meteo Marine API for Swell Data

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace StormGlass as the swell/weather source with Open-Meteo (Marine API for swell, Weather API for wind/temp), keeping StormGlass only for tide data (1 request/day). This eliminates the 10 req/day quota problem.

**Architecture:** Add `fetchOpenMeteoMarine()` + `parseOpenMeteoMarine()` to `open-meteo.ts`. Simplify `cron.ts` to fetch swell from Open-Meteo Marine, weather from Open-Meteo Weather, and only tides from StormGlass. Remove StormGlass weather fetching entirely. Clean up unused config/code.

**Tech Stack:** Open-Meteo Marine API (`marine-api.open-meteo.com/v1/marine`), Open-Meteo Weather API (existing)

---

## File Map

```
Modified files:
├── src/server/config.ts           # Add marine API URL + params, remove StormGlass weather config
├── src/server/open-meteo.ts       # Add marine fetch+parse, update weather parse to include swell
├── src/server/cron.ts             # Simplify: Open-Meteo for swell+weather, StormGlass for tides only
├── tests/open-meteo.test.ts       # Add marine parser tests
├── CLAUDE.md                      # Update data source docs
```

---

## Task 1: Config — Add Marine API Constants, Clean Up StormGlass Weather Config

**Files:**
- Modify: `src/server/config.ts`

- [ ] **Step 1: Update config.ts**

In `/root/surf-pacitan/src/server/config.ts`:

Add after `OPEN_METEO_HOURLY_PARAMS`:

```ts
// Open-Meteo Marine API
export const OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
export const OPEN_METEO_MARINE_PARAMS = [
  "swell_wave_height",
  "swell_wave_period",
  "swell_wave_direction",
].join(",");
```

Remove `LOCATION_OFFSHORE` (no longer needed):

```ts
// DELETE these lines:
// Offshore point for swell/weather data — StormGlass weather endpoint
// returns 0 hours for coastal coordinates, needs an ocean point
export const LOCATION_OFFSHORE = {
  lat: -8.5,
  lng: 111.1,
} as const;
```

Remove `STORMGLASS_WEATHER_PARAMS` (no longer needed):

```ts
// DELETE these lines:
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
```

- [ ] **Step 2: Commit**

```bash
git add src/server/config.ts
git commit -m "feat: add Open-Meteo Marine API config, remove unused StormGlass weather config"
```

---

## Task 2: Open-Meteo — Add Marine Fetch + Parse + Tests

**Files:**
- Modify: `src/server/open-meteo.ts`
- Modify: `tests/open-meteo.test.ts`

- [ ] **Step 1: Add marine tests**

Append to `/root/surf-pacitan/tests/open-meteo.test.ts`:

```ts
import { parseOpenMeteoMarine } from "../src/server/open-meteo";

describe("parseOpenMeteoMarine", () => {
  test("parses hourly swell data for a target date", () => {
    const raw = {
      hourly: {
        time: ["2026-04-04T00:00", "2026-04-04T01:00", "2026-04-04T02:00"],
        swell_wave_height: [1.08, 1.1, 1.15],
        swell_wave_period: [7.85, 8.2, 8.5],
        swell_wave_direction: [198, 200, 201],
      },
    };
    const result = parseOpenMeteoMarine(raw, "2026-04-04");
    expect(result).toHaveLength(3);
    expect(result[0].height).toBe(1.08);
    expect(result[0].period).toBe(7.85);
    expect(result[0].direction).toBe(198);
    expect(result[1].height).toBe(1.1);
  });

  test("filters by target date", () => {
    const raw = {
      hourly: {
        time: ["2026-04-04T12:00", "2026-04-05T00:00"],
        swell_wave_height: [1.0, 0.8],
        swell_wave_period: [10, 9],
        swell_wave_direction: [200, 190],
      },
    };
    const result = parseOpenMeteoMarine(raw, "2026-04-04");
    expect(result).toHaveLength(1);
    expect(result[0].hour).toBe(12);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /root/surf-pacitan && bun test tests/open-meteo.test.ts
```

Expected: FAIL — `parseOpenMeteoMarine` not found.

- [ ] **Step 3: Add marine fetch + parse to open-meteo.ts**

Add to imports at top of `/root/surf-pacitan/src/server/open-meteo.ts`:

```ts
import type { SwellData, WindData, WeatherData } from "../shared/types";
import {
  OPEN_METEO_BASE_URL,
  OPEN_METEO_HOURLY_PARAMS,
  OPEN_METEO_MARINE_URL,
  OPEN_METEO_MARINE_PARAMS,
  LOCATION,
  FORECAST_DAYS,
  TIMEZONE,
} from "../server/config";
```

(Replace the existing imports — add `SwellData`, `OPEN_METEO_MARINE_URL`, `OPEN_METEO_MARINE_PARAMS`.)

Add the marine parser after the existing `parseOpenMeteoWeather`:

```ts
// ---------------------------------------------------------------------------
// Marine Parser (swell data)
// ---------------------------------------------------------------------------

export function parseOpenMeteoMarine(
  raw: any,
  targetDate: string
): { hour: number; height: number; period: number; direction: number }[] {
  const h = raw.hourly;
  const times: string[] = h.time;
  const results: { hour: number; height: number; period: number; direction: number }[] = [];

  for (let i = 0; i < times.length; i++) {
    if (!times[i].startsWith(targetDate)) continue;

    const hour = parseInt(times[i].slice(11, 13), 10);
    results.push({
      hour,
      height: h.swell_wave_height[i] ?? 0,
      period: h.swell_wave_period[i] ?? 0,
      direction: Math.round(h.swell_wave_direction[i] ?? 0),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Marine Fetcher
// ---------------------------------------------------------------------------

export async function fetchOpenMeteoMarine(): Promise<any> {
  const url = new URL(OPEN_METEO_MARINE_URL);
  url.searchParams.set("latitude", String(LOCATION.lat));
  url.searchParams.set("longitude", String(LOCATION.lng));
  url.searchParams.set("hourly", OPEN_METEO_MARINE_PARAMS);
  url.searchParams.set("timezone", TIMEZONE);
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Open-Meteo Marine ${resp.status}: ${text}`);
  }
  return resp.json();
}
```

- [ ] **Step 4: Run tests**

```bash
cd /root/surf-pacitan && bun test tests/open-meteo.test.ts
```

Expected: all tests pass (existing 2 + new 2 = 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/open-meteo.ts tests/open-meteo.test.ts
git commit -m "feat: add Open-Meteo Marine API fetch and parse for swell data"
```

---

## Task 3: Cron — Switch to Open-Meteo for Swell + Weather

**Files:**
- Modify: `src/server/cron.ts`

- [ ] **Step 1: Rewrite fetchAndCacheWeather**

Replace the entire `fetchAndCacheWeather` function in `/root/surf-pacitan/src/server/cron.ts` with:

```ts
export async function fetchAndCacheWeather(): Promise<void> {
  console.log("[cron] fetchAndCacheWeather: starting");
  const { dates } = getDateRange();

  let weatherRaw: any;
  let marineRaw: any;

  try {
    [weatherRaw, marineRaw] = await Promise.all([
      fetchOpenMeteoWeather(),
      fetchOpenMeteoMarine(),
    ]);
  } catch (err) {
    console.error("[cron] fetchAndCacheWeather: Open-Meteo fetch failed:", err);
    return;
  }

  for (const date of dates) {
    const weatherHours = parseOpenMeteoWeather(weatherRaw, date);
    const marineHours = parseOpenMeteoMarine(marineRaw, date);

    const weatherByHour = new Map(weatherHours.map((w) => [w.hour, w]));
    const marineByHour = new Map(marineHours.map((m) => [m.hour, m]));

    const cachedDay = await getCachedDay(date);

    let hourly: HourlyData[];

    if (cachedDay) {
      const heights = cachedDay.hourly.map((h) => h.tide.height);
      const dailyMin = heights.length ? Math.min(...heights) : 0;
      const dailyMax = heights.length ? Math.max(...heights) : 1;

      hourly = cachedDay.hourly.map((h) => {
        const wx = weatherByHour.get(h.hour);
        const marine = marineByHour.get(h.hour);

        const swell: SwellData = marine
          ? { height: marine.height, period: marine.period, direction: marine.direction }
          : h.swell;
        const wind: WindData = wx ? wx.wind : h.wind;
        const weather: WeatherData = wx ? wx.weather : h.weather;

        const tidePercent = computeTidePercent(h.tide.height, dailyMin, dailyMax);
        const surfable = computeAllSpotRatings({
          hour: h.hour,
          tidePercent,
          tideRising: h.tide.rising,
          swellHeight: swell.height,
          windSpeed: wind.speed,
          sunrise: cachedDay.astronomy.sunrise,
          sunset: cachedDay.astronomy.sunset,
        });

        return { ...h, swell, wind, weather, surfable };
      });

      await setCachedDay({ ...cachedDay, hourly });
    } else {
      // No tide data cached yet
      const allHours = new Set([
        ...weatherHours.map((w) => w.hour),
        ...marineHours.map((m) => m.hour),
      ]);

      hourly = [...allHours].sort((a, b) => a - b).map((hour) => {
        const wx = weatherByHour.get(hour);
        const marine = marineByHour.get(hour);

        const swell: SwellData = marine
          ? { height: marine.height, period: marine.period, direction: marine.direction }
          : { height: 0, period: 0, direction: 0 };
        const wind: WindData = wx ? wx.wind : { speed: 0, direction: 0, gusts: 0 };
        const weather: WeatherData = wx ? wx.weather : { temp: 0, condition: "clear", precipitation: 0 };

        const surfable = computeAllSpotRatings({
          hour,
          tidePercent: 50,
          tideRising: false,
          swellHeight: swell.height,
          windSpeed: wind.speed,
          sunrise: "06:00",
          sunset: "18:00",
        });

        return {
          hour,
          tide: { height: 0, rising: false },
          swell,
          wind,
          weather,
          surfable,
        };
      });

      await setCachedDay({
        date,
        location: { name: LOCATION.name, lat: LOCATION.lat, lng: LOCATION.lng },
        astronomy: { sunrise: "06:00", sunset: "18:00" },
        tideExtremes: [],
        hourly,
      });
    }

    console.log(`[cron] fetchAndCacheWeather: updated ${date}`);
  }

  await setLastFetch(new Date().toISOString());
  console.log("[cron] fetchAndCacheWeather: done");
}
```

- [ ] **Step 2: Update imports in cron.ts**

Replace the imports at the top of cron.ts:

```ts
import {
  fetchTideExtremes,
  fetchSeaLevels,
  fetchAstronomy,
  parseTideExtremes,
  parseSeaLevels,
  parseAstronomy,
  extractQuota,
} from "./stormglass";
import { fetchOpenMeteoWeather, parseOpenMeteoWeather, fetchOpenMeteoMarine, parseOpenMeteoMarine } from "./open-meteo";
import { setCachedDay, setLastFetch, setQuotaRemaining, getCachedDay } from "./cache";
import { computeAllSpotRatings, computeTidePercent } from "./surfable";
import { LOCATION, FORECAST_DAYS, WEATHER_FETCH_INTERVAL_MS } from "./config";
import type { ForecastDay, HourlyData, SwellData, WindData, WeatherData } from "../shared/types";
```

(Removed `fetchWeather`, `parseWeather` from stormglass imports. Added `fetchOpenMeteoMarine`, `parseOpenMeteoMarine`.)

- [ ] **Step 3: Run all tests**

```bash
cd /root/surf-pacitan && bun test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/cron.ts
git commit -m "feat: switch weather+swell to Open-Meteo, StormGlass for tides only"
```

---

## Task 4: Clean Up StormGlass — Remove Weather Fetch

**Files:**
- Modify: `src/server/stormglass.ts`

- [ ] **Step 1: Remove fetchWeather and parseWeather from stormglass.ts**

In `/root/surf-pacitan/src/server/stormglass.ts`:

Remove the `LOCATION_OFFSHORE` import (if present), `STORMGLASS_WEATHER_PARAMS` import, the `fetchWeather` function, the `parseWeather` function, the `deriveCondition` helper, and the `msToKmh` helper (if only used by parseWeather).

Keep: `fetchTideExtremes`, `fetchSeaLevels`, `fetchAstronomy`, `parseTideExtremes`, `parseSeaLevels`, `parseAstronomy`, `extractQuota`, and all their helpers.

Also remove the `LOCATION_OFFSHORE` import from the config import line.

- [ ] **Step 2: Run all tests**

```bash
cd /root/surf-pacitan && bun test
```

Expected: all tests pass. (The stormglass tests still test the remaining parse functions.)

- [ ] **Step 3: Commit**

```bash
git add src/server/stormglass.ts
git commit -m "refactor: remove StormGlass weather/swell fetch (replaced by Open-Meteo)"
```

---

## Task 5: Build, Deploy, Verify

- [ ] **Step 1: Build**

```bash
cd /root/surf-pacitan && bun run build
```

- [ ] **Step 2: Restart service**

```bash
systemctl restart surf-pacitan.service
```

- [ ] **Step 3: Wait for initial fetch and check logs**

```bash
sleep 8 && journalctl -u surf-pacitan.service --no-pager -n 20
```

Expected: 
- `fetchAndCacheTides: done` (StormGlass tides)
- `fetchAndCacheWeather: updated 2026-04-04` (Open-Meteo, no "fallback" in log)

- [ ] **Step 4: Verify swell data in API**

```bash
curl -s http://localhost:3100/api/forecast/$(date +%Y-%m-%d) | python3 -c "
import json, sys
data = json.load(sys.stdin)
for h in data['hourly'][8:14]:
    print(f\"{h['hour']:02d}:00 | swell={h['swell']['height']:.1f}m @{h['swell']['period']:.0f}s | {h['surfable']['telengRia']}/{h['surfable']['pancer']}/{h['surfable']['pancerDoor']}\")
"
```

Expected: Non-zero swell values and green/yellow ratings during surfable hours.

- [ ] **Step 5: Update CLAUDE.md**

Update the data source description in CLAUDE.md to reflect the new architecture.

- [ ] **Step 6: Commit and push**

```bash
cd /root/surf-pacitan && git add -A && git commit -m "docs: update CLAUDE.md for Open-Meteo swell architecture" && git push
```
