import { useCallback, useState } from 'react'
import type { ExampleEntry } from '../services/db'
import { playAudio } from '../services/db'
import './LdoceCard.css'

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
  const hasTopFamily = (parsed.word_family?.length ?? 0) > 0
  const hasTopCorpus = (parsed.corpus_examples?.length ?? 0) > 0
  const multiPos = entries.length > 1

  return (
    <div className="lc-root">

      {entries.map((entry, ei) => (
        <div key={ei} className={`lc-entry ${multiPos ? 'lc-entry-multi' : ''}`}>

          {/* ── 词性 / 语法 / 语域 ── */}
          {(entry.pos || entry.gram || entry.register) && (
            <div className="lc-meta-row">
              {entry.pos && <span className="lc-pos">{entry.pos}</span>}
              {entry.gram && <span className="lc-gram">{entry.gram}</span>}
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