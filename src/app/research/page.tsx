'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/DashboardLayout'

interface PendingItem {
  projectId: string
  projectName: string
  moduleName: string
  missing: string
}

interface ResearchProject {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  companyPosition: string | null
  totalAmount: string
  raisedAmount: string | null
  createdAt: string
  moduleProgress: { total: number; created: number; analyzed: number }
  /** 尽调报告状态：PENDING/RUNNING/COMPLETED/FAILED/null（未生成） */
  ddReportStatus: string | null
  /** 完整尽调报告：COMPLETED 且无资料缺口 */
  hasCompletedReport: boolean
  /** 待补充资料模块数 */
  pendingCount: number
}

interface Stats {
  myProjects: number
  completedReports: number
  pendingItems: PendingItem[]
}

export default function ResearchPage() {
  const router = useRouter()
  const { data: session, status } = useSession()

  const [projects, setProjects] = useState<ResearchProject[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showProjects, setShowProjects] = useState(true)
  const [showPending, setShowPending] = useState(false)

  useEffect(() => {
    if (status === 'loading') return
    if (!session) return

    let cancelled = false
    const controller = new AbortController()

    const fetchProjects = async () => {
      setLoading(true)
      setError('')
      try {
        const response = await fetch('/api/research', { signal: controller.signal })
        const data = await response.json()
        if (!cancelled) {
          if (!response.ok) {
            setError(data.error || '加载失败')
            setProjects([])
          } else {
            setProjects(data.projects || [])
            setStats(data.stats || null)
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        if (!cancelled) {
          setError('网络错误')
        }
        console.error('Failed to fetch research projects:', err)
      }
      if (!cancelled) {
        setLoading(false)
      }
    }

    fetchProjects()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [session, status])

  const handleCardClick = (projectId: string) => {
    router.push(`/research/${projectId}`)
  }

  // 模块进度百分比
  const getProgressPercent = (p: ResearchProject) => {
    if (!p.moduleProgress || p.moduleProgress.total === 0) return 0
    return Math.round((p.moduleProgress.analyzed / p.moduleProgress.total) * 100)
  }

  // 按项目分组的待办
  const pendingByProject = (stats?.pendingItems || []).reduce<Record<string, PendingItem[]>>((acc, item) => {
    if (!acc[item.projectName]) acc[item.projectName] = []
    acc[item.projectName].push(item)
    return acc
  }, {})

  return (
    <DashboardLayout
      title="项目尽调"
      subtitle="尽调阶段项目的尽调报告与模块资料管理"
    >
      {/* ── 三个统计卡片（可点击） ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* 我的尽调项目 */}
        <button
          onClick={() => { setShowProjects(true); setShowPending(false) }}
          className={`text-left rounded-2xl shadow-sm p-5 border transition-all-smooth hover:shadow-md ${
            showProjects ? 'dd-card border-[#b6b1ee] ring-2 ring-[#b6b1ee]/40' : 'dd-card'
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-[#b6b1ee] to-[#8d84e0] rounded-xl flex items-center justify-center shadow-md shadow-[#8d84e0]/30 flex-shrink-0">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-3xl font-bold text-gray-900">{stats?.myProjects ?? '—'}</div>
              <div className="text-sm text-gray-500 mt-0.5">我的尽调项目</div>
            </div>
            <svg className={`w-4 h-4 text-[#8d84e0] transition-transform ${showProjects ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>

        {/* 已生成尽调报告 */}
        <div className="dd-card rounded-2xl shadow-sm p-5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center shadow-md shadow-emerald-500/30 flex-shrink-0">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="text-3xl font-bold text-gray-900">{stats?.completedReports ?? '—'}</div>
              <div className="text-sm text-gray-500 mt-0.5">已生成尽调报告</div>
              <div className="text-xs text-gray-400 mt-0.5">报告完整且无需补充资料</div>
            </div>
          </div>
        </div>

        {/* 待办事项 */}
        <button
          onClick={() => { setShowPending(true); setShowProjects(false) }}
          className={`text-left rounded-2xl shadow-sm p-5 border transition-all-smooth hover:shadow-md ${
            showPending ? 'dd-card border-amber-300 ring-2 ring-amber-200' : 'dd-card'
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="relative w-12 h-12 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl flex items-center justify-center shadow-md shadow-amber-500/30 flex-shrink-0">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {(stats?.pendingItems.length ?? 0) > 0 && (
                <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[20px]">
                  {stats?.pendingItems.length}
                </span>
              )}
            </div>
            <div className="flex-1">
              <div className="text-3xl font-bold text-gray-900">{stats?.pendingItems.length ?? '—'}</div>
              <div className="text-sm text-gray-500 mt-0.5">待办事项</div>
              <div className="text-xs text-gray-400 mt-0.5">各项目需补充的资料</div>
            </div>
            <svg className={`w-4 h-4 text-amber-500 transition-transform ${showPending ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
      </div>

      {/* ── 待办事项面板（点击统计卡展开） ── */}
      {showPending && (
        <div className="dd-card rounded-2xl shadow-sm border p-6 mb-6">
          <h2 className="text-base font-bold text-gray-900 mb-4">待办事项 · 各项目需补充的资料</h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8d84e0]"></div>
            </div>
          ) : !stats || stats.pendingItems.length === 0 ? (
            <div className="py-8 text-center">
              <div className="text-gray-300 text-4xl mb-2">🎉</div>
              <p className="text-sm text-gray-500">所有项目资料齐全，暂无待办事项</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(pendingByProject).map(([projectName, items]) => (
                <div key={projectName} className="rounded-xl border border-amber-100 bg-amber-50/40 overflow-hidden">
                  <div className="px-4 py-2.5 bg-amber-100/60 border-b border-amber-100 flex items-center justify-between">
                    <span className="text-sm font-semibold text-amber-800">{projectName}</span>
                    <span className="text-xs text-amber-600">{items.length} 项待补充</span>
                  </div>
                  <div className="divide-y divide-amber-50">
                    {items.map((item, i) => (
                      <button
                        key={`${item.projectId}-${i}`}
                        onClick={() => handleCardClick(item.projectId)}
                        className="w-full text-left px-4 py-2.5 hover:bg-amber-50/60 transition-colors flex items-start gap-3"
                      >
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded flex-shrink-0 mt-0.5">
                          {item.moduleName}
                        </span>
                        <span className="text-sm text-gray-600 flex-1 line-clamp-2">{item.missing}</span>
                        <svg className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 我的尽调项目列表（长条瘦卡片） ── */}
      {showProjects && (
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-base font-bold text-gray-900">
              我的尽调项目
              <span className="text-sm font-normal text-gray-400 ml-2">{projects.length} 个</span>
            </h2>
            <span className="text-xs text-gray-400">点击卡片进入尽调工作台</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#8d84e0]"></div>
            </div>
          ) : error ? (
            <div className="bg-red-50 rounded-2xl p-8 text-center border border-red-100">
              <p className="text-red-600 mb-2">{error}</p>
              <p className="text-sm text-gray-500">请刷新页面或重新登录后重试</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="dd-card rounded-2xl shadow-sm p-16 text-center border">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#efedfb] flex items-center justify-center">
                <svg className="w-8 h-8 text-[#8d84e0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">暂无尽调阶段项目</h3>
              <p className="text-gray-500 mb-2">项目进入尽调阶段后将自动显示在此列表</p>
              <p className="text-xs text-gray-400">权限说明：投资合伙人可见所有尽调项目，其他角色仅可见自己维护的项目</p>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map(project => {
                const progressPercent = getProgressPercent(project)
                return (
                  <button
                    key={project.id}
                    onClick={() => handleCardClick(project.id)}
                    className="w-full text-left dd-card rounded-xl shadow-sm hover:shadow-md transition-all-smooth border px-4 py-3 flex items-center gap-4 group focus:outline-none focus:ring-2 focus:ring-[#b6b1ee]"
                  >
                    {/* 状态指示灯 */}
                    <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                      <span
                        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                          project.hasCompletedReport
                            ? 'bg-emerald-500 shadow-sm shadow-emerald-300'
                            : project.ddReportStatus === 'RUNNING'
                              ? 'bg-blue-500 animate-pulse'
                              : project.pendingCount > 0
                                ? 'bg-amber-500 shadow-sm shadow-amber-300'
                                : 'bg-gray-300'
                        }`}
                        title={
                          project.hasCompletedReport ? '尽调报告完整'
                            : project.ddReportStatus === 'RUNNING' ? '分析中'
                            : project.pendingCount > 0 ? `${project.pendingCount} 项资料待补充`
                            : '未生成报告'
                        }
                      />
                      {project.hasCompletedReport && (
                        <span className="text-[9px] text-emerald-600 font-medium">完整</span>
                      )}
                    </div>

                    {/* 项目名称 + 公司定位 */}
                    <div className="flex items-center gap-3 min-w-0 w-[38%]">
                      <h3 className="text-sm font-semibold text-gray-900 group-hover:text-[#6f63c9] transition-colors truncate flex-shrink-0">
                        {project.name}
                      </h3>
                      {project.companyPosition && (
                        <span className="text-xs text-gray-500 truncate">
                          {project.companyPosition}
                        </span>
                      )}
                    </div>

                    {/* 融资金额 */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <svg className="w-3.5 h-3.5 text-[#8d84e0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm font-medium text-[#6f63c9] whitespace-nowrap">
                        {project.totalAmount || '-'}
                      </span>
                      {project.pendingCount > 0 && (
                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-medium rounded-full whitespace-nowrap">
                          {project.pendingCount}项待补
                        </span>
                      )}
                    </div>

                    <div className="flex-1"></div>

                    {/* 模块资料更新进度 */}
                    <div className="flex items-center gap-2 flex-shrink-0 w-[200px]">
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        模块 {project.moduleProgress?.analyzed ?? 0}/{project.moduleProgress?.total ?? 9}
                      </span>
                      <div className="flex-1 h-1.5 bg-[#efedfb] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#b6b1ee] to-[#8d84e0] rounded-full transition-all-smooth"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <span className="text-xs text-[#6f63c9] font-medium w-8 text-right">{progressPercent}%</span>
                    </div>

                    {/* 可视化报告入口 */}
                    <span
                      onClick={e => {
                        e.stopPropagation()
                        router.push(`/research/${project.id}/view`)
                      }}
                      className="text-xs text-[#8d84e0] hover:text-[#6f63c9] font-medium cursor-pointer px-2 py-1 rounded hover:bg-[#efedfb] transition-colors flex-shrink-0 whitespace-nowrap"
                    >
                      可视化报告 →
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  )
}
