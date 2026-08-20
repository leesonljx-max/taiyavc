'use client'

/**
 * 尽调报告面板（DeepSeek Harness 架构）
 *
 * - 项目进入「尽调」阶段自动分析；也可手动触发（增量/全量）
 * - 模块级状态：✅已完成结论 / ⚠️资料不足 / ❌失败 / 🔄运行中 / ⏳待分析
 * - 缺口清单：资料不足的模块汇总，提示维护人补充资料
 * - 每条结论带引用来源（可点击溯源，来自子Agent会话日志、已交叉验证）
 * - 运行中每 4 秒轮询刷新进度
 */

import { useState, useEffect, useCallback, useRef } from 'react'

interface DDCitation {
  label: string
  url: string
}

interface DDModule {
  id: string
  moduleKey: string
  moduleName: string
  required: boolean
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'INSUFFICIENT_DATA' | 'FAILED'
  conclusion: string | null
  citations: DDCitation[]
  missing: string | null
  analyzedAt: string | null
  error: string | null
}

interface DDGap {
  moduleKey: string
  moduleName: string
  missing: string
}

interface DDReportData {
  id: string
  status: string
  framework: { modules: Array<{ key: string; name: string; required: boolean; focus: string }> } | null
  gaps: DDGap[]
  lastRunAt: string | null
  error: string | null
  modules: DDModule[]
}

const STATUS_CONFIG: Record<string, { label: string; badge: string; icon: string }> = {
  PENDING: { label: '待分析', badge: 'bg-gray-100 text-gray-500', icon: '⏳' },
  RUNNING: { label: '分析中', badge: 'bg-blue-100 text-blue-600', icon: '🔄' },
  COMPLETED: { label: '已完成', badge: 'bg-emerald-100 text-emerald-700', icon: '✅' },
  INSUFFICIENT_DATA: { label: '资料不足', badge: 'bg-amber-100 text-amber-700', icon: '⚠️' },
  FAILED: { label: '失败', badge: 'bg-red-100 text-red-600', icon: '❌' },
}

export default function DDReportPanel({
  projectId,
  canEdit,
}: {
  projectId: string
  canEdit: boolean
}) {
  const [report, setReport] = useState<DDReportData | null>(null)
  const [running, setRunning] = useState(false)
  const [inDDStage, setInDDStage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/research/${projectId}/dd`)
      const data = await res.json()
      if (res.ok) {
        setReport(data.report)
        setRunning(!!data.running || data.report?.status === 'RUNNING')
        setInDDStage(!!data.inDueDiligenceStage)
      }
    } catch {
      // 忽略轮询错误
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchReport()
  }, [fetchReport])

  // 运行中轮询
  useEffect(() => {
    if (running) {
      pollRef.current = setInterval(fetchReport, 4000)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [running, fetchReport])

  const triggerRun = async (force: boolean) => {
    setStarting(true)
    try {
      const res = await fetch(`/api/research/${projectId}/dd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || '触发失败')
        return
      }
      setRunning(true)
      fetchReport()
    } catch {
      alert('网络错误')
    } finally {
      setStarting(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-primary-100 p-5">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-500"></div>
          加载尽调报告...
        </div>
      </div>
    )
  }

  const modules = report?.modules || []
  const completedCount = modules.filter(m => m.status === 'COMPLETED').length
  const gapCount = modules.filter(m => m.status === 'INSUFFICIENT_DATA').length
  const hasReport = !!report
  const isRunning = running || report?.status === 'RUNNING'

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-primary-100 overflow-hidden">
      {/* ── 头部 ── */}
      <div className="px-5 py-4 bg-gradient-to-r from-indigo-50/70 via-primary-50/40 to-transparent border-b border-primary-100">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-2.5 min-w-0"
          >
            <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-primary-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </span>
            <div className="text-left min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-gray-900">尽调报告</h2>
                <span className="px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-600 text-[10px] font-bold">AI HARNESS</span>
                {isRunning && (
                  <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                    分析中...
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 truncate">
                {hasReport
                  ? `${modules.length} 个模块 · ${completedCount} 已完成${gapCount > 0 ? ` · ${gapCount} 个资料缺口` : ''}${
                      report.lastRunAt
                        ? ` · 上次运行 ${new Date(report.lastRunAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                        : ''
                    }`
                  : inDDStage
                    ? '项目已进入尽调阶段，可生成尽调报告'
                    : '项目进入尽调阶段后将自动生成'}
              </p>
            </div>
          </button>

          {canEdit && (
            <div className="flex gap-2 flex-shrink-0">
              {hasReport && (
                <button
                  onClick={() => triggerRun(false)}
                  disabled={starting || isRunning}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-primary-200 text-primary-700 hover:bg-primary-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="输入未变的已完成模块自动跳过，仅重跑有变化或未完成的模块"
                >
                  {isRunning ? '分析中...' : '增量分析'}
                </button>
              )}
              <button
                onClick={() => triggerRun(true)}
                disabled={starting || isRunning}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-gradient-to-r from-indigo-500 to-primary-600 text-white hover:from-indigo-600 hover:to-primary-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-500/20 transition-all"
              >
                {hasReport ? '全量重跑' : '生成尽调报告'}
              </button>
            </div>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="p-5 space-y-4">
          {/* ── 无报告提示 ── */}
          {!hasReport && (
            <div className="py-8 text-center">
              <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-indigo-50 flex items-center justify-center">
                <svg className="w-7 h-7 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <p className="text-sm text-gray-500">
                {inDDStage
                  ? '项目已进入尽调阶段，点击「生成尽调报告」启动 AI 分析'
                  : '项目阶段变更为「尽调」后，系统将自动生成尽调报告'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                7 大必选模块（主要产品/核心优势/核心团队/财务数据/订单进展/竞争对手/融资规划）+ 行业定制模块
              </p>
            </div>
          )}

          {/* ── 缺口清单（资料不足 → 通知维护人补充） ── */}
          {hasReport && report.gaps.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50/60 p-4">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-6 h-6 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600 text-sm">⚠️</span>
                <span className="text-sm font-bold text-amber-800">
                  需补充资料（{report.gaps.length} 个模块）
                </span>
                <span className="text-xs text-amber-600/80">补充后点击「增量分析」仅重跑受影响模块</span>
              </div>
              <div className="space-y-1.5">
                {report.gaps.map(g => (
                  <div key={g.moduleKey} className="flex items-start gap-2 text-sm">
                    <span className="text-amber-700 font-semibold flex-shrink-0 min-w-[72px]">{g.moduleName}</span>
                    <span className="text-gray-600">{g.missing}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 模块结果列表 ── */}
          {hasReport && modules.length > 0 && (
            <div className="space-y-2.5">
              {modules.map(m => {
                const cfg = STATUS_CONFIG[m.status] || STATUS_CONFIG.PENDING
                const isExpanded = expanded === m.id
                return (
                  <div
                    key={m.id}
                    className={`rounded-xl border transition-all ${
                      m.status === 'RUNNING'
                        ? 'border-blue-200 bg-blue-50/40'
                        : m.status === 'INSUFFICIENT_DATA'
                          ? 'border-amber-100 bg-amber-50/30'
                          : m.status === 'FAILED'
                            ? 'border-red-100 bg-red-50/20'
                            : 'border-gray-100 bg-white'
                    }`}
                  >
                    {/* 模块标题行 */}
                    <button
                      onClick={() => setExpanded(isExpanded ? null : m.id)}
                      className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50/60 transition-colors"
                    >
                      <span className="text-base flex-shrink-0">
                        {m.status === 'RUNNING' ? (
                          <span className="inline-block animate-spin">🔄</span>
                        ) : (
                          cfg.icon
                        )}
                      </span>
                      <span className="text-sm font-bold text-gray-900 flex-shrink-0">{m.moduleName}</span>
                      {m.required && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500 flex-shrink-0">
                          必选
                        </span>
                      )}
                      {!m.required && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-500 flex-shrink-0">
                          定制
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold flex-shrink-0 ${cfg.badge}`}>
                        {cfg.label}
                      </span>
                      <span className="flex-1"></span>
                      {m.citations.length > 0 && (
                        <span className="text-[11px] text-gray-400 flex-shrink-0" title="引用来源数">
                          {m.citations.length} 个来源
                        </span>
                      )}
                      <svg
                        className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* 展开详情 */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                        {m.status === 'RUNNING' && (
                          <p className="text-sm text-blue-600">子Agent正在分析（读取项目资料 + 联网核实）...</p>
                        )}
                        {m.status === 'PENDING' && (
                          <p className="text-sm text-gray-400">待分析（增量模式下输入未变时自动跳过）</p>
                        )}
                        {m.conclusion && (
                          <div className="rounded-lg bg-gray-50 px-3.5 py-3">
                            <p className="text-xs font-semibold text-gray-400 mb-1.5">尽调结论</p>
                            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{m.conclusion}</p>
                          </div>
                        )}
                        {m.missing && m.status === 'INSUFFICIENT_DATA' && (
                          <div className="rounded-lg bg-amber-50 border border-amber-100 px-3.5 py-2.5">
                            <p className="text-xs font-semibold text-amber-700 mb-1">缺少资料</p>
                            <p className="text-sm text-gray-700">{m.missing}</p>
                          </div>
                        )}
                        {m.error && (
                          <p className="text-xs text-red-500">分析失败：{m.error}</p>
                        )}
                        {/* 引用来源（可点击溯源） */}
                        {m.citations.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-400 mb-1.5">
                              资料索引（{m.citations.length}，来自联网检索，已验证）
                            </p>
                            <div className="space-y-1">
                              {m.citations.map((c, i) => (
                                <a
                                  key={i}
                                  href={c.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-800 hover:underline break-all"
                                >
                                  <span className="w-4 h-4 rounded bg-primary-50 text-primary-500 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                                    {i + 1}
                                  </span>
                                  <span className="truncate">{c.label}</span>
                                  <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                        {m.analyzedAt && (
                          <p className="text-[11px] text-gray-300">
                            分析于 {new Date(m.analyzedAt).toLocaleString('zh-CN')}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {hasReport && report.error && (
            <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
              上次运行出错：{report.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
