import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The web app imports real functions (not only types) from the shared package. Its compiled output is CommonJS,
    // whose re-exports (`export * from`) the bundler cannot see through, so the build failed with "X is not exported".
    // Reading the TypeScript source instead gives plain ES modules.
    alias: { '@hik-mgr/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts') },
  },
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
