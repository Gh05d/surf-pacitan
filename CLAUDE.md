# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun test                         # run all tests
bun test tests/surfable.test.ts  # run a single test file
bun test tests/surfable.test.ts -t "<describe-name>"  # scope to one describe block (TDD)
bun run dev                      # server with --watch (port 3100)
bun run dev:client               # Vite dev server (proxies /api → :3100)
bun run build                    # production build → /var/www/surf-pacitan/
bun run start                    # production server
```

Inspect live model output without Redis auth: `curl -s http://127.0.0.1:3100/api/forecast | python3 -c "import json,sys; d=json.load(sys.stdin); ..."`. Returns the same cached `ForecastDay` Redis holds.

Manually trigger a recommendation generation (skip waiting for 20:00 WIB cron): from `/root/surf-pacitan/`, run `bun -e 'import("./src/server/recommendation.ts").then(m => m.generateTomorrowRecommendation()).then(() => process.exit(0))'` — uses `.env` via Bun's auto-load, writes to Redis on success. The explicit `process.exit` matters: the open Redis handle otherwise keeps the process alive forever after success. To backfill a **specific** date (after midnight WIB "tomorrow" has moved past a missed date), pass it explicitly: `m.generateTomorrowRecommendation(undefined, "YYYY-MM-DD")`.

Pre-restart sanity check: `bun build src/server/index.ts --target bun --outdir /tmp/x` (then delete `/tmp/x`) — bundles the server entry and catches syntax/import errors in modules the tests never load (`cron.ts` is kept out of tests via the Redis rule). Booting the server instead would cost 3 StormGlass requests.

After `bun run build`, restart the service: `systemctl restart surf-pacitan.service`
Frontend-only changes (CSS, components) don't need a service restart — nginx serves static files directly from `/var/www/surf-pacitan/`.

## Architecture

Mobile-first tide forecast app for Pacitan surf spots. Hono API server fetches tide/weather data on a schedule, caches in Redis, serves to a React frontend.

**Data flow:** StormGlass API → parsers (`stormglass.ts`) → surfable rating computed (`surfable.ts`) → cached as `ForecastDay` JSON in Redis (`cache.ts`) → served via Hono endpoints (`routes.ts`) → React frontend renders tide graph + conditions.

**Cron schedule (`cron.ts`):** Tides fetched once daily (astronomical, don't change). Weather/swell fetched every 3h. On startup, tides run first, then weather merges into cached tide data. StormGlass free tier = 10 requests/day, reset at **UTC midnight** (07:00 WIB) — used only for tides (3 req/day). **Every `systemctl restart` re-fetches tides on startup = 3 more StormGlass requests**, and ad-hoc probes (curl tests, review agents) count against the same quota — check `stormglassQuota` at `/api/status` before restarting after probe-heavy sessions. Swell from Open-Meteo Marine API, weather from Open-Meteo Weather API (both free, no quota).

**StormGlass quota gotcha:** When quota is exceeded, the API may return HTTP 200 with an empty `data: []` array instead of 402. `fetchAndCacheTides` detects this and bails out keeping the existing tide cache (there is **no** Open-Meteo fallback for tides — a persistent StormGlass outage means the cached tide curve drifts ~50 min/day until the 4-day cache TTL expires). Remaining quota is read from the response `meta` and shown at `/api/status`.

**StormGlass timestamp formats are endpoint-inconsistent (2026-06-10 fix):** the **extremes** endpoint returns UTC (`+00:00`) timestamps while **sea-level** echoes the request's `+07:00` offset back. Parsers must bucket by the **WIB-local** date via epoch math (`localDateStr(utcToLocal(...))` in `stormglass.ts`), never by the raw `time.slice(0, 10)` prefix — the prefix filter shifted every 00:00–06:59 WIB tide extreme one day early (phantom/missing morning H/L labels on the chart). Test fixtures use both real formats; keep it that way.

**Open-Meteo Marine swell gotcha:** `swell_wave_*` is the **largest-amplitude** swell component, not the longest-period one. When a tall local windsea outranks a long-period Indian Ocean groundswell, the actual surf swell lands in `secondary_swell_wave_*`. `pickSurfSwell` in `open-meteo.ts` selects the surf-relevant component: secondary only if its height ≥ 0.3m AND ≥ 0.33× the primary's height AND its period ≥ 1.5× primary, else primary. The height-ratio gate (`SURF_SWELL_SECONDARY_MIN_PRIMARY_RATIO`) stops a tiny long-period sliver (e.g. 0.4m/16.8s) from hijacking a much larger primary groundswell (e.g. 2.1m/11s) and crushing the height rating to yellow/red (2026-05-29 fix). Verified via `scripts/verify-vs-wisuki.ts`.

**Open-Meteo Weather model:** default `best_match` returns aberrant NE wind at the Pacitan coast (NE 35° while GFS/ECMWF/ICON/Wisuki all agree on E 87-130°). Code sets `models=gfs_seamless` explicitly via `OPEN_METEO_WEATHER_MODEL` in `config.ts`.

**Shared logic (2026-06-10):** Rating/window logic and spot thresholds live in `src/shared/` (`spot-config.ts`, `surfable.ts` incl. `computeFactorBreakdown`/`describeLimitingFactor`, `candidates.ts` incl. `bestRemainingWindow`) and are used by server AND client. `src/server/{config,surfable,candidates}.ts` only re-export (shims) — edits belong in the shared files. UI components must NEVER hardcode threshold/factor claims as text (lesson: the windows box statically claimed "Rising tide + favorable wind") — always render from `SPOT_THRESHOLDS` / `computeFactorBreakdown`.

**Surfable logic (`src/shared/surfable.ts`):** Rates each hour green/yellow/red as the weakest link across five per-factor judgments: tide bell curve, swell direction window, swell height, swell period, and wind speed (categorized as offshore/cross-shore/onshore via `getWindCategory` against `facingDirection`). Each spot has its own thresholds in `src/shared/spot-config.ts`. **Tide curves are per-spot**: Pancer (river-mouth sandbar at the **eastern** end of the bay) drowns at high tide and works best at lower-mid rising; Pancer Door (middle, long open beach) tolerates higher tide; Teleng Ria (**west** end) handles peak high best. **Swell direction is per-spot**: Teleng Ria (west) is sheltered from SW by the western headland and prefers more southerly swell (ideal ~195°); Pancer (east, river mouth) is the most SW-exposed and favours SW swell (ideal ~215°); Pancer Door sits between (~210°). A global falling-tide cap downgrades any green result to yellow because sandbar breaks need rising water.

**Spot geography (west to east):** Teleng Ria (west end) → Pancer Door (long middle beach) → Pancer (river mouth, east end). Confirmed by the user 2026-05-29: standing on the beach at Pancer Door facing the ocean (≈south), Pancer is to the left (= east, Grindulu river mouth), Teleng Ria to the right (= west). This matches the public surf guides (surfindonesia, surf atlas, wannasurf), satellite imagery, and the Grindulu river-mouth coordinate (~111.104°E). The earlier app convention (Pancer = west) was wrong; config, knowledge-base, SPOT_DISPLAY order and SpotMap labels were corrected to this layout.

**Resolved mismatch (2026-05-29):** Previously `SpotMap.tsx`'s coordinates conflicted with the config labels. The coordinates were right (Teleng Ria westmost `111.0790`, the river mouth easternmost `~111.10`); the labels were wrong. SpotMap's easternmost river-mouth marker is now `Pancer` (was mislabeled `Pancer Door`) and the middle marker `Pancer Door`. **LOCATION investigated & kept (2026-05-29):** `LOCATION` (`111.13`) snaps to the offshore marine cell `-8.291, 111.125` (~8 km S of the bay). The Open-Meteo marine grid is ~9 km coarse with only two usable cells near Pacitan — this offshore one and a coastal one (`-8.208, 111.042`, ~4 km W of the bay); neither sits on the bay. The offshore cell is the better pick: its swell height (~1.9 m) matches the Wisuki/Surfline deep-water convention and its direction/period are validated, whereas the coastal cell reads ~18% lower (diverging from reference forecasts) with **no** rating benefit — the 0.5 m green height threshold never binds against real 1.3–1.9 m swell. Decision: keep `111.13`, don't chase a "tidier" coordinate.

**Frontend:** Swipeable day views with uPlot tide chart. Canvas overlays in `TideGraph.tsx` draw hooks (Canvas API, not React styles): night overlay, now marker, H/L tide-extreme labels, and three per-spot rating strips (P/PD/TR) at the bottom of the plot area. `ConditionsPanel.tsx` groups Swell/Wind/Weather cards into a single panel with 3h time block navigation (◀ ▶ arrows, daylight blocks only). Each component has a co-located `.css` file using CSS nesting.

**Daily AI recommendation:** Once daily at 20:00 WIB (`cron.ts` → `recommendation.ts`), the cached `ForecastDay` for *tomorrow* is fed to an LLM along with `src/server/knowledge-base.ts` (a Pacitan-specific system prompt). **Provider chain (2026-06-10, mirrors the meme-scraper Don pattern):** primary is the **Claude CLI** (`src/server/claude-cli.ts`, Max-subscription OAuth — free, `ANTHROPIC_API_KEY` stripped from the child env so it can never hit the metered API); **DeepSeek V4 Flash is only the fallback** when the CLI fails or returns an invalid recommendation. Each provider gets 2 attempts (call + validation failures both retry). `modelUsed` on the cached rec records which one answered. The model returns a structured JSON recommendation cached at `surf:recommendation:YYYY-MM-DD` (TTL 36h). `/api/recommendation` looks up **tomorrow's** rec first, falls back to today's — so the rec is readable from 20:00 WIB onwards, not after midnight (this is the whole point: read evening-of, plan tomorrow). The `RecommendationCard` derives "heute"/"morgen" eyebrow from `recommendation.forDate` vs `todayWIB()`. Validated for shape and bounds; failed validation **or a failed/truncated DeepSeek call** retries once (one in-loop retry, then gives up preserving the cached rec). Gated by `RECOMMENDATION_ENABLED` + `DEEPSEEK_API_KEY` — feature is fully no-op if either is missing. The rec snapshots the 20:00-WIB forecast; the chart re-rates every 3h afterwards — small rec↔chart mismatches the next morning are expected drift, not bugs.

**Candidate anchoring (2026-06-07):** The pick is no longer a free LLM choice. `src/shared/candidates.ts` (pure, tested) ranks 2–3h windows per spot from the per-hour `surfable` ratings (greens → green density → rising share → mean wind → earlier start; west-to-east on full ties) and ships the top-3 as `candidateWindows` in the payload. The prompt instructs default-to-rank-1; `validateRecommendation(raw, context)` enforces a red-hour floor (always) and requires a non-empty `overrideReason` (≤300 chars, whitespace-trimmed) for any pick deviating from rank 1 beyond ±1h — rejections feed the existing retry, and the reason is persisted/rendered on the card ("Differs from the top-rated window") only for genuine deviations. Empty candidate list (fully red day) degrades to legacy free-pick validation. Live-verified 2026-06-07: 3 identical regenerations → 3× exactly rank 1 (pre-feature: 3 different picks). If the model overrides too eagerly in practice, tighten the prompt or narrow to candidate-list-only picks (variant B in the spec).

**DeepSeek thinking-mode gotchas (2026-06-07 incident):** `max_tokens` is a **shared budget for reasoning + final answer**. Reasoning for this prompt runs ~1400–3600+ tokens (stochastic); with the old `max_tokens: 4000` an overrun returned HTTP 200 with `finish_reason: "length"` and **empty `content`** → parse error → (pre-fix) no retry → the API silently served yesterday's rec all next day, mislabeled-in-spirit as "today". Now: `max_tokens: 8000`, empty/`length` responses throw a distinct `"truncated"` `DeepSeekError`, and call failures retry once. Also: `fetch` resolves on **headers**, but DeepSeek streams keep-alive bytes while thinking — the body read is the slow path (~40s observed), so the abort timeout covers the full body read (`DEEPSEEK_TIMEOUT_MS = 120s`). If a rec is missing for a date (cron only re-arms +24h, missed days are never auto-recovered), regenerate manually with the `bun -e` one-liner above. Also: `temperature: 0` does NOT make picks deterministic — the reasoning chain itself is nondeterministic (3× temp=0 → 3 different picks, 2026-06-07). Pick stability comes from candidate anchoring, not sampling params.

## Environment Variables

- `STORMGLASS_API_KEY` — required (StormGlass API)
- `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` — Redis connection (defaults: 127.0.0.1:6379)
- `PORT` — server port (default 3100)
- `NODE_ENV` — set to `production` for static file serving from `/var/www/surf-pacitan/`
- `DEEPSEEK_API_KEY` — DeepSeek API key (**fallback** provider for the daily AI recommendation; primary is the Claude CLI)
- `RECOMMENDATION_CLI` — `"false"` disables the Claude-CLI primary (recommendation becomes DeepSeek-only again)
- `RECOMMENDATION_CLI_MODEL` — CLI model alias, default `sonnet` (alternatives: `opus`, `fable`)
- `CLAUDE_CLI_PATH` — absolute path override for the `claude` binary (default resolution: `~/.local/bin/claude` → `~/.bun/bin/claude` → `/usr/local/bin/claude` → bare name)
- `DEEPSEEK_MODEL` — defaults to `deepseek-v4-flash`. Set to e.g. `deepseek-v4-pro` to use a stronger model.
- `DEEPSEEK_THINKING` — `"false"` omits the `thinking` field from the request, but **V4 Flash reasons anyway** (reasoning_tokens appear regardless; verified 2026-06-07) — de facto a no-op.
- `RECOMMENDATION_ENABLED` — `"false"` to disable the daily recommendation cron entirely (e.g. when away from Pacitan). Default: enabled when at least one provider is available (Claude CLI enabled or `DEEPSEEK_API_KEY` set). An explicit `"true"` without any provider stays **disabled**.
- `REFRESH_TOKEN` — required by `POST /api/refresh` (header `X-Refresh-Token`); unset = endpoint disabled (401). Gate exists because the endpoint is publicly reachable and each call burns 3 of the 10 daily StormGlass requests. Value lives in `/root/surf-pacitan/.env`.

## Key Conventions

- No inline styles in React components — use co-located `.css` files with CSS nesting.
- TideGraph canvas drawing code (`hooks.draw`) uses Canvas API, not React styles — don't try to extract those to CSS.
- uPlot clips drawing to `u.bbox` — don't try to draw spot bands or labels outside the plot area via Canvas. Use HTML elements below the chart instead.
- The swipe handler in `App.tsx` excludes `.spot-map` via `closest()` check. Any new interactive component with its own touch handling needs the same exclusion.
- For multi-touch components: `App.tsx` swipe handler also tracks `multiTouchActive` and skips swipe detection if any 2-finger touch occurred during the gesture. Don't `stopPropagation` on every touchstart from a child — let App see at least one `touches.length > 1` event.
- uPlot `scales.x.range` must be a **function** (`(u, min, max) => [min ?? def, max ?? def]`), not a static array `[a, b]` — uPlot wraps static arrays via `fnOrSelf` so `setScale()` calls are silently overridden on the next render.
- Pinch-zoom on the tide chart lives **only inside `TideGraphModal`** (gated by `enableZoom` prop on `TideGraph`). The inline chart attaches no touch handlers — inline pinch conflicts with the App day-swipe and uPlot's drag handlers, and a 200px-tall chart is too small to pinch usefully. Tap the chart or `⤢ Zoom` button to open the modal.
- Use relative imports (`../shared/types`, `./config`), not `@shared/*` path aliases — `bun test` doesn't resolve tsconfig paths.
- Open-Meteo wind is already **km/h** — no conversion needed (no wind parsing remains in `stormglass.ts`; only tides/astronomy come from StormGlass).
- `tide.rising` is a **forward difference** (compares hour H against H+1): it describes the surf hour [H, H+1), so the hour right after a low reads rising and the hour after a high reads falling. The falling-tide cap and `risingShare` depend on this — don't revert to a backward diff (lags the tide turn by 1h).
- The daylight gate is **minute-aware**: an hour is rated only if its center (H:30) lies between sunrise and sunset (≈ ≥30 min of light). Hour-granular gating erased the dusk session in Dec–Jan and rated a pitch-dark 05:00.
- All StormGlass timestamps are UTC. Parsers convert to UTC+7 (Asia/Jakarta) for local time.
- Shared types live in `src/shared/types.ts` — used by both server and client.
- Per-spot UI metadata (label / abbreviation / emoji) lives in `src/shared/spots.ts` as `SPOT_DISPLAY`, ordered west-to-east. Use it for any spot-labeled UI; don't hardcode `"Pancer"`/`"🏖️"` etc. in components.
- TideGraph reserves the bottom 77px of the plot area for the per-spot strips via `STRIP_RESERVED` + the `scales.y.range` callback (inflates the y-data range downward by `STRIP_RESERVED * (dataRange / usableHeight)`). To add a new fixed-pixel canvas overlay, extend the reservation, don't try to draw past `u.bbox`.
- `bun test` uses one shared module cache across all test files (single process). Module-load-time env reads in `config.ts` happen once. To force config values in a test, use `mock.module("../src/server/config", () => ({ ...realConfig, KEY: value }))` after `const realConfig = await import("../src/server/config")` — minimal mocks break when transitive imports need other exports. See `tests/routes.test.ts` for the pattern.
- Don't import `cache.ts` (transitively) in unit tests — module-load opens a Redis connection. Existing tests stay Redis-free; extract pure logic to its own file (`schedule.ts` exists for this — its `nextFireMs` lives alone so the test doesn't drag in `cache.ts` via `cron.ts`).
- `bunx tsc --noEmit` has pre-existing failures from broken `../../../shared/types` paths in some client components (Conditions/DayView/TideGraph/etc — should be `../../shared/types`). Vite/Bun bundler resolution masks them at runtime. Use `bun test` as the verification gate, not tsc. Don't "fix" the paths in passing.
- Run `bun run scripts/verify-vs-wisuki.ts` after touching swell parsing — compares our picker against Wisuki forecast (forward ~10 days, deterministic HTML parse). Target: 100% surfable-rating-bin agreement.
- Wisuki has **no archive** — `?date=` param is ignored, page always shows current+future ~10 days. Don't trust LLM-based `WebFetch` for past Wisuki dates (it hallucinates plausible-looking values). For past-data verification use Stormglass with `past_days` (note caveat below).
- **Stormglass aggregates (`sg` blend) dampen long-period swell components** in this region — their secondary may show 0.2m when GFS/Open-Meteo see 0.6m of real groundswell. SG is NOT a valid ground-truth for surf-swell picker validation. Use Wisuki or NOAA WW3 instead.

## Deployment

- systemd: `surf-pacitan.service` (safe to restart, no persistent state)
- nginx: `surf-pacitan.conf` → `surf-pacitan.yolo-goldgrube.pp.ua`
- Static build: `/var/www/surf-pacitan/`
- Git remote uses SSH alias `github-surf-pacitan` (configured in `~/.ssh/config`) for deploy key.
- Production secrets live in `/root/surf-pacitan/.env` (gitignored). The systemd unit uses `EnvironmentFile=-/root/surf-pacitan/.env` to load them; only `PORT` and `NODE_ENV` stay inline as `Environment=` directives. To add/rotate a secret: edit `.env`, then `systemctl restart surf-pacitan.service` (no `daemon-reload` needed unless the unit file itself changes). Bun also auto-loads `.env` for `bun run dev` locally.

## Service Worker / Cache Busting

- Bump `CACHE_NAME` in `public/sw.js` on every deploy that ships JS/CSS changes — the SW deletes old caches on activate.
- SW is **network-first for HTML** (so the freshest content-hashed bundle is always referenced) and **stale-while-revalidate for `/assets/*`** (hashed filenames make this safe).
- `index.html` listens for `controllerchange` and auto-reloads once the new SW takes over, so users get fresh content on a single reload after a deploy.
- Verify what's actually deployed: `grep "<pattern>" /var/www/surf-pacitan/assets/index-*.js` (filenames are content-hashed by Vite).
