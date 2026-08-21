import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api/world': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
      },
    },
  },
});
