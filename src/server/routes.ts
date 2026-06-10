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
import { FORECAST_DAYS, RECOMMENDATION_ENABLED, REFRESH_TOKEN } from "./config";

function todayWIB(): string {
  const now = new Date();
  const localNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = localNow.getUTCFullYear();
  const mo = String(localNow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(localNow.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function tomorrowWIB(): string {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + (7 + 24) * 60 * 60 * 1000);
  const y = tomorrow.getUTCFullYear();
  const mo = String(tomorrow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

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

// GET /api/recommendation — daily AI surf recommendation, may be null
// Prefer tomorrow's rec (generated ~20:00 WIB), fall back to today's after midnight.
api.get("/recommendation", async (c) => {
  if (!RECOMMENDATION_ENABLED) {
    const body: RecommendationResponse = { enabled: false, recommendation: null };
    return c.json(body);
  }
  const rec = (await getRecommendation(tomorrowWIB())) ?? (await getRecommendation(todayWIB()));
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
