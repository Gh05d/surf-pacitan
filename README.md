# 🏄 Surf Pacitan

Tide forecast app for Pacitan surf spots on Java's south coast. Shows a 3-day forecast with surfable window predictions based on tide, swell, wind, and daylight conditions.

**Live:** [surf-pacitan.yolo-goldgrube.pp.ua](https://surf-pacitan.yolo-goldgrube.pp.ua)

## Features

- **Tide graph** with color-coded surfable zones (green/yellow/red)
- **Best window recommendation** with explanation
- **Swell, wind, and weather** conditions per hour
- **Offshore/onshore/cross-shore** wind classification
- **Sunrise/sunset** with daylight duration bar
- **Swipeable** 3-day navigation (mobile-first)
- **Auto-updating** — fetches fresh data every 3 hours

## How It Works

The app fetches tide and weather data from [StormGlass.io](https://stormglass.io) (with [Open-Meteo](https://open-meteo.com) as weather fallback), caches it in Redis, and serves it through a lightweight API. The frontend renders an interactive tide chart with surfable windows highlighted.

### Surfable Window Logic

Pacitan's beaches (Pancer Door, Pancer) are south-facing sandbar breaks. The surfable rating is computed per hour:

| Rating | Conditions |
|--------|-----------|
| **Green** | Rising tide >50% (or falling >80%), swell ≥0.5m, wind <20 km/h, daylight |
| **Yellow** | Mid tide 30-50%, or marginal swell/wind |
| **Red** | Low tide <30%, flat (<0.3m swell), blown out (>30 km/h), or dark |

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Backend:** [Hono](https://hono.dev) (port 3100)
- **Frontend:** React + [Vite](https://vite.dev) + [uPlot](https://github.com/leeoniya/uPlot)
- **Cache:** Redis
- **Data:** StormGlass.io (primary), Open-Meteo (fallback)

## Setup

```bash
bun install
cp .env.example .env  # add your StormGlass API key
bun run dev            # start API server with watch mode
bun run dev:client     # start Vite dev server (proxies /api → :3100)
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STORMGLASS_API_KEY` | Yes | — | [StormGlass.io](https://stormglass.io) API key (free tier: 10 req/day) |
| `REDIS_HOST` | No | 127.0.0.1 | Redis host |
| `REDIS_PORT` | No | 6379 | Redis port |
| `REDIS_PASSWORD` | No | — | Redis password |
| `PORT` | No | 3100 | API server port |

## License

MIT
