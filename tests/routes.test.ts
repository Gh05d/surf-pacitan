import { describe, test, expect, beforeEach, mock } from "bun:test";

let mockGetRecommendation = mock(async (_date: string) => null as any);

// Mock config to force RECOMMENDATION_ENABLED=true regardless of test env state.
// Spread real config so transitive consumers (cron.ts etc.) don't get missing-export errors.
const realConfig = await import("../src/server/config");
mock.module("../src/server/config", () => ({
  ...realConfig,
  FORECAST_DAYS: 3,
  RECOMMENDATION_ENABLED: true,
}));

// Spread real cache so transitive imports (recommendation.ts etc.) don't get missing-export errors.
const realCache = await import("../src/server/cache");
mock.module("../src/server/cache", () => ({
  ...realCache,
  getRecommendation: (date: string) => mockGetRecommendation(date),
  getCachedDays: mock(async () => []),
  getCachedDay: mock(async () => null),
  getLastFetch: mock(async () => null),
  getCachedDateList: mock(async () => []),
  getQuotaRemaining: mock(async () => null),
}));

// Dynamic import AFTER mocks are registered
const { api } = await import("../src/server/routes");

describe("GET /api/recommendation (enabled)", () => {
  beforeEach(() => {
    mockGetRecommendation = mock(async () => null);
  });

  test("returns enabled:true and recommendation:null when none cached", async () => {
    const res = await api.request("/recommendation");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.recommendation).toBeNull();
  });

  test("returns the cached recommendation when present", async () => {
    const rec = {
      forDate: "2026-05-20",
      generatedAt: "2026-05-19T13:00:00Z",
      bestSpot: "pancerDoor",
      bestWindow: { start: "06:00", end: "09:00" },
      headline: "Pancer Door best in the morning.",
      reasoning: "Rising tide meets offshore wind and clean SW swell.",
      warnings: [],
      modelUsed: "deepseek-v4-flash",
    };
    mockGetRecommendation = mock(async () => rec);

    const res = await api.request("/recommendation");
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.recommendation).toEqual(rec);
  });
});
