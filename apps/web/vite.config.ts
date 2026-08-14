import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // So breakpoints/stack traces in the built app (served from :4000 by
    // Express, not Vite's dev server) still map back to the original
    // .tsx sources instead of minified bundle code.
    sourcemap: true,
  },
});
