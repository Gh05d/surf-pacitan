import { describe, test, expect } from "bun:test";
import { computeCandidateWindows } from "../src/server/candidates";
import type { ForecastDay, HourlyData, SurfableRating } from "../src/shared/types";

interface HourSpec {
  h: number;
  p?: SurfableRating;   // pancer rating, default "red"
  pd?: SurfableRating;  // pancerDoor rating, default "red"
  tr?: SurfableRating;  // telengRia rating, default "red"
  rising?: boolean;     // default false
  wind?: number;        // km/h, default 10
}

function dayWith(hours: HourSpec[]): ForecastDay {
  const hourly: HourlyData[] = hours.map((s) => ({
    hour: s.h,
    tide: { height: 0, rising: s.rising ?? false },
    swell: { height: 1.5, period: 12, direction: 200 },
    wind: { speed: s.wind ?? 10, direction: 100, gusts: (s.wind ?? 10) + 5 },
    weather: { temp: 27, condition: "clear", precipitation: 0 },
    surfable: { telengRia: s.tr ?? "red", pancer: s.p ?? "red", pancerDoor: s.pd ?? "red" },
  }));
  return {
    date: "2026-06-08",
    location: { name: "Pacitan", lat: -8.22, lng: 111.13 },
    astronomy: { sunrise: "05:43", sunset: "17:24" },
    tideExtremes: [],
    hourly,
  };
}

describe("computeCandidateWindows", () => {
  test("regression: real 2026-06-08 ratings produce TR 10-12 > pancer 08-10 > PD 08-10", () => {
    // Transcribed from the live forecast that motivated this feature
    // (columns: pancer, pancerDoor, telengRia).
    const day = dayWith([
      { h: 5,  p: "yellow", pd: "yellow", tr: "yellow", rising: false, wind: 11 },
      { h: 6,  p: "yellow", pd: "yellow", tr: "yellow", rising: false, wind: 10 },
      { h: 7,  p: "yellow", pd: "yellow", tr: "red",    rising: false, wind: 12 },
      { h: 8,  p: "green",  pd: "yellow", tr: "yellow", rising: true,  wind: 17 },
      { h: 9,  p: "yellow", pd: "yellow", tr: "yellow", rising: true,  wind: 20 },
      { h: 10, p: "yellow", pd: "yellow", tr: "green",  rising: true,  wind: 20 },
      { h: 11, p: "yellow", pd: "yellow", tr: "green",  rising: true,  wind: 22 },
      { h: 12, p: "red",    pd: "yellow", tr: "yellow", rising: true,  wind: 21 },
      { h: 13, p: "red",    pd: "yellow", tr: "yellow", rising: true,  wind: 21 },
      { h: 14, p: "red",    pd: "yellow", tr: "yellow", rising: false, wind: 21 },
      { h: 15, p: "red",    pd: "yellow", tr: "yellow", rising: false, wind: 22 },
      { h: 16, p: "yellow", pd: "yellow", tr: "yellow", rising: false, wind: 17 },
      { h: 17, p: "red",    pd: "red",    tr: "red",    rising: false, wind: 10 },
      { h: 18, p: "red",    pd: "red",    tr: "red",    rising: false, wind: 9 },
    ]);
    const c = computeCandidateWindows(day);
    expect(c).toEqual([
      { rank: 1, spot: "telengRia",  start: "10:00", end: "12:00", ratings: "10g 11g", greens: 2, risingShare: 1, meanWind: 21 },
      { rank: 2, spot: "pancer",     start: "08:00", end: "10:00", ratings: "08g 09y", greens: 1, risingShare: 1, meanWind: 19 },
      { rank: 3, spot: "pancerDoor", start: "08:00", end: "10:00", ratings: "08y 09y", greens: 0, risingShare: 1, meanWind: 19 },
    ]);
  });

  test("denser green window beats longer window with same green count", () => {
    const day = dayWith([
      { h: 8, p: "green" },
      { h: 9, p: "green" },
      { h: 10, p: "yellow" },
    ]);
    const c = computeCandidateWindows(day);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ spot: "pancer", start: "08:00", end: "10:00", greens: 2 });
  });

  test("more greens beats denser: 3-green 3h window wins over 2-green 2h", () => {
    const day = dayWith([
      { h: 8, p: "green" },
      { h: 9, p: "green" },
      { h: 10, p: "green" },
    ]);
    const c = computeCandidateWindows(day);
    expect(c[0]).toMatchObject({ start: "08:00", end: "11:00", greens: 3 });
  });

  test("isolated single non-red hour falls back to a 1h window", () => {
    const day = dayWith([
      { h: 7, p: "red" },
      { h: 8, p: "green" },
      { h: 9, p: "red" },
    ]);
    const c = computeCandidateWindows(day);
    expect(c).toEqual([
      { rank: 1, spot: "pancer", start: "08:00", end: "09:00", ratings: "08g", greens: 1, risingShare: 0, meanWind: 10 },
    ]);
  });

  test("fully red day yields no candidates", () => {
    const day = dayWith([{ h: 8 }, { h: 9 }, { h: 10 }]);
    expect(computeCandidateWindows(day)).toEqual([]);
  });

  test("complete tie between spots resolves west-to-east (telengRia first)", () => {
    const day = dayWith([
      { h: 8, tr: "green", p: "green" },
      { h: 9, tr: "green", p: "green" },
    ]);
    const c = computeCandidateWindows(day);
    expect(c.map((x) => x.spot)).toEqual(["telengRia", "pancer"]);
    expect(c.map((x) => x.rank)).toEqual([1, 2]);
  });

  test("rising-tide share breaks green ties", () => {
    const day = dayWith([
      { h: 6, p: "green", rising: false },
      { h: 7, p: "green", rising: false },
      { h: 8 }, // red gap
      { h: 10, p: "green", rising: true },
      { h: 11, p: "green", rising: true },
    ]);
    const c = computeCandidateWindows(day);
    expect(c[0]).toMatchObject({ start: "10:00", end: "12:00", risingShare: 1 });
  });

  test("lower mean wind breaks rising ties", () => {
    const day = dayWith([
      { h: 6, p: "green", wind: 20 },
      { h: 7, p: "green", wind: 20 },
      { h: 8 }, // red gap
      { h: 10, p: "green", wind: 8 },
      { h: 11, p: "green", wind: 8 },
    ]);
    const c = computeCandidateWindows(day);
    expect(c[0]).toMatchObject({ start: "10:00", end: "12:00", meanWind: 8 });
  });

  test("earlier start breaks full ties", () => {
    const day = dayWith([
      { h: 6, p: "green" },
      { h: 7, p: "green" },
      { h: 8 }, // red gap
      { h: 10, p: "green" },
      { h: 11, p: "green" },
    ]);
    const c = computeCandidateWindows(day);
    expect(c[0]).toMatchObject({ start: "06:00", end: "08:00" });
  });

  test("shorter window wins a full tie (endHour tie-break)", () => {
    const day = dayWith([
      { h: 8, p: "yellow" },
      { h: 9, p: "yellow" },
      { h: 10, p: "yellow" },
    ]);
    const c = computeCandidateWindows(day);
    expect(c[0]).toMatchObject({ start: "08:00", end: "10:00" });
  });

  test("an isolated 1h green is not considered when a >=2h non-red run exists", () => {
    // Run-length precedence is a product decision (see 2026-06-07 spec): the 1h
    // fallback only applies when NO run reaches length 2 — even if the isolated
    // hour is green and the longer run is all yellow.
    const day = dayWith([
      { h: 6, p: "green" },
      { h: 7 }, // red gap
      { h: 9, p: "yellow" },
      { h: 10, p: "yellow" },
    ]);
    const c = computeCandidateWindows(day);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ start: "09:00", end: "11:00", greens: 0 });
  });
});

import { bestRemainingWindow } from "../src/shared/candidates";

describe("variable spot count (region-packs)", () => {
  // Self-contained forecast builder — independent of this file's other helpers.
  function mkForecast(hours: number[], surfable: Record<string, SurfableRating>): ForecastDay {
    return {
      date: "2026-06-13",
      location: { name: "Test", lat: 0, lng: 0 },
      astronomy: { sunrise: "05:30", sunset: "17:30" },
      tideExtremes: [],
      hourly: hours.map((hour) => ({
        hour,
        tide: { height: 1, rising: true },
        swell: { height: 1.5, period: 12, direction: 210 },
        wind: { speed: 5, direction: 10, gusts: 8 },
        weather: { temp: 28, condition: "clear", precipitation: 0 },
        surfable: { ...surfable },
      })),
    };
  }

  test("ranks windows for a 4-spot order and respects tiebreak order", () => {
    const surfable: Record<string, SurfableRating> = {
      alpha: "green", bravo: "green", charlie: "green", delta: "red",
    };
    const forecast = mkForecast([8, 9, 10, 11], surfable);
    const order = ["alpha", "bravo", "charlie", "delta"];
    const candidates = computeCandidateWindows(forecast, order);
    // alpha, bravo, charlie tie on every metric → resolved by spot order
    expect(candidates.map((c) => c.spot)).toEqual(["alpha", "bravo", "charlie"]);
    expect(candidates.map((c) => c.rank)).toEqual([1, 2, 3]);
  });

  test("single-spot order yields at most one candidate", () => {
    const forecast = mkForecast([8, 9, 10], { solo: "green" });
    const candidates = computeCandidateWindows(forecast, ["solo"]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].spot).toBe("solo");
  });
});

describe("bestRemainingWindow", () => {
  const day = () =>
    dayWith([
      { h: 6, p: "green", pd: "yellow", tr: "yellow", rising: true, wind: 8 },
      { h: 7, p: "green", pd: "yellow", tr: "yellow", rising: true, wind: 9 },
      { h: 8, p: "yellow", pd: "yellow", tr: "yellow", rising: true, wind: 12 },
      { h: 14, p: "red", pd: "yellow", tr: "yellow", rising: true, wind: 15 },
      { h: 15, p: "red", pd: "yellow", tr: "green", rising: true, wind: 14 },
      { h: 16, p: "red", pd: "yellow", tr: "green", rising: false, wind: 13 },
    ]);

  test("fromHour 0 returns the day's overall rank 1", () => {
    const w = bestRemainingWindow(day(), 0);
    expect(w).toMatchObject({ spot: "pancer", start: "06:00", end: "08:00" });
  });

  test("hours before fromHour never appear (morning green excluded after noon)", () => {
    const w = bestRemainingWindow(day(), 14);
    expect(w).toMatchObject({ spot: "telengRia", start: "15:00" });
    expect(parseInt(w!.start, 10)).toBeGreaterThanOrEqual(14);
  });

  test("returns null when no hours remain", () => {
    expect(bestRemainingWindow(day(), 20)).toBeNull();
  });

  test("returns null when only red hours remain", () => {
    const d = dayWith([{ h: 16, p: "red", pd: "red", tr: "red" }]);
    expect(bestRemainingWindow(d, 10)).toBeNull();
  });
});
