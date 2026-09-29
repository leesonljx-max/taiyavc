'use client'

/**
 * 尽调工作台 v2（Shell）
 *
 * - 前台：九大模块九宫格（核心问题 + 资料完整度进度条）；
 *   点击模块展开详情区（上版样式）：四段 stepper（资料归集→事实抽取→人工复核→报告冻结）+
 *   专属主视觉图（技术图谱/市场漏斗/订单收入桥/竞争矩阵等，节点由事实状态驱动）| 事实卡 +
 *   人工结论 + 证据与行动 + 投委会问答（合伙人提问 / 维护人回答）；
 *   每模块可单独「开始分析」（AI 从资料提取事实卡与行动）；
 *   右上「生成尽调报告」按钮（九模块资料完整才变蓝，灰色点击提示缺失部分）；
 *   报告生成后出现第 10 模块「投资决策」（合伙人投票 / 维护人看进度）
 * - 背面（资料中心）：点击「资料中心」工作台整体 3D 翻转过来；
 *   每模块可上传文档（自动提取全文）、上传截图、填写/添加多个文本框
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import DocumentPreviewModal from '@/components/DocumentPreviewModal'
import RichTextEditor from '@/components/RichTextEditor'
import { compressImage } from '@/lib/image-compress'
import { ModuleVisual, MODULE_VISUAL_LABELS, type VisualTaskStats } from './ModuleVisuals'
import TeamEvaluationCard from './TeamEvaluationCard'
import { DD_EVIDENCE_GRADE_LABELS, DD_EVIDENCE_STATUS_LABELS } from '@/lib/dd-workbench/constants'

// ── 类型（与后端 resources.ts 对齐） ──

interface DDResourceDoc { id: string; fileName: string; fileUrl: string; fileType: string; fileSize: number; text: string; uploadedAt: string }
interface DDTextBlock { id: string; content: string; createdAt: string }
interface DDScreenshot { id: string; url: string; fileName: string; uploadedAt: string }
interface DDModuleReport { summary: string; opportunities: string[]; risks: string[]; generatedAt: string }

/** 事实卡条目（AI 从模块资料提取） */
interface DDFact { id: string; fact: string; source: string; grade: 'A' | 'B' | 'C' | 'D'; status: 'PENDING' | 'CONFIRMED' | 'CONFLICT' }
/** 单模块 AI 分析结果：事实卡 + 下一步行动 */
interface DDModuleAnalysis { facts: DDFact[]; actions: string[]; analyzedAt: string }

/** 投委会问答条目 */
interface DDQAItem {
  id: string
  question: string
  questionerName: string
  createdAt: string
  answer: string | null
  answererName: string | null
  answeredAt: string | null
}

interface ModuleResource {
  moduleKey: string
  moduleName: string
  coreQuestion: string
  documents: DDResourceDoc[]
  textBlocks: DDTextBlock[]
  screenshots: DDScreenshot[]
  report: DDModuleReport | null
  analysis: DDModuleAnalysis | null
  conclusion: string | null
  /** 仅团队与治理：团队评价确认状态（null=未生成；false=草稿中；true=已确认） */
  teamEvaluationConfirmed: boolean | null
  updatedAt: string
}

interface DecisionState {
  reportReady: boolean
  finalStatus: 'PENDING' | 'INVEST' | 'NO_INVEST'
  minPartners: number
  decisionCount: number
  canDecide: boolean
  myDecision: { decision: string; amount: number | null; reason: string | null } | null
  decisions: Array<{ partnerName: string; partnerId: string; decision: string; amount: number | null; reason: string | null; updatedAt: string }>
}

/** 第 10 模块伪 key（前台选中态） */
const DECISION_KEY = '__INVESTMENT_DECISION__'
const DECISION_LABELS: Record<string, string> = { INVEST: '投资', NO_INVEST: '不投资', UNDECIDED: '纠结中' }

/** 富文本渲染安全过滤：移除 script/事件属性（项目惯例） */
function sanitizeRichText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
}

function resourceCount(res: ModuleResource) {
  return {
    docs: res.documents.length,
    texts: res.textBlocks.filter(t => t.content.trim()).length,
    shots: res.screenshots.length,
  }
}
function isComplete(res: ModuleResource) {
  const c = resourceCount(res)
  const hasData = c.docs > 0 || c.texts > 0 || c.shots > 0
  // 团队与治理：评价表存在但未确认 → 模块视为不完整（阻塞报告生成）
  if (res.moduleKey === 'TEAM_GOVERNANCE' && res.teamEvaluationConfirmed === false) return false
  return hasData
}
/** 资料完整度（0-100）：文档 34% + 非空文本 33% + 截图 33%（进度条数据源） */
function moduleProgress(res: ModuleResource) {
  let score = 0
  if (res.documents.length > 0) score += 34
  if (res.textBlocks.some(t => t.content.trim())) score += 33
  if (res.screenshots.length > 0) score += 33
  return Math.min(100, score)
}

export default function DDWorkbenchShell({
  projectId,
  projectName,
  canEdit,
  userRole,
}: {
  projectId: string
  projectName: string
  canEdit: boolean
  userRole: string
}) {
  const [resources, setResources] = useState<ModuleResource[]>([])
  const [allComplete, setAllComplete] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 3D 翻转：front=工作台 / back=资料中心
  const [flipped, setFlipped] = useState(false)
  // 前台选中的模块（下方展示其全部资料；DECISION_KEY=投资决策面板）
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // 资料中心展开的模块
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const [generating, setGenerating] = useState(false)
  const [reportMsg, setReportMsg] = useState('')
  const [decision, setDecision] = useState<DecisionState | null>(null)

  const fetchResources = useCallback(async () => {
    try {
      const res = await fetch(`/api/dd/resources/${projectId}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error || '加载失败'); return }
      setResources(data.resources || [])
      setAllComplete(!!data.allComplete)
    } catch { setError('网络错误') }
  }, [projectId])

  const fetchDecision = useCallback(async () => {
    try {
      const res = await fetch(`/api/dd/decision/${projectId}`)
      const data = await res.json()
      if (res.ok) setDecision(data)
    } catch { /* 决策加载失败不阻塞 */ }
  }, [projectId])

  useEffect(() => {
    Promise.all([fetchResources(), fetchDecision()]).finally(() => setLoading(false))
  }, [fetchResources, fetchDecision])

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchResources(), fetchDecision()])
  }, [fetchResources, fetchDecision])

  // ── 生成尽调报告 ──
  const handleGenerateReport = async () => {
    if (generating) return
    if (!allComplete) {
      const missing = resources.filter(r => !isComplete(r)).map(r => r.moduleName)
      setReportMsg(`资料不完整，缺失模块：${missing.join('、')}。请到资料中心补充（上传文档 / 填写文本 / 上传截图，任一项即可）`)
      return
    }
    setGenerating(true)
    setReportMsg('AI 正在按九大模块生成尽调报告（约 1-3 分钟）...')
    try {
      const res = await fetch(`/api/dd/resources/${projectId}/report`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setReportMsg(data.error || '生成失败'); return }
      setReportMsg('')
      await refreshAll()
    } catch {
      setReportMsg('网络错误（AI 生成耗时较长，请稍后重试）')
    } finally {
      setGenerating(false)
    }
  }

  const selected = resources.find(r => r.moduleKey === selectedKey) || null
  const reportReady = resources.length > 0 && resources.every(r => r.report !== null)
  const completedCount = resources.filter(isComplete).length

  if (loading) {
    return (
      <div className="dd-card rounded-2xl shadow-sm border p-10 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8d84e0]"></div>
      </div>
    )
  }

  return (
    <div className="grid" style={{ perspective: '1800px' }}>
      {/* ── 正面：尽调工作台 ── */}
      <div
        className="col-start-1 row-start-1"
        style={{
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          transition: 'transform 0.7s cubic-bezier(0.4, 0.2, 0.2, 1)',
          backfaceVisibility: 'hidden',
        }}
      >
        <div className="dd-card rounded-2xl shadow-sm border p-6">
          {/* 头部 */}
          <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#b6b1ee] to-[#8d84e0] flex items-center justify-center text-white">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg>
                </span>
                尽调工作台 · {projectName}
              </h2>
              <p className="text-xs text-gray-400 mt-1">点击模块查看资料与报告 · 资料完整后可生成尽调报告</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleGenerateReport}
                disabled={generating || !canEdit}
                className={`px-4 py-2 text-sm font-bold rounded-xl shadow-md transition-all ${
                  allComplete && canEdit && !generating
                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-500/25'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none'
                }`}
                title={!allComplete ? '九大模块资料完整后变为蓝色可点击' : '按九大模块生成尽调报告'}
              >
                {generating ? '报告生成中...' : reportReady ? '🔄 重新生成尽调报告' : '生成尽调报告'}
              </button>
              <button
                onClick={() => setFlipped(true)}
                className="px-4 py-2 bg-gradient-to-r from-[#b6b1ee] to-[#8d84e0] text-white text-sm font-bold rounded-xl shadow-md shadow-[#b6b1ee]/40 hover:from-[#a8a2e8] hover:to-[#7d73d8]"
              >
                📂 资料中心
              </button>
            </div>
          </div>

          {reportMsg && (
            <div className={`mb-4 p-3 rounded-xl text-xs border ${allComplete ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{reportMsg}</div>
          )}
          {error && <div className="mb-4 p-3 rounded-xl text-xs bg-red-50 text-red-600 border border-red-100">{error}</div>}

          {/* 资料完整进度条 */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex-1 h-2 bg-[#efedfb] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-[#b6b1ee] to-[#8d84e0] rounded-full transition-all" style={{ width: `${resources.length ? (completedCount / resources.length) * 100 : 0}%` }} />
            </div>
            <span className="text-xs text-gray-500 flex-shrink-0">资料完整 {completedCount}/{resources.length} 模块</span>
          </div>

          {/* 模块九宫格（3×3）：核心问题 + 资料完整度进度条；报告生成后追加第 10 模块（投资决策） */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {resources.map((res, i) => {
              const c = resourceCount(res)
              const complete = isComplete(res)
              const analyzed = !!res.analysis
              const progress = moduleProgress(res)
              const active = selectedKey === res.moduleKey
              return (
                <button
                  key={res.moduleKey}
                  onClick={() => setSelectedKey(active ? null : res.moduleKey)}
                  className={`text-left p-3.5 rounded-xl border transition-all ${
                    active
                      ? 'border-[#8d84e0] bg-gradient-to-br from-[#efedfb] to-[#f7f5fd] shadow-md ring-2 ring-[#b6b1ee]/40'
                      : complete
                        ? 'border-[#ddd7f2] bg-white hover:border-[#b6b1ee] hover:shadow-sm'
                        : 'border-dashed border-gray-300 bg-gray-50/50 hover:border-[#b6b1ee]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-black text-[#8d84e0]">{String(i + 1).padStart(2, '0')}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      res.moduleKey === 'TEAM_GOVERNANCE' && res.teamEvaluationConfirmed === false
                        ? 'bg-amber-50 text-amber-600'
                        : analyzed
                          ? 'bg-blue-50 text-blue-600'
                          : complete
                            ? 'bg-amber-50 text-amber-600'
                            : 'bg-gray-100 text-gray-400'
                    }`}>
                      {res.moduleKey === 'TEAM_GOVERNANCE' && res.teamEvaluationConfirmed === false
                        ? '📋 待评价'
                        : res.moduleKey === 'TEAM_GOVERNANCE' && res.teamEvaluationConfirmed === true
                          ? '📋 已评价'
                          : analyzed
                            ? '✓ 已分析'
                            : complete
                              ? '待分析'
                              : '待补充'}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-gray-800 leading-tight">{res.moduleName}</p>
                  <p className="mt-1 text-[10px] text-gray-400 leading-snug truncate" title={res.coreQuestion}>{res.coreQuestion}</p>
                  {/* 资料完整度进度条 */}
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[9px] text-gray-400 mb-0.5">
                      <span>资料完整度</span>
                      <span className="font-bold">{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-[#efedfb] rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[#b6b1ee] to-[#8d84e0] rounded-full transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px] flex-wrap">
                    {c.docs > 0 && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">📄 {c.docs}</span>}
                    {c.texts > 0 && <span className="px-1.5 py-0.5 bg-teal-50 text-teal-600 rounded">📝 {c.texts}</span>}
                    {c.shots > 0 && <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">🖼 {c.shots}</span>}
                    {res.report && <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded">📊 报告</span>}
                    {c.docs + c.texts + c.shots === 0 && <span className="text-gray-300">待补充</span>}
                  </div>
                </button>
              )
            })}
            {/* 第 10 模块：投资决策（尽调报告生成后出现） */}
            {reportReady && decision && (
              <button
                onClick={() => setSelectedKey(selectedKey === DECISION_KEY ? null : DECISION_KEY)}
                className={`text-left p-3.5 rounded-xl border-2 transition-all ${
                  selectedKey === DECISION_KEY
                    ? 'border-amber-400 bg-gradient-to-br from-amber-50 to-yellow-50/50 shadow-md ring-2 ring-amber-300/40'
                    : 'border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50/30 hover:shadow-sm hover:border-amber-400'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-black text-amber-600">10</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">决策</span>
                </div>
                <p className="text-sm font-bold text-gray-800 leading-tight">投资决策</p>
                <div className="mt-2">
                  {decision.finalStatus === 'INVEST' ? (
                    <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold">✅ 全票投资</span>
                  ) : decision.finalStatus === 'NO_INVEST' ? (
                    <span className="px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-[10px] font-bold">❌ 不投资</span>
                  ) : (
                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-bold">⏳ 待决策中 {decision.decisionCount}/{decision.minPartners}</span>
                  )}
                </div>
              </button>
            )}
          </div>

          {/* 前台：选中模块 → 下方展开详情区（主视觉/事实卡/结论/问答）；选中第 10 模块 → 投资决策面板 */}
          {selected && (
            <FrontModuleDetail
              module={selected}
              modules={resources}
              projectId={projectId}
              projectName={projectName}
              canEdit={canEdit}
              userRole={userRole}
              onSelectModule={(key: string) => setSelectedKey(key)}
              onOpenResourceCenter={() => { setExpandedKey(selected.moduleKey); setFlipped(true) }}
              onRefresh={fetchResources}
            />
          )}
          {selectedKey === DECISION_KEY && decision && (
            <DecisionPanel projectId={projectId} decision={decision} onRefresh={refreshAll} />
          )}
        </div>
      </div>

      {/* ── 背面：资料中心（3D 翻转过来） ── */}
      <div
        className="col-start-1 row-start-1"
        style={{
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(0deg)' : 'rotateY(-180deg)',
          transition: 'transform 0.7s cubic-bezier(0.4, 0.2, 0.2, 1)',
          backfaceVisibility: 'hidden',
        }}
      >
        <div className="dd-card rounded-2xl shadow-sm border p-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#8d84e0] to-[#6f63c9] flex items-center justify-center text-white">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                </span>
                资料中心 · {projectName}
              </h2>
              <p className="text-xs text-gray-400 mt-1">九大模块的文档、文本与截图都在这里管理 · 上传后前台模块与报告自动汇总</p>
            </div>
            <button onClick={() => setFlipped(false)} className="px-4 py-2 bg-white border border-[#ddd7f2] text-[#6f63c9] text-sm font-bold rounded-xl hover:bg-[#efedfb]">
              ← 返回工作台
            </button>
          </div>

          <div className="space-y-3">
            {resources.map((res, i) => (
              <ResourceCenterModule
                key={res.moduleKey}
                projectId={projectId}
                index={i}
                module={res}
                canEdit={canEdit}
                expanded={expandedKey === res.moduleKey}
                onToggle={() => setExpandedKey(expandedKey === res.moduleKey ? null : res.moduleKey)}
                onChanged={fetchResources}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═════ 前台：模块详情区（stepper + 专属主视觉/事实卡 + 人工结论 + 证据与行动 + 投委会问答） ═════

/** 投委会追问文案（按模块定制的会前关键问题） */
const IC_QUESTION_HINTS: Record<string, string> = {
  PROJECT_ENTITY: '本轮融资主体、历史股权安排与交割路径是否已由法务确认？',
  PRODUCT_TECHNOLOGY: '技术是否可第三方验证？量产能力与持续领先窗口期有多长？',
  TEAM_GOVERNANCE: '关键岗位补齐计划与股权激励安排是否与阶段目标匹配？',
  MARKET_CUSTOMERS: '市场空间假设是否有可核验的数据来源？客户需求真实性如何验证？',
  COMMERCIALIZATION: '在手订单的真实性与交付节奏？客户集中度和复购逻辑是否健康？',
  COMPETITION_MOATS: '相对头部竞品的差异化窗口期还有多久？壁垒是否可积累？',
  FINANCE_ECONOMICS: '增长、毛利与现金消耗是否自洽？本轮资金能支撑多长跑道？',
  LEGAL_COMPLIANCE: '产权、诉讼、数据合规是否存在影响交易结构的实质性风险？',
  VALUATION_DEAL: '估值区间、核心条款与退出路径是否与风险水平匹配？',
}

/** 证据等级徽章样式 */
const gradeStyles: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-indigo-100 text-indigo-700',
  D: 'bg-gray-200 text-gray-600',
}
/** 事实状态徽章样式 */
const factStatusStyles: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  CONFIRMED: 'bg-emerald-100 text-emerald-700',
  CONFLICT: 'bg-red-100 text-red-700',
}

function FrontModuleDetail({
  module,
  modules,
  projectId,
  projectName,
  canEdit,
  userRole,
  onSelectModule,
  onOpenResourceCenter,
  onRefresh,
}: {
  module: ModuleResource
  modules: ModuleResource[]
  projectId: string
  projectName: string
  canEdit: boolean
  userRole: string
  onSelectModule: (moduleKey: string) => void
  onOpenResourceCenter: () => void
  onRefresh: () => Promise<void>
}) {
  const moduleIdx = modules.findIndex(m => m.moduleKey === module.moduleKey)
  const visualLabel = MODULE_VISUAL_LABELS[module.moduleKey] || '框架'
  const isPartner = userRole === 'INVESTMENT_PARTNER' || userRole === 'ADMIN'

  const [view, setView] = useState<'visual' | 'facts'>('visual')
  const [conclusion, setConclusion] = useState(module.conclusion || '')
  const [savingConclusion, setSavingConclusion] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [opMsg, setOpMsg] = useState('')
  const [opErr, setOpErr] = useState('')
  const [previewDoc, setPreviewDoc] = useState<{ fileName: string; fileUrl: string; fileType: string } | null>(null)

  // 切换模块时重置视图与编辑器
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setConclusion(module.conclusion || '')
    setView('visual')
    setOpMsg('')
    setOpErr('')
  }, [module.moduleKey])
  // 保存结论刷新后同步回显
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setConclusion(module.conclusion || '') }, [module.conclusion])

  const c = resourceCount(module)
  const facts = module.analysis?.facts || []
  const factStats = {
    confirmed: facts.filter(f => f.status === 'CONFIRMED').length,
    pending: facts.filter(f => f.status === 'PENDING').length,
    conflict: facts.filter(f => f.status === 'CONFLICT').length,
  }

  // 主视觉节点状态由事实卡状态驱动（confirmed/pending/conflict 计数）
  const visualStats: VisualTaskStats = {
    status: module.analysis ? 'IN_PROGRESS' : 'PENDING',
    conclusion: module.conclusion,
    redFlagLevel: factStats.conflict > 0 ? 'HIGH' : 'NONE',
    evidenceCount: facts.length,
    confirmedEvidenceCount: factStats.confirmed,
    conflictEvidenceCount: factStats.conflict,
    pendingEvidenceCount: factStats.pending,
  }

  // 四段 stepper（资料驱动）：资料归集 → 事实抽取 → 人工复核 → 报告冻结
  const steps = [
    { key: 'collect', label: '资料归集', done: isComplete(module) },
    { key: 'extract', label: '事实抽取', done: !!module.analysis },
    { key: 'review', label: '人工复核', done: !!module.conclusion?.trim() },
    { key: 'freeze', label: '报告冻结', done: !!module.report },
  ]
  const currentStep = Math.max(0, steps.findIndex(s => !s.done))

  // ── 单模块 AI 分析：提取事实卡 + 行动 ──
  const runAnalyze = async () => {
    if (analyzing) return
    setAnalyzing(true)
    setOpMsg('AI 正在从该模块资料中提取事实卡与行动（约 30 秒）...')
    setOpErr('')
    try {
      const res = await fetch(`/api/dd/resources/${projectId}/${module.moduleKey}/analyze`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setOpMsg(''); setOpErr(data.error || '分析失败'); return }
      setOpMsg('')
      setView('facts')
      await onRefresh()
    } catch {
      setOpMsg('')
      setOpErr('网络错误（AI 分析耗时较长，请稍后重试）')
    } finally {
      setAnalyzing(false)
    }
  }

  // ── 保存人工结论 ──
  const saveConclusion = async () => {
    setSavingConclusion(true)
    setOpErr('')
    try {
      const res = await fetch(`/api/dd/resources/${projectId}/${module.moduleKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conclusion }),
      })
      const data = await res.json()
      if (!res.ok) { setOpErr(data.error || '结论保存失败'); return }
      setOpMsg('人工结论已保存 ✓')
      await onRefresh()
    } catch { setOpErr('网络错误') } finally { setSavingConclusion(false) }
  }

  // ── 更新事实状态（确认/冲突/重置） ──
  const updateFact = async (factId: string, status: string) => {
    setOpErr('')
    try {
      const res = await fetch(`/api/dd/resources/${projectId}/${module.moduleKey}/facts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factId, status }),
      })
      if (!res.ok) {
        const data = await res.json()
        setOpErr(data.error || '更新失败')
        return
      }
      await onRefresh()
    } catch { setOpErr('网络错误') }
  }

  return (
    <div className="mt-5 pt-5 border-t border-[#efedfb]">
      {/* ── 详情头部：模块定位 + 前后切换 + 视图切换 ── */}
      <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-3 rounded-t-2xl bg-slate-50/80 border border-gray-100 border-b-0">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="px-2 py-0.5 rounded-lg bg-blue-600 text-white text-[10px] font-black">
            模块 {String(moduleIdx + 1).padStart(2, '0')}
          </span>
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
            module.analysis
              ? 'bg-blue-50 text-blue-700 border-blue-200'
              : isComplete(module)
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-white text-gray-400 border-gray-200'
          }`}>
            {module.analysis ? '已分析' : isComplete(module) ? '待分析' : '待启动'}
          </span>
          <h3 className="font-bold text-gray-900">{module.moduleName}</h3>
          <span className="text-[11px] text-gray-400">{module.coreQuestion}</span>
          {/* 前后模块切换 */}
          <div className="flex items-center gap-0.5 ml-1">
            <button
              onClick={() => moduleIdx > 0 && onSelectModule(modules[moduleIdx - 1].moduleKey)}
              disabled={moduleIdx === 0}
              className="px-1.5 py-0.5 text-gray-400 hover:text-blue-600 disabled:opacity-30"
              title="上一模块"
            >
              ←
            </button>
            <button
              onClick={() => moduleIdx < modules.length - 1 && onSelectModule(modules[moduleIdx + 1].moduleKey)}
              disabled={moduleIdx >= modules.length - 1}
              className="px-1.5 py-0.5 text-gray-400 hover:text-blue-600 disabled:opacity-30"
              title="下一模块"
            >
              →
            </button>
          </div>
        </div>
        {/* 视图切换：专属视觉 | 事实卡 */}
        <div className="flex items-center bg-white border border-gray-200 rounded-xl p-0.5 gap-0.5">
          {([
            { key: 'visual' as const, label: `${visualLabel}图` },
            { key: 'facts' as const, label: '事实卡' },
          ]).map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                view === v.key ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 统一流形 stepper（资料驱动四段） ── */}
      <div className="px-4 py-2.5 border-x border-b border-gray-100 rounded-b-2xl flex items-center gap-1 overflow-x-auto mb-4">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1 flex-shrink-0">
            {i > 0 && <span className="text-gray-300 mx-0.5">→</span>}
            <button
              onClick={() => {
                if (s.key === 'collect') onOpenResourceCenter()
                else if (s.key === 'extract') setView('facts')
                else document.getElementById('dd-conclusion-editor')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                i === currentStep
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25'
                  : s.done
                    ? 'bg-blue-50 text-blue-600 border border-blue-100'
                    : 'bg-gray-50 text-gray-400 border border-gray-100 hover:text-gray-600'
              }`}
            >
              {s.done ? '✓ ' : ''}{s.label}
            </button>
          </div>
        ))}
        {factStats.conflict > 0 && (
          <span className="ml-3 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-red-100 text-red-600 flex-shrink-0">
            ⚑ {factStats.conflict} 条事实冲突待人工裁决
          </span>
        )}
      </div>

      {opMsg && <div className="mb-4 p-3 rounded-xl text-xs bg-blue-50 text-blue-700 border border-blue-100">{opMsg}</div>}
      {opErr && <div className="mb-4 p-3 rounded-xl text-xs bg-red-50 text-red-600 border border-red-100">{opErr}</div>}

      {/* ── 主区：双列（主视觉/事实卡/结论 | 证据与行动 + 投委会问答） ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* 左列 */}
        <div className="lg:col-span-3 space-y-4">
          {/* 单模块分析按钮 */}
          {canEdit && (
            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                onClick={runAnalyze}
                disabled={analyzing || !isComplete(module)}
                className={`px-4 py-2 text-sm font-bold rounded-xl shadow-md transition-all ${
                  isComplete(module) && !analyzing
                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-500/25'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none'
                }`}
              >
                {analyzing ? '⏳ AI 分析中...' : module.analysis ? '🔄 重新分析' : '▶ 开始分析'}
              </button>
              {module.analysis && !analyzing && (
                <span className="text-[10px] text-gray-400">上次分析：{new Date(module.analysis.analyzedAt).toLocaleString('zh-CN')}</span>
              )}
              {!isComplete(module) && (
                <button onClick={onOpenResourceCenter} className="text-[11px] text-[#6f63c9] hover:underline">
                  请先到资料中心上传该模块资料 →
                </button>
              )}
            </div>
          )}

          {/* 主视觉 / 事实卡 */}
          {view === 'visual' ? (
            <ModuleVisual moduleKey={module.moduleKey} task={visualStats} projectName={projectName} />
          ) : (
            <FactsCard facts={facts} canEdit={canEdit} onUpdateFact={updateFact} />
          )}

          {/* 人工结论（进入正式报告） */}
          <div id="dd-conclusion-editor">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-gray-500">
                人工结论 <span className="text-gray-300 font-normal">（结论先行 · 进入正式报告）</span>
              </span>
              {canEdit && (
                <button
                  onClick={saveConclusion}
                  disabled={savingConclusion || conclusion === (module.conclusion || '')}
                  className="text-xs px-3 py-1 bg-blue-50 text-blue-700 rounded-lg font-bold hover:bg-blue-100 disabled:opacity-40"
                >
                  {savingConclusion ? '保存中...' : '保存结论'}
                </button>
              )}
            </div>
            <textarea
              value={conclusion}
              onChange={e => setConclusion(e.target.value)}
              disabled={!canEdit}
              rows={4}
              placeholder={`回答核心问题「${module.coreQuestion}」：判断 + 关键依据 + 下一步动作`}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-300 disabled:bg-gray-50 disabled:text-gray-500 resize-y"
            />
          </div>

          {/* 团队评价表（仅团队与治理模块，必填：确认后模块才算完整） */}
          {module.moduleKey === 'TEAM_GOVERNANCE' && (
            <TeamEvaluationCard
              projectId={projectId}
              canEdit={canEdit}
              hasResourceData={resourceCount(module).docs + resourceCount(module).texts + resourceCount(module).shots > 0}
              onChanged={onRefresh}
            />
          )}

          {/* 模块资料（折叠）：文档 / 文本 / 截图 + 模块报告 */}
          <details className="rounded-xl border border-[#efedfb] bg-white">
            <summary className="cursor-pointer px-4 py-2.5 text-xs font-bold text-[#6f63c9] select-none">
              📎 模块资料（📄 {c.docs} · 📝 {c.texts} · 🖼 {c.shots}）{module.report ? ' · 📊 含报告' : ''}
              <span className="ml-2 font-normal text-gray-400">点击展开查看</span>
            </summary>
            <div className="px-4 pb-4 pt-1 space-y-3">
              {c.docs + c.texts + c.shots === 0 && (
                <p className="text-xs text-gray-400 py-3 text-center bg-gray-50/60 rounded-xl">该模块暂无资料，请到资料中心补充</p>
              )}
              {module.documents.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-gray-500 mb-1.5">📄 文档（{module.documents.length}）</p>
                  <div className="space-y-1.5">
                    {module.documents.map(doc => (
                      <button
                        key={doc.id}
                        onClick={() => setPreviewDoc({ fileName: doc.fileName, fileUrl: doc.fileUrl, fileType: doc.fileType })}
                        className="w-full flex items-center gap-2 p-2 bg-[#faf9fe] border border-[#efedfb] rounded-lg text-left hover:border-[#b6b1ee] text-xs"
                      >
                        <span className="text-[#8d84e0] font-bold flex-shrink-0">{doc.fileType.includes('pdf') ? 'PDF' : doc.fileType.includes('word') ? 'DOC' : doc.fileType.includes('sheet') ? 'XLS' : doc.fileType.includes('text') ? 'TXT' : 'PPT'}</span>
                        <span className="flex-1 truncate text-gray-700">{doc.fileName}</span>
                        <span className="text-gray-400 flex-shrink-0">{(doc.fileSize / 1024 / 1024).toFixed(1)}MB</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {module.textBlocks.filter(t => t.content.trim()).length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-gray-500 mb-1.5">📝 文本说明</p>
                  <div className="space-y-2">
                    {module.textBlocks.filter(t => t.content.trim()).map(t => (
                      <div
                        key={t.id}
                        className="p-2.5 bg-[#faf9fe] border border-[#efedfb] rounded-lg text-xs text-gray-700 leading-relaxed [&_img]:max-w-full [&_img]:rounded-lg"
                        dangerouslySetInnerHTML={{ __html: sanitizeRichText(t.content) }}
                      />
                    ))}
                  </div>
                </div>
              )}
              {module.screenshots.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-gray-500 mb-1.5">🖼 截图（{module.screenshots.length}）</p>
                  <div className="flex flex-wrap gap-2">
                    {module.screenshots.map(s => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={s.id} src={s.url} alt={s.fileName} className="w-20 h-20 object-cover rounded-lg border border-[#ddd7f2] cursor-pointer hover:opacity-80" onClick={() => window.open(s.url, '_blank')} />
                    ))}
                  </div>
                </div>
              )}
              {module.report && <ModuleReportCard report={module.report} />}
            </div>
          </details>
        </div>

        {/* 右列 */}
        <div className="lg:col-span-2 space-y-4">
          {/* 证据与行动 */}
          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <span className="text-xs font-bold text-gray-600">
              证据与行动 <span className="text-gray-300 font-normal">· {facts.length} 条事实</span>
            </span>

            {!module.analysis ? (
              <p className="text-xs text-gray-400 py-3 text-center">
                {isComplete(module) ? '已上传资料，点击左上「开始分析」自动提取证据与行动。' : '上传资料后点击「开始分析」，自动提取证据与行动生成专属图形。'}
              </p>
            ) : (
              <>
                {module.analysis.actions.length > 0 && (
                  <div className="space-y-1.5 mt-2.5 mb-3">
                    <p className="text-[10px] font-bold text-emerald-600">▶ 下一步行动</p>
                    {module.analysis.actions.map((a, i) => (
                      <p key={i} className="text-xs text-gray-700 leading-relaxed px-2.5 py-1.5 bg-emerald-50/40 border border-emerald-100 rounded-lg">
                        {i + 1}. {a}
                      </p>
                    ))}
                  </div>
                )}
                <div className="pt-2 border-t border-gray-50 flex items-center gap-3 text-[10px] text-gray-400 flex-wrap">
                  <span className="text-emerald-600">✓ 已确认 {factStats.confirmed}</span>
                  <span>● 待确认 {factStats.pending}</span>
                  <span className="text-red-400">⚠ 冲突 {factStats.conflict}</span>
                </div>
              </>
            )}
          </div>

          {/* 投委会问答 */}
          <ModuleQA
            projectId={projectId}
            moduleKey={module.moduleKey}
            canEdit={canEdit}
            isPartner={isPartner}
            hint={IC_QUESTION_HINTS[module.moduleKey] || module.coreQuestion}
          />
        </div>
      </div>

      {previewDoc && (
        <DocumentPreviewModal open={!!previewDoc} onClose={() => setPreviewDoc(null)} fileName={previewDoc.fileName} fileUrl={previewDoc.fileUrl} fileType={previewDoc.fileType} />
      )}
    </div>
  )
}

// ── 事实卡视图（AI 提取的事实明细，维护人逐条确认/标记冲突） ──

function FactsCard({
  facts,
  canEdit,
  onUpdateFact,
}: {
  facts: DDFact[]
  canEdit: boolean
  onUpdateFact: (factId: string, status: string) => Promise<void>
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gradient-to-br from-slate-50 to-blue-50/40 p-4">
      <p className="text-[11px] text-gray-400 mb-3 font-medium">事实卡 · 证据明细（按确认状态分级）</p>
      {facts.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-xs text-gray-400">暂无事实卡。上传资料后点击「开始分析」自动提取。</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {facts.map(f => (
            <div key={f.id} className={`px-3 py-2.5 rounded-xl border bg-white text-xs ${
              f.status === 'CONFLICT' ? 'border-red-200' : f.status === 'CONFIRMED' ? 'border-emerald-100' : 'border-gray-200'
            }`}>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded font-black ${gradeStyles[f.grade] || 'bg-gray-100'}`} title={DD_EVIDENCE_GRADE_LABELS[f.grade]}>
                  {f.grade}
                </span>
                <span className={`px-1.5 py-0.5 rounded font-medium ${factStatusStyles[f.status] || ''}`}>
                  {DD_EVIDENCE_STATUS_LABELS[f.status as keyof typeof DD_EVIDENCE_STATUS_LABELS] || f.status}
                </span>
              </div>
              <p className="mt-1.5 text-gray-700 leading-relaxed">“{f.fact}”</p>
              <p className="mt-1 text-[10px] text-gray-400">来源：{f.source}</p>
              {canEdit && (
                <div className="mt-1.5 flex gap-1.5">
                  {f.status !== 'CONFIRMED' && (
                    <button onClick={() => onUpdateFact(f.id, 'CONFIRMED')} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded font-bold hover:bg-emerald-100">确认</button>
                  )}
                  {f.status !== 'CONFLICT' && (
                    <button onClick={() => onUpdateFact(f.id, 'CONFLICT')} className="px-2 py-0.5 bg-red-50 text-red-600 rounded font-bold hover:bg-red-100">冲突</button>
                  )}
                  {f.status === 'CONFLICT' && (
                    <button onClick={() => onUpdateFact(f.id, 'PENDING')} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded font-bold hover:bg-gray-200">重新待确认</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 投委会问答（合伙人发布问题 · 维护人回答，均显示账户名） ──

function ModuleQA({
  projectId,
  moduleKey,
  canEdit,
  isPartner,
  hint,
}: {
  projectId: string
  moduleKey: string
  canEdit: boolean
  isPartner: boolean
  hint: string
}) {
  const [questions, setQuestions] = useState<DDQAItem[]>([])
  const [qText, setQText] = useState('')
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [qaErr, setQaErr] = useState('')
  const [askOpen, setAskOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/dd/resources/${projectId}/${moduleKey}/qa`)
      const data = await res.json()
      if (res.ok) setQuestions(data.questions || [])
    } catch { /* 列表加载失败不阻塞 */ }
  }, [projectId, moduleKey])

  useEffect(() => {
    setQText('')
    setAnswerDrafts({})
    setQaErr('')
    setAskOpen(false)
    load()
  }, [load])

  const ask = async () => {
    if (submitting || !qText.trim()) return
    setSubmitting(true)
    setQaErr('')
    try {
      const res = await fetch(`/api/dd/resources/${projectId}/${moduleKey}/qa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: qText.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setQaErr(data.error || '发布失败'); return }
      setQText('')
      setAskOpen(false)
      await load()
    } catch { setQaErr('网络错误') } finally { setSubmitting(false) }
  }

  const answer = async (qaId: string) => {
    const text = (answerDrafts[qaId] || '').trim()
    if (submitting || !text) return
    setSubmitting(true)
    setQaErr('')
    try {
      const res = await fetch(`/api/dd/resources/${projectId}/${moduleKey}/qa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qaId, answer: text }),
      })
      const data = await res.json()
      if (!res.ok) { setQaErr(data.error || '回答失败'); return }
      setAnswerDrafts(d => ({ ...d, [qaId]: '' }))
      await load()
    } catch { setQaErr('网络错误') } finally { setSubmitting(false) }
  }

  return (
    <div className="rounded-xl bg-slate-50 border border-gray-100 p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-bold text-gray-500">
          投委会问答 <span className="text-gray-300 font-normal">· {questions.length} 个问题</span>
        </span>
        {isPartner && (
          <button onClick={() => setAskOpen(!askOpen)} className="text-xs px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg font-bold hover:bg-blue-100">
            {askOpen ? '收起' : '+ 发布问题'}
          </button>
        )}
      </div>
      <p className="text-[11px] text-gray-500 leading-relaxed mb-3">💡 {hint}</p>

      {/* 合伙人提问输入框 */}
      {askOpen && isPartner && (
        <div className="mb-3 p-3 bg-white rounded-lg border border-gray-100 space-y-2">
          <textarea
            value={qText}
            onChange={e => setQText(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="向项目维护人发布追问（如：该数据与审计报告口径是否一致？）"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-300 focus:border-blue-300 resize-y"
          />
          <button onClick={ask} disabled={submitting || !qText.trim()} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg disabled:opacity-40">
            {submitting ? '发布中...' : '发布问题'}
          </button>
        </div>
      )}

      {qaErr && <p className="text-xs text-red-500 mb-2">{qaErr}</p>}

      {/* 问答列表 */}
      {questions.length === 0 ? (
        <p className="text-xs text-gray-400 py-3 text-center">暂无投委会问题</p>
      ) : (
        <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
          {questions.map(q => (
            <div key={q.id} className="px-3 py-2.5 bg-white rounded-xl border border-gray-100">
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-[10px]">{(q.questionerName || '?').slice(0, 1)}</span>
                <span className="font-bold text-gray-600">{q.questionerName}</span>
                <span>· 投委会 · {new Date(q.createdAt).toLocaleDateString('zh-CN')}</span>
              </div>
              <p className="mt-1.5 text-xs text-gray-800 leading-relaxed font-medium">{q.question}</p>

              {/* 回答 */}
              {q.answer ? (
                <div className="mt-2 pl-2 border-l-2 border-emerald-200">
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                    <span className="font-bold text-emerald-600">{q.answererName}</span>
                    <span>· 维护人 · {q.answeredAt ? new Date(q.answeredAt).toLocaleDateString('zh-CN') : ''}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-700 leading-relaxed">{q.answer}</p>
                </div>
              ) : canEdit ? (
                <div className="mt-2 flex gap-1.5">
                  <input
                    value={answerDrafts[q.id] || ''}
                    onChange={e => setAnswerDrafts(d => ({ ...d, [q.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') answer(q.id) }}
                    maxLength={2000}
                    placeholder="回答该问题..."
                    className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300"
                  />
                  <button onClick={() => answer(q.id)} disabled={submitting || !(answerDrafts[q.id] || '').trim()} className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-100 disabled:opacity-40">
                    回答
                  </button>
                </div>
              ) : (
                <p className="mt-1.5 text-[10px] text-amber-500">⏳ 待项目维护人回答</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 模块尽调报告卡（总结 + 机会 + 风险） */
function ModuleReportCard({ report }: { report: DDModuleReport }) {
  return (
    <div className="p-3.5 rounded-xl bg-gradient-to-br from-[#efedfb] to-white border border-[#ddd7f2]">
      <p className="text-[11px] font-bold text-[#6f63c9] mb-2">📊 模块尽调报告</p>
      <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{report.summary}</p>
      {report.opportunities.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[10px] font-bold text-emerald-600 mb-1">机会</p>
          {report.opportunities.map((o, i) => <p key={i} className="text-[11px] text-gray-600 leading-relaxed">✦ {o}</p>)}
        </div>
      )}
      {report.risks.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[10px] font-bold text-red-500 mb-1">风险</p>
          {report.risks.map((r, i) => <p key={i} className="text-[11px] text-gray-600 leading-relaxed">⚠ {r}</p>)}
        </div>
      )}
      <p className="text-[10px] text-gray-400 mt-2 text-right">生成于 {new Date(report.generatedAt).toLocaleString('zh-CN')}</p>
    </div>
  )
}

// ═════ 第 10 模块：投资决策面板 ═════

function DecisionPanel({ projectId, decision, onRefresh }: { projectId: string; decision: DecisionState; onRefresh: () => void }) {
  const [form, setForm] = useState<{ decision: string; amount: string; reason: string }>({ decision: '', amount: '', reason: '' })
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (decision.myDecision) {
      setForm({
        decision: decision.myDecision.decision,
        amount: decision.myDecision.amount ? String(decision.myDecision.amount) : '',
        reason: decision.myDecision.reason || '',
      })
    }
  }, [decision.myDecision])

  const submit = async () => {
    if (submitting) return
    if (!form.decision) { setErr('请先选择决策（投资 / 不投资 / 纠结中）'); return }
    if (form.decision === 'INVEST' && !form.amount.trim()) { setErr('选择投资时必须填写投资金额（万元）'); return }
    setSubmitting(true)
    setErr('')
    try {
      const res = await fetch(`/api/dd/decision/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: form.decision,
          amount: form.decision === 'INVEST' ? parseFloat(form.amount) : undefined,
          reason: form.reason.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error || '提交失败'); return }
      await onRefresh()
    } catch {
      setErr('网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  const isPartner = decision.canDecide

  return (
    <div className="mt-5 pt-5 border-t border-[#efedfb]">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <h3 className="text-base font-bold text-gray-900">投资决策 · 第 10 模块</h3>
        <span className="text-xs text-gray-400">规则：至少 {decision.minPartners} 位合伙人确认；任一不投资/纠结 → 最终不投资</span>
      </div>

      {/* 最终决策结果 */}
      {decision.finalStatus === 'INVEST' && (
        <div className="mb-4 p-4 rounded-xl bg-emerald-50 border-2 border-emerald-200">
          <p className="text-sm font-bold text-emerald-700 mb-2">✅ 最终决策：投资</p>
          <div className="space-y-1">
            {decision.decisions.map(d => (
              <p key={d.partnerId} className="text-xs text-gray-700">
                <b>{d.partnerName}</b> · 投资 {d.amount} 万元{d.reason && <span className="text-gray-400"> · {d.reason}</span>}
              </p>
            ))}
          </div>
        </div>
      )}
      {decision.finalStatus === 'NO_INVEST' && (
        <div className="mb-4 p-4 rounded-xl bg-red-50 border-2 border-red-200">
          <p className="text-sm font-bold text-red-600 mb-2">❌ 最终决策：不投资</p>
          <div className="space-y-1">
            {decision.decisions.map(d => (
              <p key={d.partnerId} className="text-xs text-gray-700">
                <b>{d.partnerName}</b> · {DECISION_LABELS[d.decision]}{d.reason && <span className="text-gray-400"> · {d.reason}</span>}
              </p>
            ))}
          </div>
        </div>
      )}
      {decision.finalStatus === 'PENDING' && (
        <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-bold text-amber-700">
            {isPartner ? '待其他合伙人决策中' : '待决策中'}
            <span className="ml-2 text-xs text-gray-500">已确认 {decision.decisionCount}/{decision.minPartners}</span>
          </p>
          {decision.decisions.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {decision.decisions.map(d => (
                <span key={d.partnerId} className="px-2 py-0.5 bg-white border border-amber-100 rounded-full text-[10px] text-gray-600">
                  {d.partnerName}：{DECISION_LABELS[d.decision]}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 合伙人决策表单（可修改） */}
      {isPartner ? (
        <div className="p-4 rounded-xl bg-white border border-[#ddd7f2] space-y-3">
          <p className="text-xs font-bold text-gray-600">{decision.myDecision ? '我的决策（可修改后重新确认）' : '提交我的决策'}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {(['INVEST', 'NO_INVEST', 'UNDECIDED'] as const).map(d => (
              <button
                key={d}
                onClick={() => { setForm({ ...form, decision: d }); setErr('') }}
                className={`px-4 py-2 text-sm font-bold rounded-xl border-2 transition-all ${
                  form.decision === d
                    ? d === 'INVEST' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : d === 'NO_INVEST' ? 'border-red-400 bg-red-50 text-red-600' : 'border-amber-400 bg-amber-50 text-amber-700'
                    : 'border-gray-200 text-gray-500 hover:border-[#b6b1ee]'
                }`}
              >
                {DECISION_LABELS[d]}
              </button>
            ))}
          </div>
          {form.decision === 'INVEST' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-500 mb-1">投资金额（万元，必填）</label>
                <input
                  type="number"
                  min="1"
                  value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                  placeholder="如 500"
                  className="w-full px-3 py-2 text-sm border border-[#ddd7f2] rounded-xl focus:outline-none focus:border-[#b6b1ee]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-500 mb-1">投资理由（非必填）</label>
                <textarea
                  value={form.reason}
                  onChange={e => setForm({ ...form, reason: e.target.value })}
                  rows={2}
                  placeholder="投资理由..."
                  className="w-full px-3 py-2 text-sm border border-[#ddd7f2] rounded-xl focus:outline-none focus:border-[#b6b1ee] resize-y"
                />
              </div>
            </div>
          ) : form.decision ? (
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1">
                {form.decision === 'NO_INVEST' ? '不投资理由' : '纠结理由'}
              </label>
              <textarea
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                rows={3}
                placeholder={form.decision === 'NO_INVEST' ? '不投资理由...' : '纠结理由（还需补充哪些信息）...'}
                className="w-full px-3 py-2 text-sm border border-[#ddd7f2] rounded-xl focus:outline-none focus:border-[#b6b1ee] resize-y"
              />
            </div>
          ) : null}
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="flex justify-end">
            <button
              onClick={submit}
              disabled={submitting || !form.decision}
              className="px-5 py-2 bg-gradient-to-r from-[#6f63c9] to-[#8d84e0] text-white text-sm font-bold rounded-xl shadow-md disabled:opacity-40"
            >
              {submitting ? '提交中...' : decision.myDecision ? '修改决策' : '确认决策'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-400 px-1">投资决策由投资合伙人提交，作为项目维护人您可实时查看决策进度</p>
      )}
    </div>
  )
}

// ═════ 背面：资料中心模块卡片（文档上传 / 多文本框 / 截图管理） ═════

function ResourceCenterModule({
  projectId,
  index,
  module,
  canEdit,
  expanded,
  onToggle,
  onChanged,
}: {
  projectId: string
  index: number
  module: ModuleResource
  canEdit: boolean
  expanded: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const [texts, setTexts] = useState<string[]>([])
  const [savingText, setSavingText] = useState(false)
  const [textSaved, setTextSaved] = useState(false)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [uploadingShot, setUploadingShot] = useState(false)
  const [opErr, setOpErr] = useState('')
  const [previewDoc, setPreviewDoc] = useState<{ fileName: string; fileUrl: string; fileType: string } | null>(null)
  const docInputRef = useRef<HTMLInputElement>(null)
  const shotInputRef = useRef<HTMLInputElement>(null)

  // 切换模块时载入其文本框；保存后父级刷新（引用变化）不重置"已保存"提示
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setTexts(module.textBlocks.map(t => t.content))
    setTextSaved(false)
  }, [module.moduleKey])

  const c = resourceCount(module)
  const complete = isComplete(module)

  // 保存文本框（全量覆盖）
  const saveTexts = async () => {
    setSavingText(true)
    setOpErr('')
    try {
      const res = await fetch(`/api/dd/resources/${projectId}/${module.moduleKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textBlocks: texts.map(content => ({ content })) }),
      })
      const data = await res.json()
      if (!res.ok) { setOpErr(data.error || '保存失败'); return }
      setTextSaved(true)
      onChanged()
    } catch { setOpErr('网络错误') } finally { setSavingText(false) }
  }

  // 上传文档
  const uploadDoc = async (file: File) => {
    setUploadingDoc(true)
    setOpErr('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/dd/resources/${projectId}/${module.moduleKey}/documents`, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setOpErr(data.error || '上传失败'); return }
      onChanged()
    } catch { setOpErr('上传失败') } finally { setUploadingDoc(false) }
  }

  // 删除文档
  const deleteDoc = async (docId: string) => {
    setOpErr('')
    try {
      const res = await fetch(`/api/dd/resources/${projectId}/${module.moduleKey}/documents?docId=${docId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) { setOpErr(data.error || '删除失败'); return }
      onChanged()
    } catch { setOpErr('网络错误') }
  }

  // 上传截图（压缩后）
  const uploadShot = async (file: File) => {
    setUploadingShot(true)
    setOpErr('')
    try {
      const compressed = await compressImage(file)
      const fd = new FormData()
      fd.append('file', compressed)
      const res = await fetch(`/api/dd/resources/${projectId}/${module.moduleKey}/screenshots`, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setOpErr(data.error || '上传失败'); return }
      onChanged()
    } catch { setOpErr('上传失败') } finally { setUploadingShot(false) }
  }

  // 删除截图
  const deleteShot = async (shotId: string) => {
    setOpErr('')
    try {
      const res = await fetch(`/api/dd/resources/${projectId}/${module.moduleKey}/screenshots?shotId=${shotId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) { setOpErr(data.error || '删除失败'); return }
      onChanged()
    } catch { setOpErr('网络错误') }
  }

  return (
    <div className={`rounded-xl border transition-all ${complete ? 'border-[#ddd7f2] bg-white' : 'border-dashed border-gray-300 bg-gray-50/40'}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className={`text-xs font-black flex-shrink-0 ${complete ? 'text-[#8d84e0]' : 'text-gray-300'}`}>{String(index + 1).padStart(2, '0')}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800">{module.moduleName}</p>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mt-0.5 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded ${complete ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>{complete ? '✓ 完整' : '待补充'}</span>
            {c.docs > 0 && <span>📄 {c.docs}</span>}
            {c.texts > 0 && <span>📝 {c.texts}</span>}
            {c.shots > 0 && <span>🖼 {c.shots}</span>}
            {module.report && <span className="text-emerald-500">📊 已有报告</span>}
          </div>
        </div>
        <span className="text-gray-400 flex-shrink-0 text-xs">{expanded ? '收起 ▲' : '展开 ▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-[#efedfb] space-y-4">
          {opErr && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{opErr}</p>}

          {/* 文档 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-gray-500">上传文档（PDF/Word/Excel/PPT/txt，自动提取全文供报告使用）</span>
              {canEdit && (
                <label className={`px-2.5 py-1 bg-[#efedfb] text-[#6f63c9] text-xs font-bold rounded-lg cursor-pointer hover:bg-[#e2ddf8] ${uploadingDoc ? 'opacity-50 pointer-events-none' : ''}`}>
                  {uploadingDoc ? '上传中...' : '+ 上传文档'}
                  <input
                    ref={docInputRef}
                    type="file"
                    accept=".pdf,.docx,.xlsx,.pptx,.txt,.md"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) uploadDoc(f)
                    }}
                  />
                </label>
              )}
            </div>
            {module.documents.length > 0 ? (
              <div className="space-y-1.5">
                {module.documents.map(doc => (
                  <div key={doc.id} className="flex items-center gap-2 p-2 bg-[#faf9fe] border border-[#efedfb] rounded-lg text-xs">
                    <span className="text-[#8d84e0] font-bold flex-shrink-0">{doc.fileType.includes('pdf') ? 'PDF' : doc.fileType.includes('word') ? 'DOC' : doc.fileType.includes('sheet') ? 'XLS' : doc.fileType.includes('text') ? 'TXT' : 'PPT'}</span>
                    <button onClick={() => setPreviewDoc({ fileName: doc.fileName, fileUrl: doc.fileUrl, fileType: doc.fileType })} className="flex-1 truncate text-left text-gray-700 hover:text-[#6f63c9]">
                      {doc.fileName}
                    </button>
                    <span className="text-gray-400 flex-shrink-0">{(doc.fileSize / 1024 / 1024).toFixed(1)}MB</span>
                    {canEdit && <button onClick={() => window.confirm('删除该文档？') && deleteDoc(doc.id)} className="text-red-400 hover:text-red-600 flex-shrink-0 px-1">✕</button>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-gray-400">暂无文档</p>
            )}
          </div>

          {/* 文本框（可动态添加多个） */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-gray-500">文本内容（内容较多时可添加多个文本框）</span>
              <div className="flex items-center gap-2">
                {textSaved && <span className="text-[10px] text-emerald-600">已保存 ✓</span>}
                {canEdit && (
                  <button onClick={() => { setTexts([...texts, '']); setTextSaved(false) }} className="px-2 py-1 bg-[#efedfb] text-[#6f63c9] text-xs font-bold rounded-lg hover:bg-[#e2ddf8]">
                    + 添加文本框
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              {texts.length === 0 && canEdit && (
                <button onClick={() => { setTexts(['']); setTextSaved(false) }} className="w-full py-3 border-2 border-dashed border-[#ddd7f2] rounded-xl text-xs text-[#8d84e0] hover:border-[#b6b1ee]">
                  + 点击添加第一个文本框
                </button>
              )}
              {texts.map((t, i) => (
                <div key={i} className="flex gap-2">
                  {canEdit ? (
                    <RichTextEditor
                      value={t}
                      onChange={html => { setTexts(texts.map((x, j) => (j === i ? html : x))); setTextSaved(false) }}
                      placeholder={`文本框 ${i + 1}：填写该模块的文字内容（纪要、要点、说明等），可直接粘贴截图...`}
                      className="flex-1"
                    />
                  ) : (
                    <div
                      className="flex-1 px-3 py-2 text-xs border border-[#ddd7f2] rounded-xl bg-gray-50 text-gray-700 leading-relaxed [&_img]:max-w-full [&_img]:rounded-lg"
                      dangerouslySetInnerHTML={{ __html: sanitizeRichText(t) }}
                    />
                  )}
                  {canEdit && (
                    <button onClick={() => { setTexts(texts.filter((_, j) => j !== i)); setTextSaved(false) }} className="text-gray-300 hover:text-red-500 self-start px-1 pt-2" title="删除该文本框">✕</button>
                  )}
                </div>
              ))}
              {canEdit && texts.length > 0 && (
                <div className="flex justify-end">
                  <button onClick={saveTexts} disabled={savingText} className="px-4 py-1.5 bg-[#6f63c9] text-white text-xs font-bold rounded-lg hover:bg-[#5b4fb5] disabled:opacity-50">
                    {savingText ? '保存中...' : '保存文本内容'}
                  </button>
                </div>
              )}
              {!canEdit && texts.length === 0 && <p className="text-[11px] text-gray-400">暂无文本内容</p>}
            </div>
          </div>

          {/* 截图 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-gray-500">上传截图（数据图/界面/关键截图，报告中原样嵌入展示）</span>
              {canEdit && (
                <label className={`px-2.5 py-1 bg-[#efedfb] text-[#6f63c9] text-xs font-bold rounded-lg cursor-pointer hover:bg-[#e2ddf8] ${uploadingShot ? 'opacity-50 pointer-events-none' : ''}`}>
                  {uploadingShot ? '上传中...' : '+ 上传截图'}
                  <input
                    ref={shotInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) uploadShot(f)
                    }}
                  />
                </label>
              )}
            </div>
            {module.screenshots.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {module.screenshots.map(s => (
                  <div key={s.id} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.url} alt={s.fileName} className="w-20 h-20 object-cover rounded-lg border border-[#ddd7f2] cursor-pointer hover:opacity-80" onClick={() => window.open(s.url, '_blank')} />
                    {canEdit && (
                      <button
                        onClick={() => window.confirm('删除该截图？') && deleteShot(s.id)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-[10px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >✕</button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-gray-400">暂无截图</p>
            )}
          </div>
        </div>
      )}

      {previewDoc && (
        <DocumentPreviewModal open={!!previewDoc} onClose={() => setPreviewDoc(null)} fileName={previewDoc.fileName} fileUrl={previewDoc.fileUrl} fileType={previewDoc.fileType} />
      )}
    </div>
  )
}
