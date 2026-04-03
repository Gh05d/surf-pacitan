import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { api } from "./routes";
import { startScheduler } from "./cron";
import { DEFAULT_PORT } from "./config";

const app = new Hono();

// CORS middleware
app.use("/*", cors());

// Mount API routes
app.route("/api", api);

// In production: serve static frontend files
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "/var/www/surf-pacitan" }));
  app.get("*", serveStatic({ path: "/var/www/surf-pacitan/index.html" }));
}

// Start the cron scheduler
startScheduler();

const port = Number(process.env.PORT) || DEFAULT_PORT;
console.log(`[server] surf-pacitan listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
