import { describe, test, expect } from "bun:test";
import { parseOpenMeteoWeather, parseOpenMeteoMarine } from "../src/server/open-meteo";

describe("parseOpenMeteoWeather", () => {
  test("parses hourly weather for a target date", () => {
    const raw = {
      hourly: {
        time: ["2026-04-03T00:00", "2026-04-03T01:00", "2026-04-03T02:00"],
        temperature_2m: [27, 26.5, 26],
        precipitation: [0, 0.5, 1.2],
        wind_speed_10m: [8, 12, 15],
        wind_direction_10m: [180, 190, 200],
        wind_gusts_10m: [14, 20, 25],
        weather_code: [0, 61, 80],
        cloud_cover: [20, 70, 90],
      },
    };
    const result = parseOpenMeteoWeather(raw, "2026-04-03");
    expect(result).toHaveLength(3);
    expect(result[0].weather.temp).toBe(27);
    expect(result[0].weather.condition).toBe("clear");
    expect(result[0].wind.speed).toBe(8);
    expect(result[1].weather.condition).toBe("rain");
    expect(result[2].weather.condition).toBe("rain");
  });

  test("maps WMO weather codes to conditions", () => {
    const raw = {
      hourly: {
        time: ["2026-04-03T00:00", "2026-04-03T01:00", "2026-04-03T02:00", "2026-04-03T03:00"],
        temperature_2m: [28, 28, 28, 28],
        precipitation: [0, 0, 0, 0],
        wind_speed_10m: [5, 5, 5, 5],
        wind_direction_10m: [0, 0, 0, 0],
        wind_gusts_10m: [8, 8, 8, 8],
        weather_code: [0, 2, 3, 95],
        cloud_cover: [0, 50, 100, 80],
      },
    };
    const result = parseOpenMeteoWeather(raw, "2026-04-03");
    expect(result[0].weather.condition).toBe("clear");
    expect(result[1].weather.condition).toBe("partly_cloudy");
    expect(result[2].weather.condition).toBe("overcast");
    expect(result[3].weather.condition).toBe("thunderstorm");
  });
});

describe("parseOpenMeteoMarine", () => {
  test("parses hourly swell data for a target date", () => {
    const raw = {
      hourly: {
        time: ["2026-04-04T00:00", "2026-04-04T01:00", "2026-04-04T02:00"],
        swell_wave_height: [1.08, 1.1, 1.15],
        swell_wave_period: [7.85, 8.2, 8.5],
        swell_wave_direction: [198, 200, 201],
      },
    };
    const result = parseOpenMeteoMarine(raw, "2026-04-04");
    expect(result).toHaveLength(3);
    expect(result[0].height).toBe(1.08);
    expect(result[0].period).toBe(7.85);
    expect(result[0].direction).toBe(198);
    expect(result[1].height).toBe(1.1);
  });

  test("filters by target date", () => {
    const raw = {
      hourly: {
        time: ["2026-04-04T12:00", "2026-04-05T00:00"],
        swell_wave_height: [1.0, 0.8],
        swell_wave_period: [10, 9],
        swell_wave_direction: [200, 190],
      },
    };
    const result = parseOpenMeteoMarine(raw, "2026-04-04");
    expect(result).toHaveLength(1);
    expect(result[0].hour).toBe(12);
  });

  // Open-Meteo classifies "primary" vs "secondary" by AMPLITUDE only. When a
  // local short-period wind-sea is taller than a long-period groundswell, it
  // becomes primary and the real surf swell shows up as secondary. The picker
  // selects whichever component is the actual groundswell (longest period with
  // meaningful height).
  test("prefers secondary swell when it has longer period and ≥0.3m height (real groundswell)", () => {
    // Pacitan 2026-05-25 actual values from live API:
    // primary  = 1.34m / 6.4s  / 169° (short-period local component)
    // secondary= 0.56m / 13.15s/ 209° (Indian Ocean groundswell)
    const raw = {
      hourly: {
        time: ["2026-05-25T07:00"],
        wave_height: [1.5],
        wave_period: [8.9],
        wave_direction: [179],
        wind_wave_height: [0.10],
        wind_wave_period: [2.2],
        wind_wave_direction: [93],
        swell_wave_height: [1.34],
        swell_wave_period: [6.4],
        swell_wave_direction: [169],
        secondary_swell_wave_height: [0.56],
        secondary_swell_wave_period: [13.15],
        secondary_swell_wave_direction: [209],
      },
    };
    const result = parseOpenMeteoMarine(raw, "2026-05-25");
    expect(result).toHaveLength(1);
    expect(result[0].height).toBeCloseTo(0.56, 2);
    expect(result[0].period).toBeCloseTo(13.15, 2);
    expect(result[0].direction).toBe(209);
  });

  test("falls back to primary swell when secondary height below threshold (< 0.3m)", () => {
    const raw = {
      hourly: {
        time: ["2026-05-25T07:00"],
        wave_height: [1.4],
        swell_wave_height: [1.3],
        swell_wave_period: [8.0],
        swell_wave_direction: [200],
        secondary_swell_wave_height: [0.2],
        secondary_swell_wave_period: [15.0],
        secondary_swell_wave_direction: [220],
      },
    };
    const result = parseOpenMeteoMarine(raw, "2026-05-25");
    expect(result[0].height).toBe(1.3);
    expect(result[0].period).toBe(8.0);
    expect(result[0].direction).toBe(200);
  });

  // The 1.5× period ratio rule filters out marginal secondaries that often
  // point at non-surf-relevant directions (e.g. westerly wraparound).
  test("falls back to primary when secondary period not significantly longer (< 1.5×)", () => {
    const raw = {
      hourly: {
        time: ["2026-05-25T07:00"],
        wave_height: [1.5],
        swell_wave_height: [1.18],
        swell_wave_period: [8.85],
        swell_wave_direction: [191],
        secondary_swell_wave_height: [0.50],
        secondary_swell_wave_period: [11.3],  // 11.3 / 8.85 = 1.28× → not enough
        secondary_swell_wave_direction: [265],
      },
    };
    const result = parseOpenMeteoMarine(raw, "2026-05-25");
    expect(result[0].height).toBe(1.18);
    expect(result[0].period).toBe(8.85);
    expect(result[0].direction).toBe(191);
  });

  // Regression: a tiny long-period secondary must NOT hijack a much larger
  // primary. 2026-05-29 verify-vs-wisuki: Wisuki saw 2.1m/13s/199° but the
  // picker reported 0.40m/16.8s/217° because the only gates were an absolute
  // 0.3m floor + 1.5× period ratio — a 0.4m sliver cleared both and crushed
  // the height rating. The secondary must also be a meaningful FRACTION of the
  // primary's height to win.
  test("keeps primary when secondary is a tiny fraction of primary height (0.4m vs 2.1m)", () => {
    const raw = {
      hourly: {
        time: ["2026-05-29T07:00"],
        swell_wave_height: [2.10],
        swell_wave_period: [11.0],
        swell_wave_direction: [199],
        secondary_swell_wave_height: [0.40],   // ≥0.3 floor and 16.8≥1.5×11 — old code switched
        secondary_swell_wave_period: [16.8],
        secondary_swell_wave_direction: [217],
      },
    };
    const result = parseOpenMeteoMarine(raw, "2026-05-29");
    expect(result[0].height).toBe(2.10);
    expect(result[0].period).toBe(11.0);
    expect(result[0].direction).toBe(199);
  });

  test("still prefers secondary groundswell when its height is a meaningful fraction of primary", () => {
    // Real groundswell-behind-windsea: primary short-period windsea, secondary
    // a substantial long-period component (≥ ~1/3 of primary height).
    const raw = {
      hourly: {
        time: ["2026-05-29T07:00"],
        swell_wave_height: [1.34],
        swell_wave_period: [6.4],
        swell_wave_direction: [169],
        secondary_swell_wave_height: [0.56],   // 0.56/1.34 = 0.42 → meaningful
        secondary_swell_wave_period: [13.15],
        secondary_swell_wave_direction: [209],
      },
    };
    const result = parseOpenMeteoMarine(raw, "2026-05-29");
    expect(result[0].height).toBeCloseTo(0.56, 2);
    expect(result[0].period).toBeCloseTo(13.15, 2);
    expect(result[0].direction).toBe(209);
  });

  test("handles missing secondary fields gracefully (older response shape)", () => {
    const raw = {
      hourly: {
        time: ["2026-05-25T07:00"],
        swell_wave_height: [1.3],
        swell_wave_period: [6.4],
        swell_wave_direction: [174],
      },
    };
    const result = parseOpenMeteoMarine(raw, "2026-05-25");
    expect(result[0].height).toBe(1.3);
    expect(result[0].period).toBe(6.4);
    expect(result[0].direction).toBe(174);
  });
});
