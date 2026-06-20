import { describe, test, expect } from "bun:test";
import { validateRegionConfig, type RegionConfig } from "../src/shared/region";
import { getRegion, REGIONS } from "../regions";
import { PACITAN } from "../regions/pacitan";
import { ACTIVE_REGION } from "../src/shared/active-region";

function validRegion(): RegionConfig {
  return {
    id: "testland",
    branding: { appTitle: "Surf Testland", description: "Tide forecast for Testland" },
    location: { name: "Testland", lat: -8.0, lng: 111.0 },
    timezone: "Asia/Jakarta",
    coastFacingDirection: 195,
    map: { center: [-8.0, 111.0], zoom: 14 },
    weatherModel: "gfs_seamless",
    swellPicker: {
      secondaryMinHeightM: 0.3,
      secondaryPeriodRatio: 1.5,
      secondaryMinPrimaryRatio: 0.33,
      windseaPeriodMax: 7,
      groundswellMinPeriod: 8,
    },
    spots: [
      {
        id: "mainBreak",
        label: "Main Break",
        abbr: "MB",
        emoji: "🏖️",
        character: "A beach break.",
        lat: -8.0,
        lng: 111.0,
        mapDesc: "Beach break",
        thresholds: {
          tide: { greenMin: 35, greenMax: 80, yellowMin: 20, yellowMax: 100 },
          swellDir: { ideal: 210, greenWindow: 25, yellowWindow: 45 },
          swellHeight: { greenMin: 0.5, yellowMin: 0.3 },
          swellPeriod: { greenMin: 8, yellowMin: 6 },
          facingDirection: 195,
          wind: {
            offshore: { greenMax: 30, yellowMax: 45 },
            crossShore: { greenMax: 20, yellowMax: 30 },
            onshore: { greenMax: 10, yellowMax: 20 },
          },
          fallingTideCap: true,
        },
      },
    ],
  };
}

describe("validateRegionConfig", () => {
  test("a well-formed region has no errors", () => {
    expect(validateRegionConfig(validRegion())).toEqual([]);
  });

  test("rejects empty spot list", () => {
    const r = { ...validRegion(), spots: [] };
    expect(validateRegionConfig(r)).toContain("at least one spot required");
  });

  test("rejects invalid IANA timezone", () => {
    const r = { ...validRegion(), timezone: "WIB+7" };
    expect(validateRegionConfig(r).some((e) => e.includes("invalid IANA timezone"))).toBe(true);
  });

  test("rejects duplicate spot ids", () => {
    const r = validRegion();
    r.spots = [r.spots[0], { ...r.spots[0] }];
    expect(validateRegionConfig(r).some((e) => e.includes("duplicate spot id"))).toBe(true);
  });

  test("rejects inverted tide window ordering", () => {
    const r = validRegion();
    r.spots[0].thresholds.tide = { greenMin: 80, greenMax: 35, yellowMin: 20, yellowMax: 100 };
    expect(validateRegionConfig(r).some((e) => e.includes("tide window ordering"))).toBe(true);
  });

  test("rejects inverted wind thresholds", () => {
    const r = validRegion();
    r.spots[0].thresholds.wind.onshore = { greenMax: 30, yellowMax: 10 };
    expect(validateRegionConfig(r).some((e) => e.includes("wind.onshore"))).toBe(true);
  });

  test("rejects bad region id", () => {
    const r = { ...validRegion(), id: "Test Land!" };
    expect(validateRegionConfig(r).some((e) => e.includes("invalid region id"))).toBe(true);
  });

  test("rejects inverted swellDir/swellHeight/swellPeriod thresholds", () => {
    const cases: [(r: RegionConfig) => void, string][] = [
      [(r) => { r.spots[0].thresholds.swellDir = { ideal: 210, greenWindow: 45, yellowWindow: 25 }; }, "swellDir windows inverted"],
      [(r) => { r.spots[0].thresholds.swellHeight = { greenMin: 0.3, yellowMin: 0.5 }; }, "swellHeight thresholds inverted"],
      [(r) => { r.spots[0].thresholds.swellPeriod = { greenMin: 6, yellowMin: 8 }; }, "swellPeriod thresholds inverted"],
    ];
    for (const [mutate, expected] of cases) {
      const r = validRegion();
      mutate(r);
      expect(validateRegionConfig(r).some((e) => e.includes(expected))).toBe(true);
    }
  });

  test("missing threshold sub-objects yield readable errors, not a crash", () => {
    const r = validRegion();
    delete (r.spots[0].thresholds as any).tide;
    delete (r.spots[0].thresholds as any).wind;
    const errors = validateRegionConfig(r);
    expect(errors).toContain("mainBreak: thresholds.tide missing");
    expect(errors).toContain("mainBreak: thresholds.wind missing");
  });

  test("degenerate-but-legal zero-width yellow bands are valid", () => {
    const r = validRegion();
    r.spots[0].thresholds.swellDir = { ideal: 210, greenWindow: 25, yellowWindow: 25 };
    r.spots[0].thresholds.tide = { greenMin: 20, greenMax: 100, yellowMin: 20, yellowMax: 100 };
    expect(validateRegionConfig(r)).toEqual([]);
  });

  test("rejects out-of-range bearings and non-positive zoom", () => {
    const r = validRegion();
    r.spots[0].thresholds.swellDir = { ideal: 999, greenWindow: 25, yellowWindow: 45 };
    (r.spots[0].thresholds as any).facingDirection = -50;
    (r as any).coastFacingDirection = 400;
    r.map = { center: [-8.0, 111.0], zoom: 0 };
    const errors = validateRegionConfig(r);
    expect(errors.some((e) => e.includes("swellDir.ideal out of range"))).toBe(true);
    expect(errors.some((e) => e.includes("facingDirection out of range"))).toBe(true);
    expect(errors.some((e) => e.includes("coastFacingDirection out of range"))).toBe(true);
    expect(errors.some((e) => e.includes("map.zoom"))).toBe(true);
  });
});

describe("region registry", () => {
  test("pacitan pack is registered and passes validation", () => {
    expect(Object.keys(REGIONS)).toEqual(["pacitan"]);
    expect(getRegion("pacitan")).toBe(PACITAN);
    expect(validateRegionConfig(PACITAN)).toEqual([]);
  });

  test("unknown region throws with available ids", () => {
    expect(() => getRegion("atlantis")).toThrow(/Unknown REGION "atlantis"/);
    expect(() => getRegion("atlantis")).toThrow(/pacitan/);
  });

  test("ACTIVE_REGION defaults to pacitan (REGION env unset in tests)", () => {
    expect(ACTIVE_REGION.id).toBe("pacitan");
  });

  test("pacitan spots are west-to-east with the established thresholds", () => {
    expect(PACITAN.spots.map((s) => s.id)).toEqual(["telengRia", "pancerDoor", "pancer"]);
    const pancer = PACITAN.spots.find((s) => s.id === "pancer")!;
    expect(pancer.thresholds.tide).toEqual({ greenMin: 30, greenMax: 60, yellowMin: 15, yellowMax: 80 });
    expect(pancer.thresholds.swellDir.ideal).toBe(215);
    const telengRia = PACITAN.spots.find((s) => s.id === "telengRia")!;
    expect(telengRia.thresholds.swellDir).toEqual({ ideal: 195, greenWindow: 15, yellowWindow: 30 });
    expect(telengRia.thresholds.swellHeight.greenMin).toBe(0.4);
    for (const s of PACITAN.spots) expect(s.thresholds.fallingTideCap).toBe(true);
  });

  test("empty REGION env resolves to the default (subprocess)", async () => {
    const proc = Bun.spawn(
      ["bun", "-e", 'import("./src/shared/active-region").then(m => console.log(m.ACTIVE_REGION.id))'],
      { cwd: "/root/surf-pacitan", env: { ...process.env, REGION: "" }, stdout: "pipe" },
    );
    const out = await new Response(proc.stdout).text();
    expect(out.trim()).toBe("pacitan");
  });

  test("pacitan metadata matches the current deployment", () => {
    expect(PACITAN.timezone).toBe("Asia/Jakarta");
    expect(PACITAN.location).toEqual({ name: "Pacitan", lat: -8.22, lng: 111.13 });
    expect(PACITAN.weatherModel).toBe("gfs_seamless");
    expect(PACITAN.swellPicker).toEqual({
      secondaryMinHeightM: 0.3,
      secondaryPeriodRatio: 1.5,
      secondaryMinPrimaryRatio: 0.33,
      windseaPeriodMax: 7,
      groundswellMinPeriod: 8,
    });
  });
});
