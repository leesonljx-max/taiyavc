'use client'

/**
 * AI 看板（原新闻监控页升级）
 *
 * 核心功能：
 * - Token 消耗日历热力图：按颜色深浅展示每天总消耗量，点击查看当日各模块明细
 * - 模块消耗统计：AI画板/竞争态势/AI线索/行业动态/新闻检索/投研分析/尽调报告/搜索库
 * - 月度汇总卡片：总 token / 总调用次数 / 日均消耗
 *
 * 数据源：/api/token-usage（token-accounting 记账，按天聚合存 AICache）
 */

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'

// ── 类型 ──

interface ModuleUsage {
  inputTokens: number
  outputTokens: number
  calls: number
}

interface DayUsage {
  date: string
  modules: Record<string, ModuleUsage>
  totalInput: number
  totalOutput: number
}

interface UsageData {
  startDate: string
  endDate: string
  days: DayUsage[]
  summary: {
    totalInput: number
    totalOutput: number
    totalTokens: number
    moduleTotals: Record<string, ModuleUsage>
  }
}

// 模块中文名映射
const MODULE_LABELS: Record<string, string> = {
  'ai-card': 'AI投资分析',
  'competitors': '竞争态势分析',
  'ai-leads': 'AI 线索',
  'industry-news': '行业动态',
  'news': '新闻检索',
  'research': '投研模块分析',
  'dd-harness': '尽调报告',
  'ai-research': 'AI行研',
  'search-lib': '搜索归纳',
  other: '其他',
}

// 模块主题色
const MODULE_COLORS: Record<string, string> = {
  'ai-card': 'bg-blue-500',
  'competitors': 'bg-purple-500',
  'ai-leads': 'bg-emerald-500',
  'industry-news': 'bg-amber-500',
  'news': 'bg-cyan-500',
  'research': 'bg-indigo-500',
  'dd-harness': 'bg-rose-500',
  'ai-research': 'bg-fuchsia-500',
  'search-lib': 'bg-teal-500',
  other: 'bg-gray-400',
}

/** token 数格式化（万为单位） */
function fmtTokens(n: number): string {
  if (n === 0) return '0'
  if (n < 10_000) return n.toLocaleString()
  return `${(n / 10_000).toFixed(1)}万`
}

/** 日历热力图颜色分级（5 档，按当月最大日消耗归一化） */
function heatLevel(total: number, max: number): number {
  if (total <= 0) return 0
  if (max <= 0) return 1
  const ratio = total / max
  if (ratio <= 0.2) return 1
  if (ratio <= 0.4) return 2
  if (ratio <= 0.6) return 3
  if (ratio <= 0.8) return 4
  return 5
}

const HEAT_STYLES = [
  'bg-gray-100 text-gray-400',
  'bg-emerald-100 text-emerald-700',
  'bg-emerald-200 text-emerald-800',
  'bg-amber-200 text-amber-800',
  'bg-orange-300 text-orange-900',
  'bg-red-400 text-red-50',
]

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

export default function AIBoardPage() {
  const { status } = useSession()
  const router = useRouter()

  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDay, setSelectedDay] = useState<DayUsage | null>(null)
  const [viewMonth, setViewMonth] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login?callbackUrl=/news')
    }
  }, [status, router])

  const fetchUsage = useCallback(async (month: string) => {
    setLoading(true)
    setError('')
    try {
      // 月视图：当月1日 ~ 月末（或今天）
      const [y, m] = month.split('-').map(Number)
      const start = `${month}-01`
      const lastDay = new Date(y, m, 0).getDate()
      const today = new Date()
      const isCurrentMonth = today.getFullYear() === y && today.getMonth() + 1 === m
      const end = isCurrentMonth
        ? `${month}-${String(today.getDate()).padStart(2, '0')}`
        : `${month}-${String(lastDay).padStart(2, '0')}`

      const res = await fetch(`/api/token-usage?startDate=${start}&endDate=${end}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || '获取数据失败')
        setData(null)
      } else {
        setData(json as UsageData)
        // 默认选中今天（或有数据的最近一天）
        const withData = (json.days as DayUsage[]).filter(d => d.totalInput + d.totalOutput > 0)
        setSelectedDay(withData.length > 0 ? withData[withData.length - 1] : (json.days as DayUsage[])[json.days.length - 1] || null)
      }
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'authenticated') {
      fetchUsage(viewMonth)
    }
  }, [status, viewMonth, fetchUsage])

  // 月份切换
  const changeMonth = (delta: number) => {
    const [y, m] = viewMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // 日历格子：周一开头的整月网格
  const buildCalendar = () => {
    if (!data) return []
    const [y, m] = viewMonth.split('-').map(Number)
    const firstDay = new Date(y, m - 1, 1)
    const daysInMonth = new Date(y, m, 0).getDate()
    // 周一=0 ... 周日=6
    const firstWeekday = (firstDay.getDay() + 6) % 7

    const byDate = new Map(data.days.map(d => [d.date, d]))
    const maxTotal = Math.max(0, ...data.days.map(d => d.totalInput + d.totalOutput))

    const cells: Array<{ date: string; day: number | null; total: number; level: number; usage: DayUsage | null }> = []
    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ date: '', day: null, total: 0, level: 0, usage: null })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${viewMonth}-${String(d).padStart(2, '0')}`
      const usage = byDate.get(date) || null
      const total = usage ? usage.totalInput + usage.totalOutput : 0
      cells.push({ date, day: d, total, level: heatLevel(total, maxTotal), usage })
    }
    return cells
  }

  const calendarCells = buildCalendar()

  // 模块汇总排序（按总 token 降序）
  const moduleRanking = data
    ? Object.entries(data.summary.moduleTotals)
        .map(([m, v]) => ({ module: m, ...v, total: v.inputTokens + v.outputTokens }))
        .sort((a, b) => b.total - a.total)
    : []

  return (
    <DashboardLayout title="AI 看板" subtitle="各 AI 模块 Token 消耗实时监控">
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl shadow-sm border border-primary-100 p-8 text-center">
          <p className="text-red-500 mb-2">{error}</p>
          <button
            onClick={() => fetchUsage(viewMonth)}
            className="px-4 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 text-sm font-medium"
          >
            重试
          </button>
        </div>
      ) : !data ? (
        <div className="bg-white rounded-2xl shadow-sm border border-primary-100 p-16 text-center">
          <p className="text-gray-500">暂无数据</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── 汇总卡片 ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gradient-card rounded-2xl p-5 shadow-sm border border-primary-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center shadow-md shadow-primary-500/30">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">{fmtTokens(data.summary.totalTokens)}</div>
                  <div className="text-xs text-gray-500">{viewMonth} 总 Token</div>
                </div>
              </div>
            </div>
            <div className="bg-gradient-card rounded-2xl p-5 shadow-sm border border-primary-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center shadow-md shadow-blue-500/30">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">{fmtTokens(data.summary.totalInput)}</div>
                  <div className="text-xs text-gray-500">输入 Token（网页阅读等）</div>
                </div>
              </div>
            </div>
            <div className="bg-gradient-card rounded-2xl p-5 shadow-sm border border-primary-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl flex items-center justify-center shadow-md shadow-amber-500/30">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">{fmtTokens(data.summary.totalOutput)}</div>
                  <div className="text-xs text-gray-500">输出 Token（AI 生成）</div>
                </div>
              </div>
            </div>
            <div className="bg-gradient-card rounded-2xl p-5 shadow-sm border border-primary-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center shadow-md shadow-emerald-500/30">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                  </svg>
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">
                    {Object.values(data.summary.moduleTotals).reduce((s, m) => s + m.calls, 0)}
                  </div>
                  <div className="text-xs text-gray-500">AI 调用次数</div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* ── 左：日历热力图 ── */}
            <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-primary-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-gray-900">消耗日历</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => changeMonth(-1)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-primary-100 hover:bg-primary-50 text-gray-600"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <span className="text-sm font-semibold text-gray-700 min-w-[72px] text-center">{viewMonth}</span>
                  <button
                    onClick={() => changeMonth(1)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-primary-100 hover:bg-primary-50 text-gray-600"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* 星期标题 */}
              <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                {WEEKDAYS.map(w => (
                  <div key={w} className="text-center text-xs text-gray-400 font-medium py-1">{w}</div>
                ))}
              </div>

              {/* 日历格子 */}
              <div className="grid grid-cols-7 gap-1.5">
                {calendarCells.map((cell, i) => {
                  if (cell.day === null) {
                    return <div key={`empty-${i}`} className="aspect-square" />
                  }
                  const isSelected = selectedDay?.date === cell.date
                  return (
                    <button
                      key={cell.date}
                      onClick={() => setSelectedDay(cell.usage)}
                      title={cell.date + (cell.total > 0 ? ` · ${fmtTokens(cell.total)} tokens` : '')}
                      className={`aspect-square rounded-lg flex flex-col items-center justify-center transition-all cursor-pointer select-none
                        ${HEAT_STYLES[cell.level]}
                        ${isSelected ? 'ring-2 ring-primary-500 ring-offset-1 scale-105' : 'hover:scale-105'}`}
                    >
                      <span className="text-xs font-semibold leading-none">{cell.day}</span>
                      {cell.total > 0 && (
                        <span className="text-[9px] leading-tight mt-0.5 opacity-80">{fmtTokens(cell.total)}</span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* 图例 */}
              <div className="flex items-center justify-between mt-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400">少</span>
                  {HEAT_STYLES.map((s, i) => (
                    <span key={i} className={`w-4 h-4 rounded ${s}`} />
                  ))}
                  <span className="text-xs text-gray-400">多</span>
                </div>
                <p className="text-xs text-gray-400">点击日期查看当日各模块明细</p>
              </div>
            </div>

            {/* ── 右：选中日明细 + 模块排行 ── */}
            <div className="space-y-6">
              {/* 当日明细 */}
              <div className="bg-white rounded-2xl shadow-sm border border-primary-100 p-5">
                <h2 className="text-sm font-bold text-gray-900 mb-3">
                  {selectedDay ? `${selectedDay.date} 明细` : '当日明细'}
                </h2>
                {!selectedDay || selectedDay.totalInput + selectedDay.totalOutput === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">当日无 AI 调用</p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">输入</span>
                      <span className="font-semibold text-blue-600">{fmtTokens(selectedDay.totalInput)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">输出</span>
                      <span className="font-semibold text-amber-600">{fmtTokens(selectedDay.totalOutput)}</span>
                    </div>
                    <div className="border-t border-gray-100 pt-2 mt-2 space-y-2">
                      {Object.entries(selectedDay.modules)
                        .sort((a, b) => (b[1].inputTokens + b[1].outputTokens) - (a[1].inputTokens + a[1].outputTokens))
                        .map(([m, v]) => (
                          <div key={m} className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-gray-600">
                              <span className={`w-2 h-2 rounded-full ${MODULE_COLORS[m] || MODULE_COLORS.other}`} />
                              {MODULE_LABELS[m] || m}
                            </span>
                            <span className="font-medium text-gray-800">
                              {fmtTokens(v.inputTokens + v.outputTokens)}
                              <span className="text-gray-400 ml-1">({v.calls}次)</span>
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 模块排行 */}
              <div className="bg-white rounded-2xl shadow-sm border border-primary-100 p-5">
                <h2 className="text-sm font-bold text-gray-900 mb-3">{viewMonth} 模块消耗排行</h2>
                {moduleRanking.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">暂无消耗记录</p>
                ) : (
                  <div className="space-y-2.5">
                    {moduleRanking.map(r => {
                      const maxTotal = moduleRanking[0].total
                      const pct = maxTotal > 0 ? Math.max(4, Math.round((r.total / maxTotal) * 100)) : 0
                      return (
                        <div key={r.module}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="flex items-center gap-1.5 text-gray-600">
                              <span className={`w-2 h-2 rounded-full ${MODULE_COLORS[r.module] || MODULE_COLORS.other}`} />
                              {MODULE_LABELS[r.module] || r.module}
                            </span>
                            <span className="font-medium text-gray-800">
                              {fmtTokens(r.total)}
                              <span className="text-gray-400 ml-1">({r.calls}次)</span>
                            </span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${MODULE_COLORS[r.module] || MODULE_COLORS.other} transition-all`}
                              style={{ width: `${pct}%` }}
                            />
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
      )}
    </DashboardLayout>
  )
}
