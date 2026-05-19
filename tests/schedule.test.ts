import { describe, test, expect } from "bun:test";
import { nextFireMs } from "../src/server/schedule";

describe("nextFireMs", () => {
  test("when now is before target time same day, returns ms until same day", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    // target 13:00 UTC = next 60 minutes
    expect(nextFireMs(now, 13, 0)).toBe(60 * 60 * 1000);
  });

  test("when now is exactly at target time, returns ms until next day's target", () => {
    const now = new Date("2026-05-19T13:00:00Z");
    expect(nextFireMs(now, 13, 0)).toBe(24 * 60 * 60 * 1000);
  });

  test("when now is past target time, returns ms until next day's target", () => {
    const now = new Date("2026-05-19T14:00:00Z");
    expect(nextFireMs(now, 13, 0)).toBe(23 * 60 * 60 * 1000);
  });

  test("handles month boundary correctly", () => {
    const now = new Date("2026-05-31T14:00:00Z");
    const ms = nextFireMs(now, 13, 0);
    expect(ms).toBe(23 * 60 * 60 * 1000); // → 2026-06-01T13:00:00Z
  });

  test("handles minute offset", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    expect(nextFireMs(now, 12, 30)).toBe(30 * 60 * 1000);
  });
});
