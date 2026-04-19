import { useState, useCallback, useRef, useEffect } from 'react'
import { syncFromZip, getLastSyncInfo } from '../services/db'
import './SyncPanel.css'

interface Props {
  onSyncComplete: () => void
}

export function SyncPanel({ onSyncComplete }: Props) {
  const [syncing, setSyncing]   = useState(false)
  const [progress, setProgress] = useState({ msg: '', pct: 0 })
  const [error, setError]       = useState('')
  const [lastSync, setLastSync] = useState<{ time: string | null; method: string | null }>({ time: null, method: null })
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getLastSyncInfo().then(info => {
      setLastSync({ time: info.time, method: info.method })
    })
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    setSelectedFile(file)
    setError('')
  }, [])

  const handleZipSync = useCallback(async () => {
    if (!selectedFile) { setError('请先选择 dist.zip 文件'); return }
    setError('')
    setSyncing(true)
    setProgress({ msg: '准备导入…', pct: 0 })
    try {
      const result = await syncFromZip(selectedFile, (msg, pct) => {
        setProgress({ msg, pct })
      })
      setLastSync({ time: new Date().toISOString(), method: 'zip' })
      setProgress({ msg: `✓ 导入完成：${result.words} 个单词，${result.audios} 个音频`, pct: 100 })
      setTimeout(() => {
        setSyncing(false)
        onSyncComplete()
      }, 1200)
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败，请检查文件是否正确')
      setSyncing(false)
    }
  }, [selectedFile, onSyncComplete])

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
  }

  return (
    <div className="sync-panel animate-fade-up">
      <div className="sync-header">
        <span className="sync-title">数据同步</span>
        {lastSync.time && (
          <span className="sync-last">上次同步 {formatTime(lastSync.time)}</span>
        )}
      </div>

      <p className="sync-desc">
        运行脚本生成 <code>dist.zip</code>，传到手机后在此选择导入
      </p>

      <div className="sync-file-row">
        <button
          className="sync-file-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={syncing}
        >
          {selectedFile ? `📄 ${selectedFile.name}` : '选择 dist.zip'}
        </button>
        <button
          className={`sync-btn ${syncing ? 'syncing' : ''}`}
          onClick={handleZipSync}
          disabled={syncing || !selectedFile}
        >
          {syncing
            ? <span className="animate-spin">↻</span>
            : '导入'}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {syncing && (
        <div className="sync-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress.pct}%` }} />
          </div>
          <span className="progress-msg">{progress.msg}</span>
        </div>
      )}

      {error && <p className="sync-error">{error}</p>}
    </div>
  )
}