import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        // Cluster creation can take several minutes on first image pull.
        timeout: 10 * 60 * 1000,
        proxyTimeout: 10 * 60 * 1000,
      },
    },
  },
})
