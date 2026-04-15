/**
 * sw.js — Service Worker（使用 Workbox 运行时策略）
 *
 * 配套使用方式（Vite 项目）：
 *   npm install -D vite-plugin-pwa
 *
 * 然后在 vite.config.ts 中：
 *   import { VitePWA } from 'vite-plugin-pwa'
 *   plugins: [react(), VitePWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts' })]
 *
 *
 * 缓存策略：
 *   - App Shell（HTML/JS/CSS）：Cache First（离线优先）
 *   - Google Fonts：Cache First，30天
 *   - 本地 API（data.json / 音频）：Network First，网络失败时回退缓存
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope

import { clientsClaim } from 'workbox-core'
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import {
  CacheFirst,
  NetworkFirst,
  StaleWhileRevalidate,
} from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

// ── 立即激活，接管所有客户端 ──────────────────────────
self.skipWaiting()
clientsClaim()

// ── 预缓存 App Shell（由构建工具注入清单）─────────────
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)   // Workbox 注入的文件清单

// ── Google Fonts（字体文件，长期缓存）────────────────
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({
    cacheName: 'google-fonts-stylesheets',
  })
)

registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 30 }), // 30天
    ],
  })
)

// ── 本地服务器同步的 data.json（NetworkFirst，离线回退）
registerRoute(
  ({ url }) => url.pathname === '/data.json',
  new NetworkFirst({
    cacheName: 'sync-data',
    plugins: [
      new ExpirationPlugin({ maxEntries: 1 }),
    ],
  })
)

// ── 其余同域资源（JS/CSS/图片）：CacheFirst ──────────
registerRoute(
  ({ request }) =>
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image',
  new CacheFirst({
    cacheName: 'app-assets',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 }), // 7天
    ],
  })
)