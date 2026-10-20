'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * 跟踪信号管理弹窗（AI 线索页）
 *
 * 功能：
 * - 自然语言描述 → AI 自动生成结构化跟踪信号草稿 → 确认保存
 * - 信号列表：启停 / 删除 / 立即执行（手动跑一次）
 * - 频率：每天 / 每周（服务器 cron 每日 06:00 自动执行到期信号）
 */

interface TrackingSignal {
  id: string
  name: string
  description: string
  signalType: string
  keywords: string   // JSON 数组字符串
  watchTargets: string | null
  industry: string | null
  frequency: string  // DAILY / WEEKLY
  isActive: boolean
  lastRunAt: string | null
  lastRunCount: number
  createdAt: string
}

interface SignalDraft {
  name: string
  signalType: string
  keywords: string[]
  watchTargets: string[]
  industry: string
  frequency: string
  reason: string
}

const TYPE_LABELS: Record<string, string> = {
  PERSONNEL_CHANGE: '人事变动',
  NEW_STARTUP: '大咖创业',
  TECH_BREAKTHROUGH: '技术突破',
  FUNDING: '融资动态',
  CUSTOM: '自定义',
}

const FREQ_LABELS: Record<string, string> = { DAILY: '每天', WEEKLY: '每周' }

const EXAMPLES = [
  '我想跟踪大厂或明星项目核心成员离职的信号，比如字节跳动、腾讯、OpenAI 的高管或核心技术负责人离职',
  '跟踪明星学者或行业大咖的创业信号，特别是 AI、机器人方向的教授或研究员出来创业',
  '跟踪脑机接口领域的重大技术突破和新公司成立',
]

export default function TrackingSignalsModal({ onClose }: { onClose: () => void }) {
  const [signals, setSignals] = useState<TrackingSignal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 新建流程状态
  const [desc, setDesc] = useState('')
  const [generating, setGenerating] = useState(false)
  const [draft, setDraft] = useState<SignalDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [draftError, setDraftError] = useState('')

  // 列表项执行状态
  const [runningId, setRunningId] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<{ signalId: string; text: string } | null>(null)

  const fetchSignals = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/tracking-signals')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '获取信号失败')
      setSignals(data.signals || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取信号失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSignals()
  }, [fetchSignals])

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** AI 生成信号草稿 */
  const handleGenerate = async () => {
    if (desc.trim().length < 5) {
      setDraftError('请输入至少 5 个字的信号描述')
      return
    }
    setGenerating(true)
    setDraftError('')
    setDraft(null)
    try {
      const res = await fetch('/api/tracking-signals/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'AI 生成失败')
      setDraft(data.draft)
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'AI 生成失败')
    } finally {
      setGenerating(false)
    }
  }

  /** 确认保存草稿 */
  const handleSaveDraft = async () => {
    if (!draft) return
    setSaving(true)
    setDraftError('')
    try {
      const res = await fetch('/api/tracking-signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          description: desc.trim(),
          signalType: draft.signalType,
          keywords: draft.keywords,
          watchTargets: draft.watchTargets,
          industry: draft.industry,
          frequency: draft.frequency,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存失败')
      // 重置表单并刷新列表
      setDraft(null)
      setDesc('')
      fetchSignals()
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  /** 立即执行 */
  const handleRun = async (signal: TrackingSignal) => {
    if (!confirm(`立即执行「${signal.name}」跟踪？约需 10-30 秒（搜索 + AI 提取）。`)) return
    setRunningId(signal.id)
    setRunResult(null)
    try {
      const res = await fetch(`/api/tracking-signals/${signal.id}/run`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '执行失败')
      const r = data.result
      setRunResult({
        signalId: signal.id,
        text: `完成：搜索到 ${r.foundCount} 条资讯，新增 ${r.savedCount} 条线索${r.skippedCount > 0 ? `（${r.skippedCount} 条已存在跳过）` : ''}`,
      })
      fetchSignals()
    } catch (e) {
      setRunResult({ signalId: signal.id, text: `执行失败：${e instanceof Error ? e.message : '未知错误'}` })
    } finally {
      setRunningId(null)
    }
  }

  /** 启停 */
  const handleToggle = async (signal: TrackingSignal) => {
    try {
      const res = await fetch(`/api/tracking-signals/${signal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !signal.isActive }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '操作失败')
      }
      fetchSignals()
    } catch (e) {
      alert(e instanceof Error ? e.message : '操作失败')
    }
  }

  /** 删除 */
  const handleDelete = async (signal: TrackingSignal) => {
    if (!confirm(`确定删除信号「${signal.name}」吗？已跟踪到的线索会保留。`)) return
    try {
      const res = await fetch(`/api/tracking-signals/${signal.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '删除失败')
      }
      fetchSignals()
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败')
    }
  }

  /** 草稿关键词编辑（回车/分号分隔） */
  const draftKeywordsText = draft ? draft.keywords.join('；') : ''

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      {/* 弹窗主体 */}
      <div className="relative bg-surface rounded-2xl shadow-soft-lg w-[92vw] max-w-2xl max-h-[85vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <h3 className="text-lg font-bold text-ink">跟踪信号</h3>
            <span className="text-xs text-ink-faint">自定义信号，按频率自动跟踪并生成线索</span>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center text-ink-faint hover:bg-gray-50 hover:text-ink transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* 新建信号 */}
          <div>
            <h4 className="text-lg font-bold text-ink mb-2">新建信号</h4>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder={'用自然语言描述你想跟踪的信号，AI 自动生成跟踪配置...\n例如：' + EXAMPLES[0]}
              rows={3}
              className="input-field resize-y"
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => setDesc(ex)}
                  className="pill bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors"
                >
                  示例{i + 1}
                </button>
              ))}
            </div>

            {draftError && (
              <div className="mt-2 p-2.5 bg-danger-50 border border-danger-200 rounded-xl text-xs text-danger-700">{draftError}</div>
            )}

            <button
              onClick={handleGenerate}
              disabled={generating || desc.trim().length < 5}
              className="btn-primary mt-3"
            >
              <svg className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
              {generating ? 'AI 解析中...' : 'AI 生成信号配置'}
            </button>

            {/* 草稿预览 */}
            {draft && (
              <div className="mt-3 p-4 bg-gray-50 rounded-2xl border border-hairline">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-ink">信号配置预览（可微调后保存）</span>
                  {draft.reason && <span className="text-xs text-primary-600">{draft.reason}</span>}
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-ink-muted mb-1">信号名称</label>
                    <input
                      value={draft.name}
                      onChange={e => setDraft({ ...draft, name: e.target.value })}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted mb-1">
                      搜索关键词（用；分隔，1-3 组）
                    </label>
                    <input
                      value={draftKeywordsText}
                      onChange={e =>
                        setDraft({
                          ...draft,
                          keywords: e.target.value.split(/[；;]/).map(k => k.trim()).filter(Boolean).slice(0, 3),
                        })
                      }
                      className="input-field"
                    />
                  </div>
                  {draft.watchTargets.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-ink-muted">监控对象：</span>
                      {draft.watchTargets.map((t, i) => (
                        <span key={i} className="pill bg-primary-50 text-primary-700 border border-primary-100">{t}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-4">
                    <div>
                      <label className="block text-xs text-ink-muted mb-1">跟踪频率</label>
                      <select
                        value={draft.frequency}
                        onChange={e => setDraft({ ...draft, frequency: e.target.value })}
                        className="input-field"
                      >
                        <option value="DAILY">每天</option>
                        <option value="WEEKLY">每周</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-ink-muted mb-1">信号类型</label>
                      <span className="pill bg-primary-50 text-primary-700 border border-primary-100">
                        {TYPE_LABELS[draft.signalType] || draft.signalType}
                      </span>
                    </div>
                    {draft.industry && (
                      <div>
                        <label className="block text-xs text-ink-muted mb-1">关联行业</label>
                        <span className="pill bg-primary-50 text-primary-700 border border-primary-100">{draft.industry}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={handleSaveDraft}
                    disabled={saving || draft.keywords.length === 0}
                    className="btn-primary"
                  >
                    {saving ? '保存中...' : '确认并开始跟踪'}
                  </button>
                  <button
                    onClick={() => setDraft(null)}
                    className="btn-secondary"
                  >
                    重新生成
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 信号列表 */}
          <div>
            <h4 className="text-lg font-bold text-ink mb-2">我的信号（{signals.length}）</h4>
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-6">
                <div className="w-6 h-6 rounded-full border-2 border-gray-100 border-b-2 border-b-primary-600 animate-spin" />
                <span className="text-xs text-ink-faint">加载中...</span>
              </div>
            ) : signals.length === 0 ? (
              <div className="py-8 text-center">
                <div className="w-14 h-14 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                <p className="text-xs text-ink-faint">还没有跟踪信号，用上面的自然语言输入创建第一个吧</p>
              </div>
            ) : (
              <div className="space-y-2">
                {signals.map(signal => {
                  let keywordList: string[] = []
                  try { keywordList = JSON.parse(signal.keywords) } catch { /* 忽略 */ }
                  return (
                    <div
                      key={signal.id}
                      className={`p-3.5 rounded-2xl border transition-colors ${
                        signal.isActive ? 'bg-surface border-hairline hover:bg-gray-50' : 'bg-gray-50 border-hairline opacity-70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-bold text-sm ${signal.isActive ? 'text-ink' : 'text-ink-muted'}`}>
                              {signal.name}
                            </span>
                            <span className="pill bg-primary-50 text-primary-700">
                              {TYPE_LABELS[signal.signalType] || '自定义'}
                            </span>
                            <span className="pill bg-gray-100 text-ink-muted">
                              {FREQ_LABELS[signal.frequency]}
                            </span>
                            {!signal.isActive && (
                              <span className="pill bg-gray-200 text-ink-muted">已暂停</span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-ink-faint truncate">{keywordList.join('；')}</div>
                          <div className="mt-1 text-xs text-ink-faint">
                            {signal.lastRunAt
                              ? `上次跟踪：${new Date(signal.lastRunAt).toLocaleString('zh-CN')} · 新增 ${signal.lastRunCount} 条`
                              : '尚未执行（等待下一次定时任务）'}
                          </div>
                          {runResult?.signalId === signal.id && (
                            <div className="mt-1.5 text-xs text-primary-700">{runResult.text}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => handleRun(signal)}
                            disabled={runningId === signal.id}
                            title="立即执行一次"
                            className="w-9 h-9 rounded-full flex items-center justify-center text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-50"
                          >
                            <svg className={`w-4 h-4 ${runningId === signal.id ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleToggle(signal)}
                            title={signal.isActive ? '暂停' : '启用'}
                            className="w-9 h-9 rounded-full flex items-center justify-center text-ink-faint hover:bg-gray-50 hover:text-ink transition-colors"
                          >
                            {signal.isActive ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={() => handleDelete(signal)}
                            title="删除"
                            className="w-9 h-9 rounded-full flex items-center justify-center text-ink-faint hover:bg-danger-50 hover:text-danger-600 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
