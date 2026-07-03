'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import DashboardLayout from '@/components/DashboardLayout'
import { followStageLabels, followStageColors, type FollowStage } from './types'

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
  investorCount: number
  investmentCount: number
  createdAt: string
}

const stageCardStyles: Record<FollowStage, string> = {
  INITIAL_TALK: 'from-gray-400 to-gray-500',
  PRE_DD: 'from-blue-400 to-blue-500',
  PROJECT_INITIATION: 'from-purple-400 to-purple-500',
  DUE_DILIGENCE: 'from-amber-400 to-amber-500',
  CLOSING: 'from-emerald-400 to-emerald-500',
  POST_INVESTMENT: 'from-indigo-400 to-indigo-500',
}

export default function ProjectListPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedStage, setSelectedStage] = useState<FollowStage | 'all'>('all')

  useEffect(() => {
    fetchProjects()
  }, [])

  const fetchProjects = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/projects')
      const data = await response.json()
      setProjects(data.projects || [])
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    }
    setLoading(false)
  }

  const filteredProjects = projects.filter(project => {
    const matchesSearch = searchTerm === '' || 
      project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.companyFullName?.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesStage = selectedStage === 'all' || project.followStage === selectedStage
    
    return matchesSearch && matchesStage
  })

  const percentage = (raised: number, total: number) => {
    return total > 0 ? Math.round((raised / total) * 100) : 0
  }

  const stageCount = (stage: FollowStage) =>
    projects.filter(p => p.followStage === stage).length

  return (
    <DashboardLayout
      title="项目管理"
      subtitle="管理和追踪您的投资项目"
      actions={
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 transition-all-smooth shadow-md shadow-primary-500/30 font-medium text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新建项目
        </Link>
      }
    >
      {/* 统计卡片区域 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
        <div className="bg-gradient-card rounded-2xl p-5 shadow-sm border border-primary-100">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-md shadow-primary-500/30">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{projects.length}</div>
              <div className="text-xs text-gray-500">总项目数</div>
            </div>
          </div>
        </div>

        {(Object.keys(followStageLabels) as FollowStage[]).map(stage => (
          <button
            key={stage}
            onClick={() => setSelectedStage(selectedStage === stage ? 'all' : stage)}
            className={`bg-gradient-card rounded-2xl p-5 shadow-sm border transition-all-smooth text-left ${
              selectedStage === stage ? 'border-primary-400 ring-2 ring-primary-200' : 'border-primary-100 hover:border-primary-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${stageCardStyles[stage]} flex items-center justify-center shadow-sm`}>
                <span className="text-white font-bold text-sm">{stageCount(stage)}</span>
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{stageCount(stage)}</div>
                <div className="text-xs text-gray-500">{followStageLabels[stage]}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* 搜索和筛选 */}
      <div className="bg-gradient-card rounded-2xl shadow-sm p-4 mb-6 border border-primary-100">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <svg className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="搜索项目名称或公司全称..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth placeholder-gray-400"
            />
          </div>
          <select
            value={selectedStage}
            onChange={(e) => setSelectedStage(e.target.value as FollowStage | 'all')}
            className="px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth text-gray-700 min-w-[140px]"
          >
            <option value="all">所有阶段</option>
            {Object.entries(followStageLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 项目卡片列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="bg-gradient-card rounded-2xl shadow-sm p-16 text-center border border-primary-100">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">暂无项目</h3>
          <p className="text-gray-500">点击右上角按钮创建第一个投资项目</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredProjects.map(project => {
            const pct = percentage(project.raisedAmount, project.totalAmount)
            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="block bg-gradient-card rounded-2xl shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all-smooth border border-primary-100 overflow-hidden group"
              >
                <div className="p-6">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-3">
                        <h3 className="text-lg font-semibold text-gray-900 group-hover:text-primary-700 transition-colors truncate">
                          {project.name}
                        </h3>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${followStageColors[project.followStage]}`}>
                          {followStageLabels[project.followStage]}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />
                          </svg>
                          <div className="min-w-0">
                            <div className="text-gray-400 text-xs">公司全称</div>
                            <div className="text-gray-900 truncate">{project.companyFullName || '-'}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                          </svg>
                          <div className="min-w-0">
                            <div className="text-gray-400 text-xs">行业</div>
                            <div className="text-gray-900 truncate">{project.industry || '-'}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          <div>
                            <div className="text-gray-400 text-xs">投资人</div>
                            <div className="text-gray-900">{project.investorCount} 人</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                          <div>
                            <div className="text-gray-400 text-xs">投资次数</div>
                            <div className="text-gray-900">{project.investmentCount} 次</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end space-y-2 md:w-56">
                      <div className="text-right">
                        <div className="text-xs text-gray-400">目标金额</div>
                        <div className="text-lg font-semibold text-gray-900">¥{project.totalAmount.toLocaleString()}</div>
                      </div>
                      <div className="w-full">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>已筹 {pct}%</span>
                          <span>¥{project.raisedAmount.toLocaleString()}</span>
                        </div>
                        <div className="w-full bg-primary-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-primary-400 to-primary-600 h-2 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-xs text-gray-400">
                        创建于 {new Date(project.createdAt).toLocaleDateString('zh-CN')}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </DashboardLayout>
  )
}
