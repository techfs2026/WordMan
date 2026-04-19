import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { registerSW } from 'virtual:pwa-register'

// ── Toast 工具 ────────────────────────────────────────────
function showToast(msg: string, durationMs = 3500) {
  let container = document.getElementById('__pwa-toast-container__')
  if (!container) {
    container = document.createElement('div')
    container.id = '__pwa-toast-container__'
    Object.assign(container.style, {
      position: 'fixed',
      bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '9999',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '8px',
      pointerEvents: 'none',
    })
    document.body.appendChild(container)
  }

  const toast = document.createElement('div')
  toast.innerText = msg
  Object.assign(toast.style, {
    background: 'rgba(10,22,40,0.88)',
    color: '#fff',
    fontSize: '13px',
    lineHeight: '1.5',
    padding: '9px 16px',
    borderRadius: '20px',
    maxWidth: '280px',
    textAlign: 'center',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
    opacity: '0',
    transition: 'opacity 0.25s ease',
    fontFamily: 'var(--font-body, sans-serif)',
  })
  container.appendChild(toast)

  requestAnimationFrame(() => {
    requestAnimationFrame(() => { toast.style.opacity = '1' })
  })

  setTimeout(() => {
    toast.style.opacity = '0'
    toast.addEventListener('transitionend', () => toast.remove(), { once: true })
  }, durationMs)
}

// ── PWA 注册 ──────────────────────────────────────────────
registerSW({
  onNeedRefresh() {
    showToast('发现新版本，重启后生效')
  },
  onOfflineReady() {
    showToast('已支持离线使用 ✓')
  },
})

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(() => {
    showToast('离线可用，可添加到主屏幕')
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)