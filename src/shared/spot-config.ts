// Per-spot rating thresholds — SHARED between server (rating computation,
// candidate windows) and client (spot info sheets, limiting-factor display).
// This is pure data: no env reads, no server-only imports. Server code keeps
// importing these via src/server/config.ts re-exports.

export interface WindDirectionThresholds {
  greenMax: number;  // km/h
  yellowMax: number; // km/h
}

export interface SpotThresholds {
  tide: {
    greenMin: number;
    greenMax: number;
    yellowMin: number;
    yellowMax: number;
  };
  swellDir: {
    ideal: number;       // degrees, 0=N
    greenWindow: number; // ± degrees still green
    yellowWindow: number;// ± degrees still yellow
  };
  swellHeight: { greenMin: number; yellowMin: number };
  swellPeriod: { greenMin: number; yellowMin: number };
  facingDirection: number;
  wind: {
    offshore:   WindDirectionThresholds;
    crossShore: WindDirectionThresholds;
    onshore:    WindDirectionThresholds;
  };
}

// Teleng Ria — WESTERN end of the bay, sheltered by the western headland that
// tempers the main SW dry-season swell. Prefers more directly southern swell
// (it wraps in past the headland); SW pulses arrive partly shadowed. Narrow,
// southerly direction window. (Geography user-confirmed 2026-05-29: facing the
// ocean from Pancer Door, Teleng Ria is to the RIGHT = west.)
export const SURFABLE_TELENG_RIA: SpotThresholds = {
  tide:        { greenMin: 50, greenMax: 90, yellowMin: 30, yellowMax: 100 },
  swellDir:    { ideal: 195, greenWindow: 15, yellowWindow: 30 },
  // Lowest height threshold of the three on purpose, but the reasoning is
  // direction-dependent (Surf Atlas: "swells need some more energy to make a
  // mark up this end of the bay, since the headland is there to cut off and
  // temper the main SW dry season pulses"): SW swell arrives shadowed/smaller
  // here — that attenuation is what makes it the tame beginner beach on a
  // normal SW day — while direct S swell (~195°, its ideal) wraps in with
  // little loss and works small. The low threshold covers the S-swell case;
  // the narrow southerly direction window above already penalizes shadowed SW
  // days, so don't ALSO raise this to model the shelter (double-counting).
  swellHeight: { greenMin: 0.4, yellowMin: 0.2 },
  swellPeriod: { greenMin: 7,   yellowMin: 5 },
  facingDirection: 195,
  wind: {
    offshore:   { greenMax: 35, yellowMax: 50 },
    crossShore: { greenMax: 25, yellowMax: 35 },
    onshore:    { greenMax: 15, yellowMax: 25 },
  },
};

// Pancer — EASTERN end of the bay, the Grindulu river-mouth sandbar and the
// most SW-exposed spot (nothing shadows the SW dry-season swell here). Favours
// SW swell over a wide window. River-mouth sandbar drowns at high tide → low-
// to-mid rising tide. (Geography user-confirmed 2026-05-29: facing the ocean
// from Pancer Door, Pancer is to the LEFT = east.)
export const SURFABLE_PANCER: SpotThresholds = {
  tide:        { greenMin: 30, greenMax: 60, yellowMin: 15, yellowMax: 80 },
  swellDir:    { ideal: 215, greenWindow: 25, yellowWindow: 45 },
  swellHeight: { greenMin: 0.5, yellowMin: 0.3 },
  swellPeriod: { greenMin: 8,   yellowMin: 6 },
  facingDirection: 195,
  wind: {
    offshore:   { greenMax: 30, yellowMax: 45 },
    crossShore: { greenMax: 20, yellowMax: 30 },
    onshore:    { greenMax: 10, yellowMax: 20 },
  },
};

export const SURFABLE_PANCER_DOOR: SpotThresholds = {
  tide:        { greenMin: 35, greenMax: 80, yellowMin: 20, yellowMax: 100 },
  swellDir:    { ideal: 210, greenWindow: 25, yellowWindow: 45 },
  swellHeight: { greenMin: 0.5, yellowMin: 0.3 },
  swellPeriod: { greenMin: 8,   yellowMin: 6 },
  facingDirection: 195,
  wind: {
    offshore:   { greenMax: 30, yellowMax: 45 },
    crossShore: { greenMax: 20, yellowMax: 30 },
    onshore:    { greenMax: 10, yellowMax: 20 },
  },
};

export const SURFABLE = SURFABLE_PANCER_DOOR;

export const SPOT_THRESHOLDS = {
  telengRia: SURFABLE_TELENG_RIA,
  pancer: SURFABLE_PANCER,
  pancerDoor: SURFABLE_PANCER_DOOR,
} as const;
