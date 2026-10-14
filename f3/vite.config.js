import { defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression2';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Post-processes dist/sw.js after build to inject the real build timestamp.
// Vite's `define` only transforms files compiled by Rollup (src/), not public/ files
// which are copied verbatim. This plugin handles the public/ service worker.
function injectSwVersion() {
  const version = `v-${Date.now()}`;
  return {
    name: 'inject-sw-version',
    closeBundle() {
      const swPath = resolve('dist/sw.js');
      if (!existsSync(swPath)) return;
      const content = readFileSync(swPath, 'utf8');
      writeFileSync(swPath, content.replace(/__SW_VERSION__/g, JSON.stringify(version)));
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    compression({ algorithm: 'brotliCompress', exclude: [/\.(png|jpg|gif|webp|ico|svg|woff2)$/] }),
    compression({ algorithm: 'gzip',            exclude: [/\.(png|jpg|gif|webp|ico|svg|woff2)$/] }),
    injectSwVersion(),
  ],

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Socket.IO ships infrequently — keep it in a long-cached vendor chunk
          vendor: ['socket.io-client'],
        },
      },
    },
  },

  server: {
    host: '0.0.0.0',
    port: 3202,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3201',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3201',
        ws: true,
        changeOrigin: true,
      },
    },
  },

  preview: {
    host: '0.0.0.0',
    port: 3202,
    strictPort: true,
  },
}));
