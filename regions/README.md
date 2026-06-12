# Region Packs

One folder per region. Exactly ONE region is active per deployment, selected by
the `REGION` env var (server + `bun test`) and at build time for the client
(`REGION=<id> bun run build`). Default: `pacitan`.

A pack = `regions/<id>/index.ts` (a `RegionConfig`, see `src/shared/region.ts`)
+ `regions/<id>/knowledge-base.ts` (regional LLM expertise, server-only).
Register both: the config in `regions/index.ts` (`REGIONS`), the knowledge in
`src/server/knowledge-base.ts` (`REGION_KNOWLEDGE`).

## Adding a region — checklist

Thresholds and knowledge CANNOT be copied from another region — they encode
local geography. Budget a few hours of validation against a reference
forecast (Wisuki/Surfline) before trusting the ratings.

1. **Marine grid cell** — pick `location` for the Open-Meteo Marine API
   (~9 km grid). Compare candidate cells' swell height/direction/period
   against Wisuki/Surfline for the area. Prefer the offshore cell that
   matches the deep-water convention (Pacitan lesson 2026-05-29: the coastal
   cell read ~18% low with no rating benefit). StormGlass tides use the same
   coordinate — tides are far less grid-sensitive.
2. **Weather model** — check Open-Meteo's `best_match` wind direction at the
   coast against GFS/ECMWF/ICON and a reference forecast. If `best_match`
   diverges (Pacitan: NE 35° vs E 87-130° consensus), pin a model via
   `weatherModel` (e.g. `"gfs_seamless"`).
3. **Timezone** — IANA name (e.g. `"Europe/Lisbon"`). DST is handled
   automatically (`src/shared/time.ts`); cron times are local wall-clock.
4. **Spots** — per spot: coordinates (map markers), `facingDirection`
   (direction the beach faces toward the sea), `fallingTideCap` (true for
   sandbar breaks needing rising water, false for point/reef), and
   `thresholds` (tide window in % of daily range, swell direction
   ideal±windows, height/period minimums, wind limits per category). Order
   the array in natural display order (e.g. west-to-east) — it's also the
   candidate-ranking tiebreak order.
5. **Knowledge base** — write `regions/<id>/knowledge-base.ts`: who-you-are
   intro, spot geography (with the exact spot `id` keys), local wind pattern
   (sea/land breeze times), tide-range interpretation for the local tidal
   regime, any seasonal swell context. Mirror `regions/pacitan/knowledge-base.ts`
   in structure. NEVER import this from client code.
6. **Verify** — set `verifyWisukiUrl` (find the spot on wisuki.com) and run
   `REGION=<id> bun run scripts/verify-vs-wisuki.ts`. The script derives its
   rating bins from the pack (most-permissive per factor) and logs them.
   Iterate thresholds until ratings match local reality. Notes: the daylight
   filter is a tropical approximation (06-17 local) — revisit for
   high-latitude regions; StormGlass `sg`-blend aggregates dampen long-period
   swell in some regions — use Wisuki or NOAA WW3 as ground truth, not SG.
7. **Validation runs at boot** — `validateRegionConfig` rejects malformed
   packs at server start / client build with a list of errors. A region
   registered without a knowledge-base entry fails the registry-coverage
   test in `tests/recommendation.test.ts` (and would otherwise only fail at
   the nightly 20:00 generation).

## Deploying a region

Each region deployment needs:
- **StormGlass key**: ideally its own free-tier key (10 req/day; tides cost
  3/day + 3 per restart).
- **Env** (systemd unit / `.env`): `REGION=<id>`, `STATIC_ROOT=/var/www/surf-<id>`,
  plus the usual secrets (`STORMGLASS_API_KEY`, `DEEPSEEK_API_KEY`, ...).
- **Build**: `REGION=<id> BUILD_OUT_DIR=/var/www/surf-<id> bun run build`.
- **Redis**: keys are auto-namespaced `surf:<id>:*` — multiple regions can
  share one Redis. Switching regions on one server leaves the old region's
  keys to expire via TTL (4 days forecast / 36 h recommendation).
- **nginx**: new vhost + domain per deployment (see server CLAUDE.md "Neue
  Subdomain anlegen"); the app never references its own domain.
- **Service worker**: bump `CACHE_NAME` in `public/sw.js` (deploy convention).
