import { describe, test, expect } from "bun:test";
import { computeSurfable, computeAllSpotRatings, getWindCategory, angularDistance, minQuality, computeTideQuality, computeSwellDirQuality, computeSwellHeightQuality, computeSwellPeriodQuality, computeWindQuality } from "../src/server/surfable";
import { SPOT_THRESHOLDS } from "../src/server/config";

describe("getWindCategory", () => {
  // Pancer Door faces 180° (south)
  const facing = 180;

  test("onshore: wind from south (180°) into south-facing beach", () => {
    expect(getWindCategory(180, facing)).toBe("onshore");
  });

  test("onshore: wind from SSW (200°) into south-facing beach — within 60°", () => {
    expect(getWindCategory(200, facing)).toBe("onshore");
  });

  test("offshore: wind from north (0°) — blows from land", () => {
    expect(getWindCategory(0, facing)).toBe("offshore");
  });

  test("offshore: wind from north (360°) — same as 0°", () => {
    expect(getWindCategory(360, facing)).toBe("offshore");
  });

  test("offshore: wind from NNE (30°) into south-facing beach", () => {
    expect(getWindCategory(30, facing)).toBe("offshore");
  });

  test("cross-shore: wind from east (90°)", () => {
    expect(getWindCategory(90, facing)).toBe("crossShore");
  });

  test("cross-shore: wind from west (270°)", () => {
    expect(getWindCategory(270, facing)).toBe("crossShore");
  });

  test("boundary: exactly 60° is cross-shore", () => {
    expect(getWindCategory(240, facing)).toBe("crossShore");
  });

  test("boundary: exactly 120° is cross-shore", () => {
    expect(getWindCategory(300, facing)).toBe("crossShore");
  });

  test("Pancer faces 200° SSW — wind from 200° is onshore", () => {
    expect(getWindCategory(200, 200)).toBe("onshore");
  });

  test("Pancer faces 200° SSW — wind from 20° (NNE) is offshore", () => {
    expect(getWindCategory(20, 200)).toBe("offshore");
  });
});

describe("angularDistance", () => {
  test("same direction", () => {
    expect(angularDistance(180, 180)).toBe(0);
  });
  test("small positive delta", () => {
    expect(angularDistance(200, 195)).toBe(5);
  });
  test("small negative delta", () => {
    expect(angularDistance(195, 200)).toBe(5);
  });
  test("wraparound at 0/360", () => {
    expect(angularDistance(350, 10)).toBe(20);
    expect(angularDistance(10, 350)).toBe(20);
  });
  test("opposite directions", () => {
    expect(angularDistance(0, 180)).toBe(180);
  });
  test("values > 360 (defensive)", () => {
    expect(angularDistance(370, 10)).toBe(0);
  });
});

describe("minQuality", () => {
  test("all green → green", () => {
    expect(minQuality(["green", "green", "green"])).toBe("green");
  });
  test("one yellow → yellow", () => {
    expect(minQuality(["green", "yellow", "green"])).toBe("yellow");
  });
  test("one red → red", () => {
    expect(minQuality(["green", "yellow", "red"])).toBe("red");
  });
  test("single value", () => {
    expect(minQuality(["yellow"])).toBe("yellow");
  });
});


describe("computeTideQuality", () => {
  const t = { greenMin: 30, greenMax: 60, yellowMin: 15, yellowMax: 80 };

  test("inside green window", () => {
    expect(computeTideQuality(45, t)).toBe("green");
  });
  test("at green lower edge", () => {
    expect(computeTideQuality(30, t)).toBe("green");
  });
  test("at green upper edge", () => {
    expect(computeTideQuality(60, t)).toBe("green");
  });
  test("between green and yellow upper", () => {
    expect(computeTideQuality(70, t)).toBe("yellow");
  });
  test("between yellow lower and green lower", () => {
    expect(computeTideQuality(20, t)).toBe("yellow");
  });
  test("above yellowMax → red", () => {
    expect(computeTideQuality(85, t)).toBe("red");
  });
  test("below yellowMin → red", () => {
    expect(computeTideQuality(10, t)).toBe("red");
  });
});

describe("computeSwellDirQuality", () => {
  const t = { ideal: 195, greenWindow: 15, yellowWindow: 30 };

  test("exactly on ideal", () => {
    expect(computeSwellDirQuality(195, t)).toBe("green");
  });
  test("within green window", () => {
    expect(computeSwellDirQuality(205, t)).toBe("green");
  });
  test("at green edge", () => {
    expect(computeSwellDirQuality(210, t)).toBe("green");
  });
  test("just outside green, inside yellow", () => {
    expect(computeSwellDirQuality(215, t)).toBe("yellow");
  });
  test("at yellow edge", () => {
    expect(computeSwellDirQuality(225, t)).toBe("yellow");
  });
  test("outside yellow → red", () => {
    expect(computeSwellDirQuality(230, t)).toBe("red");
  });
  test("wraparound: ideal 10°, swell at 350° (Δ=20°)", () => {
    const wrap = { ideal: 10, greenWindow: 15, yellowWindow: 30 };
    expect(computeSwellDirQuality(350, wrap)).toBe("yellow");
  });
});

describe("computeSwellHeightQuality", () => {
  const t = { greenMin: 0.5, yellowMin: 0.3 };

  test("above greenMin → green", () => {
    expect(computeSwellHeightQuality(1.5, t)).toBe("green");
  });
  test("at greenMin → green", () => {
    expect(computeSwellHeightQuality(0.5, t)).toBe("green");
  });
  test("between yellow and green → yellow", () => {
    expect(computeSwellHeightQuality(0.4, t)).toBe("yellow");
  });
  test("at yellowMin → yellow", () => {
    expect(computeSwellHeightQuality(0.3, t)).toBe("yellow");
  });
  test("below yellowMin → red", () => {
    expect(computeSwellHeightQuality(0.1, t)).toBe("red");
  });
});

describe("computeSwellPeriodQuality", () => {
  const t = { greenMin: 8, yellowMin: 6 };

  test("groundswell 11s → green", () => {
    expect(computeSwellPeriodQuality(11, t)).toBe("green");
  });
  test("at greenMin → green", () => {
    expect(computeSwellPeriodQuality(8, t)).toBe("green");
  });
  test("mid swell 7s → yellow", () => {
    expect(computeSwellPeriodQuality(7, t)).toBe("yellow");
  });
  test("at yellowMin → yellow", () => {
    expect(computeSwellPeriodQuality(6, t)).toBe("yellow");
  });
  test("windswell 5s → red", () => {
    expect(computeSwellPeriodQuality(5, t)).toBe("red");
  });
});


describe("computeWindQuality", () => {
  // Facing 195°. Use Pancer Door's wind block.
  const t = {
    facingDirection: 195,
    wind: {
      offshore:   { greenMax: 30, yellowMax: 45 },
      crossShore: { greenMax: 20, yellowMax: 30 },
      onshore:    { greenMax: 10, yellowMax: 20 },
    },
  };

  test("light onshore (wind from 195°, 6 km/h) → green", () => {
    expect(computeWindQuality(6, 195, t as any)).toBe("green");
  });
  test("medium onshore (15 km/h) → yellow", () => {
    expect(computeWindQuality(15, 195, t as any)).toBe("yellow");
  });
  test("strong onshore (25 km/h) → red", () => {
    expect(computeWindQuality(25, 195, t as any)).toBe("red");
  });
  test("light offshore (wind from 15° ≈ N, 6 km/h) → green", () => {
    expect(computeWindQuality(6, 15, t as any)).toBe("green");
  });
  test("very strong offshore (50 km/h) → red", () => {
    expect(computeWindQuality(50, 15, t as any)).toBe("red");
  });
  test("cross-shore at greenMax boundary", () => {
    // East wind 90° from 195° facing: angleDiff = 105 → crossShore. 20 km/h ≤ 20 greenMax → green.
    expect(computeWindQuality(20, 90, t as any)).toBe("green");
  });
});

describe("per-spot swell-direction exposure (geography-corrected 2026-05-29)", () => {
  // User-confirmed local geography: facing the ocean from Pancer Door, Pancer
  // is to the LEFT (= EAST, Grindulu river mouth, most SW-exposed) and Teleng
  // Ria to the RIGHT (= WEST, sheltered by the western headland that tempers SW
  // dry-season pulses). So the EXPOSED east spot (Pancer) should favour SW
  // swell, the SHELTERED west spot (Teleng Ria) should favour more southerly
  // swell. Earlier config had these two ideals inverted.

  test("SW swell 220° → Pancer (exposed, east) green on direction", () => {
    expect(computeSwellDirQuality(220, SPOT_THRESHOLDS.pancer.swellDir)).toBe("green");
  });
  test("SW swell 220° → Teleng Ria (sheltered, west) not green on direction", () => {
    expect(computeSwellDirQuality(220, SPOT_THRESHOLDS.telengRia.swellDir)).not.toBe("green");
  });
  test("southerly swell 195° → Teleng Ria (sheltered, west) green on direction", () => {
    expect(computeSwellDirQuality(195, SPOT_THRESHOLDS.telengRia.swellDir)).toBe("green");
  });
  test("Pancer ideal is more south-westerly than Teleng Ria ideal", () => {
    expect(SPOT_THRESHOLDS.pancer.swellDir.ideal).toBeGreaterThan(
      SPOT_THRESHOLDS.telengRia.swellDir.ideal
    );
  });
});

describe("computeSurfable — 2026-05-17 validation table", () => {
  const sunrise = "05:41";
  const sunset = "17:25";

  function input(hour: number, tidePercent: number, tideRising: boolean) {
    return {
      hour,
      tidePercent,
      tideRising,
      swellHeight: 1.5,
      swellPeriod: 11,
      swellDirection: 201,
      windSpeed: 6,
      windDirection: 90,
      sunrise,
      sunset,
    };
  }

  test("Pancer 05:00 → red (hour center 05:30 before sunrise 05:41)", () => {
    expect(computeSurfable(input(5, 57, true), SPOT_THRESHOLDS.pancer)).toBe("red");
  });
  test("Pancer 06:00 tide 76% rising → yellow (above greenMax 60)", () => {
    expect(computeSurfable(input(6, 76, true), SPOT_THRESHOLDS.pancer)).toBe("yellow");
  });
  test("Pancer 07:00 tide 92% rising → red (above yellowMax 80)", () => {
    expect(computeSurfable(input(7, 92, true), SPOT_THRESHOLDS.pancer)).toBe("red");
  });
  test("Pancer 08:00 tide 100% peak → red", () => {
    expect(computeSurfable(input(8, 100, true), SPOT_THRESHOLDS.pancer)).toBe("red");
  });
  test("Pancer 09:00 tide 98% falling → red (still above yellowMax)", () => {
    expect(computeSurfable(input(9, 98, false), SPOT_THRESHOLDS.pancer)).toBe("red");
  });

  test("Pancer Door 05:00 → red (hour center 05:30 before sunrise 05:41)", () => {
    expect(computeSurfable(input(5, 57, true), SPOT_THRESHOLDS.pancerDoor)).toBe("red");
  });
  test("Pancer Door 06:00 tide 76% rising → green", () => {
    expect(computeSurfable(input(6, 76, true), SPOT_THRESHOLDS.pancerDoor)).toBe("green");
  });
  test("Pancer Door 07:00 tide 92% rising → yellow (in 80-95 band)", () => {
    expect(computeSurfable(input(7, 92, true), SPOT_THRESHOLDS.pancerDoor)).toBe("yellow");
  });
  test("Pancer Door 09:00 tide 98% falling → yellow (in yellow band, falling tide cap)", () => {
    expect(computeSurfable(input(9, 98, false), SPOT_THRESHOLDS.pancerDoor)).toBe("yellow");
  });
  test("Pancer Door 08:00 tide 100% peak → yellow", () => {
    expect(computeSurfable(input(8, 100, true), SPOT_THRESHOLDS.pancerDoor)).toBe("yellow");
  });
  test("Pancer Door 11:00 tide 67% falling → yellow (green capped by falling)", () => {
    expect(computeSurfable(input(11, 67, false), SPOT_THRESHOLDS.pancerDoor)).toBe("yellow");
  });

  test("Teleng Ria 05:00 → red (hour center 05:30 before sunrise 05:41)", () => {
    expect(computeSurfable(input(5, 57, true), SPOT_THRESHOLDS.telengRia)).toBe("red");
  });
  test("Teleng Ria 07:00 tide 92% rising → yellow (above greenMax 90)", () => {
    expect(computeSurfable(input(7, 92, true), SPOT_THRESHOLDS.telengRia)).toBe("yellow");
  });
  test("Teleng Ria 08:00 tide 100% peak → yellow", () => {
    expect(computeSurfable(input(8, 100, true), SPOT_THRESHOLDS.telengRia)).toBe("yellow");
  });
  test("Teleng Ria 09:00 tide 98% falling → yellow", () => {
    expect(computeSurfable(input(9, 98, false), SPOT_THRESHOLDS.telengRia)).toBe("yellow");
  });

  test("All spots red before sunrise", () => {
    expect(computeSurfable(input(4, 50, true), SPOT_THRESHOLDS.pancer)).toBe("red");
    expect(computeSurfable(input(4, 50, true), SPOT_THRESHOLDS.pancerDoor)).toBe("red");
    expect(computeSurfable(input(4, 50, true), SPOT_THRESHOLDS.telengRia)).toBe("red");
  });

  test("Falling-tide cap: green factors capped to yellow on falling tide", () => {
    expect(computeSurfable(input(10, 50, false), SPOT_THRESHOLDS.pancerDoor)).toBe("yellow");
  });
});

describe("minute-aware daylight gate", () => {
  // Hour counts as daylight when its CENTER (H:30) lies between sunrise and
  // sunset — i.e. at least ~30 min of light in the hour.
  function input(hour: number, sunrise: string, sunset: string) {
    return {
      hour,
      tidePercent: 50,
      tideRising: true,
      swellHeight: 1.5,
      swellPeriod: 11,
      swellDirection: 210,
      windSpeed: 6,
      windDirection: 15,
      sunrise,
      sunset,
    };
  }

  test("dusk hour counts when sunset is late enough (Dec: sunset 17:55 → hour 17 rated)", () => {
    expect(computeSurfable(input(17, "05:41", "17:55"), SPOT_THRESHOLDS.pancerDoor)).not.toBe("red");
  });
  test("dusk hour excluded when sunset gives <30 min light (sunset 17:25 → hour 17 red)", () => {
    expect(computeSurfable(input(17, "05:41", "17:25"), SPOT_THRESHOLDS.pancerDoor)).toBe("red");
  });
  test("dawn hour counts when sunrise is early enough (sunrise 05:25 → hour 5 rated)", () => {
    expect(computeSurfable(input(5, "05:25", "17:25"), SPOT_THRESHOLDS.pancerDoor)).not.toBe("red");
  });
  test("dawn hour excluded when mostly dark (sunrise 05:46 → hour 5 red)", () => {
    expect(computeSurfable(input(5, "05:46", "17:25"), SPOT_THRESHOLDS.pancerDoor)).toBe("red");
  });
});

describe("computeAllSpotRatings — 2026-05-17 differentiation", () => {
  const sunrise = "05:41";
  const sunset = "17:25";

  test("07:00 high tide differentiates the three spots", () => {
    const result = computeAllSpotRatings({
      hour: 7,
      tidePercent: 92,
      tideRising: true,
      swellHeight: 1.5,
      swellPeriod: 11,
      swellDirection: 201,
      windSpeed: 6,
      windDirection: 90,
      sunrise,
      sunset,
    });
    expect(result.pancer).toBe("red");
    expect(result.pancerDoor).toBe("yellow");
    expect(result.telengRia).toBe("yellow");
  });

  test("06:00 rising-tide morning works for everyone", () => {
    const result = computeAllSpotRatings({
      hour: 6,
      tidePercent: 57,
      tideRising: true,
      swellHeight: 1.5,
      swellPeriod: 11,
      swellDirection: 201,
      windSpeed: 6,
      windDirection: 90,
      sunrise,
      sunset,
    });
    expect(result.pancer).toBe("green");
    expect(result.pancerDoor).toBe("green");
    expect(result.telengRia).toBe("green");
  });
});

import {
  computeFactorBreakdown,
  describeLimitingFactor,
  degreesToCompass,
} from "../src/shared/surfable";

describe("computeFactorBreakdown", () => {
  const base = {
    hour: 9,
    tidePercent: 50,
    tideRising: true,
    swellHeight: 1.5,
    swellPeriod: 11,
    swellDirection: 210,
    windSpeed: 6,
    windDirection: 15, // offshore for facing 195
    sunrise: "05:41",
    sunset: "17:25",
  };

  const variants = [
    { name: "all green rising", input: base },
    { name: "falling-tide cap", input: { ...base, tideRising: false } },
    { name: "dark hour", input: { ...base, hour: 4 } },
    { name: "wind-limited yellow", input: { ...base, windSpeed: 16, windDirection: 195 } },
    { name: "tide red", input: { ...base, tidePercent: 5 } },
    { name: "multi-factor yellow", input: { ...base, swellHeight: 0.45, swellPeriod: 7 } },
    { name: "swell direction red", input: { ...base, swellDirection: 90 } },
  ];

  test("final always matches computeSurfable (consistency matrix, all spots)", () => {
    for (const { name, input } of variants) {
      for (const [spot, t] of Object.entries(SPOT_THRESHOLDS)) {
        const breakdown = computeFactorBreakdown(input, t);
        expect(`${name}/${spot}:${breakdown.final}`).toBe(
          `${name}/${spot}:${computeSurfable(input, t)}`,
        );
      }
    }
  });

  test("green hour has no limiting factors", () => {
    const b = computeFactorBreakdown(base, SPOT_THRESHOLDS.pancerDoor);
    expect(b.final).toBe("green");
    expect(b.limiting).toEqual([]);
  });

  test("falling-tide cap is reported as the sole limiter", () => {
    const b = computeFactorBreakdown({ ...base, tideRising: false }, SPOT_THRESHOLDS.pancerDoor);
    expect(b.final).toBe("yellow");
    expect(b.limiting).toEqual(["fallingTide"]);
  });

  test("dark hour is limited by daylight only", () => {
    const b = computeFactorBreakdown({ ...base, hour: 4 }, SPOT_THRESHOLDS.pancerDoor);
    expect(b.final).toBe("red");
    expect(b.limiting).toEqual(["daylight"]);
  });

  test("onshore wind yellow names wind as the limiter", () => {
    const b = computeFactorBreakdown(
      { ...base, windSpeed: 16, windDirection: 195 },
      SPOT_THRESHOLDS.pancerDoor,
    );
    expect(b.final).toBe("yellow");
    expect(b.limiting).toEqual(["wind"]);
    expect(b.windCategory).toBe("onshore");
  });

  test("multiple factors at the final level are all listed", () => {
    const b = computeFactorBreakdown(
      { ...base, swellHeight: 0.45, swellPeriod: 7 },
      SPOT_THRESHOLDS.pancerDoor,
    );
    expect(b.final).toBe("yellow");
    expect(b.limiting).toEqual(["swellHeight", "swellPeriod"]);
  });
});

describe("degreesToCompass", () => {
  test("maps key directions", () => {
    expect(degreesToCompass(0)).toBe("N");
    expect(degreesToCompass(90)).toBe("E");
    expect(degreesToCompass(195)).toBe("SSW");
    expect(degreesToCompass(215)).toBe("SW");
    expect(degreesToCompass(359)).toBe("N");
    expect(degreesToCompass(-15)).toBe("NNW");
  });
});

describe("describeLimitingFactor", () => {
  const input = {
    hour: 9,
    tidePercent: 92,
    tideRising: true,
    swellHeight: 0.3,
    swellPeriod: 6,
    swellDirection: 145,
    windSpeed: 16.4,
    windDirection: 145,
    sunrise: "05:41",
    sunset: "17:25",
  };
  const t = SPOT_THRESHOLDS.pancer;

  test("phrases each factor with concrete numbers", () => {
    expect(describeLimitingFactor("wind", input, t)).toBe("onshore wind 16 km/h");
    expect(describeLimitingFactor("tide", input, t)).toBe("tide too high (92% of daily range)");
    expect(describeLimitingFactor("tide", { ...input, tidePercent: 8 }, t)).toBe(
      "tide too low (8% of daily range)",
    );
    expect(describeLimitingFactor("swellHeight", input, t)).toBe("swell too small (0.3 m)");
    expect(describeLimitingFactor("swellPeriod", input, t)).toBe("short swell period (6s)");
    expect(describeLimitingFactor("swellDir", input, t)).toBe(
      "swell from SE 145° — ideal is SW 215°",
    );
    expect(describeLimitingFactor("fallingTide", input, t)).toBe(
      "falling tide — sandbars need rising water",
    );
    expect(describeLimitingFactor("daylight", input, t)).toBe("dark — outside daylight");
  });
});
