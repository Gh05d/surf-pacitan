import { describe, expect, test } from "bun:test";
import { travelBearing, swellLabel, windLabel, windCategoryColor } from "../src/client/map-overlay";

describe("travelBearing", () => {
  test("adds 180 and wraps", () => {
    expect(travelBearing(215)).toBe(35);
    expect(travelBearing(10)).toBe(190);
    expect(travelBearing(180)).toBe(0);
    expect(travelBearing(0)).toBe(180);
  });
});

describe("labels", () => {
  test("swellLabel = compass + height·period", () => {
    expect(swellLabel({ height: 1.04, period: 11.2, direction: 225 })).toBe("SW 1.0m·11s");
  });
  test("windLabel = compass + km/h", () => {
    expect(windLabel({ speed: 17.4, direction: 100, gusts: 20 })).toBe("E 17km/h");
  });
});

describe("windCategoryColor (facing 195)", () => {
  test("onshore (from 195) → red", () => {
    expect(windCategoryColor(195, 195)).toBe("#e06050");
  });
  test("offshore (from 15) → green", () => {
    expect(windCategoryColor(15, 195)).toBe("#2dd4a8");
  });
  test("cross-shore (from 105) → amber", () => {
    expect(windCategoryColor(105, 195)).toBe("#f0a830");
  });
});
