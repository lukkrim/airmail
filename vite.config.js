import { defineConfig } from 'vite';

// Relative asset paths so the built game works from any folder or host,
// e.g. https://<user>.github.io/airmail/ or a Netlify/Cloudflare Pages site.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1600 }
});
