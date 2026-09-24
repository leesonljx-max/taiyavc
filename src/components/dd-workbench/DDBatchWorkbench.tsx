'use client'

/**
 * 尽调工作台主布局（《项目尽调工作台》设计稿版式）
 *
 * 结构（自上而下）：
 * 1. 标题区：项目尽调工作台 + 副标题 + [资料中心] [生成阅读版]
 * 2. 四概览卡：尽调阶段 / 核心模块 / 关键证据 / 需决问题
 * 3. 九大模块网格：编号 + 状态标签 + 四段分段进度条（资料归集→事实抽取→人工复核→报告冻结）
 * 4. 选中模块详情：stepper 流程条 + 专属主视觉 | 证据与行动 + 投委会追问（ModuleDetail）
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { getTemplateModule } from '@/lib/dd-workbench/template'
import { DD_BATCH_STATUS_LABELS, DD_RED_FLAG_LABELS } from '@/lib/dd-workbench/constants'
import { flowSteps, moduleStatusLabel, STAGE_ORDER, STAGE_LABELS } from './flow'
import ModuleDetail, { type TaskView, type EvidenceView, type BatchDetailView } from './ModuleDetail'
import ReportModal from './ReportModal'
import type { AssembledFullPackage } from '@/lib/dd-workbench/report'

// ── API 类型 ──

interface BatchSummary {
  id: string
  round: string | null
  templateVersion: string
  status: string
  dueDate: string | null
  createdAt: string
  stats: {
    total: number
    done: number
    inReview: number
    inProgress: number
    blocked: number
    pending: number
    redFlagMedium: number
    redFlagHigh: number
    evidenceCount: number
    frozenReportCount: number
    latestFrozenReport: { id: string; version: number; frozenAt: string; frozenBy: string } | null
  }
}

/** 项目阶段顺序与标签已移至 ./flow（共享） */

interface DDBatchWorkbenchProps {
  projectId: string
  projectName: string
  canEdit: boolean
}

export default function DDBatchWorkbench({ projectId, projectName, canEdit }: DDBatchWorkbenchProps) {
  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [detail, setDetail] = useState<BatchDetailView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)

  // 发起批次表单
  const [showCreate, setShowCreate] = useState(false)
  const [newRound, setNewRound] = useState('')
  const [newDueDate, setNewDueDate] = useState('')

  // 选中模块 + 其证据
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [taskEvidences, setTaskEvidences] = useState<EvidenceView[]>([])

  // 报告中心
  const [reportOpen, setReportOpen] = useState(false)
  const [reportData, setReportData] = useState<AssembledFullPackage | null>(null)
  const [reportVersionMeta, setReportVersionMeta] = useState<{ version: number; frozenBy: string | null; frozenAt: string } | null>(null)

  const activeBatch = useMemo(
    () => batches.find(b => b.status !== 'FROZEN') || batches[0] || null,
    [batches]
  )

  const selectedTask = useMemo(
    () => detail?.tasks.find(t => t.id === selectedTaskId) || null,
    [detail, selectedTaskId]
  )

  const loadBatches = useCallback(async () => {
    setError('')
    try {
      const res = await fetch(`/api/dd/batches?projectId=${projectId}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '获取尽调批次失败')
        return
      }
      setBatches(data.batches || [])
      const target = (data.batches || []).find((b: BatchSummary) => b.status !== 'FROZEN') || (data.batches || [])[0]
      if (target) {
        const dres = await fetch(`/api/dd/batches/${target.id}`)
        const ddata = await dres.json()
        if (dres.ok) {
          setDetail(ddata.batch)
          // 默认选中第一个模块
          setSelectedTaskId(prev => prev || ddata.batch.tasks[0]?.id || null)
        }
      } else {
        setDetail(null)
        setSelectedTaskId(null)
      }
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadBatches()
  }, [loadBatches])

  const refreshDetail = useCallback(async (batchId: string) => {
    const res = await fetch(`/api/dd/batches/${batchId}`)
    const data = await res.json()
    if (res.ok) setDetail(data.batch)
  }, [])

  // ── 批次操作 ──

  const createBatch = async () => {
    setBusy(true)
    setActionError('')
    try {
      const body: Record<string, unknown> = { projectId }
      if (newRound.trim()) body.round = newRound.trim()
      if (newDueDate) body.dueDate = new Date(newDueDate).toISOString()
      const res = await fetch('/api/dd/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setActionError(data.error || '发起批次失败')
        return
      }
      setShowCreate(false)
      setNewRound('')
      setNewDueDate('')
      await loadBatches()
    } catch {
      setActionError('网络错误')
    } finally {
      setBusy(false)
    }
  }

  const patchBatch = async (payload: Record<string, unknown>) => {
    if (!detail) return
    setBusy(true)
    setActionError('')
    try {
      const res = await fetch(`/api/dd/batches/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setActionError(data.error || '操作失败')
        return
      }
      await loadBatches()
    } catch {
      setActionError('网络错误')
    } finally {
      setBusy(false)
    }
  }

  const freezeReport = async () => {
    if (!detail) return
    if (!window.confirm('冻结后本批次任务与证据将锁定为只读，并生成投委会报告快照。确认冻结？')) return
    setBusy(true)
    setActionError('')
    try {
      const res = await fetch(`/api/dd/batches/${detail.id}/freeze`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setActionError(data.error || '冻结失败')
        return
      }
      await loadBatches()
    } catch {
      setActionError('网络错误')
    } finally {
      setBusy(false)
    }
  }

  const patchTask = async (taskId: string, payload: Record<string, unknown>) => {
    setActionError('')
    try {
      const res = await fetch(`/api/dd/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setActionError(data.error || '操作失败')
        return false
      }
      if (detail) await refreshDetail(detail.id)
      return true
    } catch {
      setActionError('网络错误')
      return false
    }
  }

  const loadTaskEvidences = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`/api/dd/evidence?taskId=${taskId}`)
      const data = await res.json()
      if (res.ok) setTaskEvidences(data.evidences || [])
    } catch {
      // 静默
    }
  }, [])

  const selectTask = (taskId: string) => {
    setSelectedTaskId(taskId)
    setActionError('')
    loadTaskEvidences(taskId)
  }

  // 选中模块变化时加载其证据
  useEffect(() => {
    if (selectedTaskId) loadTaskEvidences(selectedTaskId)
  }, [selectedTaskId, loadTaskEvidences])

  // ── 报告中心 ──

  const openReport = async (versionId?: string) => {
    if (!detail) return
    setReportOpen(true)
    setReportData(null)
    setReportVersionMeta(null)
    try {
      const qs = versionId ? `?versionId=${versionId}` : ''
      const res = await fetch(`/api/dd/batches/${detail.id}/report${qs}`)
      const data = await res.json()
      if (!res.ok) {
        setActionError(data.error || '生成报告失败')
        setReportOpen(false)
        return
      }
      setReportData(data.report)
      if (data.version) {
        setReportVersionMeta({
          version: data.version.version,
          frozenBy: data.version.frozenBy?.name || null,
          frozenAt: data.version.frozenAt,
        })
      }
    } catch {
      setActionError('网络错误')
      setReportOpen(false)
    }
  }

  const downloadMarkdown = async (versionId?: string) => {
    if (!detail) return
    try {
      const qs = versionId ? `?versionId=${versionId}&format=markdown` : '?format=markdown'
      const res = await fetch(`/api/dd/batches/${detail.id}/report${qs}`)
      const data = await res.json()
      if (!res.ok || !data.markdown) return
      const blob = new Blob([data.markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `尽调报告-${projectName}-${versionId ? `冻结v` : '预览'}-${Date.now() % 10000}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // 静默
    }
  }

  // ── 渲染 ──

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
          加载尽调工作台...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <p className="text-sm text-red-500 mb-2">{error}</p>
        <button onClick={loadBatches} className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg">
          重试
        </button>
      </div>
    )
  }

  // 无批次
  if (!activeBatch) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-xl font-bold text-gray-900">项目尽调工作台</h2>
        <p className="text-sm text-gray-400 mt-1">从材料收集到投委会报告，每个判断都能回到证据与责任人</p>
        {showCreate ? (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <input value={newRound} onChange={e => setNewRound(e.target.value)} placeholder="融资轮次（如 A轮）" className="px-3 py-2 border border-gray-200 rounded-xl text-sm" />
            <input type="date" value={newDueDate} onChange={e => setNewDueDate(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm" />
            <div className="flex gap-2">
              <button onClick={createBatch} disabled={busy} className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl disabled:opacity-50">
                {busy ? '创建中...' : '发起尽调批次'}
              </button>
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-xl">取消</button>
            </div>
          </div>
        ) : canEdit ? (
          <button onClick={() => setShowCreate(true)} className="mt-4 px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl shadow-md shadow-blue-500/25 hover:bg-blue-700">
            + 发起尽调批次
          </button>
        ) : (
          <p className="mt-4 text-sm text-gray-400">暂无尽调批次</p>
        )}
        {actionError && <p className="mt-2 text-xs text-red-500">{actionError}</p>}
      </div>
    )
  }

  const stats = activeBatch.stats
  const frozen = activeBatch.status === 'FROZEN'

  // 概览卡数据
  const stageIdx = detail ? STAGE_ORDER.indexOf(detail.project.followStage) : -1
  const stageText = stageIdx >= 0 ? `${STAGE_LABELS[detail!.project.followStage] || detail!.project.followStage} 第${stageIdx + 1}/${STAGE_ORDER.length}阶段` : '—'
  // 阶段四段条：有证据 → 有确认证据 → 有完成模块 → 批次冻结
  const stageSteps = [
    stats.evidenceCount > 0,
    (detail?.tasks.some(t => t.confirmedEvidenceCount > 0)) || false,
    stats.done > 0,
    frozen,
  ]
  const openIssues = (stats.total - stats.done) + (detail?.tasks.reduce((s, t) => s + t.conflictEvidenceCount, 0) || 0)

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      {/* ═══ 1. 标题区 ═══ */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">项目尽调工作台</h2>
          <p className="text-xs text-gray-400 mt-1">从材料收集到投委会报告，每个判断都能回到证据与责任人</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => document.getElementById('dd-resource-center')?.scrollIntoView({ behavior: 'smooth' })}
            className="px-3.5 py-2 bg-white border border-gray-200 text-gray-600 text-xs font-bold rounded-xl hover:border-blue-300 hover:text-blue-600"
          >
            资料中心
          </button>
          <button
            onClick={() => openReport()}
            className="px-3.5 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/25 hover:bg-blue-700"
          >
            生成阅读版
          </button>
        </div>
      </div>

      {/* ═══ 2. 四概览卡 ═══ */}
      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 尽调阶段 */}
        <div className="rounded-xl border border-gray-100 bg-slate-50/60 p-4">
          <p className="text-[11px] text-gray-400 font-medium">尽调阶段</p>
          <p className="mt-1 text-sm font-bold text-gray-800">{stageText}</p>
          <div className="mt-2.5 flex gap-1">
            {stageSteps.map((done, i) => (
              <div key={i} className={`flex-1 h-1.5 rounded-full ${done ? 'bg-blue-500' : i === stageSteps.findIndex(x => !x) ? 'bg-blue-200' : 'bg-gray-200'}`} />
            ))}
          </div>
        </div>
        {/* 核心模块 */}
        <div className="rounded-xl border border-gray-100 bg-slate-50/60 p-4">
          <p className="text-[11px] text-gray-400 font-medium">核心模块</p>
          <p className="mt-1">
            <span className="text-2xl font-bold text-gray-900">{stats.done}</span>
            <span className="text-xs text-gray-400 ml-1">/ {stats.total} 已复核</span>
          </p>
          <p className="mt-1.5 text-[10px] text-gray-400">
            {stats.inReview} 待复核 · {stats.blocked} 阻塞
          </p>
        </div>
        {/* 关键证据 */}
        <div className="rounded-xl border border-gray-100 bg-slate-50/60 p-4">
          <p className="text-[11px] text-gray-400 font-medium">关键证据</p>
          <p className="mt-1">
            <span className="text-2xl font-bold text-gray-900">{stats.evidenceCount}</span>
            <span className="text-xs text-gray-400 ml-1">可引用</span>
          </p>
          <p className="mt-1.5 text-[10px] text-gray-400">
            {detail ? detail.tasks.reduce((s, t) => s + t.confirmedEvidenceCount, 0) : 0} 条已确认 ·{' '}
            {detail ? detail.tasks.reduce((s, t) => s + t.conflictEvidenceCount, 0) : 0} 条冲突
          </p>
        </div>
        {/* 需决问题 */}
        <div className="rounded-xl border border-gray-100 bg-slate-50/60 p-4">
          <p className="text-[11px] text-gray-400 font-medium">需决问题</p>
          <p className="mt-1">
            <span className={`text-2xl font-bold ${openIssues > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{openIssues}</span>
            <span className="text-xs text-gray-400 ml-1">会前关闭</span>
          </p>
          <p className="mt-1.5 text-[10px] text-gray-400">
            红旗 {stats.redFlagHigh} 高 / {stats.redFlagMedium} 中
          </p>
        </div>
      </div>

      {/* 批次操作条 */}
      <div className="mt-4 flex items-center gap-2 flex-wrap text-xs">
        <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-bold border border-blue-100">
          批次 {activeBatch.round || '默认'} · {DD_BATCH_STATUS_LABELS[activeBatch.status as keyof typeof DD_BATCH_STATUS_LABELS] || activeBatch.status}
        </span>
        {activeBatch.dueDate && <span className="text-gray-400">截止 {activeBatch.dueDate.slice(0, 10)}</span>}
        <div className="ml-auto flex items-center gap-2">
          {canEdit && !frozen && detail?.status === 'IN_PROGRESS' && (
            <button onClick={() => patchBatch({ status: 'IN_REVIEW' })} disabled={busy} className="px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 font-bold rounded-lg hover:bg-amber-100 disabled:opacity-50">
              提请复核
            </button>
          )}
          {canEdit && !frozen && detail?.status === 'IN_REVIEW' && (
            <>
              <button onClick={() => patchBatch({ status: 'IN_PROGRESS' })} disabled={busy} className="px-3 py-1.5 bg-gray-100 text-gray-600 font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50">
                打回修改
              </button>
              <button onClick={freezeReport} disabled={busy || stats.done < stats.total} title={stats.done < stats.total ? '全部模块完成后可冻结' : '生成投委会报告快照并锁定批次'} className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-blue-600 text-white font-bold rounded-lg shadow-md disabled:opacity-40 disabled:cursor-not-allowed">
                ❄ 冻结报告
              </button>
            </>
          )}
          {canEdit && frozen && (
            <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700">
              + 发起新批次
            </button>
          )}
        </div>
      </div>
      {actionError && <p className="mt-2 text-xs text-red-500">{actionError}</p>}

      {/* 冻结后新批次表单 */}
      {showCreate && frozen && canEdit && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-end p-4 bg-slate-50 rounded-xl">
          <input value={newRound} onChange={e => setNewRound(e.target.value)} placeholder="新批次轮次（如 A+轮）" className="px-3 py-2 border border-gray-200 rounded-xl text-sm" />
          <input type="date" value={newDueDate} onChange={e => setNewDueDate(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm" />
          <div className="flex gap-2">
            <button onClick={createBatch} disabled={busy} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-xl disabled:opacity-50">创建</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-200 text-gray-600 text-sm rounded-xl">取消</button>
          </div>
        </div>
      )}

      {/* ═══ 3. 九大模块网格 ═══ */}
      {!detail ? (
        <div className="mt-6 py-8 text-center text-sm text-gray-400">加载任务中...</div>
      ) : (
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {detail.tasks.map((task, idx) => {
            const tpl = getTemplateModule(task.moduleKey)
            const label = moduleStatusLabel(task.moduleKey, task.status)
            const steps = flowSteps(task)
            const currentStep = steps.findIndex(s => !s.done)
            const selected = selectedTaskId === task.id
            return (
              <button
                key={task.id}
                onClick={() => selectTask(task.id)}
                className={`text-left rounded-xl border p-4 transition-all ${
                  selected
                    ? 'border-blue-400 ring-2 ring-blue-100 bg-blue-50/40'
                    : 'border-gray-100 hover:border-blue-200 hover:shadow-sm'
                } ${task.redFlagLevel === 'HIGH' ? 'border-red-200' : task.redFlagLevel === 'MEDIUM' ? 'border-amber-200' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-lg font-black ${selected ? 'text-blue-600' : 'text-gray-300'}`}>
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${label.cls}`}>
                    {label.label}
                  </span>
                </div>
                <p className="mt-1.5 text-sm font-bold text-gray-800">{tpl?.name || task.moduleKey}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{tpl?.coreQuestion}</p>
                {/* 四段分段进度条 */}
                <div className="mt-3 flex gap-1">
                  {steps.map((s, i) => (
                    <div
                      key={s.key}
                      title={s.label}
                      className={`flex-1 h-1.5 rounded-full ${
                        s.done ? 'bg-blue-500' : i === currentStep ? 'bg-blue-200' : 'bg-gray-200'
                      }`}
                    />
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
                  {task.redFlagLevel !== 'NONE' && (
                    <span className={`font-bold ${task.redFlagLevel === 'HIGH' ? 'text-red-500' : 'text-amber-500'}`}>
                      ⚑ {DD_RED_FLAG_LABELS[task.redFlagLevel as keyof typeof DD_RED_FLAG_LABELS]}
                    </span>
                  )}
                  {task.owner?.name && <span>{task.owner.name}</span>}
                  <span className="ml-auto">证据 {task.evidenceCount}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ═══ 4. 选中模块详情 ═══ */}
      {detail && selectedTask && (
        <div className="mt-6">
          <ModuleDetail
            key={selectedTask.id}
            task={selectedTask}
            tasks={detail.tasks}
            projectName={projectName}
            canEdit={canEdit && !frozen}
            evidences={taskEvidences}
            onPatchTask={patchTask}
            onEvidenceChanged={() => {
              loadTaskEvidences(selectedTask.id)
              refreshDetail(detail.id)
            }}
            onSelectTask={selectTask}
          />
        </div>
      )}

      {/* 报告弹层 */}
      {reportOpen && (
        <ReportModal
          report={reportData}
          versionMeta={reportVersionMeta}
          versions={detail?.reportVersions || []}
          onClose={() => setReportOpen(false)}
          onViewVersion={openReport}
          onDownload={downloadMarkdown}
        />
      )}
    </div>
  )
}

export type { TaskView, EvidenceView, BatchSummary }
