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
  TIDE_GREEN_MIN: 50,
  TIDE_GREEN_FALLING_MIN: 80,
  TIDE_YELLOW_MIN: 30,
  SWELL_GREEN_MIN: 0.5,
  SWELL_YELLOW_MIN: 0.3,
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
