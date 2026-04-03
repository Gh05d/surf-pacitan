# Surf Pacitan

Tide forecast app for Pacitan surf spots (Pancer Door, Pancer).

## Stack
- Runtime: Bun
- Backend: Hono on port 3100
- Frontend: React + Vite, production build to /var/www/surf-pacitan/
- Cache: Redis (localhost:6379), keys prefixed with `surf:`
- Data: StormGlass.io (primary), Open-Meteo (weather fallback)

## Commands
- `bun run dev` — start server with watch mode
- `bun run dev:client` — start Vite dev server (proxies /api to :3100)
- `bun run build` — production build to /var/www/surf-pacitan/
- `bun test` — run tests
- `bun run start` — production server

## Key Files
- `src/server/index.ts` — Hono entry + cron scheduler
- `src/server/surfable.ts` — surfable window logic (green/yellow/red)
- `src/server/config.ts` — location, thresholds, constants
- `src/client/components/TideGraph.tsx` — main tide chart (uPlot)

## Environment Variables
- `STORMGLASS_API_KEY` — required for StormGlass API
- `PORT` — server port (default 3100)
- `REDIS_URL` — Redis connection (default redis://localhost:6379)
