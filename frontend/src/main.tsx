import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { registerSW } from 'virtual:pwa-register'

const log = (msg: string) => {
  const div = document.createElement('div')
  div.innerText = msg
  div.style.position = 'fixed'
  div.style.top = '0'
  div.style.left = '0'
  div.style.right = '0'
  div.style.background = 'black'
  div.style.color = 'white'
  div.style.fontSize = '12px'
  div.style.zIndex = '9999'
  document.body.appendChild(div)
}

registerSW({
  onNeedRefresh() {
    console.log('[PWA] 有新版本，点击刷新')
  },
  onOfflineReady() {
    console.log('[PWA] 已支持离线')
  },
})

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(() => {
    log('已支持离线，请刷新页面后再添加到主屏幕')
  })

  if (!navigator.serviceWorker.controller) {
    log('[PWA] 当前页面未被 SW 控制，需要刷新')
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

