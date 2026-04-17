/**
 * LdoceCard.tsx
 * 渲染朗文5结构化数据：支持多词性（如 date 同时有名词/动词）
 * 每个词性独立展示：词性、音标、义项、例句（含音频按钮）、词族、词源
 *
 * 顺序规则：CORPUS EXAMPLES 永远在 WORD FAMILY 之前渲染
 */

import { useCallback, useState } from 'react'
import type { ExampleEntry } from '../services/db'
import { playAudio } from '../services/db'

// ── 类型定义 ──────────────────────────────────────────

interface PronEntry {
  bre?: string
  ame?: string
  audio: string
}

interface SenseEntry {
  activ?: string
  en?: string
  cn?: string
  examples?: ExampleEntry[]
}

interface WordFamilyGroup {
  pos: string
  words: string[]
}

interface LdoceEntry {
  word: string
  pos?: string
  gram?: string
  register?: string
  pron?: PronEntry[]
  senses?: SenseEntry[]
  corpus_examples?: ExampleEntry[]
  word_family?: WordFamilyGroup[]
  etym?: string
}

export interface LdoceParsed {
  word: string
  entries: LdoceEntry[]
  word_family?: WordFamilyGroup[]
  corpus_examples?: ExampleEntry[]
  /** 解析失败时存在 */
  _raw_html?: string
}

interface Props {
  parsed: LdoceParsed
}

// ── 主组件 ────────────────────────────────────────────

export function LdoceCard({ parsed }: Props) {
  const [playingFile, setPlayingFile] = useState<string | null>(null)

  const handlePlay = useCallback(async (e: React.MouseEvent, file: string) => {
    e.stopPropagation()
    if (!file || playingFile) return
    setPlayingFile(file)
    await playAudio(file)
    setPlayingFile(null)
  }, [playingFile])

  if (parsed._raw_html !== undefined) {
    return <div className="lc-raw">（解析失败，原始数据不可用）</div>
  }

  const entries = parsed.entries ?? []
  const hasTopFamily  = (parsed.word_family?.length ?? 0) > 0
  const hasTopCorpus  = (parsed.corpus_examples?.length ?? 0) > 0
  const multiPos = entries.length > 1

  return (
    <div className="lc-root">

      {entries.map((entry, ei) => (
        <div key={ei} className={`lc-entry ${multiPos ? 'lc-entry-multi' : ''}`}>

          {/* ── 词性 / 语法 / 语域 ── */}
          {(entry.pos || entry.gram || entry.register) && (
            <div className="lc-meta-row">
              {entry.pos      && <span className="lc-pos">{entry.pos}</span>}
              {entry.gram     && <span className="lc-gram">{entry.gram}</span>}
              {entry.register && <span className="lc-register">{entry.register}</span>}
            </div>
          )}

          {/* ── 义项 ── */}
          {(entry.senses?.length ?? 0) > 0 && (
            <div className="lc-senses">
              {entry.senses!.map((s, i) => (
                <div key={i} className="lc-sense">
                  <div className="lc-sense-head">
                    <span className="lc-sense-num">{i + 1}</span>
                    {s.activ && <span className="lc-activ">{s.activ}</span>}
                  </div>
                  {s.en && <p className="lc-def-en">{s.en}</p>}
                  {s.cn && <p className="lc-def-cn">{s.cn}</p>}
                  {(s.examples?.length ?? 0) > 0 && (
                    <ul className="lc-examples">
                      {s.examples!.slice(0, 2).map((ex, j) => (
                        <ExampleItem key={j} ex={ex} playingFile={playingFile} onPlay={handlePlay} />
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── 语料库例句（词条级）— 在词族之前 ── */}
          {(entry.corpus_examples?.length ?? 0) > 0 && (
            <div className="lc-corpus">
              <span className="lc-section-label">CORPUS EXAMPLES</span>
              <ul className="lc-examples">
                {entry.corpus_examples!.slice(0, 4).map((ex, i) => (
                  <ExampleItem key={i} ex={ex} playingFile={playingFile} onPlay={handlePlay} />
                ))}
              </ul>
            </div>
          )}

          {/* ── 词族（词条级）— 在语料库例句之后 ── */}
          {(entry.word_family?.length ?? 0) > 0 && (
            <div className="lc-family">
              <span className="lc-section-label">WORD FAMILY</span>
              <div className="lc-family-groups">
                {entry.word_family!.map((g, i) => (
                  <div key={i} className="lc-family-group">
                    <span className="lc-family-pos">{g.pos}</span>
                    <div className="lc-family-words">
                      {g.words.map((w, j) => (
                        <span key={j} className="lc-family-word">{w}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 词源 ── */}
          {entry.etym && <p className="lc-etym">{entry.etym}</p>}
        </div>
      ))}

      {/* ── 顶层共用：语料库例句先于词族 ── */}
      {hasTopCorpus && (
        <div className="lc-corpus lc-corpus-top">
          <span className="lc-section-label">CORPUS EXAMPLES</span>
          <ul className="lc-examples">
            {parsed.corpus_examples!.slice(0, 4).map((ex, i) => (
              <ExampleItem key={i} ex={ex} playingFile={playingFile} onPlay={handlePlay} />
            ))}
          </ul>
        </div>
      )}

      {hasTopFamily && (
        <div className="lc-family lc-family-top">
          <span className="lc-section-label">WORD FAMILY</span>
          <div className="lc-family-groups">
            {parsed.word_family!.map((g, i) => (
              <div key={i} className="lc-family-group">
                <span className="lc-family-pos">{g.pos}</span>
                <div className="lc-family-words">
                  {g.words.map((w, j) => (
                    <span key={j} className="lc-family-word">{w}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{styles}</style>
    </div>
  )
}

// ── 例句行（含音频按钮）─────────────────────────────────

function ExampleItem({
  ex, playingFile, onPlay
}: {
  ex: ExampleEntry
  playingFile: string | null
  onPlay: (e: React.MouseEvent, file: string) => void
}) {
  return (
    <li className="lc-example-item">
      <div className="lc-example-body">
        <p className="lc-ex-en">{ex.en_txt}</p>
        {ex.cn_txt && <p className="lc-ex-cn">{ex.cn_txt}</p>}
      </div>
      {ex.audio && (
        <button
          className={`lc-audio-btn ${playingFile === ex.audio ? 'playing' : ''}`}
          onClick={(e) => onPlay(e, ex.audio)}
          aria-label="播放例句"
        >
          {playingFile === ex.audio ? <WaveIcon /> : <SpeakerIcon />}
        </button>
      )}
    </li>
  )
}

// ── 图标 ──────────────────────────────────────────────

function SpeakerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
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

// ── 样式 ─────────────────────────────────────────────

const styles = `
.lc-root {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* 单个词性块 */
.lc-entry {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 多词性分隔 */
.lc-entry-multi + .lc-entry-multi {
  padding-top: 18px;
  margin-top: 4px;
  border-top: 2px solid color-mix(in srgb, var(--accent) 20%, transparent);
}

/* 顶层共用区块间距 */
.lc-corpus-top,
.lc-family-top {
  margin-top: 4px;
}

/* 词性行 */
.lc-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.lc-pos {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
  border: 1.5px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: 4px;
  padding: 2px 8px;
  font-weight: 500;
}
.lc-gram {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  border: 1px solid var(--border-hi);
  border-radius: 4px;
  padding: 2px 7px;
}
.lc-register {
  font-family: var(--font-mono);
  font-size: 11px;
  color: #7a6040;
  border: 1px solid rgba(120,90,50,0.35);
  border-radius: 4px;
  padding: 2px 7px;
  font-style: italic;
}

/* 音频按钮 */
.lc-audio-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--border-hi);
  background: transparent;
  color: var(--text-muted);
  flex-shrink: 0;
  transition: all 0.18s;
  cursor: pointer;
}
.lc-audio-btn:active,
.lc-audio-btn.playing {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}

/* 义项 */
.lc-senses {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.lc-sense {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 14px 0;
  border-top: 1px solid var(--border);
}
.lc-sense:first-child {
  border-top: none;
  padding-top: 0;
}
.lc-sense-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lc-sense-num {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  min-width: 16px;
}
.lc-activ {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: #3d7a56;
  border: 1px solid rgba(60,120,80,0.35);
  border-radius: 3px;
  padding: 1px 5px;
  text-transform: uppercase;
  font-weight: 500;
}

/* 释义文字 — 加粗加大，英文斜体 */
.lc-def-en {
  font-size: 16px;
  line-height: 1.7;
  color: var(--text-primary);
  font-weight: 500;
  font-style: italic;
  word-spacing: 0.03em;
}
.lc-def-cn {
  font-size: 15px;
  line-height: 1.65;
  color: var(--text-secondary);
  font-weight: 500;
}

/* 例句列表 */
.lc-examples {
  list-style: none;
  padding: 0;
  margin: 4px 0 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-left: 12px;
  border-left: 2.5px solid color-mix(in srgb, var(--accent) 25%, transparent);
}
.lc-example-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.lc-example-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.lc-ex-en {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-secondary);
  font-style: italic;
  word-spacing: 0.02em;
  font-weight: 400;
}
.lc-ex-cn {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-muted);
  font-weight: 400;
}

/* 语料库例句 */
.lc-corpus {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

/* 词族 */
.lc-family {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.lc-family-groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lc-family-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lc-family-pos {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 500;
}
.lc-family-words {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.lc-family-word {
  font-size: 14px;
  color: var(--text-secondary);
  padding: 3px 10px;
  border-radius: 5px;
  background: var(--bg-raised);
  border: 1px solid var(--border-hi);
  font-weight: 500;
}

/* section label */
.lc-section-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--text-muted);
  text-transform: uppercase;
  font-weight: 500;
}

/* 词源 */
.lc-etym {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
  line-height: 1.65;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.lc-raw {
  font-size: 13px;
  color: var(--text-muted);
  font-style: italic;
}
`