'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { followStageLabels, followStageColors, type FollowStage } from '../types'

interface Investor {
  id: string
  name: string
  email: string
  phone: string | null
}

interface Investment {
  id: string
  amount: number
  date: string
  investorId: string
}

interface AICard {
  projectName: string
  highlights: string[]
  barriers: string[]
  risks: string[]
}

interface Project {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  companyPosition: string | null
  mainProducts: string | null
  financialData: Record<string, any> | null
  orderProgress: string | null
  financingPlan: string | null
  followStage: FollowStage
  description: string | null
  status: string
  totalAmount: number
  raisedAmount: number
  targetDate: string
  investors: Investor[]
  investments: Investment[]
  createdAt: string
  updatedAt: string
  aiCardJson: string | null
  canEdit: boolean
  canDelete: boolean
}

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [aiCard, setAiCard] = useState<AICard | null>(null)
  const [isGeneratingCard, setIsGeneratingCard] = useState(false)
  const [aiError, setAiError] = useState('')

  useEffect(() => {
    fetchProject()
  }, [params.id])

  const fetchProject = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/projects/${params.id}`)
      if (!response.ok) {
        throw new Error('Project not found')
      }
      const data = await response.json()
      const projectData = data.project as Project
      setProject(projectData)
      
      if (projectData.aiCardJson) {
        try {
          setAiCard(JSON.parse(projectData.aiCardJson))
        } catch {
          setAiCard(null)
        }
      }
    } catch (error) {
      console.error('Failed to fetch project:', error)
    }
    setLoading(false)
  }

  const handleDelete = async () => {
    try {
      const response = await fetch(`/api/projects/${params.id}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        router.push('/projects')
      }
    } catch (error) {
      console.error('Failed to delete project:', error)
    }
  }

  const generateAICard = async () => {
    setIsGeneratingCard(true)
    setAiError('')
    
    try {
      const response = await fetch(`/api/projects/${params.id}/ai-card`, {
        method: 'POST',
      })
      
      if (!response.ok) {
        const result = await response.json()
        setAiError(result.error || '生成 AI 卡片失败')
        setIsGeneratingCard(false)
        return
      }
      
      const data = await response.json()
      setAiCard(data.card)
    } catch (error) {
      setAiError('生成 AI 卡片失败，请稍后重试')
    } finally {
      setIsGeneratingCard(false)
    }
  }

  const percentage = (raised: number, total: number) => {
    return total > 0 ? Math.round((raised / total) * 100) : 0
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  if (!project) {
    return (
      <DashboardLayout title="项目详情">
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-danger-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-danger-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">项目不存在或无权访问</h3>
            <Link href="/projects" className="text-primary-600 hover:text-primary-700 mt-2 inline-block">
              返回项目列表
            </Link>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const pct = percentage(project.raisedAmount, project.totalAmount)

  return (
    <DashboardLayout
      title={project.name}
      subtitle={followStageLabels[project.followStage]}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={generateAICard}
            disabled={isGeneratingCard}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl hover:from-purple-600 hover:to-pink-600 transition-all-smooth disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-purple-500/30 text-sm font-medium"
          >
            {isGeneratingCard ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                生成中...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI 画板
              </>
            )}
          </button>
          {project.canEdit && (
            <Link
              href={`/projects/${project.id}/edit`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-primary-200 text-gray-700 rounded-xl hover:bg-primary-50 hover:border-primary-300 transition-all-smooth text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              编辑
            </Link>
          )}
          {project.canDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-danger-200 text-danger-600 rounded-xl hover:bg-danger-50 hover:border-danger-300 transition-all-smooth text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              删除
            </button>
          )}
        </div>
      }
    >
      {/* 返回链接 */}
      <div className="mb-4">
        <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-primary-600 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          返回项目列表
        </Link>
      </div>

      {/* 阶段标签徽章 */}
      <div className="mb-6">
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${followStageColors[project.followStage]}`}>
          {followStageLabels[project.followStage]}
        </span>
      </div>

      {/* AI 错误提示 */}
      {aiError && (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 bg-danger-50 border border-danger-200 rounded-xl">
          <svg className="w-5 h-5 text-danger-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-sm text-danger-700">{aiError}</span>
        </div>
      )}

      {/* AI 投资分析卡片 */}
      {aiCard && (
        <div className="bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-600 rounded-2xl shadow-xl p-6 mb-6 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-2xl"></div>
          <div className="relative">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <h2 className="text-xl font-bold">AI 投资分析卡片</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  <h3 className="font-semibold">投资亮点</h3>
                </div>
                <ul className="space-y-2">
                  {aiCard.highlights.map((highlight, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <span className="w-1.5 h-1.5 bg-green-400 rounded-full mt-2 flex-shrink-0"></span>
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>
              </div>
              
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <h3 className="font-semibold">核心壁垒</h3>
                </div>
                <ul className="space-y-2">
                  {aiCard.barriers.map((barrier, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full mt-2 flex-shrink-0"></span>
                      <span>{barrier}</span>
                    </li>
                  ))}
                </ul>
              </div>
              
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-yellow-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <h3 className="font-semibold">风险提示</h3>
                </div>
                <ul className="space-y-2">
                  {aiCard.risks.map((risk, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full mt-2 flex-shrink-0"></span>
                      <span>{risk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* 项目概览 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              项目概览
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white/70 rounded-xl p-4 border border-primary-50">
                <div className="text-xs text-gray-500 mb-1">公司全称</div>
                <div className="text-sm font-medium text-gray-900">{project.companyFullName || '-'}</div>
              </div>
              <div className="bg-white/70 rounded-xl p-4 border border-primary-50">
                <div className="text-xs text-gray-500 mb-1">所处行业</div>
                <div className="text-sm font-medium text-gray-900">{project.industry || '-'}</div>
              </div>
              <div className="bg-white/70 rounded-xl p-4 border border-primary-50">
                <div className="text-xs text-gray-500 mb-1">公司定位</div>
                <div className="text-sm font-medium text-gray-900">{project.companyPosition || '-'}</div>
              </div>
              <div className="bg-white/70 rounded-xl p-4 border border-primary-50">
                <div className="text-xs text-gray-500 mb-1">目标日期</div>
                <div className="text-sm font-medium text-gray-900">{new Date(project.targetDate).toLocaleDateString('zh-CN')}</div>
              </div>
            </div>
          </div>

          {/* 主要产品 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              主要产品
            </h2>
            <p className="text-gray-600 leading-relaxed">{project.mainProducts || '-'}</p>
          </div>

          {/* 财务数据 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              财务数据
            </h2>
            {project.financialData ? (
              <div className="space-y-2">
                {Object.entries(project.financialData).map(([key, value]) => (
                  <div key={key} className="flex justify-between py-2.5 border-b border-primary-50 last:border-0">
                    <span className="text-gray-500 text-sm">{key}</span>
                    <span className="text-gray-900 font-medium text-sm">{value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400">-</p>
            )}
          </div>

          {/* 订单进展 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              订单进展
            </h2>
            <p className="text-gray-600 leading-relaxed">{project.orderProgress || '-'}</p>
          </div>

          {/* 融资规划 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              融资规划
            </h2>
            <p className="text-gray-600 leading-relaxed">{project.financingPlan || '-'}</p>
          </div>

          {/* 项目描述 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              项目描述
            </h2>
            <p className="text-gray-600 leading-relaxed">{project.description || '-'}</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* 融资进度 */}
          <div className="bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl shadow-lg p-6 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -mr-20 -mt-20 blur-2xl"></div>
            <div className="relative">
              <h2 className="text-sm font-medium text-white/80 mb-4">融资进度</h2>
              <div className="mb-4">
                <div className="text-3xl font-bold">¥{project.raisedAmount.toLocaleString()}</div>
                <div className="text-sm text-white/70 mt-1">已筹 / ¥{project.totalAmount.toLocaleString()} 目标</div>
              </div>
              <div className="w-full bg-white/20 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-white h-3 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-right text-sm text-white/80 mt-2">{pct}% 完成</div>
            </div>
          </div>

          {/* 投资人列表 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              投资人 ({project.investors.length})
            </h2>
            <div className="space-y-3">
              {project.investors.map(investor => (
                <div key={investor.id} className="flex items-center justify-between py-2 border-b border-primary-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-medium text-sm">
                      {investor.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 text-sm">{investor.name}</div>
                      <div className="text-xs text-gray-500">{investor.email}</div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">{investor.phone || '-'}</div>
                </div>
              ))}
              {project.investors.length === 0 && (
                <p className="text-gray-400 text-center py-4">暂无投资人</p>
              )}
            </div>
          </div>

          {/* 投资记录 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              投资记录 ({project.investments.length})
            </h2>
            <div className="space-y-3">
              {project.investments.map(investment => (
                <div key={investment.id} className="flex items-center justify-between py-2 border-b border-primary-50 last:border-0">
                  <div className="text-sm text-gray-500">{new Date(investment.date).toLocaleDateString('zh-CN')}</div>
                  <div className="font-medium text-success-600">¥{investment.amount.toLocaleString()}</div>
                </div>
              ))}
              {project.investments.length === 0 && (
                <p className="text-gray-400 text-center py-4">暂无投资记录</p>
              )}
            </div>
          </div>

          {/* 创建时间 */}
          <div className="bg-gradient-card rounded-2xl p-5 border border-primary-100">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              创建时间
            </div>
            <div className="text-gray-900 text-sm">{new Date(project.createdAt).toLocaleString('zh-CN')}</div>
          </div>
        </div>
      </div>

      {/* 删除确认弹窗 */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gradient-card rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl border border-primary-100">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-danger-50 flex items-center justify-center">
                <svg className="w-5 h-5 text-danger-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">确认删除</h3>
            </div>
            <p className="text-gray-600 mb-5">确定要删除项目「{project.name}」吗？此操作无法撤销。</p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-all-smooth"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-gradient-to-r from-danger-500 to-danger-600 text-white rounded-xl hover:from-danger-600 hover:to-danger-700 transition-all-smooth shadow-md shadow-danger-500/30"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
