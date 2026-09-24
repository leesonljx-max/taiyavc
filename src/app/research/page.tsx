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
  /** 尽调工作台：进行中批次徽标（进度/红旗） */
  ddWorkbench: {
    batchId: string
    status: string
    round: string | null
    done: number
    total: number
    redFlags: number
  } | null
  /** 已冻结批次数（历史报告版本） */
  frozenBatchCount: number
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
      {/* ── 四概览卡（设计稿风格：尽调项目 / 进行中批次 / 已冻结批次 / 待决问题） ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {/* 尽调项目（可点击 → 项目列表） */}
        <button
          onClick={() => { setShowProjects(true); setShowPending(false) }}
          className={`text-left rounded-xl border p-4 transition-all hover:shadow-sm ${
            showProjects ? 'bg-blue-50/40 border-blue-300 ring-2 ring-blue-100' : 'bg-white border-gray-100 hover:border-blue-200'
          }`}
        >
          <p className="text-[11px] text-gray-400 font-medium">尽调项目</p>
          <p className="mt-1">
            <span className="text-2xl font-bold text-gray-900">{stats?.myProjects ?? '—'}</span>
            <span className="text-xs text-gray-400 ml-1">深度验证中</span>
          </p>
          <p className="mt-1.5 text-[10px] text-gray-400">点击查看尽调项目队列</p>
        </button>

        {/* 进行中批次 */}
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[11px] text-gray-400 font-medium">进行中批次</p>
          <p className="mt-1">
            <span className="text-2xl font-bold text-gray-900">
              {projects.filter(p => p.ddWorkbench).length}
            </span>
            <span className="text-xs text-gray-400 ml-1">个批次</span>
          </p>
          <p className="mt-1.5 text-[10px] text-gray-400">
            累计红旗 {projects.reduce((s, p) => s + (p.ddWorkbench?.redFlags || 0), 0)} 个待关闭
          </p>
        </div>

        {/* 已冻结批次（投委会材料） */}
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[11px] text-gray-400 font-medium">已冻结批次</p>
          <p className="mt-1">
            <span className="text-2xl font-bold text-gray-900">
              {projects.reduce((s, p) => s + (p.frozenBatchCount || 0), 0)}
            </span>
            <span className="text-xs text-gray-400 ml-1">份投委会材料</span>
          </p>
          <p className="mt-1.5 text-[10px] text-gray-400">完整尽调报告 {stats?.completedReports ?? 0} 份</p>
        </div>

        {/* 待决问题（可点击 → 待办面板） */}
        <button
          onClick={() => { setShowPending(true); setShowProjects(false) }}
          className={`text-left rounded-xl border p-4 transition-all hover:shadow-sm ${
            showPending ? 'bg-amber-50/50 border-amber-300 ring-2 ring-amber-100' : 'bg-white border-gray-100 hover:border-amber-200'
          }`}
        >
          <p className="text-[11px] text-gray-400 font-medium">待决问题</p>
          <p className="mt-1">
            <span className={`text-2xl font-bold ${(stats?.pendingItems.length ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {stats?.pendingItems.length ?? 0}
            </span>
            <span className="text-xs text-gray-400 ml-1">会前关闭</span>
          </p>
          <p className="mt-1.5 text-[10px] text-gray-400">各项目需补充的资料缺口</p>
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
                // 批次状态标签（进行中批次）或冻结徽标
                const wb = project.ddWorkbench
                const batchBadge = wb
                  ? {
                      label: `${wb.status === 'IN_REVIEW' ? '复核中' : '尽调'}${wb.round ? ` · ${wb.round}` : ''} ${wb.done}/${wb.total}`,
                      cls: wb.status === 'IN_REVIEW'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-blue-50 text-blue-700 border-blue-200',
                      title: `尽调批次${wb.round ? `（${wb.round}）` : ''}：${wb.done}/${wb.total} 模块完成${wb.redFlags > 0 ? ` · ${wb.redFlags} 个红旗` : ''}`,
                    }
                  : project.frozenBatchCount > 0
                    ? {
                        label: `❄ 已冻结 ${project.frozenBatchCount} 批`,
                        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                        title: `已冻结 ${project.frozenBatchCount} 批尽调报告（投委会材料）`,
                      }
                    : null
                // 四段分段进度条：优先批次 done/total，回退模块 analyzed/total
                const segTotal = wb?.total || project.moduleProgress?.total || 9
                const segDone = wb?.done ?? project.moduleProgress?.analyzed ?? 0
                const litSegs = Math.round((segDone / Math.max(segTotal, 1)) * 4)
                return (
                  <button
                    key={project.id}
                    onClick={() => handleCardClick(project.id)}
                    className="w-full text-left dd-card rounded-xl shadow-sm hover:shadow-md transition-all-smooth border border-gray-100 px-4 py-3.5 group focus:outline-none focus:ring-2 focus:ring-blue-200 hover:border-blue-200"
                  >
                    {/* 第一行：状态灯 + 项目名 + 定位 | 金额 + 待补 */}
                    <div className="flex items-center gap-3">
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
                            : project.ddReportStatus === 'RUNNING' ? 'AI 分析中'
                            : project.pendingCount > 0 ? `${project.pendingCount} 项资料待补充`
                            : '未生成报告'
                        }
                      />
                      <h3 className="text-sm font-bold text-gray-900 group-hover:text-blue-600 transition-colors truncate flex-shrink-0">
                        {project.name}
                      </h3>
                      {project.companyPosition && (
                        <span className="text-xs text-gray-400 truncate hidden md:block">
                          {project.companyPosition}
                        </span>
                      )}
                      {project.industry && (
                        <span className="px-1.5 py-0.5 bg-slate-50 text-gray-500 text-[10px] rounded whitespace-nowrap flex-shrink-0 hidden lg:inline">
                          {project.industry}
                        </span>
                      )}
                      <div className="flex-1"></div>
                      <span className="text-sm font-bold text-blue-600 whitespace-nowrap">
                        {project.totalAmount || '-'}
                      </span>
                      {project.pendingCount > 0 && (
                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full whitespace-nowrap">
                          {project.pendingCount}项待补
                        </span>
                      )}
                    </div>

                    {/* 第二行：批次状态标签 + 红旗 + 四段分段进度 + 可视化报告入口 */}
                    <div className="mt-2.5 flex items-center gap-3">
                      {batchBadge ? (
                        <span
                          className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold whitespace-nowrap flex-shrink-0 ${batchBadge.cls}`}
                          title={batchBadge.title}
                        >
                          {batchBadge.label}
                          {wb && wb.redFlags > 0 && (
                            <span className="text-red-500 ml-1">⚑{wb.redFlags}</span>
                          )}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-400 text-[10px] font-bold whitespace-nowrap flex-shrink-0">
                          未发起尽调批次
                        </span>
                      )}
                      {/* 四段分段进度条（资料→抽取→复核→冻结 按完成度点亮） */}
                      <div className="flex gap-1 flex-shrink-0" title={`模块完成 ${segDone}/${segTotal}`}>
                        {[0, 1, 2, 3].map(i => (
                          <div
                            key={i}
                            className={`w-7 h-1.5 rounded-full ${i < litSegs ? 'bg-blue-500' : 'bg-gray-200'}`}
                          />
                        ))}
                      </div>
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">
                        {segDone}/{segTotal} 模块
                      </span>
                      <div className="flex-1"></div>
                      <span
                        onClick={e => {
                          e.stopPropagation()
                          router.push(`/research/${project.id}/view`)
                        }}
                        className="text-xs text-gray-400 hover:text-blue-600 font-medium cursor-pointer px-2 py-0.5 rounded hover:bg-blue-50 transition-colors flex-shrink-0 whitespace-nowrap"
                      >
                        可视化报告 →
                      </span>
                    </div>
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
