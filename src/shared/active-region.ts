// Resolves the active region pack. The Bun server (and bun test) reads
// process.env.REGION; the Vite client build injects __REGION__ via `define`
// (esbuild replaces `typeof __REGION__` correctly). Default: pacitan.
// Fails fast on unknown region or invalid pack — at server boot AND at
// client build time, both of which import this module.
import { getRegion } from "../../regions";
import { validateRegionConfig } from "./region";

declare const __REGION__: string | undefined;

const regionId =
  typeof __REGION__ !== "undefined" && __REGION__
    ? __REGION__
    : (typeof process !== "undefined" ? process.env.REGION : undefined) ?? "pacitan";

export const ACTIVE_REGION = getRegion(regionId);

const errors = validateRegionConfig(ACTIVE_REGION);
if (errors.length) {
  throw new Error(
    `Region "${ACTIVE_REGION.id}" config invalid:\n  - ${errors.join("\n  - ")}`,
  );
}
