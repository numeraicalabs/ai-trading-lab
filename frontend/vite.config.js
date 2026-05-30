import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In dev mode: proxy /api and /ws to FastAPI on :8000
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws':  { target: 'ws://localhost:8000',   ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Suppress the chunk size warning (recharts is large)
    chunkSizeWarningLimit: 800,
  },
})
