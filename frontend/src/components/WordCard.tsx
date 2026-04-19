import { useState, useRef, useCallback, useEffect } from 'react'
import type { WordEntry } from '../services/db'
import { parsedDef, playAudio } from '../services/db'
import { LdoceCard } from './LdoceCard'
import './WordCard.css'

interface Props {
  words: WordEntry[]
  initialIndex?: number
  onReviewed?: (id: number) => void
  onIndexChange?: (index: number) => void
}

const SWIPE_THRESHOLD = 50

export function WordCardDeck({ words, initialIndex = 0, onReviewed, onIndexChange }: Props) {
  const [index, setIndex] = useState(initialIndex)
  const [flipped, setFlipped] = useState(false)
  const [direction, setDirection] = useState<'left' | 'right' | null>(null)
  const [animating, setAnimating] = useState(false)
  const [playingFile, setPlayingFile] = useState<string | null>(null)

  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchDeltaX = useRef(0)
  const isDragging = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const backScrollRef = useRef<HTMLDivElement>(null)

  const current = words[index]
  const parsed = current ? parsedDef(current) : null

  const firstEntryPron = parsed?.entries?.[0]?.pron ?? null
  const breEntry = firstEntryPron?.[0] ?? null
  const ameEntry = firstEntryPron?.[1] ?? null
  const wordAudio = breEntry?.audio || ameEntry?.audio || ''

  const goTo = useCallback((newIndex: number, dir: 'left' | 'right') => {
    if (animating || newIndex < 0 || newIndex >= words.length) return
    setDirection(dir)
    setAnimating(true)
    setTimeout(() => {
      setIndex(newIndex)
      setFlipped(false)
      setDirection(null)
      setAnimating(false)
      backScrollRef.current?.scrollTo({ top: 0 })
      onIndexChange?.(newIndex)
    }, 280)
  }, [animating, words.length, onIndexChange])

  const goPrev = useCallback(() => goTo(index - 1, 'right'), [index, goTo])
  const goNext = useCallback(() => goTo(index + 1, 'left'), [index, goTo])

  const markIfNeeded = useCallback(() => {
    if (current?.id != null && (current.reviewCount ?? 0) === 0) {
      onReviewed?.(current.id)
    }
  }, [current, onReviewed])

  // 正面点击 → 翻到背面
  const handleFlipToBack = useCallback(() => {
    if (isDragging.current) return
    markIfNeeded()
    setFlipped(true)
    setTimeout(() => { backScrollRef.current?.scrollTo({ top: 0 }) }, 0)
  }, [markIfNeeded])

  // 背面空白处点击 → 翻回正面
  const handleFlipToFront = useCallback(() => {
    // 如果点击来自内容滚动区内部（由 stopPropagation 拦截），这里不会触发
    if (isDragging.current) return
    setFlipped(false)
  }, [])

  // ── 触摸事件 ───────────────────────────────────────────
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchDeltaX.current = 0
    isDragging.current = false
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
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
      if (e.key === ' ') setFlipped(f => !f)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goPrev, goNext])

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

  return (
    <div className="deck-root">

      {/* 进度指示器 */}
      <div className="deck-progress">
        <div className="deck-dots">
          {words.map((_, i) => (
            <div
              key={i}
              className={`deck-dot ${i === index ? 'active' : ''} ${(words[i].reviewCount ?? 0) > 0 ? 'reviewed' : ''}`}
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
        >
          {/* ── 正面：整体可点击翻转 ── */}
          <div
            className="dc-face dc-front"
          >
            <div
              className="dc-front-clickable"
              onClick={handleFlipToBack}
              role="button"
              aria-label="点击查看释义"
            >
              <div className="dc-front-inner">
                <span className="dc-tag">WORD</span>

                <h1 className="dc-word">{current.word}</h1>

                {firstEntryPron?.length ? (
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
            </div>

            {(current.reviewCount ?? 0) > 0 && (
              <div className="dc-reviewed-badge" title="已复习">✓</div>
            )}
          </div>

          {/* ── 背面 ── */}
          <div className="dc-face dc-back">
            {/* 顶部 header：在 scroll 区外，点击空白区域或翻转按钮均可翻回 */}
            <div
              className="dc-back-head"
              onClick={handleFlipToFront}
            >
              <div className="dc-back-word-col" onClick={e => e.stopPropagation()}>
                <span className="dc-back-word">{current.word}</span>
                {firstEntryPron?.length ? (
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

              {/* 翻回按钮：直接响应点击，无需额外处理（冒泡到 head 的 onClick） */}
              <button
                className="dc-back-flip-hint"
                aria-label="翻回正面"
              >
                <FlipIcon />
              </button>
            </div>

            {/* 内容滚动区：阻止冒泡，避免滚动时误触翻转 */}
            <div
              className="dc-back-scroll"
              ref={backScrollRef}
              onClick={e => e.stopPropagation()}
            >
              <div className="dc-back-inner">
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
    </div>
  )
}

// ── 图标 ─────────────────────────────────────────────

function SpeakerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

function WaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="4" y1="8" x2="4" y2="16" />
      <line x1="8" y1="5" x2="8" y2="19" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="16" y1="5" x2="16" y2="19" />
      <line x1="20" y1="8" x2="20" y2="16" />
    </svg>
  )
}

function FlipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L8 6l4 4" /><path d="M8 6h8a4 4 0 0 1 0 8h-2" />
      <path d="M12 22l4-4-4-4" /><path d="M16 18H8a4 4 0 0 1 0-8h2" />
    </svg>
  )
}