/**
 * db.ts — IndexedDB 封装（Dexie）
 */

import Dexie, { type Table } from 'dexie'

// ── 类型定义 ────────────────────────────────────────────

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

export interface LdoceEntry {
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

// ── 音频路径收集 ──────────────────────────────────────

function collectAudioPaths(w: LdoceParsed): string[] {
  const paths: string[] = []
  for (const entry of w.entries ?? []) {
    for (const p of entry.pron ?? []) if (p.audio) paths.push(p.audio)
    for (const s of entry.senses ?? [])
      for (const ex of s.examples ?? []) if (ex.audio) paths.push(ex.audio)
    for (const ex of entry.corpus_examples ?? []) if (ex.audio) paths.push(ex.audio)
  }
  for (const ex of w.corpus_examples ?? []) if (ex.audio) paths.push(ex.audio)
  return [...new Set(paths)]
}

// ── 写入单词到 DB（新增或更新）───────────────────────

async function upsertWords(entries: WordEntry[]): Promise<void> {
  for (const entry of entries) {
    const existing = await db.words.where('word').equals(entry.word).first()
    if (existing) {
      await db.words.update(existing.id!, { definition: entry.definition })
    } else {
      await db.words.add(entry)
    }
  }
}

// ── 从 ZIP 文件同步 ───────────────────────────────────

export interface SyncResult {
  words: number
  audios: number
  notFound: string[]
}

export async function syncFromZip(
  file: File,
  onProgress?: (msg: string, pct: number) => void,
): Promise<SyncResult> {
  const report = (msg: string, pct: number) => onProgress?.(msg, pct)

  // 动态加载 JSZip
  report('加载解压库…', 2)
  // @ts-ignore
  const JSZip = (await import('jszip')).default

  report('读取文件…', 5)
  const zip = await JSZip.loadAsync(file)

  // 读取 data.json
  report('解析词典数据…', 10)
  const dataFile = zip.file('data.json')
  if (!dataFile) throw new Error('ZIP 中未找到 data.json，请确认文件格式正确')
  const dataText = await dataFile.async('string')
  const data = JSON.parse(dataText)

  const total: number = data.words.length
  const entries: WordEntry[] = []
  let audioCount = 0

  for (let i = 0; i < total; i++) {
    const w: LdoceParsed = data.words[i]
    const pct = 12 + Math.floor((i / total) * 80)
    report(`导入音频: ${w.word} (${i + 1}/${total})`, pct)

    // 导入该单词相关的所有音频
    for (const filePath of collectAudioPaths(w)) {
      try {
        const existing = await db.audioBlobs.get(filePath)
        if (!existing) {
          const audioFile = zip.file(filePath)
          if (audioFile) {
            const blob = await audioFile.async('blob')
            await db.audioBlobs.put({ file: filePath, blob })
            audioCount++
          }
        } else {
          audioCount++
        }
      } catch {
        console.warn(`音频导入失败: ${filePath}`)
      }
    }

    entries.push({
      word: w.word,
      definition: JSON.stringify(w),
      addedAt: Date.now(),
      reviewCount: 0,
    })
  }

  report('写入本地数据库…', 93)
  await upsertWords(entries)

  await db.meta.put({ key: 'lastSync', value: new Date().toISOString() })
  await db.meta.put({ key: 'syncMethod', value: 'zip' })

  report('导入完成！', 100)
  return { words: entries.length, audios: audioCount, notFound: data.not_found ?? [] }
}

// ── 从网络同步（保留）────────────────────────────────

export async function syncFromServer(
  baseUrl: string,
  onProgress?: (msg: string, pct: number) => void,
): Promise<SyncResult> {
  const report = (msg: string, pct: number) => onProgress?.(msg, pct)

  report('正在下载单词数据…', 5)
  const res = await fetch(`${baseUrl}/data.json`, {
    headers: { 'ngrok-skip-browser-warning': 'true' }
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
            const { data } = await r.json()
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
  await upsertWords(entries)

  await db.meta.put({ key: 'lastSync', value: new Date().toISOString() })
  await db.meta.put({ key: 'serverUrl', value: baseUrl })
  await db.meta.put({ key: 'syncMethod', value: 'network' })

  report('同步完成！', 100)
  return { words: entries.length, audios: audioCount, notFound: data.not_found ?? [] }
}

// ── 音频播放 ──────────────────────────────────────────

export async function playAudio(file: string): Promise<void> {
  if (!file) return
  const entry = await db.audioBlobs.get(file)
  if (!entry) { console.warn(`音频不在本地: ${file}`); return }
  // 明确指定 audio/mpeg，避免手机浏览器因 blob 无 MIME type 而拒绝播放
  const blob = new Blob([entry.blob], { type: 'audio/mpeg' })
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  audio.load()
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

export async function getLastSyncInfo(): Promise<{ time: string | null; url: string | null; method: string | null }> {
  const time   = await db.meta.get('lastSync')
  const url    = await db.meta.get('serverUrl')
  const method = await db.meta.get('syncMethod')
  return { time: time?.value ?? null, url: url?.value ?? null, method: method?.value ?? null }
}