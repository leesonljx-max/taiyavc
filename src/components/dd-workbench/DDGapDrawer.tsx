'use client'

import { useEffect, useMemo, useState } from 'react'
import { DD_TEMPLATE_MODULES } from '@/lib/dd-workbench/template'

export interface GapSummaryView {
  total: number
  open: number
  blocking: number
  recommended: number
  resolved: number
  waived: number
}

export interface GapItemView {
  id: string
  moduleKey: string
  moduleName: string
  label: string
  severity: 'BLOCKING' | 'RECOMMENDED'
  reason: string | null
  suggestedTypes: string | null
  status: 'OPEN' | 'RESOLVED' | 'WAIVED'
  waiveReason: string | null
}

const MODULE_ORDER = new Map(DD_TEMPLATE_MODULES.map((m, index) => [m.key, index]))

const severityBadge = (severity: GapItemView['severity']) =>
  severity === 'BLOCKING' ? (
    <span className="pill bg-danger-50 text-danger-700 border border-danger-200">🔴 阻塞</span>
  ) : (
    <span className="pill bg-warning-50 text-warning-700 border border-warning-200">🟡 建议</span>
  )

export default function DDGapDrawer(props: {
  projectId: string
  open: boolean
  canEdit: boolean
  userRole: string
  summary: GapSummaryView | null
  gaps: GapItemView[]
  loading?: boolean
  onClose: () => void
  onRefresh: () => void
  onGoModule: (moduleKey: string) => void
}) {
  const {
    projectId,
    open,
    canEdit,
    userRole,
    summary,
    gaps,
    loading = false,
    onClose,
    onRefresh,
    onGoModule,
  } = props

  const [tab, setTab] = useState<'OPEN' | 'CLOSED'>('OPEN')
  const [waivingId, setWaivingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [waiveError, setWaiveError] = useState<string | null>(null)

  const canWaive = userRole === 'ADMIN' || userRole === 'INVESTMENT_PARTNER'

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setWaivingId(null)
      setReason('')
      setWaiveError(null)
    }
  }, [open])

  const filtered = useMemo(() => {
    const list =
      tab === 'OPEN'
        ? gaps.filter(g => g.status === 'OPEN')
        : gaps.filter(g => g.status === 'RESOLVED' || g.status === 'WAIVED')
    return [...list].sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'BLOCKING' ? -1 : 1
      const orderA = MODULE_ORDER.get(a.moduleKey) ?? 99
      const orderB = MODULE_ORDER.get(b.moduleKey) ?? 99
      return orderA - orderB
    })
  }, [gaps, tab])

  const groups = useMemo(() => {
    const map = new Map<string, { moduleName: string; items: GapItemView[] }>()
    filtered.forEach(gap => {
      const name = gap.moduleName || gap.moduleKey
      const group = map.get(name) ?? { moduleName: name, items: [] }
      group.items.push(gap)
      map.set(name, group)
    })
    return Array.from(map.values())
  }, [filtered])

  if (!open) return null

  const closedCount = summary ? summary.resolved + summary.waived : 0
  const openCount = summary ? summary.open : gaps.filter(g => g.status === 'OPEN').length
  const blockingCount = summary
    ? summary.blocking
    : gaps.filter(g => g.status === 'OPEN' && g.severity === 'BLOCKING').length
  const recommendedCount = summary
    ? summary.recommended
    : gaps.filter(g => g.status === 'OPEN' && g.severity === 'RECOMMENDED').length

  const submitWaive = async (gapId: string) => {
    const trimmed = reason.trim()
    if (trimmed.length < 4) {
      setWaiveError('请填写至少 4 个字的豁免理由')
      return
    }
    setSubmitting(true)
    setWaiveError(null)
    try {
      const res = await fetch(`/api/dd/gaps/${projectId}/${gapId}/waive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: trimmed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setWaiveError(
          data?.error ||
            (res.status === 401
              ? '登录已过期，请重新登录'
              : res.status === 403
                ? '只有管理员或投资合伙人可以豁免缺口'
                : '豁免失败')
        )
        return
      }
      setWaivingId(null)
      setReason('')
      onRefresh()
    } catch {
      setWaiveError('网络异常，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="待补充资料">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col bg-white shadow-soft-xl">
        <div className="flex-shrink-0 border-b border-hairline px-5 py-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold text-ink">待补充资料</h2>
              <p className="mt-1 text-[11px] text-ink-muted">
                阻塞 {blockingCount} / 建议 {recommendedCount} / 已关闭 {closedCount}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-gray-100 hover:text-ink"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 flex items-center gap-1 rounded-full border border-hairline bg-surface p-0.5">
            <button
              type="button"
              onClick={() => setTab('OPEN')}
              className={`flex-1 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                tab === 'OPEN' ? 'bg-primary-50 text-primary-600' : 'text-ink-muted hover:text-ink'
              }`}
            >
              待补充 {openCount}
            </button>
            <button
              type="button"
              onClick={() => setTab('CLOSED')}
              className={`flex-1 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                tab === 'CLOSED' ? 'bg-primary-50 text-primary-600' : 'text-ink-muted hover:text-ink'
              }`}
            >
              已关闭 {closedCount}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && filtered.length === 0 && (
            <div className="text-xs text-ink-faint">加载缺口清单...</div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="rounded-xl border border-hairline bg-gray-50 px-4 py-6 text-center text-xs leading-relaxed text-ink-muted">
              {tab === 'OPEN'
                ? '暂无待补充资料。完成一次全网尽调后，系统会自动列出必须由项目方补充的材料。'
                : '暂无已关闭的缺口。'}
            </div>
          )}

          {groups.map(group => (
            <div key={group.moduleName} className="mb-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-bold text-primary-600">{group.moduleName}</span>
                <span className="text-[11px] text-ink-faint">{group.items.length} 项</span>
              </div>

              <div className="space-y-2">
                {group.items.map(gap => (
                  <div
                    key={gap.id}
                    className="rounded-xl border border-hairline bg-surface p-3 shadow-soft"
                  >
                    <div className="flex items-start gap-2">
                      {severityBadge(gap.severity)}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold leading-snug text-ink">
                          {gap.label}
                        </div>
                        {gap.reason && (
                          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                            <span className="font-semibold text-ink">为什么必须要：</span>
                            {gap.reason}
                          </p>
                        )}
                        {gap.suggestedTypes && (
                          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                            <span className="font-semibold text-ink">可上传：</span>
                            {gap.suggestedTypes}
                          </p>
                        )}
                        {gap.status === 'OPEN' && (
                          <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                            已收到资料但仍未关闭？说明资料中未识别到关键字段，建议补充完整原文，或在「非分类资料」中手动归入该模块。
                          </p>
                        )}
                        {gap.status === 'RESOLVED' && (
                          <p className="mt-1 text-xs font-semibold text-success-700">
                            ✓ 已由资料自动关闭
                          </p>
                        )}
                        {gap.status === 'WAIVED' && (
                          <p className="mt-1 text-xs font-semibold text-ink-muted">
                            已豁免：{gap.waiveReason || '—'}
                          </p>
                        )}
                      </div>
                    </div>

                    {gap.status === 'OPEN' && canEdit && (
                      <div className="mt-2 flex items-center justify-end gap-2">
                        {canWaive && (
                          <button
                            type="button"
                            className="rounded-full bg-warning-50 px-3 py-1 text-[11px] font-bold text-warning-700 hover:bg-warning-100"
                            onClick={() => {
                              setWaivingId(waivingId === gap.id ? null : gap.id)
                              setReason('')
                              setWaiveError(null)
                            }}
                          >
                            豁免
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded-full bg-primary-50 px-3 py-1 text-[11px] font-bold text-primary-700 hover:bg-primary-100"
                          onClick={() => {
                            onGoModule(gap.moduleKey)
                            onClose()
                          }}
                        >
                          📎 去补充
                        </button>
                      </div>
                    )}

                    {gap.status === 'OPEN' && waivingId === gap.id && (
                      <div className="mt-2 rounded-lg border border-warning-200 bg-warning-50 p-2">
                        <textarea
                          className="input-field min-h-[64px] resize-y text-xs"
                          placeholder="请填写豁免理由（至少 4 个字）"
                          value={reason}
                          onChange={e => setReason(e.target.value)}
                        />
                        {waiveError && (
                          <div className="mt-1 text-[11px] text-danger-700">⚠ {waiveError}</div>
                        )}
                        <div className="mt-2 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-ink-muted border border-hairline"
                            disabled={submitting}
                            onClick={() => {
                              setWaivingId(null)
                              setWaiveError(null)
                            }}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            className="rounded-full bg-warning-600 px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                            disabled={submitting}
                            onClick={() => void submitWaive(gap.id)}
                          >
                            {submitting ? '提交中...' : '确认豁免'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}
