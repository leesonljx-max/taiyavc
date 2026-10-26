'use client'

/**
 * 投后管理 · 项目详情页
 * - 投后总览：上传季度资料（经营报告/财务报表/BP）→ AI 经营分析（财务/同比环比/异常/现金流/业务/风险）→ 指标 Dashboard
 * - 文档管理：历史季度资料矩阵（行=年份，列=Q1-Q4 + 全年/半年）
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/DashboardLayout'
import { SkillPanelLauncher } from '@/components/SkillPanel'
import DocumentPreviewModal from '@/components/DocumentPreviewModal'
import RichText from '@/components/RichText'

// ── 类型（与 API 对齐） ──

interface PIDoc {
  id: string
  docType: 'OPERATION_REPORT' | 'FINANCIAL_STATEMENT' | 'BP' | 'OTHER'
  period: string
  fileName: string
  fileUrl: string
  fileType: string
  fileSize: number
  hasText: boolean
  uploadedBy: string
  uploadedAt: string
}

interface MetricWithChange {
  metricKey: string
  metricName: string
  category: string
  unit: string
  value: number
  yoy: { period: string; diff: number; pct: number | null } | null
  qoq: { period: string; diff: number; pct: number | null } | null
  sourceText: string | null
}

interface AnalysisResult {
  executive_summary: string
  financial_analysis: Array<{ metricName: string; value: string; yoy: string; qoq: string; status: string }>
  anomalies: Array<{ level: 'high' | 'medium' | 'positive'; title: string; detail: string; evidence: string }>
  cashflow_analysis: { cash_balance: string; runway_months: number | null; assessment: string }
  business_progress: Array<{ area: string; rating: number; detail: string }>
  risk_alerts: Array<{ type: string; level: 'high' | 'medium' | 'low'; description: string; evidence: string }>
  skill_modules?: Array<{ skill_name: string; title: string; content: string }>
}

interface InvestmentInfo {
  fund: string | null
  amount: number | null
  date: string | null
  confirmed: boolean
}

interface DetailData {
  project: {
    id: string
    name: string
    companyFullName: string | null
    industry: string | null
    totalAmount: string
    followStage: string
  }
  canEdit: boolean
  investment: InvestmentInfo
  funds: string[]
  periods: string[]
  docs: PIDoc[]
  metricsByPeriod: Record<string, MetricWithChange[]>
  analyses: Array<{ period: string; result: AnalysisResult | null; createdAt: string }>
}

const DOC_TYPE_META: Record<string, { label: string; badge: string }> = {
  OPERATION_REPORT: { label: '📊 经营报告', badge: 'bg-primary-50 text-primary-700' },
  FINANCIAL_STATEMENT: { label: '📑 财务报表', badge: 'bg-emerald-50 text-emerald-700' },
  BP: { label: '📘 BP', badge: 'bg-amber-50 text-amber-700' },
  OTHER: { label: '📎 其他', badge: 'bg-gray-100 text-ink-muted' },
}

const ANOMALY_STYLES: Record<string, { label: string; cls: string }> = {
  high: { label: '🔴 高风险', cls: 'border-red-200 bg-red-50/50' },
  medium: { label: '🟠 重点关注', cls: 'border-amber-200 bg-amber-50/50' },
  positive: { label: '🟢 正向变化', cls: 'border-emerald-200 bg-emerald-50/50' },
}

const RISK_STYLES: Record<string, string> = {
  high: 'bg-red-50 text-red-600 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

/** 报告期下拉选项：近 12 个季度 + 当前年 H1/FY（支持补传更早的以往季度） */
function periodOptions(): string[] {
  const now = new Date()
  const year = now.getFullYear()
  const quarter = Math.floor(now.getMonth() / 3) + 1
  const opts: string[] = []
  let y = year
  let q = quarter
  for (let i = 0; i < 12; i++) {
    opts.push(`${y}Q${q}`)
    q--
    if (q === 0) { q = 4; y-- }
  }
  opts.push(`${year}H1`, `${year}FY`)
  return opts
}

function fmtPct(pct: number | null): string {
  if (pct === null) return '-'
  const v = pct * 100
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

function fmtSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/** 投资日期 YYYY-MM → 「2024年12月」 */
function fmtInvestDate(ym: string | null): string {
  if (!ym) return '—'
  const m = ym.match(/^(\d{4})-(\d{2})$/)
  return m ? `${m[1]}年${m[2]}月` : ym
}

/** 下拉中的「新增基金」特殊值 */
const NEW_FUND = '__NEW_FUND__'

export default function PostInvestmentDetailPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const { status } = useSession()

  const [data, setData] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState<'overview' | 'docs'>('overview')

  // 上传状态
  const [uploadPeriod, setUploadPeriod] = useState(periodOptions()[0])
  const [uploadType, setUploadType] = useState('OPERATION_REPORT')
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 期次选择与分析
  const [activePeriod, setActivePeriod] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeMsg, setAnalyzeMsg] = useState('')
  const [analyzeErr, setAnalyzeErr] = useState('')

  const [previewDoc, setPreviewDoc] = useState<{ fileName: string; fileUrl: string; fileType: string; textContent?: string; previewHtml?: string } | null>(null)

  // 手动填写投后资料
  const [manualOpen, setManualOpen] = useState(false)
  const [manualText, setManualText] = useState('')
  const [manualSaving, setManualSaving] = useState(false)

  // 投资信息录入（基金 / 金额 / 日期，确认后锁定）
  const [invFund, setInvFund] = useState('')
  const [invCustomMode, setInvCustomMode] = useState(false)
  const [invCustomName, setInvCustomName] = useState('')
  const [invAmount, setInvAmount] = useState('')
  const [invDate, setInvDate] = useState('')
  const [savingInv, setSavingInv] = useState(false)
  const [invErr, setInvErr] = useState('')

  /** 确认投资信息（锁定不可更改） */
  const confirmInvestment = async () => {
    if (savingInv) return
    const fund = invCustomMode ? invCustomName.trim() : invFund.trim()
    if (!fund) { setInvErr('请选择或填写投资基金'); return }
    if (!invAmount || !Number.isFinite(Number(invAmount)) || Number(invAmount) <= 0) { setInvErr('请填写投资金额（正数，单位：万元）'); return }
    if (!/^\d{4}-\d{2}$/.test(invDate)) { setInvErr('请选择投资日期（年月）'); return }
    if (!window.confirm('确认后投资信息将锁定、不可更改。确定保存？')) return
    setSavingInv(true)
    setInvErr('')
    try {
      const res = await fetch(`/api/post-investment/${params.projectId}/investment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fund, amount: Number(invAmount), date: invDate }),
      })
      const json = await res.json()
      if (!res.ok) { setInvErr(json.error || '保存失败'); return }
      await load()
    } catch { setInvErr('网络错误') } finally { setSavingInv(false) }
  }

  /** 打开文档预览：调用预览 API（docx/xlsx→HTML、pptx→文本、pdf/txt→文件地址） */
  const openPreviewDoc = async (d: PIDoc) => {
    // 兼容历史记录的 fileUrl（旧格式无 /api/uploads 前缀，生产环境不可直达）
    const fileUrl = d.fileUrl.startsWith('/api/uploads/') || d.fileUrl.startsWith('http') ? d.fileUrl : `/api/uploads${d.fileUrl}`
    let textContent: string | undefined
    let previewHtml: string | undefined
    try {
      const r = await fetch(`/api/post-investment/documents/preview?docId=${d.id}`)
      if (r.ok) {
        const j = await r.json()
        if (j.kind === 'html' && j.html) previewHtml = j.html
        else if (j.kind === 'text' && j.text) textContent = j.text
        else if (j.kind === 'file' && j.url) { setPreviewDoc({ fileName: d.fileName, fileUrl: j.url, fileType: d.fileType }); return }
      }
    } catch { /* 加载失败不阻塞预览 */ }
    setPreviewDoc({ fileName: d.fileName, fileUrl, fileType: d.fileType, textContent, previewHtml })
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/post-investment/${params.projectId}`)
      const json = await res.json()
      if (!res.ok) { setError(json.error || '加载失败'); return }
      setData(json)
      setActivePeriod(prev => {
        if (prev && json.periods?.includes(prev)) return prev
        return json.periods?.[0] || `${new Date().getFullYear()}Q${Math.floor(new Date().getMonth() / 3) + 1}`
      })
    } catch { setError('网络错误') } finally { setLoading(false) }
  }, [params.projectId])

  useEffect(() => {
    if (status !== 'authenticated') return
    load()
  }, [status, load])

  const uploadFile = async (file: File) => {
    if (uploading) return
    setUploading(true)
    setUploadErr('')
    try {
      const fd = new FormData()
      fd.append('projectId', params.projectId)
      fd.append('period', uploadPeriod)
      fd.append('docType', uploadType)
      fd.append('file', file)
      const res = await fetch('/api/post-investment/documents', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) { setUploadErr(json.error || '上传失败'); return }
      if (json.doc && !json.doc.hasText) {
        setUploadErr(`「${json.doc.fileName}」上传成功，但未能提取文本（扫描件暂不支持 AI 分析），AI 分析可能无法使用该文件`)
      }
      await load()
    } catch { setUploadErr('上传失败') } finally { setUploading(false) }
  }

  // 手动填写投后资料：文本直接保存为一份 txt 资料
  const submitManual = async () => {
    if (manualSaving) return
    const content = manualText.trim()
    if (!content) { setUploadErr('请填写投后信息'); return }
    setManualSaving(true)
    setUploadErr('')
    try {
      const fd = new FormData()
      fd.append('projectId', params.projectId)
      fd.append('period', uploadPeriod)
      fd.append('docType', uploadType)
      fd.append('text', content)
      const res = await fetch('/api/post-investment/documents', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) { setUploadErr(json.error || '保存失败'); return }
      setManualOpen(false)
      setManualText('')
      await load()
    } catch { setUploadErr('保存失败，请检查网络') } finally { setManualSaving(false) }
  }

  const deleteDoc = async (docId: string) => {
    if (!window.confirm('删除该文档？')) return
    try {
      const res = await fetch(`/api/post-investment/documents?docId=${docId}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) { setUploadErr(json.error || '删除失败'); return }
      await load()
    } catch { setUploadErr('网络错误') }
  }

  const runAnalyze = async () => {
    if (analyzing || !activePeriod) return
    setAnalyzing(true)
    setAnalyzeMsg('AI 正在提取指标并分析经营情况（约 1-2 分钟）...')
    setAnalyzeErr('')
    try {
      const res = await fetch(`/api/post-investment/${params.projectId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: activePeriod }),
      })
      const json = await res.json()
      if (!res.ok) { setAnalyzeMsg(''); setAnalyzeErr(json.error || '分析失败'); return }
      setAnalyzeMsg(`分析完成：提取 ${json.metricCount} 项指标`)
      await load()
    } catch {
      setAnalyzeMsg('')
      setAnalyzeErr('网络错误（AI 分析耗时较长，请稍后重试）')
    } finally {
      setAnalyzing(false)
    }
  }

  if (status === 'loading' || loading) {
    return (
      <DashboardLayout title="投后管理" subtitle="加载中...">
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  if (error || !data) {
    return (
      <DashboardLayout title="投后管理">
        <div className="py-20 text-center">
          <p className="text-danger-600 mb-4">{error || '项目不存在'}</p>
          <button onClick={() => router.push('/post-investment')} className="btn-primary">返回投后列表</button>
        </div>
      </DashboardLayout>
    )
  }

  const canEdit = data.canEdit
  const docsOfPeriod = data.docs.filter(d => d.period === activePeriod)
  const analysisOfActive = data.analyses.find(a => a.period === activePeriod)?.result || null
  const metricsOfActive = data.metricsByPeriod[activePeriod] || []
  const analysis = analysisOfActive

  // 文档管理矩阵：行=年份（降序），列=Q1-Q4 + 全年/半年
  const docYears = Array.from(new Set(data.docs.map(d => d.period.slice(0, 4)))).sort((a, b) => Number(b) - Number(a))

  return (
    <DashboardLayout
      title={`投后管理 - ${data.project.name}`}
      subtitle={data.project.companyFullName || data.project.industry || ''}
      actions={
        <div className="flex gap-2">
          <SkillPanelLauncher scene="post-investment" />
          <button onClick={() => router.push(`/projects/${params.projectId}`)} className="btn-secondary">项目详情</button>
          <button onClick={() => router.back()} className="btn-secondary">← 返回</button>
        </div>
      }
    >
      {/* ── 视图切换 ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <div className="flex items-center bg-surface border border-hairline rounded-full p-0.5 gap-0.5">
          {([
            { key: 'overview' as const, label: '📊 投后总览' },
            { key: 'docs' as const, label: '🗂 文档管理' },
          ]).map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${view === v.key ? 'bg-primary-600 text-white' : 'text-ink-muted hover:text-ink'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'overview' ? (
        <div className="space-y-4">
          {/* ── 投资信息窄条卡片（确认后锁定不可更改） ── */}
          <div className="bg-surface rounded-2xl shadow-soft px-5 py-3">
            {data.investment.confirmed ? (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="eyebrow flex-shrink-0">💳 投资信息</span>
                <span className="pill bg-primary-50 text-primary-700">{data.investment.fund}</span>
                <span className="text-sm font-bold text-primary-600">{data.investment.amount?.toLocaleString()} <span className="text-xs font-normal text-ink-faint">万元</span></span>
                <span className="text-sm text-ink">{fmtInvestDate(data.investment.date)}</span>
                <span className="text-[10px] text-ink-faint">🔒 已确认，不可更改</span>
              </div>
            ) : canEdit ? (
              <div className="space-y-2">
                <div className="flex items-end gap-3 flex-wrap">
                  <span className="text-xs font-bold text-ink-muted flex-shrink-0 pb-2">💳 投资信息</span>
                  <div>
                    <label className="block text-[10px] font-bold text-ink-faint mb-1">投资基金</label>
                    {invCustomMode ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          value={invCustomName}
                          onChange={e => { setInvCustomName(e.target.value); setInvErr('') }}
                          placeholder="输入新基金名称"
                          maxLength={30}
                          className="px-3 py-1.5 text-sm rounded-xl border border-hairline bg-surface text-ink focus:outline-none focus:border-primary-300 w-40"
                        />
                        <button onClick={() => { setInvCustomMode(false); setInvCustomName('') }} className="text-[11px] text-ink-faint hover:text-ink-muted px-1">改选</button>
                      </div>
                    ) : (
                      <select
                        value={invFund}
                        onChange={e => {
                          if (e.target.value === NEW_FUND) { setInvCustomMode(true); setInvErr('') }
                          else { setInvFund(e.target.value); setInvErr('') }
                        }}
                        className="px-3 py-1.5 text-sm rounded-xl border border-hairline bg-surface text-ink focus:outline-none focus:border-primary-300"
                      >
                        <option value="">选择基金</option>
                        {data.funds.map(f => <option key={f} value={f}>{f}</option>)}
                        <option value={NEW_FUND}>＋ 新增基金</option>
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-ink-faint mb-1">投资金额（万元）</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={invAmount}
                      onChange={e => { setInvAmount(e.target.value); setInvErr('') }}
                      placeholder="如 2500"
                      className="px-3 py-1.5 text-sm rounded-xl border border-hairline bg-surface text-ink focus:outline-none focus:border-primary-300 w-32"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-ink-faint mb-1">投资日期（年月）</label>
                    <input
                      type="month"
                      value={invDate}
                      onChange={e => { setInvDate(e.target.value); setInvErr('') }}
                      className="px-3 py-1.5 text-sm rounded-xl border border-hairline bg-surface text-ink focus:outline-none focus:border-primary-300"
                    />
                  </div>
                  <button
                    onClick={confirmInvestment}
                    disabled={savingInv}
                    className="btn-primary"
                  >
                    {savingInv ? '保存中...' : '确认（锁定）'}
                  </button>
                </div>
                {invErr && <p className="text-[11px] text-danger-600">{invErr}</p>}
              </div>
            ) : (
              <p className="text-xs text-ink-faint">💳 投资信息未填写（由项目维护人录入）</p>
            )}
          </div>

          {/* ── 上传区 ── */}
          {canEdit && (
            <div className="bg-surface rounded-2xl shadow-soft p-5">
              <h3 className="text-sm font-bold text-ink mb-3">📤 上传投后资料</h3>
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="block text-[11px] font-bold text-ink-muted mb-1">报告期</label>
                  <select value={uploadPeriod} onChange={e => setUploadPeriod(e.target.value)} className="px-3 py-2 text-sm rounded-xl border border-hairline bg-surface text-ink focus:outline-none focus:border-primary-300">
                    {periodOptions().map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-ink-muted mb-1">文档类型</label>
                  <select value={uploadType} onChange={e => setUploadType(e.target.value)} className="px-3 py-2 text-sm rounded-xl border border-hairline bg-surface text-ink focus:outline-none focus:border-primary-300">
                    <option value="OPERATION_REPORT">经营报告</option>
                    <option value="FINANCIAL_STATEMENT">财务报表</option>
                    <option value="BP">BP</option>
                    <option value="OTHER">其他</option>
                  </select>
                </div>
                <label className={`btn-primary cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  {uploading ? '上传中...' : '+ 选择文件上传'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.xlsx,.pptx,.txt,.md"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) uploadFile(f)
                    }}
                  />
                </label>
                <button
                  onClick={() => { setManualOpen(true); setManualText(''); setUploadErr('') }}
                  disabled={uploading}
                  className="btn-secondary"
                >
                  ✍️ 手动填写
                </button>
                <span className="text-[11px] text-ink-faint">支持 PDF / Word / Excel（不限大小）/ PPT / txt；也可手动填写投后信息。上传后可在线阅览，经营报告或财务报表任一项即可触发 AI 分析</span>
              </div>
              {uploadErr && <p className="mt-2.5 text-xs text-danger-600 bg-danger-50 rounded-xl px-3 py-2">{uploadErr}</p>}
            </div>
          )}

          {/* ── 期次选择 + 分析按钮 ── */}
          <div className="bg-surface rounded-2xl shadow-soft p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-bold text-ink mr-1">报告期：</span>
                {(data.periods.length > 0 ? data.periods : [activePeriod]).map(p => (
                  <button
                    key={p}
                    onClick={() => { setActivePeriod(p); setAnalyzeMsg(''); setAnalyzeErr('') }}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${activePeriod === p ? 'bg-primary-600 text-white' : 'bg-gray-50 text-ink-muted hover:bg-gray-100'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {canEdit && (
                <button
                  onClick={runAnalyze}
                  disabled={analyzing || docsOfPeriod.length === 0}
                  className={`px-4 py-2 text-sm font-bold rounded-full transition-all ${
                    docsOfPeriod.length > 0 && !analyzing
                      ? 'btn-primary'
                      : 'bg-gray-100 text-ink-faint cursor-not-allowed'
                  }`}
                  title={docsOfPeriod.length === 0 ? '该期尚未上传资料' : '提取指标 + 程序计算同比环比 + 合并全部历史期资料做 AI 趋势分析（当季/以往季均可分析）'}
                >
                  {analyzing ? '⏳ AI 分析中...' : analysis ? '🔄 重新分析' : '🔍 AI 分析本期'}
                </button>
              )}
            </div>
            {analyzeMsg && <div className="p-2.5 rounded-xl text-xs bg-primary-50 text-primary-700 mb-2">{analyzeMsg}</div>}
            {analyzeErr && <div className="p-2.5 rounded-xl text-xs bg-red-50 text-red-600 mb-2">{analyzeErr}</div>}
            {docsOfPeriod.length === 0 ? (
              <p className="text-xs text-ink-faint py-2 text-center">「{activePeriod}」尚未上传资料{canEdit ? '，请在上方选择该报告期后上传' : ''}</p>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                {docsOfPeriod.map(d => (
                  <button
                    key={d.id}
                    onClick={() => openPreviewDoc(d)}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 rounded-full text-xs hover:bg-gray-100 transition-colors"
                  >
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${DOC_TYPE_META[d.docType]?.badge || ''}`}>{DOC_TYPE_META[d.docType]?.label || d.docType}</span>
                    <span className="text-ink truncate max-w-[200px]">{d.fileName}</span>
                    <span className="text-ink-faint">{fmtSize(d.fileSize)}</span>
                    {canEdit && (
                      <span
                        onClick={e => { e.stopPropagation(); deleteDoc(d.id) }}
                        className="text-ink-faint hover:text-danger-600 px-1"
                      >✕</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── 指标 Dashboard ── */}
          {metricsOfActive.length > 0 && (
            <div className="bg-surface rounded-2xl shadow-soft p-5">
              <h3 className="text-sm font-bold text-ink mb-3">📊 核心指标 · {activePeriod}<span className="text-[10px] font-normal text-ink-faint ml-2">同比/环比由程序计算（半年报不与单季度环比）</span></h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-ink-muted text-[10px] border-b border-hairline">
                      <th className="text-left font-bold px-2 py-2">指标</th>
                      <th className="text-right font-bold px-2 py-2">本期</th>
                      <th className="text-right font-bold px-2 py-2">同比</th>
                      <th className="text-right font-bold px-2 py-2">环比</th>
                      <th className="text-left font-bold px-2 py-2">来源（证据溯源）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricsOfActive.map(m => (
                      <tr key={m.metricKey} className="border-b border-hairline hover:bg-gray-50">
                        <td className="px-2 py-2 font-bold text-ink">{m.metricName}</td>
                        <td className="px-2 py-2 text-right font-bold text-ink">{m.value.toLocaleString()} <span className="text-ink-faint font-normal">{m.unit}</span></td>
                        <td className={`px-2 py-2 text-right font-bold ${m.yoy?.pct === null || !m.yoy ? 'text-ink-faint' : m.yoy.pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {m.yoy ? fmtPct(m.yoy.pct) : '-'}
                        </td>
                        <td className={`px-2 py-2 text-right font-bold ${m.qoq?.pct === null || !m.qoq ? 'text-ink-faint' : m.qoq.pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {m.qoq ? fmtPct(m.qoq.pct) : '-'}
                        </td>
                        <td className="px-2 py-2 text-ink-faint text-[10px] max-w-[320px] truncate" title={m.sourceText || ''}>{m.sourceText || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── AI 分析报告 ── */}
          {analysis && (
            <div className="bg-surface rounded-2xl shadow-soft p-5 space-y-4">
              <h3 className="text-sm font-bold text-ink">🤖 AI 投后经营分析 · {activePeriod}</h3>

              {/* 核心结论 */}
              <div className="p-3.5 rounded-xl bg-primary-50">
                <p className="text-[11px] font-bold text-primary-700 mb-1.5">一、核心结论</p>
                <RichText
                  text={analysis.executive_summary}
                  className="text-xs text-ink-muted space-y-0.5"
                  strongClassName="font-bold text-ink"
                  placeholder="—"
                />
              </div>

              {/* 异常指标 */}
              {analysis.anomalies.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-ink-muted mb-2">二、异常指标</p>
                  <div className="space-y-2">
                    {analysis.anomalies.map((a, i) => (
                      <div key={i} className={`px-3 py-2.5 rounded-xl border ${ANOMALY_STYLES[a.level]?.cls || 'border-hairline'}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-bold">{ANOMALY_STYLES[a.level]?.label || a.level}</span>
                          <span className="text-xs font-bold text-ink">{a.title}</span>
                        </div>
                        <RichText text={a.detail} className="mt-1 text-xs text-ink-muted space-y-0.5" lineClassName="leading-relaxed" placeholder="—" />
                        <p className="mt-1 text-[10px] text-ink-faint">证据：{a.evidence}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 现金流健康 */}
              <div className="p-3.5 rounded-xl bg-gray-50">
                <p className="text-[11px] font-bold text-ink-muted mb-1.5">三、资金流健康评估</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                  <div className="px-2.5 py-2 bg-surface rounded-xl">
                    <p className="text-[10px] text-ink-faint">现金余额</p>
                    <p className="text-xs font-bold text-ink">{analysis.cashflow_analysis.cash_balance}</p>
                  </div>
                  <div className="px-2.5 py-2 bg-surface rounded-xl">
                    <p className="text-[10px] text-ink-faint">现金覆盖月数</p>
                    <p className="text-xs font-bold text-ink">{analysis.cashflow_analysis.runway_months !== null ? `${analysis.cashflow_analysis.runway_months} 个月` : '—'}</p>
                  </div>
                  <div className="px-2.5 py-2 bg-surface rounded-xl">
                    <p className="text-[10px] text-ink-faint">健康评估</p>
                    <RichText
                      text={analysis.cashflow_analysis.assessment}
                      className="text-xs font-bold text-ink"
                      lineClassName="leading-snug"
                      placeholder="—"
                    />
                  </div>
                </div>
              </div>

              {/* 业务进展 */}
              {analysis.business_progress.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-ink-muted mb-2">四、业务进展</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {analysis.business_progress.map((b, i) => (
                      <div key={i} className="px-3 py-2.5 bg-gray-50 rounded-xl">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-ink">{b.area}</span>
                          <span className="text-[10px] text-amber-500">{'★'.repeat(Math.max(1, Math.min(5, b.rating)))}</span>
                        </div>
                        <RichText text={b.detail} className="mt-1 text-xs text-ink-muted space-y-0.5" lineClassName="leading-relaxed" placeholder="—" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 风险提示 */}
              {analysis.risk_alerts.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-ink-muted mb-2">五、风险提示</p>
                  <div className="space-y-2">
                    {analysis.risk_alerts.map((r, i) => (
                      <div key={i} className="px-3 py-2.5 rounded-xl bg-gray-50">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${RISK_STYLES[r.level] || RISK_STYLES.low}`}>
                            {r.level === 'high' ? '高' : r.level === 'medium' ? '中' : '低'}
                          </span>
                          <span className="pill bg-gray-100 text-ink-muted">{r.type}</span>
                        </div>
                        <RichText text={r.description} className="mt-1 text-xs text-ink-muted space-y-0.5" lineClassName="leading-relaxed" placeholder="—" />
                        <p className="mt-1 text-[10px] text-ink-faint">证据：{r.evidence}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 技能视角分析（挂载技能超出固定分析框架时单列；相似技能已融入上述各维度） */}
              {analysis.skill_modules?.length ? (
                <div>
                  <p className="text-[11px] font-bold text-primary-700 mb-2">⚡ 六、你的技能 · 独立分析模块</p>
                  <div className="space-y-2">
                    {analysis.skill_modules.map((m, i) => (
                      <div key={i} className="px-3 py-2.5 rounded-xl bg-primary-50">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="pill bg-primary-100 text-primary-700">⚡ {m.skill_name}</span>
                          {m.title && <span className="text-[11px] font-bold text-primary-800">{m.title}</span>}
                        </div>
                        <RichText
                          text={m.content}
                          className="mt-1 text-xs text-ink-muted space-y-0.5"
                          lineClassName="leading-relaxed"
                          strongClassName="font-bold text-primary-800"
                          placeholder="—"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* 未分析提示 */}
          {!analysis && metricsOfActive.length === 0 && docsOfPeriod.length > 0 && (
            <div className="bg-surface rounded-2xl shadow-soft p-8 text-center">
              <p className="text-sm text-ink-muted">已上传 {docsOfPeriod.length} 份资料，点击上方「🔍 AI 分析本期」生成经营分析</p>
            </div>
          )}
        </div>
      ) : (
        /* ── 文档管理矩阵（行=年份，列=Q1-Q4 + 全年/半年） ── */
        <div className="bg-surface rounded-2xl shadow-soft p-5">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
            <h3 className="text-sm font-bold text-ink">🗂 文档管理 · 历史季度资料</h3>
            <span className="text-xs text-ink-faint">每年一行 · 四个季度为列 · 全年/半年报告在末列</span>
          </div>

          {docYears.length === 0 ? (
            <p className="text-xs text-ink-faint py-8 text-center">尚未上传任何投后资料</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-ink-muted text-[10px]">
                    <th className="font-bold px-2 py-2 text-left border-b border-hairline w-14">年份</th>
                    {[1, 2, 3, 4].map(q => (
                      <th key={q} className="font-bold px-2 py-2 text-center border-b border-hairline">Q{q}</th>
                    ))}
                    <th className="font-bold px-2 py-2 text-center border-b border-hairline">全年 / 半年</th>
                  </tr>
                </thead>
                <tbody>
                  {docYears.map(year => {
                    const qDocs = (n: number) => data.docs.filter(d => d.period === `${year}Q${n}`)
                    const annualDocs = data.docs.filter(d => d.period === `${year}H1` || d.period === `${year}H2` || d.period === `${year}FY`)
                    return (
                      <tr key={year} className="align-top hover:bg-gray-50">
                        <td className="px-2 py-2.5 border-b border-hairline font-bold text-ink">{year}</td>
                        {[1, 2, 3, 4].map(n => {
                          const docs = qDocs(n)
                          return (
                            <td key={n} className="px-1.5 py-2.5 border-b border-hairline border-l border-hairline min-w-[140px]">
                              {docs.length === 0 ? (
                                <span className="text-ink-faint text-[10px]">—</span>
                              ) : (
                                <div className="space-y-1">
                                  {docs.map(d => (
                                    <DocChip key={d.id} doc={d} canEdit={canEdit} onPreview={() => openPreviewDoc(d)} onDelete={() => deleteDoc(d.id)} />
                                  ))}
                                </div>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-1.5 py-2.5 border-b border-l border-hairline min-w-[140px]">
                          {annualDocs.length === 0 ? (
                            <span className="text-ink-faint text-[10px]">—</span>
                          ) : (
                            <div className="space-y-1">
                              {annualDocs.map(d => (
                                <DocChip key={d.id} doc={d} canEdit={canEdit} label={d.period} onPreview={() => openPreviewDoc(d)} onDelete={() => deleteDoc(d.id)} />
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 手动填写投后资料弹窗 */}
      {manualOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
          onClick={() => { if (!manualSaving) setManualOpen(false) }}
        >
          <div className="w-full max-w-2xl bg-surface rounded-2xl shadow-soft-lg p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-ink">手动填写投后资料</h3>
                <p className="text-xs text-ink-faint mt-1">
                  报告期 {uploadPeriod} · 类型 {DOC_TYPE_META[uploadType]?.label || uploadType} · 保存后可参与 AI 分析
                </p>
              </div>
              <button
                onClick={() => { if (!manualSaving) setManualOpen(false) }}
                className="text-ink-faint hover:text-ink text-lg leading-none"
                title="关闭"
              >
                ✕
              </button>
            </div>
            <textarea
              value={manualText}
              onChange={e => setManualText(e.target.value)}
              rows={12}
              autoFocus
              placeholder="请输入投后信息，例如：本季度营收与同比、订单/客户进展、团队变化、融资进展、下季度计划等……"
              className="w-full px-4 py-3 text-sm rounded-xl border border-hairline bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-primary-300 resize-y"
            />
            <div className="flex items-center justify-between gap-3 mt-4">
              <span className="text-[11px] text-ink-faint">{manualText.trim().length} 字</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { if (!manualSaving) setManualOpen(false) }}
                  disabled={manualSaving}
                  className="btn-secondary disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={submitManual}
                  disabled={manualSaving || !manualText.trim()}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {manualSaving ? '保存中...' : '保存资料'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewDoc && (
        <DocumentPreviewModal
          open={!!previewDoc}
          onClose={() => setPreviewDoc(null)}
          fileName={previewDoc.fileName}
          fileUrl={previewDoc.fileUrl}
          fileType={previewDoc.fileType}
          textContent={previewDoc.textContent}
          previewHtml={previewDoc.previewHtml}
        />
      )}
    </DashboardLayout>
  )
}

/** 矩阵单元格文档芯片 */
function DocChip({ doc, canEdit, label, onPreview, onDelete }: { doc: PIDoc; canEdit: boolean; label?: string; onPreview: () => void; onDelete: () => void }) {
  return (
    <div className="group flex items-center gap-1 px-1.5 py-1 bg-surface border border-hairline rounded-full hover:bg-gray-50 transition-colors">
      {label && <span className="px-1 py-0.5 bg-primary-50 text-primary-600 rounded-full text-[9px] font-bold flex-shrink-0">{label}</span>}
      <span className={`px-1 py-0.5 rounded-full text-[9px] font-bold flex-shrink-0 ${DOC_TYPE_META[doc.docType]?.badge || ''}`} title={DOC_TYPE_META[doc.docType]?.label}>
        {DOC_TYPE_META[doc.docType]?.label?.slice(0, 2) || '📎'}
      </span>
      <button onClick={onPreview} className="flex-1 text-left text-ink truncate text-[10px] hover:text-primary-600" title={doc.fileName}>
        {doc.fileName}
      </button>
      {canEdit && (
        <button onClick={onDelete} className="text-ink-faint hover:text-danger-600 text-[10px] px-0.5 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
      )}
    </div>
  )
}
