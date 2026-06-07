import { describe, test, expect, mock } from "bun:test";
import { buildUserPayload } from "../src/server/recommendation";
import { computeCandidateWindows } from "../src/server/candidates";
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

  test("payload includes ranked candidateWindows", () => {
    const payload = buildUserPayload(sampleForecast());
    // sampleForecast has a single hour (06): pancer+pancerDoor green, telengRia
    // yellow → three 1h-fallback candidates; pancer/pancerDoor tie resolves
    // west-to-east, so pancerDoor ranks first.
    expect(payload.candidateWindows).toHaveLength(3);
    expect(payload.candidateWindows[0]).toMatchObject({
      rank: 1,
      spot: "pancerDoor",
      start: "06:00",
      end: "07:00",
      greens: 1,
    });
    expect(payload.candidateWindows[1].spot).toBe("pancer");
    expect(payload.candidateWindows[2].spot).toBe("telengRia");
  });
});

import { validateRecommendation } from "../src/server/recommendation";

function validRecRaw() {
  return {
    bestSpot: "pancerDoor",
    bestWindow: { start: "06:00", end: "09:00" },
    headline: "Pancer Door best in the morning 06:00–09:00.",
    reasoning: "SW swell 1.8m@12s meets rising tide. Wind flips onshore at 10:00 — get out early.",
    warnings: ["Tide range only 1.3m (neap)"],
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

describe("validateRecommendation with candidate context", () => {
  // pancerDoor green 06-07 → top candidate 06:00-08:00;
  // pancer green 09-10 → candidate 2 09:00-11:00; telengRia all red.
  function validationForecast(): ForecastDay {
    const mk = (h: number, p: "green" | "yellow" | "red", pd: "green" | "yellow" | "red") => ({
      hour: h,
      tide: { height: 0.5, rising: true },
      swell: { height: 1.5, period: 12, direction: 200 },
      wind: { speed: 10, direction: 100, gusts: 15 },
      weather: { temp: 27, condition: "clear", precipitation: 0 },
      surfable: { telengRia: "red" as const, pancer: p, pancerDoor: pd },
    });
    return sampleForecast({
      hourly: [
        mk(6, "yellow", "green"),
        mk(7, "yellow", "green"),
        mk(8, "yellow", "yellow"),
        mk(9, "green", "yellow"),
        mk(10, "green", "yellow"),
        mk(11, "yellow", "yellow"),
      ],
    });
  }

  function contextFor(forecast: ForecastDay) {
    return { candidates: computeCandidateWindows(forecast), forecast };
  }

  test("fixture sanity: top candidate is pancerDoor 06:00-08:00", () => {
    const ctx = contextFor(validationForecast());
    expect(ctx.candidates[0]).toMatchObject({ spot: "pancerDoor", start: "06:00", end: "08:00" });
    expect(ctx.candidates[1]).toMatchObject({ spot: "pancer", start: "09:00", end: "11:00" });
    expect(ctx.candidates).toHaveLength(2);
  });

  test("accepts a pick that follows the top candidate exactly, no overrideReason needed", () => {
    const f = validationForecast();
    const raw = { ...validRecRaw(), bestSpot: "pancerDoor", bestWindow: { start: "06:00", end: "08:00" } };
    const result = validateRecommendation(raw, contextFor(f));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.overrideReason).toBeUndefined();
  });

  test("accepts a pick within ±1h of the top candidate without overrideReason", () => {
    const f = validationForecast();
    const raw = { ...validRecRaw(), bestSpot: "pancerDoor", bestWindow: { start: "06:00", end: "09:00" } };
    expect(validateRecommendation(raw, contextFor(f)).ok).toBe(true);
  });

  test("rejects a deviation without overrideReason", () => {
    const f = validationForecast();
    const raw = { ...validRecRaw(), bestSpot: "pancer", bestWindow: { start: "09:00", end: "11:00" } };
    const result = validateRecommendation(raw, contextFor(f));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("overrideReason");
  });

  test("accepts a deviation with overrideReason and carries it through", () => {
    const f = validationForecast();
    const raw = {
      ...validRecRaw(),
      bestSpot: "pancer",
      bestWindow: { start: "09:00", end: "11:00" },
      overrideReason: "tide push stronger 09-11 while wind stays 10 km/h",
    };
    const result = validateRecommendation(raw, contextFor(f));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.overrideReason).toBe("tide push stronger 09-11 while wind stays 10 km/h");
  });

  test("rejects a window containing a red hour even with overrideReason", () => {
    const f = validationForecast();
    const raw = {
      ...validRecRaw(),
      bestSpot: "telengRia",
      bestWindow: { start: "06:00", end: "08:00" },
      overrideReason: "sheltered from the wind",
    };
    const result = validateRecommendation(raw, contextFor(f));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("red hour");
  });

  test("rejects a window reaching outside forecast hours", () => {
    const f = validationForecast();
    const raw = {
      ...validRecRaw(),
      bestSpot: "pancerDoor",
      bestWindow: { start: "04:00", end: "06:00" },
      overrideReason: "dawn patrol",
    };
    const result = validateRecommendation(raw, contextFor(f));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("outside forecast");
  });

  test("rejects overrideReason longer than 300 chars", () => {
    const f = validationForecast();
    const raw = {
      ...validRecRaw(),
      bestSpot: "pancer",
      bestWindow: { start: "09:00", end: "11:00" },
      overrideReason: "x".repeat(301),
    };
    expect(validateRecommendation(raw, contextFor(f)).ok).toBe(false);
  });

  test("empty candidates list degrades to legacy validation (no candidate checks)", () => {
    const f = validationForecast();
    const raw = { ...validRecRaw(), bestSpot: "telengRia", bestWindow: { start: "06:00", end: "08:00" } };
    const result = validateRecommendation(raw, { candidates: [], forecast: f });
    expect(result.ok).toBe(true);
  });

  test("rejects a non-string overrideReason", () => {
    const result = validateRecommendation({ ...validRecRaw(), overrideReason: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("overrideReason");
  });

  test("treats null and empty-string overrideReason as absent", () => {
    const f = validationForecast();
    for (const empty of [null, ""]) {
      const raw = {
        ...validRecRaw(),
        bestSpot: "pancerDoor",
        bestWindow: { start: "06:00", end: "08:00" },
        overrideReason: empty,
      };
      const result = validateRecommendation(raw, contextFor(f));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.overrideReason).toBeUndefined();
    }
  });

  test("whitespace-only overrideReason does not license a deviation", () => {
    const f = validationForecast();
    const raw = {
      ...validRecRaw(),
      bestSpot: "pancer",
      bestWindow: { start: "09:00", end: "11:00" },
      overrideReason: "   ",
    };
    const result = validateRecommendation(raw, contextFor(f));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("overrideReason");
  });

  test("does not carry overrideReason when the pick follows the top candidate", () => {
    const f = validationForecast();
    const raw = {
      ...validRecRaw(),
      bestSpot: "pancerDoor",
      bestWindow: { start: "06:00", end: "08:00" },
      overrideReason: "models love to over-fill optional fields",
    };
    const result = validateRecommendation(raw, contextFor(f));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.overrideReason).toBeUndefined();
  });

  test("red-hour floor beats the ±1h follows tolerance", () => {
    // pancerDoor green 06-07, RED 08 → top candidate 06:00-08:00. A +1h stretch
    // to 09:00 stays within followsTop tolerance but crosses the red hour 08 —
    // the floor must win, reason or not.
    const mk = (h: number, pd: "green" | "yellow" | "red") => ({
      hour: h,
      tide: { height: 0.5, rising: true },
      swell: { height: 1.5, period: 12, direction: 200 },
      wind: { speed: 10, direction: 100, gusts: 15 },
      weather: { temp: 27, condition: "clear", precipitation: 0 },
      surfable: { telengRia: "red" as const, pancer: "yellow" as const, pancerDoor: pd },
    });
    const f = sampleForecast({ hourly: [mk(6, "green"), mk(7, "green"), mk(8, "red")] });
    const raw = {
      ...validRecRaw(),
      bestSpot: "pancerDoor",
      bestWindow: { start: "06:00", end: "09:00" },
      overrideReason: "pushing past the run",
    };
    const result = validateRecommendation(raw, contextFor(f));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("red hour");
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
    // Matches sampleForecast's top candidate (pancerDoor 06:00-07:00) so the
    // wired-in candidate enforcement accepts it without overrideReason.
    bestWindow: { start: "06:00", end: "07:00" },
    headline: "Pancer Door best in the morning.",
    reasoning: "Rising tide meets offshore wind and clean SW swell.",
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
    expect(rec.bestWindow).toEqual({ start: "06:00", end: "07:00" });
    expect(rec.modelUsed).toBe("deepseek-v4-flash");
    expect(rec.generatedAt).toBe(frozenNow().toISOString());
  });

  test("does NOT overwrite cache when DeepSeek throws on every attempt", async () => {
    const setRecommendation = mock(async () => {});
    const callDeepSeek = mock(async () => { throw new Error("boom"); });
    await generateTomorrowRecommendation(makeDeps({ setRecommendation, callDeepSeek }));
    expect(callDeepSeek).toHaveBeenCalledTimes(2);
    expect(setRecommendation).not.toHaveBeenCalled();
  });

  // 2026-06-07 incident: a single stochastic DeepSeek failure (thinking overran
  // max_tokens → empty content → parse error) killed the whole night's rec because
  // call errors bypassed the retry loop. Call failures must retry like validation
  // failures do.
  test("retries once when the DeepSeek call throws, succeeds on second attempt", async () => {
    let nthCall = 0;
    const callDeepSeek = mock(async () => {
      nthCall += 1;
      if (nthCall === 1) throw new Error("truncated content");
      return { content: validModelResponse(), usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
    });
    const setRecommendation = mock(async () => {});
    await generateTomorrowRecommendation(makeDeps({ callDeepSeek, setRecommendation }));
    expect(callDeepSeek).toHaveBeenCalledTimes(2);
    expect(setRecommendation).toHaveBeenCalledTimes(1);
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

  test("rejects a deviating pick without overrideReason via candidate enforcement, then gives up", async () => {
    const callDeepSeek = mock(async () => ({
      // Deviates from sampleForecast's top candidate (pancerDoor 06:00-07:00)
      // with no overrideReason → validation must reject on both attempts.
      content: { ...validModelResponse(), bestSpot: "pancer" },
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }));
    const setRecommendation = mock(async () => {});
    await generateTomorrowRecommendation(makeDeps({ callDeepSeek, setRecommendation }));
    expect(callDeepSeek).toHaveBeenCalledTimes(2);
    expect(setRecommendation).not.toHaveBeenCalled();
  });

  test("persists overrideReason when the model justifies a deviation", async () => {
    const captured: Recommendation[] = [];
    const setRecommendation = mock(async (rec: Recommendation) => { captured.push(rec); });
    const callDeepSeek = mock(async () => ({
      content: {
        ...validModelResponse(),
        bestSpot: "pancer",
        overrideReason: "wind stays 8 km/h at pancer while pancerDoor gusts 25",
      },
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }));
    await generateTomorrowRecommendation(makeDeps({ callDeepSeek, setRecommendation }));
    expect(captured).toHaveLength(1);
    expect(captured[0].overrideReason).toBe("wind stays 8 km/h at pancer while pancerDoor gusts 25");
  });
});
