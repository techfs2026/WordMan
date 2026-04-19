import { useState, useEffect, useCallback } from 'react'
import { WordCardDeck } from './components/WordCard'
import { SyncPanel } from './components/SyncPanel'
import { getAllWords, markReviewed } from './services/db'
import type { WordEntry } from './services/db'
import './App.css'

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
  const histWords = words.filter(w => new Date(w.addedAt).toDateString() !== todayStr)
  const reviewedToday = todayWords.filter(w => (w.reviewCount ?? 0) > 0).length

  const [appState, setAppState] = useState<AppState>(() => {
    try {
      const raw = localStorage.getItem('word_app_state')
      if (raw) return JSON.parse(raw)
    } catch { }
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
                onReviewed={async (id) => {
                  await markReviewed(id)
                  setWords(prev => prev.map(w =>
                    w.id === id ? { ...w, reviewCount: (w.reviewCount ?? 0) + 1, lastReviewAt: Date.now() } : w
                  ))
                }}
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
                    onReviewed={async (id) => {
                      await markReviewed(id)
                      setWords(prev => prev.map(w =>
                        w.id === id ? { ...w, reviewCount: (w.reviewCount ?? 0) + 1, lastReviewAt: Date.now() } : w
                      ))
                    }}
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
                  <li>运行 <code>python extract.py --mdx 词典.mdx --mdd 词典.mdd</code></li>
                  <li>脚本自动生成 <code>dist.zip</code>（含单词和音频）</li>
                  <li>通过 AirDrop / 文件 App 将 <code>dist.zip</code> 传到手机</li>
                  <li>点击上方「选择 dist.zip」导入，完成后离线可用</li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </main>

      <nav className="tab-bar">
        <div className="tab-bar-inner">
          {([
            { key: 'study', label: '今日', icon: <StudyIcon /> },
            { key: 'review', label: '复习', icon: <ReviewIcon /> },
            { key: 'sync', label: '同步', icon: <SyncIcon /> },
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
    </div>
  )
}

function ReviewDateList({ words, onSelect }: { words: WordEntry[]; onSelect: (date: string) => void }) {
  const grouped = words.reduce<Record<string, WordEntry[]>>((acc, w) => {
    const d = new Date(w.addedAt)
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      ; (acc[k] ??= []).push(w)
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