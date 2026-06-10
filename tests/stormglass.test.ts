import { describe, test, expect } from "bun:test";
import {
  parseTideExtremes,
  parseSeaLevels,
  parseAstronomy,
} from "../src/server/stormglass";

// Fixtures use the REAL production timestamp formats (verified 2026-06-10):
// the extremes endpoint returns UTC (+00:00) timestamps, while the sea-level
// endpoint echoes the request's +07:00 offset back. Both must bucket to the
// same WIB-local day.

describe("parseTideExtremes", () => {
  test("parses high/low tides with timezone conversion", () => {
    const raw = {
      data: [
        // 20:40 UTC on 04-03 = 03:40 WIB on 04-04 → belongs to 04-04, NOT 04-03
        { height: 1.18, time: "2026-04-03T20:40:00+00:00", type: "high" },
        { height: -0.32, time: "2026-04-03T02:55:00+00:00", type: "low" },
      ],
    };
    const result = parseTideExtremes(raw, "2026-04-03");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("low");
    expect(result[0].time).toBe("09:55");
  });

  test("pre-dawn extreme lands on its LOCAL day (live 2026-06-10 regression)", () => {
    // The real 2026-06-10 morning high: 20:31 UTC on 06-09 = 03:31 WIB 06-10.
    // The old raw-prefix filter put it on 06-09 and showed 06-11's morning
    // high as a phantom 04:34 entry on 06-10.
    const raw = {
      data: [
        { height: 0.459, time: "2026-06-09T20:31:00+00:00", type: "high" },
        { height: -0.43, time: "2026-06-10T03:08:00+00:00", type: "low" }, // 10:08 WIB
        { height: 0.554, time: "2026-06-10T21:34:00+00:00", type: "high" }, // 04:34 WIB 06-11!
      ],
    };
    const day10 = parseTideExtremes(raw, "2026-06-10");
    expect(day10).toHaveLength(2);
    expect(day10[0]).toEqual({ time: "03:31", height: 0.459, type: "high" });
    expect(day10[1]).toEqual({ time: "10:08", height: -0.43, type: "low" });

    const day11 = parseTideExtremes(raw, "2026-06-11");
    expect(day11).toEqual([{ time: "04:34", height: 0.554, type: "high" }]);
  });

  test("also handles +07:00-offset timestamps identically", () => {
    const utc = parseTideExtremes(
      { data: [{ height: 0.459, time: "2026-06-09T20:31:00+00:00", type: "high" }] },
      "2026-06-10",
    );
    const offset = parseTideExtremes(
      { data: [{ height: 0.459, time: "2026-06-10T03:31:00+07:00", type: "high" }] },
      "2026-06-10",
    );
    expect(offset).toEqual(utc);
  });
});

describe("parseSeaLevels", () => {
  test("parses hourly sea levels from +07:00-offset timestamps (production format)", () => {
    const raw = {
      data: [
        { sg: 0.62, time: "2026-04-03T00:00:00+07:00" },
        { sg: 0.85, time: "2026-04-03T01:00:00+07:00" },
        { sg: 1.1, time: "2026-04-03T02:00:00+07:00" },
      ],
    };
    const result = parseSeaLevels(raw, "2026-04-03");
    expect(result.map((r) => r.hour)).toEqual([0, 1, 2]);
    expect(result[0].height).toBe(0.62);
  });

  test("buckets UTC-format timestamps to the same local day (format hardening)", () => {
    // Same instants as above, expressed in UTC. If StormGlass ever normalizes
    // the sea-level endpoint to UTC (like its extremes endpoint already is),
    // hours 0–6 must NOT silently shift to the next day.
    const raw = {
      data: [
        { sg: 0.62, time: "2026-04-02T17:00:00+00:00" },
        { sg: 0.85, time: "2026-04-02T18:00:00+00:00" },
        { sg: 1.1, time: "2026-04-02T19:00:00+00:00" },
      ],
    };
    const result = parseSeaLevels(raw, "2026-04-03");
    expect(result.map((r) => r.hour)).toEqual([0, 1, 2]);
    expect(result.map((r) => r.height)).toEqual([0.62, 0.85, 1.1]);
  });

  test("rising is a FORWARD difference (describes the hour ahead)", () => {
    const raw = {
      data: [
        { sg: 0.5, time: "2026-04-03T00:00:00+07:00" },
        { sg: 0.8, time: "2026-04-03T01:00:00+07:00" },
        { sg: 0.6, time: "2026-04-03T02:00:00+07:00" },
      ],
    };
    const result = parseSeaLevels(raw, "2026-04-03");
    expect(result[0].rising).toBe(true);  // 0.5 → 0.8
    expect(result[1].rising).toBe(false); // 0.8 → 0.6 (turn hour: water falls DURING hour 1)
    expect(result[2].rising).toBe(false); // series end: backward fallback 0.6 < 0.8
  });

  test("post-low hour is rising (the sandbar push hour must not be capped)", () => {
    // Low tide mid-series: the hour starting right after the low has rising
    // water and must read rising=true (the old backward diff lagged 1h here).
    const raw = {
      data: [
        { sg: 0.2, time: "2026-04-03T11:00:00+07:00" },
        { sg: -0.1, time: "2026-04-03T12:00:00+07:00" }, // low around 12:xx
        { sg: 0.15, time: "2026-04-03T13:00:00+07:00" },
        { sg: 0.4, time: "2026-04-03T14:00:00+07:00" },
      ],
    };
    const result = parseSeaLevels(raw, "2026-04-03");
    expect(result[1].rising).toBe(true); // hour 12 → water rises toward 13:00
    expect(result[2].rising).toBe(true);
    expect(result[0].rising).toBe(false); // hour 11 → falls into the low
  });

  test("rising detection works across day boundaries (neighbors from full response)", () => {
    const raw = {
      data: [
        { sg: -0.27, time: "2026-04-02T23:00:00+07:00" },
        { sg: -0.13, time: "2026-04-03T00:00:00+07:00" },
        { sg: 0.1, time: "2026-04-03T01:00:00+07:00" },
      ],
    };
    const result = parseSeaLevels(raw, "2026-04-03");
    expect(result[0].hour).toBe(0);
    expect(result[0].rising).toBe(true); // compares against hour 1 of same day
    const prevDay = parseSeaLevels(raw, "2026-04-02");
    expect(prevDay[0].rising).toBe(true); // hour 23 compares across midnight
  });
});

describe("parseAstronomy", () => {
  const raw = {
    data: [
      {
        time: "2026-06-09T17:00:00+00:00",
        sunrise: "2026-06-09T22:46:00+00:00", // 05:46 WIB on 06-10
        sunset: "2026-06-10T10:25:00+00:00", // 17:25 WIB on 06-10
      },
      {
        time: "2026-06-10T17:00:00+00:00",
        sunrise: "2026-06-10T22:47:00+00:00", // 05:47 WIB on 06-11
        sunset: "2026-06-11T10:25:00+00:00",
      },
    ],
  };

  test("parses sunrise and sunset", () => {
    const result = parseAstronomy(raw, "2026-06-10");
    expect(result.sunrise).toBe("05:46");
    expect(result.sunset).toBe("17:25");
  });

  test("selects the entry matching the target local day", () => {
    const result = parseAstronomy(raw, "2026-06-11");
    expect(result.sunrise).toBe("05:47");
  });

  test("falls back to the first entry without a target date or on no match", () => {
    expect(parseAstronomy(raw).sunrise).toBe("05:46");
    expect(parseAstronomy(raw, "2026-07-01").sunrise).toBe("05:46");
  });
});
