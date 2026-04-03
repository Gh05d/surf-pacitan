import { describe, test, expect } from "bun:test";
import {
  parseTideExtremes,
  parseSeaLevels,
  parseWeather,
  parseAstronomy,
} from "../src/server/stormglass";

describe("parseTideExtremes", () => {
  test("parses high/low tides with timezone conversion", () => {
    const raw = {
      data: [
        { height: 1.18, time: "2026-04-03T20:40:00+00:00", type: "high" },
        { height: -0.32, time: "2026-04-03T02:55:00+00:00", type: "low" },
      ],
    };
    const result = parseTideExtremes(raw, "2026-04-03");
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("high");
    expect(result[0].height).toBe(1.18);
    expect(result[0].time).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("parseSeaLevels", () => {
  test("parses hourly sea level values", () => {
    const raw = {
      data: [
        { sg: 0.62, time: "2026-04-03T00:00:00+00:00" },
        { sg: 0.85, time: "2026-04-03T01:00:00+00:00" },
        { sg: 1.1, time: "2026-04-03T02:00:00+00:00" },
      ],
    };
    const result = parseSeaLevels(raw, "2026-04-03");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]).toHaveProperty("hour");
    expect(result[0]).toHaveProperty("height");
    expect(result[0]).toHaveProperty("rising");
  });

  test("detects rising vs falling tide", () => {
    const raw = {
      data: [
        { sg: 0.5, time: "2026-04-03T00:00:00+00:00" },
        { sg: 0.8, time: "2026-04-03T01:00:00+00:00" },
        { sg: 0.6, time: "2026-04-03T02:00:00+00:00" },
      ],
    };
    const result = parseSeaLevels(raw, "2026-04-03");
    expect(result[0].rising).toBe(true);
    expect(result[1].rising).toBe(true);
    expect(result[2].rising).toBe(false);
  });
});

describe("parseWeather", () => {
  test("parses hourly weather from sg source", () => {
    const raw = {
      hours: [
        {
          time: "2026-04-03T00:00:00+00:00",
          swellHeight: { sg: 1.2 },
          swellPeriod: { sg: 12 },
          swellDirection: { sg: 210 },
          windSpeed: { sg: 2.5 },
          windDirection: { sg: 135 },
          gust: { sg: 4.1 },
          airTemperature: { sg: 28 },
          precipitation: { sg: 0 },
          cloudCover: { sg: 45 },
        },
      ],
    };
    const result = parseWeather(raw, "2026-04-03");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].swell.height).toBe(1.2);
    expect(result[0].swell.period).toBe(12);
    expect(result[0].swell.direction).toBe(210);
    expect(result[0].wind.speed).toBeCloseTo(9, 0);
    expect(result[0].wind.gusts).toBeCloseTo(14.76, 0);
    expect(result[0].weather.temp).toBe(28);
    expect(result[0].weather.precipitation).toBe(0);
  });
});

describe("parseAstronomy", () => {
  test("parses sunrise and sunset", () => {
    const raw = {
      data: [
        {
          time: "2026-04-03T00:00:00+00:00",
          sunrise: "2026-04-02T22:42:00+00:00",
          sunset: "2026-04-03T10:31:00+00:00",
        },
      ],
    };
    const result = parseAstronomy(raw);
    expect(result.sunrise).toMatch(/^\d{2}:\d{2}$/);
    expect(result.sunset).toMatch(/^\d{2}:\d{2}$/);
  });
});
