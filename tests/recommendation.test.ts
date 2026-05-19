import { describe, test, expect, mock } from "bun:test";
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

import { validateRecommendation } from "../src/server/recommendation";

function validRecRaw() {
  return {
    bestSpot: "pancerDoor",
    bestWindow: { start: "06:00", end: "09:00" },
    headline: "Pancer Door am besten morgens 06:00–09:00.",
    reasoning: "SW-Swell 1.8m@12s trifft auf steigende Tide. Wind dreht um 10:00 onshore — früh los.",
    warnings: ["Tide-Range nur 1.3m (Nipptide)"],
  };
}

describe("validateRecommendation", () => {
  test("accepts a valid recommendation", () => {
    const result = validateRecommendation(validRecRaw());
    expect(result.ok).toBe(true);
  });

  test("rejects invalid spot name", () => {
    const result = validateRecommendation({ ...validRecRaw(), bestSpot: "unknownBeach" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/bestSpot/);
  });

  test("rejects window with end before start", () => {
    const result = validateRecommendation({ ...validRecRaw(), bestWindow: { start: "09:00", end: "06:00" } });
    expect(result.ok).toBe(false);
  });

  test("rejects window with non-HH:MM string", () => {
    const result = validateRecommendation({ ...validRecRaw(), bestWindow: { start: "morning", end: "09:00" } });
    expect(result.ok).toBe(false);
  });

  test("rejects window with hour > 23", () => {
    const result = validateRecommendation({ ...validRecRaw(), bestWindow: { start: "06:00", end: "25:00" } });
    expect(result.ok).toBe(false);
  });

  test("rejects empty reasoning", () => {
    const result = validateRecommendation({ ...validRecRaw(), reasoning: "" });
    expect(result.ok).toBe(false);
  });

  test("rejects reasoning longer than 600 chars", () => {
    const long = "x".repeat(601);
    const result = validateRecommendation({ ...validRecRaw(), reasoning: long });
    expect(result.ok).toBe(false);
  });

  test("rejects warning string longer than 200 chars", () => {
    const long = "y".repeat(201);
    const result = validateRecommendation({ ...validRecRaw(), warnings: [long] });
    expect(result.ok).toBe(false);
  });

  test("accepts empty warnings array", () => {
    const result = validateRecommendation({ ...validRecRaw(), warnings: [] });
    expect(result.ok).toBe(true);
  });

  test("rejects missing required field", () => {
    const r: any = validRecRaw();
    delete r.headline;
    const result = validateRecommendation(r);
    expect(result.ok).toBe(false);
  });
});

import { generateTomorrowRecommendation, type GenerateDeps } from "../src/server/recommendation";
import type { Recommendation } from "../src/shared/types";

function frozenNow(): Date {
  // 2026-05-19 20:00 WIB = 13:00 UTC
  return new Date("2026-05-19T13:00:00Z");
}

function validModelResponse() {
  return {
    bestSpot: "pancerDoor",
    bestWindow: { start: "06:00", end: "09:00" },
    headline: "Pancer Door am besten morgens.",
    reasoning: "Steigende Tide trifft Offshore-Wind und sauberen SW-Swell.",
    warnings: [],
  };
}

function makeDeps(overrides: Partial<GenerateDeps> = {}): GenerateDeps {
  return {
    getCachedDay: mock(async () => sampleForecast({ date: "2026-05-20" })),
    setRecommendation: mock(async () => {}),
    callDeepSeek: mock(async () => ({
      content: validModelResponse(),
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    })),
    now: () => frozenNow(),
    apiKey: "sk-test",
    model: "deepseek-v4-flash",
    thinking: true,
    timeoutMs: 5000,
    ...overrides,
  };
}

describe("generateTomorrowRecommendation", () => {
  test("computes tomorrow as today (WIB) + 1 and looks up that forecast", async () => {
    const getCachedDay = mock(async () => sampleForecast({ date: "2026-05-20" }));
    await generateTomorrowRecommendation(makeDeps({ getCachedDay }));
    expect(getCachedDay).toHaveBeenCalledTimes(1);
    expect((getCachedDay as any).mock.calls[0][0]).toBe("2026-05-20");
  });

  test("skips when forecast for tomorrow is missing", async () => {
    const getCachedDay = mock(async () => null);
    const setRecommendation = mock(async () => {});
    const callDeepSeek = mock(async () => ({ content: {}, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
    await generateTomorrowRecommendation(makeDeps({ getCachedDay, setRecommendation, callDeepSeek }));
    expect(callDeepSeek).not.toHaveBeenCalled();
    expect(setRecommendation).not.toHaveBeenCalled();
  });

  test("on success writes a complete Recommendation to cache", async () => {
    const captured: Recommendation[] = [];
    const setRecommendation = mock(async (rec: Recommendation) => { captured.push(rec); });
    await generateTomorrowRecommendation(makeDeps({ setRecommendation }));
    expect(captured).toHaveLength(1);
    const rec = captured[0];
    expect(rec.forDate).toBe("2026-05-20");
    expect(rec.bestSpot).toBe("pancerDoor");
    expect(rec.bestWindow).toEqual({ start: "06:00", end: "09:00" });
    expect(rec.modelUsed).toBe("deepseek-v4-flash");
    expect(rec.generatedAt).toBe(frozenNow().toISOString());
  });

  test("does NOT overwrite cache when DeepSeek throws", async () => {
    const setRecommendation = mock(async () => {});
    const callDeepSeek = mock(async () => { throw new Error("boom"); });
    await generateTomorrowRecommendation(makeDeps({ setRecommendation, callDeepSeek }));
    expect(setRecommendation).not.toHaveBeenCalled();
  });

  test("retries once when validation fails on first response, succeeds second", async () => {
    let nthCall = 0;
    const callDeepSeek = mock(async () => {
      nthCall += 1;
      if (nthCall === 1) {
        return { content: { bestSpot: "notARealSpot" }, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
      }
      return { content: validModelResponse(), usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
    });
    const setRecommendation = mock(async () => {});
    await generateTomorrowRecommendation(makeDeps({ callDeepSeek, setRecommendation }));
    expect(callDeepSeek).toHaveBeenCalledTimes(2);
    expect(setRecommendation).toHaveBeenCalledTimes(1);
  });

  test("does NOT overwrite cache when both attempts fail validation", async () => {
    const callDeepSeek = mock(async () => ({
      content: { bestSpot: "notARealSpot" },
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }));
    const setRecommendation = mock(async () => {});
    await generateTomorrowRecommendation(makeDeps({ callDeepSeek, setRecommendation }));
    expect(callDeepSeek).toHaveBeenCalledTimes(2);
    expect(setRecommendation).not.toHaveBeenCalled();
  });

  test("skips when apiKey is empty (defensive)", async () => {
    const callDeepSeek = mock(async () => ({ content: {}, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
    const setRecommendation = mock(async () => {});
    await generateTomorrowRecommendation(makeDeps({ apiKey: "", callDeepSeek, setRecommendation }));
    expect(callDeepSeek).not.toHaveBeenCalled();
    expect(setRecommendation).not.toHaveBeenCalled();
  });
});
