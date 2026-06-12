import { Hono } from "hono";
import {
  getCachedDays,
  getCachedDay,
  getLastFetch,
  getCachedDateList,
  getQuotaRemaining,
  getRecommendation,
} from "./cache";
import { fetchAndCacheTides, fetchAndCacheWeather } from "./cron";
import type { ForecastResponse, StatusResponse, RecommendationResponse } from "../shared/types";
import { todayLocal, tomorrowLocal, addDays } from "../shared/time";
import { FORECAST_DAYS, RECOMMENDATION_ENABLED, REFRESH_TOKEN, TIMEZONE } from "./config";

const api = new Hono();

// GET /api/forecast — returns next N days from cache
api.get("/forecast", async (c) => {
  const today = todayLocal(TIMEZONE);
  const dates: string[] = [];
  for (let i = 0; i < FORECAST_DAYS; i++) dates.push(addDays(today, i));

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

// GET /api/recommendation — daily AI surf recommendation, may be null
// Prefer tomorrow's rec (generated ~20:00 local), fall back to today's after midnight.
api.get("/recommendation", async (c) => {
  if (!RECOMMENDATION_ENABLED) {
    const body: RecommendationResponse = { enabled: false, recommendation: null };
    return c.json(body);
  }
  const rec = (await getRecommendation(tomorrowLocal(TIMEZONE))) ?? (await getRecommendation(todayLocal(TIMEZONE)));
  const body: RecommendationResponse = { enabled: true, recommendation: rec };
  return c.json(body);
});

// POST /api/refresh — triggers a manual re-fetch. Token-gated: the endpoint
// is publicly reachable through nginx and each call costs 3 StormGlass
// requests (of 10/day). Unset REFRESH_TOKEN disables the endpoint entirely.
api.post("/refresh", async (c) => {
  if (!REFRESH_TOKEN || c.req.header("x-refresh-token") !== REFRESH_TOKEN) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
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
