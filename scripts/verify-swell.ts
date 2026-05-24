#!/usr/bin/env bun
// Verify our pickSurfSwell logic by comparing Open-Meteo Marine (with our
// picker applied) against Stormglass aggregated swell data over the past 14
// days at Pacitan. Caches API responses to /tmp so re-runs don't burn quota.
//
// Pass criterion: ≥90% agreement on direction (within 30°) AND period
// (within 3s) for daylight hours (06-17 local).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pickSurfSwell } from "../src/server/open-meteo";
import { LOCATION, STORMGLASS_BASE_URL } from "../src/server/config";

const DAYS_BACK = 14;
const CACHE_DIR = "/tmp";

const now = new Date();
const startISO = new Date(now.getTime() - DAYS_BACK * 86400_000).toISOString().slice(0, 19) + "+00:00";
const endISO = now.toISOString().slice(0, 19) + "+00:00";
const startDateStr = startISO.slice(0, 10);
const endDateStr = endISO.slice(0, 10);

console.log(`Verification window: ${startISO} → ${endISO} (${DAYS_BACK} days)`);

// -- 1. Fetch (cached) ------------------------------------------------------

async function cachedFetch(label: string, url: string, headers: Record<string, string> = {}): Promise<any> {
  const path = `${CACHE_DIR}/verify-swell-${label}-${startDateStr}-${endDateStr}.json`;
  if (existsSync(path)) {
    console.log(`[cache hit] ${label}`);
    return JSON.parse(readFileSync(path, "utf-8"));
  }
  console.log(`[fetch] ${label}: ${url.slice(0, 80)}...`);
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${label} ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  writeFileSync(path, JSON.stringify(data));
  return data;
}

async function fetchStormglass(): Promise<any> {
  const params = new URLSearchParams({
    lat: String(LOCATION.lat),
    lng: String(LOCATION.lng),
    start: startISO,
    end: endISO,
    params: "swellHeight,swellPeriod,swellDirection,secondarySwellHeight,secondarySwellPeriod,secondarySwellDirection,windSpeed,windDirection",
  });
  const url = `${STORMGLASS_BASE_URL}/weather/point?${params}`;
  const key = process.env.STORMGLASS_API_KEY;
  if (!key) throw new Error("STORMGLASS_API_KEY not set");
  return cachedFetch("stormglass", url, { Authorization: key });
}

async function fetchOpenMeteoMarine(): Promise<any> {
  const params = new URLSearchParams({
    latitude: String(LOCATION.lat),
    longitude: String(LOCATION.lng),
    hourly: "swell_wave_height,swell_wave_period,swell_wave_direction,secondary_swell_wave_height,secondary_swell_wave_period,secondary_swell_wave_direction",
    timezone: "UTC",
    start_date: startDateStr,
    end_date: endDateStr,
  });
  return cachedFetch("om-marine", `https://marine-api.open-meteo.com/v1/marine?${params}`);
}

async function fetchOpenMeteoWind(): Promise<any> {
  const params = new URLSearchParams({
    latitude: String(LOCATION.lat),
    longitude: String(LOCATION.lng),
    hourly: "wind_speed_10m,wind_direction_10m",
    models: "gfs_seamless",
    timezone: "UTC",
    start_date: startDateStr,
    end_date: endDateStr,
  });
  return cachedFetch("om-wind-gfs", `https://api.open-meteo.com/v1/forecast?${params}`);
}

// -- 2. Normalize to common per-hour map -----------------------------------

interface Picked { height: number; period: number; direction: number }
interface WindRow { speed: number; direction: number }

// Stormglass: array of hours, each hour has fields like {swellHeight: {sg: ..., noaa: ...}, ...}
function sgRows(sg: any): Map<string, { picked: Picked | null; wind: WindRow | null }> {
  const out = new Map<string, { picked: Picked | null; wind: WindRow | null }>();
  for (const hr of sg.hours ?? []) {
    const t = hr.time as string; // ISO with +00:00
    const get = (k: string) => hr[k]?.sg ?? hr[k]?.noaa ?? hr[k]?.dwd ?? null;
    const primH = get("swellHeight");
    const primP = get("swellPeriod");
    const primD = get("swellDirection");
    const secH = get("secondarySwellHeight");
    const secP = get("secondarySwellPeriod");
    const secD = get("secondarySwellDirection");
    const picked = (primH != null && primP != null && primD != null)
      ? pickSurfSwell(primH, primP, primD, secH, secP, secD)
      : null;
    const windSpeed = get("windSpeed");      // m/s in StormGlass
    const windDir = get("windDirection");
    const wind = (windSpeed != null && windDir != null)
      ? { speed: windSpeed * 3.6, direction: windDir }  // → km/h
      : null;
    out.set(t.slice(0, 13), { picked, wind }); // key: "YYYY-MM-DDTHH"
  }
  return out;
}

function omRows(marine: any, wind: any): Map<string, { picked: Picked | null; wind: WindRow | null }> {
  const out = new Map<string, { picked: Picked | null; wind: WindRow | null }>();
  const h = marine.hourly;
  const w = wind.hourly;
  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i] as string; // "YYYY-MM-DDTHH:MM"
    const key = t.slice(0, 13);
    const primH = h.swell_wave_height?.[i];
    const primP = h.swell_wave_period?.[i];
    const primD = h.swell_wave_direction?.[i];
    const secH = h.secondary_swell_wave_height?.[i];
    const secP = h.secondary_swell_wave_period?.[i];
    const secD = h.secondary_swell_wave_direction?.[i];
    const picked = (primH != null && primP != null && primD != null)
      ? pickSurfSwell(primH, primP, primD, secH, secP, secD)
      : null;
    const wi = w.time.indexOf(t);
    const wind_ = wi >= 0
      ? { speed: w.wind_speed_10m[wi], direction: w.wind_direction_10m[wi] }
      : null;
    out.set(key, { picked, wind: wind_ });
  }
  return out;
}

// -- 3. Compare -------------------------------------------------------------

function angularDiff(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function localHour(utcKey: string): number {
  // utcKey = "YYYY-MM-DDTHH" in UTC. WIB = UTC+7.
  const utcH = parseInt(utcKey.slice(11, 13), 10);
  return (utcH + 7) % 24;
}

async function main() {
  const [sgRaw, omMarineRaw, omWindRaw] = await Promise.all([
    fetchStormglass(),
    fetchOpenMeteoMarine(),
    fetchOpenMeteoWind(),
  ]);

  const sg = sgRows(sgRaw);
  const om = omRows(omMarineRaw, omWindRaw);

  // Walk all hours present in both
  const commonKeys = [...om.keys()].filter((k) => sg.has(k)).sort();

  let nSwell = 0, dirAgree = 0, perAgree = 0, bothAgree = 0;
  let nWind = 0, windDirAgree = 0;
  const disagree: any[] = [];

  for (const k of commonKeys) {
    const lh = localHour(k);
    if (lh < 6 || lh > 17) continue; // daylight only

    const s = sg.get(k)!;
    const o = om.get(k)!;

    if (s.picked && o.picked) {
      nSwell++;
      const dd = angularDiff(s.picked.direction, o.picked.direction);
      const pd = Math.abs(s.picked.period - o.picked.period);
      const dOK = dd <= 30;
      const pOK = pd <= 3;
      if (dOK) dirAgree++;
      if (pOK) perAgree++;
      if (dOK && pOK) bothAgree++;
      if (!dOK || !pOK) disagree.push({
        utc: k, lh,
        sg: `${s.picked.height.toFixed(2)}m ${s.picked.period.toFixed(1)}s ${s.picked.direction}°`,
        om: `${o.picked.height.toFixed(2)}m ${o.picked.period.toFixed(1)}s ${o.picked.direction}°`,
        dDelta: dd.toFixed(0), pDelta: pd.toFixed(1),
      });
    }

    if (s.wind && o.wind) {
      nWind++;
      if (angularDiff(s.wind.direction, o.wind.direction) <= 30) windDirAgree++;
    }
  }

  console.log(`\nDaylight hours compared (06-17 WIB): ${nSwell}`);
  console.log(`Swell DIRECTION agreement (within 30°): ${((dirAgree/nSwell)*100).toFixed(1)}%  (${dirAgree}/${nSwell})`);
  console.log(`Swell PERIOD    agreement (within 3s):  ${((perAgree/nSwell)*100).toFixed(1)}%  (${perAgree}/${nSwell})`);
  console.log(`BOTH dir+period agreement:               ${((bothAgree/nSwell)*100).toFixed(1)}%  (${bothAgree}/${nSwell})`);
  console.log(`Wind DIRECTION  agreement (within 30°): ${((windDirAgree/nWind)*100).toFixed(1)}%  (${windDirAgree}/${nWind})`);

  console.log(`\nDisagreements (showing up to 20):`);
  for (const d of disagree.slice(0, 20)) {
    console.log(`  ${d.utc}+0 (WIB ${d.lh}h)  sg: ${d.sg}  om: ${d.om}  Δdir=${d.dDelta}° Δperiod=${d.pDelta}s`);
  }
  if (disagree.length > 20) console.log(`  ... +${disagree.length - 20} more`);

  const pass = (bothAgree / nSwell) >= 0.9;
  console.log(`\n${pass ? "PASS" : "FAIL"}: target 90% both-agreement, actual ${((bothAgree/nSwell)*100).toFixed(1)}%`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(2);
});
