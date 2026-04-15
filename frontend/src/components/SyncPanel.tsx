/**
 * SyncPanel.tsx
 * 同步面板：输入服务器地址 → 拉取数据 → 显示进度
 */

import { useState, useCallback } from 'react'
import { syncFromServer, getLastSyncInfo } from '../services/db'
import { useEffect } from 'react'

interface Props {
  onSyncComplete: () => void
}

export function SyncPanel({ onSyncComplete }: Props) {
  const [url, setUrl]           = useState('')
  const [syncing, setSyncing]   = useState(false)
  const [progress, setProgress] = useState({ msg: '', pct: 0 })
  const [error, setError]       = useState('')
  const [lastSync, setLastSync] = useState<{ time: string | null; url: string | null }>({ time: null, url: null })

  useEffect(() => {
    getLastSyncInfo().then(info => {
      setLastSync(info)
      if (info.url) setUrl(info.url)
    })
  }, [])

  const handleSync = useCallback(async () => {
    if (!url.trim()) { setError('请输入服务器地址'); return }
    const baseUrl = url.trim().replace(/\/$/, '')
    setError('')
    setSyncing(true)
    setProgress({ msg: '连接中…', pct: 0 })
    try {
      const result = await syncFromServer(baseUrl, (msg, pct) => {
        setProgress({ msg, pct })
      })
      setLastSync({ time: new Date().toISOString(), url: baseUrl })
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

  return (
    <div className="sync-panel animate-fade-up">
      <div className="sync-header">
        <span className="sync-title">数据同步</span>
        {lastSync.time && (
          <span className="sync-last">上次同步 {formatTime(lastSync.time)}</span>
        )}
      </div>

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
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing
            ? <span className="animate-spin">↻</span>
            : '同步'}
        </button>
      </div>

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

.sync-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-muted);
}

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

.sync-btn {
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #0a0a0a;
  font-size: 14px;
  font-weight: 400;
  font-family: var(--font-body);
  transition: opacity 0.2s;
  white-space: nowrap;
  min-width: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sync-btn:disabled {
  opacity: 0.5;
}

.sync-btn.syncing {
  background: var(--bg-raised);
  color: var(--accent);
  border: 1px solid var(--accent);
  font-size: 18px;
}

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