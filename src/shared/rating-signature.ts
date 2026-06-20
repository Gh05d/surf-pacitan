import type { ForecastDay } from "./types";

// Deterministic string of every hour's per-spot rating category. Used to detect
// whether the green/yellow/red grid changed (vs. mere numeric drift) since a
// recommendation was generated, so the morning recheck regenerates only on a
// real category flip. Spot ids are sorted so the signature is independent of
// object-key enumeration order.
export function ratingSignature(forecast: ForecastDay): string {
  return forecast.hourly
    .map((h) => {
      const spots = Object.keys(h.surfable).sort();
      return `${h.hour}:` + spots.map((s) => `${s}=${h.surfable[s]}`).join(",");
    })
    .join("|");
}
