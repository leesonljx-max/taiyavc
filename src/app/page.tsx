'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import DashboardLayout from '@/components/DashboardLayout'
import { followStageLabels, followStageColors, type FollowStage } from './projects/types'

interface Project {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  followStage: FollowStage
  status: string
  totalAmount: number
  raisedAmount: number
  targetDate: string
  createdAt: string
}

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchProjects()
  }, [])

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects')
      const data = await response.json()
      setProjects(data.projects || [])
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    }
    setLoading(false)
  }

  const totalProjects = projects.length
  const totalAmount = projects.reduce((sum, p) => sum + p.totalAmount, 0)
  const totalRaised = projects.reduce((sum, p) => sum + p.raisedAmount, 0)
  const activeProjects = projects.filter(p => p.status === 'ACTIVE').length

  const stageStats = Object.keys(followStageLabels).map(stage => ({
    stage: stage as FollowStage,
    label: followStageLabels[stage as FollowStage],
    count: projects.filter(p => p.followStage === stage).length,
  }))

  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)

  const percentage = (raised: number, total: number) => {
    return total > 0 ? Math.round((raised / total) * 100) : 0
  }

  return (
    <DashboardLayout title="概览" subtitle="投资组合总览与关键指标">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-card rounded-2xl p-5 shadow-sm border border-primary-100">
          <div className="flex items-center justify-between mb-3">
            <div className="w-11 h-11 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center shadow-md shadow-primary-500/30">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{totalProjects}</div>
          <div className="text-sm text-gray-500 mt-1">总项目数</div>
        </div>

        <div className="bg-gradient-card rounded-2xl p-5 shadow-sm border border-primary-100">
          <div className="flex items-center justify-between mb-3">
            <div className="w-11 h-11 bg-gradient-to-br from-success-400 to-success-600 rounded-xl flex items-center justify-center shadow-md shadow-success-500/30">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900">¥{totalAmount.toLocaleString()}</div>
          <div className="text-sm text-gray-500 mt-1">目标总额（万元）</div>
        </div>

        <div className="bg-gradient-card rounded-2xl p-5 shadow-sm border border-primary-100">
          <div className="flex items-center justify-between mb-3">
            <div className="w-11 h-11 bg-gradient-to-br from-warning-400 to-warning-600 rounded-xl flex items-center justify-center shadow-md shadow-warning-500/30">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900">¥{totalRaised.toLocaleString()}</div>
          <div className="text-sm text-gray-500 mt-1">已筹总额（万元）</div>
        </div>

        <div className="bg-gradient-card rounded-2xl p-5 shadow-sm border border-primary-100">
          <div className="flex items-center justify-between mb-3">
            <div className="w-11 h-11 bg-gradient-to-br from-primary-300 to-primary-500 rounded-xl flex items-center justify-center shadow-md shadow-primary-400/30">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{activeProjects}</div>
          <div className="text-sm text-gray-500 mt-1">活跃项目</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Projects */}
        <div className="lg:col-span-2">
          <div className="bg-gradient-card rounded-2xl shadow-sm border border-primary-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">最新项目</h2>
              <Link href="/projects" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                查看全部 →
              </Link>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              </div>
            ) : recentProjects.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-300 text-5xl mb-3">📋</div>
                <p className="text-gray-500 mb-4">暂无项目</p>
                <Link
                  href="/projects/new"
                  className="inline-block px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-lg text-sm font-medium hover:from-primary-600 hover:to-primary-700 transition-all-smooth"
                >
                  创建第一个项目
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recentProjects.map(project => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="block bg-white rounded-xl p-4 border border-primary-50 hover:border-primary-200 hover:shadow-md transition-all-smooth"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-gray-900 truncate">{project.name}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${followStageColors[project.followStage]}`}>
                            {followStageLabels[project.followStage]}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>{project.companyFullName || '未填写'}</span>
                          <span>{project.industry || '未填写'}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="text-sm font-semibold text-gray-900">¥{project.totalAmount.toLocaleString()}</div>
                        <div className="w-32 mt-1">
                          <div className="w-full bg-primary-50 rounded-full h-1.5">
                            <div
                              className="bg-gradient-to-r from-primary-400 to-primary-600 h-1.5 rounded-full transition-all duration-300"
                              style={{ width: `${percentage(project.raisedAmount, project.totalAmount)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Stage Distribution */}
        <div className="bg-gradient-card rounded-2xl shadow-sm border border-primary-100 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">阶段分布</h2>
          {totalProjects === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">暂无数据</div>
          ) : (
            <div className="space-y-3">
              {stageStats.map(({ stage, label, count }) => {
                const pct = totalProjects > 0 ? (count / totalProjects) * 100 : 0
                return (
                  <div key={stage}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-600">{label}</span>
                      <span className="text-sm font-medium text-gray-900">{count}</span>
                    </div>
                    <div className="w-full bg-primary-50 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-primary-400 to-primary-600 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-primary-50">
            <Link
              href="/projects/new"
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl text-sm font-medium hover:from-primary-600 hover:to-primary-700 transition-all-smooth shadow-md shadow-primary-500/30"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              新建项目
            </Link>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}


