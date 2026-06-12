import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { api } from "./routes";
import { startScheduler } from "./cron";
import { DEFAULT_PORT } from "./config";
import { ACTIVE_REGION } from "../shared/active-region";

const app = new Hono();

// CORS middleware
app.use("/*", cors());

// Mount API routes
app.route("/api", api);

// In production: serve static frontend files
const staticRoot = process.env.STATIC_ROOT ?? "/var/www/surf-pacitan";
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: staticRoot }));
  app.get("*", serveStatic({ path: `${staticRoot}/index.html` }));
}

// Start the cron scheduler
startScheduler();

const port = Number(process.env.PORT) || DEFAULT_PORT;
console.log(`[server] surf (region: ${ACTIVE_REGION.id}) listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
