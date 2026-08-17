import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // Phase 3.3 PWA：离线可用 + 可安装到桌面（需 HTTPS 上下文才生效，服务器上已有 nginx）
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['privacy.html', 'terms.html'],
      manifest: {
        name: 'Cogno Reader',
        short_name: 'Cogno',
        description: '认知增强阅读伴侣——推动深度思考而非替代思考',
        theme_color: '#6c5ce7',
        background_color: '#0b1018',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/pwa-512.svg', sizes: '512x512', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // 静态资源全缓存 + AI 接口走网络优先（离线时兜底）
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\/v1\/messages/,
            handler: 'NetworkOnly',
            options: { networkTimeoutSeconds: 8 },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
})