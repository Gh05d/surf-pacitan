# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun test                         # run all tests
bun test tests/surfable.test.ts  # run a single test file
bun run dev                      # server with --watch (port 3100)
bun run dev:client               # Vite dev server (proxies /api → :3100)
bun run build                    # production build → /var/www/surf-pacitan/
bun run start                    # production server
```

After `bun run build`, restart the service: `systemctl restart surf-pacitan.service`
Frontend-only changes (CSS, components) don't need a service restart — nginx serves static files directly from `/var/www/surf-pacitan/`.

## Architecture

Mobile-first tide forecast app for Pacitan surf spots. Hono API server fetches tide/weather data on a schedule, caches in Redis, serves to a React frontend.

**Data flow:** StormGlass API → parsers (`stormglass.ts`) → surfable rating computed (`surfable.ts`) → cached as `ForecastDay` JSON in Redis (`cache.ts`) → served via Hono endpoints (`routes.ts`) → React frontend renders tide graph + conditions.

**Cron schedule (`cron.ts`):** Tides fetched once daily (astronomical, don't change). Weather/swell fetched every 3h. On startup, tides run first, then weather merges into cached tide data. StormGlass free tier = 10 requests/day — used only for tides (3 req/day). Swell from Open-Meteo Marine API, weather from Open-Meteo Weather API (both free, no quota).

**StormGlass quota gotcha:** When quota is exceeded, the API may return HTTP 200 with `hours: []` (empty data) instead of 402. The code detects both cases and falls back to Open-Meteo.

**Surfable logic (`surfable.ts`):** Rates each hour green/yellow/red based on tide position (% of daily range), swell height, wind speed+direction, and daylight. Each spot has a `facingDirection` in `config.ts`; `getWindCategory()` classifies wind as onshore/cross-shore/offshore and applies direction-dependent thresholds (onshore is strictest, offshore most tolerant). Pancer Door is a south-facing sandbar break — low tide = too shallow, rising to high tide = ideal. Falling tide is never green (sandbar beachbreaks need rising water).

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
- Use relative imports (`../shared/types`, `./config`), not `@shared/*` path aliases — `bun test` doesn't resolve tsconfig paths.
- StormGlass wind was **m/s** (conversion in `stormglass.ts`). Open-Meteo wind is already **km/h** — no conversion needed.
- All StormGlass timestamps are UTC. Parsers convert to UTC+7 (Asia/Jakarta) for local time.
- Shared types live in `src/shared/types.ts` — used by both server and client.

## Deployment

- systemd: `surf-pacitan.service` (safe to restart, no persistent state)
- nginx: `surf-pacitan.conf` → `surf-pacitan.yolo-goldgrube.pp.ua`
- Static build: `/var/www/surf-pacitan/`
- Git remote: `origin` (SSH alias `github-surf-pacitan` in `~/.ssh/config` for deploy key). Push with `git push origin main`.
