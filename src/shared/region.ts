// Region pack types + boot-time validation. A RegionConfig is everything
// region-specific the app needs; packs live in regions/<id>/. Pure module.
import type { SpotThresholds } from "./spot-config";

export interface SpotDef {
  /** Stable key used in SpotRatings payloads and the LLM schema. */
  id: string;
  label: string;     // full name shown in UI
  abbr: string;      // short code on tide-graph strips
  emoji: string;
  character: string; // 1-2 sentence spot character for the info sheet
  lat: number;       // map marker
  lng: number;
  mapDesc: string;   // one-liner in the map popup
  thresholds: SpotThresholds;
}

export interface RegionConfig {
  /** Lowercase slug — also the Redis key namespace (surf:<id>:...). */
  id: string;
  branding: { appTitle: string; description: string };
  /** Marine grid-cell coordinate used for StormGlass + Open-Meteo requests. */
  location: { name: string; lat: number; lng: number };
  /** IANA zone name, e.g. "Asia/Jakarta". */
  timezone: string;
  /** General coast orientation for the region-level wind label (Conditions card). */
  coastFacingDirection: number;
  map: { center: [number, number]; zoom: number };
  /** Open-Meteo `models` param — best_match can be wrong at specific coasts. */
  weatherModel: string;
  swellPicker: {
    secondaryMinHeightM: number;
    secondaryPeriodRatio: number;
    secondaryMinPrimaryRatio: number;
  };
  /** Wisuki forecast URL for scripts/verify-vs-wisuki.ts. Optional. */
  verifyWisukiUrl?: string;
  /** Ordered: display order AND candidate-ranking tiebreak order. */
  spots: SpotDef[];
}

export function validateRegionConfig(config: RegionConfig): string[] {
  const errors: string[] = [];

  if (!/^[a-z][a-z0-9-]*$/.test(config.id)) errors.push(`invalid region id: ${config.id}`);
  if (!config.branding?.appTitle) errors.push("branding.appTitle missing");
  if (!config.branding?.description) errors.push("branding.description missing");
  if (!(config.coastFacingDirection >= 0 && config.coastFacingDirection <= 360)) errors.push("coastFacingDirection out of range 0-360");
  if (!(Number.isFinite(config.map?.zoom) && config.map.zoom > 0)) errors.push("map.zoom must be a positive number");
  if (!config.spots?.length) errors.push("at least one spot required");

  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone });
  } catch {
    errors.push(`invalid IANA timezone: ${config.timezone}`);
  }

  const ids = new Set<string>();
  for (const s of config.spots ?? []) {
    // Spot ids are object keys / LLM-schema identifiers (camelCase, no
    // hyphens); region ids are kebab-case Redis-namespace slugs — divergence
    // is intentional.
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(s.id)) errors.push(`invalid spot id: ${s.id}`);
    if (ids.has(s.id)) errors.push(`duplicate spot id: ${s.id}`);
    ids.add(s.id);
    if (!s.abbr) errors.push(`${s.id}: abbr missing`);
    if (!s.label) errors.push(`${s.id}: label missing`);

    const t = s.thresholds;
    if (!t) {
      errors.push(`${s.id}: thresholds missing`);
      continue;
    }
    const missingSub = (["tide", "swellDir", "swellHeight", "swellPeriod", "wind"] as const)
      .filter((k) => !t[k]);
    if (missingSub.length) {
      errors.push(...missingSub.map((k) => `${s.id}: thresholds.${k} missing`));
      continue;
    }
    if (!(t.swellDir.ideal >= 0 && t.swellDir.ideal <= 360)) {
      errors.push(`${s.id}: swellDir.ideal out of range 0-360`);
    }
    if (!(t.facingDirection >= 0 && t.facingDirection <= 360)) {
      errors.push(`${s.id}: facingDirection out of range 0-360`);
    }
    if (
      !(
        t.tide.yellowMin <= t.tide.greenMin &&
        t.tide.greenMin < t.tide.greenMax &&
        t.tide.greenMax <= t.tide.yellowMax
      )
    ) {
      errors.push(`${s.id}: tide window ordering invalid`);
    }
    if (!(t.swellDir.greenWindow <= t.swellDir.yellowWindow)) {
      errors.push(`${s.id}: swellDir windows inverted`);
    }
    if (!(t.swellHeight.yellowMin <= t.swellHeight.greenMin)) {
      errors.push(`${s.id}: swellHeight thresholds inverted`);
    }
    if (!(t.swellPeriod.yellowMin <= t.swellPeriod.greenMin)) {
      errors.push(`${s.id}: swellPeriod thresholds inverted`);
    }
    for (const cat of ["offshore", "crossShore", "onshore"] as const) {
      if (!(t.wind[cat].greenMax <= t.wind[cat].yellowMax)) {
        errors.push(`${s.id}: wind.${cat} thresholds inverted`);
      }
    }
  }

  return errors;
}
