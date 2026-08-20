'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/DashboardLayout'
import DocumentPreviewModal from '@/components/DocumentPreviewModal'
import DDReportPanel from '@/components/research/DDReportPanel'

// ── 类型定义 ──

interface ResearchProject {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  companyPosition: string | null
  mainProducts: string | null
  coreAdvantage: string | null
  coreTeam: string | null
  competitors: string | null
  description: string | null
  totalAmount: string
  raisedAmount: string | null
  followStage: string
  createdById: string
  members: { userId: string }[]
}

interface ResearchDocument {
  id: string
  fileName: string
  fileUrl: string
  fileType: string
  fileSize: number
  createdAt: string
  uploadedBy: { id: string; name: string | null; email: string }
}

interface ResearchModule {
  id: string
  projectId: string
  moduleType: string
  content: string | null
  aiJson: string | null
  aiSummary: string | null
  analyzedAt: string | null
  documents: ResearchDocument[]
}

interface CommentUser {
  id: string
  name: string | null
  email: string
}

interface ResearchComment {
  id: string
  content: string
  createdAt: string
  updatedAt: string
  user: CommentUser
  replies: ResearchComment[]
}

// ── 模块配置 ──

const MODULE_CONFIG: Record<string, { label: string; description: string; needsAI: boolean }> = {
  INDUSTRY:        { label: '行业分析', description: '行业发展阶段，技术成熟度 TRL 分析', needsAI: true },
  PRODUCT_TECH:    { label: '产品和技术', description: '产品定位、技术路线、差异化优势', needsAI: true },
  COMPETITION:     { label: '竞争分析', description: '竞争对手产品定位、市场策略、业务进展、团队背景', needsAI: true },
  BUSINESS_DD:     { label: '业务尽调', description: '前十大客户、已签订单、意向订单、客户评价', needsAI: true },
  FINANCIAL_DD:    { label: '财务尽调', description: '财务数据分析（基于上传文档）', needsAI: true },
  TEAM:            { label: '核心团队', description: '核心团队背景（基于上传文档）', needsAI: true },
  COMPANY:         { label: '公司概况', description: '公司基本信息、股权结构、发展历程', needsAI: true },
  FINANCING:       { label: '融资规划和进展', description: '融资金额、投前估值、老股估值、其它机构进展、核心条款', needsAI: false },
  RECOMMENDATION:  { label: '投资建议', description: '投资金额区间、领投或跟投', needsAI: false },
}

const MODULE_ORDER = ['INDUSTRY', 'PRODUCT_TECH', 'COMPETITION', 'BUSINESS_DD', 'FINANCIAL_DD', 'TEAM', 'COMPANY', 'FINANCING', 'RECOMMENDATION']

// ── 手动输入模块的字段配置 ──

const FINANCING_FIELDS = [
  { key: 'financingAmount', label: '融资金额', placeholder: '如 5000万元' },
  { key: 'preValuation', label: '投前估值', placeholder: '如 2亿元' },
  { key: 'oldShareValuation', label: '老股估值（如有）', placeholder: '如 1.8亿元' },
  { key: 'otherInstitutions', label: '其它机构进展', placeholder: '如 红杉资本正在评估中', type: 'textarea' },
  { key: 'coreTerms', label: '核心条款', placeholder: '如 优先清算权 1x, 反稀释条款...', type: 'textarea' },
]

const RECOMMENDATION_FIELDS = [
  { key: 'investmentRange', label: '投资金额区间', placeholder: '如 500-1000万元' },
  { key: 'investmentType', label: '领投或跟投', placeholder: '如 领投 / 跟投', type: 'select', options: ['领投', '跟投', '暂不确定'] },
  { key: 'recommendation', label: '投资建议说明', placeholder: '详细说明投资建议和理由...', type: 'textarea' },
]

// ── 主组件 ──

export default function ResearchDetailPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const { data: session, status } = useSession()

  const [project, setProject] = useState<ResearchProject | null>(null)
  const [modules, setModules] = useState<ResearchModule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/research/${params.projectId}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '加载失败')
        return
      }
      setProject(data.project)
      setModules(data.modules || [])
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }, [params.projectId])

  useEffect(() => {
    if (status !== 'authenticated') return
    fetchData()
  }, [status, fetchData])

  if (status === 'loading' || loading) {
    return (
      <DashboardLayout title="投研分析" subtitle="加载中...">
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  if (error || !project) {
    return (
      <DashboardLayout title="投研分析">
        <div className="py-20 text-center">
          <p className="text-danger-600 mb-4">{error || '项目不存在'}</p>
          <button onClick={() => router.push('/research')} className="px-4 py-2 bg-primary-500 text-white rounded-lg">
            返回列表
          </button>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout
      title={`投研分析 - ${project.name}`}
      subtitle={project.companyFullName || project.industry || ''}
      actions={
        <div className="flex gap-2">
          <button
            onClick={() => router.push(`/research/${params.projectId}/view`)}
            className="px-3 py-1.5 bg-primary-500 text-white text-sm rounded-lg hover:bg-primary-600 font-medium"
          >
            可视化报告
          </button>
          <button
            onClick={() => router.back()}
            className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200"
          >
            ← 返回
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* 尽调报告（Harness 架构：进入尽调阶段自动分析） */}
        <DDReportPanel
          projectId={params.projectId}
          canEdit={
            (session?.user?.role as string) === 'ADMIN' ||
            (session?.user?.role as string) === 'INVESTMENT_PARTNER' ||
            project.createdById === (session?.user?.id as string) ||
            project.members.some(m => m.userId === (session?.user?.id as string))
          }
        />

        {/* 项目基本信息 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">项目基本信息</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-gray-500">项目名称:</span> <span className="font-medium">{project.name}</span></div>
            <div><span className="text-gray-500">公司全称:</span> <span className="font-medium">{project.companyFullName || '-'}</span></div>
            <div><span className="text-gray-500">所处行业:</span> <span className="font-medium">{project.industry || '-'}</span></div>
            <div><span className="text-gray-500">公司定位:</span> <span className="font-medium">{project.companyPosition || '-'}</span></div>
            <div><span className="text-gray-500">融资金额:</span> <span className="font-medium text-primary-700">{project.totalAmount}</span></div>
            <div><span className="text-gray-500">已筹金额:</span> <span className="font-medium">{project.raisedAmount || '-'}</span></div>
            <div><span className="text-gray-500">主要产品:</span> <span className="font-medium">{project.mainProducts || '-'}</span></div>
            <div><span className="text-gray-500">核心优势:</span> <span className="font-medium">{project.coreAdvantage || '-'}</span></div>
          </div>
        </div>

        {/* 9 个模块 */}
        {MODULE_ORDER.map(moduleType => (
          <ModuleSection
            key={moduleType}
            projectId={params.projectId}
            module={modules.find(m => m.moduleType === moduleType) || null}
            moduleType={moduleType}
            project={project}
            onDataUpdate={fetchData}
          />
        ))}
      </div>
    </DashboardLayout>
  )
}

// ── 模块组件 ──

interface ModuleSectionProps {
  projectId: string
  module: ResearchModule | null
  moduleType: string
  project: ResearchProject
  onDataUpdate: () => void
}

function ModuleSection({ projectId, module, moduleType, project, onDataUpdate }: ModuleSectionProps) {
  const config = MODULE_CONFIG[moduleType]
  const { data: session } = useSession()
  const userRole = session?.user?.role as string | undefined
  const currentUserId = session?.user?.id as string | undefined

  // 模块展开/收起状态：默认收起
  const [expanded, setExpanded] = useState(false)
  // 点评面板展开状态
  const [commentsOpen, setCommentsOpen] = useState(false)
  // 点评列表
  const [comments, setComments] = useState<ResearchComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  // 新点评输入
  const [newComment, setNewComment] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  // 回复状态
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [submittingReply, setSubmittingReply] = useState(false)

  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [manualContent, setManualContent] = useState<Record<string, string>>({})

  // 文档预览
  const [previewDoc, setPreviewDoc] = useState<{ fileName: string; fileUrl: string; fileType: string } | null>(null)

  // 判断当前用户是否可编辑（用于回复权限）
  const memberIds = project.members?.map((m: { userId: string }) => m.userId) || []
  const canEdit = userRole === 'ADMIN' || userRole === 'INVESTMENT_PARTNER' ||
                  project.createdById === currentUserId || memberIds.includes(currentUserId || '')

  // 初始化手动输入内容
  useEffect(() => {
    if (module?.content) {
      try {
        setManualContent(JSON.parse(module.content))
      } catch {
        setManualContent({})
      }
    } else {
      setManualContent({})
    }
  }, [module?.content])

  // AI 分析
  const handleAnalyze = async () => {
    setAnalyzing(true)
    setAnalyzeError('')
    try {
      const res = await fetch(`/api/research/${projectId}/${moduleType}/analyze`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setAnalyzeError(data.error || '分析失败')
        return
      }
      onDataUpdate()
    } catch {
      setAnalyzeError('网络错误')
    } finally {
      setAnalyzing(false)
    }
  }

  // 保存手动输入
  const handleSaveContent = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/research/${projectId}/${moduleType}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: manualContent }),
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || '保存失败')
        return
      }
      onDataUpdate()
    } catch {
      alert('网络错误')
    } finally {
      setSaving(false)
    }
  }

  // 上传文档
  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/research/${projectId}/${moduleType}/documents`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || '上传失败')
        return
      }
      onDataUpdate()
    } catch {
      alert('网络错误')
    } finally {
      setUploading(false)
    }
  }

  // 删除文档
  const handleDeleteDoc = async (docId: string) => {
    if (!confirm('确认删除此文档？')) return
    try {
      const res = await fetch(`/api/research/${projectId}/documents/${docId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || '删除失败')
        return
      }
      onDataUpdate()
    } catch {
      alert('网络错误')
    }
  }

  // 加载点评
  const fetchComments = useCallback(async () => {
    setCommentsLoading(true)
    try {
      const res = await fetch(`/api/research/${projectId}/${moduleType}/comments`)
      const data = await res.json()
      if (res.ok) {
        setComments(data.comments || [])
      }
    } catch {
      // 忽略
    } finally {
      setCommentsLoading(false)
    }
  }, [projectId, moduleType])

  // 打开点评面板时加载
  useEffect(() => {
    if (commentsOpen) {
      fetchComments()
    }
  }, [commentsOpen, fetchComments])

  // 发布点评
  const handleSubmitComment = async () => {
    if (!newComment.trim()) return
    setSubmittingComment(true)
    try {
      const res = await fetch(`/api/research/${projectId}/${moduleType}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newComment }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || '发布失败')
        return
      }
      setNewComment('')
      setComments(prev => [...prev, data.comment])
    } catch {
      alert('网络错误')
    } finally {
      setSubmittingComment(false)
    }
  }

  // 回复点评
  const handleSubmitReply = async (commentId: string) => {
    if (!replyContent.trim()) return
    setSubmittingReply(true)
    try {
      const res = await fetch(`/api/research/${projectId}/${moduleType}/comments/${commentId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: replyContent }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || '回复失败')
        return
      }
      setReplyContent('')
      setReplyingTo(null)
      // 更新点评列表中的回复
      setComments(prev => prev.map(c =>
        c.id === commentId
          ? { ...c, replies: [...c.replies, data.reply] }
          : c
      ))
    } catch {
      alert('网络错误')
    } finally {
      setSubmittingReply(false)
    }
  }

  // 解析 AI 分析结果
  let aiResult: Record<string, unknown> | null = null
  if (module?.aiJson) {
    try {
      aiResult = JSON.parse(module.aiJson)
    } catch {
      aiResult = null
    }
  }

  // 手动输入字段配置
  const manualFields = moduleType === 'FINANCING' ? FINANCING_FIELDS
    : moduleType === 'RECOMMENDATION' ? RECOMMENDATION_FIELDS
    : null

  // 摘要预览（收起时显示）
  const summary = module?.aiSummary || (aiResult ? getModuleSummary(moduleType, aiResult) : '')

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 模块标题 - 横向布局，左侧标题+摘要，右侧操作按钮 */}
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
              {MODULE_ORDER.indexOf(moduleType) + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-gray-900">{config.label}</h3>
                {module?.analyzedAt && (
                  <span className="px-2 py-0.5 bg-green-50 text-green-600 text-[10px] rounded-full">
                    AI 已分析
                  </span>
                )}
                {module?.documents && module.documents.length > 0 && (
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] rounded-full">
                    {module.documents.length} 个文档
                  </span>
                )}
                {comments.length > 0 && (
                  <span className="px-2 py-0.5 bg-amber-50 text-amber-600 text-[10px] rounded-full">
                    {comments.length} 条点评
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">{config.description}</p>
              {/* 收起时显示摘要 */}
              {!expanded && summary && (
                <p className="text-sm text-gray-600 mt-2 line-clamp-2">{summary}</p>
              )}
              {!expanded && !summary && (
                <p className="text-xs text-gray-400 mt-2 italic">
                  {module?.content || module?.aiJson || (module?.documents && module.documents.length > 0) ? '已填写内容，点击展开查看' : '暂无内容，点击展开编辑'}
                </p>
              )}
            </div>
          </div>

          {/* 右侧操作按钮组 */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* 点评按钮 */}
            <button
              type="button"
              onClick={() => setCommentsOpen(!commentsOpen)}
              className={`relative px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                commentsOpen
                  ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
              title="查看/添加点评"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              点评
              {comments.length > 0 && (
                <span className="px-1.5 py-0.5 bg-amber-500 text-white text-[10px] rounded-full leading-none">
                  {comments.length}
                </span>
              )}
            </button>

            {/* AI 分析按钮 */}
            {config.needsAI && (
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="px-3 py-1.5 bg-primary-500 text-white text-xs font-medium rounded-lg hover:bg-primary-600 disabled:opacity-50 flex items-center gap-1.5"
              >
                {analyzing ? (
                  <>
                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    分析中
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    {module?.analyzedAt ? '重新分析' : 'AI 分析'}
                  </>
                )}
              </button>
            )}

            {/* 展开/收起按钮 */}
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="px-3 py-1.5 bg-gray-50 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-100 flex items-center gap-1.5"
            >
              {expanded ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                  收起
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  展开
                </>
              )}
            </button>
          </div>
        </div>

        {/* AI 分析错误 */}
        {analyzeError && (
          <div className="mt-3 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{analyzeError}</div>
        )}
      </div>

      {/* 展开后显示完整内容 + 右侧点评面板 */}
      <div className="flex">
        {/* 左侧：模块主内容 */}
        <div className={`p-6 ${commentsOpen ? 'flex-1 min-w-0' : 'w-full'}`}>
          {expanded ? (
            <>
              {/* AI 分析结果 */}
              {config.needsAI && aiResult && (
                <div className="mb-4 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-blue-700">AI 分析结果</span>
                    {module?.analyzedAt && (
                      <span className="text-xs text-gray-400">
                        {new Date(module.analyzedAt).toLocaleString('zh-CN')}
                      </span>
                    )}
                  </div>
                  {module?.aiSummary && (
                    <p className="text-sm text-gray-700 mb-3">{module.aiSummary}</p>
                  )}
                  <div className="text-sm">
                    <AIResultRenderer moduleType={moduleType} result={aiResult} />
                  </div>
                </div>
              )}

              {/* 手动输入区域 */}
              {manualFields && (
                <div className="mb-4 space-y-3">
                  <div className="text-xs font-medium text-gray-600">手动输入</div>
                  {manualFields.map(field => (
                    <div key={field.key}>
                      <label className="block text-xs text-gray-500 mb-1">{field.label}</label>
                      {field.type === 'textarea' ? (
                        <textarea
                          value={manualContent[field.key] || ''}
                          onChange={e => setManualContent({ ...manualContent, [field.key]: e.target.value })}
                          placeholder={field.placeholder}
                          rows={3}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-400"
                        />
                      ) : field.type === 'select' ? (
                        <select
                          value={manualContent[field.key] || ''}
                          onChange={e => setManualContent({ ...manualContent, [field.key]: e.target.value })}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-400"
                        >
                          <option value="">请选择</option>
                          {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={manualContent[field.key] || ''}
                          onChange={e => setManualContent({ ...manualContent, [field.key]: e.target.value })}
                          placeholder={field.placeholder}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-400"
                        />
                      )}
                    </div>
                  ))}
                  <button
                    onClick={handleSaveContent}
                    disabled={saving}
                    className="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs rounded-lg hover:bg-gray-200 disabled:opacity-50"
                  >
                    {saving ? '保存中...' : '保存'}
                  </button>
                </div>
              )}

              {/* 文档区域 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-600">补充文档</span>
                  <label className={`px-2.5 py-1 bg-gray-50 text-gray-600 text-xs rounded cursor-pointer hover:bg-gray-100 ${uploading ? 'opacity-50' : ''}`}>
                    {uploading ? '上传中...' : '+ 上传文档'}
                    <input
                      type="file"
                      accept=".pdf,.docx,.xlsx,.pptx"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handleUpload(file)
                        e.target.value = ''
                      }}
                      disabled={uploading}
                    />
                  </label>
                </div>
                {module?.documents && module.documents.length > 0 ? (
                  <div className="space-y-2">
                    {module.documents.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-sm hover:bg-gray-100 transition-colors">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-xs text-gray-400 flex-shrink-0">
                            {doc.fileType.includes('pdf') ? 'PDF' : doc.fileType.includes('word') ? 'DOC' : doc.fileType.includes('sheet') ? 'XLS' : 'PPT'}
                          </span>
                          <button
                            type="button"
                            onClick={() => setPreviewDoc({ fileName: doc.fileName, fileUrl: doc.fileUrl, fileType: doc.fileType })}
                            className="text-gray-700 hover:text-primary-600 truncate text-left flex-1 min-w-0"
                            title="点击预览文档"
                          >
                            {doc.fileName}
                          </button>
                          <span className="text-xs text-gray-400 flex-shrink-0">
                            ({(doc.fileSize / 1024 / 1024).toFixed(1)}MB)
                          </span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => setPreviewDoc({ fileName: doc.fileName, fileUrl: doc.fileUrl, fileType: doc.fileType })}
                            className="text-xs text-primary-600 hover:text-primary-700 px-2 py-1 rounded hover:bg-primary-50"
                            title="预览"
                          >
                            预览
                          </button>
                          <button
                            onClick={() => handleDeleteDoc(doc.id)}
                            className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">暂无文档</p>
                )}
                {/* 文档预览说明 */}
                <p className="text-[11px] text-gray-400 mt-2 italic">
                  点击文档名或"预览"按钮在小窗中打开文档。后期结合 AI 分析时将支持向量化提取文档内容（含图片识别）。
                </p>
              </div>
            </>
          ) : (
            // 收起状态下仅显示简略信息
            <div className="text-sm text-gray-500">
              {module?.documents && module.documents.length > 0 && (
                <div className="mb-2">
                  <span className="text-xs text-gray-400">文档：</span>
                  {module.documents.slice(0, 2).map((doc, i) => (
                    <span key={doc.id} className="text-xs text-gray-600">
                      {i > 0 && '、'}{doc.fileName}
                    </span>
                  ))}
                  {module.documents.length > 2 && (
                    <span className="text-xs text-gray-400"> 等 {module.documents.length} 个</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 右侧：点评面板 */}
        {commentsOpen && (
          <div className="w-80 border-l border-gray-100 bg-gray-50/50 flex flex-col" style={{ maxHeight: '600px' }}>
            <div className="px-4 py-3 border-b border-gray-100 bg-white">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  标注点评
                </h4>
                <button
                  type="button"
                  onClick={() => setCommentsOpen(false)}
                  className="text-gray-400 hover:text-gray-600 p-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* 点评输入框 */}
            <div className="px-4 py-3 border-b border-gray-100 bg-white">
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="对模块内容进行标注点评..."
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-400 resize-none"
              />
              <div className="flex justify-end mt-2">
                <button
                  type="button"
                  onClick={handleSubmitComment}
                  disabled={!newComment.trim() || submittingComment}
                  className="px-3 py-1.5 bg-primary-500 text-white text-xs font-medium rounded-lg hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submittingComment ? '发布中...' : '发布点评'}
                </button>
              </div>
            </div>

            {/* 点评列表 */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {commentsLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500"></div>
                </div>
              ) : comments.length === 0 ? (
                <div className="text-center py-6 text-sm text-gray-400">
                  暂无点评，快来发表第一条点评吧
                </div>
              ) : (
                comments.map(comment => (
                  <div key={comment.id} className="bg-white rounded-lg p-3 border border-gray-100">
                    {/* 一级点评 */}
                    <div className="flex items-start gap-2">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-white text-xs font-medium flex items-center justify-center flex-shrink-0">
                        {(comment.user.name || comment.user.email || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-xs font-medium text-gray-900">
                            {comment.user.name || comment.user.email}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {formatTime(comment.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{comment.content}</p>
                      </div>
                    </div>

                    {/* 回复列表 */}
                    {comment.replies && comment.replies.length > 0 && (
                      <div className="mt-2 ml-9 space-y-2">
                        {comment.replies.map(reply => (
                          <div key={reply.id} className="flex items-start gap-2">
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-gray-400 to-gray-500 text-white text-[10px] font-medium flex items-center justify-center flex-shrink-0">
                              {(reply.user.name || reply.user.email || '?').charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-xs font-medium text-gray-900">
                                  {reply.user.name || reply.user.email}
                                </span>
                                <span className="px-1.5 py-0.5 bg-primary-50 text-primary-600 text-[9px] rounded">
                                  维护人
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  {formatTime(reply.createdAt)}
                                </span>
                              </div>
                              <p className="text-xs text-gray-700 whitespace-pre-wrap break-words">{reply.content}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 回复输入框（仅维护人可见） */}
                    {canEdit && (
                      <div className="mt-2 ml-9">
                        {replyingTo === comment.id ? (
                          <div className="space-y-1.5">
                            <textarea
                              value={replyContent}
                              onChange={e => setReplyContent(e.target.value)}
                              placeholder={`回复 ${comment.user.name || comment.user.email}...`}
                              rows={2}
                              className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-primary-400 resize-none"
                            />
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setReplyingTo(null)
                                  setReplyContent('')
                                }}
                                className="px-2 py-1 text-[11px] text-gray-500 hover:text-gray-700"
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSubmitReply(comment.id)}
                                disabled={!replyContent.trim() || submittingReply}
                                className="px-2.5 py-1 bg-primary-500 text-white text-[11px] font-medium rounded hover:bg-primary-600 disabled:opacity-50"
                              >
                                {submittingReply ? '回复中...' : '回复'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setReplyingTo(comment.id)
                              setReplyContent('')
                            }}
                            className="text-[11px] text-gray-400 hover:text-primary-600"
                          >
                            回复
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* 文档预览模态框 */}
      {previewDoc && (
        <DocumentPreviewModal
          open={!!previewDoc}
          onClose={() => setPreviewDoc(null)}
          fileName={previewDoc.fileName}
          fileUrl={previewDoc.fileUrl}
          fileType={previewDoc.fileType}
        />
      )}
    </div>
  )
}

// ── 工具函数 ──

/** 格式化时间显示 */
function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 7) return `${days} 天前`
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** 获取模块摘要（收起时显示） */
function getModuleSummary(moduleType: string, result: Record<string, unknown>): string {
  try {
    if (moduleType === 'INDUSTRY') {
      const stage = result.developmentStage as string
      const size = result.marketSize as string
      const trl = result.trlLevel as string
      return [stage && `发展阶段：${stage}`, size && `市场规模：${size}`, trl && `TRL：${trl}`].filter(Boolean).join('；')
    }
    if (moduleType === 'COMPETITION') {
      const competitors = result.competitors as unknown[]
      const landscape = result.competitiveLandscape as string
      return [competitors && `共 ${Array.isArray(competitors) ? competitors.length : 0} 个竞争对手`, landscape].filter(Boolean).join('；')
    }
    if (result.summary && typeof result.summary === 'string') {
      return result.summary
    }
    // 默认：取前 3 个 key-value
    const entries = Object.entries(result).slice(0, 3)
    return entries.map(([k, v]) => `${k}：${typeof v === 'string' ? v : Array.isArray(v) ? `${v.length} 项` : JSON.stringify(v)}`).join('；')
  } catch {
    return ''
  }
}

// ── AI 结果渲染组件 ──

function AIResultRenderer({ moduleType, result }: { moduleType: string; result: Record<string, unknown> }) {
  const renderValue = (value: unknown): string => {
    if (value === null || value === undefined) return '-'
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
    return JSON.stringify(value)
  }

  const renderArray = (arr: unknown[], label: string) => {
    if (!Array.isArray(arr) || arr.length === 0) return null
    return (
      <div className="mb-2">
        <div className="text-xs text-gray-500 mb-1">{label}</div>
        <ul className="list-disc list-inside text-gray-700">
          {arr.map((item, i) => (
            <li key={i}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
          ))}
        </ul>
      </div>
    )
  }

  const renderObject = (obj: Record<string, unknown>, label: string) => {
    if (!obj || typeof obj !== 'object') return null
    return (
      <div className="mb-2">
        <div className="text-xs text-gray-500 mb-1">{label}</div>
        <div className="pl-3 border-l-2 border-gray-200">
          {Object.entries(obj).map(([k, v]) => (
            <div key={k} className="text-xs flex gap-2">
              <span className="text-gray-500">{k}:</span>
              <span className="text-gray-700">{renderValue(v)}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // 根据模块类型定制渲染
  if (moduleType === 'INDUSTRY') {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <div><span className="text-gray-500">发展阶段:</span> {renderValue(result.developmentStage)}</div>
          <div><span className="text-gray-500">市场规模:</span> {renderValue(result.marketSize)}</div>
          <div><span className="text-gray-500">增长率:</span> {renderValue(result.growthRate)}</div>
          <div><span className="text-gray-500">TRL 等级:</span> {renderValue(result.trlLevel)} ({renderValue(result.trlDescription)})</div>
        </div>
        {renderArray(result.keyTrends as unknown[], '关键趋势')}
        {renderArray(result.challenges as unknown[], '主要挑战')}
      </div>
    )
  }

  if (moduleType === 'COMPETITION') {
    const competitors = result.competitors as Array<Record<string, unknown>>
    if (!Array.isArray(competitors)) return <div className="text-gray-500">暂无竞争分析数据</div>
    return (
      <div className="space-y-3">
        {competitors.map((c, i) => (
          <div key={i} className="p-3 bg-white/60 rounded-lg border border-blue-50">
            <div className="font-medium text-gray-900 mb-2">{renderValue(c.projectName)}</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-gray-500">产品定位:</span> {renderValue(c.productPositioning)}</div>
              <div><span className="text-gray-500">市场策略:</span> {renderValue(c.marketStrategy)}</div>
              <div><span className="text-gray-500">业务进展:</span> {renderValue(c.businessProgress)}</div>
              <div><span className="text-gray-500">团队背景:</span> {renderValue(c.teamBackground)}</div>
              <div><span className="text-gray-500">最近轮次:</span> {renderValue(c.latestRound)}</div>
              <div><span className="text-gray-500">融资金额:</span> {renderValue(c.amount)}</div>
            </div>
          </div>
        ))}
        {result.competitiveLandscape && (
          <div className="text-xs text-gray-600 pt-2 border-t border-gray-100">
            <span className="font-medium">竞争格局总结:</span> {renderValue(result.competitiveLandscape)}
          </div>
        )}
      </div>
    )
  }

  if (moduleType === 'BUSINESS_DD') {
    return (
      <div className="space-y-3">
        {renderArray(result.topCustomers as unknown[], '前十大客户')}
        {renderArray(result.signedOrders as unknown[], '已签订单')}
        {renderArray(result.intentOrders as unknown[], '意向订单')}
        {renderArray(result.customerReviews as unknown[], '客户评价')}
      </div>
    )
  }

  if (moduleType === 'FINANCIAL_DD') {
    return (
      <div className="space-y-2">
        {renderObject(result.revenue as Record<string, unknown>, '营收')}
        {renderObject(result.profit as Record<string, unknown>, '利润')}
        {renderObject(result.cashFlow as Record<string, unknown>, '现金流')}
        {renderObject(result.balanceSheet as Record<string, unknown>, '资产负债')}
        {renderObject(result.keyMetrics as Record<string, unknown>, '关键指标')}
        {renderArray(result.risks as unknown[], '财务风险')}
      </div>
    )
  }

  if (moduleType === 'TEAM') {
    return (
      <div className="space-y-3">
        {result.founder && renderObject(result.founder as Record<string, unknown>, '创始人')}
        {renderArray(result.coreMembers as unknown[], '核心成员')}
        {result.teamStrength && (
          <div className="text-xs"><span className="text-gray-500">团队优势:</span> {renderValue(result.teamStrength)}</div>
        )}
      </div>
    )
  }

  if (moduleType === 'COMPANY') {
    return (
      <div className="space-y-2">
        {renderObject(result.basicInfo as Record<string, unknown>, '基本信息')}
        {renderArray(result.shareholderStructure as unknown[], '股权结构')}
        {renderArray(result.developmentHistory as unknown[], '发展历程')}
        {result.businessScope && (
          <div className="text-xs"><span className="text-gray-500">经营范围:</span> {renderValue(result.businessScope)}</div>
        )}
      </div>
    )
  }

  // 默认渲染：显示所有 key-value
  return (
    <div className="space-y-1">
      {Object.entries(result).map(([k, v]) => {
        if (k === 'summary') return null
        if (Array.isArray(v)) return renderArray(v, k)
        if (typeof v === 'object' && v !== null) return renderObject(v as Record<string, unknown>, k)
        return (
          <div key={k} className="text-xs flex gap-2">
            <span className="text-gray-500">{k}:</span>
            <span className="text-gray-700">{renderValue(v)}</span>
          </div>
        )
      })}
    </div>
  )
}
