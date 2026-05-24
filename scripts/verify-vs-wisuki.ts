#!/usr/bin/env bun
// Verify OM-with-picker against Wisuki forecast (next ~7 days, 3h granularity).
// Wisuki has no archive — `?date=` parameter is ignored — so this is forward-
// looking only. Parses Wisuki HTML deterministically (no LLM).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pickSurfSwell } from "../src/server/open-meteo";
import { LOCATION } from "../src/server/config";

const CACHE_DIR = "/tmp";
const HTML_PATH = `${CACHE_DIR}/wisuki-pacitan.html`;
const OM_PATH = `${CACHE_DIR}/verify-wisuki-om.json`;

async function fetchWisukiHtml(): Promise<string> {
  if (existsSync(HTML_PATH)) {
    console.log("[cache hit] wisuki html");
    return readFileSync(HTML_PATH, "utf-8");
  }
  console.log("[fetch] wisuki html");
  const resp = await fetch("https://wisuki.com/forecast/6041/pacitan", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!resp.ok) throw new Error(`Wisuki ${resp.status}`);
  const text = await resp.text();
  writeFileSync(HTML_PATH, text);
  return text;
}

async function fetchOMNext(): Promise<any> {
  if (existsSync(OM_PATH)) {
    console.log("[cache hit] om");
    return JSON.parse(readFileSync(OM_PATH, "utf-8"));
  }
  console.log("[fetch] om");
  const params = new URLSearchParams({
    latitude: String(LOCATION.lat),
    longitude: String(LOCATION.lng),
    hourly: "swell_wave_height,swell_wave_period,swell_wave_direction,secondary_swell_wave_height,secondary_swell_wave_period,secondary_swell_wave_direction",
    timezone: "Asia/Jakarta",
    forecast_days: "10",
  });
  const resp = await fetch(`https://marine-api.open-meteo.com/v1/marine?${params}`);
  if (!resp.ok) throw new Error(`OM ${resp.status}`);
  const data = await resp.json();
  writeFileSync(OM_PATH, JSON.stringify(data));
  return data;
}

interface WisukiCell { dayName: string; dayNum: number; hour: number; height: number; period: number; direction: number }

function parseWisuki(html: string): WisukiCell[] {
  // Day headers at 3h granularity. Pattern:
  //   <th colspan="N" scope="col" ... id="day-DD">Sun 24
  // first day may have colspan<8 (partial day at page start).
  const dayHeaderRe = /<th colspan="(\d+)" scope="col"[^>]*id="day-(\d+)"[^>]*>([A-Z][a-z]+)\s*\d+/g;
  const days: { colspan: number; dayNum: number; dayName: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = dayHeaderRe.exec(html))) {
    days.push({ colspan: parseInt(m[1], 10), dayNum: parseInt(m[2], 10), dayName: m[3] });
    if (days.length > 12) break; // we only need ~7 days; stop before the per-hour wider table
  }

  // Build flat list of {dayName, dayNum, hour} aligned to cells
  // Wisuki 3h grid hours: 01, 04, 07, 10, 13, 16, 19, 22.
  // First day may start mid-day — its hours are the LAST N of [01,04,07,10,13,16,19,22].
  const HOURS_3H = [1, 4, 7, 10, 13, 16, 19, 22];
  const cells: { dayName: string; dayNum: number; hour: number }[] = [];
  for (let i = 0; i < days.length; i++) {
    const { colspan, dayNum, dayName } = days[i];
    const startIdx = i === 0 ? HOURS_3H.length - colspan : 0;
    for (let j = 0; j < colspan; j++) {
      cells.push({ dayName, dayNum, hour: HOURS_3H[startIdx + j] });
    }
  }

  // Extract the first occurrence of each row (3h-granularity table is first)
  function rowValues(label: string, valueRe: RegExp): string[] {
    const re = new RegExp(`<tr class="waves"><th[^>]*>${label}[\\s\\S]*?</th>(.{0,30000}?)</tr>`, "s");
    const mm = html.match(re);
    if (!mm) return [];
    return Array.from(mm[1].matchAll(valueRe)).map((x) => x[1]);
  }
  const heights = rowValues("Height", /<td[^>]*>([\d.]+)<\/td>/g).map(parseFloat);
  const periods = rowValues("Period", /<td[^>]*>(\d+)<\/td>/g).map((x) => parseInt(x, 10));
  const directions = rowValues("Direction", /title="[^|]*\|\s*(\d+)&deg;"/g).map((x) => parseInt(x, 10));

  const n = Math.min(cells.length, heights.length, periods.length, directions.length);
  const out: WisukiCell[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      dayName: cells[i].dayName,
      dayNum: cells[i].dayNum,
      hour: cells[i].hour,
      height: heights[i],
      period: periods[i],
      direction: directions[i],
    });
  }
  return out;
}

function angularDiff(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function omIndexBy(om: any): Map<string, { picked: { height: number; period: number; direction: number } }> {
  const h = om.hourly;
  const out = new Map<string, any>();
  for (let i = 0; i < h.time.length; i++) {
    const t: string = h.time[i]; // YYYY-MM-DDTHH:MM in Asia/Jakarta
    const day = parseInt(t.slice(8, 10), 10);
    const hr = parseInt(t.slice(11, 13), 10);
    const picked = pickSurfSwell(
      h.swell_wave_height?.[i] ?? 0,
      h.swell_wave_period?.[i] ?? 0,
      h.swell_wave_direction?.[i] ?? 0,
      h.secondary_swell_wave_height?.[i],
      h.secondary_swell_wave_period?.[i],
      h.secondary_swell_wave_direction?.[i],
    );
    out.set(`${day}-${hr}`, { picked });
  }
  return out;
}

async function main() {
  const [html, om] = await Promise.all([fetchWisukiHtml(), fetchOMNext()]);
  const wisuki = parseWisuki(html);
  const omIdx = omIndexBy(om);

  console.log(`Wisuki cells parsed: ${wisuki.length}`);

  // Rating-bin classification used by surfable.ts (Teleng Ria thresholds —
  // the strictest swell-direction window and most permissive period thresholds
  // among the three spots, so this is the most-relevant single yardstick).
  const periodBin = (p: number): "red" | "yellow" | "green" =>
    p < 5 ? "red" : p < 7 ? "yellow" : "green";
  const dirBin = (d: number): "red" | "yellow" | "green" => {
    // Teleng Ria ideal 215°, green ±25°, yellow ±45°
    const raw = Math.abs(d - 215) % 360;
    const off = raw > 180 ? 360 - raw : raw;
    return off > 45 ? "red" : off <= 25 ? "green" : "yellow";
  };

  let nDay = 0, dirOK = 0, perOK = 0, bothOK = 0, htOK = 0, ratingOK = 0;
  const disagree: any[] = [];
  for (const cell of wisuki) {
    if (cell.hour < 6 || cell.hour > 17) continue; // daylight WIB only
    const key = `${cell.dayNum}-${cell.hour}`;
    const o = omIdx.get(key);
    if (!o) continue;
    nDay++;
    const dDelta = angularDiff(cell.direction, o.picked.direction);
    const pDelta = Math.abs(cell.period - o.picked.period);
    const hRel = Math.abs(cell.height - o.picked.height) / Math.max(cell.height, 0.1);
    const dOK = dDelta <= 30;
    const pOK = pDelta <= 3;
    const hOK = hRel <= 0.6; // height usually differs (total vs picked component)
    if (dOK) dirOK++;
    if (pOK) perOK++;
    if (hOK) htOK++;
    if (dOK && pOK) bothOK++;
    // Surfable rating equivalence (Teleng Ria bins)
    if (periodBin(cell.period) === periodBin(o.picked.period) &&
        dirBin(cell.direction)  === dirBin(o.picked.direction)) ratingOK++;
    if (!dOK || !pOK) disagree.push({
      day: `${cell.dayName} ${cell.dayNum}`, hr: cell.hour,
      wisuki: `${cell.height}m ${cell.period}s ${cell.direction}°`,
      om: `${o.picked.height.toFixed(2)}m ${o.picked.period.toFixed(1)}s ${o.picked.direction}°`,
      dD: dDelta.toFixed(0), pD: pDelta.toFixed(1),
    });
  }

  console.log(`\nDaylight 3h-cells compared: ${nDay}`);
  console.log(`DIRECTION  (within 30°): ${((dirOK/nDay)*100).toFixed(1)}%  (${dirOK}/${nDay})`);
  console.log(`PERIOD     (within 3s):  ${((perOK/nDay)*100).toFixed(1)}%  (${perOK}/${nDay})`);
  console.log(`HEIGHT     (within 60%): ${((htOK/nDay)*100).toFixed(1)}%  (${htOK}/${nDay})`);
  console.log(`BOTH d+p:                ${((bothOK/nDay)*100).toFixed(1)}%  (${bothOK}/${nDay})`);
  console.log(`SURFABLE RATING BIN:     ${((ratingOK/nDay)*100).toFixed(1)}%  (${ratingOK}/${nDay})  ← same green/yellow/red for swell`);

  console.log("\nDisagreements:");
  for (const d of disagree.slice(0, 30)) {
    console.log(`  ${d.day} ${d.hr}h  wisuki: ${d.wisuki}  om: ${d.om}  Δdir=${d.dD}° Δper=${d.pD}s`);
  }
  if (disagree.length > 30) console.log(`  ... +${disagree.length - 30} more`);

  const pass = (ratingOK / nDay) >= 0.9;
  console.log(`\n${pass ? "PASS" : "FAIL"}: target 90% surfable-rating-bin agreement, actual ${((ratingOK/nDay)*100).toFixed(1)}%`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(2);
});
