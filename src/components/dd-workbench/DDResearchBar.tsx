'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ResearchModuleBadge {
  moduleKey: string
  status: string
  coverage: number
  factCount: number
  sourceCount: number
  gapCount: number
}

type ResearchRunStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'PARTIAL' | 'FAILED'

interface ResearchRun {
  id: string
  status: ResearchRunStatus
  phase: string
  progress: number
  error: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

interface ResearchStats {
  sourceCount?: number
  factCount?: number
  gapCount?: number
  coverage?: number
  searchCount?: number
}

interface ResearchStatusPayload {
  run: ResearchRun | null
  modules: ResearchModuleBadge[]
  stats: ResearchStats | null
}

const PHASE_LABELS: Record<string, string> = {
  PLAN: '规划检索',
  SEARCH: '检索公开资料',
  EXTRACT: '抽取事实',
  SCORE: '评估覆盖度',
  GAP: '生成缺口清单',
}

const ACTIVE_STATUSES: ResearchRunStatus[] = ['QUEUED', 'RUNNING']

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function statusChip(run: ResearchRun): { label: string; className: string } {
  switch (run.status) {
    case 'DONE':
      return { label: '已完成', className: 'bg-success-50 text-success-700 border border-success-200' }
    case 'PARTIAL':
      return { label: '部分完成', className: 'bg-warning-50 text-warning-700 border border-warning-200' }
    case 'FAILED':
      return { label: '失败', className: 'bg-danger-50 text-danger-700 border border-danger-200' }
    default:
      return { label: '进行中', className: 'bg-blue-50 text-blue-700 border border-blue-200' }
  }
}

function httpErrorMessage(status: number, fallback: string): string {
  if (status === 401) return '登录已过期，请重新登录'
  if (status === 403) return '无权限执行该操作'
  return fallback
}

export default function DDResearchBar(props: {
  projectId: string
  canEdit: boolean
  gapSummary: { open: number; blocking: number; recommended: number } | null
  onGapClick: () => void
  onModules: (modules: ResearchModuleBadge[]) => void
  onResearchFinished: () => void
  onOpenDeck: (deckId: string) => void
}) {
  const {
    projectId,
    canEdit,
    gapSummary,
    onGapClick,
    onModules,
    onResearchFinished,
    onOpenDeck,
  } = props

  const [status, setStatus] = useState<ResearchStatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [deckBusy, setDeckBusy] = useState<'BRIEF' | 'FINAL' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onModulesRef = useRef(onModules)
  const onResearchFinishedRef = useRef(onResearchFinished)
  const onOpenDeckRef = useRef(onOpenDeck)
  const wasActiveRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    onModulesRef.current = onModules
  }, [onModules])

  useEffect(() => {
    onResearchFinishedRef.current = onResearchFinished
  }, [onResearchFinished])

  useEffect(() => {
    onOpenDeckRef.current = onOpenDeck
  }, [onOpenDeck])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/dd/research/${projectId}/status`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (mountedRef.current) {
          setError(data?.error || httpErrorMessage(res.status, '获取研究状态失败'))
        }
        return
      }
      if (!mountedRef.current) return

      const payload: ResearchStatusPayload = {
        run: (data?.run as ResearchRun | null) ?? null,
        modules: Array.isArray(data?.modules) ? (data.modules as ResearchModuleBadge[]) : [],
        stats: (data?.stats as ResearchStats | null) ?? null,
      }
      setStatus(payload)
      onModulesRef.current(payload.modules)

      const active = !!payload.run && ACTIVE_STATUSES.includes(payload.run.status)
      if (wasActiveRef.current && !active) {
        onResearchFinishedRef.current()
      }
      wasActiveRef.current = active
    } catch {
      if (mountedRef.current) setError('网络异常，请稍后重试')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  const run = status?.run ?? null
  const modules = status?.modules ?? []
  const active = !!run && ACTIVE_STATUSES.includes(run.status)
  const finished = !!run && !active

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      void fetchStatus()
    }, 3000)
    return () => clearInterval(timer)
  }, [active, fetchStatus])

  const startResearch = useCallback(
    async (force: boolean) => {
      if (!canEdit || starting || active) return
      setStarting(true)
      setError(null)
      try {
        const res = await fetch(`/api/dd/research/${projectId}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data?.error || httpErrorMessage(res.status, '启动全网尽调失败'))
          return
        }
        await fetchStatus()
      } catch {
        setError('网络异常，请稍后重试')
      } finally {
        if (mountedRef.current) setStarting(false)
      }
    },
    [active, canEdit, fetchStatus, projectId, starting]
  )

  const pollDeck = useCallback(async (deckId: string) => {
    for (let i = 0; i < 150; i++) {
      await sleep(2000)
      if (!mountedRef.current) return
      try {
        const res = await fetch(`/api/dd/deck/${deckId}`, { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data?.error || httpErrorMessage(res.status, '查询报告生成状态失败'))
          return
        }
        const deckStatus = data?.deck?.status as string | undefined
        if (deckStatus === 'READY') {
          onOpenDeckRef.current(deckId)
          return
        }
        if (deckStatus === 'FAILED') {
          setError(data?.deck?.error || '报告生成失败')
          return
        }
      } catch {
        setError('网络异常，请稍后重试')
        return
      }
    }
    setError('报告生成超时，请稍后重试')
  }, [])

  const generateDeck = useCallback(
    async (type: 'BRIEF' | 'FINAL') => {
      if (!canEdit || deckBusy) return
      setDeckBusy(type)
      setError(null)
      try {
        const res = await fetch(`/api/dd/decks/${projectId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(
            data?.error ||
              httpErrorMessage(res.status, type === 'FINAL' ? '生成尽调报告失败' : '生成资料简报失败')
          )
          if (type === 'FINAL' && res.status === 400) onGapClick()
          return
        }
        if (!data?.deckId) {
          setError('创建报告失败：未返回报告 ID')
          return
        }
        await pollDeck(String(data.deckId))
      } catch {
        setError('网络异常，请稍后重试')
      } finally {
        if (mountedRef.current) setDeckBusy(null)
      }
    },
    [canEdit, deckBusy, onGapClick, pollDeck, projectId]
  )

  const researchLabel = active
    ? `全网检索中 ${Math.round(run?.progress ?? 0)}%`
    : finished
      ? '🔄 重新全网尽调'
      : '🔍 一键全网尽调'

  const chip = run ? statusChip(run) : null
  const phaseLabel = run ? PHASE_LABELS[run.phase] || run.phase : ''
  const progress = Math.max(0, Math.min(100, run?.progress ?? 0))

  const fallbackSum = (key: 'sourceCount' | 'factCount' | 'gapCount') =>
    modules.reduce((sum, m) => sum + (Number(m[key]) || 0), 0)
  const statSource = status?.stats?.sourceCount ?? fallbackSum('sourceCount')
  const statFact = status?.stats?.factCount ?? fallbackSum('factCount')
  const statGap = status?.stats?.gapCount ?? fallbackSum('gapCount')
  const statCoverage =
    status?.stats?.coverage ??
    (modules.length
      ? modules.reduce((sum, m) => sum + (Number(m.coverage) || 0), 0) / modules.length
      : 0)

  return (
    <div className="dd-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-[160px]">
          <div className="text-sm font-bold text-ink">全网尽调</div>
          <div className="mt-0.5 text-[11px] text-ink-faint">
            九大模块自动检索 · 事实卡与缺口清单
          </div>
        </div>

        <button
          type="button"
          className="btn-secondary"
          disabled={!canEdit || deckBusy !== null}
          title={!canEdit ? '无编辑权限' : undefined}
          onClick={() => void generateDeck('BRIEF')}
        >
          {deckBusy === 'BRIEF' ? '简报生成中...' : '📑 资料简报'}
        </button>

        <button
          type="button"
          className="btn-secondary"
          disabled={!canEdit || deckBusy !== null}
          title={!canEdit ? '无编辑权限' : undefined}
          onClick={() => void generateDeck('FINAL')}
        >
          {deckBusy === 'FINAL' ? '报告生成中...' : '📊 尽调报告'}
        </button>

        <button
          type="button"
          className="btn-primary"
          disabled={!canEdit || active || starting}
          title={!canEdit ? '无编辑权限' : undefined}
          onClick={() => void startResearch(finished)}
        >
          {researchLabel}
        </button>
      </div>

      {loading && !status && (
        <div className="mt-3 text-xs text-ink-faint">加载研究进度...</div>
      )}

      {run && chip && (
        <div className="mt-4 rounded-xl border border-hairline bg-gray-50/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`pill ${chip.className}`}>{chip.label}</span>
            <span className="text-xs font-semibold text-ink">
              {phaseLabel || '处理中'}
            </span>
            <span className="ml-auto text-[11px] text-ink-faint">
              进度 {Math.round(progress)}%
            </span>
          </div>

          <div className="mt-2 h-2 overflow-hidden rounded-full bg-primary-50">
            <div
              className="h-full rounded-full bg-primary-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-2 text-[11px] text-ink-muted">
            来源 {statSource} · 事实 {statFact} · 缺口 {statGap} · 覆盖度{' '}
            {Math.round((Number(statCoverage) || 0) * 100)}%
          </div>

          {run.status === 'FAILED' && run.error && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">
              <span className="min-w-[160px] flex-1">⚠ {run.error}</span>
              <button
                type="button"
                className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-danger-700 border border-danger-200 disabled:opacity-40"
                disabled={!canEdit || starting}
                title={!canEdit ? '无编辑权限' : undefined}
                onClick={() => void startResearch(true)}
              >
                重试
              </button>
            </div>
          )}
        </div>
      )}

      {gapSummary && gapSummary.open > 0 && (
        <button
          type="button"
          onClick={onGapClick}
          className="mt-3 flex w-full items-center gap-2 rounded-xl border border-warning-200 bg-warning-50 px-3 py-2 text-left text-xs font-semibold text-warning-800 hover:bg-warning-100"
        >
          <span className="flex-1">
            ⚠ 还有 {gapSummary.blocking} 项阻塞、{gapSummary.recommended} 项建议资料待补充
          </span>
          <span className="text-[11px] font-bold">查看 ›</span>
        </button>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">
          <span className="flex-1">⚠ {error}</span>
          <button
            type="button"
            className="text-[11px] font-bold text-danger-700 hover:underline"
            onClick={() => setError(null)}
          >
            关闭
          </button>
        </div>
      )}
    </div>
  )
}
