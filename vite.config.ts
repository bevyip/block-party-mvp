import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "pipeline-route",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          // Vite HMR uses `GET /?token=...` + Upgrade: websocket; do not rewrite to index.html.
          if (req.headers.upgrade?.toLowerCase() === "websocket") {
            next();
            return;
          }
          const url = req.url?.split("?")[0] ?? "";
          if (url === "/" || url === "") {
            req.url = "/index.html";
          } else if (url === "/pipeline" || url === "/pipeline/") {
            req.url = "/pipeline.html";
          } else if (
            url === "/map" ||
            url === "/map/" ||
            url === "/map.html"
          ) {
            req.url = "/index.html";
          } else if (url === "/admin" || url === "/admin/") {
            req.url = "/index.html";
          }
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
      },
    },
  },
});
