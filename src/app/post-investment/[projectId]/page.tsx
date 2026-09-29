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
import DocumentPreviewModal from '@/components/DocumentPreviewModal'

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
  periods: string[]
  docs: PIDoc[]
  metricsByPeriod: Record<string, MetricWithChange[]>
  analyses: Array<{ period: string; result: AnalysisResult | null; createdAt: string }>
}

const DOC_TYPE_META: Record<string, { label: string; badge: string }> = {
  OPERATION_REPORT: { label: '📊 经营报告', badge: 'bg-blue-50 text-blue-600' },
  FINANCIAL_STATEMENT: { label: '📑 财务报表', badge: 'bg-teal-50 text-teal-600' },
  BP: { label: '📘 BP', badge: 'bg-purple-50 text-purple-600' },
  OTHER: { label: '📎 其他', badge: 'bg-gray-100 text-gray-500' },
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

/** 报告期下拉选项：近 8 个季度 + 当前年 H1/FY */
function periodOptions(): string[] {
  const now = new Date()
  const year = now.getFullYear()
  const quarter = Math.floor(now.getMonth() / 3) + 1
  const opts: string[] = []
  let y = year
  let q = quarter
  for (let i = 0; i < 8; i++) {
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

  const [previewDoc, setPreviewDoc] = useState<{ fileName: string; fileUrl: string; fileType: string; textContent?: string } | null>(null)

  /** 打开文档预览：异步加载提取全文（本地环境 Office 文档的文本阅览回退） */
  const openPreviewDoc = async (d: PIDoc) => {
    let textContent: string | undefined
    try {
      const r = await fetch(`/api/post-investment/documents/content?docId=${d.id}`)
      if (r.ok) {
        const j = await r.json()
        if (j.text) textContent = j.text
      }
    } catch { /* 加载失败不阻塞预览 */ }
    setPreviewDoc({ fileName: d.fileName, fileUrl: d.fileUrl, fileType: d.fileType, textContent })
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
          <button onClick={() => router.push('/post-investment')} className="px-4 py-2 bg-primary-500 text-white rounded-lg">返回投后列表</button>
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
          <button onClick={() => router.push(`/projects/${params.projectId}`)} className="px-3 py-1.5 bg-white border border-primary-200 text-primary-700 text-sm rounded-lg hover:bg-primary-50 font-medium">项目详情</button>
          <button onClick={() => router.back()} className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">← 返回</button>
        </div>
      }
    >
      {/* ── 视图切换 ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <div className="flex items-center bg-white border border-gray-200 rounded-xl p-0.5 gap-0.5">
          {([
            { key: 'overview' as const, label: '📊 投后总览' },
            { key: 'docs' as const, label: '🗂 文档管理' },
          ]).map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${view === v.key ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'overview' ? (
        <div className="space-y-4">
          {/* ── 上传区 ── */}
          {canEdit && (
            <div className="dd-card rounded-2xl shadow-sm border p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">📤 上传投后资料</h3>
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 mb-1">报告期</label>
                  <select value={uploadPeriod} onChange={e => setUploadPeriod(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-200">
                    {periodOptions().map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 mb-1">文档类型</label>
                  <select value={uploadType} onChange={e => setUploadType(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-200">
                    <option value="OPERATION_REPORT">经营报告</option>
                    <option value="FINANCIAL_STATEMENT">财务报表</option>
                    <option value="BP">BP</option>
                    <option value="OTHER">其他</option>
                  </select>
                </div>
                <label className={`px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl shadow-md shadow-blue-500/25 cursor-pointer hover:bg-blue-700 ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  {uploading ? '上传中...' : '+ 选择文件上传'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.xlsx,.txt,.md"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) uploadFile(f)
                    }}
                  />
                </label>
                <span className="text-[11px] text-gray-400">支持 PDF / Word / Excel / txt（≤50MB）；经营报告或财务报表任一项即可触发 AI 分析</span>
              </div>
              {uploadErr && <p className="mt-2.5 text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{uploadErr}</p>}
            </div>
          )}

          {/* ── 期次选择 + 分析按钮 ── */}
          <div className="dd-card rounded-2xl shadow-sm border p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-bold text-gray-800 mr-1">报告期：</span>
                {(data.periods.length > 0 ? data.periods : [activePeriod]).map(p => (
                  <button
                    key={p}
                    onClick={() => { setActivePeriod(p); setAnalyzeMsg(''); setAnalyzeErr('') }}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${activePeriod === p ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-50 text-gray-500 hover:bg-slate-100'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {canEdit && (
                <button
                  onClick={runAnalyze}
                  disabled={analyzing || docsOfPeriod.length === 0}
                  className={`px-4 py-2 text-sm font-bold rounded-xl shadow-md transition-all ${
                    docsOfPeriod.length > 0 && !analyzing
                      ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-500/25'
                      : 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none'
                  }`}
                  title={docsOfPeriod.length === 0 ? '该期尚未上传资料' : '提取指标 + 程序计算同比环比 + 合并全部历史期资料做 AI 趋势分析（当季/以往季均可分析）'}
                >
                  {analyzing ? '⏳ AI 分析中...' : analysis ? '🔄 重新分析' : '🔍 AI 分析本期'}
                </button>
              )}
            </div>
            {analyzeMsg && <div className="p-2.5 rounded-lg text-xs bg-blue-50 text-blue-700 border border-blue-100 mb-2">{analyzeMsg}</div>}
            {analyzeErr && <div className="p-2.5 rounded-lg text-xs bg-red-50 text-red-600 border border-red-100 mb-2">{analyzeErr}</div>}
            {docsOfPeriod.length === 0 ? (
              <p className="text-xs text-gray-400 py-2 text-center">「{activePeriod}」尚未上传资料{canEdit ? '，请在上方选择该报告期后上传' : ''}</p>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                {docsOfPeriod.map(d => (
                  <button
                    key={d.id}
                    onClick={() => openPreviewDoc(d)}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-gray-100 rounded-lg text-xs hover:border-blue-300"
                  >
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${DOC_TYPE_META[d.docType]?.badge || ''}`}>{DOC_TYPE_META[d.docType]?.label || d.docType}</span>
                    <span className="text-gray-700 truncate max-w-[200px]">{d.fileName}</span>
                    <span className="text-gray-400">{fmtSize(d.fileSize)}</span>
                    {canEdit && (
                      <span
                        onClick={e => { e.stopPropagation(); deleteDoc(d.id) }}
                        className="text-gray-300 hover:text-red-500 px-1"
                      >✕</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── 指标 Dashboard ── */}
          {metricsOfActive.length > 0 && (
            <div className="dd-card rounded-2xl shadow-sm border p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">📊 核心指标 · {activePeriod}<span className="text-[10px] font-normal text-gray-400 ml-2">同比/环比由程序计算（半年报不与单季度环比）</span></h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 text-[10px] border-b border-gray-100">
                      <th className="text-left font-bold px-2 py-2">指标</th>
                      <th className="text-right font-bold px-2 py-2">本期</th>
                      <th className="text-right font-bold px-2 py-2">同比</th>
                      <th className="text-right font-bold px-2 py-2">环比</th>
                      <th className="text-left font-bold px-2 py-2">来源（证据溯源）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricsOfActive.map(m => (
                      <tr key={m.metricKey} className="border-b border-gray-50 hover:bg-slate-50/50">
                        <td className="px-2 py-2 font-bold text-gray-700">{m.metricName}</td>
                        <td className="px-2 py-2 text-right font-bold text-gray-900">{m.value.toLocaleString()} <span className="text-gray-400 font-normal">{m.unit}</span></td>
                        <td className={`px-2 py-2 text-right font-bold ${m.yoy?.pct === null || !m.yoy ? 'text-gray-300' : m.yoy.pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {m.yoy ? fmtPct(m.yoy.pct) : '-'}
                        </td>
                        <td className={`px-2 py-2 text-right font-bold ${m.qoq?.pct === null || !m.qoq ? 'text-gray-300' : m.qoq.pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {m.qoq ? fmtPct(m.qoq.pct) : '-'}
                        </td>
                        <td className="px-2 py-2 text-gray-400 text-[10px] max-w-[320px] truncate" title={m.sourceText || ''}>{m.sourceText || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── AI 分析报告 ── */}
          {analysis && (
            <div className="dd-card rounded-2xl shadow-sm border p-5 space-y-4">
              <h3 className="text-sm font-bold text-gray-800">🤖 AI 投后经营分析 · {activePeriod}</h3>

              {/* 核心结论 */}
              <div className="p-3.5 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50/50 border border-blue-100">
                <p className="text-[11px] font-bold text-blue-700 mb-1.5">一、核心结论</p>
                <p className="text-xs text-gray-700 leading-relaxed">{analysis.executive_summary}</p>
              </div>

              {/* 异常指标 */}
              {analysis.anomalies.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-gray-500 mb-2">二、异常指标</p>
                  <div className="space-y-2">
                    {analysis.anomalies.map((a, i) => (
                      <div key={i} className={`px-3 py-2.5 rounded-xl border ${ANOMALY_STYLES[a.level]?.cls || 'border-gray-200'}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-bold">{ANOMALY_STYLES[a.level]?.label || a.level}</span>
                          <span className="text-xs font-bold text-gray-800">{a.title}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-600 leading-relaxed">{a.detail}</p>
                        <p className="mt-1 text-[10px] text-gray-400">证据：{a.evidence}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 现金流健康 */}
              <div className="p-3.5 rounded-xl bg-white border border-gray-100">
                <p className="text-[11px] font-bold text-gray-500 mb-1.5">三、资金流健康评估</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                  <div className="px-2.5 py-2 bg-slate-50 rounded-lg">
                    <p className="text-[10px] text-gray-400">现金余额</p>
                    <p className="text-xs font-bold text-gray-800">{analysis.cashflow_analysis.cash_balance}</p>
                  </div>
                  <div className="px-2.5 py-2 bg-slate-50 rounded-lg">
                    <p className="text-[10px] text-gray-400">现金覆盖月数</p>
                    <p className="text-xs font-bold text-gray-800">{analysis.cashflow_analysis.runway_months !== null ? `${analysis.cashflow_analysis.runway_months} 个月` : '—'}</p>
                  </div>
                  <div className="px-2.5 py-2 bg-slate-50 rounded-lg">
                    <p className="text-[10px] text-gray-400">健康评估</p>
                    <p className="text-xs font-bold text-gray-800 leading-snug">{analysis.cashflow_analysis.assessment}</p>
                  </div>
                </div>
              </div>

              {/* 业务进展 */}
              {analysis.business_progress.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-gray-500 mb-2">四、业务进展</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {analysis.business_progress.map((b, i) => (
                      <div key={i} className="px-3 py-2.5 bg-white border border-gray-100 rounded-xl">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-gray-800">{b.area}</span>
                          <span className="text-[10px] text-amber-400">{'★'.repeat(Math.max(1, Math.min(5, b.rating)))}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-600 leading-relaxed">{b.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 风险提示 */}
              {analysis.risk_alerts.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-gray-500 mb-2">五、风险提示</p>
                  <div className="space-y-2">
                    {analysis.risk_alerts.map((r, i) => (
                      <div key={i} className="px-3 py-2.5 rounded-xl border border-gray-100 bg-white">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${RISK_STYLES[r.level] || RISK_STYLES.low}`}>
                            {r.level === 'high' ? '高' : r.level === 'medium' ? '中' : '低'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-50 text-gray-500 text-[10px] font-bold">{r.type}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-700 leading-relaxed">{r.description}</p>
                        <p className="mt-1 text-[10px] text-gray-400">证据：{r.evidence}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 未分析提示 */}
          {!analysis && metricsOfActive.length === 0 && docsOfPeriod.length > 0 && (
            <div className="dd-card rounded-2xl shadow-sm border p-8 text-center">
              <p className="text-sm text-gray-500">已上传 {docsOfPeriod.length} 份资料，点击上方「🔍 AI 分析本期」生成经营分析</p>
            </div>
          )}
        </div>
      ) : (
        /* ── 文档管理矩阵（行=年份，列=Q1-Q4 + 全年/半年） ── */
        <div className="dd-card rounded-2xl shadow-sm border p-5">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
            <h3 className="text-sm font-bold text-gray-800">🗂 文档管理 · 历史季度资料</h3>
            <span className="text-xs text-gray-400">每年一行 · 四个季度为列 · 全年/半年报告在末列</span>
          </div>

          {docYears.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">尚未上传任何投后资料</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-gray-400 text-[10px]">
                    <th className="font-bold px-2 py-2 text-left border-b border-gray-100 w-14">年份</th>
                    {[1, 2, 3, 4].map(q => (
                      <th key={q} className="font-bold px-2 py-2 text-center border-b border-gray-100">Q{q}</th>
                    ))}
                    <th className="font-bold px-2 py-2 text-center border-b border-gray-100">全年 / 半年</th>
                  </tr>
                </thead>
                <tbody>
                  {docYears.map(year => {
                    const qDocs = (n: number) => data.docs.filter(d => d.period === `${year}Q${n}`)
                    const annualDocs = data.docs.filter(d => d.period === `${year}H1` || d.period === `${year}H2` || d.period === `${year}FY`)
                    return (
                      <tr key={year} className="align-top hover:bg-slate-50/40">
                        <td className="px-2 py-2.5 border-b border-gray-50 font-black text-gray-700">{year}</td>
                        {[1, 2, 3, 4].map(n => {
                          const docs = qDocs(n)
                          return (
                            <td key={n} className="px-1.5 py-2.5 border-b border-gray-50 border-l border-gray-50 min-w-[140px]">
                              {docs.length === 0 ? (
                                <span className="text-gray-200 text-[10px]">—</span>
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
                        <td className="px-1.5 py-2.5 border-b border-l border-gray-50 min-w-[140px]">
                          {annualDocs.length === 0 ? (
                            <span className="text-gray-200 text-[10px]">—</span>
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

      {previewDoc && (
        <DocumentPreviewModal open={!!previewDoc} onClose={() => setPreviewDoc(null)} fileName={previewDoc.fileName} fileUrl={previewDoc.fileUrl} fileType={previewDoc.fileType} />
      )}
    </DashboardLayout>
  )
}

/** 矩阵单元格文档芯片 */
function DocChip({ doc, canEdit, label, onPreview, onDelete }: { doc: PIDoc; canEdit: boolean; label?: string; onPreview: () => void; onDelete: () => void }) {
  return (
    <div className="group flex items-center gap-1 px-1.5 py-1 bg-white border border-gray-100 rounded-lg hover:border-blue-300 transition-colors">
      {label && <span className="px-1 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[9px] font-bold flex-shrink-0">{label}</span>}
      <span className={`px-1 py-0.5 rounded text-[9px] font-bold flex-shrink-0 ${DOC_TYPE_META[doc.docType]?.badge || ''}`} title={DOC_TYPE_META[doc.docType]?.label}>
        {DOC_TYPE_META[doc.docType]?.label?.slice(0, 2) || '📎'}
      </span>
      <button onClick={onPreview} className="flex-1 text-left text-gray-700 truncate text-[10px] hover:text-blue-600" title={doc.fileName}>
        {doc.fileName}
      </button>
      {canEdit && (
        <button onClick={onDelete} className="text-gray-300 hover:text-red-500 text-[10px] px-0.5 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
      )}
    </div>
  )
}
