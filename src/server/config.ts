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
export const OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
export const OPEN_METEO_MARINE_PARAMS = [
  "swell_wave_height",
  "swell_wave_period",
  "swell_wave_direction",
].join(",");

// Surfable thresholds
export interface SpotThresholds {
  TIDE_GREEN_MIN: number;
  TIDE_GREEN_FALLING_MIN: number;
  TIDE_YELLOW_MIN: number;
  SWELL_GREEN_MIN: number;
  SWELL_YELLOW_MIN: number;
  WIND_GREEN_MAX: number;
  WIND_YELLOW_MAX: number;
}

export const SURFABLE_TELENG_RIA: SpotThresholds = {
  TIDE_GREEN_MIN: 25,
  TIDE_GREEN_FALLING_MIN: 60,
  TIDE_YELLOW_MIN: 15,
  SWELL_GREEN_MIN: 0.4,
  SWELL_YELLOW_MIN: 0.2,
  WIND_GREEN_MAX: 25,
  WIND_YELLOW_MAX: 35,
};

export const SURFABLE_PANCER: SpotThresholds = {
  TIDE_GREEN_MIN: 40,
  TIDE_GREEN_FALLING_MIN: 75,
  TIDE_YELLOW_MIN: 25,
  SWELL_GREEN_MIN: 0.5,
  SWELL_YELLOW_MIN: 0.3,
  WIND_GREEN_MAX: 20,
  WIND_YELLOW_MAX: 30,
};

export const SURFABLE_PANCER_DOOR: SpotThresholds = {
  TIDE_GREEN_MIN: 50,
  TIDE_GREEN_FALLING_MIN: 80,
  TIDE_YELLOW_MIN: 30,
  SWELL_GREEN_MIN: 0.5,
  SWELL_YELLOW_MIN: 0.3,
  WIND_GREEN_MAX: 20,
  WIND_YELLOW_MAX: 30,
};

export const SURFABLE = SURFABLE_PANCER_DOOR;

export const SPOT_THRESHOLDS = {
  telengRia: SURFABLE_TELENG_RIA,
  pancer: SURFABLE_PANCER,
  pancerDoor: SURFABLE_PANCER_DOOR,
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
