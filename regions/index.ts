import type { RegionConfig } from "../src/shared/region";
import { PACITAN } from "./pacitan";

export const REGIONS: Record<string, RegionConfig> = {
  [PACITAN.id]: PACITAN,
};

export function getRegion(id: string): RegionConfig {
  const region = REGIONS[id];
  if (!region) {
    throw new Error(
      `Unknown REGION "${id}" — available: ${Object.keys(REGIONS).join(", ")}`,
    );
  }
  return region;
}
