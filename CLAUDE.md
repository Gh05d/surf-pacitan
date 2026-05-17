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

After `bun run build`, restart the service: `systemctl restart surf-pacitan.service`
Frontend-only changes (CSS, components) don't need a service restart — nginx serves static files directly from `/var/www/surf-pacitan/`.

## Architecture

Mobile-first tide forecast app for Pacitan surf spots. Hono API server fetches tide/weather data on a schedule, caches in Redis, serves to a React frontend.

**Data flow:** StormGlass API → parsers (`stormglass.ts`) → surfable rating computed (`surfable.ts`) → cached as `ForecastDay` JSON in Redis (`cache.ts`) → served via Hono endpoints (`routes.ts`) → React frontend renders tide graph + conditions.

**Cron schedule (`cron.ts`):** Tides fetched once daily (astronomical, don't change). Weather/swell fetched every 3h. On startup, tides run first, then weather merges into cached tide data. StormGlass free tier = 10 requests/day — used only for tides (3 req/day). Swell from Open-Meteo Marine API, weather from Open-Meteo Weather API (both free, no quota).

**StormGlass quota gotcha:** When quota is exceeded, the API may return HTTP 200 with `hours: []` (empty data) instead of 402. The code detects both cases and falls back to Open-Meteo.

**Surfable logic (`surfable.ts`):** Rates each hour green/yellow/red as the weakest link across five per-factor judgments: tide bell curve, swell direction window, swell height, swell period, and wind speed (categorized as offshore/cross-shore/onshore via `getWindCategory` against `facingDirection`). Each spot has its own thresholds in `config.ts`. **Tide curves are per-spot**: Pancer (river-mouth sandbar at the western end of the bay) drowns at high tide and works best at lower-mid rising; Pancer Door (middle, long open beach) tolerates higher tide; Teleng Ria (east end) handles peak high best. **Swell direction is per-spot**: Pancer is sheltered from SW by the western headland and prefers more southerly swells; Teleng Ria prefers SW. A global falling-tide cap downgrades any green result to yellow because sandbar breaks need rising water.

**Spot geography (local naming, west to east):** Pancer (river mouth, west end) → Pancer Door (long middle beach) → Teleng Ria (east end). Public surf guides (surfindonesia, surfline) describe "Pancer" / "Pancer Door" as the eastern river-mouth break — that conflicts with the local convention used by this app's UI. Follow the local convention; ignore guide naming for spot identity.

**Frontend:** Swipeable day views with uPlot tide chart. Canvas overlays for surfable zone bands, now marker, and H/L labels are in `TideGraph.tsx` draw hooks (Canvas API, not React styles). `ConditionsPanel.tsx` groups Swell/Wind/Weather cards into a single panel with 3h time block navigation (◀ ▶ arrows, daylight blocks only). Each component has a co-located `.css` file using CSS nesting.

## Environment Variables

- `STORMGLASS_API_KEY` — required (StormGlass API)
- `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` — Redis connection (defaults: 127.0.0.1:6379)
- `PORT` — server port (default 3100)
- `NODE_ENV` — set to `production` for static file serving from `/var/www/surf-pacitan/`

## Key Conventions

- No inline styles in React components — use co-located `.css` files with CSS nesting.
- TideGraph canvas drawing code (`hooks.draw`) uses Canvas API, not React styles — don't try to extract those to CSS.
- uPlot clips drawing to `u.bbox` — don't try to draw spot bands or labels outside the plot area via Canvas. Use HTML elements below the chart instead.
- The swipe handler in `App.tsx` excludes `.spot-map` via `closest()` check. Any new interactive component with its own touch handling needs the same exclusion.
- For multi-touch components: `App.tsx` swipe handler also tracks `multiTouchActive` and skips swipe detection if any 2-finger touch occurred during the gesture. Don't `stopPropagation` on every touchstart from a child — let App see at least one `touches.length > 1` event.
- uPlot `scales.x.range` must be a **function** (`(u, min, max) => [min ?? def, max ?? def]`), not a static array `[a, b]` — uPlot wraps static arrays via `fnOrSelf` so `setScale()` calls are silently overridden on the next render.
- Pinch-zoom on the tide chart lives **only inside `TideGraphModal`** (gated by `enableZoom` prop on `TideGraph`). The inline chart attaches no touch handlers — inline pinch conflicts with the App day-swipe and uPlot's drag handlers, and a 200px-tall chart is too small to pinch usefully. Tap the chart or `⤢ Zoom` button to open the modal.
- Use relative imports (`../shared/types`, `./config`), not `@shared/*` path aliases — `bun test` doesn't resolve tsconfig paths.
- StormGlass wind was **m/s** (conversion in `stormglass.ts`). Open-Meteo wind is already **km/h** — no conversion needed.
- All StormGlass timestamps are UTC. Parsers convert to UTC+7 (Asia/Jakarta) for local time.
- Shared types live in `src/shared/types.ts` — used by both server and client.

## Deployment

- systemd: `surf-pacitan.service` (safe to restart, no persistent state)
- nginx: `surf-pacitan.conf` → `surf-pacitan.yolo-goldgrube.pp.ua`
- Static build: `/var/www/surf-pacitan/`
- Git remote uses SSH alias `github-surf-pacitan` (configured in `~/.ssh/config`) for deploy key.

## Service Worker / Cache Busting

- Bump `CACHE_NAME` in `public/sw.js` on every deploy that ships JS/CSS changes — the SW deletes old caches on activate.
- SW is **network-first for HTML** (so the freshest content-hashed bundle is always referenced) and **stale-while-revalidate for `/assets/*`** (hashed filenames make this safe).
- `index.html` listens for `controllerchange` and auto-reloads once the new SW takes over, so users get fresh content on a single reload after a deploy.
- Verify what's actually deployed: `grep "<pattern>" /var/www/surf-pacitan/assets/index-*.js` (filenames are content-hashed by Vite).
