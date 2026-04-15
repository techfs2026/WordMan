import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  base: 'https://techfs2026.github.io/wm-site/',
  plugins: [
    react(),
    VitePWA({
      // 使用 injectManifest 让你完全控制 sw.ts 的逻辑
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },

      // PWA Manifest（添加到主屏幕）
      manifest: {
        name: '词卡 · 朗文词典',
        short_name: '词卡',
        description: '离线朗文词典单词卡',
        theme_color: '#1a6fc4',
        background_color: '#f0f4f8',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },

      // 开发环境也启用 SW（方便测试）
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
})