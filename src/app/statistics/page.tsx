'use client'

import { useState, useEffect } from 'react'
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

interface HeatItem {
  industry: string
  financingCount: number
  totalAmount: string
  heatLevel: number
  notableCompanies: string
  summary: string
}

interface HeatmapData {
  year: number
  years: number[]
  heatData: HeatItem[]
  totalIndustries?: number
  message?: string
}

const stageLabels: Record<string, string> = {
  INITIAL_TALK: '初聊',
  PRE_DD: 'PreDD',
  PROJECT_INITIATION: '立项',
  DUE_DILIGENCE: '尽调',
  CLOSING: '交割',
  POST_INVESTMENT: '投后',
}

// 热度等级颜色映射
const heatColors: Record<number, { bg: string; text: string; label: string }> = {
  5: { bg: 'bg-red-500', text: 'text-white', label: '极热' },
  4: { bg: 'bg-orange-500', text: 'text-white', label: '热门' },
  3: { bg: 'bg-amber-400', text: 'text-white', label: '正常' },
  2: { bg: 'bg-yellow-300', text: 'text-gray-800', label: '较冷' },
  1: { bg: 'bg-blue-300', text: 'text-gray-800', label: '冷门' },
  0: { bg: 'bg-gray-200', text: 'text-gray-500', label: '无数据' },
}

export default function StatisticsPage() {
  const { status } = useSession()
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [industryData, setIndustryData] = useState<IndustryMapData | null>(null)
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null)
  const [industryLoading, setIndustryLoading] = useState(false)
  const [heatmapLoading, setHeatmapLoading] = useState(false)
  const [industryError, setIndustryError] = useState('')
  const [heatmapError, setHeatmapError] = useState('')
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null)

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

  const fetchHeatmap = async (year: number) => {
    setHeatmapLoading(true)
    setHeatmapError('')
    try {
      const res = await fetch(`/api/statistics/financing-heatmap?year=${year}`)
      const data = await res.json()
      if (!res.ok) {
        setHeatmapError(data.error || '获取融资热点失败')
        return
      }
      setHeatmapData(data)
    } catch {
      setHeatmapError('网络错误')
    } finally {
      setHeatmapLoading(false)
    }
  }

  // 自动触发融资热点图获取（用户点击"检索融资信息"按钮时触发）
  useEffect(() => {
    if (status !== 'authenticated') return
    if (heatmapData === null && !heatmapLoading) {
      // 不自动获取，等待用户点击
    }
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

  // 行业图谱气泡大小计算
  const maxCount = industryData?.industries?.[0]?.count || 1
  const getBubbleSize = (count: number) => {
    const minSize = 60
    const maxSize = 140
    return minSize + (count / maxCount) * (maxSize - minSize)
  }

  // 气泡颜色（按数量梯度）
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">统计分析</h1>
            <p className="text-sm text-gray-500 mt-1">行业图谱与融资热度分析</p>
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
                setHeatmapData(null)
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
                      </button>
                    )
                  })}
                </div>

                {/* 选中行业的项目列表 */}
                {selectedIndustry && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-gray-700">
                        {selectedIndustry} · 项目列表
                      </h3>
                      <button
                        onClick={() => setSelectedIndustry(null)}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        收起
                      </button>
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
                  <span>气泡大小 = 项目数量</span>
                  <span>点击气泡查看项目列表</span>
                </div>
              </>
            )}
          </div>

          {/* ═══ 右侧：融资热点图 ═══ */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">融资热点图</h2>
              <button
                onClick={() => fetchHeatmap(selectedYear)}
                disabled={heatmapLoading || !industryData?.industries.length}
                className="px-3 py-1.5 bg-primary-500 text-white text-xs font-medium rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {heatmapLoading ? '检索中...' : heatmapData ? '重新检索' : '检索融资信息'}
              </button>
            </div>

            {heatmapLoading && (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                <span className="mt-3 text-sm text-gray-500">正在通过 AI 检索外网融资信息...</span>
                <span className="mt-1 text-xs text-gray-400">这可能需要 10-30 秒</span>
              </div>
            )}

            {!heatmapLoading && heatmapError && (
              <div className="py-10 text-center">
                <p className="text-sm text-danger-600">{heatmapError}</p>
                <button
                  onClick={() => fetchHeatmap(selectedYear)}
                  className="mt-3 px-3 py-1.5 bg-primary-50 text-primary-700 text-xs rounded-lg hover:bg-primary-100"
                >
                  重试
                </button>
              </div>
            )}

            {!heatmapLoading && !heatmapError && !heatmapData && (
              <div className="py-10 text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500 mb-1">点击"检索融资信息"按钮</p>
                <p className="text-xs text-gray-400">AI 将检索 {selectedYear} 年各行业的外部融资数据</p>
              </div>
            )}

            {!heatmapLoading && !heatmapError && heatmapData && heatmapData.heatData.length === 0 && (
              <div className="py-10 text-center">
                <p className="text-sm text-gray-400">{heatmapData.message || '暂无融资数据'}</p>
              </div>
            )}

            {!heatmapLoading && !heatmapError && heatmapData && heatmapData.heatData.length > 0 && (
              <>
                {/* 热力图网格 */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {heatmapData.heatData.map(item => {
                    const color = heatColors[item.heatLevel] || heatColors[0]
                    return (
                      <div
                        key={item.industry}
                        className={`relative rounded-xl ${color.bg} ${color.text} p-4 overflow-hidden transition-all hover:scale-[1.02] cursor-default`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <span className="font-bold text-sm leading-tight">
                            {item.industry.length > 10 ? item.industry.substring(0, 9) + '…' : item.industry}
                          </span>
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-white/20">
                            {color.label}
                          </span>
                        </div>
                        <div className="text-2xl font-bold mb-1">{item.financingCount}</div>
                        <div className="text-xs opacity-90">融资事件</div>
                        <div className="text-xs opacity-75 mt-1">{item.totalAmount}</div>
                      </div>
                    )
                  })}
                </div>

                {/* 详细信息列表 */}
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {heatmapData.heatData.map(item => (
                    <div key={item.industry} className="px-3 py-2 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-900">{item.industry}</span>
                        <span className="text-xs text-gray-400">
                          代表公司：{item.notableCompanies}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">{item.summary}</p>
                    </div>
                  ))}
                </div>

                {/* 图例 */}
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-3 flex-wrap text-xs text-gray-400">
                    <span>热度：</span>
                    {[5, 4, 3, 2, 1].map(level => (
                      <div key={level} className="flex items-center gap-1">
                        <div className={`w-3 h-3 rounded ${heatColors[level].bg}`}></div>
                        <span>{heatColors[level].label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
