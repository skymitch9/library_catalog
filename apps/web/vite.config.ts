import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // During local dev Vite serves the UI and forwards API calls to
    // `wrangler dev`. In production the Worker serves both from one origin.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
