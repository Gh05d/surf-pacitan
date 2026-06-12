import { describe, test, expect } from "bun:test";
import {
  localDateStr,
  localHHMM,
  localHour,
  todayLocal,
  tomorrowLocal,
  addDays,
  epochForLocal,
  nextLocalFireMs,
} from "../src/shared/time";

const WIB = "Asia/Jakarta";   // fixed UTC+7, no DST
const LISBON = "Europe/Lisbon"; // DST: UTC+0 winter / UTC+1 summer

describe("localDateStr / localHHMM / localHour", () => {
  test("converts UTC epoch to WIB local date and time", () => {
    // 2026-06-11T17:00:00Z = 2026-06-12 00:00 WIB
    const epoch = Date.parse("2026-06-11T17:00:00Z");
    expect(localDateStr(epoch, WIB)).toBe("2026-06-12");
    expect(localHHMM(epoch, WIB)).toBe("00:00");
    expect(localHour(epoch, WIB)).toBe(0);
  });

  test("matches the old +7h shift for an arbitrary instant", () => {
    // 2026-01-05T03:45:00Z = 10:45 WIB same day
    const epoch = Date.parse("2026-01-05T03:45:00Z");
    expect(localDateStr(epoch, WIB)).toBe("2026-01-05");
    expect(localHHMM(epoch, WIB)).toBe("10:45");
  });

  test("handles offset-suffixed input the same as Z input (same instant)", () => {
    // StormGlass sea-level echoes +07:00 timestamps; Date.parse normalizes.
    const a = Date.parse("2026-06-12T00:00:00+07:00");
    const b = Date.parse("2026-06-11T17:00:00Z");
    expect(a).toBe(b);
    expect(localDateStr(a, WIB)).toBe("2026-06-12");
  });

  test("DST: Lisbon is UTC+0 in winter, UTC+1 in summer", () => {
    expect(localHHMM(Date.parse("2026-01-15T12:00:00Z"), LISBON)).toBe("12:00");
    expect(localHHMM(Date.parse("2026-07-15T12:00:00Z"), LISBON)).toBe("13:00");
  });
});

describe("addDays / todayLocal / tomorrowLocal", () => {
  test("addDays handles month and year rollover", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-06-12", 3)).toBe("2026-06-15");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("todayLocal/tomorrowLocal use the zone's local date", () => {
    const now = new Date("2026-06-11T18:30:00Z"); // already 12th in WIB
    expect(todayLocal(WIB, now)).toBe("2026-06-12");
    expect(tomorrowLocal(WIB, now)).toBe("2026-06-13");
    expect(todayLocal(LISBON, now)).toBe("2026-06-11");
  });
});

describe("epochForLocal", () => {
  test("WIB local midnight equals 17:00 UTC the previous day", () => {
    expect(epochForLocal("2026-06-12", 0, 0, WIB)).toBe(Date.parse("2026-06-11T17:00:00Z"));
    expect(epochForLocal("2026-06-12", 20, 0, WIB)).toBe(Date.parse("2026-06-12T13:00:00Z"));
  });

  test("DST: Lisbon 20:00 local is 20:00 UTC in winter, 19:00 UTC in summer", () => {
    expect(epochForLocal("2026-01-15", 20, 0, LISBON)).toBe(Date.parse("2026-01-15T20:00:00Z"));
    expect(epochForLocal("2026-07-15", 20, 0, LISBON)).toBe(Date.parse("2026-07-15T19:00:00Z"));
  });

  test("roundtrip: localDateStr/localHHMM of epochForLocal returns the inputs", () => {
    const epoch = epochForLocal("2026-10-25", 6, 30, LISBON); // DST end day in EU
    expect(localDateStr(epoch, LISBON)).toBe("2026-10-25");
    expect(localHHMM(epoch, LISBON)).toBe("06:30");
  });
});

describe("nextLocalFireMs", () => {
  test("before today's target: fires later today (WIB 20:00)", () => {
    const now = new Date("2026-06-12T10:00:00Z"); // 17:00 WIB
    // next 20:00 WIB = 13:00 UTC → 3h
    expect(nextLocalFireMs(now, 20, 0, WIB)).toBe(3 * 3600 * 1000);
  });

  test("at/past today's target: fires tomorrow", () => {
    const now = new Date("2026-06-12T13:00:00Z"); // exactly 20:00 WIB
    expect(nextLocalFireMs(now, 20, 0, WIB)).toBe(24 * 3600 * 1000);
  });

  test("matches old hardcoded cron times for Asia/Jakarta", () => {
    const now = new Date("2026-06-12T00:00:00Z");
    // old: 17:00 UTC for midnight WIB → 17h; 13:00 UTC for 20:00 WIB → 13h
    expect(nextLocalFireMs(now, 0, 0, WIB)).toBe(17 * 3600 * 1000);
    expect(nextLocalFireMs(now, 20, 0, WIB)).toBe(13 * 3600 * 1000);
  });

  test("DST transition: interval across spring-forward is 23h, not 24h", () => {
    // EU spring forward 2026-03-29 01:00 UTC (Lisbon 01:00 → 02:00).
    // From 20:00 local on the 28th to 20:00 local on the 29th is 23 real hours.
    const now = new Date(epochForLocal("2026-03-28", 20, 0, LISBON) + 1000);
    const ms = nextLocalFireMs(now, 20, 0, LISBON);
    expect(ms).toBe(23 * 3600 * 1000 - 1000);
  });
});
