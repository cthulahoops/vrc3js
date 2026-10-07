import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Serve where APP_ORIGIN says the app lives, so the OAuth callback lands
  // here (BFF_ALLOWED_ORIGINS must list it too). strictPort fails loudly if
  // another checkout's dev server already holds the port, instead of
  // drifting off the callback.
  const { APP_ORIGIN } = loadEnv(mode, process.cwd(), "");
  const origin = new URL(APP_ORIGIN || "http://localhost:5173");

  return {
    server: {
      host: origin.hostname,
      port: Number(origin.port) || 5173,
      strictPort: true,
      allowedHosts: [origin.hostname],
      proxy: {
        "/api": {
          target: "http://localhost:8787",
          ws: true,
        },
        "/auth": "http://localhost:8787",
      },
    },
  };
});
