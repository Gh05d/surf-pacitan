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
import { setCachedDay, setLastFetch, setQuotaRemaining, getCachedDay } from "./cache";
import { computeSurfable, computeTidePercent } from "./surfable";
import { LOCATION, FORECAST_DAYS, WEATHER_FETCH_INTERVAL_MS } from "./config";
import type { ForecastDay, HourlyData, SwellData, WindData, WeatherData } from "../shared/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDateRange(): { start: string; end: string; dates: string[] } {
  const now = new Date();
  // Use local UTC+7 date as "today"
  const localNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);

  const dates: string[] = [];
  for (let i = 0; i < FORECAST_DAYS; i++) {
    const d = new Date(localNow.getTime() + i * 24 * 60 * 60 * 1000);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    dates.push(`${y}-${mo}-${da}`);
  }

  // start = beginning of first date in UTC
  const start = `${dates[0]}T00:00:00+07:00`;
  // end = end of last date in UTC+7 (next midnight)
  const lastDate = new Date(localNow.getTime() + FORECAST_DAYS * 24 * 60 * 60 * 1000);
  const ly = lastDate.getUTCFullYear();
  const lmo = String(lastDate.getUTCMonth() + 1).padStart(2, "0");
  const lda = String(lastDate.getUTCDate()).padStart(2, "0");
  const end = `${ly}-${lmo}-${lda}T00:00:00+07:00`;

  return { start, end, dates };
}

// ---------------------------------------------------------------------------
// fetchAndCacheTides
// ---------------------------------------------------------------------------

export async function fetchAndCacheTides(): Promise<void> {
  console.log("[cron] fetchAndCacheTides: starting");
  const { start, end, dates } = getDateRange();

  let tidesRaw: any;
  let seaRaw: any;
  let astroRaw: any;

  try {
    [tidesRaw, seaRaw, astroRaw] = await Promise.all([
      fetchTideExtremes(start, end),
      fetchSeaLevels(start, end),
      fetchAstronomy(start, end),
    ]);
  } catch (err) {
    console.error("[cron] fetchAndCacheTides: StormGlass request failed:", err);
    return;
  }

  for (const date of dates) {
    const tideExtremes = parseTideExtremes(tidesRaw, date);
    const seaLevels = parseSeaLevels(seaRaw, date);
    const astronomy = parseAstronomy(astroRaw);

    // Build the daily min/max for tidePercent computation
    const heights = seaLevels.map((s) => s.height);
    const dailyMin = heights.length ? Math.min(...heights) : 0;
    const dailyMax = heights.length ? Math.max(...heights) : 1;

    // Build hourly entries with tide data only; weather/swell will be filled by fetchAndCacheWeather
    const hourly: HourlyData[] = seaLevels.map((sl) => {
      const tidePercent = computeTidePercent(sl.height, dailyMin, dailyMax);
      return {
        hour: sl.hour,
        tide: { height: sl.height, rising: sl.rising },
        swell: { height: 0, period: 0, direction: 0 },
        wind: { speed: 0, direction: 0, gusts: 0 },
        weather: { temp: 0, condition: "clear", precipitation: 0 },
        surfable: computeSurfable({
          hour: sl.hour,
          tidePercent,
          tideRising: sl.rising,
          swellHeight: 0,
          windSpeed: 0,
          sunrise: astronomy.sunrise,
          sunset: astronomy.sunset,
        }),
      };
    });

    const day: ForecastDay = {
      date,
      location: { name: LOCATION.name, lat: LOCATION.lat, lng: LOCATION.lng },
      astronomy,
      tideExtremes,
      hourly,
    };

    await setCachedDay(day);
    console.log(`[cron] fetchAndCacheTides: cached ${date}`);
  }

  await setLastFetch(new Date().toISOString());
  console.log("[cron] fetchAndCacheTides: done");
}

// ---------------------------------------------------------------------------
// fetchAndCacheWeather
// ---------------------------------------------------------------------------

export async function fetchAndCacheWeather(): Promise<void> {
  console.log("[cron] fetchAndCacheWeather: starting");
  const { start, end, dates } = getDateRange();

  let weatherEntries: Map<
    string,
    {
      hour: number;
      swell: SwellData;
      wind: WindData;
      weather: WeatherData;
    }[]
  > = new Map();

  let usedFallback = false;

  // Try StormGlass first
  try {
    const raw = await fetchWeather(start, end);

    // Track quota from meta
    const quota = extractQuota(raw.meta);
    if (quota != null) {
      await setQuotaRemaining(quota);
    }

    for (const date of dates) {
      const parsed = parseWeather(raw, date);
      weatherEntries.set(
        date,
        parsed.map((p) => ({
          hour: p.hour,
          swell: p.swell,
          wind: p.wind,
          weather: p.weather,
        }))
      );
    }

    console.log("[cron] fetchAndCacheWeather: StormGlass weather OK");
  } catch (err) {
    console.warn("[cron] fetchAndCacheWeather: StormGlass failed, trying Open-Meteo fallback:", err);
    usedFallback = true;

    try {
      const raw = await fetchOpenMeteoWeather();

      for (const date of dates) {
        const parsed = parseOpenMeteoWeather(raw, date);
        weatherEntries.set(
          date,
          parsed.map((p) => ({
            hour: p.hour,
            swell: { height: 0, period: 0, direction: 0 }, // no swell from Open-Meteo
            wind: p.wind,
            weather: p.weather,
          }))
        );
      }

      console.log("[cron] fetchAndCacheWeather: Open-Meteo fallback OK");
    } catch (fallbackErr) {
      console.error("[cron] fetchAndCacheWeather: Open-Meteo fallback also failed:", fallbackErr);
      return;
    }
  }

  // Merge weather data into cached days
  for (const date of dates) {
    const entries = weatherEntries.get(date);
    if (!entries || entries.length === 0) continue;

    const cachedDay = await getCachedDay(date);

    // Build hourly map from entries
    const entryByHour = new Map(entries.map((e) => [e.hour, e]));

    let hourly: HourlyData[];

    if (cachedDay) {
      // Merge weather into existing tide-based hourly
      const heights = cachedDay.hourly.map((h) => h.tide.height);
      const dailyMin = heights.length ? Math.min(...heights) : 0;
      const dailyMax = heights.length ? Math.max(...heights) : 1;

      hourly = cachedDay.hourly.map((h) => {
        const wx = entryByHour.get(h.hour);
        const swell = wx ? wx.swell : h.swell;
        const wind = wx ? wx.wind : h.wind;
        const weather = wx ? wx.weather : h.weather;

        const tidePercent = computeTidePercent(h.tide.height, dailyMin, dailyMax);
        const surfable = computeSurfable({
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
      // No tide data cached yet; build from weather entries alone
      hourly = entries.map((e) => {
        const surfable = computeSurfable({
          hour: e.hour,
          tidePercent: 50, // unknown
          tideRising: false,
          swellHeight: e.swell.height,
          windSpeed: e.wind.speed,
          sunrise: "06:00",
          sunset: "18:00",
        });

        return {
          hour: e.hour,
          tide: { height: 0, rising: false },
          swell: e.swell,
          wind: e.wind,
          weather: e.weather,
          surfable,
        };
      });

      const day: ForecastDay = {
        date,
        location: { name: LOCATION.name, lat: LOCATION.lat, lng: LOCATION.lng },
        astronomy: { sunrise: "06:00", sunset: "18:00" },
        tideExtremes: [],
        hourly,
      };

      await setCachedDay(day);
    }

    console.log(
      `[cron] fetchAndCacheWeather: updated ${date}${usedFallback ? " (fallback, no swell)" : ""}`
    );
  }

  await setLastFetch(new Date().toISOString());
  console.log("[cron] fetchAndCacheWeather: done");
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export function startScheduler(): void {
  console.log("[cron] startScheduler: initializing");

  // Initial fetch on startup
  fetchAndCacheTides().catch((err) => console.error("[cron] initial tide fetch error:", err));
  fetchAndCacheWeather().catch((err) => console.error("[cron] initial weather fetch error:", err));

  // Weather every 3 hours
  setInterval(() => {
    fetchAndCacheWeather().catch((err) =>
      console.error("[cron] scheduled weather fetch error:", err)
    );
  }, WEATHER_FETCH_INTERVAL_MS);

  // Tides once daily at midnight local (UTC+7 = 17:00 UTC)
  scheduleMidnightTideFetch();

  console.log(
    `[cron] startScheduler: weather every ${WEATHER_FETCH_INTERVAL_MS / 3600000}h, tides daily at midnight WIB`
  );
}

function scheduleMidnightTideFetch(): void {
  const now = new Date();
  // Compute next 17:00 UTC (= 00:00 WIB)
  const nextMidnight = new Date(now);
  nextMidnight.setUTCHours(17, 0, 0, 0);
  if (nextMidnight.getTime() <= now.getTime()) {
    // Already past 17:00 UTC today, schedule for tomorrow
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  }

  const msUntilMidnight = nextMidnight.getTime() - now.getTime();
  console.log(
    `[cron] next tide fetch scheduled in ${Math.round(msUntilMidnight / 60000)} minutes`
  );

  setTimeout(() => {
    fetchAndCacheTides().catch((err) =>
      console.error("[cron] midnight tide fetch error:", err)
    );
    // Chain next day
    scheduleMidnightTideFetch();
  }, msUntilMidnight);
}
