'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/DashboardLayout'
import { followStageLabels, followStageColors, type FollowStage } from '../types'

interface PartnerReview {
  id: string
  userName: string
  content: string
  createdAt: string
}

interface FollowUpNote {
  id: string
  userName: string
  content: string
  createdAt: string
}

interface StageApprovalItem {
  id: string
  userName: string
  status: string
  comment: string | null
  createdAt: string
}

interface ApprovalSummary {
  totalPartners: number
  approvedCount: number
  rejectedCount: number
  pendingCount: number
  majorityThreshold: number
  isApproved: boolean
  isRejected: boolean
  canEnterInitiation: boolean
}

interface AICard {
  projectName: string
  highlights: string[]
  barriers: string[]
  risks: string[]
}

interface CompetitorItem {
  projectName: string
  latestRound: string
  amount: string
  founderBackground: string
}

interface Project {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  companyPosition: string | null
  mainProducts: string | null
  coreAdvantage: string | null
  coreTeam: string | null
  competitors: string | null
  competitorAnalysisJson: string | null
  financialData: Record<string, any> | null
  orderProgress: string | null
  financingPlan: string | null
  financingRound: string | null
  followStage: FollowStage
  description: string | null
  status: string
  totalAmount: number
  raisedAmount: number
  targetDate: string
  partnerReviews: PartnerReview[]
  followUpNotes: FollowUpNote[]
  stageApprovals: StageApprovalItem[]
  createdAt: string
  updatedAt: string
  aiCardJson: string | null
  canEdit: boolean
  canDelete: boolean
}

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const userRole = session?.user?.role as string | undefined
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [aiCard, setAiCard] = useState<AICard | null>(null)
  const [isGeneratingCard, setIsGeneratingCard] = useState(false)
  const [aiError, setAiError] = useState('')

  // 竞争态势分析
  const [competitorList, setCompetitorList] = useState<CompetitorItem[] | null>(null)
  const [isGeneratingCompetitors, setIsGeneratingCompetitors] = useState(false)
  const [competitorError, setCompetitorError] = useState('')

  // 合伙人评价
  const [reviewContent, setReviewContent] = useState('')
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)

  // 跟进笔记
  const [noteContent, setNoteContent] = useState('')
  const [isSubmittingNote, setIsSubmittingNote] = useState(false)

  // 立项审批
  const [approvalSummary, setApprovalSummary] = useState<ApprovalSummary | null>(null)
  const [myApproval, setMyApproval] = useState<StageApprovalItem | null>(null)
  const [canApprove, setCanApprove] = useState(false)
  const [approvalComment, setApprovalComment] = useState('')
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false)

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

      // 加载已缓存的竞争态势分析
      if (projectData.competitorAnalysisJson) {
        try {
          const parsed = JSON.parse(projectData.competitorAnalysisJson)
          setCompetitorList(Array.isArray(parsed) ? parsed : (parsed.competitors || null))
        } catch {
          setCompetitorList(null)
        }
      } else {
        setCompetitorList(null)
      }

      // 拉取立项审批信息
      fetchApproval()
    } catch (error) {
      console.error('Failed to fetch project:', error)
    }
    setLoading(false)
  }

  const fetchApproval = async () => {
    try {
      const response = await fetch(`/api/projects/${params.id}/stage-approval`)
      if (response.ok) {
        const data = await response.json()
        setApprovalSummary(data.summary)
        setMyApproval(data.myApproval)
        setCanApprove(data.canApprove)
      }
    } catch (error) {
      console.error('Failed to fetch approval:', error)
    }
  }

  const handleSubmitApproval = async (status: 'APPROVED' | 'REJECTED') => {
    setIsSubmittingApproval(true)
    try {
      const response = await fetch(`/api/projects/${params.id}/stage-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, comment: approvalComment }),
      })
      if (!response.ok) {
        const result = await response.json()
        setAiError(result.error || '提交审批失败')
        return
      }
      setApprovalComment('')
      await fetchApproval()
    } catch (error) {
      console.error('Failed to submit approval:', error)
    } finally {
      setIsSubmittingApproval(false)
    }
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

  // 生成竞争态势分析
  const generateCompetitors = async () => {
    setIsGeneratingCompetitors(true)
    setCompetitorError('')
    try {
      const response = await fetch(`/api/projects/${params.id}/competitors`, {
        method: 'POST',
      })
      if (!response.ok) {
        const result = await response.json()
        setCompetitorError(result.error || '生成竞争态势分析失败')
        setIsGeneratingCompetitors(false)
        return
      }
      const data = await response.json()
      setCompetitorList(data.competitors)
    } catch (error) {
      setCompetitorError('生成竞争态势分析失败，请稍后重试')
    } finally {
      setIsGeneratingCompetitors(false)
    }
  }

  // 提交合伙人评价
  const handleSubmitReview = async () => {
    if (!reviewContent.trim()) return
    setIsSubmittingReview(true)
    try {
      const response = await fetch(`/api/projects/${params.id}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: reviewContent }),
      })
      if (!response.ok) {
        const result = await response.json()
        setAiError(result.error || '发布评价失败')
        return
      }
      setReviewContent('')
      await fetchProject()
    } catch (error) {
      console.error('Failed to submit review:', error)
    } finally {
      setIsSubmittingReview(false)
    }
  }

  // 提交跟进笔记
  const handleSubmitNote = async () => {
    if (!noteContent.trim()) return
    setIsSubmittingNote(true)
    try {
      const response = await fetch(`/api/projects/${params.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: noteContent }),
      })
      if (!response.ok) {
        const result = await response.json()
        setAiError(result.error || '发布笔记失败')
        return
      }
      setNoteContent('')
      await fetchProject()
    } catch (error) {
      console.error('Failed to submit note:', error)
    } finally {
      setIsSubmittingNote(false)
    }
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

      {/* 左右各占1列布局 - 右侧宽大一倍 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左侧 */}
        <div className="space-y-6">
          {/* 项目概览 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              项目概览
            </h2>
            <div className="grid grid-cols-2 gap-4">
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
                <div className="text-xs text-gray-500 mb-1">融资轮次</div>
                <div className="text-sm font-medium text-gray-900">{project.financingRound || '-'}</div>
              </div>
              <div className="bg-white/70 rounded-xl p-4 border border-primary-50">
                <div className="text-xs text-gray-500 mb-1">融资金额</div>
                <div className="text-sm font-medium text-primary-700">¥{project.totalAmount.toLocaleString()}万</div>
              </div>
              <div className="bg-white/70 rounded-xl p-4 border border-primary-50">
                <div className="text-xs text-gray-500 mb-1">历史累计融资</div>
                <div className="text-sm font-medium text-gray-900">¥{project.raisedAmount.toLocaleString()}万</div>
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
            <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{project.mainProducts || '-'}</p>
          </div>

          {/* 核心优势 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              核心优势
            </h2>
            <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{project.coreAdvantage || '-'}</p>
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
              (() => {
                let parsed = project.financialData
                if (typeof parsed === 'string') {
                  try { parsed = JSON.parse(parsed) } catch { /* not JSON, show as text */ }
                }
                if (typeof parsed === 'object' && parsed !== null) {
                  return (
                    <div className="space-y-2">
                      {Object.entries(parsed).map(([key, value]) => (
                        <div key={key} className="flex justify-between py-2.5 border-b border-primary-50 last:border-0">
                          <span className="text-gray-500 text-sm">{key}</span>
                          <span className="text-gray-900 font-medium text-sm">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  )
                }
                return <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{String(project.financialData)}</p>
              })()
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
            <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{project.orderProgress || '-'}</p>
          </div>

          {/* 核心团队 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              核心团队
            </h2>
            <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{project.coreTeam || '-'}</p>
          </div>

          {/* 竞争对手 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              竞争对手
            </h2>
            <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{project.competitors || '-'}</p>
          </div>

          {/* 融资规划 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              融资规划
            </h2>
            <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{project.financingPlan || '-'}</p>
          </div>

          {/* 项目描述 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              项目描述
            </h2>
            <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{project.description || '-'}</p>
          </div>
        </div>

        {/* 右侧 - 宽大一倍 */}
        <div className="space-y-6">
          {/* 投资合伙人评价 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              投资合伙人评价 ({project.partnerReviews.length})
            </h2>

            {/* 评价输入框 */}
            <div className="mb-4">
              <textarea
                value={reviewContent}
                onChange={(e) => setReviewContent(e.target.value)}
                className="w-full px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth resize-none placeholder-gray-400"
                rows={3}
                placeholder="填写您的评价..."
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={handleSubmitReview}
                  disabled={!reviewContent.trim() || isSubmittingReview}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 transition-all-smooth disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {isSubmittingReview ? '发布中...' : '发布评价'}
                </button>
              </div>
            </div>

            {/* 评价列表 */}
            <div className="space-y-3">
              {project.partnerReviews.map(review => (
                <div key={review.id} className="bg-white/70 rounded-xl p-4 border border-primary-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-medium text-sm">
                        {review.userName.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-gray-900 text-sm">{review.userName}</span>
                    </div>
                    <span className="text-xs text-gray-400">{new Date(review.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap">{review.content}</p>
                </div>
              ))}
              {project.partnerReviews.length === 0 && (
                <p className="text-gray-400 text-center py-4 text-sm">暂无评价</p>
              )}
            </div>
          </div>

          {/* 跟进笔记 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              跟进笔记 ({project.followUpNotes.length})
            </h2>

            {/* 笔记输入框 */}
            <div className="mb-4">
              <textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                className="w-full px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth resize-none placeholder-gray-400"
                rows={3}
                placeholder="记录跟进情况..."
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={handleSubmitNote}
                  disabled={!noteContent.trim() || isSubmittingNote}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 transition-all-smooth disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                >
                  {isSubmittingNote ? '发布中...' : '发布笔记'}
                </button>
              </div>
            </div>

            {/* 笔记列表 */}
            <div className="space-y-3">
              {project.followUpNotes.map(note => (
                <div key={note.id} className="bg-white/70 rounded-xl p-4 border border-primary-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-medium text-sm">
                        {note.userName.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-gray-900 text-sm">{note.userName}</span>
                    </div>
                    <span className="text-xs text-gray-400">{new Date(note.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap">{note.content}</p>
                </div>
              ))}
              {project.followUpNotes.length === 0 && (
                <p className="text-gray-400 text-center py-4 text-sm">暂无跟进笔记</p>
              )}
            </div>
          </div>

          {/* 立项审批 - 仅在 PreDD 阶段或已有审批记录时显示 */}
          {(project.followStage === 'PRE_DD' || project.stageApprovals.length > 0) && (
            <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                立项审批
              </h2>

              {/* 审批状态汇总 */}
              {approvalSummary && (
                <div className="mb-4 p-4 rounded-xl bg-white/70 border border-primary-50">
                  <div className="grid grid-cols-4 gap-3 text-center">
                    <div>
                      <div className="text-2xl font-bold text-emerald-600">{approvalSummary.approvedCount}</div>
                      <div className="text-xs text-gray-500">已通过</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-danger-600">{approvalSummary.rejectedCount}</div>
                      <div className="text-xs text-gray-500">已拒绝</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-gray-400">{approvalSummary.pendingCount}</div>
                      <div className="text-xs text-gray-500">待审批</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-primary-700">{approvalSummary.majorityThreshold}</div>
                      <div className="text-xs text-gray-500">通过阈值</div>
                    </div>
                  </div>
                  <div className="mt-3 text-center text-xs">
                    共 {approvalSummary.totalPartners} 位投资合伙人，需 {approvalSummary.majorityThreshold} 票通过方可立项
                  </div>
                  {approvalSummary.isApproved && !approvalSummary.isRejected && (
                    <div className="mt-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-center text-sm text-emerald-700">
                      ✓ 已达到多数通过，可进入立项阶段
                    </div>
                  )}
                  {approvalSummary.isRejected && (
                    <div className="mt-2 px-3 py-2 bg-danger-50 border border-danger-200 rounded-lg text-center text-sm text-danger-700">
                      ✗ 存在合伙人拒绝立项，无法进入立项阶段
                    </div>
                  )}
                </div>
              )}

              {/* 审批按钮区 - 仅合伙人/管理员可见，且项目处于 PreDD 阶段 */}
              {canApprove && project.followStage === 'PRE_DD' && (
                <div className="mb-4">
                  {myApproval ? (
                    <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700">
                      您已审批：
                      <span className={`font-semibold ml-1 ${myApproval.status === 'APPROVED' ? 'text-emerald-700' : 'text-danger-700'}`}>
                        {myApproval.status === 'APPROVED' ? '通过' : '拒绝'}
                      </span>
                      {myApproval.comment && <span className="ml-2 text-gray-600">（{myApproval.comment}）</span>}
                    </div>
                  ) : (
                    <>
                      <textarea
                        value={approvalComment}
                        onChange={(e) => setApprovalComment(e.target.value)}
                        className="w-full px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth resize-none placeholder-gray-400 mb-2"
                        rows={2}
                        placeholder="审批意见（可选）"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSubmitApproval('APPROVED')}
                          disabled={isSubmittingApproval}
                          className="flex-1 px-4 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl hover:from-emerald-600 hover:to-emerald-700 transition-all-smooth disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                        >
                          ✓ 同意立项
                        </button>
                        <button
                          onClick={() => handleSubmitApproval('REJECTED')}
                          disabled={isSubmittingApproval}
                          className="flex-1 px-4 py-2 bg-gradient-to-r from-danger-500 to-danger-600 text-white rounded-xl hover:from-danger-600 hover:to-danger-700 transition-all-smooth disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                        >
                          ✗ 拒绝立项
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* 审批记录列表 */}
              <div className="space-y-2">
                {project.stageApprovals.map(approval => (
                  <div key={approval.id} className="bg-white/70 rounded-xl p-3 border border-primary-50">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          approval.status === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-danger-100 text-danger-700'
                        }`}>
                          {approval.status === 'APPROVED' ? '通过' : '拒绝'}
                        </span>
                        <span className="font-medium text-gray-900 text-sm">{approval.userName}</span>
                      </div>
                      <span className="text-xs text-gray-400">{new Date(approval.createdAt).toLocaleString('zh-CN')}</span>
                    </div>
                    {approval.comment && (
                      <p className="text-gray-600 text-sm leading-relaxed">{approval.comment}</p>
                    )}
                  </div>
                ))}
                {project.stageApprovals.length === 0 && (
                  <p className="text-gray-400 text-center py-3 text-sm">暂无审批记录</p>
                )}
              </div>
            </div>
          )}

          {/* 竞争态势分析 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                竞争态势分析
              </h2>
              <button
                onClick={generateCompetitors}
                disabled={isGeneratingCompetitors}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl hover:from-purple-600 hover:to-pink-600 transition-all-smooth disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium shadow-md shadow-purple-500/30"
              >
                {isGeneratingCompetitors ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    AI 检索中...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    {competitorList ? '重新分析' : 'AI 分析'}
                  </>
                )}
              </button>
            </div>

            {competitorError && (
              <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-danger-50 border border-danger-200 rounded-xl text-sm text-danger-700">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {competitorError}
              </div>
            )}

            {competitorList && competitorList.length > 0 ? (
              <div className="space-y-3">
                {competitorList.map((c, idx) => (
                  <div key={idx} className="bg-white/70 rounded-xl p-4 border border-primary-50">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-400 to-pink-500 text-white text-xs font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        {c.projectName || '-'}
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">最近融资轮次</div>
                        <div className="font-medium text-gray-900">{c.latestRound || '-'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">融资金额</div>
                        <div className="font-medium text-primary-700">{c.amount || '-'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">创始人背景</div>
                        <div className="font-medium text-gray-900">{c.founderBackground || '-'}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              !isGeneratingCompetitors && !competitorError && (
                <div className="text-center py-6">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-purple-50 flex items-center justify-center">
                    <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <p className="text-gray-500 text-sm mb-1">点击右上角"AI 分析"</p>
                  <p className="text-gray-400 text-xs">系统将根据竞争对手和主要产品信息检索市场竞品</p>
                </div>
              )
            )}
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
