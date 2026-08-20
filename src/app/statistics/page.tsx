'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/DashboardLayout'

interface IndustryProject {
  id: string
  name: string
  companyFullName: string | null
  financingRound: string | null
  followStage: string
  totalAmount: string
}

interface IndustryStat {
  industry: string
  count: number
  projects: IndustryProject[]
}

interface IndustryMapData {
  year: number
  years: number[]
  totalProjects: number
  totalIndustries: number
  industries: IndustryStat[]
}

interface IndustryEvent {
  type: string
  company: string
  title: string
  detail: string
  date: string
}

interface IndustryNewsCard {
  industry: string
  events: IndustryEvent[]
  citations: Array<{ label: string; url: string }>
  analyzedAt: string
  note?: string
}

interface IndustryNewsData {
  date: string
  cards: IndustryNewsCard[]
  running?: string[]
  topIndustries?: string[]
}

const stageLabels: Record<string, string> = {
  INITIAL_TALK: '初聊',
  PRE_DD: 'PreDD',
  PROJECT_INITIATION: '立项',
  DUE_DILIGENCE: '尽调',
  AGREEMENT: '协议',
  CLOSING: '交割',
  POST_INVESTMENT: '投后',
}

/** 事件类型徽章配色 */
const EVENT_TYPE_STYLES: Record<string, string> = {
  融资: 'bg-rose-100 text-rose-700',
  产品发布: 'bg-emerald-100 text-emerald-700',
  技术突破: 'bg-blue-100 text-blue-700',
  人员变更: 'bg-amber-100 text-amber-700',
  合作: 'bg-indigo-100 text-indigo-700',
  政策: 'bg-purple-100 text-purple-700',
}

export default function StatisticsPage() {
  const { status } = useSession()
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [industryData, setIndustryData] = useState<IndustryMapData | null>(null)
  const [industryLoading, setIndustryLoading] = useState(false)
  const [industryError, setIndustryError] = useState('')
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null)

  // 行业动态
  const [newsData, setNewsData] = useState<IndustryNewsData | null>(null)
  const [newsLoading, setNewsLoading] = useState(true)
  const [newsError, setNewsError] = useState('')
  /** 即时分析中（POST 同步等待） */
  const [analyzingIndustry, setAnalyzingIndustry] = useState<string | null>(null)
  const autoTriggeredRef = useRef(false)

  useEffect(() => {
    if (status !== 'authenticated') return
    fetchIndustryMap(selectedYear)
  }, [status, selectedYear])

  const fetchIndustryMap = async (year: number) => {
    setIndustryLoading(true)
    setIndustryError('')
    try {
      const res = await fetch(`/api/statistics/industry-map?year=${year}`)
      const data = await res.json()
      if (!res.ok) {
        setIndustryError(data.error || '获取行业图谱失败')
        return
      }
      setIndustryData(data)
    } catch {
      setIndustryError('网络错误')
    } finally {
      setIndustryLoading(false)
    }
  }

  // ── 行业动态：读取当日缓存（cron 每日 04:00 生成） ──
  const fetchIndustryNews = async () => {
    setNewsLoading(true)
    setNewsError('')
    try {
      const res = await fetch('/api/statistics/industry-news')
      const data = await res.json()
      if (!res.ok) {
        setNewsError(data.error || '获取行业动态失败')
        return
      }
      setNewsData(data)

      // 当日无含事件的卡片（cron 未跑或当日全部检索失败）→ 自动强制重跑前十行业（仅一次）
      const hasCards = (data.cards || []).some((c: IndustryNewsCard) => c.events.length > 0)
      if (!hasCards && !autoTriggeredRef.current) {
        autoTriggeredRef.current = true
        await analyzeNews(undefined, true) // force 重跑
      }
    } catch {
      setNewsError('网络错误')
    } finally {
      setNewsLoading(false)
    }
  }

  /** 即时分析：industries 为空时补齐前十；指定时分析该行业（force 重跑） */
  const analyzeNews = async (industries?: string[], force = false) => {
    setNewsError('')
    try {
      const res = await fetch('/api/statistics/industry-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industries, force }),
      })
      const data = await res.json()
      if (!res.ok) {
        setNewsError(data.error || '行业动态分析失败')
        return
      }
      setNewsData(prev => ({ date: data.date, cards: data.cards || [] }))
    } catch {
      setNewsError('网络错误')
    }
  }

  /** 点击气泡 → 出现"行业动态分析"按钮 → 点击即时分析该行业 */
  const handleAnalyzeIndustry = async (industry: string) => {
    setAnalyzingIndustry(industry)
    await analyzeNews([industry], true)
    setAnalyzingIndustry(null)
  }

  useEffect(() => {
    if (status !== 'authenticated') return
    fetchIndustryNews()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-primary flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (status !== 'authenticated') {
    return null
  }

  // 行业图谱气泡
  const maxCount = industryData?.industries?.[0]?.count || 1
  const getBubbleSize = (count: number) => {
    const minSize = 60
    const maxSize = 140
    return minSize + (count / maxCount) * (maxSize - minSize)
  }
  const getBubbleColor = (count: number, index: number) => {
    const colors = [
      'from-primary-400 to-primary-600',
      'from-blue-400 to-blue-600',
      'from-purple-400 to-purple-600',
      'from-emerald-400 to-emerald-600',
      'from-rose-400 to-rose-600',
      'from-amber-400 to-amber-600',
      'from-cyan-400 to-cyan-600',
      'from-indigo-400 to-indigo-600',
    ]
    return colors[index % colors.length]
  }

  // ── 行业动态卡片筛选逻辑 ──
  // 未点气泡：显示前十行业的动态卡片；点了气泡：只显示该行业卡片
  const topIndustries = newsData?.topIndustries || []
  const newsCards = newsData?.cards || []
  const visibleCards = selectedIndustry
    ? newsCards.filter(c => c.industry === selectedIndustry)
    : (() => {
        // 前十行业优先按排名排序；缓存里不在前十的（旧数据）也显示在后
        const byIndustry = new Map(newsCards.map(c => [c.industry, c]))
        const ordered: IndustryNewsCard[] = []
        topIndustries.forEach(ind => {
          const c = byIndustry.get(ind)
          if (c) { ordered.push(c); byIndustry.delete(ind) }
        })
        return [...ordered, ...Array.from(byIndustry.values())]
      })()

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">统计分析</h1>
            <p className="text-sm text-gray-500 mt-1">行业图谱与行业动态分析</p>
          </div>
          {/* 年份筛选 */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">年份筛选</span>
            <select
              value={selectedYear}
              onChange={(e) => {
                const y = parseInt(e.target.value, 10)
                setSelectedYear(y)
                setSelectedIndustry(null)
              }}
              className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-400 focus:border-primary-400"
            >
              {(industryData?.years || [selectedYear]).map(y => (
                <option key={y} value={y}>{y} 年</option>
              ))}
            </select>
          </div>
        </div>

        {/* 双列布局 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ═══ 左侧：行业图谱 ═══ */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">行业图谱</h2>
              <span className="text-xs text-gray-400">
                {industryData ? `共 ${industryData.totalIndustries} 个行业 · ${industryData.totalProjects} 个项目` : ''}
              </span>
            </div>

            {industryLoading && (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                <span className="ml-3 text-sm text-gray-500">加载中...</span>
              </div>
            )}

            {industryError && (
              <div className="py-10 text-center">
                <p className="text-sm text-danger-600">{industryError}</p>
              </div>
            )}

            {!industryLoading && !industryError && industryData && industryData.industries.length === 0 && (
              <div className="py-10 text-center">
                <p className="text-sm text-gray-400">{selectedYear} 年暂无项目数据</p>
              </div>
            )}

            {!industryLoading && !industryError && industryData && industryData.industries.length > 0 && (
              <>
                {/* 气泡图 */}
                <div className="flex flex-wrap gap-3 justify-center items-center min-h-[280px] py-4">
                  {industryData.industries.map((ind, idx) => {
                    const size = getBubbleSize(ind.count)
                    const isSelected = selectedIndustry === ind.industry
                    const isTop = idx < 10
                    return (
                      <button
                        key={ind.industry}
                        onClick={() => setSelectedIndustry(isSelected ? null : ind.industry)}
                        className={`relative rounded-full bg-gradient-to-br ${getBubbleColor(ind.count, idx)} ${isSelected ? 'ring-4 ring-offset-2 ring-primary-300 scale-110' : 'hover:scale-105'} flex flex-col items-center justify-center transition-all shadow-md`}
                        style={{ width: `${size}px`, height: `${size}px` }}
                        title={`${ind.industry}：${ind.count} 个项目`}
                      >
                        <span className="text-white font-bold text-sm px-2 text-center leading-tight">
                          {ind.industry.length > 8 ? ind.industry.substring(0, 7) + '…' : ind.industry}
                        </span>
                        <span className="text-white/90 text-xl font-bold mt-1">{ind.count}</span>
                        {isTop && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-400 border-2 border-white text-[9px] font-bold text-amber-900 flex items-center justify-center" title="项目数量前十">
                            {idx + 1}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* 选中行业：项目列表 + 行业动态分析按钮 */}
                {selectedIndustry && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-gray-700">
                        {selectedIndustry} · 项目列表
                      </h3>
                      <div className="flex items-center gap-2">
                        {/* ═══ 行业动态分析按钮（点击气泡后出现） ═══ */}
                        <button
                          onClick={() => handleAnalyzeIndustry(selectedIndustry)}
                          disabled={analyzingIndustry !== null}
                          className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-primary-600 text-white text-xs font-bold rounded-lg hover:from-indigo-600 hover:to-primary-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-500/20 transition-all"
                        >
                          {analyzingIndustry === selectedIndustry ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="animate-spin inline-block w-3 h-3 border-b-2 border-white rounded-full"></span>
                              动态收集中...
                            </span>
                          ) : (
                            '⚡ 行业动态分析'
                          )}
                        </button>
                        <button
                          onClick={() => setSelectedIndustry(null)}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          收起
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {industryData.industries.find(i => i.industry === selectedIndustry)?.projects.map(p => (
                        <div key={p.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-gray-900 truncate">{p.name}</span>
                            <span className="text-xs text-gray-400 flex-shrink-0">{stageLabels[p.followStage] || p.followStage}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {p.financingRound && <span className="text-xs text-primary-600">{p.financingRound}</span>}
                            {p.totalAmount && <span className="text-xs text-gray-500">{p.totalAmount}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 图例 */}
                <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                  <span>气泡大小 = 项目数量 · 角标 = 前十行业</span>
                  <span>点击气泡查看项目列表与动态分析</span>
                </div>
              </>
            )}
          </div>

          {/* ═══ 右侧：行业动态 ═══ */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  行业动态{selectedIndustry ? ` · ${selectedIndustry}` : ''}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {newsData?.date
                    ? `${newsData.date} · 每日 04:00 自动收集${selectedIndustry ? ' · 点击气泡即时分析' : ' 前十行业'}`
                    : '每日 04:00 自动收集前十行业动态'}
                </p>
              </div>
              {!selectedIndustry && (
                <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600 text-[10px] font-bold">
                  AI HARNESS
                </span>
              )}
            </div>

            {/* 加载态 */}
            {newsLoading && (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                <span className="mt-3 text-sm text-gray-500">加载行业动态...</span>
              </div>
            )}

            {/* 即时分析中（单行业） */}
            {!newsLoading && analyzingIndustry && (
              <div className="mb-4 px-4 py-3 rounded-xl bg-gradient-to-r from-indigo-50 to-primary-50 border border-indigo-100 flex items-center gap-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-500 flex-shrink-0"></div>
                <div className="text-sm text-indigo-700">
                  正在收集「{analyzingIndustry}」今日动态（联网检索 + AI 分析）...
                  <span className="block text-xs text-indigo-400 mt-0.5">约需 20-40 秒</span>
                </div>
              </div>
            )}

            {/* 错误 */}
            {!newsLoading && newsError && (
              <div className="py-10 text-center">
                <p className="text-sm text-danger-600">{newsError}</p>
                <button
                  onClick={() => fetchIndustryNews()}
                  className="mt-3 px-3 py-1.5 bg-primary-50 text-primary-700 text-xs rounded-lg hover:bg-primary-100"
                >
                  重试
                </button>
              </div>
            )}

            {/* 卡片列表 */}
            {!newsLoading && !newsError && visibleCards.length === 0 && (
              <div className="py-10 text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500 mb-1">今日暂无行业动态</p>
                <p className="text-xs text-gray-400 mb-3">
                  {topIndustries.length > 0
                    ? '点击左侧行业气泡，再点「行业动态分析」可即时收集'
                    : '暂无项目行业数据，请先创建项目'}
                </p>
                {topIndustries.length > 0 && (
                  <button
                    onClick={() => analyzeNews()}
                    className="px-3 py-1.5 bg-primary-500 text-white text-xs rounded-lg hover:bg-primary-600"
                  >
                    收集前十行业动态
                  </button>
                )}
              </div>
            )}

            {!newsLoading && !newsError && visibleCards.length > 0 && (
              <div className="space-y-4 max-h-[640px] overflow-y-auto pr-1">
                {visibleCards.map(card => (
                  <IndustryNewsCardView key={card.industry} card={card} highlight={card.industry === selectedIndustry} />
                ))}
              </div>
            )}

            {/* 底部说明 */}
            {!newsLoading && visibleCards.length > 0 && (
              <div className="mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-400 leading-relaxed">
                事件类型：竞品融资 · 产品发布 · 技术突破 · 人员变更 · 合作 · 政策。数据由 AI 联网检索生成，
                点击卡片内引用来源可溯源。
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

// ── 行业动态卡片组件 ──

function IndustryNewsCardView({ card, highlight }: { card: IndustryNewsCard; highlight?: boolean }) {
  const [showCitations, setShowCitations] = useState(false)

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        highlight
          ? 'border-indigo-300 bg-indigo-50/30 ring-1 ring-indigo-200'
          : 'border-gray-100 bg-white hover:border-primary-200'
      }`}
    >
      {/* 卡片头：行业名 + 事件数 + 分析时间 */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${card.events.length > 0 ? 'bg-emerald-500' : 'bg-gray-300'}`} />
          <h3 className="text-sm font-bold text-gray-900 truncate">{card.industry}</h3>
          {card.events.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-600 text-[10px] font-bold flex-shrink-0">
              今日 {card.events.length} 件事
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-400 flex-shrink-0">
          {new Date(card.analyzedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新
        </span>
      </div>

      {/* 事件列表 */}
      {card.events.length > 0 ? (
        <div className="space-y-2">
          {card.events.map((e, i) => (
            <div key={i} className="flex gap-2.5 items-start">
              <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold mt-0.5 ${EVENT_TYPE_STYLES[e.type] || 'bg-gray-100 text-gray-600'}`}>
                {e.type}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-800 leading-snug">
                  {e.title}
                  <span className="ml-1.5 text-xs font-normal text-gray-400">{e.company}</span>
                </p>
                {e.detail && <p className="text-xs text-gray-500 leading-relaxed mt-0.5">{e.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400 py-2">{card.note || '今日暂无重要动态'}</p>
      )}

      {/* 引用来源（可点击溯源） */}
      {card.citations.length > 0 && (
        <div className="mt-3 pt-2 border-t border-gray-50">
          <button
            onClick={() => setShowCitations(!showCitations)}
            className="text-[11px] text-gray-400 hover:text-primary-600 transition-colors"
          >
            来源（{card.citations.length}）{showCitations ? ' ▲' : ' ▼'}
          </button>
          {showCitations && (
            <div className="mt-1.5 space-y-1">
              {card.citations.map((c, i) => (
                <a
                  key={i}
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[11px] text-primary-600 hover:text-primary-800 hover:underline break-all"
                >
                  <span className="w-4 h-4 rounded bg-primary-50 text-primary-500 text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                    {i + 1}
                  </span>
                  <span className="truncate">{c.label}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
