'use client'

/**
 * 项目解读面板（AI行研 · 固定分析框架模板）
 *
 * 流程：上传文档 → ① 解读项目（七维 + 10 条行业融资案例）
 *      → ② 生成问题清单（15-20 问、技术 ≥10、每题浅色理想答案）
 *      → ③ 逐题上传访谈文件（音频/文档）闭环校验
 *      → ④ 综合分析结论
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import RichText from '@/components/RichText'
import type {
  InterpretationResult,
  VerifyResult,
  OverallConclusion,
} from '@/lib/project-interpretation/constants'

// ── 类型 ──

/** AI 预取的项目库填充草稿（draft 接口返回） */
interface DraftData {
  name: string
  companyFullName: string
  industry: string
  companyPosition: string
  mainProducts: string
  coreAdvantage: string
  coreTeam: string
  financialData: string
  orderProgress: string
  competitors: string
  financingPlan: string
  description: string
  financingRound: string
  totalAmount: string
  investmentValuation: number | null
}

/** BP 关键页图片（draft 接口返回；创建时嵌入对应字段的 HTML） */
interface BpImage {
  page: number
  url: string
}

/** 预填充创建表单（维护人补全必填项后确认创建） */
interface CreateProjectForm {
  name: string
  companyFullName: string
  industry: string
  companyPosition: string
  mainProducts: string
  coreAdvantage: string
  coreTeam: string
  financialData: string
  orderProgress: string
  competitors: string
  financingPlan: string
  description: string
  financingRound: string
  totalAmount: string
  investmentValuation: string
  targetDate: string
}

/** 行业预设选项（与项目库新建页一致，支持自定义输入） */
const INDUSTRY_OPTIONS = [
  'AI应用', 'AI硬件', 'AI基础设施', '具身智能', '商业航天', '量子计算',
  '脑机接口', '可控核聚变', '半导体设备', '半导体芯片', '光学', '新材料',
]

/** 融资轮次选项 */
const FINANCING_ROUND_OPTIONS = ['天使轮', 'Pre-A轮', 'A轮', 'A+轮', 'B轮', 'C轮', 'D轮', 'E轮', 'Pre-IPO', '战略融资']

/** 富文本字段的排版预览：按行分点渲染，**text** 转 <strong> */
function RichPreview({ text }: { text: string }) {
  const lines = (text || '').split('\n').filter(l => l.trim())
  if (lines.length === 0) return <p className="text-[11px] text-gray-300">（空，可编辑输入，支持 1. 2. 分点与 **加粗**）</p>
  return (
    <div className="space-y-1">
      {lines.map((line, i) => (
        <p key={i} className="text-[11px] text-gray-600 leading-relaxed">
          {line.split(/\*\*(.+?)\*\*/g).map((part, j) =>
            j % 2 === 1 ? <strong key={j} className="text-gray-900">{part}</strong> : <span key={j}>{part}</span>
          )}
        </p>
      ))}
    </div>
  )
}

interface InterpretationSummary {
  id: string
  projectName: string
  industry: string | null
  marketPosition: string | null
  fileName: string
  status: string
  questionsStatus: string
  verifyStatus: string
  hasConclusion: boolean
  linkedProjectId: string | null
  error: string | null
  createdAt: string
  questionCount: number
  verifiedCount: number
}

interface QuestionView {
  id: string
  order: number
  category: string
  question: string
  idealAnswer: string
  sectorInsight: boolean
  claimFlag: boolean
  verifyStatus: string
  verifyFileName: string | null
  verifyFileUrl: string | null
  verifyResultJson: string | null
}

interface InterpretationDetail {
  id: string
  projectName: string
  fileName: string
  fileUrl: string
  status: string
  interpretationJson: string | null
  verificationJson: string | null
  questionsStatus: string
  conclusionJson: string | null
  verifyStatus: string
  interviewFileName: string | null
  interviewFileUrl: string | null
  linkedProjectId: string | null
  error: string | null
  createdAt: string
  questions: QuestionView[]
}

/** BP 声明外部校验结果（与后端 claim-verifier.ts 对齐） */
interface ClaimEvidenceView { title: string; url: string; snippet: string }
interface VerifiedClaimView { claim: string; verdict: string; note: string; evidence: ClaimEvidenceView[] }
interface VerificationView { claims: VerifiedClaimView[]; summary: string; verifiedAt: string }

/** 裁决徽章（✅ 一致 / ⚠️ 夸大 / ❌ 矛盾 / ❓ 未证实） */
const VERDICT_BADGES: Record<string, { label: string; cls: string }> = {
  SUPPORTED: { label: '✅ 一致', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  EXAGGERATED: { label: '⚠️ 夸大', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  CONTRADICTED: { label: '❌ 矛盾', cls: 'bg-red-50 text-red-600 border border-red-200' },
  UNVERIFIED: { label: '❓ 未证实', cls: 'bg-gray-100 text-gray-500 border border-gray-200' },
}

// ── 样式映射 ──

const CATEGORY_LABELS: Record<string, string> = {
  TECH: '技术',
  MARKET: '市场',
  TEAM: '团队',
  BUSINESS: '业务',
  FINANCE: '财务',
}
const CATEGORY_STYLES: Record<string, string> = {
  TECH: 'bg-blue-100 text-blue-700',
  MARKET: 'bg-purple-100 text-purple-700',
  TEAM: 'bg-teal-100 text-teal-700',
  BUSINESS: 'bg-amber-100 text-amber-700',
  FINANCE: 'bg-emerald-100 text-emerald-700',
}
const MATCH_STYLES: Record<string, { label: string; cls: string }> = {
  HIGH: { label: '高度吻合', cls: 'bg-emerald-100 text-emerald-700' },
  PARTIAL: { label: '部分吻合', cls: 'bg-amber-100 text-amber-700' },
  GAP: { label: '差距较大', cls: 'bg-red-100 text-red-700' },
  UNCOVERED: { label: '访谈未涉及', cls: 'bg-gray-200 text-gray-500' },
}

export default function ProjectInterpretationPanel() {
  const [list, setList] = useState<InterpretationSummary[]>([])
  const [detail, setDetail] = useState<InterpretationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [projectName, setProjectName] = useState('')
  // 最近一次问题清单生成实际应用的本人技能名（即时可见性；解读的应用技能持久化在 interpretationJson）
  const [questionSkills, setQuestionSkills] = useState<string[]>([])
  // 粘贴文本备选通道（扫描件 PDF / 图片型 BP 直接粘贴项目内容）
  const [pastedText, setPastedText] = useState('')
  const [pasteBusy, setPasteBusy] = useState(false)
  // BP 文件先选择暂存，点「提交」后统一上传（可与访谈纪要一起提交）
  const [bpFile, setBpFile] = useState<File | null>(null)
  // 初始上传：同时上传访谈纪要（可选）
  const [ivFile, setIvFile] = useState<File | null>(null)
  const [ivText, setIvText] = useState('')
  const ivInputRef = useRef<HTMLInputElement>(null)
  // 自动链路进度：BP+访谈纪要一起上传后自动执行 解读 → 问题清单 → 校验+结论
  const [autoChainStep, setAutoChainStep] = useState<'idle' | 'interpret' | 'questions' | 'verify' | 'done' | 'error'>('idle')
  // 列表视图：全字段检索 + 分页（15/页）
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 15
  // 提交后上传卡片 3D 翻转切换（正面表单 ⇄ 背面"提交中"）
  const [flipping, setFlipping] = useState(false)

  const uploadInputRef = useRef<HTMLInputElement>(null)

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch('/api/project-interpretation')
      const data = await res.json()
      if (res.ok) setList(data.interpretations || [])
    } catch { /* ignore */ }
  }, [])

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/project-interpretation/${id}`)
      const data = await res.json()
      if (res.ok) setDetail(data.interpretation)
      else setError(data.error || '获取详情失败')
    } catch {
      setError('网络错误')
    }
  }, [])

  useEffect(() => {
    Promise.all([fetchList()]).finally(() => setLoading(false))
  }, [fetchList])

  // ── 上传 ──

  /**
   * 自动链路：BP + 访谈纪要一起上传后自动执行
   * 解读项目 → 生成问题清单 → 访谈校验（理想答案 vs 纪要，自动出综合结论）
   */
  const runAutoChain = async (interpretationId: string) => {
    setBusy(true)
    try {
      // 1. 解读项目（失败不阻塞后续——问题清单已与解读解耦；失败状态在详情页可见）
      setAutoChainStep('interpret')
      await fetch(`/api/project-interpretation/${interpretationId}/interpret`, { method: 'POST' })

      // 2. 生成问题清单
      setAutoChainStep('questions')
      const r2 = await fetch(`/api/project-interpretation/${interpretationId}/questions`, { method: 'POST' })
      if (!r2.ok) {
        const data = await r2.json().catch(() => ({}))
        setError(`自动分析中止（生成问题清单失败：${data.error || '未知错误'}），可手动重试`)
        setAutoChainStep('error')
        await fetchDetail(interpretationId)
        return
      }
      // 本次问题生成应用的技能名（即时可见性）
      const qData = await r2.json().catch(() => ({}))
      if (Array.isArray(qData.appliedSkills)) setQuestionSkills(qData.appliedSkills as string[])

      // 3. 访谈校验（无请求内容 → 回退使用上传时存入的访谈全文）→ 自动综合结论
      setAutoChainStep('verify')
      const r3 = await fetch(`/api/project-interpretation/${interpretationId}/verify`, { method: 'POST' })
      if (!r3.ok) {
        const data = await r3.json().catch(() => ({}))
        setError(`访谈校验失败：${data.error || '未知错误'}，可手动重试`)
        setAutoChainStep('error')
        await fetchDetail(interpretationId)
        return
      }
      setAutoChainStep('done')
      await fetchDetail(interpretationId)
      await fetchList()
      // 3 秒后收起进度提示
      setTimeout(() => setAutoChainStep('idle'), 3000)
    } catch {
      setError('自动分析网络中断，可手动继续各步骤')
      setAutoChainStep('error')
      await fetchDetail(interpretationId)
    } finally {
      setBusy(false)
    }
  }

  /** 粘贴文本备选通道（扫描件/图片型文档） */
  const handlePasteUpload = async () => {
    if (!pastedText.trim() || pasteBusy) return
    setPasteBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('text', pastedText.trim())
      if (projectName.trim()) fd.append('projectName', projectName.trim())
      if (ivText.trim()) fd.append('interviewText', ivText.trim())
      if (ivFile) fd.append('interviewFile', ivFile)
      const res = await fetch('/api/project-interpretation/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '提交失败')
        return
      }
      const id = data.interpretation.id as string
      setPastedText('')
      setBpFile(null)
      setIvText('')
      setIvFile(null)
      setProjectName('')
      await fetchList()
      await fetchDetail(id)
      if (data.interpretation.hasInterview) runAutoChain(id)
    } catch {
      setError('网络错误')
    } finally {
      setPasteBusy(false)
    }
  }

  const handleUpload = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (projectName.trim()) fd.append('projectName', projectName.trim())
      if (ivText.trim()) fd.append('interviewText', ivText.trim())
      if (ivFile) fd.append('interviewFile', ivFile)
      const res = await fetch('/api/project-interpretation/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '上传失败')
        return
      }
      const id = data.interpretation.id as string
      setProjectName('')
      setBpFile(null)
      setIvText('')
      setIvFile(null)
      await fetchList()
      await fetchDetail(id)
      // 同时上传了访谈纪要 → 自动执行完整分析链路；仅 BP → 手动点「解读项目」/「生成问题清单」
      if (data.interpretation.hasInterview) runAutoChain(id)
    } catch {
      setError('网络错误')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 主提交按钮：点击后上传卡片 3D 翻转到背面（提交中），请求完成/失败后翻回。
   * BP 文件优先，其次粘贴文本；访谈纪要（文件/粘贴）随请求一并携带。
   * - BP + 访谈纪要 → 提交后自动执行 解读 → 问题清单 → 校对 → 结论
   * - 仅 BP → 提交后进入项目页，手动点击「解读项目」/「生成问题清单」
   */
  const handleSubmit = async () => {
    if (busy || pasteBusy) return
    setFlipping(true) // 翻转到背面：🚀 提交中
    try {
      if (bpFile) {
        await handleUpload(bpFile)
        return
      }
      if (pastedText.trim().length >= 100) {
        await handlePasteUpload()
      }
    } finally {
      // 成功切到详情视图 / 失败停在本页 → 均翻回正面（失败时正面可见错误提示）
      setFlipping(false)
    }
  }

  // ── 执行动作 ──

  const runAction = async (path: string, successMsg: string) => {
    if (!detail) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/project-interpretation/${detail.id}/${path}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `${successMsg}失败`)
        await fetchDetail(detail.id)
        return
      }
      // 问题清单生成响应携带本次应用的技能名（即时可见性）
      if (Array.isArray(data.appliedSkills)) setQuestionSkills(data.appliedSkills as string[])
      await fetchDetail(detail.id)
      await fetchList()
    } catch {
      setError('网络错误（AI 分析耗时较长，请稍后重试）')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('删除该解读项目及其问题清单？')) return
    await fetch(`/api/project-interpretation/${id}`, { method: 'DELETE' })
    if (detail?.id === id) setDetail(null)
    fetchList()
  }

  const backToList = () => {
    setDetail(null)
    setError('')
    fetchList()
  }

  // ── 渲染 ──

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    )
  }

  // 详情视图
  if (detail) {
    return (
    <Detail
      detail={detail}
      busy={busy}
      error={error}
      autoChainStep={autoChainStep}
      questionSkills={questionSkills}
      onBack={() => { setAutoChainStep('idle'); backToList() }}
      onInterpret={() => runAction('interpret', '解读')}
      onQuestions={() => runAction('questions', '生成问题清单')}
      onVerifyClaims={() => runAction('verify-claims', '外部校验')}
      onConclusion={() => runAction('conclusion', '生成综合结论')}
      onQuestionVerified={() => fetchDetail(detail.id)}
      onProjectCreated={() => fetchDetail(detail.id)}
    />
  )
  }

  // 列表 + 上传视图：左右布局（左 1/4 上传区 · 右 3/4 检索/卡片/分页）
  const filtered = search.trim()
    ? list.filter(item => {
        const kw = search.trim().toLowerCase()
        return (
          item.projectName.toLowerCase().includes(kw) ||
          (item.industry || '').toLowerCase().includes(kw) ||
          (item.marketPosition || '').toLowerCase().includes(kw) ||
          item.fileName.toLowerCase().includes(kw)
        )
      })
    : list
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <div className="h-full flex gap-4 overflow-hidden">
      {/* ── 左 1/4：上传区（固定不随列表滚动；提交时 3D 翻转切换） ── */}
      <div className="w-[300px] xl:w-[340px] flex-shrink-0 overflow-y-auto pb-4">
        <div className="flip-scene">
          <div className={`flip-card ${flipping ? 'flipped' : ''}`}>
            {/* 正面：上传表单（卡片悬浮立体） */}
            <div className="flip-face card-float bg-white rounded-2xl border border-primary-100 p-4">
              <h3 className="text-sm font-bold text-gray-900">上传项目文档</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                PDF / Word / PPT / Excel / txt · 选好 BP 与访谈纪要后点「提交」
              </p>
              <input
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="项目名称（选填，默认取文件名）"
                className="mt-3 w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-primary-400"
              />
              {/* BP 上传按钮：#0686AD 底色 + 3D 按压效果 */}
              <div
                onClick={() => !busy && uploadInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const f = e.dataTransfer.files?.[0]
                  if (f) setBpFile(f)
                }}
                className={`btn-3d mt-2.5 flex items-center gap-2.5 rounded-xl px-3 py-3 cursor-pointer select-none ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {busy ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-2 border-white/40 border-t-white flex-shrink-0" />
                    <p className="text-xs font-bold">上传中...</p>
                  </>
                ) : bpFile ? (
                  <>
                    <span className="flex-shrink-0">✅</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">{bpFile.name}</p>
                      <p className="text-[10px] text-white/70">{(bpFile.size / 1024 / 1024).toFixed(2)} MB · 点击重选</p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setBpFile(null) }}
                      className="flex-shrink-0 px-2 py-0.5 text-[10px] text-white/80 hover:text-white border border-white/40 rounded-lg"
                    >
                      清除
                    </button>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-xs font-medium">点击或拖拽上传项目 BP</p>
                  </>
                )}
              </div>
              <input
                ref={uploadInputRef}
                type="file"
                accept=".pdf,.docx,.pptx,.xlsx,.txt,.md"
                className="hidden"
                onChange={e => {
                  setBpFile(e.target.files?.[0] || null)
                  e.target.value = ''
                }}
              />
              {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}

              {/* 同时上传访谈纪要（可选）：#0686AD 底色 + 3D 按压效果 */}
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-[11px] font-bold text-gray-600">
                  同时上传访谈纪要 <span className="text-gray-400 font-normal">（可选，自动完成全部分析）</span>
                </p>
                <div
                  onClick={() => ivInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault()
                    const f = e.dataTransfer.files?.[0]
                    if (f) setIvFile(f)
                  }}
                  className="btn-3d mt-2 flex items-center gap-2.5 rounded-xl px-3 py-3 cursor-pointer select-none"
                >
                  {ivFile ? (
                    <>
                      <span className="flex-shrink-0">✅</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate">{ivFile.name}</p>
                        <p className="text-[10px] text-white/70">{(ivFile.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0-4a3 3 0 003-3V5a3 3 0 00-6 0v10a3 3 0 003 3zm7-3a7 7 0 01-14 0" />
                      </svg>
                      <p className="text-xs font-medium">上传访谈纪要（音频/文档）</p>
                    </>
                  )}
                </div>
                <input
                  ref={ivInputRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,.pdf,.docx,.txt,.md,.pptx"
                  className="hidden"
                  onChange={e => {
                    setIvFile(e.target.files?.[0] || null)
                    e.target.value = ''
                  }}
                />
                <textarea
                  value={ivText}
                  onChange={e => setIvText(e.target.value)}
                  rows={3}
                  placeholder="或粘贴访谈纪要全文。与 BP 一起提交后自动：解读 → 问题清单 → 校对 → 结论。"
                  className="mt-2 w-full px-3 py-2 border border-gray-200 rounded-xl text-[11px] focus:ring-2 focus:ring-primary-300"
                />
              </div>

              {/* 粘贴文本备选通道（扫描件 PDF / 图片型 BP） */}
              <details className="mt-2.5">
                <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-primary-600 select-none">
                  📄 扫描件 / 图片型文档？直接粘贴项目文本 →
                </summary>
                <textarea
                  value={pastedText}
                  onChange={e => setPastedText(e.target.value)}
                  rows={4}
                  placeholder="粘贴项目的文字内容（至少 100 字）。适合扫描版 PDF 或以图片为主的 PPT。"
                  className="mt-2 w-full px-3 py-2 border border-gray-200 rounded-xl text-[11px] focus:ring-2 focus:ring-primary-300"
                />
                {pastedText.trim().length > 0 && (
                  <p className="text-[10px] text-gray-400">{pastedText.trim().length} 字（至少 100 字）</p>
                )}
              </details>

              {/* 提交按钮 */}
              <div className="mt-3 pt-3 border-t border-gray-100">
                <button
                  onClick={handleSubmit}
                  disabled={busy || pasteBusy || (!bpFile && pastedText.trim().length < 100)}
                  className="w-full px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-500/25 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {(busy || pasteBusy)
                    ? '提交中...'
                    : (ivFile || ivText.trim())
                      ? '🚀 提交并自动完成全部分析'
                      : '🚀 提交并开始分析'}
                </button>
                <p className="mt-1.5 text-[10px] text-gray-400 text-center">
                  {(ivFile || ivText.trim())
                    ? '已附纪要：自动执行 解读 → 问题清单 → 校对 → 结论'
                    : bpFile || pastedText.trim().length >= 100
                      ? '仅上传 BP：进入项目页手动执行各步骤'
                      : '请先选择 BP 文档（或粘贴项目文本）'}
                </p>
              </div>
            </div>

            {/* 背面：提交中状态（翻转后显示） */}
            <div className="flip-face flip-face-back bg-gradient-to-br from-[#0686AD] to-[#0a4e68] rounded-2xl text-center px-6">
              <span className="animate-spin rounded-full h-10 w-10 border-4 border-white/30 border-t-white" />
              <p className="mt-4 text-sm font-bold text-white">🚀 已提交，正在启动分析</p>
              <p className="mt-1.5 text-[11px] text-white/70 leading-relaxed">
                解读项目 → 生成问题清单 → 访谈校对 → 分析结论
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 右 3/4：全字段检索 + 解读项目卡片 + 分页 ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* 检索栏 */}
        <div className="bg-white rounded-2xl border border-primary-100 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="全字段检索：项目名称 / 行业赛道 / 公司定位 / 文档名"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-primary-400 focus:border-primary-400"
            />
          </div>
          <span className="text-[11px] text-gray-400">
            共 {filtered.length} 个{search.trim() ? `（检索自 ${list.length}）` : ''}
          </span>
        </div>

        {/* 卡片列表 */}
        <div className="flex-1 overflow-y-auto mt-3 pb-4">
          {pageItems.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-16 text-center">
              <p className="text-sm text-gray-400">
                {list.length === 0 ? '暂无解读记录，左侧上传文档开始' : '没有匹配的解读项目，换个关键词试试'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
              {pageItems.map(item => (
                <div
                  key={item.id}
                  onClick={() => { setError(''); fetchDetail(item.id) }}
                  className="card-float group bg-white rounded-2xl border border-gray-100 hover:border-primary-200 px-4 py-3.5 cursor-pointer flex flex-col"
                >
                  {/* 第一行：状态灯 + 项目名 + 日期 */}
                  <div className="flex items-start gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${
                      item.status === 'INTERPRETED' ? 'bg-emerald-500' : item.status === 'FAILED' ? 'bg-red-400' : 'bg-blue-400'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-800 truncate" title={item.projectName}>{item.projectName}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                        {item.industry || '待解读'} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(item.id) }}
                      className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity px-1 flex-shrink-0"
                      title="删除"
                    >
                      ✕
                    </button>
                  </div>
                  {/* 第二行：公司定位/市场地位摘要 */}
                  {item.marketPosition && (
                    <p className="mt-2 text-[11px] text-gray-500 line-clamp-2 leading-relaxed">{item.marketPosition}</p>
                  )}
                  {/* 第三行：解读进展徽标 */}
                  <div className="mt-2.5 pt-2.5 border-t border-gray-50 flex items-center gap-1.5 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      item.status === 'INTERPRETED' ? 'bg-emerald-50 text-emerald-600'
                        : item.status === 'FAILED' ? 'bg-red-50 text-red-500'
                          : item.status === 'INTERPRETING' ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-400'
                    }`}>
                      {item.status === 'INTERPRETED' ? '已解读' : item.status === 'FAILED' ? '解读失败' : item.status === 'INTERPRETING' ? '解读中' : '待解读'}
                    </span>
                    {item.questionCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-500">问题 {item.questionCount}</span>
                    )}
                    {item.verifyStatus === 'DONE' ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-50 text-indigo-600">已校验 {item.verifiedCount}/{item.questionCount}</span>
                    ) : item.verifyStatus === 'RUNNING' ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-50 text-indigo-400">校验中</span>
                    ) : null}
                    {item.hasConclusion && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-50 text-violet-600">已出结论</span>
                    )}
                    {item.linkedProjectId && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700">✅ 已入项目库</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 分页（超过 15 个分页管理） */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-1.5 flex-wrap">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs text-gray-500 hover:border-primary-300 disabled:opacity-40"
              >
                上一页
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                .map((p, idx, arr) => (
                  <span key={p} className="flex items-center">
                    {idx > 0 && p - arr[idx - 1] > 1 && <span className="px-1 text-gray-300 text-xs">…</span>}
                    <button
                      onClick={() => setPage(p)}
                      className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${
                        p === safePage
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'bg-white border border-gray-200 text-gray-500 hover:border-primary-300'
                      }`}
                    >
                      {p}
                    </button>
                  </span>
                ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs text-gray-500 hover:border-primary-300 disabled:opacity-40"
              >
                下一页
              </button>
              <span className="ml-2 text-[11px] text-gray-400">{safePage} / {totalPages} 页 · 每页 {PAGE_SIZE} 个</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═════ 详情视图 ═════

function Detail({
  detail,
  busy,
  error,
  autoChainStep,
  questionSkills,
  onBack,
  onInterpret,
  onQuestions,
  onVerifyClaims,
  onConclusion,
  onQuestionVerified,
  onProjectCreated,
}: {
  detail: InterpretationDetail
  busy: boolean
  error: string
  autoChainStep: 'idle' | 'interpret' | 'questions' | 'verify' | 'done' | 'error'
  questionSkills: string[]
  onBack: () => void
  onInterpret: () => void
  onQuestions: () => void
  onVerifyClaims: () => Promise<void>
  onConclusion: () => void
  onQuestionVerified: () => void
  onProjectCreated: () => void
}) {
  const interpretation = useMemoParse<InterpretationResult>(detail.interpretationJson)
  const verification = useMemoParse<VerificationView>(detail.verificationJson)
  const conclusion = useMemoParse<OverallConclusion>(detail.conclusionJson)
  const verifiedCount = detail.questions.filter(q => q.verifyStatus === 'VERIFIED').length
  const sectorCount = detail.questions.filter(q => q.sectorInsight).length
  const claimCount = detail.questions.filter(q => q.claimFlag).length
  const router = useRouter()

  // ── 外部校验（联网交叉核验 BP 关键声明） ──
  const [verifying, setVerifying] = useState(false)
  const handleVerifyClaims = async () => {
    if (verifying || busy) return
    setVerifying(true)
    try {
      await onVerifyClaims()
    } finally {
      setVerifying(false)
    }
  }

  // ── 闭环创建到项目库（P5：预填充表单 + 维护人补全必填项后确认创建） ──
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftErr, setDraftErr] = useState('')
  const [createFormOpen, setCreateFormOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateProjectForm | null>(null)
  // BP 关键页图片（draft 返回；创建时按字段嵌入 HTML——BP 原文图+文字一起入库）
  const [bpImages, setBpImages] = useState<Record<string, BpImage[]>>({})
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null)
  const promptedRef = useRef<string | null>(null)
  useEffect(() => {
    setCreatedProjectId(detail.linkedProjectId)
  }, [detail.linkedProjectId])
  useEffect(() => {
    if (
      detail.verifyStatus === 'DONE' &&
      detail.conclusionJson &&
      !detail.linkedProjectId &&
      promptedRef.current !== detail.id
    ) {
      promptedRef.current = detail.id
      setCreateModalOpen(true)
    }
  }, [detail.id, detail.verifyStatus, detail.conclusionJson, detail.linkedProjectId])

  /** 第一步：AI 预取填充信息（排版化提取 + BP 关键页图片，不创建项目）→ 打开预填充表单 */
  const handleStartFill = async () => {
    if (draftLoading) return
    setDraftLoading(true)
    setDraftErr('')
    try {
      const res = await fetch(`/api/project-interpretation/${detail.id}/create-project/draft`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setDraftErr(data.error || 'AI 提取失败')
        return
      }
      const d = data.draft as DraftData
      setCreateForm({
        name: d.name || '',
        companyFullName: d.companyFullName || '',
        industry: d.industry || '',
        companyPosition: d.companyPosition || '',
        mainProducts: d.mainProducts || '',
        coreAdvantage: d.coreAdvantage === '未披露' ? '' : (d.coreAdvantage || ''),
        coreTeam: d.coreTeam === '未披露' ? '' : (d.coreTeam || ''),
        financialData: d.financialData === '未披露' ? '' : (d.financialData || ''),
        orderProgress: d.orderProgress === '未披露' ? '' : (d.orderProgress || ''),
        competitors: d.competitors === '未披露' ? '' : (d.competitors || ''),
        financingPlan: d.financingPlan === '未披露' ? '' : (d.financingPlan || ''),
        description: d.description || '',
        financingRound: d.financingRound || '',
        totalAmount: d.totalAmount === '待补充' ? '' : (d.totalAmount || ''),
        investmentValuation: d.investmentValuation !== null && d.investmentValuation !== undefined ? String(d.investmentValuation) : '',
        targetDate: data.defaultTargetDate || new Date().toISOString().split('T')[0],
      })
      setBpImages((data.bpImages as Record<string, BpImage[]>) || {})
      setCreateModalOpen(false)
      setCreateFormOpen(true)
    } catch {
      setDraftErr('网络错误（AI 提取耗时较长，请稍后重试）')
    } finally {
      setDraftLoading(false)
    }
  }

  /** 第二步：维护人补全必填项后点击「创建项目」完成创建（富文本 markdown + BP 图片一起提交） */
  const handleCreateProject = async () => {
    if (creating || !createForm) return
    const missing: string[] = []
    if (!createForm.name.trim()) missing.push('项目名称')
    if (!createForm.industry.trim()) missing.push('所处行业')
    if (!createForm.companyPosition.trim()) missing.push('公司定位')
    if (!createForm.totalAmount.trim()) missing.push('融资金额')
    if (!createForm.investmentValuation.trim()) missing.push('投资估值')
    if (!createForm.targetDate) missing.push('初聊日期')
    if (missing.length > 0) {
      setCreateErr(`请先填写必填项：${missing.join('、')}`)
      return
    }
    setCreating(true)
    setCreateErr('')
    try {
      const res = await fetch(`/api/project-interpretation/${detail.id}/create-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...createForm,
          investmentValuation: createForm.investmentValuation ? Number(createForm.investmentValuation) : null,
          bpImages,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateErr(data.error || '创建失败')
        return
      }
      setCreatedProjectId(data.projectId)
      setCreateFormOpen(false)
      onProjectCreated()
      // 创建成功后跳转到项目详情页
      router.push(`/projects/${data.projectId}`)
    } catch {
      setCreateErr('网络错误，请稍后重试')
    } finally {
      setCreating(false)
    }
  }

  // 批量访谈校验（一次上传，自动校验全部问题并生成结论）
  const [ivOpen, setIvOpen] = useState(false)
  const [ivFile, setIvFile] = useState<File | null>(null)
  const [ivText, setIvText] = useState('')
  const [ivBusy, setIvBusy] = useState(false)
  const [ivErr, setIvErr] = useState('')
  const ivFileRef = useRef<HTMLInputElement>(null)

  const submitInterview = async () => {
    setIvBusy(true)
    setIvErr('')
    try {
      const fd = new FormData()
      if (ivFile) fd.append('file', ivFile)
      if (ivText.trim()) fd.append('text', ivText.trim())
      else if (ivFile && /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(ivFile.name)) {
        setIvErr('音频文件需要粘贴访谈纪要文字后提交')
        setIvBusy(false)
        return
      }
      const res = await fetch(`/api/project-interpretation/${detail.id}/verify`, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setIvErr(data.error || '校验失败')
        return
      }
      setIvFile(null)
      setIvText('')
      setIvOpen(false)
      onQuestionVerified()
    } catch {
      setIvErr('网络错误（批量校验耗时较长，请稍后重试）')
    } finally {
      setIvBusy(false)
    }
  }

  const questionsReady = detail.questionsStatus === 'READY' && detail.questions.length > 0

  // 自动链路进度步骤
  const chainSteps = [
    { key: 'interpret', label: '解读项目' },
    { key: 'questions', label: '生成问题清单' },
    { key: 'verify', label: '访谈校对' },
  ] as const
  const chainActive = autoChainStep !== 'idle'
  const chainIndex = chainSteps.findIndex(s => s.key === autoChainStep)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto pb-6">
        {/* ── 顶部管理栏（sticky）：返回 + 项目信息 + 操作按钮 ── */}
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border border-primary-100 rounded-2xl shadow-sm px-5 py-3">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={onBack}
              className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-500 hover:border-primary-300 hover:text-primary-600 transition-colors flex-shrink-0"
            >
              ← 返回
            </button>
            <div className="flex-1 min-w-[200px]">
              <h3 className="text-base font-bold text-gray-900 truncate">{detail.projectName}</h3>
              <p className="text-[11px] text-gray-400 truncate">
                {detail.fileName}
                {interpretation?.industry && ` · ${interpretation.industry}`}
                {` · ${new Date(detail.createdAt).toLocaleDateString('zh-CN')}`}
              </p>
            </div>
            {/* 操作按钮：解读与问题清单可并行执行；上传访谈纪要需问题清单就绪 */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={onInterpret}
                disabled={busy || detail.status === 'INTERPRETING'}
                className="px-3.5 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/25 hover:bg-blue-700 disabled:opacity-50"
              >
                {busy && detail.status === 'INTERPRETING' ? '解读中...' : '解读项目'}
              </button>
              <button
                onClick={onQuestions}
                disabled={busy || detail.questionsStatus === 'GENERATING'}
                className="px-3.5 py-2 bg-white border border-blue-200 text-blue-700 text-xs font-bold rounded-xl hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {detail.questionsStatus === 'GENERATING' ? '生成中...' : '生成问题清单'}
              </button>
              <button
                onClick={() => setIvOpen(!ivOpen)}
                disabled={!questionsReady || detail.verifyStatus === 'RUNNING' || busy}
                title={!questionsReady ? '请先生成问题清单' : '上传一次访谈纪要，自动校验全部问题'}
                className={`px-3.5 py-2 text-xs font-bold rounded-xl shadow-md disabled:opacity-40 disabled:cursor-not-allowed ${
                  detail.verifyStatus === 'DONE'
                    ? 'bg-emerald-500 text-white shadow-emerald-500/25 hover:bg-emerald-600'
                    : 'bg-gradient-to-r from-indigo-500 to-blue-600 text-white shadow-indigo-500/25'
                }`}
              >
                {detail.verifyStatus === 'RUNNING' ? '校验中...' : detail.verifyStatus === 'DONE' ? '重新上传访谈纪要' : '上传访谈纪要'}
              </button>
              {!createdProjectId && detail.verifyStatus === 'DONE' && detail.conclusionJson && (
                <button
                  onClick={() => { setDraftErr(''); setCreateErr(''); setCreateModalOpen(true) }}
                  className="px-3.5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold rounded-xl shadow-md hover:from-blue-700 hover:to-indigo-700"
                >
                  创建到项目库
                </button>
              )}
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          {detail.status === 'FAILED' && detail.error && <p className="mt-2 text-xs text-red-500">上次执行失败：{detail.error}</p>}

          {/* 已创建到项目库（闭环） */}
          {createdProjectId && (
            <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2">
              <span className="text-sm">✅</span>
              <p className="text-xs text-emerald-700 flex-1">该项目已创建到项目库（初聊阶段）</p>
              <a
                href={`/projects/${createdProjectId}`}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-emerald-500 text-white text-xs font-bold rounded-lg hover:bg-emerald-600"
              >
                查看项目 →
              </a>
            </div>
          )}
        </div>

        {/* 自动链路进度（BP+访谈纪要一起上传触发） */}
        {chainActive && (
          <div className={`mt-4 rounded-2xl border p-4 ${
            autoChainStep === 'done' ? 'bg-emerald-50 border-emerald-200' : autoChainStep === 'error' ? 'bg-red-50 border-red-200' : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200'
          }`}>
            <div className="flex items-center gap-2 flex-wrap">
              {autoChainStep === 'done' ? (
                <span className="text-sm font-bold text-emerald-700">✓ 自动分析完成：解读、问题清单与访谈校对结论已生成</span>
              ) : autoChainStep === 'error' ? (
                <span className="text-sm font-bold text-red-600">✕ 自动分析中断，可在下方手动继续各步骤</span>
              ) : (
                <span className="text-sm font-bold text-indigo-700 flex items-center gap-2">
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-500" />
                  自动分析中（BP + 访谈纪要）...
                </span>
              )}
            </div>
            {autoChainStep !== 'error' && (
              <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                {chainSteps.map((s, i) => (
                  <span key={s.key} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-gray-300">→</span>}
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                      autoChainStep === 'done' || i < chainIndex
                        ? 'bg-emerald-100 text-emerald-700'
                        : i === chainIndex
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-white text-gray-400 border border-gray-200'
                    }`}>
                      {autoChainStep === 'done' || i < chainIndex ? '✓ ' : i === chainIndex ? '⏳ ' : ''}{s.label}
                    </span>
                  </span>
                ))}
                <span className="text-gray-300">→</span>
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                  autoChainStep === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-white text-gray-400 border border-gray-200'
                }`}>
                  {autoChainStep === 'done' ? '✓ ' : ''}分析结论
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── 主体两列：左=项目解读信息（七维+融资案例+综合结论）｜右=访谈校验+外部校验+问题清单 ── */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
          <div className="lg:col-span-3 space-y-4">

        {/* 未解读占位 */}
        {!interpretation && (
          <div className="card-float bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-400">
              {detail.status === 'INTERPRETING' ? 'AI 正在按固定七维框架解读项目…' : '尚未解读——点击上方「解读项目」开始固定七维框架分析'}
            </p>
          </div>
        )}

        {/* 解读结果（七维 + 融资案例） */}
        {interpretation && (
          <div className="card-float card-float-wiggle bg-white rounded-2xl border border-primary-100 p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h4 className="text-sm font-bold text-gray-900">项目解读 · 固定七维框架</h4>
              {interpretation.appliedSkills?.length ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-50 border border-violet-200 text-[10px] font-medium text-violet-700">
                  ⚡ 已应用你的 {interpretation.appliedSkills.length} 个技能：{interpretation.appliedSkills.join('、')}
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { label: '市场地位', value: interpretation.marketPosition },
                { label: '技术领先性', value: interpretation.techLeadership },
                { label: '团队行业咖位', value: interpretation.teamStanding },
                { label: '竞争分析', value: interpretation.competitionAnalysis },
                { label: '行业创业窗口', value: interpretation.startupWindow },
                { label: '市场地位预估（业务进展 + 客户 logo）', value: interpretation.marketEstimate },
              ].map(d => (
                <div key={d.label} className="card-float card-float-wiggle rounded-xl bg-slate-50 border border-gray-100 p-3">
                  <p className="text-[11px] font-bold text-blue-600">{d.label}</p>
                  <RichText text={d.value} className="text-xs text-gray-700 mt-1 space-y-0.5" />
                </div>
              ))}
            </div>

            {/* 技能独立分析模块（挂载技能视角超出七维框架时单列；与某维相似的技能已融入上方对应维度） */}
            {interpretation.skillModules?.length ? (
              <div className="mt-3 space-y-2.5">
                <p className="text-[11px] font-bold text-violet-600">⚡ 你的技能 · 独立分析模块</p>
                {interpretation.skillModules.map((m, i) => (
                  <div key={i} className="card-float card-float-wiggle rounded-xl bg-violet-50/60 border border-violet-200 p-3">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700">⚡ {m.skillName}</span>
                      {m.title && <p className="text-[11px] font-bold text-violet-800">{m.title}</p>}
                    </div>
                    <RichText text={m.content} className="text-xs text-gray-700 space-y-0.5" strongClassName="font-bold text-violet-900" />
                  </div>
                ))}
              </div>
            ) : null}

            {/* 融资案例表（模型按项目定位/产品/技术智能匹配，含国内外 + 重合度说明） */}
            <div className="mt-4">
              <p className="text-[11px] font-bold text-blue-600 mb-2">
                重合度较高的融资案例（{interpretation.financingCases?.length || 0} 条 · 按项目定位/产品/技术智能匹配，含国内外）
              </p>
              {interpretation.financingCases?.length ? (
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full min-w-[960px] table-fixed text-xs">
                    <colgroup>
                      {/* 窄列：公司/轮次/金额/时间 */}
                      <col className="w-36" />
                      <col className="w-[76px]" />
                      <col className="w-[92px]" />
                      <col className="w-[76px]" />
                      {/* 宽列：投资方/业务/重合度（后两列均分剩余宽度） */}
                      <col className="w-44" />
                      <col />
                      <col />
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-50 text-gray-500">
                        <th className="px-3 py-2.5 text-left font-semibold">公司</th>
                        <th className="px-2 py-2.5 text-left font-semibold">轮次</th>
                        <th className="px-2 py-2.5 text-left font-semibold">金额</th>
                        <th className="px-2 py-2.5 text-left font-semibold">时间</th>
                        <th className="px-3 py-2.5 text-left font-semibold">投资方</th>
                        <th className="px-3 py-2.5 text-left font-semibold">业务</th>
                        <th className="px-3 py-2.5 text-left font-semibold">与本项目重合度</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {interpretation.financingCases.map((c, i) => (
                        <tr key={i} className="text-gray-700 hover:bg-slate-50/60 transition-colors">
                          <td className="px-3 py-2.5 font-medium break-words">{c.company}</td>
                          <td className="px-2 py-2.5 break-words text-gray-600">{c.round}</td>
                          <td className="px-2 py-2.5 break-words text-blue-600 font-semibold">{c.amount}</td>
                          <td className="px-2 py-2.5 break-words text-gray-600">{c.date}</td>
                          <td className="px-3 py-2.5 leading-relaxed break-words">{c.investors}</td>
                          <td className="px-3 py-2.5 text-gray-500 leading-relaxed break-words">{c.brief}</td>
                          <td className="px-3 py-2.5 text-indigo-600 leading-relaxed break-words">{c.relevance || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-gray-400">联网检索未获取到重合度较高的融资案例</p>
              )}
            </div>
          </div>
        )}

        {/* 综合结论（原问题清单下方，重排后归入左列解读信息区） */}
        {detail.questions.length > 0 && (
          <div className="card-float card-float-wiggle bg-white rounded-2xl border border-primary-100 p-5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h4 className="text-sm font-bold text-gray-900">综合分析结论</h4>
              <button
                onClick={onConclusion}
                disabled={busy || verifiedCount < 3}
                title={verifiedCount < 3 ? '至少 3 个问题被访谈覆盖后可生成（上传访谈纪要后自动生成）' : '基于最新校验结果重新生成'}
                className="px-3.5 py-2 bg-white border border-indigo-200 text-indigo-600 text-xs font-bold rounded-xl hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {conclusion ? '🔄 重新生成' : '手动生成'}
              </button>
            </div>
            {conclusion ? (
              <div className="mt-3 space-y-2.5">
                {/* 新结论高亮展示（含赛道沉淀问题的校验支撑，作为该赛道后续项目的关注重点） */}
                <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-blue-50 border-2 border-indigo-200 p-3.5 shadow-sm">
                  <p className="text-xs font-bold text-indigo-600">★ 新结论 · 总体判断</p>
                  <RichText
                    text={conclusion.summary}
                    className="text-sm text-indigo-900 font-bold mt-1 space-y-0.5"
                    lineClassName="leading-relaxed"
                    strongClassName="font-bold text-indigo-950"
                    placeholder="—"
                  />
                </div>
                {conclusion.dimensions.map((d, i) => (
                  <div key={i} className="flex items-start gap-2.5 rounded-xl border border-gray-100 p-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 mt-0.5 ${MATCH_STYLES[d.gapLevel]?.cls || 'bg-gray-100'}`}>
                      {MATCH_STYLES[d.gapLevel]?.label || d.gapLevel}
                    </span>
                    <div>
                      <p className="text-xs font-bold text-gray-800">{d.aspect}</p>
                      <RichText
                        text={d.conclusion}
                        className="text-xs text-gray-600 mt-0.5 space-y-0.5"
                        lineClassName="leading-relaxed"
                        placeholder="—"
                      />
                    </div>
                  </div>
                ))}
                {conclusion.advice && (
                  <div className="text-xs text-gray-500 px-1">
                    💡 建议：<RichText text={conclusion.advice} lineClassName="leading-relaxed" placeholder="—" />
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs text-gray-400">
                上传一次访谈纪要后，系统自动校验全部问题并生成综合结论（如：技术壁垒方面差距较大 → 技术壁垒不高）。
              </p>
            )}
          </div>
        )}
          </div>{/* 左列结束 */}

          {/* ── 右列：访谈纪要上传 + 外部校验 + 问题清单 ── */}
          <div className="lg:col-span-2 space-y-4">
            {/* 访谈纪要批量校验卡（一次上传 → 自动校验全部问题 + 综合结论） */}
            <div className="card-float card-float-wiggle bg-white rounded-2xl border border-primary-100 p-5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="text-sm font-bold text-gray-900">📋 访谈纪要校验</h4>
                {detail.verifyStatus === 'DONE' && !ivOpen && (
                  <span className="text-[11px] text-emerald-600">
                    ✓ 已完成（{verifiedCount}/{detail.questions.length} 题）
                  </span>
                )}
              </div>
              {detail.interviewFileName && !ivOpen && (
                <p className="mt-1 text-[11px] text-gray-400">📎 上次纪要：{detail.interviewFileName}</p>
              )}
              {ivOpen || detail.verifyStatus === 'RUNNING' ? (
                <div className="mt-3 space-y-2.5">
                  <p className="text-xs font-bold text-gray-600">
                    上传一次访谈纪要，系统自动校验全部问题并生成综合结论
                    <button
                      onClick={() => setIvOpen(false)}
                      className="ml-2 px-2 py-0.5 border border-gray-200 rounded-lg text-[10px] font-bold text-gray-400 hover:text-gray-600 hover:border-gray-300"
                    >
                      收起 ↑
                    </button>
                  </p>
                  {detail.verifyStatus === 'RUNNING' ? (
                    <div className="flex items-center gap-2 text-sm text-indigo-600 py-2">
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-500" />
                      批量校验中：AI 正在逐题对比访谈回答与理想答案（约 1-2 分钟）...
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => ivFileRef.current?.click()}
                          className="px-3 py-1.5 bg-white border border-gray-200 text-xs font-bold rounded-lg hover:border-blue-300 text-gray-600"
                        >
                          {ivFile ? `已选：${ivFile.name}` : '选择访谈纪要（音频/文档）'}
                        </button>
                        <input
                          ref={ivFileRef}
                          type="file"
                          accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,.pdf,.docx,.txt,.md,.pptx"
                          className="hidden"
                          onChange={e => {
                            setIvFile(e.target.files?.[0] || null)
                            e.target.value = ''
                          }}
                        />
                        <button
                          onClick={submitInterview}
                          disabled={ivBusy || (!ivFile && !ivText.trim())}
                          className="px-4 py-1.5 bg-gradient-to-r from-indigo-500 to-blue-600 text-white text-xs font-bold rounded-lg disabled:opacity-40"
                        >
                          {ivBusy ? '校验中...' : '提交并自动校验全部问题'}
                        </button>
                      </div>
                      <textarea
                        value={ivText}
                        onChange={e => setIvText(e.target.value)}
                        rows={4}
                        placeholder="或直接粘贴访谈纪要全文（音频转写内容/访谈记录）。粘贴文字可不选文件。"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
                      />
                      <p className="text-[10px] text-gray-400">音频文件会保存留档，需配合粘贴转写文本；支持 pdf/docx/txt/pptx 自动提取</p>
                      {ivErr && <p className="text-xs text-red-500">{ivErr}</p>}
                    </>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setIvOpen(true)}
                  disabled={!questionsReady}
                  className="mt-3 w-full px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-blue-600 text-white text-xs font-bold rounded-xl shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
                  title={!questionsReady ? '请先生成问题清单' : ''}
                >
                  {detail.verifyStatus === 'DONE' ? '重新上传访谈纪要' : '上传访谈纪要（自动校验全部问题）'}
                </button>
              )}
            </div>

        {/* 外部校验（BP 关键声明联网交叉核验；夸大/矛盾声明自动进入问题清单优先追问） */}
        {interpretation && (
          <div className="card-float card-float-wiggle bg-white rounded-2xl border border-sky-100 p-5">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <h4 className="text-sm font-bold text-sky-700">
                🔍 外部校验 <span className="font-normal text-gray-400 text-xs">· 联网交叉核验 BP 关键声明（客户/订单/性能/融资等）</span>
              </h4>
              <button
                onClick={handleVerifyClaims}
                disabled={verifying || busy}
                className="text-xs px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg font-bold hover:bg-sky-100 border border-sky-100 disabled:opacity-50"
              >
                {verifying ? '核验中...' : verification ? '🔄 重新校验' : '🔍 开始外部校验'}
              </button>
            </div>

            {verifying ? (
              <p className="text-xs text-sky-700 py-2 flex items-center gap-2">
                <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-sky-300 border-t-sky-600 animate-spin" />
                正在联网检索并交叉核验 BP 关键声明（约 30-60 秒）...
              </p>
            ) : !verification ? (
              <p className="text-xs text-gray-400 py-1">
                尚未校验。点击后 AI 将提取 BP 中的关键声明（营收/订单/客户合作/性能指标/团队背景等）联网交叉核验；
                发现 <span className="text-amber-600 font-bold">⚠️ 夸大</span> / <span className="text-red-500 font-bold">❌ 矛盾</span> 的声明会在生成问题清单时自动转为优先追问。
              </p>
            ) : (
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-2.5">
                  <span className="text-xs font-bold text-gray-700">{verification.summary}</span>
                  <span className="text-[11px] text-gray-400">校验于 {new Date(verification.verifiedAt).toLocaleString('zh-CN')}</span>
                </div>
                {verification.claims.length === 0 ? (
                  <p className="text-xs text-gray-400 py-1">{verification.summary}</p>
                ) : (
                  <div className="space-y-2">
                    {verification.claims.map((c, i) => (
                      <div key={i} className="p-3 rounded-xl bg-slate-50/70 border border-slate-100">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <p className="text-xs text-gray-700 leading-relaxed flex-1 min-w-[220px]">{c.claim}</p>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex-shrink-0 ${VERDICT_BADGES[c.verdict]?.cls || VERDICT_BADGES.UNVERIFIED.cls}`}>
                            {VERDICT_BADGES[c.verdict]?.label || c.verdict}
                          </span>
                        </div>
                        {c.note && <p className="text-[11px] text-gray-500 leading-relaxed mt-1.5">▸ {c.note}</p>}
                        {c.evidence.length > 0 && (
                          <div className="mt-2 flex flex-col gap-0.5">
                            {c.evidence.map((e, j) => (
                              <a key={j} href={e.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-sky-600 hover:underline truncate" title={`${e.title}\n${e.snippet}`}>
                                🔗 {e.title || e.url}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 问题清单 */}
        {detail.questions.length > 0 && (
          <div className="card-float card-float-wiggle bg-white rounded-2xl border border-primary-100 p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h4 className="text-sm font-bold text-gray-900">
                访谈问题清单（{detail.questions.length} 问 · 技术 {detail.questions.filter(q => q.category === 'TECH').length}）
              </h4>
              <span className="text-xs text-gray-400">已分析 {verifiedCount}/{detail.questions.length} · 上传一次访谈纪要自动校验</span>
            </div>
            {questionSkills.length > 0 && (
              <div className="mb-3 flex items-center gap-2 rounded-xl bg-violet-50 border border-violet-200 px-3 py-2">
                <span className="text-xs">⚡</span>
                <p className="text-[11px] text-violet-700">
                  本次生成<b>已应用你的 {questionSkills.length} 个技能</b>：{questionSkills.join('、')}（技能的分析视角已影响问题设计；重新生成会应用你当前确认的技能）
                </p>
              </div>
            )}
            {claimCount > 0 && (
              <div className="mb-3 flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2">
                <span className="text-xs">🔍</span>
                <p className="text-[11px] text-red-600">
                  已纳入 <b>{claimCount}</b> 个<b>核验追问</b>（外部校验发现 BP 声明夸大/矛盾，排在清单前部，访谈时必须优先质询）
                </p>
              </div>
            )}
            {sectorCount > 0 && (
              <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
                <span className="text-xs">⭐</span>
                <p className="text-[11px] text-amber-700">
                  已纳入 <b>{sectorCount}</b> 个<b>赛道沉淀问题</b>（同赛道历史项目访谈验证的高质量问题，为重点二次校验项）
                </p>
              </div>
            )}
            <div className="space-y-2.5">
              {detail.questions.map(q => (
                <QuestionCard key={q.id} question={q} />
              ))}
            </div>
          </div>
        )}
          </div>{/* 右列结束 */}
        </div>{/* 两列 grid 结束 */}

        {/* 创建到项目库·第一步：校验结论生成后提醒（AI 预填充，不直接创建） */}
        {createModalOpen && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
            onClick={() => { if (!draftLoading) setCreateModalOpen(false) }}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="space-y-3">
                <h4 className="text-base font-bold text-gray-900">将该项目创建到项目库？</h4>
                <p className="text-xs text-gray-500 leading-relaxed">
                  系统将按<b>项目库创建模板</b>，从 BP 与访谈纪要中预填充项目信息——
                  <b className="text-primary-700">主要产品、核心优势、核心团队、财务数据、订单进展、竞争对手、融资规划</b>
                  截取 BP 原文相关页与文字总结（分点排版、重点加粗），PDF/PPT 的 BP 还会<b>截取关键页图片</b>一起带入。
                  预填充后由<b>你补全必填项并确认</b>，才会创建项目。
                </p>
                {draftErr && (
                  <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{draftErr}</p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleStartFill}
                    disabled={draftLoading}
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold rounded-xl shadow-md hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
                  >
                    {draftLoading ? 'AI 提取 BP 信息中（约 30 秒）...' : '🤖 AI 预填充信息'}
                  </button>
                  <button
                    onClick={() => setCreateModalOpen(false)}
                    disabled={draftLoading}
                    className="px-4 py-2.5 bg-white border border-gray-200 text-gray-600 text-sm font-bold rounded-xl hover:bg-gray-50 disabled:opacity-50"
                  >
                    暂不创建
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 创建到项目库·第二步：预填充表单（维护人补全必填项 → 点击创建项目） */}
        {createFormOpen && createForm && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
            onClick={() => { if (!creating) setCreateFormOpen(false) }}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
                <h4 className="text-base font-bold text-gray-900">创建项目到项目库</h4>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  AI 已预填充 BP 提取的信息（分点排版、重点加粗），请检查并补全 <span className="text-red-500 font-bold">* 必填项</span>后点击「创建项目」
                </p>
              </div>
              <div className="p-6 space-y-4">
                {/* 基本信息 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">项目名称 <span className="text-red-500">*</span></label>
                    <input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-primary-400 focus:border-primary-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">公司全称</label>
                    <input value={createForm.companyFullName} onChange={e => setCreateForm({ ...createForm, companyFullName: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-primary-400 focus:border-primary-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">所处行业 <span className="text-red-500">*</span></label>
                    <input list="pi-industry-options" value={createForm.industry} onChange={e => setCreateForm({ ...createForm, industry: e.target.value })}
                      placeholder="下拉选择或自定义输入"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-primary-400 focus:border-primary-400" />
                    <datalist id="pi-industry-options">
                      {INDUSTRY_OPTIONS.map(o => <option key={o} value={o} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">公司定位 <span className="text-red-500">*</span></label>
                    <input value={createForm.companyPosition} onChange={e => setCreateForm({ ...createForm, companyPosition: e.target.value })}
                      placeholder="一句话定位（30字内）"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-primary-400 focus:border-primary-400" />
                  </div>
                </div>
                {/* 融资信息 */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">融资轮次</label>
                    <select value={createForm.financingRound} onChange={e => setCreateForm({ ...createForm, financingRound: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white">
                      <option value="">请选择</option>
                      {FINANCING_ROUND_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">融资金额 <span className="text-red-500">*</span></label>
                    <input value={createForm.totalAmount} onChange={e => setCreateForm({ ...createForm, totalAmount: e.target.value })}
                      placeholder="如 8000万 / 2亿"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-primary-400 focus:border-primary-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">投资估值（亿元）<span className="text-red-500">*</span></label>
                    <input type="number" step="0.1" value={createForm.investmentValuation} onChange={e => setCreateForm({ ...createForm, investmentValuation: e.target.value })}
                      placeholder="如 5.5"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-primary-400 focus:border-primary-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">初聊日期 <span className="text-red-500">*</span></label>
                    <input type="date" value={createForm.targetDate} onChange={e => setCreateForm({ ...createForm, targetDate: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-primary-400 focus:border-primary-400" />
                  </div>
                </div>
                {/* 富文本字段：编辑 + 排版预览（markdown 分点+加粗，创建时转 HTML 入库） */}
                {([
                  ['mainProducts', '主要产品', 'AI 截取 BP 产品/服务相关页的原文关键表述', 6],
                  ['coreAdvantage', '核心优势', 'AI 截取 BP 技术壁垒/差异化/里程碑相关段落', 5],
                  ['coreTeam', '核心团队', 'BP 核心成员（一人一点）+ 访谈纪要中的团队补充信息', 8],
                  ['financialData', '财务数据', 'BP 与访谈纪要中的营收/毛利/现金流/历史融资', 4],
                  ['orderProgress', '订单进展', 'BP 与访谈纪要中的订单/POC/客户/合同金额', 4],
                  ['competitors', '竞争对手', 'BP 与访谈纪要中的竞品及对比要点', 4],
                  ['financingPlan', '融资规划', '本轮融资用途/资金分配/里程碑（BP+访谈纪要）', 3],
                  ['description', '项目描述', '综合 BP、访谈纪要与解读结论的综述', 4],
                ] as const).map(([field, label, hint, rows]) => (
                  <div key={field}>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      {label}{field === 'mainProducts' && <span className="text-red-500"> *</span>}
                      <span className="ml-2 text-[10px] text-gray-400 font-normal">{hint}｜支持 1. 2. 分点与 **加粗**</span>
                    </label>
                    <textarea
                      value={createForm[field]}
                      onChange={e => setCreateForm({ ...createForm, [field]: e.target.value })}
                      rows={rows}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-mono leading-relaxed focus:ring-2 focus:ring-primary-400 focus:border-primary-400"
                    />
                    <div className="mt-1.5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 max-h-32 overflow-y-auto">
                      <p className="text-[10px] text-gray-400 mb-1">排版预览</p>
                      <RichPreview text={createForm[field]} />
                    </div>
                    {/* BP 关键页配图（PDF 整页截图/PPTX 页内图；创建时嵌入该字段） */}
                    {bpImages[field]?.length > 0 && (
                      <div className="mt-1.5 rounded-lg border border-sky-100 bg-sky-50/40 px-3 py-2">
                        <p className="text-[10px] text-sky-700 font-bold mb-1.5">
                          📎 BP 原文配图（{bpImages[field].length} 张 · 创建时自动嵌入「{label}」）
                        </p>
                        <div className="flex gap-2 flex-wrap">
                          {bpImages[field].map((img, i) =>
                            img.url.split(';').filter(Boolean).map((u, j) => (
                              <div key={`${i}-${j}`} className="relative group">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={u}
                                  alt={`BP第${img.page}页`}
                                  className="h-20 rounded-lg border border-sky-200 object-cover object-top"
                                />
                                <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/50 text-white text-[9px]">P{img.page}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {createErr && (
                  <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{createErr}</p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleCreateProject}
                    disabled={creating}
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold rounded-xl shadow-md hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
                  >
                    {creating ? '创建中...' : '🚀 创建项目'}
                  </button>
                  <button
                    onClick={() => setCreateFormOpen(false)}
                    disabled={creating}
                    className="px-4 py-2.5 bg-white border border-gray-200 text-gray-600 text-sm font-bold rounded-xl hover:bg-gray-50 disabled:opacity-50"
                  >
                    暂不创建
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ═════ 问题卡片（浅色理想答案 + 批量校验结果展示） ═════

function QuestionCard({ question }: { question: QuestionView }) {
  const result = useMemoParse<VerifyResult>(question.verifyResultJson)
  const verified = question.verifyStatus === 'VERIFIED'

  return (
    <div className={`rounded-xl border p-3.5 ${
      question.claimFlag
        ? 'border-red-200 bg-red-50/20 border-l-4 border-l-red-400' // 核验追问：BP 声明夸大/矛盾的优先质询项
        : question.sectorInsight
        ? 'border-indigo-200 bg-indigo-50/30 border-l-4 border-l-indigo-400' // 赛道沉淀问题：重点二次校验高亮
        : verified ? 'border-gray-100 bg-slate-50/40' : 'border-gray-200'
    }`}>
      <div className="flex items-start gap-2.5">
        <span className={`text-xs font-black flex-shrink-0 mt-0.5 ${question.claimFlag ? 'text-red-400' : question.sectorInsight ? 'text-indigo-400' : 'text-gray-300'}`}>
          {String(question.order).padStart(2, '0')}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {question.claimFlag && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-600">
                🔍 核验追问 · 优先质询
              </span>
            )}
            {question.sectorInsight && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">
                ⭐ 赛道沉淀 · 重点校验
              </span>
            )}
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${CATEGORY_STYLES[question.category] || 'bg-gray-100'}`}>
              {CATEGORY_LABELS[question.category] || question.category}
            </span>
            <p className="text-sm font-bold text-gray-800 leading-snug">{question.question}</p>
          </div>
          {/* 理想答案（浅色字体；分点+加粗排版，单行内联/多行分点） */}
          <div className="text-xs text-gray-400 mt-1.5">
            <span className="font-medium">理想答案：</span>
            <RichText
              text={question.idealAnswer}
              lineClassName="leading-relaxed"
              strongClassName="font-bold text-gray-600"
              placeholder=""
            />
          </div>

          {/* 批量校验结果（上传一次访谈纪要后自动生成；赛道沉淀题结论高亮展示） */}
          {verified && result && (
            <div className={`mt-2.5 rounded-lg p-2.5 border ${
              result.matchLevel === 'GAP' ? 'bg-red-50/60 border-red-100'
                : result.matchLevel === 'PARTIAL' ? 'bg-amber-50/60 border-amber-100'
                  : result.matchLevel === 'UNCOVERED' ? 'bg-gray-50/60 border-gray-200'
                    : 'bg-emerald-50/60 border-emerald-100'
            }`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${MATCH_STYLES[result.matchLevel]?.cls}`}>
                  {MATCH_STYLES[result.matchLevel]?.label || result.matchLevel}
                </span>
              </div>
              {result.answerSummary && (
                <p className="text-xs text-gray-600 mt-1.5">回答要点：{result.answerSummary}</p>
              )}
              <div className="text-xs text-gray-700 mt-1">
                差距分析：
                <RichText text={result.gapAnalysis} lineClassName="leading-relaxed" placeholder="—" />
              </div>
              <div className={`mt-1 text-xs ${question.sectorInsight ? 'text-indigo-700 font-bold' : 'font-bold text-gray-800'}`}>
                结论：
                <RichText
                  text={result.conclusion}
                  lineClassName="leading-relaxed"
                  strongClassName={question.sectorInsight ? 'font-bold text-indigo-900' : 'font-bold text-gray-900'}
                  placeholder="—"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 安全解析 JSON 字段 */
function useMemoParse<T>(json: string | null): T | null {
  const parse = (j: string | null): T | null => {
    if (!j) return null
    try {
      return JSON.parse(j) as T
    } catch {
      return null
    }
  }
  const [value, setValue] = useState<T | null>(() => parse(json))
  useEffect(() => {
    setValue(parse(json))
  }, [json])
  return value
}
