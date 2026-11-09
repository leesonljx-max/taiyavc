'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type ReportType = 'PERSONAL' | 'COMPANY'

interface ReportSummary {
  id: string
  year: number
  type: ReportType
  status: 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED'
  phase: string | null
  progress: number
  pageCount: number
  theme?: string
  overview?: string
  error?: string | null
}

interface Availability {
  year: number
  window: {
    state: 'BEFORE_WINDOW' | 'OPEN' | 'CLOSED'
    canGenerate: boolean
    reason?: string
    forced: boolean
  }
  permissions: {
    personal: boolean
    company: boolean
    viewCompany: boolean
  }
  reports: {
    personal: ReportSummary | null
    company: ReportSummary | null
  }
}

function statusText(report: ReportSummary | null): string {
  if (!report) return ''
  if (report.status === 'QUEUED') return '排队中'
  if (report.status === 'GENERATING') {
    if (report.phase === 'RESEARCHING') return `检索融资进展 ${report.progress}%`
    if (report.phase === 'COMPOSING') return `生成摘要 ${report.progress}%`
    return `汇总数据 ${report.progress}%`
  }
  if (report.status === 'FAILED') return '生成失败'
  return '已生成'
}

function windowText(availability: Availability): string {
  if (availability.window.forced) return '验收模式 · 可生成'
  if (availability.window.state === 'OPEN') return '生成窗口开放中（1月1日–3月1日）'
  if (availability.window.state === 'BEFORE_WINDOW') return '1月1日开放生成'
  return '本年度生成已截止'
}

export default function AnnualReportEntry() {
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [busy, setBusy] = useState<ReportType | null>(null)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/annual-reports/availability', { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '获取年报状态失败')
      setAvailability(body as Availability)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取年报状态失败')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 生成中轮询
  useEffect(() => {
    if (!availability) return
    const generating =
      availability.reports.personal?.status === 'QUEUED' ||
      availability.reports.personal?.status === 'GENERATING' ||
      availability.reports.company?.status === 'QUEUED' ||
      availability.reports.company?.status === 'GENERATING'
    if (!generating) return
    const timer = setTimeout(() => {
      void load()
    }, 3000)
    return () => clearTimeout(timer)
  }, [availability, load])

  const generate = async (type: ReportType) => {
    if (!availability) return
    setBusy(type)
    setError('')
    try {
      const response = await fetch('/api/annual-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: availability.year, type }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '生成年报失败')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成年报失败')
    } finally {
      setBusy(null)
    }
  }

  if (!loaded) {
    return (
      <div className="mb-6 h-[132px] rounded-2xl bg-ink/5 animate-pulse" />
    )
  }
  if (!availability) return null

  const cards: Array<{ type: ReportType; label: string; caption: string; report: ReportSummary | null; allowed: boolean }> = [
    {
      type: 'PERSONAL',
      label: '项目维护人版',
      caption: '我的年度项目盘点',
      report: availability.reports.personal,
      allowed: availability.permissions.personal,
    },
    ...(availability.permissions.viewCompany
      ? [
          {
            type: 'COMPANY' as ReportType,
            label: '公司版',
            caption: '全年工作与赛道复盘',
            report: availability.reports.company,
            allowed: availability.permissions.company,
          },
        ]
      : []),
  ]

  return (
    <div
      className="relative overflow-hidden rounded-2xl mb-6 text-white"
      style={{ background: 'linear-gradient(120deg, #0A1A30 0%, #12294A 55%, #1D3A5F 100%)' }}
    >
      <div
        className="absolute -right-16 -top-24 w-72 h-72 rounded-full opacity-25"
        style={{ background: 'radial-gradient(circle, #D8B56A 0%, transparent 68%)' }}
      />
      <div
        className="absolute right-24 -bottom-28 w-64 h-64 rounded-full opacity-15"
        style={{ background: 'radial-gradient(circle, #7FA7D9 0%, transparent 70%)' }}
      />
      <div className="relative p-5 lg:p-6 flex flex-col lg:flex-row lg:items-center gap-5">
        <div className="flex items-start gap-4 lg:w-[300px] flex-shrink-0">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border"
            style={{ borderColor: 'rgba(216,181,106,0.55)', background: 'rgba(216,181,106,0.10)' }}
          >
            <svg className="w-6 h-6" style={{ color: '#E4C98B' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-semibold tracking-wide">年度报告</h2>
              <span
                className="text-[11px] px-2 py-0.5 rounded-full border"
                style={{ borderColor: 'rgba(228,201,139,0.45)', color: '#E4C98B' }}
              >
                {availability.year}
              </span>
            </div>
            <p className="text-[12px] mt-1" style={{ color: 'rgba(255,255,255,0.62)' }}>
              {windowText(availability)}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.42)' }}>
              自动汇总阶段、赛道、月度节奏与公开融资进展
            </p>
          </div>
        </div>

        <div className="flex-1 grid sm:grid-cols-2 gap-3">
          {cards.map(card => {
            const report = card.report
            const running = report?.status === 'QUEUED' || report?.status === 'GENERATING'
            const ready = report?.status === 'READY'
            return (
              <div
                key={card.type}
                className="rounded-xl px-4 py-3.5 flex flex-col gap-2.5"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[13px] font-medium">{card.label}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                      {ready ? `${report?.pageCount || (card.type === 'PERSONAL' ? 8 : 10)} 页 · 可下载图片` : card.caption}
                    </div>
                  </div>
                  {running ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(216,181,106,0.16)', color: '#E4C98B' }}>
                      {statusText(report)}
                    </span>
                  ) : (
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full"
                      style={{
                        background: ready ? 'rgba(110,231,183,0.14)' : 'rgba(255,255,255,0.08)',
                        color: ready ? '#A7F3D0' : 'rgba(255,255,255,0.48)',
                      }}
                    >
                      {report ? statusText(report) : '未生成'}
                    </span>
                  )}
                </div>

                {ready && report?.theme && (
                  <div className="text-[11.5px] leading-5 line-clamp-2" style={{ color: 'rgba(255,255,255,0.66)' }}>
                    {report.theme}
                    {report.overview ? ` · ${report.overview}` : ''}
                  </div>
                )}
                {report?.status === 'FAILED' && (
                  <div className="text-[11px] leading-4 line-clamp-2" style={{ color: '#FDA4AF' }}>
                    {report.error || '生成失败，可重试'}
                  </div>
                )}
                {running && (
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.max(6, report?.progress || 0)}%`, background: '#D8B56A' }}
                    />
                  </div>
                )}

                <div className="flex items-center gap-2 mt-auto">
                  {ready ? (
                    <>
                      <Link
                        href={`/annual-reports/${report?.id}`}
                        className="flex-1 text-center text-[12px] py-1.5 rounded-lg font-medium"
                        style={{ background: '#D8B56A', color: '#1A2233' }}
                      >
                        查看年报
                      </Link>
                      <Link
                        href={`/annual-reports/${report?.id}`}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg"
                        style={{ border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.72)' }}
                      >
                        下载
                      </Link>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void generate(card.type)}
                      disabled={busy !== null || running || !card.allowed || !availability.window.canGenerate}
                      className="flex-1 text-[12px] py-1.5 rounded-lg font-medium disabled:opacity-45 disabled:cursor-not-allowed"
                      style={{ background: '#D8B56A', color: '#1A2233' }}
                    >
                      {busy === card.type
                        ? '提交中…'
                        : running
                          ? '生成中…'
                          : report?.status === 'FAILED'
                            ? '重试生成'
                            : !card.allowed
                              ? '无生成权限'
                              : !availability.window.canGenerate
                                ? '不在生成窗口'
                                : '生成年报'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {error && (
        <div className="relative px-5 lg:px-6 pb-4 text-[12px]" style={{ color: '#FDA4AF' }}>
          {error}
        </div>
      )}
    </div>
  )
}
