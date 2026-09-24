'use client'

/**
 * 模块详情区（设计稿图2）：统一流形 stepper + 专属主视觉 | 证据与行动 + 投委会追问
 *
 * 流程：资料归集 → 事实抽取 → 人工复核 → 报告冻结（当前步高亮，可点击滚动定位）
 * 视图切换：专属视觉（模块特色图形）| 事实卡（证据明细列表）
 */

import { useState, useEffect } from 'react'
import { getTemplateModule } from '@/lib/dd-workbench/template'
import {
  DD_TASK_TRANSITIONS,
  DD_TASK_STATUS_LABELS,
  DD_RED_FLAG_LABELS,
  DD_EVIDENCE_SOURCE_TYPE_LABELS,
  DD_EVIDENCE_GRADE_LABELS,
  DD_EVIDENCE_STATUS_LABELS,
  type DDTaskStatus,
} from '@/lib/dd-workbench/constants'
import { ModuleVisual, MODULE_VISUAL_LABELS } from './ModuleVisuals'
import { flowSteps } from './flow'

// ── 类型（从批次详情 API 对齐） ──

export interface TaskView {
  id: string
  moduleKey: string
  status: string
  conclusion: string | null
  aiDraft: string | null
  ownerId: string | null
  owner: { id: string; name: string | null; avatar: string | null } | null
  redFlagLevel: string
  sortKey: number
  evidenceCount: number
  confirmedEvidenceCount: number
  conflictEvidenceCount: number
  pendingEvidenceCount: number
  updatedAt: string
}

export interface EvidenceView {
  id: string
  sourceType: string
  documentId: string | null
  documentFileName: string | null
  sourceUrl: string | null
  sourceLabel: string | null
  location: string | null
  excerpt: string
  grade: string
  status: string
  note: string | null
  createdBy: { id: string; name: string | null }
  confirmedBy: { id: string; name: string | null } | null
  confirmedAt: string | null
  createdAt: string
}

export interface ReportVersionView {
  id: string
  reportType: string
  moduleKey: string | null
  version: number
  frozenAt: string
  frozenBy: { id: string; name: string | null }
}

export interface BatchDetailView {
  id: string
  projectId: string
  project: {
    id: string
    name: string
    companyFullName: string | null
    industry: string | null
    financingRound: string | null
    followStage: string
    totalAmount: string
    investmentValuation: number | null
  }
  round: string | null
  templateVersion: string
  status: string
  dueDate: string | null
  createdAt: string
  tasks: TaskView[]
  reportVersions: ReportVersionView[]
}

// ── 样式映射 ──

const gradeStyles: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-indigo-100 text-indigo-700',
  D: 'bg-gray-200 text-gray-600',
}

const evidenceStatusStyles: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  CONFIRMED: 'bg-emerald-100 text-emerald-700',
  CONFLICT: 'bg-red-100 text-red-700',
}

interface ModuleDetailProps {
  task: TaskView
  tasks: TaskView[]
  projectName: string
  canEdit: boolean
  evidences: EvidenceView[]
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<boolean>
  onEvidenceChanged: () => void
  onSelectTask: (taskId: string) => void
}

export default function ModuleDetail({
  task,
  tasks,
  projectName,
  canEdit,
  evidences,
  onPatchTask,
  onEvidenceChanged,
  onSelectTask,
}: ModuleDetailProps) {
  const tpl = getTemplateModule(task.moduleKey)
  const moduleIdx = tasks.findIndex(t => t.id === task.id)
  const visualLabel = MODULE_VISUAL_LABELS[task.moduleKey] || '框架图'

  const [view, setView] = useState<'visual' | 'facts'>('visual')
  const [conclusion, setConclusion] = useState(task.conclusion || '')
  const [savingConclusion, setSavingConclusion] = useState(false)

  useEffect(() => {
    setConclusion(task.conclusion || '')
    setView('visual')
  }, [task.id, task.conclusion])

  const steps = flowSteps(task)
  const currentStep = Math.max(0, steps.findIndex(s => !s.done))

  const saveConclusion = async () => {
    setSavingConclusion(true)
    await onPatchTask(task.id, { conclusion })
    setSavingConclusion(false)
  }

  const transitions = (DD_TASK_TRANSITIONS[task.status as DDTaskStatus] || []).map(s => ({
    status: s,
    label: { IN_PROGRESS: '▶ 开始分析', IN_REVIEW: '📤 提请复核', DONE: '✅ 确认完成', BLOCKED: '⛔ 标记阻塞', PENDING: '↩ 重置待启动' }[s] || s,
    style: {
      IN_PROGRESS: 'bg-blue-50 text-blue-700 border-blue-200',
      IN_REVIEW: 'bg-amber-50 text-amber-700 border-amber-200',
      DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      BLOCKED: 'bg-red-50 text-red-700 border-red-200',
      PENDING: 'bg-gray-100 text-gray-600 border-gray-200',
    }[s] || 'bg-gray-100 text-gray-600',
  }))

  // 未决问题（与报告组装口径一致）
  const openQuestions: string[] = []
  if (!task.conclusion?.trim()) openQuestions.push('人工结论未填写')
  if (task.status === 'IN_REVIEW') openQuestions.push('结论待复核确认')
  if (task.status === 'BLOCKED') openQuestions.push('模块阻塞：需补充资料或等待外部反馈')
  if (task.conflictEvidenceCount > 0) openQuestions.push(`${task.conflictEvidenceCount} 条冲突证据待人工裁决`)

  return (
    <div className="rounded-2xl border border-gray-100 overflow-hidden">
      {/* ── 详情头部：模块定位 + 视图切换 ── */}
      <div className="flex items-center justify-between flex-wrap gap-2 px-5 py-3.5 bg-slate-50/80 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <span className="px-2 py-0.5 rounded-lg bg-blue-600 text-white text-[10px] font-black">
            模块 {String(moduleIdx + 1).padStart(2, '0')}
          </span>
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${
            task.status === 'DONE' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-white text-gray-500 border border-gray-200'
          }`}>
            {DD_TASK_STATUS_LABELS[task.status as DDTaskStatus] || task.status}
          </span>
          <h3 className="font-bold text-gray-900">{tpl?.name || task.moduleKey}</h3>
          {/* 前后模块切换 */}
          <div className="flex items-center gap-0.5 ml-2">
            <button
              onClick={() => moduleIdx > 0 && onSelectTask(tasks[moduleIdx - 1].id)}
              disabled={moduleIdx === 0}
              className="px-1.5 py-0.5 text-gray-400 hover:text-blue-600 disabled:opacity-30"
              title="上一模块"
            >
              ←
            </button>
            <button
              onClick={() => moduleIdx < tasks.length - 1 && onSelectTask(tasks[moduleIdx + 1].id)}
              disabled={moduleIdx >= tasks.length - 1}
              className="px-1.5 py-0.5 text-gray-400 hover:text-blue-600 disabled:opacity-30"
              title="下一模块"
            >
              →
            </button>
          </div>
        </div>
        {/* 视图切换：事实卡 | 专属视觉 */}
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

      {/* ── 统一流形 stepper ── */}
      <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-1 overflow-x-auto">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1 flex-shrink-0">
            {i > 0 && <span className="text-gray-300 mx-0.5">→</span>}
            <button
              onClick={() => {
                if (s.key === 'collect' || s.key === 'extract') setView('facts')
                else document.getElementById('dd-conclusion-editor')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
              title={`资料归集：${steps[0].done ? '已归集' : '待归集'} · 点击定位`}
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
        {task.redFlagLevel !== 'NONE' && (
          <span className={`ml-3 px-2 py-0.5 rounded-lg text-[10px] font-bold flex-shrink-0 ${
            task.redFlagLevel === 'HIGH' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
          }`}>
            ⚑ 风险红旗 · {DD_RED_FLAG_LABELS[task.redFlagLevel as keyof typeof DD_RED_FLAG_LABELS]}
          </span>
        )}
      </div>

      {/* ── 主区：双列（主视觉 | 证据与行动） ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 p-5">
        {/* 左：主视觉 / 事实卡 */}
        <div className="lg:col-span-3 space-y-4">
          {view === 'visual' ? (
            <ModuleVisual
              moduleKey={task.moduleKey}
              task={task}
              projectName={projectName}
            />
          ) : (
            <FactsCard evidences={evidences} />
          )}

          {/* 人工结论（进入正式报告） */}
          <div id="dd-conclusion-editor">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-gray-500">
                人工结论 <span className="text-gray-300 font-normal">（结论先行 · 进入正式报告 · 冻结时固化）</span>
              </span>
              {canEdit && (
                <button
                  onClick={saveConclusion}
                  disabled={savingConclusion || conclusion === (task.conclusion || '')}
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
              placeholder={`回答核心问题「${tpl?.coreQuestion || ''}」：判断 + 关键依据 + 下一步动作`}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-300 disabled:bg-gray-50 disabled:text-gray-500"
            />
            {task.aiDraft && (
              <details className="mt-2 px-3 py-2 bg-indigo-50/50 border border-indigo-100 rounded-xl text-xs">
                <summary className="cursor-pointer text-indigo-600 font-bold">AI 草稿（仅供参考，不进入正式结论）</summary>
                <p className="mt-2 text-gray-600 whitespace-pre-wrap">{task.aiDraft}</p>
              </details>
            )}
          </div>
        </div>

        {/* 右：证据与行动 + 追问 */}
        <div className="lg:col-span-2 space-y-4">
          <EvidenceActions
            task={task}
            canEdit={canEdit}
            evidences={evidences}
            onEvidenceChanged={onEvidenceChanged}
          />

          {/* 投委会关键追问 */}
          <div className="rounded-xl bg-slate-50 border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-500">投委会关键追问</p>
            <p className="mt-2 text-sm text-gray-800 font-medium leading-relaxed">
              {IC_QUESTION_HINTS[task.moduleKey] || tpl?.coreQuestion}
            </p>
            {openQuestions.length > 0 ? (
              <div className="mt-3 space-y-1">
                {openQuestions.map(q => (
                  <p key={q} className="text-xs text-amber-600 flex items-start gap-1.5">
                    <span className="mt-0.5">●</span> {q}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-emerald-600 flex items-center gap-1.5">✓ 该模块已复核，无未决事项</p>
            )}
          </div>
        </div>
      </div>

      {/* ── 底部操作条：状态推进 + 红旗 ── */}
      {canEdit && (
        <div className="flex items-center gap-2 flex-wrap px-5 py-3 bg-slate-50/60 border-t border-gray-100">
          <span className="text-xs text-gray-400">状态推进：</span>
          {transitions.map(t => (
            <button
              key={t.status}
              onClick={() => onPatchTask(task.id, { status: t.status })}
              className={`px-3 py-1.5 border text-xs font-bold rounded-lg hover:brightness-95 ${t.style}`}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-4 text-xs text-gray-400">红旗：</span>
          {(['NONE', 'MEDIUM', 'HIGH'] as const).map(level => (
            <button
              key={level}
              onClick={() => onPatchTask(task.id, { redFlagLevel: level })}
              disabled={task.redFlagLevel === level}
              className={`px-2.5 py-1 text-xs rounded-lg font-bold border disabled:opacity-100 ${
                task.redFlagLevel === level
                  ? level === 'HIGH'
                    ? 'bg-red-100 text-red-700 border-red-200'
                    : level === 'MEDIUM'
                      ? 'bg-amber-100 text-amber-700 border-amber-200'
                      : 'bg-gray-100 text-gray-500 border-gray-200'
                  : 'bg-white text-gray-400 border-gray-200 hover:text-gray-600'
              }`}
            >
              {DD_RED_FLAG_LABELS[level]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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

// ── 事实卡视图（证据明细） ──

function FactsCard({ evidences }: { evidences: EvidenceView[] }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gradient-to-br from-slate-50 to-blue-50/40 p-4">
      <p className="text-[11px] text-gray-400 mb-3 font-medium">事实卡 · 证据明细（按确认状态分级）</p>
      {evidences.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-xs text-gray-400">暂无事实卡。请从右侧「证据与行动」添加证据后自动生成。</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
          {evidences.map(ev => (
            <div key={ev.id} className={`px-3 py-2.5 rounded-xl border bg-white text-xs ${
              ev.status === 'CONFLICT' ? 'border-red-200' : ev.status === 'CONFIRMED' ? 'border-emerald-100' : 'border-gray-200'
            }`}>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded font-black ${gradeStyles[ev.grade] || 'bg-gray-100'}`}>{ev.grade}</span>
                <span className={`px-1.5 py-0.5 rounded font-medium ${evidenceStatusStyles[ev.status] || ''}`}>
                  {DD_EVIDENCE_STATUS_LABELS[ev.status as keyof typeof DD_EVIDENCE_STATUS_LABELS] || ev.status}
                </span>
                <span className="text-gray-500">{DD_EVIDENCE_SOURCE_TYPE_LABELS[ev.sourceType as keyof typeof DD_EVIDENCE_SOURCE_TYPE_LABELS] || ev.sourceType}</span>
                {ev.location && <span className="text-gray-400">{ev.location}</span>}
              </div>
              <p className="mt-1.5 text-gray-700 leading-relaxed">“{ev.excerpt}”</p>
              <p className="mt-1 text-[10px] text-gray-400">
                {ev.sourceLabel || '—'} · {ev.createdBy?.name} · {new Date(ev.createdAt).toLocaleDateString('zh-CN')}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 证据与行动面板 ──

function EvidenceActions({
  task,
  canEdit,
  evidences,
  onEvidenceChanged,
}: {
  task: TaskView
  canEdit: boolean
  evidences: EvidenceView[]
  onEvidenceChanged: () => void
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [sourceType, setSourceType] = useState<'WEB' | 'MANUAL'>('WEB')
  const [excerpt, setExcerpt] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [location, setLocation] = useState('')
  const [grade, setGrade] = useState('C')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const addEvidence = async () => {
    setSaving(true)
    setFormError('')
    try {
      const body: Record<string, unknown> = { taskId: task.id, sourceType, excerpt: excerpt.trim() }
      if (sourceType === 'WEB') body.sourceUrl = sourceUrl.trim()
      if (sourceType !== 'MANUAL') body.grade = grade
      if (sourceLabel.trim()) body.sourceLabel = sourceLabel.trim()
      if (location.trim()) body.location = location.trim()
      const res = await fetch('/api/dd/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setFormError(data.error || '添加失败')
        return
      }
      setExcerpt('')
      setSourceUrl('')
      setLocation('')
      setFormOpen(false)
      onEvidenceChanged()
    } catch {
      setFormError('网络错误')
    } finally {
      setSaving(false)
    }
  }

  const patchEvidence = async (id: string, payload: Record<string, unknown>) => {
    if (payload.status === 'CONFLICT') {
      const note = window.prompt('请填写冲突说明（如：与审计报告数据矛盾）', '')
      if (!note) return
      payload.note = note
    }
    const res = await fetch(`/api/dd/evidence/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) onEvidenceChanged()
  }

  const deleteEvidence = async (id: string) => {
    if (!window.confirm('删除该证据？')) return
    const res = await fetch(`/api/dd/evidence/${id}`, { method: 'DELETE' })
    if (res.ok) onEvidenceChanged()
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs font-bold text-gray-600">
          证据与行动 <span className="text-gray-300 font-normal">· {evidences.length} 条来源</span>
        </span>
        {canEdit && (
          <button onClick={() => setFormOpen(!formOpen)} className="text-xs px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg font-bold hover:bg-blue-100">
            {formOpen ? '收起' : '+ 添加'}
          </button>
        )}
      </div>

      {/* 添加表单 */}
      {formOpen && canEdit && (
        <div className="mb-3 p-3 bg-slate-50 rounded-lg border border-gray-100 space-y-2">
          <div className="flex gap-1.5">
            {(['WEB', 'MANUAL'] as const).map(t => (
              <button
                key={t}
                onClick={() => setSourceType(t)}
                className={`px-2.5 py-1 text-xs rounded-lg font-bold ${sourceType === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
              >
                {DD_EVIDENCE_SOURCE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <textarea
            value={excerpt}
            onChange={e => setExcerpt(e.target.value)}
            rows={2}
            placeholder="摘录原文（结论必须可定位到此处）"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            {sourceType === 'WEB' && (
              <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https:// 来源链接" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs col-span-2" />
            )}
            <input value={sourceLabel} onChange={e => setSourceLabel(e.target.value)} placeholder="来源名称" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="定位（如 P12）" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
            {sourceType !== 'MANUAL' && (
              <select value={grade} onChange={e => setGrade(e.target.value)} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs">
                {(['A', 'B', 'C', 'D'] as const).map(g => (
                  <option key={g} value={g}>{DD_EVIDENCE_GRADE_LABELS[g]}</option>
                ))}
              </select>
            )}
          </div>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <button onClick={addEvidence} disabled={saving || !excerpt.trim()} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg disabled:opacity-40">
            {saving ? '保存中...' : '保存证据'}
          </button>
        </div>
      )}

      {/* 证据清单 */}
      {evidences.length === 0 ? (
        <p className="text-xs text-gray-400 py-3 text-center">
          暂无证据来源。任务完成需要至少一条已确认（A/B/C 级）证据支撑。
        </p>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
          {evidences.map(ev => (
            <div key={ev.id} className={`px-3 py-2 rounded-lg border text-xs ${
              ev.status === 'CONFLICT' ? 'border-red-200 bg-red-50/40' : ev.status === 'CONFIRMED' ? 'border-emerald-100 bg-emerald-50/20' : 'border-gray-200'
            }`}>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded font-black ${gradeStyles[ev.grade] || 'bg-gray-100'}`}>{ev.grade}</span>
                <span className={`px-1.5 py-0.5 rounded font-medium ${evidenceStatusStyles[ev.status] || ''}`}>
                  {DD_EVIDENCE_STATUS_LABELS[ev.status as keyof typeof DD_EVIDENCE_STATUS_LABELS] || ev.status}
                </span>
                <span className="text-gray-500 truncate">
                  {ev.sourceLabel || DD_EVIDENCE_SOURCE_TYPE_LABELS[ev.sourceType as keyof typeof DD_EVIDENCE_SOURCE_TYPE_LABELS]}
                  {ev.location ? ` · ${ev.location}` : ''}
                </span>
                {ev.sourceUrl && (
                  <a href={ev.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate max-w-[140px]">
                    {ev.sourceUrl}
                  </a>
                )}
              </div>
              <p className="mt-1 text-gray-700 leading-relaxed line-clamp-2">“{ev.excerpt}”</p>
              {ev.note && <p className="mt-0.5 text-red-500">⚠ {ev.note}</p>}
              {canEdit && (
                <div className="mt-1.5 flex gap-1.5">
                  {ev.status !== 'CONFIRMED' && (
                    <button onClick={() => patchEvidence(ev.id, { status: 'CONFIRMED' })} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded font-bold hover:bg-emerald-100">确认</button>
                  )}
                  {ev.status !== 'CONFLICT' && (
                    <button onClick={() => patchEvidence(ev.id, { status: 'CONFLICT' })} className="px-2 py-0.5 bg-red-50 text-red-600 rounded font-bold hover:bg-red-100">冲突</button>
                  )}
                  {ev.status === 'CONFLICT' && (
                    <button onClick={() => patchEvidence(ev.id, { status: 'PENDING' })} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded font-bold hover:bg-gray-200">重新待确认</button>
                  )}
                  <button onClick={() => deleteEvidence(ev.id)} className="px-2 py-0.5 text-gray-400 hover:text-red-500 rounded">删除</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 证据状态小结 */}
      <div className="mt-2.5 pt-2 border-t border-gray-50 flex items-center gap-3 text-[10px] text-gray-400">
        <span>✓ 已确认 {task.confirmedEvidenceCount}</span>
        <span>● 待确认 {task.pendingEvidenceCount}</span>
        <span className="text-red-400">⚠ 冲突 {task.conflictEvidenceCount}</span>
      </div>
    </div>
  )
}
