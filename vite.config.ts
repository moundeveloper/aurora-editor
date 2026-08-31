import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // The media server owns uploads and blob streaming. Proxying keeps the app on one origin, so
    // there is no CORS to configure and a relative `/media/<hash>` works in a plain <video> tag.
    proxy: {
      '/api': { target: 'http://127.0.0.1:5174', changeOrigin: false },
      '/media': { target: 'http://127.0.0.1:5174', changeOrigin: false },
    },
  },
  test: {
    // Server tests are Node-side; the rest of the suite is environment-agnostic already.
    include: ['src/**/__tests__/**/*.test.ts', 'server/**/__tests__/**/*.test.ts'],
  },
})
