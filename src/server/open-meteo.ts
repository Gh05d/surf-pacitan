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

// ---------------------------------------------------------------------------
// WMO weather code → condition string
// ---------------------------------------------------------------------------

function wmoToCondition(code: number): string {
  if (code === 0 || code === 1) return "clear";
  if (code === 2) return "partly_cloudy";
  if (code === 3) return "overcast";
  if (code >= 45 && code <= 48) return "fog";
  if (code >= 51 && code <= 55) return "light_rain";
  if (code >= 61 && code <= 65) return "rain";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 95) return "thunderstorm";
  return "cloudy";
}

// ---------------------------------------------------------------------------
// Parser (pure, testable)
// ---------------------------------------------------------------------------

export function parseOpenMeteoWeather(
  raw: any,
  targetDate: string
): { hour: number; wind: WindData; weather: WeatherData }[] {
  const h = raw.hourly;
  const times: string[] = h.time;
  const results: { hour: number; wind: WindData; weather: WeatherData }[] = [];

  for (let i = 0; i < times.length; i++) {
    if (!times[i].startsWith(targetDate)) continue;

    // Parse hour from time string "YYYY-MM-DDTHH:MM"
    const hour = parseInt(times[i].slice(11, 13), 10);

    const wind: WindData = {
      speed: h.wind_speed_10m[i] as number,
      direction: h.wind_direction_10m[i] as number,
      gusts: h.wind_gusts_10m[i] as number,
    };

    const weather: WeatherData = {
      temp: h.temperature_2m[i] as number,
      condition: wmoToCondition(h.weather_code[i] as number),
      precipitation: h.precipitation[i] as number,
    };

    results.push({ hour, wind, weather });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

export async function fetchOpenMeteoWeather(): Promise<any> {
  const url = new URL(OPEN_METEO_BASE_URL);
  url.searchParams.set("latitude", String(LOCATION.lat));
  url.searchParams.set("longitude", String(LOCATION.lng));
  url.searchParams.set("hourly", OPEN_METEO_HOURLY_PARAMS);
  url.searchParams.set("timezone", TIMEZONE);
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Open-Meteo ${resp.status}: ${text}`);
  }
  return resp.json();
}

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
