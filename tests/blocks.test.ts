import { describe, expect, test } from "bun:test";
import {
  buildDaylightBlocks,
  averageBlock,
  bestWindowStartHour,
  getDefaultBlockIndex,
  type TimeBlock,
} from "../src/client/blocks";
import type { HourlyData } from "../src/shared/types";

function h(hour: number, opts: Partial<HourlyData> = {}): HourlyData {
  return {
    hour,
    tide: { height: 0, rising: true },
    swell: { height: 1, period: 10, direction: 200 },
    wind: { speed: 10, direction: 100, gusts: 12 },
    weather: { temp: 27, condition: "clear", precipitation: 0 },
    surfable: {},
    ...opts,
  };
}

const astro = { sunrise: "05:49", sunset: "17:28" };

describe("buildDaylightBlocks", () => {
  test("emits only 3h blocks overlapping daylight, with hours", () => {
    const hourly = Array.from({ length: 24 }, (_, i) => h(i));
    const blocks = buildDaylightBlocks(hourly, astro);
    // sunrise hour 5, sunset hour 17 → blocks [3-6),[6-9),[9-12),[12-15),[15-18)
    expect(blocks.map((b) => b.start)).toEqual([3, 6, 9, 12, 15]);
    expect(blocks[0].label).toBe("03:00 – 06:00");
    expect(blocks.every((b) => b.hours.length > 0)).toBe(true);
  });
});

describe("averageBlock", () => {
  test("averages swell/wind and rounds", () => {
    const hours = [
      h(9, { swell: { height: 1.0, period: 10, direction: 200 }, wind: { speed: 10, direction: 100, gusts: 12 } }),
      h(10, { swell: { height: 2.0, period: 12, direction: 210 }, wind: { speed: 20, direction: 110, gusts: 18 } }),
    ];
    const a = averageBlock(hours);
    expect(a.swell.height).toBe(1.5);
    expect(a.swell.period).toBe(11);
    expect(a.wind.speed).toBe(15);
    expect(a.wind.gusts).toBe(18); // max
  });
});

describe("bestWindowStartHour", () => {
  test("earliest green hour wins", () => {
    const hourly = [h(7, { surfable: { p: "yellow" } }), h(9, { surfable: { p: "green" } })];
    expect(bestWindowStartHour(hourly)).toBe(9);
  });
  test("falls back to earliest yellow when no green", () => {
    const hourly = [h(7, { surfable: { p: "red" } }), h(8, { surfable: { p: "yellow" } })];
    expect(bestWindowStartHour(hourly)).toBe(8);
  });
  test("null when all red", () => {
    expect(bestWindowStartHour([h(7, { surfable: { p: "red" } })])).toBeNull();
  });
});

describe("getDefaultBlockIndex", () => {
  const blocks: TimeBlock[] = [
    { start: 6, end: 9, label: "", hours: [] },
    { start: 9, end: 12, label: "", hours: [] },
    { start: 12, end: 15, label: "", hours: [] },
  ];
  test("today → block containing nowHour", () => {
    expect(getDefaultBlockIndex(blocks, true, null, 10)).toBe(1);
  });
  test("today past last block → last block", () => {
    expect(getDefaultBlockIndex(blocks, true, null, 20)).toBe(2);
  });
  test("future day → block containing bestWindowStart", () => {
    expect(getDefaultBlockIndex(blocks, false, 13, 0)).toBe(2);
  });
  test("future day no window → midday block", () => {
    expect(getDefaultBlockIndex(blocks, false, null, 0)).toBe(2);
  });
  test("empty blocks → 0", () => {
    expect(getDefaultBlockIndex([], true, null, 10)).toBe(0);
  });
});
