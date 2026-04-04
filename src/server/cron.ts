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
        surfable: computeAllSpotRatings({
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

        return { hour, tide: { height: 0, rising: false }, swell, wind, weather, surfable };
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

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export function startScheduler(): void {
  console.log("[cron] startScheduler: initializing");

  // Initial fetch on startup — tides first, then weather (weather merges into tide cache)
  fetchAndCacheTides()
    .then(() => fetchAndCacheWeather())
    .catch((err) => console.error("[cron] initial fetch error:", err));

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
