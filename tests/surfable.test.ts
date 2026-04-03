import { describe, test, expect } from "bun:test";
import { computeSurfable } from "../src/server/surfable";

describe("computeSurfable", () => {
  const sunrise = "05:42";
  const sunset = "17:31";

  test("green: rising tide > 50%, good swell, light wind, daylight", () => {
    const result = computeSurfable({
      hour: 9,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.2,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("green");
  });

  test("green: falling tide > 80%, good swell, light wind", () => {
    const result = computeSurfable({
      hour: 11,
      tidePercent: 85,
      tideRising: false,
      swellHeight: 0.8,
      windSpeed: 15,
      sunrise,
      sunset,
    });
    expect(result).toBe("green");
  });

  test("yellow: mid tide 30-50% rising", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 40,
      tideRising: true,
      swellHeight: 0.8,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("yellow");
  });

  test("yellow: good tide but marginal swell 0.3-0.5m", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 0.4,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("yellow");
  });

  test("yellow: good tide/swell but wind 20-30 km/h", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 25,
      sunrise,
      sunset,
    });
    expect(result).toBe("yellow");
  });

  test("red: low tide < 30%", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 15,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("red: flat swell < 0.3m", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 0.2,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("red: blown out wind > 30 km/h", () => {
    const result = computeSurfable({
      hour: 10,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 35,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("red: outside daylight (before sunrise)", () => {
    const result = computeSurfable({
      hour: 4,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("red: outside daylight (after sunset)", () => {
    const result = computeSurfable({
      hour: 18,
      tidePercent: 70,
      tideRising: true,
      swellHeight: 1.0,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("red");
  });

  test("yellow: falling tide 50-80% range", () => {
    const result = computeSurfable({
      hour: 12,
      tidePercent: 60,
      tideRising: false,
      swellHeight: 1.0,
      windSpeed: 10,
      sunrise,
      sunset,
    });
    expect(result).toBe("yellow");
  });
});
