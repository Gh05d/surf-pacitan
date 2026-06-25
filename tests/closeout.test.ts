import { describe, expect, test } from "bun:test";
import { closeoutRisk, closeoutWarningForPick, closeoutSpotsForHours, type CloseoutThresholds } from "../src/shared/closeout";
import type { ForecastDay, HourlyData } from "../src/shared/types";

const T: CloseoutThresholds = { tideHeightMax: 0.1, periodMin: 9, swellHeightMin: 0.6 };

function hour(tideHeight: number, period: number, height: number) {
  return {
    tide: { height: tideHeight, rising: true },
    swell: { height, period, direction: 207 },
  };
}

describe("closeoutRisk", () => {
  test("fires on a yesterday-like hour (shallow tide, long period, real size)", () => {
    expect(closeoutRisk(hour(0.0, 11, 1.0), T)).toBe(true);
  });

  test("no risk when the tide is deep", () => {
    expect(closeoutRisk(hour(0.5, 11, 1.0), T)).toBe(false);
  });

  test("no risk on short-period swell", () => {
    expect(closeoutRisk(hour(0.0, 7, 1.0), T)).toBe(false);
  });

  test("no risk below the swell-height floor", () => {
    expect(closeoutRisk(hour(0.0, 11, 0.4), T)).toBe(false);
  });

  test("no config → never flags", () => {
    expect(closeoutRisk(hour(0.0, 11, 1.0), undefined)).toBe(false);
  });

  test("boundaries are inclusive (exactly at the cutoffs flags)", () => {
    expect(closeoutRisk(hour(0.1, 9, 0.6), T)).toBe(true);
  });

  test("swellHeightMin omitted → height gate is skipped", () => {
    const noFloor: CloseoutThresholds = { tideHeightMax: 0.1, periodMin: 9 };
    expect(closeoutRisk(hour(0.0, 11, 0.1), noFloor)).toBe(true);
  });
});

function mkHour(h: number, tideHeight: number, period: number, height: number): HourlyData {
  return {
    hour: h,
    tide: { height: tideHeight, rising: true },
    swell: { height, period, direction: 207 },
    wind: { speed: 10, direction: 130, gusts: 15 },
    weather: { temp: 27, condition: "clear", precipitation: 0 },
    surfable: {},
  };
}

const DAY: ForecastDay = {
  date: "2026-06-25",
  location: { name: "Pacitan", lat: -8.22, lng: 111.13 },
  astronomy: { sunrise: "05:49", sunset: "17:28" },
  tideExtremes: [],
  // 14:00 deep, 15:00–16:00 shallow long-period (flag), 17:00 deep
  hourly: [
    mkHour(14, 0.5, 11, 1.0),
    mkHour(15, 0.0, 11, 1.0),
    mkHour(16, -0.02, 11, 1.0),
    mkHour(17, 0.4, 11, 1.0),
  ],
};

describe("closeoutWarningForPick", () => {
  test("returns a warning when the window overlaps a flagged hour", () => {
    const w = closeoutWarningForPick(DAY, "pancer", { start: "15:00", end: "17:00" }, T);
    expect(w).toBeTruthy();
    expect(w!.length).toBeLessThanOrEqual(200);
  });

  test("returns null when the window is entirely in deep water", () => {
    expect(closeoutWarningForPick(DAY, "pancer", { start: "17:00", end: "18:00" }, T)).toBeNull();
  });

  test("returns null without config", () => {
    expect(closeoutWarningForPick(DAY, "pancer", { start: "15:00", end: "17:00" }, undefined)).toBeNull();
  });
});

describe("closeoutSpotsForHours", () => {
  test("lists only the configured spots that flag in the given hours", () => {
    const flaggedHours = [DAY.hourly[1], DAY.hourly[2]]; // 15:00, 16:00
    const spots = [
      { id: "telengRia", closeout: undefined },
      { id: "pancerDoor", closeout: T },
      { id: "pancer", closeout: T },
    ];
    expect(closeoutSpotsForHours(flaggedHours, spots)).toEqual(["pancerDoor", "pancer"]);
  });

  test("returns [] when no hour flags", () => {
    const spots = [{ id: "pancer", closeout: T }];
    expect(closeoutSpotsForHours([DAY.hourly[3]], spots)).toEqual([]); // 17:00 deep
  });
});
