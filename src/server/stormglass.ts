import type { TideExtreme, AstronomyData } from "../shared/types";
import {
  LOCATION,
  STORMGLASS_BASE_URL,
  TIMEZONE,
} from "../server/config";
import { localDateStr, localHHMM, localHour } from "../shared/time";

// ---------------------------------------------------------------------------
// Parser functions (pure, testable)
// ---------------------------------------------------------------------------

export function parseTideExtremes(raw: any, targetDate: string): TideExtreme[] {
  // Bucket by REGION-LOCAL date via epoch math — the extremes endpoint
  // returns UTC timestamps while sea-level echoes the request's offset, so a
  // raw string-prefix compare puts early-morning extremes on the wrong day.
  // Epoch-based conversion is correct for both formats. Non-parseable
  // timestamps are dropped (fail-soft, matching pre-region behavior).
  return (raw.data as any[])
    .filter((item) => {
      const epoch = Date.parse(item.time);
      return Number.isFinite(epoch) && localDateStr(epoch, TIMEZONE) === targetDate;
    })
    .map((item) => ({
      time: localHHMM(Date.parse(item.time), TIMEZONE),
      height: item.height as number,
      type: item.type as "high" | "low",
    }));
}

export function parseSeaLevels(
  raw: any,
  targetDate: string
): { hour: number; height: number; rising: boolean }[] {
  // Build full indexed list for rising detection using adjacent entries.
  // Date bucketing uses epoch-based local conversion (NOT the raw timestamp
  // prefix) so it works whether the API returns +00:00 or +07:00 timestamps.
  const all = (raw.data as any[])
    .filter((item) => Number.isFinite(Date.parse(item.time)))
    .map((item, i) => {
      const epoch = Date.parse(item.time);
      return {
        idx: i,
        hour: localHour(epoch, TIMEZONE),
        height: item.sg as number,
        localDate: localDateStr(epoch, TIMEZONE),
      };
    });

  return all
    .filter((e) => e.localDate === targetDate)
    .map((e) => {
      const prev = all[e.idx - 1];
      const next = all[e.idx + 1];
      // Forward difference: "rising" describes the surf hour [H, H+1) — see
      // the convention note in CLAUDE.md. Fall back to backward diff at the
      // series end.
      const rising = next ? next.height > e.height : prev ? e.height > prev.height : false;
      return { hour: e.hour, height: e.height, rising };
    });
}

export function parseAstronomy(raw: any, targetDate?: string): AstronomyData {
  const entries = raw.data as any[];
  // Pick the entry whose sunrise falls on the target local date; the response
  // covers the whole forecast range, so data[0] is only day 1's astronomy.
  const match = targetDate
    ? entries.find((e) => {
        const epoch = Date.parse(e.sunrise);
        return Number.isFinite(epoch) && localDateStr(epoch, TIMEZONE) === targetDate;
      })
    : undefined;
  const entry = match ?? entries[0];
  return {
    sunrise: localHHMM(Date.parse(entry.sunrise), TIMEZONE),
    sunset: localHHMM(Date.parse(entry.sunset), TIMEZONE),
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

export async function fetchAstronomy(start: string, end: string): Promise<any> {
  const url = buildUrl("/astronomy/point", {
    lat: String(LOCATION.lat),
    lng: String(LOCATION.lng),
    start,
    end,
  });
  return sgFetch(url);
}
