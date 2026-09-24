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
import type {
  InterpretationResult,
  VerifyResult,
  OverallConclusion,
} from '@/lib/project-interpretation/constants'

// ── 类型 ──

interface InterpretationSummary {
  id: string
  projectName: string
  industry: string | null
  fileName: string
  status: string
  questionsStatus: string
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
  questionsStatus: string
  conclusionJson: string | null
  verifyStatus: string
  interviewFileName: string | null
  interviewFileUrl: string | null
  error: string | null
  createdAt: string
  questions: QuestionView[]
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
  // 粘贴文本备选通道（扫描件 PDF / 图片型 BP 直接粘贴项目内容）
  const [pastedText, setPastedText] = useState('')
  const [pasteBusy, setPasteBusy] = useState(false)
  // 初始上传：同时上传访谈纪要（可选）
  const [ivFile, setIvFile] = useState<File | null>(null)
  const [ivText, setIvText] = useState('')
  const ivInputRef = useRef<HTMLInputElement>(null)
  // 自动链路进度：BP+访谈纪要一起上传后自动执行 解读 → 问题清单 → 校验+结论
  const [autoChainStep, setAutoChainStep] = useState<'idle' | 'interpret' | 'questions' | 'verify' | 'done' | 'error'>('idle')

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
      setIvText('')
      setIvFile(null)
      await fetchList()
      await fetchDetail(id)
      // 同时上传了访谈纪要 → 自动执行完整分析链路
      if (data.interpretation.hasInterview) runAutoChain(id)
    } catch {
      setError('网络错误')
    } finally {
      setBusy(false)
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
        onBack={() => { setAutoChainStep('idle'); backToList() }}
        onInterpret={() => runAction('interpret', '解读')}
        onQuestions={() => runAction('questions', '生成问题清单')}
        onConclusion={() => runAction('conclusion', '生成综合结论')}
        onQuestionVerified={() => fetchDetail(detail.id)}
      />
    )
  }

  // 列表 + 上传视图
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* 上传框（初始界面） */}
        <div className="bg-white rounded-2xl border border-primary-100 shadow-sm p-6">
          <h3 className="text-base font-bold text-gray-900">上传项目文档，开始固定框架解读</h3>
          <p className="text-xs text-gray-400 mt-1">
            支持 PDF / Word(docx) / PPT(pptx) / Excel / txt · 上传后执行「解读项目」与「生成问题清单」
          </p>
          <input
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            placeholder="项目名称（选填，默认取文件名）"
            className="mt-4 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-400"
          />
          <div
            onClick={() => uploadInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f) handleUpload(f)
            }}
            className={`mt-3 border-2 border-dashed rounded-2xl py-12 text-center cursor-pointer transition-colors ${
              busy ? 'border-primary-200 bg-primary-50/30' : 'border-gray-200 hover:border-primary-300 hover:bg-primary-50/20'
            }`}
          >
            {busy ? (
              <div className="flex flex-col items-center gap-2">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
                <p className="text-sm text-primary-600">上传中...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-gray-500">点击或拖拽上传文档</p>
                <p className="text-[11px] text-gray-400">BP / 商业计划书 / 项目介绍材料</p>
              </div>
            )}
          </div>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".pdf,.docx,.pptx,.xlsx,.txt,.md"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleUpload(f)
              e.target.value = ''
            }}
          />
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

          {/* 同时上传访谈纪要（可选）：一起上传则自动执行 解读→问题清单→校验→结论 */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-bold text-gray-600">
              同时上传访谈纪要 <span className="text-gray-400 font-normal">（可选，上传后自动完成全部分析并生成结论）</span>
            </p>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => ivInputRef.current?.click()}
                className="px-3 py-1.5 bg-white border border-gray-200 text-xs font-bold rounded-lg hover:border-primary-300 text-gray-600"
              >
                {ivFile ? `已选：${ivFile.name}` : '📎 选择访谈纪要（音频/文档）'}
              </button>
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
              {(ivFile || ivText.trim()) && (
                <button
                  onClick={() => { setIvFile(null); setIvText('') }}
                  className="text-xs text-gray-400 hover:text-red-500"
                >
                  清除
                </button>
              )}
            </div>
            <textarea
              value={ivText}
              onChange={e => setIvText(e.target.value)}
              rows={3}
              placeholder="或粘贴访谈纪要全文（音频需配合粘贴转写文本）。与 BP 一起上传后，系统自动：解读项目 → 生成问题清单与理想答案 → 校对访谈回答 → 输出分析结论。"
              className="mt-2 w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-primary-300"
            />
          </div>

          {/* 粘贴文本备选通道（扫描件 PDF / 图片型 BP） */}
          <details className="mt-3">
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-primary-600 select-none">
              📄 扫描件 / 图片型文档？直接粘贴项目文本 →
            </summary>
            <textarea
              value={pastedText}
              onChange={e => setPastedText(e.target.value)}
              rows={5}
              placeholder="粘贴项目的文字内容（BP 正文、项目介绍等，至少 100 字）。适合扫描版 PDF 或以图片为主的 PPT——可从原文档复制文字，或粘贴其他来源的项目介绍。"
              className="mt-2 w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-primary-300"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={handlePasteUpload}
                disabled={pasteBusy || pastedText.trim().length < 100}
                className="px-4 py-2 bg-primary-500 text-white text-xs font-bold rounded-xl hover:bg-primary-600 disabled:opacity-40"
              >
                {pasteBusy ? '提交中...' : '用粘贴文本创建解读项目'}
              </button>
              <span className="text-[10px] text-gray-400">{pastedText.trim().length} 字（至少 100 字）</span>
            </div>
          </details>
        </div>

        {/* 解读历史 */}
        <div>
          <p className="text-sm font-bold text-gray-700 mb-2 px-1">我的解读项目（{list.length}）</p>
          {list.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">暂无解读记录，上传文档开始</p>
          ) : (
            <div className="space-y-2">
              {list.map(item => (
                <div
                  key={item.id}
                  onClick={() => { setError(''); fetchDetail(item.id) }}
                  className="group bg-white rounded-xl border border-gray-100 hover:border-primary-200 hover:shadow-sm px-4 py-3 flex items-center gap-3 cursor-pointer transition-all"
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    item.status === 'INTERPRETED' ? 'bg-emerald-500' : item.status === 'FAILED' ? 'bg-red-400' : 'bg-blue-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-800 truncate">{item.projectName}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {item.industry || '待解读'} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-400 flex-shrink-0">
                    {item.questionCount > 0 && <span>问题 {item.questionCount}</span>}
                    {item.verifiedCount > 0 && <span className="text-emerald-500">已校验 {item.verifiedCount}</span>}
                    <span className="px-1.5 py-0.5 bg-gray-50 rounded font-bold">
                      {item.status === 'INTERPRETED' ? '已解读' : item.status === 'FAILED' ? '失败' : item.status === 'INTERPRETING' ? '解读中' : '待解读'}
                    </span>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(item.id) }}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity px-1"
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              ))}
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
  onBack,
  onInterpret,
  onQuestions,
  onConclusion,
  onQuestionVerified,
}: {
  detail: InterpretationDetail
  busy: boolean
  error: string
  autoChainStep: 'idle' | 'interpret' | 'questions' | 'verify' | 'done' | 'error'
  onBack: () => void
  onInterpret: () => void
  onQuestions: () => void
  onConclusion: () => void
  onQuestionVerified: () => void
}) {
  const interpretation = useMemoParse<InterpretationResult>(detail.interpretationJson)
  const conclusion = useMemoParse<OverallConclusion>(detail.conclusionJson)
  const verifiedCount = detail.questions.filter(q => q.verifyStatus === 'VERIFIED').length

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
      <div className="max-w-4xl mx-auto space-y-5 pb-6">
        {/* 自动链路进度（BP+访谈纪要一起上传触发） */}
        {chainActive && (
          <div className={`rounded-2xl border p-4 ${
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

        {/* 头部 + 三个执行按钮 */}
        <div className="bg-white rounded-2xl border border-primary-100 shadow-sm p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <button onClick={onBack} className="text-xs text-gray-400 hover:text-primary-600 mb-1">← 返回列表</button>
              <h3 className="text-lg font-bold text-gray-900">{detail.projectName}</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {detail.fileName}
                {interpretation?.industry && ` · ${interpretation.industry}`}
                {` · ${new Date(detail.createdAt).toLocaleDateString('zh-CN')}`}
              </p>
            </div>
            {/* 三个按钮：解读与问题清单可并行执行；上传访谈纪要需问题清单就绪 */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={onInterpret}
                disabled={busy || detail.status === 'INTERPRETING'}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl shadow-md shadow-blue-500/25 hover:bg-blue-700 disabled:opacity-50"
              >
                {busy && detail.status === 'INTERPRETING' ? '解读中...' : '解读项目'}
              </button>
              <button
                onClick={onQuestions}
                disabled={busy || detail.questionsStatus === 'GENERATING'}
                className="px-4 py-2 bg-white border border-blue-200 text-blue-700 text-sm font-bold rounded-xl hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {detail.questionsStatus === 'GENERATING' ? '生成中...' : '生成问题清单'}
              </button>
              <button
                onClick={() => setIvOpen(!ivOpen)}
                disabled={!questionsReady || detail.verifyStatus === 'RUNNING' || busy}
                title={!questionsReady ? '请先生成问题清单' : '上传一次访谈纪要，自动校验全部问题'}
                className={`px-4 py-2 text-sm font-bold rounded-xl shadow-md disabled:opacity-40 disabled:cursor-not-allowed ${
                  detail.verifyStatus === 'DONE'
                    ? 'bg-emerald-500 text-white shadow-emerald-500/25 hover:bg-emerald-600'
                    : 'bg-gradient-to-r from-indigo-500 to-blue-600 text-white shadow-indigo-500/25'
                }`}
              >
                {detail.verifyStatus === 'RUNNING' ? '校验中...' : detail.verifyStatus === 'DONE' ? '重新上传访谈纪要' : '上传访谈纪要'}
              </button>
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          {detail.status === 'FAILED' && detail.error && <p className="mt-2 text-xs text-red-500">上次执行失败：{detail.error}</p>}

          {/* 访谈纪要批量校验区（一次上传 → 自动校验全部问题 + 综合结论） */}
          {(ivOpen || detail.verifyStatus === 'RUNNING') && (
            <div className="mt-4 pt-4 border-t border-gray-100 space-y-2.5">
              <p className="text-xs font-bold text-gray-600">
                上传一次访谈纪要，系统自动校验全部问题并生成综合结论
                {detail.interviewFileName && (
                  <span className="text-gray-400 font-normal ml-2">上次：📎 {detail.interviewFileName}</span>
                )}
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
          )}
          {detail.verifyStatus === 'DONE' && !ivOpen && (
            <p className="mt-2 text-[11px] text-emerald-600">
              ✓ 访谈校验已完成（{verifiedCount}/{detail.questions.length} 题已分析）{detail.interviewFileName && ` · 📎 ${detail.interviewFileName}`}
            </p>
          )}
        </div>

        {/* 解读结果（七维 + 融资案例） */}
        {interpretation && (
          <div className="bg-white rounded-2xl border border-primary-100 shadow-sm p-5">
            <h4 className="text-sm font-bold text-gray-900 mb-3">项目解读 · 固定七维框架</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { label: '市场地位', value: interpretation.marketPosition },
                { label: '技术领先性', value: interpretation.techLeadership },
                { label: '团队行业咖位', value: interpretation.teamStanding },
                { label: '竞争分析', value: interpretation.competitionAnalysis },
                { label: '行业创业窗口', value: interpretation.startupWindow },
                { label: '市场地位预估（业务进展 + 客户 logo）', value: interpretation.marketEstimate },
              ].map(d => (
                <div key={d.label} className="rounded-xl bg-slate-50 border border-gray-100 p-3">
                  <p className="text-[11px] font-bold text-blue-600">{d.label}</p>
                  <p className="text-xs text-gray-700 leading-relaxed mt-1">{d.value || '—'}</p>
                </div>
              ))}
            </div>

            {/* 融资案例表 */}
            <div className="mt-4">
              <p className="text-[11px] font-bold text-blue-600 mb-2">该行业融资案例（{interpretation.financingCases?.length || 0} 条）</p>
              {interpretation.financingCases?.length ? (
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-gray-500">
                        <th className="px-3 py-2 text-left font-semibold">公司</th>
                        <th className="px-3 py-2 text-left font-semibold">轮次</th>
                        <th className="px-3 py-2 text-left font-semibold">金额</th>
                        <th className="px-3 py-2 text-left font-semibold">时间</th>
                        <th className="px-3 py-2 text-left font-semibold">投资方</th>
                        <th className="px-3 py-2 text-left font-semibold">业务</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {interpretation.financingCases.map((c, i) => (
                        <tr key={i} className="text-gray-700">
                          <td className="px-3 py-2 font-medium whitespace-nowrap">{c.company}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{c.round}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-blue-600 font-medium">{c.amount}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{c.date}</td>
                          <td className="px-3 py-2">{c.investors}</td>
                          <td className="px-3 py-2 text-gray-500">{c.brief}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-gray-400">联网检索未获取到该行业融资案例</p>
              )}
            </div>
          </div>
        )}

        {/* 问题清单 */}
        {detail.questions.length > 0 && (
          <div className="bg-white rounded-2xl border border-primary-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h4 className="text-sm font-bold text-gray-900">
                访谈问题清单（{detail.questions.length} 问 · 技术 {detail.questions.filter(q => q.category === 'TECH').length}）
              </h4>
              <span className="text-xs text-gray-400">已分析 {verifiedCount}/{detail.questions.length} · 上传一次访谈纪要自动校验</span>
            </div>
            <div className="space-y-2.5">
              {detail.questions.map(q => (
                <QuestionCard key={q.id} question={q} />
              ))}
            </div>
          </div>
        )}

        {/* 综合结论 */}
        {detail.questions.length > 0 && (
          <div className="bg-white rounded-2xl border border-primary-100 shadow-sm p-5">
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
                <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 p-3.5">
                  <p className="text-xs font-bold text-blue-700">总体判断</p>
                  <p className="text-sm text-gray-800 mt-1 leading-relaxed">{conclusion.summary}</p>
                </div>
                {conclusion.dimensions.map((d, i) => (
                  <div key={i} className="flex items-start gap-2.5 rounded-xl border border-gray-100 p-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 mt-0.5 ${MATCH_STYLES[d.gapLevel]?.cls || 'bg-gray-100'}`}>
                      {MATCH_STYLES[d.gapLevel]?.label || d.gapLevel}
                    </span>
                    <div>
                      <p className="text-xs font-bold text-gray-800">{d.aspect}</p>
                      <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{d.conclusion}</p>
                    </div>
                  </div>
                ))}
                {conclusion.advice && (
                  <p className="text-xs text-gray-500 px-1">💡 建议：{conclusion.advice}</p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs text-gray-400">
                上传一次访谈纪要后，系统自动校验全部问题并生成综合结论（如：技术壁垒方面差距较大 → 技术壁垒不高）。
              </p>
            )}
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
    <div className={`rounded-xl border p-3.5 ${verified ? 'border-gray-100 bg-slate-50/40' : 'border-gray-200'}`}>
      <div className="flex items-start gap-2.5">
        <span className="text-xs font-black text-gray-300 flex-shrink-0 mt-0.5">{String(question.order).padStart(2, '0')}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${CATEGORY_STYLES[question.category] || 'bg-gray-100'}`}>
              {CATEGORY_LABELS[question.category] || question.category}
            </span>
            <p className="text-sm font-bold text-gray-800 leading-snug">{question.question}</p>
          </div>
          {/* 理想答案（浅色字体） */}
          <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
            <span className="font-medium">理想答案：</span>
            {question.idealAnswer}
          </p>

          {/* 批量校验结果（上传一次访谈纪要后自动生成） */}
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
              {result.answerSummary && <p className="text-xs text-gray-600 mt-1.5">回答要点：{result.answerSummary}</p>}
              <p className="text-xs text-gray-700 mt-1">差距分析：{result.gapAnalysis}</p>
              <p className="text-xs font-bold text-gray-800 mt-1">结论：{result.conclusion}</p>
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
