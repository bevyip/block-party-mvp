import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  sortCollectibleCardFilenames,
  toPublicCardPaths,
} from "./lib/cardGallerySort";

const VIRTUAL_CARDS = "virtual:cards-gallery";
const VIRTUAL_CARDS_RESOLVED = "\0virtual:cards-gallery";

function loadCardUrlsFromPublic(): string[] {
  const dir = path.join(process.cwd(), "public", "cards");
  try {
    const names = sortCollectibleCardFilenames(fs.readdirSync(dir));
    return toPublicCardPaths(names);
  } catch {
    return [];
  }
}

function rewriteSpaHtmlUrl(req: IncomingMessage) {
  if (req.headers.upgrade?.toLowerCase() === "websocket") return;
  const url = req.url?.split("?")[0] ?? "";
  if (url === "/" || url === "") {
    req.url = "/index.html";
  } else if (url === "/pipeline" || url === "/pipeline/") {
    req.url = "/pipeline.html";
  } else if (url === "/sprites" || url === "/sprites/") {
    req.url = "/sprites.html";
  } else if (
    url === "/map" ||
    url === "/map/" ||
    url === "/map.html"
  ) {
    req.url = "/index.html";
  } else if (url === "/admin" || url === "/admin/") {
    req.url = "/index.html";
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "cards-gallery-virtual",
      resolveId(id) {
        if (id === VIRTUAL_CARDS) return VIRTUAL_CARDS_RESOLVED;
      },
      load(id) {
        if (id !== VIRTUAL_CARDS_RESOLVED) return null;
        const urls = loadCardUrlsFromPublic();
        return `export const CARD_URLS = ${JSON.stringify(urls)};`;
      },
    },
    {
      name: "pipeline-route",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          rewriteSpaHtmlUrl(req);
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, _res, next) => {
          rewriteSpaHtmlUrl(req);
          next();
        });
      },
    },
  ],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        /** Stage 3B image generation can take minutes; avoid proxy cutting the request early. */
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        pipeline: path.resolve(__dirname, "pipeline.html"),
        sprites: path.resolve(__dirname, "sprites.html"),
      },
    },
  },
});
