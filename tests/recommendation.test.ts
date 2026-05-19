import { describe, test, expect } from "bun:test";
import { buildUserPayload } from "../src/server/recommendation";
import type { ForecastDay } from "../src/shared/types";

function sampleForecast(overrides: Partial<ForecastDay> = {}): ForecastDay {
  return {
    date: "2026-05-20",
    location: { name: "Pacitan", lat: -8.22, lng: 111.13 },
    astronomy: { sunrise: "05:30", sunset: "17:30" },
    tideExtremes: [
      { time: "03:12", height: 0.4, type: "low" },
      { time: "09:45", height: 1.9, type: "high" },
      { time: "15:30", height: 0.2, type: "low" },
      { time: "21:15", height: 2.0, type: "high" },
    ],
    hourly: [
      {
        hour: 6,
        tide: { height: 1.0, rising: true },
        swell: { height: 1.5, period: 11, direction: 200 },
        wind: { speed: 8, direction: 30, gusts: 12 },
        weather: { temp: 27, condition: "clear", precipitation: 0 },
        surfable: { telengRia: "yellow", pancer: "green", pancerDoor: "green" },
      },
    ],
    ...overrides,
  };
}

describe("buildUserPayload", () => {
  test("tideRange is computed as max minus min of tideExtremes", () => {
    const payload = buildUserPayload(sampleForecast());
    expect(payload.tideRange).toBeCloseTo(1.8, 5); // 2.0 - 0.2
  });

  test("tideRange handles empty extremes gracefully", () => {
    const payload = buildUserPayload(sampleForecast({ tideExtremes: [] }));
    expect(payload.tideRange).toBe(0);
  });

  test("payload omits weather.temp from hourly entries", () => {
    const payload = buildUserPayload(sampleForecast());
    const h = payload.hourly[0];
    expect(h.weather).toEqual({ condition: "clear", precipitation: 0 });
    expect((h.weather as any).temp).toBeUndefined();
  });

  test("payload preserves surfable baseline ratings per hour", () => {
    const payload = buildUserPayload(sampleForecast());
    expect(payload.hourly[0].surfable).toEqual({
      telengRia: "yellow",
      pancer: "green",
      pancerDoor: "green",
    });
  });

  test("payload includes forDate, astronomy, tideExtremes verbatim", () => {
    const fc = sampleForecast();
    const payload = buildUserPayload(fc);
    expect(payload.forDate).toBe("2026-05-20");
    expect(payload.astronomy).toEqual(fc.astronomy);
    expect(payload.tideExtremes).toEqual(fc.tideExtremes);
  });
});
