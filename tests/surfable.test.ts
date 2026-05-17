import { describe, test, expect } from "bun:test";
import { computeSurfable, computeAllSpotRatings, getWindCategory, angularDistance, minQuality } from "../src/server/surfable";
import { SPOT_THRESHOLDS } from "../src/server/config";

describe("getWindCategory", () => {
  // Pancer Door faces 180° (south)
  const facing = 180;

  test("onshore: wind from south (180°) into south-facing beach", () => {
    expect(getWindCategory(180, facing)).toBe("onshore");
  });

  test("onshore: wind from SSW (200°) into south-facing beach — within 60°", () => {
    expect(getWindCategory(200, facing)).toBe("onshore");
  });

  test("offshore: wind from north (0°) — blows from land", () => {
    expect(getWindCategory(0, facing)).toBe("offshore");
  });

  test("offshore: wind from north (360°) — same as 0°", () => {
    expect(getWindCategory(360, facing)).toBe("offshore");
  });

  test("offshore: wind from NNE (30°) into south-facing beach", () => {
    expect(getWindCategory(30, facing)).toBe("offshore");
  });

  test("cross-shore: wind from east (90°)", () => {
    expect(getWindCategory(90, facing)).toBe("crossShore");
  });

  test("cross-shore: wind from west (270°)", () => {
    expect(getWindCategory(270, facing)).toBe("crossShore");
  });

  test("boundary: exactly 60° is cross-shore", () => {
    expect(getWindCategory(240, facing)).toBe("crossShore");
  });

  test("boundary: exactly 120° is cross-shore", () => {
    expect(getWindCategory(300, facing)).toBe("crossShore");
  });

  test("Pancer faces 200° SSW — wind from 200° is onshore", () => {
    expect(getWindCategory(200, 200)).toBe("onshore");
  });

  test("Pancer faces 200° SSW — wind from 20° (NNE) is offshore", () => {
    expect(getWindCategory(20, 200)).toBe("offshore");
  });
});

describe("angularDistance", () => {
  test("same direction", () => {
    expect(angularDistance(180, 180)).toBe(0);
  });
  test("small positive delta", () => {
    expect(angularDistance(200, 195)).toBe(5);
  });
  test("small negative delta", () => {
    expect(angularDistance(195, 200)).toBe(5);
  });
  test("wraparound at 0/360", () => {
    expect(angularDistance(350, 10)).toBe(20);
    expect(angularDistance(10, 350)).toBe(20);
  });
  test("opposite directions", () => {
    expect(angularDistance(0, 180)).toBe(180);
  });
  test("values > 360 (defensive)", () => {
    expect(angularDistance(370, 10)).toBe(0);
  });
});

describe("minQuality", () => {
  test("all green → green", () => {
    expect(minQuality(["green", "green", "green"])).toBe("green");
  });
  test("one yellow → yellow", () => {
    expect(minQuality(["green", "yellow", "green"])).toBe("yellow");
  });
  test("one red → red", () => {
    expect(minQuality(["green", "yellow", "red"])).toBe("red");
  });
  test("single value", () => {
    expect(minQuality(["yellow"])).toBe("yellow");
  });
});

describe("computeSurfable", () => {
  const sunrise = "05:42";
  const sunset = "17:31";

  test("green: rising tide > 50%, good swell, light wind, daylight", () => {
    expect(computeSurfable({ hour: 9, tidePercent: 70, tideRising: true, swellHeight: 1.2, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("green");
  });

  test("yellow: falling tide > 80% — falling is never green", () => {
    expect(computeSurfable({ hour: 11, tidePercent: 85, tideRising: false, swellHeight: 0.8, windSpeed: 15, windDirection: 0, sunrise, sunset })).toBe("yellow");
  });

  test("yellow: mid tide 30-50% rising", () => {
    expect(computeSurfable({ hour: 10, tidePercent: 40, tideRising: true, swellHeight: 0.8, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("yellow");
  });

  test("yellow: good tide but marginal swell 0.3-0.5m", () => {
    expect(computeSurfable({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 0.4, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("yellow");
  });

  test("yellow: good tide/swell but wind 20-30 km/h (cross-shore)", () => {
    // 90° = east = cross-shore for south-facing Pancer Door. crossShore greenMax=20, so 25 is yellow.
    expect(computeSurfable({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 25, windDirection: 90, sunrise, sunset })).toBe("yellow");
  });

  test("red: low tide < 30%", () => {
    expect(computeSurfable({ hour: 10, tidePercent: 15, tideRising: true, swellHeight: 1.0, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("red");
  });

  test("red: flat swell < 0.3m", () => {
    expect(computeSurfable({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 0.2, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("red");
  });

  test("red: blown out onshore wind > 20 km/h", () => {
    // 180° = south = onshore for south-facing Pancer Door. onshore yellowMax=20, so 25 is red.
    expect(computeSurfable({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 25, windDirection: 180, sunrise, sunset })).toBe("red");
  });

  test("red: outside daylight (before sunrise)", () => {
    expect(computeSurfable({ hour: 4, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("red");
  });

  test("red: outside daylight (after sunset)", () => {
    expect(computeSurfable({ hour: 18, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("red");
  });

  test("yellow: falling tide 50-80% range", () => {
    expect(computeSurfable({ hour: 12, tidePercent: 60, tideRising: false, swellHeight: 1.0, windSpeed: 10, windDirection: 0, sunrise, sunset })).toBe("yellow");
  });
});

describe("computeAllSpotRatings", () => {
  const sunrise = "05:42";
  const sunset = "17:31";

  test("Teleng Ria is more tolerant than Pancer Door at mid-tide", () => {
    const result = computeAllSpotRatings({ hour: 10, tidePercent: 30, tideRising: true, swellHeight: 0.8, windSpeed: 10, windDirection: 0, sunrise, sunset });
    expect(result.telengRia).toBe("green");
    expect(result.pancer).toBe("yellow");
    expect(result.pancerDoor).toBe("yellow");
  });

  test("all spots red when flat", () => {
    const result = computeAllSpotRatings({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 0.1, windSpeed: 10, windDirection: 0, sunrise, sunset });
    expect(result.telengRia).toBe("red");
    expect(result.pancer).toBe("red");
    expect(result.pancerDoor).toBe("red");
  });

  test("all spots green in ideal conditions", () => {
    const result = computeAllSpotRatings({ hour: 10, tidePercent: 85, tideRising: true, swellHeight: 1.5, windSpeed: 5, windDirection: 0, sunrise, sunset });
    expect(result.telengRia).toBe("green");
    expect(result.pancer).toBe("green");
    expect(result.pancerDoor).toBe("green");
  });

  test("Teleng Ria tolerates more wind (cross-shore)", () => {
    // 90° = cross-shore. Teleng Ria crossShore greenMax=25, Pancer/Door crossShore greenMax=20.
    const result = computeAllSpotRatings({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 22, windDirection: 90, sunrise, sunset });
    expect(result.telengRia).toBe("green");
    expect(result.pancer).toBe("yellow");
    expect(result.pancerDoor).toBe("yellow");
  });
});

describe("wind direction affects rating", () => {
  const sunrise = "05:42";
  const sunset = "17:31";
  // Base conditions: good tide, good swell, rising — only wind varies
  const base = { hour: 10, tidePercent: 70, tideRising: true, swellHeight: 1.0, sunrise, sunset };

  test("15 km/h onshore (180°) is yellow, same speed offshore (0°) is green", () => {
    // Pancer Door: onshore greenMax=10, offshore greenMax=30
    expect(computeSurfable({ ...base, windSpeed: 15, windDirection: 180 })).toBe("yellow");
    expect(computeSurfable({ ...base, windSpeed: 15, windDirection: 0 })).toBe("green");
  });

  test("25 km/h onshore (180°) is red, same speed offshore (0°) is green", () => {
    // Pancer Door: onshore yellowMax=20 → red; offshore greenMax=30 → green
    expect(computeSurfable({ ...base, windSpeed: 25, windDirection: 180 })).toBe("red");
    expect(computeSurfable({ ...base, windSpeed: 25, windDirection: 0 })).toBe("green");
  });

  test("25 km/h cross-shore (90°) is yellow", () => {
    // Pancer Door: crossShore greenMax=20, yellowMax=30 → yellow
    expect(computeSurfable({ ...base, windSpeed: 25, windDirection: 90 })).toBe("yellow");
  });

  test("40 km/h offshore (0°) is yellow, not red", () => {
    // Pancer Door: offshore greenMax=30, yellowMax=45 → yellow
    expect(computeSurfable({ ...base, windSpeed: 40, windDirection: 0 })).toBe("yellow");
  });

  test("50 km/h offshore (0°) is red — even offshore has limits", () => {
    // Pancer Door: offshore yellowMax=45 → red
    expect(computeSurfable({ ...base, windSpeed: 50, windDirection: 0 })).toBe("red");
  });

  test("Pancer (200° SSW facing) — wind from 200° is onshore", () => {
    // 15 km/h onshore: Pancer onshore greenMax=10 → yellow
    expect(computeSurfable({ ...base, windSpeed: 15, windDirection: 200 }, SPOT_THRESHOLDS.pancer)).toBe("yellow");
    // Same speed offshore (20°): Pancer offshore greenMax=30 → green
    expect(computeSurfable({ ...base, windSpeed: 15, windDirection: 20 }, SPOT_THRESHOLDS.pancer)).toBe("green");
  });
});
