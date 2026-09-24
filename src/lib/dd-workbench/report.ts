/**
 * 尽调整包报告组装（纯函数，供预览与冻结快照共用）
 *
 * 依据文档 §3 报告排版原则：
 * - 结论先行：模块结论在最前
 * - 所有重要论断附引用编号（证据索引 E1、E2…）
 * - "已确认" / "待核验" / "存在冲突" 明显区分
 * - D 级（待核验）证据不得支撑关键结论，仅进待办/附录
 */

import { DD_TEMPLATE_MODULES, getTemplateModule, type DDTemplateModule } from './template'

// ── 输入类型（与 Prisma 行结构对齐的最小字段集） ──

export interface ReportTaskRow {
  id: string
  moduleKey: string
  status: string
  conclusion: string | null
  ownerId: string | null
  owner?: { id: string; name: string | null } | null
  redFlagLevel: string
  sortKey: number
}

export interface ReportEvidenceRow {
  id: string
  taskId: string
  sourceType: string
  documentId: string | null
  sourceUrl: string | null
  sourceLabel: string | null
  location: string | null
  excerpt: string
  grade: string
  status: string
  createdAt: Date
}

export interface ReportProjectRow {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  financingRound: string | null
  followStage: string
  totalAmount: string
  investmentValuation: number | null
}

export interface ReportBatchRow {
  id: string
  projectId: string
  round: string | null
  templateVersion: string
  status: string
  dueDate: Date | null
  createdAt: Date
}

// ── 组装结果 ──

export interface ReportEvidenceView {
  ref: string // 引用编号（E1、E2…，全批统一编号）
  id: string
  sourceType: string
  sourceLabel: string | null
  location: string | null
  sourceUrl: string | null
  documentId: string | null
  excerpt: string
  grade: string
  status: string
}

export interface ReportModuleView {
  moduleKey: string
  name: string
  coreQuestion: string
  inputs: string
  suggestedOwnerRole: string
  status: string
  redFlagLevel: string
  conclusion: string | null
  owner: { id: string; name: string | null } | null
  /** 支撑结论的证据（已确认 A/B/C） */
  supportingEvidence: ReportEvidenceView[]
  /** 待核验附录（PENDING 或 D 级）——不得作为结论支撑 */
  pendingEvidence: ReportEvidenceView[]
  /** 存在冲突的证据（需人工裁决，报告中显著标注） */
  conflictEvidence: ReportEvidenceView[]
  /** 未决问题：任务未完成时的追问清单 */
  openQuestions: string[]
}

export interface AssembledFullPackage {
  batch: {
    id: string
    round: string | null
    templateVersion: string
    status: string
    dueDate: string | null
    createdAt: string
  }
  project: ReportProjectRow
  generatedAt: string
  progress: {
    total: number
    done: number
    inReview: number
    inProgress: number
    blocked: number
    pending: number
    completionRate: number // 0-100
  }
  modules: ReportModuleView[]
  /** 风险热力：按红旗级别倒序（HIGH 在前） */
  redFlags: Array<{ moduleKey: string; name: string; level: string; conclusion: string | null }>
  /** 缺口清单（未完成任务 + 阻塞项） */
  pendingItems: Array<{ moduleKey: string; name: string; status: string; reason: string }>
  /** 全批证据索引（引用编号 → 证据） */
  evidenceIndex: ReportEvidenceView[]
}

/** 单条证据归类：支撑 / 待核验附录 / 冲突 */
function classifyEvidence(e: ReportEvidenceRow): 'supporting' | 'pending' | 'conflict' {
  if (e.status === 'CONFLICT') return 'conflict'
  const gradeOk = ['A', 'B', 'C'].includes(e.grade)
  if (e.status === 'CONFIRMED' && gradeOk) return 'supporting'
  return 'pending' // PENDING 确认态 或 D 级
}

/**
 * 组装整包报告（九大模块 + 证据索引 + 红旗 + 缺口清单）
 * 纯函数：任务行 + 证据行 + 项目/批次行 → 结构化报告 JSON
 */
export function assembleFullPackage(input: {
  batch: ReportBatchRow
  project: ReportProjectRow
  tasks: ReportTaskRow[]
  evidences: ReportEvidenceRow[]
}): AssembledFullPackage {
  const { batch, project, tasks, evidences } = input

  // 全批统一证据编号：按创建时间先后 E1、E2…
  const sorted = [...evidences].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const refById = new Map<string, string>(sorted.map((e, i) => [e.id, `E${i + 1}`]))

  const toView = (e: ReportEvidenceRow): ReportEvidenceView => ({
    ref: refById.get(e.id) || '',
    id: e.id,
    sourceType: e.sourceType,
    sourceLabel: e.sourceLabel,
    location: e.location,
    sourceUrl: e.sourceUrl,
    documentId: e.documentId,
    excerpt: e.excerpt,
    grade: e.grade,
    status: e.status,
  })

  // 模板顺序为准；批次历史模板可能缺模块（templateVersion 兼容），以任务行实际为准
  const templateByKey = new Map<string, DDTemplateModule>(DD_TEMPLATE_MODULES.map(m => [m.key, m]))
  const orderedTasks = [...tasks].sort((a, b) => {
    const ta = templateByKey.get(a.moduleKey)?.sortKey ?? 99
    const tb = templateByKey.get(b.moduleKey)?.sortKey ?? 99
    return ta - tb || a.sortKey - b.sortKey
  })

  const evidencesByTask = new Map<string, ReportEvidenceRow[]>()
  for (const e of evidences) {
    if (!evidencesByTask.has(e.taskId)) evidencesByTask.set(e.taskId, [])
    evidencesByTask.get(e.taskId)!.push(e)
  }

  const modules: ReportModuleView[] = orderedTasks.map(task => {
    const tpl = templateByKey.get(task.moduleKey)
    const taskEvidences = (evidencesByTask.get(task.id) || []).map(toView)
    const rows = evidencesByTask.get(task.id) || []

    const supporting: ReportEvidenceView[] = []
    const pending: ReportEvidenceView[] = []
    const conflict: ReportEvidenceView[] = []
    rows.forEach((row, i) => {
      const view = taskEvidences[i]
      const kind = classifyEvidence(row)
      if (kind === 'supporting') supporting.push(view)
      else if (kind === 'conflict') conflict.push(view)
      else pending.push(view)
    })

    // 未决问题：结论未填 / 待复核 / 阻塞 / 证据冲突
    const openQuestions: string[] = []
    if (!task.conclusion?.trim()) openQuestions.push('人工结论未填写')
    if (task.status === 'IN_REVIEW') openQuestions.push('结论待复核确认')
    if (task.status === 'BLOCKED') openQuestions.push('模块阻塞（缺资料或待外部反馈），详见结论说明')
    if (conflict.length > 0) openQuestions.push(`存在 ${conflict.length} 条冲突证据待人工裁决`)

    return {
      moduleKey: task.moduleKey,
      name: tpl?.name || task.moduleKey,
      coreQuestion: tpl?.coreQuestion || '',
      inputs: tpl?.inputs || '',
      suggestedOwnerRole: tpl?.ownerRole || '',
      status: task.status,
      redFlagLevel: task.redFlagLevel,
      conclusion: task.conclusion,
      owner: task.owner || null,
      supportingEvidence: supporting,
      pendingEvidence: pending,
      conflictEvidence: conflict,
      openQuestions,
    }
  })

  const count = (s: string) => tasks.filter(t => t.status === s).length
  const total = tasks.length
  const done = count('DONE')

  const redFlags = modules
    .filter(m => m.redFlagLevel !== 'NONE')
    .sort((a, b) => (a.redFlagLevel === 'HIGH' ? -1 : 1) - (b.redFlagLevel === 'HIGH' ? -1 : 1))
    .map(m => ({ moduleKey: m.moduleKey, name: m.name, level: m.redFlagLevel, conclusion: m.conclusion }))

  const pendingItems = modules
    .filter(m => m.status !== 'DONE')
    .map(m => ({
      moduleKey: m.moduleKey,
      name: m.name,
      status: m.status,
      reason: m.status === 'BLOCKED'
        ? '阻塞中：需补充资料或等待外部反馈'
        : m.status === 'IN_REVIEW'
          ? '结论待复核'
          : m.status === 'IN_PROGRESS'
            ? '分析进行中'
            : '尚未启动',
    }))

  return {
    batch: {
      id: batch.id,
      round: batch.round,
      templateVersion: batch.templateVersion,
      status: batch.status,
      dueDate: batch.dueDate?.toISOString() || null,
      createdAt: batch.createdAt.toISOString(),
    },
    project,
    generatedAt: new Date().toISOString(),
    progress: {
      total,
      done,
      inReview: count('IN_REVIEW'),
      inProgress: count('IN_PROGRESS'),
      blocked: count('BLOCKED'),
      pending: count('PENDING'),
      completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
    },
    modules,
    redFlags,
    pendingItems,
    evidenceIndex: sorted.map(toView),
  }
}

/** 证据来源展示文案（导出与前端共用） */
export function evidenceSourceText(e: ReportEvidenceView): string {
  const label = e.sourceLabel || (e.sourceType === 'DOCUMENT' ? '项目资料' : e.sourceType === 'WEB' ? '外部链接' : '访谈口述')
  const loc = e.location ? `（${e.location}）` : ''
  const url = e.sourceUrl ? ` ${e.sourceUrl}` : ''
  return `${label}${loc}${url}`
}

/**
 * 整包报告 → Markdown（导出下载用）
 * 排版原则：结论先行、表格优先、已确认/待核验/冲突区分、引用编号
 */
export function fullPackageToMarkdown(pkg: AssembledFullPackage): string {
  const L: string[] = []
  const p = pkg.project

  L.push(`# ${p.name} 尽调报告（整包）`)
  L.push('')
  L.push(`- 公司全称：${p.companyFullName || '—'}`)
  L.push(`- 行业：${p.industry || '—'} · 融资轮次：${p.financingRound || pkg.batch.round || '—'}`)
  L.push(`- 融资金额：${p.totalAmount || '—'} · 投资估值：${p.investmentValuation != null ? `${p.investmentValuation} 亿` : '—'}`)
  L.push(`- 尽调批次：${pkg.batch.round || '默认批次'}（模板 ${pkg.batch.templateVersion}）`)
  L.push(`- 完成度：${pkg.progress.done}/${pkg.progress.total}（${pkg.progress.completionRate}%）`)
  L.push(`- 报告生成时间：${pkg.generatedAt}`)

  if (pkg.redFlags.length > 0) {
    L.push('')
    L.push('## ⚑ 风险红旗')
    L.push('')
    L.push('| 模块 | 级别 | 结论 |')
    L.push('| --- | --- | --- |')
    for (const f of pkg.redFlags) {
      L.push(`| ${f.name} | ${f.level === 'HIGH' ? '高' : '中'} | ${(f.conclusion || '—').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
    }
  }

  for (const m of pkg.modules) {
    L.push('')
    L.push(`## ${m.name}`)
    L.push('')
    if (m.coreQuestion) L.push(`> 核心问题：${m.coreQuestion}`)
    L.push('')
    L.push(`**结论**：${m.conclusion?.trim() || '（未填写）'}`)
    if (m.owner?.name) L.push(`- 负责人：${m.owner.name}（建议责任：${m.suggestedOwnerRole || '—'}）`)
    L.push(`- 状态：${m.status} · 红旗：${m.redFlagLevel}`)

    if (m.supportingEvidence.length > 0) {
      L.push('')
      L.push('**支撑证据（已确认）**：')
      for (const e of m.supportingEvidence) {
        L.push(`- [${e.ref}] ${evidenceSourceText(e)}（${e.grade} 级）：“${e.excerpt}”`)
      }
    }
    if (m.conflictEvidence.length > 0) {
      L.push('')
      L.push('**⚠ 存在冲突的证据（待人工裁决）**：')
      for (const e of m.conflictEvidence) {
        L.push(`- [${e.ref}] ${evidenceSourceText(e)}（${e.grade} 级）：“${e.excerpt}”`)
      }
    }
    if (m.pendingEvidence.length > 0) {
      L.push('')
      L.push('**待核验（附录，不作为结论支撑）**：')
      for (const e of m.pendingEvidence) {
        L.push(`- [${e.ref}] ${evidenceSourceText(e)}（${e.grade} 级）：“${e.excerpt}”`)
      }
    }
    if (m.openQuestions.length > 0) {
      L.push('')
      L.push(`**未决问题**：${m.openQuestions.join('；')}`)
    }
  }

  if (pkg.pendingItems.length > 0) {
    L.push('')
    L.push('## 附录：缺口清单（未完成模块）')
    L.push('')
    L.push('| 模块 | 状态 | 说明 |')
    L.push('| --- | --- | --- |')
    for (const it of pkg.pendingItems) {
      L.push(`| ${it.name} | ${it.status} | ${it.reason} |`)
    }
  }

  L.push('')
  L.push('---')
  L.push(`*证据等级：A 原始或权威 / B 一手陈述 / C 可信二手 / D 待核验。D 级仅进附录，不支撑关键结论。*`)
  return L.join('\n')
}

export { getTemplateModule }
