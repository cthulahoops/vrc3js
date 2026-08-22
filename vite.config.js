import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "localhost",
    proxy: {
      "/api/world": {
        target: "ws://localhost:8787",
        ws: true,
      },
    },
  },
});
