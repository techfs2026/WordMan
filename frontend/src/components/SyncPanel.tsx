/**
 * SyncPanel.tsx
 * 同步面板：本地 ZIP 导入（主要）+ 局域网同步（备用）
 */

import { useState, useCallback, useRef } from 'react'
import { syncFromZip, syncFromServer, getLastSyncInfo } from '../services/db'
import { useEffect } from 'react'

interface Props {
  onSyncComplete: () => void
}

type SyncMode = 'zip' | 'network'

export function SyncPanel({ onSyncComplete }: Props) {
  const [mode, setMode]         = useState<SyncMode>('zip')
  const [url, setUrl]           = useState('')
  const [syncing, setSyncing]   = useState(false)
  const [progress, setProgress] = useState({ msg: '', pct: 0 })
  const [error, setError]       = useState('')
  const [lastSync, setLastSync] = useState<{ time: string | null; method: string | null }>({ time: null, method: null })
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getLastSyncInfo().then(info => {
      setLastSync({ time: info.time, method: info.method })
      if (info.url) setUrl(info.url)
      // 根据上次同步方式自动切换 tab
      if (info.method === 'network') setMode('network')
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

  const handleNetworkSync = useCallback(async () => {
    if (!url.trim()) { setError('请输入服务器地址'); return }
    const baseUrl = url.trim().replace(/\/$/, '')
    setError('')
    setSyncing(true)
    setProgress({ msg: '连接中…', pct: 0 })
    try {
      const result = await syncFromServer(baseUrl, (msg, pct) => {
        setProgress({ msg, pct })
      })
      setLastSync({ time: new Date().toISOString(), method: 'network' })
      setProgress({ msg: `✓ 同步完成：${result.words} 个单词，${result.audios} 个音频`, pct: 100 })
      setTimeout(() => {
        setSyncing(false)
        onSyncComplete()
      }, 1200)
    } catch (e) {
      setError(e instanceof Error ? e.message : '同步失败，请检查网络和服务器地址')
      setSyncing(false)
    }
  }, [url, onSyncComplete])

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
  }

  const methodLabel = lastSync.method === 'network' ? '局域网' : 'ZIP'

  return (
    <div className="sync-panel animate-fade-up">
      <div className="sync-header">
        <span className="sync-title">数据同步</span>
        {lastSync.time && (
          <span className="sync-last">上次{methodLabel}同步 {formatTime(lastSync.time)}</span>
        )}
      </div>

      {/* 模式切换 */}
      <div className="sync-mode-tabs">
        <button
          className={`sync-mode-tab ${mode === 'zip' ? 'active' : ''}`}
          onClick={() => { setMode('zip'); setError('') }}
          disabled={syncing}
        >
          📦 本地 ZIP
        </button>
        <button
          className={`sync-mode-tab ${mode === 'network' ? 'active' : ''}`}
          onClick={() => { setMode('network'); setError('') }}
          disabled={syncing}
        >
          🌐 局域网
        </button>
      </div>

      {/* ZIP 导入 */}
      {mode === 'zip' && (
        <>
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
        </>
      )}

      {/* 局域网同步 */}
      {mode === 'network' && (
        <>
          <p className="sync-desc">
            确保手机和电脑在同一 Wi-Fi 下，<br />
            输入 Python 脚本显示的局域网地址
          </p>
          <div className="sync-input-row">
            <input
              className="sync-input"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="http://192.168.1.x:8765"
              value={url}
              onChange={e => setUrl(e.target.value)}
              disabled={syncing}
            />
            <button
              className={`sync-btn ${syncing ? 'syncing' : ''}`}
              onClick={handleNetworkSync}
              disabled={syncing}
            >
              {syncing
                ? <span className="animate-spin">↻</span>
                : '同步'}
            </button>
          </div>
        </>
      )}

      {syncing && (
        <div className="sync-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress.pct}%` }} />
          </div>
          <span className="progress-msg">{progress.msg}</span>
        </div>
      )}

      {error && <p className="sync-error">{error}</p>}

      <style>{styles}</style>
    </div>
  )
}

const styles = `
.sync-panel {
  padding: 24px 20px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sync-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.sync-title {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.15em;
  color: var(--accent);
  text-transform: uppercase;
}

.sync-last {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

/* 模式切换 tabs */
.sync-mode-tabs {
  display: flex;
  gap: 6px;
  background: var(--bg-raised);
  border-radius: var(--radius-sm);
  padding: 4px;
}

.sync-mode-tab {
  flex: 1;
  padding: 7px 10px;
  border-radius: calc(var(--radius-sm) - 2px);
  font-size: 12px;
  font-family: var(--font-body);
  color: var(--text-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.18s;
  white-space: nowrap;
}

.sync-mode-tab.active {
  background: var(--bg-card);
  color: var(--accent);
  box-shadow: 0 1px 4px rgba(26, 111, 196, 0.1);
}

.sync-mode-tab:disabled {
  opacity: 0.5;
  cursor: default;
}

.sync-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-muted);
}

.sync-desc code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-raised);
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--accent);
  border: 1px solid var(--border);
}

/* ZIP 文件选择行 */
.sync-file-row {
  display: flex;
  gap: 8px;
}

.sync-file-btn {
  flex: 1;
  background: var(--bg-raised);
  border: 1px dashed var(--border-hi);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync-file-btn:active:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.sync-file-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 网络输入行 */
.sync-input-row {
  display: flex;
  gap: 8px;
}

.sync-input {
  flex: 1;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}

.sync-input:focus {
  border-color: var(--accent);
}

.sync-input::placeholder {
  color: var(--text-muted);
}

/* 同步/导入按钮 */
.sync-btn {
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #ffffff;
  font-size: 14px;
  font-weight: 400;
  font-family: var(--font-body);
  transition: opacity 0.2s;
  white-space: nowrap;
  min-width: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
}

.sync-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.sync-btn.syncing {
  background: var(--bg-raised);
  color: var(--accent);
  border: 1px solid var(--accent);
  font-size: 18px;
}

/* 进度 */
.sync-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-bar {
  height: 2px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-msg {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.sync-error {
  font-size: 12px;
  color: var(--red);
  line-height: 1.5;
}
`