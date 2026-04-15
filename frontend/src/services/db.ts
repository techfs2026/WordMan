/**
 * db.ts — IndexedDB 封装（Dexie）
 */

import Dexie, { type Table } from 'dexie'

// ── 新 schema 类型（与 extract.py 对齐）────────────────

export interface PronEntry {
  bre?: string
  ame?: string
  audio: string
}

export interface ExampleEntry {
  en_txt: string
  cn_txt: string
  audio: string
}

export interface SenseEntry {
  activ: string
  en: string
  cn: string
  examples: ExampleEntry[]
}

export interface WordFamilyGroup {
  pos: string
  words: string[]
}

export interface LdoceParsed {
  word: string
  pos: string
  gram: string
  register: string
  pron: PronEntry[]
  senses: SenseEntry[]
  corpus_examples: ExampleEntry[]
  word_family: WordFamilyGroup[]
  etym: string
  _raw_html?: string
}

export interface WordEntry {
  id?: number
  word: string
  definition: string    // JSON.stringify(LdoceParsed)
  addedAt: number
  reviewCount: number
  lastReviewAt?: number
}

export interface AudioBlob {
  file: string
  blob: Blob
}

export interface MetaEntry {
  key: string
  value: string
}

// ── Dexie ─────────────────────────────────────────────

class VocabDB extends Dexie {
  words!: Table<WordEntry, number>
  audioBlobs!: Table<AudioBlob, string>
  meta!: Table<MetaEntry, string>

  constructor() {
    super('VocabDB')
    this.version(1).stores({
      words: '++id, word, addedAt, lastReviewAt',
      audioBlobs: 'file',
      meta: 'key',
    })
  }
}

export const db = new VocabDB()

// ── 解析 definition JSON ───────────────────────────────

export function parsedDef(entry: WordEntry): LdoceParsed | null {
  try {
    return JSON.parse(entry.definition) as LdoceParsed
  } catch {
    return null
  }
}

// ── 同步 ──────────────────────────────────────────────

export interface SyncResult {
  words: number
  audios: number
  notFound: string[]
}

function collectAudioPaths(w: LdoceParsed): string[] {
  const paths: string[] = []
  for (const p of w.pron ?? []) if (p.audio) paths.push(p.audio)
  for (const s of w.senses ?? [])
    for (const ex of s.examples ?? []) if (ex.audio) paths.push(ex.audio)
  for (const ex of w.corpus_examples ?? []) if (ex.audio) paths.push(ex.audio)
  return [...new Set(paths)]
}

export async function syncFromServer(
  baseUrl: string,
  onProgress?: (msg: string, pct: number) => void,
): Promise<SyncResult> {
  const report = (msg: string, pct: number) => onProgress?.(msg, pct)

  report('正在下载单词数据…', 5)
  const res = await fetch(`${baseUrl}/data.json`, {
    headers: {
      'ngrok-skip-browser-warning': 'true'
    }
  })
  if (!res.ok) throw new Error(`无法连接服务器: ${res.status}`)
  const data = await res.json()

  const total: number = data.words.length
  let audioCount = 0
  const entries: WordEntry[] = []

  for (let i = 0; i < total; i++) {
    const w: LdoceParsed = data.words[i]
    report(`下载音频: ${w.word} (${i + 1}/${total})`, 10 + Math.floor((i / total) * 80))

    for (const filePath of collectAudioPaths(w)) {
      try {
        const existing = await db.audioBlobs.get(filePath)
        if (!existing) {
          const filename = filePath.replace(/^audio\//, '')
          const r = await fetch(`${baseUrl}/audio-b64/${filename}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
          })
          if (r.ok) {
            const { data } = await r.json()          // data 是 base64 data URL
            const blob = await (await fetch(data)).blob()
            await db.audioBlobs.put({ file: filePath, blob })
          }
        }
        audioCount++
      } catch {
        console.warn(`音频下载失败: ${filePath}`)
      }
    }

    entries.push({
      word: w.word,
      definition: JSON.stringify(w),
      addedAt: Date.now(),
      reviewCount: 0,
    })
  }

  report('写入本地数据库…', 92)
  for (const entry of entries) {
    const existing = await db.words.where('word').equals(entry.word).first()
    if (existing) {
      await db.words.update(existing.id!, { definition: entry.definition })
    } else {
      await db.words.add(entry)
    }
  }

  await db.meta.put({ key: 'lastSync', value: new Date().toISOString() })
  await db.meta.put({ key: 'serverUrl', value: baseUrl })

  report('同步完成！', 100)
  return { words: entries.length, audios: audioCount, notFound: data.not_found ?? [] }
}

// ── 音频播放 ──────────────────────────────────────────

export async function playAudio(file: string): Promise<void> {
  if (!file) return
  const entry = await db.audioBlobs.get(file)
  if (!entry) { console.warn(`音频不在本地: ${file}`); return }
  const url = URL.createObjectURL(entry.blob)
  const audio = new Audio(url)
  return new Promise((resolve) => {
    audio.onended = () => { URL.revokeObjectURL(url); resolve() }
    audio.onerror = () => { URL.revokeObjectURL(url); resolve() }
    audio.play().catch(() => { URL.revokeObjectURL(url); resolve() })
  })
}

// ── 查询 ──────────────────────────────────────────────

export async function getAllWords(): Promise<WordEntry[]> {
  return db.words.orderBy('addedAt').reverse().toArray()
}

export async function markReviewed(id: number): Promise<void> {
  const w = await db.words.get(id)
  await db.words.update(id, {
    reviewCount: (w?.reviewCount ?? 0) + 1,
    lastReviewAt: Date.now(),
  })
}

export async function getLastSyncInfo(): Promise<{ time: string | null; url: string | null }> {
  const time = await db.meta.get('lastSync')
  const url  = await db.meta.get('serverUrl')
  return { time: time?.value ?? null, url: url?.value ?? null }
}