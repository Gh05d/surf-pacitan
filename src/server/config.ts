export const LOCATION = {
  name: "Pacitan",
  lat: -8.22,
  lng: 111.13,
} as const;

export const TIMEZONE = "Asia/Jakarta";

// StormGlass API
export const STORMGLASS_BASE_URL = "https://api.stormglass.io/v2";

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

// Open-Meteo Marine API
// We fetch primary + secondary swell so the parser can pick the surf-relevant
// component. Open-Meteo classifies primary/secondary by amplitude alone — a
// tall local wind-sea can outrank a long-period groundswell and push the real
// surf swell into the secondary slot.
export const OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
export const OPEN_METEO_MARINE_PARAMS = [
  "swell_wave_height",
  "swell_wave_period",
  "swell_wave_direction",
  "secondary_swell_wave_height",
  "secondary_swell_wave_period",
  "secondary_swell_wave_direction",
].join(",");

// Open-Meteo weather model: best_match returns suspect wind direction at this
// coastal point (NE 35° while every other model says E 85-130°). GFS aligns
// with Wisuki/Surfline reference forecasts.
export const OPEN_METEO_WEATHER_MODEL = "gfs_seamless";

// Prefer secondary swell over primary when secondary has meaningful height
// AND is a SIGNIFICANTLY longer-period swell train. Both gates must hold:
// the height cutoff filters out background noise (e.g. <0.4m long-period
// remnants), and the period-ratio cutoff filters out wraparound cases where
// secondary is only marginally longer and often points at a non-surf-relevant
// direction (e.g. westerly wraparound around the headland).
export const SURF_SWELL_SECONDARY_MIN_HEIGHT_M = 0.3;
export const SURF_SWELL_SECONDARY_PERIOD_RATIO = 1.5;
// The secondary must also be a meaningful FRACTION of the primary's height to
// win. Without this, a tiny long-period sliver (e.g. 0.4m / 16.8s) could
// outrank a much larger primary groundswell (e.g. 2.1m / 11s) just by clearing
// the absolute floor + period ratio, crushing the height rating to yellow/red.
// 0.33 keeps genuine groundswell-behind-windsea cases (~0.42 ratio) while
// rejecting marginal slivers. Verified via scripts/verify-vs-wisuki.ts.
export const SURF_SWELL_SECONDARY_MIN_PRIMARY_RATIO = 0.33;

// Surfable thresholds — moved to src/shared/spot-config.ts (2026-06-10) so
// the client can render spot profiles and limiting factors from the same
// source of truth. Re-exported here so server code and the tests'
// mock.module("../src/server/config") spread pattern keep working unchanged.
export * from "../shared/spot-config";

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

// POST /api/refresh is publicly reachable through nginx; each call burns 3 of
// the 10 daily StormGlass requests. The endpoint requires the X-Refresh-Token
// header to match this value; when unset, the endpoint is disabled (401).
export const REFRESH_TOKEN = process.env.REFRESH_TOKEN ?? "";

// DeepSeek / AI recommendation
export const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? "";
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
export const DEEPSEEK_THINKING = process.env.DEEPSEEK_THINKING !== "false";
// Covers the FULL call including body read (headers arrive fast, but the body
// streams only after thinking completes — ~40s for a 4k-token reasoning run,
// up to ~90s worst case with the 8k budget).
export const DEEPSEEK_TIMEOUT_MS = 120_000;

// Claude CLI (Max subscription, free) is the PRIMARY recommendation model —
// mirrors the meme-scraper Don setup. DeepSeek (metered API) is only the
// fallback when the CLI call fails or returns an invalid recommendation.
// RECOMMENDATION_CLI="false" disables the CLI path (DeepSeek-only again).
export const RECOMMENDATION_CLI_ENABLED = process.env.RECOMMENDATION_CLI !== "false";
// CLI model alias ("sonnet"/"opus"/"fable"). Sonnet is plenty for this task
// and light on the subscription usage windows.
export const RECOMMENDATION_CLI_MODEL = process.env.RECOMMENDATION_CLI_MODEL ?? "sonnet";
// One-shot, no tools — generous cap for queueing/slow generation.
export const RECOMMENDATION_CLI_TIMEOUT_MS = 240_000;

// Enabled when at least one provider is available (Claude CLI or DeepSeek
// key), unless explicitly RECOMMENDATION_ENABLED=false. An explicit "true"
// without any provider is still disabled — the feature cannot work, and
// reporting enabled:true with a forever-null recommendation was a
// misconfiguration trap.
export const RECOMMENDATION_ENABLED =
  process.env.RECOMMENDATION_ENABLED !== "false" &&
  (RECOMMENDATION_CLI_ENABLED || DEEPSEEK_API_KEY !== "");

// Recommendation cron fires at 20:00 Asia/Jakarta (WIB = UTC+7) → 13:00 UTC
export const RECOMMENDATION_CRON_UTC_HOUR = 13;
export const RECOMMENDATION_CRON_UTC_MINUTE = 0;

// Recommendation Redis storage
export const REDIS_RECOMMENDATION_KEY_PREFIX = "surf:recommendation:";
export const RECOMMENDATION_TTL_SECONDS = 36 * 60 * 60; // 36h
