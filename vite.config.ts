import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "localhost",
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        ws: true,
      },
      "/auth": "http://localhost:8787",
    },
  },
});
