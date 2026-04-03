import type { TideExtreme, AstronomyData } from "../shared/types";
import {
  LOCATION,
  STORMGLASS_BASE_URL,
  STORMGLASS_WEATHER_PARAMS,
} from "../server/config";

const UTC_OFFSET_HOURS = 7; // UTC+7 (WIB)

function utcToLocal(utcIso: string): Date {
  const d = new Date(utcIso);
  // Shift to UTC+7
  return new Date(d.getTime() + UTC_OFFSET_HOURS * 60 * 60 * 1000);
}

function toHHMM(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function localDateStr(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

// ---------------------------------------------------------------------------
// Parser functions (pure, testable)
// ---------------------------------------------------------------------------

export function parseTideExtremes(raw: any, targetDate: string): TideExtreme[] {
  return (raw.data as any[])
    .filter((item) => {
      // Filter by UTC date — API returns data for the requested UTC window
      const utcDate = item.time.slice(0, 10);
      return utcDate === targetDate;
    })
    .map((item) => {
      const local = utcToLocal(item.time);
      return {
        time: toHHMM(local),
        height: item.height as number,
        type: item.type as "high" | "low",
      };
    });
}

export function parseSeaLevels(
  raw: any,
  targetDate: string
): { hour: number; height: number; rising: boolean }[] {
  // Build full indexed list for rising detection using adjacent entries
  const all = (raw.data as any[]).map((item, i) => {
    const local = utcToLocal(item.time);
    return {
      idx: i,
      hour: local.getUTCHours(),
      height: item.sg as number,
      utcDate: item.time.slice(0, 10),
    };
  });

  return all
    .filter((e) => e.utcDate === targetDate)
    .map((e) => {
      const prev = all[e.idx - 1];
      const next = all[e.idx + 1];
      // Rising if current is higher than previous; fall back to comparing with next if no prev
      const rising = prev ? e.height > prev.height : next ? next.height > e.height : false;
      return { hour: e.hour, height: e.height, rising };
    });
}

export function parseWeather(
  raw: any,
  targetDate: string
): {
  hour: number;
  swell: { height: number; period: number; direction: number };
  wind: { speed: number; direction: number; gusts: number };
  weather: { temp: number; condition: string; precipitation: number };
}[] {
  return (raw.hours as any[])
    .map((item) => {
      const local = utcToLocal(item.time);
      if (localDateStr(local) !== targetDate) return null;

      const windSpeedMs: number = item.windSpeed?.sg ?? 0;
      const gustMs: number = item.gust?.sg ?? 0;
      const cloudCover: number = item.cloudCover?.sg ?? 0;
      const precipitation: number = item.precipitation?.sg ?? 0;

      const condition = deriveCondition(cloudCover, precipitation);

      return {
        hour: local.getUTCHours(),
        swell: {
          height: item.swellHeight?.sg ?? 0,
          period: item.swellPeriod?.sg ?? 0,
          direction: item.swellDirection?.sg ?? 0,
        },
        wind: {
          speed: windSpeedMs * 3.6,
          direction: item.windDirection?.sg ?? 0,
          gusts: gustMs * 3.6,
        },
        weather: {
          temp: item.airTemperature?.sg ?? 0,
          condition,
          precipitation,
        },
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

export function parseAstronomy(raw: any): AstronomyData {
  const first = (raw.data as any[])[0];
  return {
    sunrise: toHHMM(utcToLocal(first.sunrise)),
    sunset: toHHMM(utcToLocal(first.sunset)),
  };
}

export function extractQuota(meta: any): number | null {
  if (!meta) return null;
  const daily = meta.dailyQuota;
  const used = meta.requestCount;
  if (daily == null || used == null) return null;
  return daily - used;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveCondition(cloudCover: number, precipitation: number): string {
  if (precipitation > 5) return "rain";
  if (precipitation > 0) return "light_rain";
  if (cloudCover >= 80) return "overcast";
  if (cloudCover >= 50) return "cloudy";
  if (cloudCover >= 20) return "partly_cloudy";
  return "clear";
}

function sgApiKey(): string {
  const key = process.env.STORMGLASS_API_KEY;
  if (!key) throw new Error("STORMGLASS_API_KEY env var is not set");
  return key;
}

function buildUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${STORMGLASS_BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

async function sgFetch(url: string): Promise<any> {
  const resp = await fetch(url, {
    headers: { Authorization: sgApiKey() },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`StormGlass ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// Fetcher functions (make actual HTTP requests)
// ---------------------------------------------------------------------------

export async function fetchTideExtremes(start: string, end: string): Promise<any> {
  const url = buildUrl("/tide/extremes/point", {
    lat: String(LOCATION.lat),
    lng: String(LOCATION.lng),
    start,
    end,
  });
  return sgFetch(url);
}

export async function fetchSeaLevels(start: string, end: string): Promise<any> {
  const url = buildUrl("/tide/sea-level/point", {
    lat: String(LOCATION.lat),
    lng: String(LOCATION.lng),
    start,
    end,
  });
  return sgFetch(url);
}

export async function fetchWeather(start: string, end: string): Promise<any> {
  const url = buildUrl("/weather/point", {
    lat: String(LOCATION.lat),
    lng: String(LOCATION.lng),
    params: STORMGLASS_WEATHER_PARAMS,
    source: "sg",
    start,
    end,
  });
  return sgFetch(url);
}

export async function fetchAstronomy(start: string, end: string): Promise<any> {
  const url = buildUrl("/astronomy/point", {
    lat: String(LOCATION.lat),
    lng: String(LOCATION.lng),
    start,
    end,
  });
  return sgFetch(url);
}
