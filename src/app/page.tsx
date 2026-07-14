'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import DashboardLayout from '@/components/DashboardLayout'
import { followStageLabels, followStageColors, type FollowStage } from './projects/types'

interface AICardData {
  projectName: string
  highlights: string[]
  barriers: string[]
  risks: string[]
}

interface WeeklyProject {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  followStage: FollowStage
  createdAt: string
  aiCard: AICardData | null
  maintainerName: string
}

interface MaintainerProject {
  id: string
  name: string
  companyPosition: string | null
  industry: string | null
  financingRound: string | null
  totalAmount: string
  followStage: string
}

interface MaintainerStat {
  userId: string
  userName: string
  stageCounts: Record<string, number>
  projects: MaintainerProject[]
}

interface DashboardData {
  stats: {
    weeklyNew: number
    preDD: number
    initiated: number
    dueDiligence: number
  }
  weekStart: string
  weeklyProjects: WeeklyProject[]
  maintainerStats: MaintainerStat[]
}

export default function HomePage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboard()
  }, [])

  const fetchDashboard = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/dashboard`)
      const result = await response.json()
      if (result.stats) {
        setData(result)
      }
    } catch (error) {
      console.error('Failed to fetch dashboard:', error)
    }
    setLoading(false)
  }

  // 四个统计卡片：本周新增 / PreDD / 立项项目 / 尽调项目
  // 统计口径：本周更改为对应阶段的项目数（本周新增=本周新建项目数）
  const stats = [
    {
      label: '本周新增',
      value: data?.stats?.weeklyNew ?? 0,
      icon: 'M12 4v16m8-8H4',
      gradient: 'from-success-400 to-success-600',
      shadow: 'shadow-success-500/30',
      bg: 'bg-success-50',
    },
    {
      label: 'PreDD',
      value: data?.stats?.preDD ?? 0,
      icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
      gradient: 'from-blue-400 to-blue-600',
      shadow: 'shadow-blue-500/30',
      bg: 'bg-blue-50',
    },
    {
      label: '立项项目',
      value: data?.stats?.initiated ?? 0,
      icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
      gradient: 'from-warning-400 to-warning-600',
      shadow: 'shadow-warning-500/30',
      bg: 'bg-warning-50',
    },
    {
      label: '尽调项目',
      value: data?.stats?.dueDiligence ?? 0,
      icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
      gradient: 'from-amber-400 to-amber-600',
      shadow: 'shadow-amber-500/30',
      bg: 'bg-amber-50',
    },
  ]

  return (
    <DashboardLayout title="首页" subtitle="本周项目动态总览">
      {/* Stats Cards - 四个本周统计卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-gradient-card rounded-2xl p-5 shadow-sm border border-primary-100 hover:shadow-md transition-all-smooth"
          >
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 bg-gradient-to-br ${stat.gradient} rounded-xl flex items-center justify-center shadow-md ${stat.shadow} flex-shrink-0`}>
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={stat.icon} />
                </svg>
              </div>
              <div>
                <div className="text-3xl font-bold text-gray-900">{stat.value}</div>
                <div className="text-sm text-gray-500">{stat.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 本周新增项目（按维护人分组） */}
      <div className="bg-gradient-card rounded-2xl shadow-sm border border-primary-100 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-gray-900">本周新增项目</h2>
            {data && (
              <p className="text-sm text-gray-500 mt-0.5">
                共 {data.maintainerStats?.length || 0} 位维护人
                {data.weeklyProjects.length > 0 && ` · 本周新增 ${data.weeklyProjects.length} 个`}
              </p>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : !data || !data.maintainerStats || data.maintainerStats.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-gray-300 text-5xl mb-3">📋</div>
            <p className="text-gray-500">本周暂无项目数据</p>
          </div>
        ) : (
          <div className="space-y-4">
            {data.maintainerStats.map((m) => (
              <div
                key={m.userId}
                className="bg-white rounded-2xl border border-primary-100 overflow-hidden hover:shadow-md transition-all-smooth"
              >
                <div className="flex flex-col lg:flex-row">
                  {/* 左侧：姓名 + 各阶段项目数量 */}
                  <div className="lg:w-64 lg:flex-shrink-0 p-5 border-b lg:border-b-0 lg:border-r border-primary-100 bg-gradient-to-br from-primary-50/50 to-transparent">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-md shadow-primary-500/30">
                        <span className="text-white font-bold text-sm">
                          {m.userName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900 text-sm">{m.userName}</div>
                        <div className="text-xs text-gray-500">共 {m.projects.length} 个项目</div>
                      </div>
                    </div>

                    {/* 各阶段项目数量（本周变更统计） */}
                    <div className="text-xs text-gray-400 mb-1.5">本周阶段变更</div>
                    <div className="space-y-2">
                      {[
                        { key: 'INITIAL_TALK', label: '初聊', color: 'bg-gray-100 text-gray-700' },
                        { key: 'PRE_DD', label: 'PreDD', color: 'bg-blue-100 text-blue-700' },
                        { key: 'PROJECT_INITIATION', label: '立项', color: 'bg-purple-100 text-purple-700' },
                        { key: 'DUE_DILIGENCE', label: '尽调', color: 'bg-amber-100 text-amber-700' },
                        { key: 'AGREEMENT', label: '协议', color: 'bg-teal-100 text-teal-700' },
                        { key: 'CLOSING', label: '交割', color: 'bg-emerald-100 text-emerald-700' },
                      ].map(stage => (
                        <div key={stage.key} className="flex items-center justify-between">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${stage.color}`}>
                            {stage.label}
                          </span>
                          <span className="text-sm font-semibold text-gray-900">
                            {m.stageCounts[stage.key] || 0}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 右侧：项目简要信息小卡片（按阶段分两组展示） */}
                  <div className="flex-1 p-5">
                    {m.projects.length === 0 ? (
                      <div className="text-center py-8 text-sm text-gray-400">暂无项目</div>
                    ) : (
                      <div className="space-y-4">
                        {(() => {
                          // 按阶段分组：上面 初聊/PreDD，下面 立项/尽调/交割（投后不计入）
                          const earlyStages = ['INITIAL_TALK', 'PRE_DD']
                          const lateStages = ['PROJECT_INITIATION', 'DUE_DILIGENCE', 'AGREEMENT', 'CLOSING']
                          const earlyProjects = m.projects.filter(p => earlyStages.includes(p.followStage))
                          const lateProjects = m.projects.filter(p => lateStages.includes(p.followStage))

                          const renderProjectCard = (project: MaintainerProject) => (
                            <Link
                              key={project.id}
                              href={`/projects/${project.id}`}
                              className="block bg-white rounded-xl p-3 border border-primary-50 hover:border-primary-200 hover:shadow-md transition-all-smooth"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <h4 className="font-semibold text-gray-900 text-sm truncate hover:text-primary-700 transition-colors">
                                  {project.name}
                                </h4>
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap flex-shrink-0 ${followStageColors[project.followStage as FollowStage] || 'bg-gray-100 text-gray-700'}`}>
                                  {followStageLabels[project.followStage as FollowStage] || project.followStage}
                                </span>
                              </div>
                              <div className="space-y-1 text-xs text-gray-500">
                                {project.companyPosition && (
                                  <div className="truncate">
                                    <span className="text-gray-400">定位：</span>
                                    {project.companyPosition}
                                  </div>
                                )}
                                <div className="flex items-center gap-2 flex-wrap">
                                  {project.industry && (
                                    <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                                      {project.industry}
                                    </span>
                                  )}
                                  {project.financingRound && (
                                    <span className="text-gray-600">{project.financingRound}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 text-primary-700 font-medium">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  {project.totalAmount ? project.totalAmount : '未填写'}
                                </div>
                              </div>
                            </Link>
                          )

                          const renderGroup = (title: string, subtitle: string, containerClass: string, titleClass: string, projects: MaintainerProject[]) => {
                            if (projects.length === 0) return null
                            return (
                              <div className={`rounded-xl border p-4 ${containerClass}`}>
                                <div className="flex items-center gap-2 mb-3">
                                  <span className={`text-xs font-semibold ${titleClass}`}>{title}</span>
                                  <span className="text-xs text-gray-400">{subtitle} · {projects.length} 个</span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                  {projects.map(renderProjectCard)}
                                </div>
                              </div>
                            )
                          }

                          return (
                            <>
                              {renderGroup(
                                '初聊 · PreDD',
                                '早期跟进',
                                'bg-gray-50/50 border-gray-200',
                                'text-gray-600',
                                earlyProjects
                              )}
                              {renderGroup(
                                '立项 · 尽调 · 交割',
                                '深度推进',
                                'bg-purple-50/30 border-purple-200',
                                'text-purple-700',
                                lateProjects
                              )}
                              {/* 两组都为空时的兜底（理论上不会触发，因为 m.projects.length > 0） */}
                              {earlyProjects.length === 0 && lateProjects.length === 0 && (
                                <div className="text-center py-8 text-sm text-gray-400">暂无项目</div>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
