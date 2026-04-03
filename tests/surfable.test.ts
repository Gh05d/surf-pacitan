import { describe, test, expect } from "bun:test";
import { computeSurfable, computeAllSpotRatings } from "../src/server/surfable";

describe("computeSurfable", () => {
  const sunrise = "05:42";
  const sunset = "17:31";

  test("green: rising tide > 50%, good swell, light wind, daylight", () => {
    expect(computeSurfable({ hour: 9, tidePercent: 70, tideRising: true, swellHeight: 1.2, windSpeed: 10, sunrise, sunset })).toBe("green");
  });

  test("green: falling tide > 80%, good swell, light wind", () => {
    expect(computeSurfable({ hour: 11, tidePercent: 85, tideRising: false, swellHeight: 0.8, windSpeed: 15, sunrise, sunset })).toBe("green");
  });

  test("yellow: mid tide 30-50% rising", () => {
    expect(computeSurfable({ hour: 10, tidePercent: 40, tideRising: true, swellHeight: 0.8, windSpeed: 10, sunrise, sunset })).toBe("yellow");
  });

  test("yellow: good tide but marginal swell 0.3-0.5m", () => {
    expect(computeSurfable({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 0.4, windSpeed: 10, sunrise, sunset })).toBe("yellow");
  });

  test("yellow: good tide/swell but wind 20-30 km/h", () => {
    expect(computeSurfable({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 25, sunrise, sunset })).toBe("yellow");
  });

  test("red: low tide < 30%", () => {
    expect(computeSurfable({ hour: 10, tidePercent: 15, tideRising: true, swellHeight: 1.0, windSpeed: 10, sunrise, sunset })).toBe("red");
  });

  test("red: flat swell < 0.3m", () => {
    expect(computeSurfable({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 0.2, windSpeed: 10, sunrise, sunset })).toBe("red");
  });

  test("red: blown out wind > 30 km/h", () => {
    expect(computeSurfable({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 35, sunrise, sunset })).toBe("red");
  });

  test("red: outside daylight (before sunrise)", () => {
    expect(computeSurfable({ hour: 4, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 10, sunrise, sunset })).toBe("red");
  });

  test("red: outside daylight (after sunset)", () => {
    expect(computeSurfable({ hour: 18, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 10, sunrise, sunset })).toBe("red");
  });

  test("yellow: falling tide 50-80% range", () => {
    expect(computeSurfable({ hour: 12, tidePercent: 60, tideRising: false, swellHeight: 1.0, windSpeed: 10, sunrise, sunset })).toBe("yellow");
  });
});

describe("computeAllSpotRatings", () => {
  const sunrise = "05:42";
  const sunset = "17:31";

  test("Teleng Ria is more tolerant than Pancer Door at mid-tide", () => {
    const result = computeAllSpotRatings({ hour: 10, tidePercent: 30, tideRising: true, swellHeight: 0.8, windSpeed: 10, sunrise, sunset });
    expect(result.telengRia).toBe("green");
    expect(result.pancer).toBe("yellow");
    expect(result.pancerDoor).toBe("yellow");
  });

  test("all spots red when flat", () => {
    const result = computeAllSpotRatings({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 0.1, windSpeed: 10, sunrise, sunset });
    expect(result.telengRia).toBe("red");
    expect(result.pancer).toBe("red");
    expect(result.pancerDoor).toBe("red");
  });

  test("all spots green in ideal conditions", () => {
    const result = computeAllSpotRatings({ hour: 10, tidePercent: 85, tideRising: true, swellHeight: 1.5, windSpeed: 5, sunrise, sunset });
    expect(result.telengRia).toBe("green");
    expect(result.pancer).toBe("green");
    expect(result.pancerDoor).toBe("green");
  });

  test("Teleng Ria tolerates more wind", () => {
    const result = computeAllSpotRatings({ hour: 10, tidePercent: 70, tideRising: true, swellHeight: 1.0, windSpeed: 22, sunrise, sunset });
    expect(result.telengRia).toBe("green");
    expect(result.pancer).toBe("yellow");
    expect(result.pancerDoor).toBe("yellow");
  });
});
