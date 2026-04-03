import Redis from "ioredis";
import type { ForecastDay } from "../shared/types";
import { REDIS_KEY_PREFIX, REDIS_META_KEY, REDIS_QUOTA_KEY, CACHE_TTL_SECONDS } from "./config";

const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  password: process.env.REDIS_PASSWORD || undefined,
});

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
