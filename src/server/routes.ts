import { Hono } from "hono";
import {
  getCachedDays,
  getCachedDay,
  getLastFetch,
  getCachedDateList,
  getQuotaRemaining,
} from "./cache";
import { fetchAndCacheTides, fetchAndCacheWeather } from "./cron";
import type { ForecastResponse, StatusResponse } from "../shared/types";
import { FORECAST_DAYS } from "./config";

const api = new Hono();

// GET /api/forecast — returns next N days from cache
api.get("/forecast", async (c) => {
  const now = new Date();
  // Use UTC+7 local date
  const localNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);

  const dates: string[] = [];
  for (let i = 0; i < FORECAST_DAYS; i++) {
    const d = new Date(localNow.getTime() + i * 24 * 60 * 60 * 1000);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    dates.push(`${y}-${mo}-${da}`);
  }

  const cachedDays = await getCachedDays(dates);
  const lastFetch = await getLastFetch();

  const response: ForecastResponse = {
    days: cachedDays.filter((d) => d !== null) as NonNullable<(typeof cachedDays)[number]>[],
    lastFetch,
  };

  return c.json(response);
});

// GET /api/forecast/:date — returns single day or 404
api.get("/forecast/:date", async (c) => {
  const date = c.req.param("date");
  const day = await getCachedDay(date);
  if (!day) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json(day);
});

// GET /api/status
api.get("/status", async (c) => {
  const [lastFetch, cachedDays, stormglassQuota] = await Promise.all([
    getLastFetch(),
    getCachedDateList(),
    getQuotaRemaining(),
  ]);

  const response: StatusResponse = {
    lastFetch,
    cachedDays,
    stormglassQuota,
  };

  return c.json(response);
});

// POST /api/refresh — triggers a manual re-fetch
api.post("/refresh", async (c) => {
  try {
    await fetchAndCacheTides();
    await fetchAndCacheWeather();
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

export { api };
