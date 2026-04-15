/**
 * WordCard.tsx
 * 全屏卡片组件：左右滑动切换单词，点击/上滑翻转查看释义
 *
 * 手势设计：
 *   - 左右滑动 → 切换上一张/下一张
 *   - 点击卡片 → 翻转查看释义（翻转后可上下滚动）
 *   - 已在背面时：左右滑动依然切换
 *
 * 音标：正面和背面均各显示两行（英音 BrE / 美音 AmE）
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import type { WordEntry } from '../services/db'
import { parsedDef, playAudio } from '../services/db'
import { LdoceCard } from './LdoceCard'

interface Props {
  words: WordEntry[]
  initialIndex?: number
  onReviewed?: (id: number) => void
  onIndexChange?: (index: number) => void
}

const SWIPE_THRESHOLD = 50   // px，水平滑动超过此值才切换

export function WordCardDeck({ words, initialIndex = 0, onReviewed, onIndexChange }: Props) {
  const [index, setIndex]       = useState(initialIndex)
  const [flipped, setFlipped]   = useState(false)
  const [direction, setDirection] = useState<'left' | 'right' | null>(null)
  const [animating, setAnimating] = useState(false)
  const [playingFile, setPlayingFile] = useState<string | null>(null)

  // touch state
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchDeltaX = useRef(0)
  const isDragging  = useRef(false)
  const cardRef     = useRef<HTMLDivElement>(null)

  const current = words[index]
  const parsed  = current ? parsedDef(current) : null

  // 切换索引时重置翻转状态
  const goTo = useCallback((newIndex: number, dir: 'left' | 'right') => {
    if (animating || newIndex < 0 || newIndex >= words.length) return
    setDirection(dir)
    setAnimating(true)
    setTimeout(() => {
      setIndex(newIndex)
      setFlipped(false)
      setDirection(null)
      setAnimating(false)
      onIndexChange?.(newIndex)
    }, 280)
  }, [animating, words.length, onIndexChange])

  const goPrev = useCallback(() => goTo(index - 1, 'right'), [index, goTo])
  const goNext = useCallback(() => {
    goTo(index + 1, 'left')
  }, [index, goTo])

  // 标记复习
  const markIfNeeded = useCallback(() => {
    if (current?.id != null && (current.reviewCount ?? 0) === 0) {
      onReviewed?.(current.id)
    }
  }, [current, onReviewed])

  const handleFlip = useCallback(() => {
    if (isDragging.current) return
    setFlipped(f => {
      if (!f) markIfNeeded()
      return !f
    })
  }, [markIfNeeded])

  // ── 触摸事件 ───────────────────────────────────────────
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchDeltaX.current = 0
    isDragging.current  = false
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current
    const dy = e.touches[0].clientY - touchStartY.current
    touchDeltaX.current = dx
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      isDragging.current = true
      if (cardRef.current) {
        cardRef.current.style.transform = `translateX(${dx * 0.25}px)`
        cardRef.current.style.opacity = `${1 - Math.abs(dx) / 600}`
      }
    }
  }, [])

  const onTouchEnd = useCallback(() => {
    const dx = touchDeltaX.current

    if (cardRef.current) {
      cardRef.current.style.transform = ''
      cardRef.current.style.opacity = ''
    }

    if (isDragging.current && Math.abs(dx) > SWIPE_THRESHOLD) {
      if (dx < 0) goNext()
      else goPrev()
    }
    setTimeout(() => { isDragging.current = false }, 50)
  }, [goNext, goPrev])

  // ── 键盘支持（桌面调试用）──────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  goPrev()
      if (e.key === 'ArrowRight') goNext()
      if (e.key === ' ')          handleFlip()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goPrev, goNext, handleFlip])

  const handlePlay = useCallback(async (e: React.MouseEvent, file: string) => {
    e.stopPropagation()
    if (!file || playingFile) return
    setPlayingFile(file)
    await playAudio(file)
    setPlayingFile(null)
  }, [playingFile])

  if (!current) {
    return (
      <div className="deck-empty">
        <span>暂无单词</span>
      </div>
    )
  }

  // 取第一个有 audio 的发音备用
  const wordAudio = parsed?.pron?.find(p => p.audio)?.audio ?? ''

  // 提取英音 / 美音（分别取 pron[0] 和 pron[1]，或从 bre/ame 字段判断）
  const breEntry = parsed?.pron?.[0] ?? null
  const ameEntry = parsed?.pron?.[1] ?? null

  return (
    <div className="deck-root">

      {/* 进度指示器 */}
      <div className="deck-progress">
        <div className="deck-dots">
          {words.map((_, i) => (
            <div
              key={i}
              className={`deck-dot ${i === index ? 'active' : ''} ${
                (words[i].reviewCount ?? 0) > 0 ? 'reviewed' : ''
              }`}
            />
          ))}
        </div>
        <span className="deck-counter">{index + 1} / {words.length}</span>
      </div>

      {/* 卡片区域 */}
      <div
        className={`deck-card-area ${animating ? `exit-${direction}` : ''}`}
        ref={cardRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className={`deck-card ${flipped ? 'flipped' : ''}`}
          onClick={handleFlip}
          role="button"
          aria-label={flipped ? '点击回到正面' : '点击查看释义'}
        >
          {/* ── 正面 ── */}
          <div className="dc-face dc-front">
            <div className="dc-front-inner">
              <span className="dc-tag">WORD</span>

              <h1 className="dc-word">{current.word}</h1>

              {/* 音标：英音和美音各一行 */}
              {parsed?.pron?.length ? (
                <div className="dc-pron-stack">
                  {breEntry && (
                    <div className="dc-pron-line">
                      <span className="dc-pron-label">英</span>
                      {(breEntry.bre ?? breEntry.ame) && (
                        <span className="dc-pron-ipa">/{breEntry.bre ?? breEntry.ame}/</span>
                      )}
                      {breEntry.audio && (
                        <button
                          className={`dc-audio-btn ${playingFile === breEntry.audio ? 'playing' : ''}`}
                          onClick={(e) => handlePlay(e, breEntry.audio)}
                          aria-label="播放英音"
                        >
                          {playingFile === breEntry.audio ? <WaveIcon /> : <SpeakerIcon />}
                        </button>
                      )}
                    </div>
                  )}
                  {ameEntry && (
                    <div className="dc-pron-line">
                      <span className="dc-pron-label">美</span>
                      {(ameEntry.ame ?? ameEntry.bre) && (
                        <span className="dc-pron-ipa">/{ameEntry.ame ?? ameEntry.bre}/</span>
                      )}
                      {ameEntry.audio && (
                        <button
                          className={`dc-audio-btn ${playingFile === ameEntry.audio ? 'playing' : ''}`}
                          onClick={(e) => handlePlay(e, ameEntry.audio)}
                          aria-label="播放美音"
                        >
                          {playingFile === ameEntry.audio ? <WaveIcon /> : <SpeakerIcon />}
                        </button>
                      )}
                    </div>
                  )}
                  {/* 只有一条发音记录时仍按行显示 */}
                  {!ameEntry && breEntry && !breEntry.audio && wordAudio && (
                    <div className="dc-pron-line">
                      <button
                        className={`dc-audio-btn ${playingFile === wordAudio ? 'playing' : ''}`}
                        onClick={(e) => handlePlay(e, wordAudio)}
                        aria-label="播放发音"
                      >
                        {playingFile === wordAudio ? <WaveIcon /> : <SpeakerIcon />}
                      </button>
                    </div>
                  )}
                </div>
              ) : wordAudio ? (
                <div className="dc-pron-stack">
                  <div className="dc-pron-line">
                    <button
                      className={`dc-audio-btn ${playingFile === wordAudio ? 'playing' : ''}`}
                      onClick={(e) => handlePlay(e, wordAudio)}
                      aria-label="播放发音"
                    >
                      {playingFile === wordAudio ? <WaveIcon /> : <SpeakerIcon />}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="dc-flip-hint">
                <FlipIcon />
                <span>点击翻转查看释义</span>
              </div>
            </div>

            {(current.reviewCount ?? 0) > 0 && (
              <div className="dc-reviewed-badge" title="已复习">✓</div>
            )}
          </div>

          {/* ── 背面 ── */}
          <div className="dc-face dc-back">
            <div className="dc-back-scroll" onClick={e => e.stopPropagation()}>
              <div className="dc-back-inner">
                {/* 背面顶部：单词 + 英音/美音各一行 */}
                <div className="dc-back-head">
                  <div className="dc-back-word-col">
                    <span className="dc-back-word">{current.word}</span>
                    {parsed?.pron?.length ? (
                      <div className="dc-back-pron-stack">
                        {breEntry && (
                          <div className="dc-pron-line sm">
                            <span className="dc-pron-label">英</span>
                            {(breEntry.bre ?? breEntry.ame) && (
                              <span className="dc-pron-ipa sm">/{breEntry.bre ?? breEntry.ame}/</span>
                            )}
                            {breEntry.audio && (
                              <button
                                className={`dc-audio-btn sm ${playingFile === breEntry.audio ? 'playing' : ''}`}
                                onClick={(e) => handlePlay(e, breEntry.audio)}
                                aria-label="播放英音"
                              >
                                {playingFile === breEntry.audio ? <WaveIcon /> : <SpeakerIcon />}
                              </button>
                            )}
                          </div>
                        )}
                        {ameEntry && (
                          <div className="dc-pron-line sm">
                            <span className="dc-pron-label">美</span>
                            {(ameEntry.ame ?? ameEntry.bre) && (
                              <span className="dc-pron-ipa sm">/{ameEntry.ame ?? ameEntry.bre}/</span>
                            )}
                            {ameEntry.audio && (
                              <button
                                className={`dc-audio-btn sm ${playingFile === ameEntry.audio ? 'playing' : ''}`}
                                onClick={(e) => handlePlay(e, ameEntry.audio)}
                                aria-label="播放美音"
                              >
                                {playingFile === ameEntry.audio ? <WaveIcon /> : <SpeakerIcon />}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : wordAudio ? (
                      <div className="dc-back-pron-stack">
                        <div className="dc-pron-line sm">
                          <button
                            className={`dc-audio-btn sm ${playingFile === wordAudio ? 'playing' : ''}`}
                            onClick={(e) => handlePlay(e, wordAudio)}
                            aria-label="播放发音"
                          >
                            {playingFile === wordAudio ? <WaveIcon /> : <SpeakerIcon />}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {parsed
                  ? <LdoceCard parsed={parsed} />
                  : <p className="dc-fallback">{current.definition}</p>
                }
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 左右切换按钮（桌面） */}
      <div className="deck-nav">
        <button
          className="deck-nav-btn"
          onClick={goPrev}
          disabled={index === 0}
          aria-label="上一个"
        >
          ←
        </button>
        <button
          className="deck-nav-btn"
          onClick={goNext}
          disabled={index === words.length - 1}
          aria-label="下一个"
        >
          →
        </button>
      </div>

      <style>{deckStyles}</style>
    </div>
  )
}

// ── 图标 ─────────────────────────────────────────────

function SpeakerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
    </svg>
  )
}

function WaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="4"  y1="8"  x2="4"  y2="16"/>
      <line x1="8"  y1="5"  x2="8"  y2="19"/>
      <line x1="12" y1="8"  x2="12" y2="16"/>
      <line x1="16" y1="5"  x2="16" y2="19"/>
      <line x1="20" y1="8"  x2="20" y2="16"/>
    </svg>
  )
}

function FlipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L8 6l4 4"/><path d="M8 6h8a4 4 0 0 1 0 8h-2"/>
      <path d="M12 22l4-4-4-4"/><path d="M16 18H8a4 4 0 0 1 0-8h2"/>
    </svg>
  )
}

// ── 样式 ─────────────────────────────────────────────

const deckStyles = `
/* 根容器 */
.deck-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px 16px 8px;
  gap: 12px;
  user-select: none;
}

/* 进度 */
.deck-progress {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.deck-dots {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  max-width: calc(100% - 60px);
}
.deck-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--border-hi);
  transition: background 0.2s;
  flex-shrink: 0;
}
.deck-dot.active   { background: var(--accent); }
.deck-dot.reviewed { background: var(--green); }
.deck-dot.active.reviewed { background: var(--accent); }
.deck-counter {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

/* 卡片区 */
.deck-card-area {
  flex: 1;
  min-height: 0;
  perspective: 1400px;
  transition: transform 0.28s cubic-bezier(0.4,0,0.2,1), opacity 0.28s ease;
}
.deck-card-area.exit-left  { transform: translateX(-40px); opacity: 0; pointer-events: none; }
.deck-card-area.exit-right { transform: translateX(40px);  opacity: 0; pointer-events: none; }

.deck-card {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  cursor: pointer;
}
.deck-card.flipped { transform: rotateY(180deg); }

/* 共用面 */
.dc-face {
  position: absolute;
  inset: 0;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  overflow: hidden;
}

/* 正面 */
.dc-front {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg, #ffffff 0%, #eaf2fb 100%);
  box-shadow: 0 4px 24px rgba(26, 111, 196, 0.08);
}
.dc-front::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 35% 40%, var(--accent-glow) 0%, transparent 60%);
  pointer-events: none;
}

.dc-front-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 48px 28px 40px;
  width: 100%;
}

.dc-tag {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.2em;
  color: var(--text-muted);
}

.dc-word {
  font-family: var(--font-display);
  font-size: clamp(2.4rem, 10vw, 4rem);
  font-weight: 400;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  text-align: center;
  line-height: 1.1;
}

/* 音标：竖排两行 */
.dc-pron-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.dc-pron-line {
  display: flex;
  align-items: center;
  gap: 7px;
}

.dc-pron-line.sm {
  gap: 5px;
}

.dc-pron-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--accent);
  background: var(--accent-dim);
  border-radius: 4px;
  padding: 1px 6px;
  font-weight: 400;
  min-width: 22px;
  text-align: center;
}

.dc-pron-ipa {
  font-family: var(--font-mono);
  font-size: 15px;
  color: var(--text-secondary);
}

.dc-pron-ipa.sm {
  font-size: 13px;
}

.dc-audio-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--border-hi);
  background: transparent;
  color: var(--text-secondary);
  transition: all 0.18s;
  cursor: pointer;
  flex-shrink: 0;
}
.dc-audio-btn:active,
.dc-audio-btn.playing {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}
.dc-audio-btn.sm {
  width: 26px;
  height: 26px;
}

.dc-flip-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
  margin-top: 4px;
}

.dc-reviewed-badge {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(46, 158, 107, 0.15);
  border: 1px solid var(--green);
  color: var(--green);
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.85;
}

/* 背面 */
.dc-back {
  transform: rotateY(180deg);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 24px rgba(26, 111, 196, 0.07);
}
.dc-back-scroll {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.dc-back-inner {
  padding: 22px 20px 32px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dc-back-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.dc-back-word-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}
.dc-back-word {
  font-family: var(--font-display);
  font-size: 1.6rem;
  color: var(--accent);
  font-weight: 400;
}
.dc-back-pron-stack {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.dc-fallback {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
}

/* 左右导航（桌面可见，手机隐藏） */
.deck-nav {
  display: none;
  gap: 12px;
  justify-content: center;
  flex-shrink: 0;
}
@media (hover: hover) {
  .deck-nav { display: flex; }
}
.deck-nav-btn {
  padding: 8px 20px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hi);
  background: transparent;
  color: var(--text-secondary);
  font-size: 16px;
  transition: all 0.2s;
  cursor: pointer;
}
.deck-nav-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}
.deck-nav-btn:disabled {
  opacity: 0.2;
  cursor: default;
}

/* 空状态 */
.deck-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 15px;
}
`