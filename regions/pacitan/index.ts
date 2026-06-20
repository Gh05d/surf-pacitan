// Pacitan region pack — the original deployment. Geography user-confirmed
// 2026-05-29: west-to-east along the bay = Teleng Ria → Pancer Door → Pancer
// (Grindulu river mouth). See CLAUDE.md "Spot geography".
import type { RegionConfig } from "../../src/shared/region";

export const PACITAN: RegionConfig = {
  id: "pacitan",
  branding: {
    appTitle: "Surf Pacitan",
    description: "Tide forecast for Pacitan surf spots",
  },
  // Offshore marine grid cell (-8.291, 111.125) — deliberately NOT the bay
  // coordinate. Matches Wisuki/Surfline deep-water swell convention; the
  // coastal cell reads ~18% low. Investigated & kept 2026-05-29.
  location: { name: "Pacitan", lat: -8.22, lng: 111.13 },
  timezone: "Asia/Jakarta",
  // Pacitan beaches face ~south; 195° matches the per-spot facingDirection.
  coastFacingDirection: 195,
  map: { center: [-8.227, 111.088], zoom: 14 },
  // best_match returns suspect wind direction at this coastal point (NE 35°
  // while every other model says E 85-130°). GFS aligns with Wisuki/Surfline.
  weatherModel: "gfs_seamless",
  // Secondary-swell picker gates, verified via scripts/verify-vs-wisuki.ts.
  // See pickSurfSwell in src/server/open-meteo.ts for semantics.
  swellPicker: {
    secondaryMinHeightM: 0.3,
    secondaryPeriodRatio: 1.5,
    secondaryMinPrimaryRatio: 0.33,
    windseaPeriodMax: 7,
    groundswellMinPeriod: 8,
  },
  verifyWisukiUrl: "https://wisuki.com/forecast/6041/pacitan",
  spots: [
    {
      // WESTERN end — sheltered by the western headland that tempers the main
      // SW dry-season swell; prefers direct S swell (wraps in with little
      // loss). Narrow southerly direction window; lowest height threshold on
      // purpose (covers the S-swell-works-small case — the narrow direction
      // window already penalizes shadowed SW days, don't double-count).
      id: "telengRia",
      label: "Teleng Ria",
      abbr: "TR",
      emoji: "🌅",
      character:
        "Sheltered behind the western headland — tame and beginner-friendly on a normal SW day. Direct S swell wraps in with little loss; handles peak high tide best of the three.",
      lat: -8.223,
      lng: 111.079,
      mapDesc: "Mellow beachbreak, beginner friendly",
      thresholds: {
        tide: { greenMin: 50, greenMax: 90, yellowMin: 30, yellowMax: 100 },
        swellDir: { ideal: 195, greenWindow: 15, yellowWindow: 30 },
        swellHeight: { greenMin: 0.4, yellowMin: 0.2 },
        swellPeriod: { greenMin: 7, yellowMin: 5 },
        facingDirection: 195,
        wind: {
          offshore: { greenMax: 35, yellowMax: 50 },
          crossShore: { greenMax: 25, yellowMax: 35 },
          onshore: { greenMax: 15, yellowMax: 25 },
        },
        fallingTideCap: true,
      },
    },
    {
      // MIDDLE — long open beach break, the all-rounder. Intermediate SW
      // exposure, tolerates higher tide than Pancer.
      id: "pancerDoor",
      label: "Pancer Door",
      abbr: "PD",
      emoji: "🏖️",
      character:
        "Long open beach break in the middle of the bay — the all-rounder. Tolerates higher tide than Pancer, likes SW swell.",
      lat: -8.2215,
      lng: 111.088,
      mapDesc: "Long open beach break",
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
    {
      // EASTERN end — Grindulu river-mouth sandbar, most SW-exposed spot.
      // Drowns at high tide → low-to-mid rising window.
      id: "pancer",
      label: "Pancer",
      abbr: "P",
      emoji: "🏞️",
      character:
        "River-mouth sandbar at the east end, shaped by the Grindulu river and shifting seasonally. Most SW-exposed spot; best on low-to-mid rising tide — drowns at high tide.",
      lat: -8.2298,
      lng: 111.1026,
      mapDesc: "River-mouth sandbar, left",
      thresholds: {
        tide: { greenMin: 30, greenMax: 60, yellowMin: 15, yellowMax: 80 },
        swellDir: { ideal: 215, greenWindow: 25, yellowWindow: 45 },
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
