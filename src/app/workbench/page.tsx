'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { followStageLabels, followStageColors, type FollowStage } from '../projects/types'

interface Project {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  companyPosition: string | null
  financingRound: string | null
  followStage: FollowStage
  status: string
  totalAmount: number
  raisedAmount: number
  targetDate: string
  createdAt: string
  createdBy: { id: string; name: string | null } | null
}

// 阶段顺序
const STAGE_ORDER: FollowStage[] = [
  'INITIAL_TALK',
  'PRE_DD',
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'CLOSING',
  'POST_INVESTMENT',
]

// 各阶段配色（左侧色条 + 头部渐变）
const stageGradients: Record<FollowStage, string> = {
  INITIAL_TALK: 'from-gray-400 to-gray-500',
  PRE_DD: 'from-blue-400 to-blue-500',
  PROJECT_INITIATION: 'from-purple-400 to-purple-500',
  DUE_DILIGENCE: 'from-amber-400 to-amber-500',
  CLOSING: 'from-emerald-400 to-emerald-500',
  POST_INVESTMENT: 'from-indigo-400 to-indigo-500',
}

const stageBorderLeft: Record<FollowStage, string> = {
  INITIAL_TALK: 'border-l-gray-400',
  PRE_DD: 'border-l-blue-400',
  PROJECT_INITIATION: 'border-l-purple-400',
  DUE_DILIGENCE: 'border-l-amber-400',
  CLOSING: 'border-l-emerald-400',
  POST_INVESTMENT: 'border-l-indigo-400',
}

export default function WorkbenchPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  // 未登录跳转登录
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login?callbackUrl=/workbench')
    }
  }, [status, router])

  useEffect(() => {
    if (status === 'authenticated') {
      fetchProjects()
    }
  }, [status])

  const fetchProjects = async () => {
    setLoading(true)
    try {
      // 仅获取个人维护的项目
      const response = await fetch('/api/projects?scope=mine')
      const data = await response.json()
      setProjects(data.projects || [])
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    }
    setLoading(false)
  }

  // 按阶段分组
  const projectsByStage = STAGE_ORDER.map(stage => ({
    stage,
    label: followStageLabels[stage],
    projects: projects.filter(p => p.followStage === stage),
  }))

  const totalProjects = projects.length

  return (
    <DashboardLayout
      title="工作台"
      subtitle={`个人跟进项目管理 · 共 ${totalProjects} 个项目`}
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
      {/* 说明条 */}
      <div className="bg-gradient-to-r from-primary-50 to-blue-50 rounded-2xl p-4 mb-6 border border-primary-100 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-md shadow-primary-500/30 flex-shrink-0">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div className="text-sm text-gray-600">
          <span className="font-medium text-gray-900">工作台</span>仅展示您维护的项目（作为创建者或项目成员），按跟进阶段分组排列。
        </div>
      </div>

      {/* 阶段统计概览 */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
        {projectsByStage.map(({ stage, label, projects: stageProjects }) => (
          <div
            key={stage}
            className="bg-gradient-card rounded-2xl p-4 shadow-sm border border-primary-100 text-center"
          >
            <div className={`w-8 h-8 mx-auto rounded-lg bg-gradient-to-br ${stageGradients[stage]} flex items-center justify-center shadow-sm mb-2`}>
              <span className="text-white font-bold text-sm">{stageProjects.length}</span>
            </div>
            <div className="text-xs text-gray-500">{label}</div>
          </div>
        ))}
      </div>

      {/* 各阶段项目列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      ) : totalProjects === 0 ? (
        <div className="bg-gradient-card rounded-2xl shadow-sm p-16 text-center border border-primary-100">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">暂无您维护的项目</h3>
          <p className="text-gray-500 mb-4">您还不是任何项目的维护人，可前往项目库创建或被分配项目</p>
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-colors text-sm font-medium"
          >
            浏览项目库
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {projectsByStage.map(({ stage, label, projects: stageProjects }) => (
            <div key={stage} className="bg-gradient-card rounded-2xl shadow-sm border border-primary-100 overflow-hidden">
              {/* 阶段头部 */}
              <div className={`flex items-center justify-between px-5 py-3 bg-gradient-to-r ${stageGradients[stage]} from-opacity-10`}>
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold text-sm">{label}</span>
                  <span className="px-2 py-0.5 bg-white/20 rounded-full text-white text-xs font-medium">
                    {stageProjects.length}
                  </span>
                </div>
              </div>

              {/* 项目卡片 */}
              {stageProjects.length === 0 ? (
                <div className="px-5 py-6 text-center text-sm text-gray-400">
                  暂无{label}阶段项目
                </div>
              ) : (
                <div className="divide-y divide-primary-50">
                  {stageProjects.map(project => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className={`block px-5 py-3 hover:bg-primary-50/50 transition-colors border-l-4 ${stageBorderLeft[stage]}`}
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <h4 className="font-semibold text-gray-900 text-sm truncate hover:text-primary-700 transition-colors">
                            {project.name}
                          </h4>
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            {project.createdBy?.name || '未分配'}
                          </span>
                          {project.companyPosition && (
                            <span className="text-xs text-gray-500 truncate">
                              · {project.companyPosition}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500 whitespace-nowrap">
                          {project.financingRound && (
                            <span>{project.financingRound}</span>
                          )}
                          {project.industry && (
                            <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{project.industry}</span>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  )
}
