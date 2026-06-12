import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "node:fs";
import { getRegion } from "./regions";

// Build-time region selection: REGION env at build time (default pacitan).
// The client bundle gets the id injected via define (__REGION__) so
// src/shared/active-region.ts resolves the same pack at runtime.
const region = getRegion(process.env.REGION ?? "pacitan");

function regionHtmlAndManifest(): Plugin {
  const manifestSource = () => {
    const base = JSON.parse(
      readFileSync(path.resolve(__dirname, "src/client/manifest.template.json"), "utf-8"),
    );
    base.name = region.branding.appTitle;
    base.short_name = region.branding.appTitle;
    base.description = region.branding.description;
    return JSON.stringify(base, null, 2);
  };

  return {
    name: "region-html-manifest",
    transformIndexHtml(html) {
      return html
        .replaceAll("%REGION_TITLE%", region.branding.appTitle)
        .replaceAll("%REGION_DESCRIPTION%", region.branding.description);
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.json", source: manifestSource() });
    },
    configureServer(server) {
      // Dev server: manifest.json no longer lives in public/.
      server.middlewares.use("/manifest.json", (_req, res) => {
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(manifestSource());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), regionHtmlAndManifest()],
  root: ".",
  publicDir: "public",
  define: {
    __REGION__: JSON.stringify(process.env.REGION ?? "pacitan"),
  },
  build: {
    // Per-deployment override: BUILD_OUT_DIR=/var/www/surf-<region> bun run build
    outDir: process.env.BUILD_OUT_DIR ?? "/var/www/surf-pacitan",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@client": path.resolve(__dirname, "src/client"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3100",
    },
  },
});
