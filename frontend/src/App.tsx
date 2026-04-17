/**
 * App.tsx — 主应用
 */

import { useState, useEffect, useCallback } from 'react'
import { WordCardDeck } from './components/WordCard'
import { SyncPanel } from './components/SyncPanel'
import { getAllWords } from './services/db'
import type { WordEntry } from './services/db'

type Tab = 'study' | 'review' | 'sync'

type AppState = {
  tab: Tab
  study: { index: number; date: string }
  review: { date: string | null; index: number }
  updatedAt: number
}

export default function App() {
  const [words, setWords] = useState<WordEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(navigator.onLine)

  const loadWords = useCallback(async () => {
    setLoading(true)
    setWords(await getAllWords())
    setLoading(false)
  }, [])

  useEffect(() => {
    loadWords()
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [loadWords])

  const todayStr = new Date().toDateString()
  const todayWords = words.filter(w => new Date(w.addedAt).toDateString() === todayStr)
  const histWords  = words.filter(w => new Date(w.addedAt).toDateString() !== todayStr)
  const reviewedToday = todayWords.filter(w => (w.reviewCount ?? 0) > 0).length

  const [appState, setAppState] = useState<AppState>(() => {
    try {
      const raw = localStorage.getItem('word_app_state')
      if (raw) return JSON.parse(raw)
    } catch {}
    return {
      tab: 'study',
      study: { index: 0, date: todayStr },
      review: { date: null, index: 0 },
      updatedAt: Date.now(),
    }
  })

  const updateState = (patch: Partial<AppState>) => {
    setAppState(prev => {
      const next = { ...prev, ...patch, updatedAt: Date.now() }
      localStorage.setItem('word_app_state', JSON.stringify(next))
      return next
    })
  }

  const tab = appState.tab

  const handleStudyIndexChange = useCallback((idx: number) => {
    updateState({ study: { index: idx, date: todayStr } })
  }, [todayStr])

  const reviewDate = appState.review.date

  const handleReviewDateSelect = useCallback((date: string) => {
    const saved = localStorage.getItem(`reviewIndex_${date}`)
    const idx = saved ? parseInt(saved, 10) : 0
    updateState({ review: { date, index: idx } })
  }, [])

  const handleReviewDateClear = useCallback(() => {
    updateState({ review: { date: null, index: 0 } })
  }, [])

  const handleReviewIndexChange = useCallback((idx: number) => {
    if (!appState.review.date) return
    localStorage.setItem(`reviewIndex_${appState.review.date}`, String(idx))
    updateState({ review: { date: appState.review.date, index: idx } })
  }, [appState.review.date])

  useEffect(() => {
    if (appState.study.date !== todayStr) {
      updateState({ study: { index: 0, date: todayStr } })
    }
  }, [todayStr])

  return (
    <div className="app">
      <div className="status-bar-fill" />

      {/* 顶栏 */}
      <header className="app-header">
        <span className="app-logo">词</span>
        <div className="header-center">
          {tab === 'study' && todayWords.length > 0 && (
            <div className="header-progress">
              <div className="header-track">
                <div
                  className="header-fill"
                  style={{ width: `${(reviewedToday / todayWords.length) * 100}%` }}
                />
              </div>
              <span className="header-frac">{reviewedToday}/{todayWords.length}</span>
            </div>
          )}
        </div>
        <div className="header-right">
          {!online && <span className="offline-badge">离线</span>}
          <span className="word-count">{words.length} 词</span>
        </div>
      </header>

      {/* 内容区 — 底部留出 tab bar 高度 */}
      <main className="app-main">
        {tab === 'study' && (
          loading ? <LoadingState /> :
            todayWords.length === 0 ? (
              <EmptyState icon="📚" title="今日暂无单词"
                desc={'先去「同步」导入数据\n昨天的单词在「复习」里'} />
            ) : (
              <WordCardDeck
                words={todayWords}
                initialIndex={appState.study.index}
                onIndexChange={handleStudyIndexChange}
              />
            )
        )}

        {tab === 'review' && (
          loading ? <LoadingState /> :
            histWords.length === 0 ? (
              <EmptyState icon="🗂" title="暂无历史记录"
                desc={'同步单词后\n第二天起会出现在这里'} />
            ) : reviewDate === null ? (
              <ReviewDateList words={histWords} onSelect={handleReviewDateSelect} />
            ) : (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <button className="back-btn" onClick={handleReviewDateClear}>← 返回列表</button>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <WordCardDeck
                    words={histWords.filter(w => {
                      const d = new Date(w.addedAt)
                      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                      return k === reviewDate
                    })}
                    initialIndex={appState.review.index}
                    onIndexChange={handleReviewIndexChange}
                  />
                </div>
              </div>
            )
        )}

        {tab === 'sync' && (
          <div className="view-container">
            <div className="sync-view-inner">
              <SyncPanel onSyncComplete={() => { loadWords(); updateState({ tab: 'study' }) }} />
              <div className="sync-tips animate-fade-up">
                <p className="tip-title">使用步骤</p>
                <ol className="tip-list">
                  <li>Mac 上运行 <code>python extract.py --mdx 词典.mdx --mdd 词典.mdd</code></li>
                  <li>脚本自动生成 <code>dist.zip</code>（含单词和音频）</li>
                  <li>通过 AirDrop / 文件 App 将 <code>dist.zip</code> 传到手机</li>
                  <li>点击上方「选择 dist.zip」导入，完成后离线可用</li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Tab Bar — position:fixed 确保 PWA 模式下也钉在底部 */}
      <nav className="tab-bar">
        <div className="tab-bar-inner">
          {([
            { key: 'study',  label: '今日',  icon: <StudyIcon /> },
            { key: 'review', label: '复习',  icon: <ReviewIcon /> },
            { key: 'sync',   label: '同步',  icon: <SyncIcon /> },
          ] as const).map(({ key, label, icon }) => (
            <button
              key={key}
              className={`tab-btn ${tab === key ? 'active' : ''}`}
              onClick={() => updateState({ tab: key })}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      <style>{appStyles}</style>
    </div>
  )
}

// ── 复习日期列表 ──────────────────────────────────────────

function ReviewDateList({ words, onSelect }: { words: WordEntry[]; onSelect: (date: string) => void }) {
  const grouped = words.reduce<Record<string, WordEntry[]>>((acc, w) => {
    const d = new Date(w.addedAt)
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    ;(acc[k] ??= []).push(w)
    return acc
  }, {})
  const keys = Object.keys(grouped).sort().reverse()

  return (
    <div className="view-container">
      <div className="date-list">
        {keys.map((date, i) => {
          const ws = grouped[date]
          const done = ws.filter(w => (w.reviewCount ?? 0) > 0).length
          return (
            <button
              key={date}
              className="date-row animate-fade-up"
              style={{ animationDelay: `${i * 40}ms` }}
              onClick={() => onSelect(date)}
            >
              <div className="date-row-left">
                <span className="date-row-date">{formatDateLabel(date)}</span>
                <span className="date-row-count">{ws.length} 词</span>
              </div>
              <div className="date-row-right">
                <div className="date-mini-track">
                  <div className="date-mini-fill" style={{ width: `${(done / ws.length) * 100}%` }} />
                </div>
                <span className="date-row-chevron">›</span>
              </div>
            </button>
          )
        })}
        <div style={{ height: 20 }} />
      </div>
    </div>
  )
}

// ── 工具组件 ──────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="center-state">
      <div className="loading-dots">
        {[0, 1, 2].map(i => (
          <div key={i} className="dot animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </div>
    </div>
  )
}

function EmptyState({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="center-state">
      <span className="empty-icon">{icon}</span>
      <p className="empty-title">{title}</p>
      <p className="empty-desc">{desc}</p>
    </div>
  )
}

function formatDateLabel(dateKey: string): string {
  const d = new Date(dateKey)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.floor((today.getTime() - d.getTime()) / 86400000)
  if (diff < 7) return `${diff} 天前`
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

// ── Tab 图标 ──────────────────────────────────────────────

function StudyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  )
}
function ReviewIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}
function SyncIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

// ── 样式 ─────────────────────────────────────────────────

/*
 * Tab bar 修复说明：
 *   在 iOS PWA（添加到主屏幕）模式下，100dvh 有时无法覆盖完整视口，
 *   导致 tab bar 被推到屏幕外。改用 position:fixed + bottom:0 是最可靠的方案。
 *   相应地，app-main 需要 padding-bottom 留出 tab bar 高度。
 */

const TAB_BAR_HEIGHT = 56 // px，不含 safe area

const appStyles = `
/* ── 整体布局 ── */
.app {
  display: flex;
  flex-direction: column;
  /* 使用 100svh（small viewport height）在 iOS Safari / PWA 下更可靠 */
  height: 100svh;
  height: 100dvh; /* 支持时优先用 dvh */
  width: 100%;
  background: var(--bg);
  max-width: 480px;
  margin: 0 auto;
  position: relative;
}

.status-bar-fill {
  height: var(--safe-top);
  background: var(--bg);
  flex-shrink: 0;
}

/* ── 顶栏 ── */
.app-header {
  display: flex;
  align-items: center;
  padding: 10px 18px 10px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  gap: 10px;
  background: var(--bg);
}

.app-logo {
  font-family: var(--font-display);
  font-size: 1.5rem;
  color: var(--accent);
  flex-shrink: 0;
  font-weight: 700;
}

.header-center { flex: 1; min-width: 0; }

.header-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}
.header-track {
  flex: 1;
  height: 3px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}
.header-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.5s ease;
}
.header-frac {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  flex-shrink: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.offline-badge {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  padding: 2px 8px;
  border-radius: 20px;
  border: 1px solid var(--border-hi);
  color: var(--text-muted);
}
.word-count {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
}

/* ── 内容区 ──
   留出底部 tab bar 的高度，避免内容被遮住。
   tab bar 用 position:fixed，所以这里用 padding-bottom 补偿。
*/
.app-main {
  flex: 1;
  overflow: hidden;
  position: relative;
  min-height: 0;
  padding-bottom: calc(${TAB_BAR_HEIGHT}px + var(--safe-bottom));
}

/* 返回按钮 */
.back-btn {
  display: flex;
  align-items: center;
  padding: 10px 18px;
  font-size: 15px;
  font-weight: 500;
  color: var(--accent);
  flex-shrink: 0;
  cursor: pointer;
  background: none;
  border: none;
  font-family: var(--font-body);
  transition: opacity 0.2s;
}
.back-btn:active { opacity: 0.6; }

/* view-container */
.view-container {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 16px 16px 0;
}

/* ── 日期列表 ── */
.date-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.date-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-card);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.18s, box-shadow 0.18s;
  width: 100%;
  box-shadow: 0 1px 4px rgba(13,71,161,0.04);
}
.date-row:active {
  border-color: var(--accent);
  box-shadow: 0 2px 8px rgba(13,71,161,0.10);
}
.date-row-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.date-row-date {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
}
.date-row-count {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
}
.date-row-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.date-mini-track {
  width: 64px;
  height: 3px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}
.date-mini-fill {
  height: 100%;
  background: var(--green);
  border-radius: 3px;
}
.date-row-chevron {
  color: var(--text-muted);
  font-size: 20px;
  line-height: 1;
}

/* ── 同步视图 ── */
.sync-view-inner {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-bottom: 24px;
}
.sync-tips {
  padding: 18px 18px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-raised);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tip-title {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.15em;
  color: var(--text-muted);
  text-transform: uppercase;
  font-weight: 500;
}
.tip-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-left: 1.3em;
  margin: 0;
}
.tip-list li {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary);
  font-weight: 400;
}
.tip-list code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-card);
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--accent);
  border: 1px solid var(--border);
  font-weight: 400;
}

/* ── 加载 / 空状态 ── */
.center-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 40px;
}
.loading-dots { display: flex; gap: 7px; }
.dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
}
.empty-icon { font-size: 2.8rem; line-height: 1; }
.empty-title {
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-secondary);
}
.empty-desc {
  font-size: 14px;
  color: var(--text-muted);
  text-align: center;
  line-height: 1.7;
  white-space: pre-line;
}

/* ── Tab Bar ──
   position: fixed + bottom: 0 是在 iOS PWA 模式下最可靠的方式。
   浏览器模式下同样正常。
*/
.tab-bar {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 480px;
  background: rgba(255,255,255,0.96);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid var(--border);
  padding-bottom: var(--safe-bottom);
  z-index: 100;
}
.tab-bar-inner {
  display: flex;
  justify-content: space-around;
}
.tab-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 0 9px;
  color: var(--text-muted);
  transition: color 0.2s;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  cursor: pointer;
}
.tab-btn.active {
  color: var(--accent);
}
.tab-btn.active svg {
  stroke: var(--accent);
}
.tab-btn:active { opacity: 0.65; }
`