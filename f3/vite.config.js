import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3202,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3201',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:3201',
        ws: true,
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 3202,
    strictPort: true
  }
});
