/**
 * App.tsx — 主应用
 * 今日学习 / 复习 / 同步，学习和复习模式均使用全屏 swipe 卡片
 */

import { useState, useEffect, useCallback } from 'react'
import { WordCardDeck } from './components/WordCard'
import { SyncPanel } from './components/SyncPanel'
import { getAllWords, markReviewed } from './services/db'
import type { WordEntry } from './services/db'

type Tab = 'study' | 'review' | 'sync'

export default function App() {
  const [tab, setTab]         = useState<Tab>('study')
  const [words, setWords]     = useState<WordEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [online, setOnline]   = useState(navigator.onLine)
  // 复习模式：选中的日期分组
  const [reviewDate, setReviewDate] = useState<string | null>(null)

  const loadWords = useCallback(async () => {
    setLoading(true)
    setWords(await getAllWords())
    setLoading(false)
  }, [])

  useEffect(() => {
    loadWords()
    const on  = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online',  on)
      window.removeEventListener('offline', off)
    }
  }, [loadWords])

  const handleReviewed = useCallback(async (id: number) => {
    await markReviewed(id)
    // 更新本地 state（不重新全量查询）
    setWords(prev => prev.map(w =>
      w.id === id ? { ...w, reviewCount: (w.reviewCount ?? 0) + 1, lastReviewAt: Date.now() } : w
    ))
  }, [])

  const todayStr   = new Date().toDateString()
  const todayWords = words.filter(w => new Date(w.addedAt).toDateString() === todayStr)
  const histWords  = words.filter(w => new Date(w.addedAt).toDateString() !== todayStr)

  // 今日进度
  const reviewedToday = todayWords.filter(w => (w.reviewCount ?? 0) > 0).length

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

      {/* 内容区 */}
      <main className="app-main">
        {tab === 'study' && (
          loading ? <LoadingState /> :
          todayWords.length === 0 ? (
            <EmptyState icon="📚" title="今日暂无单词"
              desc={'先去「同步」拉取数据\n昨天的单词在「复习」里'} />
          ) : (
            <WordCardDeck
              words={todayWords}
              onReviewed={handleReviewed}
            />
          )
        )}

        {tab === 'review' && (
          loading ? <LoadingState /> :
          histWords.length === 0 ? (
            <EmptyState icon="🗂" title="暂无历史记录"
              desc={'同步单词后\n第二天起会出现在这里'} />
          ) : reviewDate === null ? (
            <ReviewDateList
              words={histWords}
              onSelect={setReviewDate}
            />
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <button className="back-btn" onClick={() => setReviewDate(null)}>
                ← 返回列表
              </button>
              <div style={{ flex: 1, minHeight: 0 }}>
                <WordCardDeck
                  words={histWords.filter(w => {
                    const d = new Date(w.addedAt)
                    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
                    return k === reviewDate
                  })}
                  onReviewed={handleReviewed}
                />
              </div>
            </div>
          )
        )}

        {tab === 'sync' && (
          <div className="view-container">
            <div className="sync-view-inner">
              <SyncPanel onSyncComplete={() => { loadWords(); setTab('study') }} />
              <div className="sync-tips animate-fade-up">
                <p className="tip-title">使用步骤</p>
                <ol className="tip-list">
                  <li>Mac 上运行 <code>python extract.py --mdx 词典.mdx --mdd 词典.mdd</code></li>
                  <li>终端显示局域网地址，如 <code>http://192.168.1.5:8765</code></li>
                  <li>手机连同一 Wi-Fi，在此输入地址点击同步</li>
                  <li>同步完成后地铁断网也可正常使用</li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Tab Bar */}
      <nav className="tab-bar">
        <div className="tab-bar-inner">
          {([
            { key: 'study',  label: '今日',  icon: <StudyIcon  /> },
            { key: 'review', label: '复习',  icon: <ReviewIcon /> },
            { key: 'sync',   label: '同步',  icon: <SyncIcon   /> },
          ] as const).map(({ key, label, icon }) => (
            <button
              key={key}
              className={`tab-btn ${tab === key ? 'active' : ''}`}
              onClick={() => { setTab(key); if (key === 'review') setReviewDate(null) }}
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

function ReviewDateList({
  words,
  onSelect,
}: {
  words: WordEntry[]
  onSelect: (date: string) => void
}) {
  const grouped = words.reduce<Record<string, WordEntry[]>>((acc, w) => {
    const d = new Date(w.addedAt)
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
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
                  <div
                    className="date-mini-fill"
                    style={{ width: `${(done / ws.length) * 100}%` }}
                  />
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
        {[0,1,2].map(i => (
          <div key={i} className="dot animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </div>
    </div>
  )
}

function EmptyState({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="center-state animate-fade-up">
      <span className="empty-icon">{icon}</span>
      <p className="empty-title">{title}</p>
      <p className="empty-desc">{desc}</p>
    </div>
  )
}

function formatDateLabel(dateStr: string): string {
  const d         = new Date(dateStr)
  const today     = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  const diff = Math.floor((today.getTime() - d.getTime()) / 86400000)
  if (diff < 7) return `${diff} 天前`
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

// ── Tab 图标 ──────────────────────────────────────────────

function StudyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
  )
}
function ReviewIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  )
}
function SyncIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}

// ── 样式 ─────────────────────────────────────────────────

const appStyles = `
.app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  width: 100%;
  background: var(--bg);
  max-width: 480px;
  margin: 0 auto;
}

.status-bar-fill {
  height: var(--safe-top);
  min-height: env(safe-area-inset-top, 0px);
  background: var(--bg);
  flex-shrink: 0;
}

.app-header {
  display: flex;
  align-items: center;
  padding: 10px 16px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  gap: 10px;
}

.app-logo {
  font-family: var(--font-display);
  font-size: 1.4rem;
  color: var(--accent);
  flex-shrink: 0;
}

.header-center {
  flex: 1;
  min-width: 0;
}

.header-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-track {
  flex: 1;
  height: 2px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}

.header-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.5s ease;
}

.header-frac {
  font-family: var(--font-mono);
  font-size: 10px;
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
  font-size: 10px;
  letter-spacing: 0.08em;
  padding: 2px 7px;
  border-radius: 20px;
  border: 1px solid var(--border-hi);
  color: var(--text-muted);
}

.word-count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

.app-main {
  flex: 1;
  overflow: hidden;
  position: relative;
}

/* 返回按钮（复习模式） */
.back-btn {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text-secondary);
  flex-shrink: 0;
  cursor: pointer;
  background: none;
  border: none;
  font-family: var(--font-body);
  transition: color 0.2s;
}
.back-btn:active { color: var(--accent); }

/* view-container（同步页 / 日期列表用） */
.view-container {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 16px 16px 0;
}

/* 日期列表 */
.date-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.date-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-card);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.18s;
  width: 100%;
}
.date-row:active { border-color: var(--accent); }

.date-row-left {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.date-row-date {
  font-size: 15px;
  color: var(--text-primary);
}
.date-row-count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

.date-row-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.date-mini-track {
  width: 60px;
  height: 2px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}
.date-mini-fill {
  height: 100%;
  background: var(--green);
  border-radius: 2px;
}
.date-row-chevron {
  color: var(--text-muted);
  font-size: 18px;
  line-height: 1;
}

/* 同步视图 */
.sync-view-inner {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-bottom: 24px;
}

.sync-tips {
  padding: 16px 18px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-raised);
}
.tip-title {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.15em;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-bottom: 10px;
}
.tip-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-left: 1.2em;
}
.tip-list li {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.tip-list code {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--bg-card);
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--accent);
  border: 1px solid var(--border);
}

/* 加载 / 空状态 */
.center-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
}
.loading-dots { display: flex; gap: 6px; }
.dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
}
.empty-icon { font-size: 2.5rem; line-height: 1; }
.empty-title {
  font-family: var(--font-display);
  font-size: 1.2rem;
  color: var(--text-secondary);
}
.empty-desc {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  line-height: 1.7;
  white-space: pre-line;
}

/* Tab Bar */
.tab-bar {
  flex-shrink: 0;
  padding-bottom: var(--safe-bottom);
  background: var(--bg);
  border-top: 1px solid var(--border);
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
  padding: 10px 0 8px;
  color: var(--text-muted);
  transition: color 0.2s;
  font-size: 10px;
  letter-spacing: 0.05em;
  cursor: pointer;
}
.tab-btn.active { color: var(--accent); }
.tab-btn:active { opacity: 0.7; }
`