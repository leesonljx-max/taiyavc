'use client'

/**
 * 投研分析 · 可视化报告页
 *
 * 三栏一体化布局：
 * - 左侧：串珠式目录导航（scroll-spy 滚动联动，显示分析状态与待回答数）
 * - 中间：报告正文（Hero 核心数据大卡片 + 9 大模块，核心数据加粗提亮）
 * - 右侧：提问与回答面板
 *
 * 框选提问：投资合伙人/管理员在正文框选文本 → 浮动"提问"按钮 →
 * 问题锚定到对应字段（quoteField），字段旁显示 💬 标志，右侧面板展示，
 * 项目维护人/辅助维护人可回答。
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/DashboardLayout'
import ReportView from '@/components/research/ReportView'
import QuestionPanel, { type PanelQuestion } from '@/components/research/QuestionPanel'
import { MODULE_TYPE_LABELS, ALL_MODULE_TYPES, type ResearchModuleType } from '@/lib/research-permissions'

// ── 类型 ──

interface ViewProject {
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
  financingRound: string | null
  createdById: string
  members: { userId: string }[]
}

interface ViewModule {
  id: string
  moduleType: string
  content: string | null
  aiJson: string | null
  aiSummary: string | null
  analyzedAt: string | null
}

const STAGE_LABELS: Record<string, string> = {
  INITIAL_TALK: '初聊', PRE_DD: 'PreDD', PROJECT_INITIATION: '立项',
  DUE_DILIGENCE: '尽调', AGREEMENT: '协议', CLOSING: '交割', POST_INVESTMENT: '投后',
}

/** 解析模块 JSON（aiJson 或手动 content） */
function parseModuleData(m: ViewModule): Record<string, unknown> | null {
  const raw = m.aiJson || m.content
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// ── 主组件 ──

export default function ResearchViewPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const { data: session, status } = useSession()
  const userRole = session?.user?.role as string | undefined
  const currentUserId = session?.user?.id as string | undefined

  const [project, setProject] = useState<ViewProject | null>(null)
  const [modules, setModules] = useState<ViewModule[]>([])
  const [questions, setQuestions] = useState<PanelQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 串珠导航激活态
  const [activeModule, setActiveModule] = useState<string>('PROJECT')

  // 框选提问状态
  const reportRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<{
    text: string; fieldKey: string; moduleType: string; x: number; y: number
  } | null>(null)
  const [askModal, setAskModal] = useState<{ text: string; fieldKey: string; moduleType: string } | null>(null)
  const [askContent, setAskContent] = useState('')
  const [asking, setAsking] = useState(false)

  // 面板联动高亮
  const [highlightQuestionId, setHighlightQuestionId] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 权限
  const canAsk = userRole === 'ADMIN' || userRole === 'INVESTMENT_PARTNER'
  const canAnswer = useMemo(() => {
    if (!project) return false
    const memberIds = project.members.map(m => m.userId)
    return userRole === 'ADMIN' || userRole === 'INVESTMENT_PARTNER' ||
      project.createdById === currentUserId || memberIds.includes(currentUserId || '')
  }, [project, userRole, currentUserId])

  // ── 数据加载 ──

  const fetchQuestions = useCallback(async () => {
    try {
      const res = await fetch(`/api/research/${params.projectId}/questions`)
      const data = await res.json()
      if (res.ok) setQuestions(data.questions || [])
    } catch { /* 忽略 */ }
  }, [params.projectId])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/research/${params.projectId}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error || '加载失败'); return }
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
    fetchQuestions()
  }, [status, fetchData, fetchQuestions])

  // ── 串珠导航：scroll-spy ──

  useEffect(() => {
    if (loading || !project) return
    const sections = ['PROJECT', ...ALL_MODULE_TYPES]
      .map(id => document.getElementById(`section-${id}`))
      .filter((el): el is HTMLElement => !!el)
    if (sections.length === 0) return

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveModule(entry.target.id.replace('section-', ''))
          }
        }
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0 }
    )
    sections.forEach(s => observer.observe(s))
    return () => observer.disconnect()
  }, [loading, project])

  const scrollToSection = useCallback((id: string) => {
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // ── 框选提问 ──

  useEffect(() => {
    if (!canAsk) return
    const onMouseUp = (e: MouseEvent) => {
      // 忽略在提问弹窗内的操作
      if ((e.target as HTMLElement)?.closest?.('[data-ask-ui]')) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.toString().trim()) { setSelection(null); return }
      const text = sel.toString().trim()
      if (text.length < 2 || !sel.anchorNode) { setSelection(null); return }

      // 必须框选在报告正文区域内
      if (!reportRef.current?.contains(sel.anchorNode)) { setSelection(null); return }

      // 向上查找 data-field 锚点
      let node: HTMLElement | null = sel.anchorNode instanceof HTMLElement
        ? sel.anchorNode
        : sel.anchorNode.parentElement
      let fieldKey = ''
      while (node && node !== reportRef.current) {
        if (node.dataset?.field) { fieldKey = node.dataset.field; break }
        node = node.parentElement
      }
      // 向上查找所属模块
      let moduleType = 'PROJECT'
      let n: HTMLElement | null = sel.anchorNode instanceof HTMLElement
        ? sel.anchorNode
        : sel.anchorNode.parentElement
      while (n && n !== reportRef.current) {
        if (n.dataset?.module) { moduleType = n.dataset.module; break }
        n = n.parentElement
      }
      // Hero 区（PROJECT）的问题挂到 COMPANY 模块
      if (moduleType === 'PROJECT' && fieldKey) moduleType = 'COMPANY'

      const rect = sel.getRangeAt(0).getBoundingClientRect()
      setSelection({ text: text.substring(0, 500), fieldKey, moduleType, x: rect.left + rect.width / 2, y: rect.top })
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [canAsk])

  const submitQuestion = async () => {
    if (!askModal || !askContent.trim()) return
    setAsking(true)
    try {
      const res = await fetch(
        `/api/research/${params.projectId}/${askModal.moduleType}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: askContent.trim(),
            quoteText: askModal.text,
            quoteField: askModal.fieldKey ? `${askModal.moduleType}.${askModal.fieldKey}` : null,
          }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || '提问失败')
        return
      }
      setAskModal(null)
      setAskContent('')
      setSelection(null)
      window.getSelection()?.removeAllRanges()
      fetchQuestions()
    } catch {
      alert('网络错误')
    } finally {
      setAsking(false)
    }
  }

  const handleReply = useCallback(async (questionId: string, content: string) => {
    const q = questions.find(x => x.id === questionId)
    if (!q) return
    const res = await fetch(
      `/api/research/${params.projectId}/${q.moduleType}/comments/${questionId}/replies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(data.error || '回答失败')
      throw new Error(data.error || '回答失败')
    }
    await fetchQuestions()
  }, [questions, params.projectId, fetchQuestions])

  // ── 派生数据 ──

  /** 字段级提问计数：quoteField（完整）+ 裸 fieldKey 双索引 */
  const questionCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const q of questions) {
      if (!q.quoteField) continue
      counts[q.quoteField] = (counts[q.quoteField] || 0) + 1
      const bare = q.quoteField.includes('.') ? q.quoteField.split('.').slice(1).join('.') : q.quoteField
      if (bare && bare !== q.quoteField) counts[bare] = (counts[bare] || 0) + 1
    }
    return counts
  }, [questions])

  /** 各模块待回答数 */
  const openCountByModule = useMemo(() => {
    const map: Record<string, number> = {}
    for (const q of questions) {
      if (q.replies.length === 0) map[q.moduleType] = (map[q.moduleType] || 0) + 1
    }
    return map
  }, [questions])

  const moduleByType = useMemo(() => {
    const map = new Map<string, ViewModule>()
    modules.forEach(m => map.set(m.moduleType, m))
    return map
  }, [modules])

  /** 字段提问标志点击 → 右侧面板定位高亮 */
  const handleMarkerClick = useCallback((moduleType: string, fieldKey: string) => {
    const target = questions.find(
      q => q.quoteField === `${moduleType}.${fieldKey}` || q.quoteField?.endsWith(`.${fieldKey}`)
    )
    if (target) {
      setHighlightQuestionId(target.id)
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      setTimeout(() => setHighlightQuestionId(null), 3000)
    }
  }, [questions])

  // ── 渲染 ──

  if (status === 'loading' || loading) {
    return (
      <DashboardLayout title="投研分析报告" subtitle="加载中...">
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  if (error || !project) {
    return (
      <DashboardLayout title="投研分析报告">
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
      title={`投研分析报告 · ${project.name}`}
      subtitle={project.companyFullName || project.industry || ''}
      actions={
        <div className="flex gap-2">
          <button
            onClick={() => router.push(`/research/${params.projectId}`)}
            className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200"
          >
            编辑模式
          </button>
          <button
            onClick={() => router.push('/research')}
            className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200"
          >
            ← 返回
          </button>
        </div>
      }
    >
      {canAsk && (
        <div className="mb-4 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-50 to-primary-50 border border-indigo-100 text-xs text-indigo-700 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          框选正文任意内容可发起提问，问题将锚定到对应字段；项目维护人可在右侧回答。
        </div>
      )}

      <div className="flex gap-5 items-start">
        {/* ═══ 左侧：串珠导航 ═══ */}
        <nav className="hidden lg:flex flex-col flex-shrink-0 sticky top-20 w-44 select-none">
          {/* 总览珠 */}
          <BeadNavItem
            active={activeModule === 'PROJECT'}
            analyzed
            label="项目总览"
            onClick={() => scrollToSection('PROJECT')}
          />
          {ALL_MODULE_TYPES.map(type => {
            const m = moduleByType.get(type)
            return (
              <BeadNavItem
                key={type}
                active={activeModule === type}
                analyzed={!!(m?.aiJson || m?.content)}
                label={MODULE_TYPE_LABELS[type]}
                openQuestions={openCountByModule[type] || 0}
                onClick={() => scrollToSection(type)}
              />
            )
          })}
        </nav>

        {/* ═══ 中间：报告正文 ═══ */}
        <div ref={reportRef} className="flex-1 min-w-0 space-y-6">
          {/* Hero：项目总览 */}
          <section id="section-PROJECT" data-module="PROJECT" className="scroll-mt-24">
            <div className="rounded-2xl bg-gradient-to-br from-primary-600 via-blue-600 to-indigo-700 p-6 text-white shadow-xl shadow-primary-500/20 relative overflow-hidden">
              <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-white/10 pointer-events-none" />
              <div className="absolute -bottom-20 -left-10 w-48 h-48 rounded-full bg-white/5 pointer-events-none" />

              <div className="relative">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full bg-white/20 text-xs font-semibold backdrop-blur">
                        {STAGE_LABELS[project.followStage] || project.followStage}
                      </span>
                      {project.industry && (
                        <span className="px-2 py-0.5 rounded-full bg-white/20 text-xs font-semibold backdrop-blur">
                          {project.industry}
                        </span>
                      )}
                      {project.financingRound && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-400/90 text-amber-950 text-xs font-bold">
                          {project.financingRound}
                        </span>
                      )}
                    </div>
                    <h1 className="text-2xl md:text-3xl font-extrabold mt-2 tracking-tight">{project.name}</h1>
                    {project.companyFullName && (
                      <p className="text-sm text-white/70 mt-0.5">{project.companyFullName}</p>
                    )}
                    {project.companyPosition && (
                      <p className="text-sm text-amber-200 font-semibold mt-2" data-field="companyPosition">
                        {project.companyPosition}
                      </p>
                    )}
                  </div>
                </div>

                {/* 核心数据大卡片 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
                  <HeroStat label="融资金额" value={project.totalAmount || '-'} accent />
                  <HeroStat label="已筹金额" value={project.raisedAmount || '暂无'} />
                  <HeroStat label="核心优势" value={project.coreAdvantage || '待补充'} small />
                  <HeroStat label="主要产品" value={project.mainProducts || '待补充'} small />
                </div>

                {project.description && (
                  <div className="mt-4 rounded-xl bg-white/10 backdrop-blur px-4 py-3 text-sm leading-relaxed text-white/90 select-text" data-field="description">
                    {project.description}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* 9 大模块 */}
          {ALL_MODULE_TYPES.map(type => {
            const m = moduleByType.get(type)
            const data = m ? parseModuleData(m) : null
            return (
              <section
                key={type}
                id={`section-${type}`}
                data-module={type}
                className="scroll-mt-24 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 md:p-6"
              >
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">
                      {ALL_MODULE_TYPES.indexOf(type) + 1}
                    </span>
                    <div>
                      <h2 className="text-base font-bold text-gray-900">{MODULE_TYPE_LABELS[type]}</h2>
                      {m?.analyzedAt && (
                        <p className="text-[11px] text-gray-400">
                          AI 分析于 {new Date(m.analyzedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>
                  {openCountByModule[type] > 0 && (
                    <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-600 text-xs font-bold border border-amber-200">
                      {openCountByModule[type]} 个待回答
                    </span>
                  )}
                </div>

                {m?.aiSummary && data && (
                  <div className="mb-4 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 px-4 py-3 select-text" data-field="summary">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      <span className="text-xs font-bold text-amber-700">摘要</span>
                    </div>
                    <p className="text-sm text-gray-800 leading-relaxed font-medium">{m.aiSummary}</p>
                  </div>
                )}

                <ReportView
                  moduleType={type}
                  data={data}
                  questionCounts={questionCounts}
                  onQuestionMarkerClick={fieldKey => handleMarkerClick(type, fieldKey)}
                />
              </section>
            )
          })}
        </div>

        {/* ═══ 右侧：问答面板 ═══ */}
        <div
          ref={panelRef}
          className="hidden xl:block w-80 flex-shrink-0 sticky top-20 max-h-[calc(100vh-6rem)] bg-white rounded-2xl shadow-sm border border-primary-100 overflow-hidden"
        >
          <QuestionPanel
            questions={questions}
            canAnswer={canAnswer}
            onReply={handleReply}
            onLocate={scrollToSection}
            highlightId={highlightQuestionId}
          />
        </div>
      </div>

      {/* 移动端问答面板（xl 以下折叠） */}
      <details className="xl:hidden mt-6 bg-white rounded-2xl shadow-sm border border-primary-100 overflow-hidden">
        <summary className="px-4 py-3 cursor-pointer text-sm font-bold text-gray-900 flex items-center gap-2 select-none">
          <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          提问与回答（{questions.length}）
        </summary>
        <div className="max-h-[70vh]">
          <QuestionPanel
            questions={questions}
            canAnswer={canAnswer}
            onReply={handleReply}
            onLocate={scrollToSection}
            highlightId={highlightQuestionId}
          />
        </div>
      </details>

      {/* ═══ 框选浮动提问按钮 ═══ */}
      {selection && canAsk && (
        <button
          data-ask-ui
          onClick={() => {
            setAskModal({ text: selection.text, fieldKey: selection.fieldKey, moduleType: selection.moduleType })
            setAskContent('')
          }}
          style={{ left: selection.x, top: selection.y - 44 }}
          className="fixed z-50 -translate-x-1/2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-600 text-white text-xs font-bold shadow-lg shadow-primary-500/40 hover:bg-primary-700 transition-colors animate-bounce-slow"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          就选中内容提问
        </button>
      )}

      {/* ═══ 提问弹窗 ═══ */}
      {askModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" data-ask-ui>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary-100 bg-gradient-to-r from-primary-50/60 to-transparent">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-500 to-indigo-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </span>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">发起提问</h3>
                  <p className="text-[11px] text-gray-400">
                    {MODULE_TYPE_LABELS[askModal.moduleType as ResearchModuleType] || askModal.moduleType}
                    {askModal.fieldKey ? ` · ${askModal.fieldKey}` : ''}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAskModal(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1.5">引用原文</p>
                <div className="rounded-xl bg-gray-50 border-l-4 border-primary-300 px-3 py-2.5 max-h-32 overflow-y-auto">
                  <p className="text-sm text-gray-600 leading-relaxed italic">“{askModal.text}”</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1.5">问题内容</p>
                <textarea
                  value={askContent}
                  onChange={e => setAskContent(e.target.value)}
                  placeholder="请输入您的问题，项目维护人将收到通知并回答..."
                  rows={4}
                  autoFocus
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-300 focus:border-primary-400 resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-gray-100 bg-gray-50/50">
              <button
                onClick={() => setAskModal(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl font-medium"
              >
                取消
              </button>
              <button
                onClick={submitQuestion}
                disabled={asking || !askContent.trim()}
                className="px-5 py-2 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-primary-500 to-indigo-500 hover:from-primary-600 hover:to-indigo-600 disabled:opacity-50 shadow-md shadow-primary-500/30"
              >
                {asking ? '提交中...' : '提交提问'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

// ── 子组件 ──

/** Hero 核心数据卡片 */
function HeroStat({ label, value, accent, small }: { label: string; value: string; accent?: boolean; small?: boolean }) {
  return (
    <div
      data-field={label}
      className={`rounded-xl px-3.5 py-3 backdrop-blur border ${
        accent ? 'bg-amber-400/90 border-amber-300 text-amber-950' : 'bg-white/10 border-white/20 text-white'
      }`}
    >
      <p className={`text-[11px] font-semibold ${accent ? 'text-amber-800' : 'text-white/70'} uppercase tracking-wide`}>{label}</p>
      <p className={`${small ? 'text-xs' : 'text-lg'} font-extrabold mt-0.5 leading-snug break-words select-text`}>{value}</p>
    </div>
  )
}

/** 串珠导航节点 */
function BeadNavItem({
  active, analyzed, label, openQuestions = 0, onClick,
}: {
  active: boolean
  analyzed: boolean
  label: string
  openQuestions?: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group relative flex items-center gap-2.5 pl-0 py-2 text-left"
    >
      {/* 串珠连线（贯穿背景） */}
      <span className="absolute left-[9px] top-0 bottom-0 w-px bg-gray-200 group-first:hidden" />
      {/* 珠子 */}
      <span
        className={`relative z-10 w-[19px] h-[19px] rounded-full border-2 flex items-center justify-center transition-all duration-300 flex-shrink-0 ${
          active
            ? 'bg-gradient-to-br from-primary-500 to-indigo-600 border-primary-400 scale-125 shadow-md shadow-primary-500/40'
            : analyzed
              ? 'bg-primary-100 border-primary-400'
              : 'bg-white border-gray-300'
        }`}
      >
        {analyzed && !active && <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />}
        {active && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
      </span>
      {/* 标签 */}
      <span className="flex items-center gap-1 min-w-0">
        <span
          className={`text-xs truncate transition-colors ${
            active ? 'text-primary-700 font-bold' : analyzed ? 'text-gray-600 font-medium' : 'text-gray-400'
          }`}
        >
          {label}
        </span>
        {openQuestions > 0 && (
          <span className="flex-shrink-0 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
            {openQuestions}
          </span>
        )}
      </span>
    </button>
  )
}
