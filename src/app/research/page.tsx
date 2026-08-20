'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/DashboardLayout'

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
}

export default function ResearchPage() {
  const router = useRouter()
  const { data: session, status } = useSession()

  const [projects, setProjects] = useState<ResearchProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  return (
    <DashboardLayout
      title="投研分析"
      subtitle="尽调阶段项目的投研模块分析"
    >
      {/* 顶部说明条 */}
      <div className="bg-gradient-card rounded-2xl shadow-sm p-4 mb-6 border border-primary-100">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <svg className="w-5 h-5 text-primary-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span>展示当前处于「尽调阶段」的项目，点击卡片进入投研分析工作台</span>
        </div>
      </div>

      {/* 加载中 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      ) : error ? (
        <div className="bg-red-50 rounded-2xl p-8 text-center border border-red-100">
          <p className="text-red-600 mb-2">{error}</p>
          <p className="text-sm text-gray-500">请刷新页面或重新登录后重试</p>
        </div>
      ) : projects.length === 0 ? (
        /* 空状态 */
        <div className="bg-gradient-card rounded-2xl shadow-sm p-16 text-center border border-primary-100">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">暂无尽调阶段项目</h3>
          <p className="text-gray-500 mb-2">项目进入尽调阶段后将自动显示在此列表</p>
          <p className="text-xs text-gray-400">
            权限说明：投资合伙人可见所有尽调项目，其他角色仅可见自己维护的项目
          </p>
        </div>
      ) : (
        /* 项目卡片列表 */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map(project => {
            const progressPercent = getProgressPercent(project)
            return (
              <button
                key={project.id}
                onClick={() => handleCardClick(project.id)}
                className="text-left bg-gradient-card rounded-2xl shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all-smooth border border-primary-100 overflow-hidden group focus:outline-none focus:ring-2 focus:ring-primary-300"
              >
                <div className="p-5">
                  {/* 第一行：项目名称 + 公司定位 */}
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <h3 className="text-base font-semibold text-gray-900 group-hover:text-primary-700 transition-colors truncate">
                      {project.name}
                    </h3>
                    {project.companyPosition && (
                      <span className="text-xs text-gray-500 truncate flex-1 min-w-0">
                        {project.companyPosition}
                      </span>
                    )}
                  </div>

                  {/* 第二行：关键信息 */}
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-400 text-xs flex-shrink-0">公司全称</span>
                      <span className="text-gray-900 truncate text-right">{project.companyFullName || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-400 text-xs flex-shrink-0">行业/赛道</span>
                      <span className="text-gray-900 truncate text-right">{project.industry || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-400 text-xs flex-shrink-0">融资金额</span>
                      <span className="text-primary-700 font-medium text-right">
                        {project.totalAmount || '-'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-400 text-xs flex-shrink-0">累计融资金额</span>
                      <span className="text-gray-900 text-right">
                        {project.raisedAmount || '-'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-400 text-xs flex-shrink-0">创建时间</span>
                      <span className="text-gray-900 text-right">
                        {new Date(project.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                  </div>

                  {/* 模块进度条 */}
                  <div className="mt-4 pt-3 border-t border-primary-50">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-gray-500">模块进度</span>
                      <div className="flex items-center gap-2">
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/research/${project.id}/view`)
                          }}
                          className="text-xs text-primary-600 hover:text-primary-800 font-medium cursor-pointer px-1.5 py-0.5 rounded hover:bg-primary-50 transition-colors"
                        >
                          可视化报告 →
                        </span>
                        <span className="text-xs text-gray-700 font-medium">
                          已分析 {project.moduleProgress?.analyzed ?? 0} / 已创建 {project.moduleProgress?.created ?? 0} / 共 {project.moduleProgress?.total ?? 9} 个
                        </span>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-primary-50 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary-500 to-primary-600 rounded-full transition-all-smooth"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </DashboardLayout>
  )
}
