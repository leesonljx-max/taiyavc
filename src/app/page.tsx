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
}

interface DashboardData {
  stats: {
    totalProjects: number
    weeklyNew: number
    initiated: number
    invested: number
  }
  weekStart: string
  weeklyProjects: WeeklyProject[]
}

export default function HomePage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboard()
  }, [])

  const fetchDashboard = async () => {
    try {
      const response = await fetch('/api/dashboard')
      const result = await response.json()
      if (result.stats) {
        setData(result)
      }
    } catch (error) {
      console.error('Failed to fetch dashboard:', error)
    }
    setLoading(false)
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }

  const stats = [
    {
      label: '项目库',
      value: data?.stats?.totalProjects ?? 0,
      icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
      gradient: 'from-primary-400 to-primary-600',
      shadow: 'shadow-primary-500/30',
      bg: 'bg-primary-50',
    },
    {
      label: '本周新增',
      value: data?.stats?.weeklyNew ?? 0,
      icon: 'M12 4v16m8-8H4',
      gradient: 'from-success-400 to-success-600',
      shadow: 'shadow-success-500/30',
      bg: 'bg-success-50',
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
      label: '已投项目',
      value: data?.stats?.invested ?? 0,
      icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2V9a2 2 0 00-2-2H9a2 2 0 00-2 2v10a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
      gradient: 'from-primary-500 to-primary-700',
      shadow: 'shadow-primary-600/30',
      bg: 'bg-primary-50',
    },
  ]

  return (
    <DashboardLayout title="首页" subtitle="投资组合总览与本周动态">
      {/* Stats Cards */}
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

      {/* Weekly New Projects with AI Cards */}
      <div className="bg-gradient-card rounded-2xl shadow-sm border border-primary-100 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-gray-900">本周新增项目</h2>
            {data && (
              <p className="text-sm text-gray-500 mt-0.5">
                统计周期：自 {formatDate(data.weekStart)} 起每周一 12:00 更新
              </p>
            )}
          </div>
          <Link
            href="/projects/new"
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl text-sm font-medium hover:from-primary-600 hover:to-primary-700 transition-all-smooth shadow-md shadow-primary-500/30"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新建项目
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : !data || data.weeklyProjects.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-gray-300 text-5xl mb-3">📋</div>
            <p className="text-gray-500">本周暂无新增项目</p>
          </div>
        ) : (
          <div className="space-y-6">
            {data.weeklyProjects.map((project) => (
              <div
                key={project.id}
                className="bg-white rounded-2xl border border-primary-100 overflow-hidden hover:shadow-md transition-all-smooth"
              >
                {/* Project Header */}
                <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-primary-50 to-transparent border-b border-primary-50">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/projects/${project.id}`}
                      className="font-bold text-gray-900 hover:text-primary-600 transition-colors"
                    >
                      {project.name}
                    </Link>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${followStageColors[project.followStage]}`}>
                      {followStageLabels[project.followStage]}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>{project.companyFullName || '未填写公司名'}</span>
                    <span>{project.industry || '未填写行业'}</span>
                    <span>{formatDate(project.createdAt)}</span>
                  </div>
                </div>

                {/* AI Card Content */}
                {project.aiCard ? (
                  <div className="p-5">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Highlights */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-2 h-2 bg-success-500 rounded-full"></div>
                          <span className="text-sm font-semibold text-success-700">投资亮点</span>
                        </div>
                        {project.aiCard.highlights?.map((item, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm text-gray-600">
                            <span className="text-success-400 mt-0.5 flex-shrink-0">•</span>
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>

                      {/* Barriers */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-2 h-2 bg-primary-500 rounded-full"></div>
                          <span className="text-sm font-semibold text-primary-700">核心壁垒</span>
                        </div>
                        {project.aiCard.barriers?.map((item, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm text-gray-600">
                            <span className="text-primary-400 mt-0.5 flex-shrink-0">•</span>
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>

                      {/* Risks */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-2 h-2 bg-warning-500 rounded-full"></div>
                          <span className="text-sm font-semibold text-warning-700">风险提示</span>
                        </div>
                        {project.aiCard.risks?.map((item, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm text-gray-600">
                            <span className="text-warning-400 mt-0.5 flex-shrink-0">•</span>
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-5">
                    <Link
                      href={`/projects/${project.id}`}
                      className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-primary-600 transition-colors py-4"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      前往项目详情页生成 AI 画板
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
