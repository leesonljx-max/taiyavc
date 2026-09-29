'use client'

/**
 * 尽调工作台 v2（Shell）
 *
 * - 前台：九大模块网格（资料计数）+ 点击模块在下方展示全部资料内容；
 *   右上「生成尽调报告」按钮（九模块资料完整才变蓝，灰色点击提示缺失部分）；
 *   报告生成后出现第 10 模块「投资决策」（合伙人投票 / 维护人看进度）
 * - 背面（资料中心）：点击「资料中心」工作台整体 3D 翻转过来；
 *   每模块可上传文档（自动提取全文）、上传截图、填写/添加多个文本框
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import DocumentPreviewModal from '@/components/DocumentPreviewModal'
import { compressImage } from '@/lib/image-compress'

// ── 类型（与后端 resources.ts 对齐） ──

interface DDResourceDoc { id: string; fileName: string; fileUrl: string; fileType: string; fileSize: number; text: string; uploadedAt: string }
interface DDTextBlock { id: string; content: string; createdAt: string }
interface DDScreenshot { id: string; url: string; fileName: string; uploadedAt: string }
interface DDModuleReport { summary: string; opportunities: string[]; risks: string[]; generatedAt: string }

interface ModuleResource {
  moduleKey: string
  moduleName: string
  documents: DDResourceDoc[]
  textBlocks: DDTextBlock[]
  screenshots: DDScreenshot[]
  report: DDModuleReport | null
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

function resourceCount(res: ModuleResource) {
  return {
    docs: res.documents.length,
    texts: res.textBlocks.filter(t => t.content.trim()).length,
    shots: res.screenshots.length,
  }
}
function isComplete(res: ModuleResource) {
  const c = resourceCount(res)
  return c.docs > 0 || c.texts > 0 || c.shots > 0
}

export default function DDWorkbenchShell({
  projectId,
  projectName,
  canEdit,
}: {
  projectId: string
  projectName: string
  canEdit: boolean
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

          {/* 模块网格：九大模块 + 报告生成后的第 10 模块（投资决策） */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {resources.map((res, i) => {
              const c = resourceCount(res)
              const complete = isComplete(res)
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
                    <span className={`w-2 h-2 rounded-full ${complete ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                  </div>
                  <p className="text-sm font-bold text-gray-800 leading-tight">{res.moduleName}</p>
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] flex-wrap">
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

          {/* 前台：选中模块 → 下方展示全部资料 + 报告；选中第 10 模块 → 投资决策面板 */}
          {selected && (
            <FrontModuleDetail
              module={selected}
              onOpenResourceCenter={() => { setExpandedKey(selected.moduleKey); setFlipped(true) }}
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

// ═════ 前台：选中模块的资料展示（文档/文本/截图 + 模块报告） ═════

function FrontModuleDetail({ module, onOpenResourceCenter }: { module: ModuleResource; onOpenResourceCenter: () => void }) {
  const [previewDoc, setPreviewDoc] = useState<{ fileName: string; fileUrl: string; fileType: string } | null>(null)
  const c = resourceCount(module)

  return (
    <div className="mt-5 pt-5 border-t border-[#efedfb]">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <h3 className="text-base font-bold text-gray-900">{module.moduleName} · 资料内容</h3>
        <button onClick={onOpenResourceCenter} className="px-3 py-1.5 text-xs font-bold text-[#6f63c9] border border-[#ddd7f2] rounded-lg hover:bg-[#efedfb]">
          去资料中心补充 →
        </button>
      </div>

      {c.docs + c.texts + c.shots === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center bg-gray-50/60 rounded-xl">该模块暂无资料，请到资料中心补充</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            {module.documents.length > 0 && (
              <div>
                <p className="text-[11px] font-bold text-gray-500 mb-1.5">📄 文档（{module.documents.length}）</p>
                <div className="space-y-1.5">
                  {module.documents.map(doc => (
                    <button
                      key={doc.id}
                      onClick={() => setPreviewDoc({ fileName: doc.fileName, fileUrl: doc.fileUrl, fileType: doc.fileType })}
                      className="w-full flex items-center gap-2 p-2 bg-white border border-[#efedfb] rounded-lg text-left hover:border-[#b6b1ee] text-xs"
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
                    <div key={t.id} className="p-2.5 bg-white border border-[#efedfb] rounded-lg text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{t.content}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-3">
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
        </div>
      )}

      {previewDoc && (
        <DocumentPreviewModal open={!!previewDoc} onClose={() => setPreviewDoc(null)} fileName={previewDoc.fileName} fileUrl={previewDoc.fileUrl} fileType={previewDoc.fileType} />
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
                  <textarea
                    value={t}
                    onChange={e => { setTexts(texts.map((x, j) => (j === i ? e.target.value : x))); setTextSaved(false) }}
                    rows={t.length > 200 ? 5 : 3}
                    placeholder={`文本框 ${i + 1}：填写该模块的文字内容（纪要、要点、说明等）...`}
                    disabled={!canEdit}
                    className="flex-1 px-3 py-2 text-xs border border-[#ddd7f2] rounded-xl bg-white focus:outline-none focus:border-[#b6b1ee] resize-y disabled:bg-gray-50"
                  />
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
