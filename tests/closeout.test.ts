import { describe, expect, test } from "bun:test";
import { closeoutRisk, type CloseoutThresholds } from "../src/shared/closeout";

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
