import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/kinetic-workout/',
  server: { port: 5183 },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'KINETIC 筋トレ記録',
        short_name: 'KINETIC',
        description: '近未来HUDの筋トレ記録アプリ',
        lang: 'ja',
        theme_color: '#05080f',
        background_color: '#05080f',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/kinetic-workout/',
        scope: '/kinetic-workout/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 種目の写真(jpg)は事前キャッシュに含めず、表示したものだけ端末に保存する（容量節約）
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,woff2}'],
        globIgnores: ['exercises/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/exercises/') && url.pathname.endsWith('.jpg'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'exercise-photos',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
