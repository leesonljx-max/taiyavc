/**
 * 尽调 Harness Runner（编排器）
 *
 * 流程：
 * ① 尽调框架生成：读取项目行业/定位/融资历史 → 定制化尽调清单（强制含 7 大必选模块）
 * ② 并行模块分析：每个模块一个子Agent（读项目资料 + web_search 联网补充 + 引用溯源）
 * ③ 汇总缺口清单（INSUFFICIENT_DATA 模块 → 通知维护人补充资料）
 * ④ 增量重跑：inputHash 未变且已完成的模块自动跳过
 *
 * 触发方式：
 * - 项目进入「尽调」阶段自动触发（stage-change 审批通过后）
 * - 维护人手动触发（POST /api/research/[projectId]/dd）
 */

import prisma from '@/lib/prisma'
import type { DDFramework, FrameworkGenOutput, FrameworkModule, ModuleAnalysisOutput } from './types'
import {
  buildFramework,
  computeInputHash,
  filterCitations,
  aggregateGaps,
  needsAnalysis,
} from './framework'
import { runAgent, runSingleCall, parseAgentJson } from './agent'
import { ddTools } from './tools'
import {
  FRAMEWORK_SYSTEM_PROMPT,
  frameworkUserPrompt,
  moduleSystemPrompt,
  moduleUserPrompt,
} from './prompts'

// ── 常量 ──

/** 子Agent 并行度（避免 API 限流） */
const CONCURRENCY = 2
/** 模块上下文中投研分析内容截断长度 */
const RESEARCH_CONTENT_LIMIT = 4000
/** 模块上下文中文档提取文本总截断长度 */
const DOC_TEXT_LIMIT = 6000

/** 正在运行的项目（进程内防重入） */
const runningProjects = new Set<string>()

// ── 数据加载 ──

interface DDContext {
  project: {
    id: string
    name: string
    companyFullName: string | null
    industry: string | null
    companyPosition: string | null
    mainProducts: string | null
    coreAdvantage: string | null
    coreTeam: string | null
    financialData: string | null
    orderProgress: string | null
    competitors: string | null
    financingPlan: string | null
    financingRound: string | null
    followStage: string
    totalAmount: string
    raisedAmount: string
    targetDate: Date
  }
  researchModules: Array<{
    moduleType: string
    content: string | null
    aiJson: string | null
    aiSummary: string | null
    documents: Array<{ fileName: string; extractedText: string | null }>
  }>
}

async function loadContext(projectId: string): Promise<DDContext | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true, name: true, companyFullName: true, industry: true, companyPosition: true,
      mainProducts: true, coreAdvantage: true, coreTeam: true, financialData: true,
      orderProgress: true, competitors: true, financingPlan: true, financingRound: true,
      followStage: true, totalAmount: true, raisedAmount: true, targetDate: true,
    },
  })
  if (!project) return null

  const researchModules = await prisma.researchModule.findMany({
    where: { projectId },
    select: {
      moduleType: true, content: true, aiJson: true, aiSummary: true,
      documents: { select: { fileName: true, extractedText: true } },
    },
  })

  return { project, researchModules }
}

// ── 模块输入构建 ──

function projectSummary(ctx: DDContext): string {
  const p = ctx.project
  return [
    `项目名称：${p.name}`,
    p.companyFullName ? `公司全称：${p.companyFullName}` : null,
    p.industry ? `所处行业：${p.industry}` : null,
    p.companyPosition ? `公司定位：${p.companyPosition}` : null,
    p.financingRound ? `融资轮次：${p.financingRound}` : null,
    `本轮融资额：${p.totalAmount}`,
    p.raisedAmount ? `历史累计融资：${p.raisedAmount}` : null,
    `当前阶段：${p.followStage}`,
    `初聊日期：${p.targetDate.toISOString().split('T')[0]}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function fieldValue(ctx: DDContext, module: FrameworkModule): string {
  if (!module.projectField) return ''
  const v = (ctx.project as unknown as Record<string, unknown>)[module.projectField]
  return typeof v === 'string' ? v : ''
}

function researchContent(ctx: DDContext, module: FrameworkModule): string {
  const parts: string[] = []
  for (const type of module.researchModuleTypes) {
    const m = ctx.researchModules.find(rm => rm.moduleType === type)
    if (!m) continue
    const chunks: string[] = [`◆ ${type}`]
    if (m.aiSummary) chunks.push(`AI摘要：${m.aiSummary}`)
    if (m.content) chunks.push(`手动内容：${m.content.substring(0, 1200)}`)
    if (m.aiJson) {
      // aiJson 可能很长，只取前若干字段值
      try {
        const parsed = JSON.parse(m.aiJson)
        const brief = Object.entries(parsed)
          .slice(0, 8)
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.substring(0, 200) : JSON.stringify(v).substring(0, 200)}`)
          .join('\n')
        if (brief) chunks.push(`AI分析：${brief}`)
      } catch { /* 忽略解析失败 */ }
    }
    parts.push(chunks.join('\n'))
  }
  return parts.join('\n\n').substring(0, RESEARCH_CONTENT_LIMIT)
}

function documentText(ctx: DDContext, module: FrameworkModule): string {
  const parts: string[] = []
  for (const type of module.researchModuleTypes) {
    const m = ctx.researchModules.find(rm => rm.moduleType === type)
    if (!m) continue
    for (const d of m.documents) {
      if (!d.extractedText) continue
      parts.push(`--- ${d.fileName} ---\n${d.extractedText}`)
    }
  }
  return parts.join('\n\n').substring(0, DOC_TEXT_LIMIT)
}

// ── 框架生成 ──

async function generateFramework(ctx: DDContext): Promise<DDFramework> {
  const projectInfo = {
    name: ctx.project.name,
    companyFullName: ctx.project.companyFullName,
    industry: ctx.project.industry,
    companyPosition: ctx.project.companyPosition,
    financingRound: ctx.project.financingRound,
    totalAmount: ctx.project.totalAmount,
    raisedAmount: ctx.project.raisedAmount,
    mainProducts: ctx.project.mainProducts?.substring(0, 300),
    coreAdvantage: ctx.project.coreAdvantage?.substring(0, 300),
  }

  const content = await runSingleCall(
    FRAMEWORK_SYSTEM_PROMPT,
    frameworkUserPrompt(projectInfo)
  )
  const gen = parseAgentJson<FrameworkGenOutput>(content)
  return buildFramework(gen)
}

// ── 单模块分析（子Agent） ──

async function analyzeModule(
  ctx: DDContext,
  module: FrameworkModule,
  inputHash: string
): Promise<{ output: ModuleAnalysisOutput | null; error?: string }> {
  const summary = projectSummary(ctx)
  const value = fieldValue(ctx, module)
  const rContent = researchContent(ctx, module)
  const dText = documentText(ctx, module)

  try {
    const { content, sessionLog } = await runAgent({
      systemPrompt: moduleSystemPrompt(module.name, module.focus),
      userPrompt: moduleUserPrompt({
        moduleName: module.name,
        focus: module.focus,
        projectSummary: summary,
        fieldValue: value,
        researchContent: rContent,
        documentText: dText,
      }),
      tools: ddTools(),
      maxTurns: 4,
    })

    const parsed = parseAgentJson<ModuleAnalysisOutput>(content)
    if (!parsed || !parsed.conclusion) {
      return { output: null, error: '子Agent输出无法解析为有效结论' }
    }

    // 引用交叉验证：只保留真实出现在 web_search 会话日志中的 URL
    const citations = filterCitations(parsed.citations, sessionLog.searchedUrls())

    return {
      output: {
        status: parsed.status === 'INSUFFICIENT_DATA' ? 'INSUFFICIENT_DATA' : 'COMPLETED',
        conclusion: parsed.conclusion.substring(0, 3000),
        citations,
        missing: parsed.missing?.substring(0, 300),
      },
    }
  } catch (e) {
    return { output: null, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── 并发池 ──

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (item === undefined) break
      await fn(item)
    }
  })
  await Promise.all(workers)
}

// ── 主入口 ──

export interface RunDDOptions {
  /** 强制重跑全部模块（含重新生成框架） */
  force?: boolean
  /** 只重跑指定模块 */
  moduleKeys?: string[]
  /** 触发来源（记录用） */
  triggeredBy?: string
}

export interface RunDDResult {
  reportId: string
  totalModules: number
  analyzed: number
  skipped: number
  failed: number
  gaps: number
}

/**
 * 执行尽调分析（同步等待完成；调用方可后台触发）
 */
export async function runDueDiligence(
  projectId: string,
  opts: RunDDOptions = {}
): Promise<RunDDResult> {
  if (runningProjects.has(projectId)) {
    throw new Error('该项目尽调分析正在运行中，请稍后再试')
  }
  runningProjects.add(projectId)

  try {
    const ctx = await loadContext(projectId)
    if (!ctx) throw new Error('项目不存在')

    // ── ① 框架：获取/生成 ──
    let report = await prisma.dDReport.findUnique({
      where: { projectId },
      include: { moduleResults: true },
    })

    let framework: DDFramework
    const needRegen = !report || !report.frameworkJson || opts.force
    if (needRegen) {
      framework = await generateFramework(ctx)
    } else if (report?.frameworkJson) {
      framework = JSON.parse(report.frameworkJson) as DDFramework
      if (!Array.isArray(framework?.modules) || framework.modules.length === 0) {
        framework = await generateFramework(ctx)
      }
    } else {
      framework = await generateFramework(ctx)
    }

    // 报告 upsert + 状态 RUNNING
    if (!report) {
      report = await prisma.dDReport.create({
        data: {
          projectId,
          frameworkJson: JSON.stringify(framework),
          status: 'RUNNING',
          lastRunAt: new Date(),
        },
        include: { moduleResults: true },
      })
    } else {
      report = await prisma.dDReport.update({
        where: { id: report.id },
        data: {
          frameworkJson: JSON.stringify(framework),
          status: 'RUNNING',
          lastRunAt: new Date(),
          error: null,
        },
        include: { moduleResults: true },
      })
    }

    // ── 模块行 upsert（保留历史结果以支持增量） ──
    const existingByKey = new Map(report.moduleResults.map(r => [r.moduleKey, r]))
    for (const m of framework.modules) {
      if (!existingByKey.has(m.key)) {
        const created = await prisma.dDModuleResult.create({
          data: {
            reportId: report.id,
            moduleKey: m.key,
            moduleName: m.name,
            required: m.required,
            status: 'PENDING',
          },
        })
        existingByKey.set(m.key, created)
      } else if (needRegen) {
        // 框架重生成时同步模块名/关注点变化
        await prisma.dDModuleResult.update({
          where: { id: existingByKey.get(m.key)!.id },
          data: { moduleName: m.name, required: m.required },
        })
      }
    }

    // ── ② 计算输入指纹，确定待分析模块（增量重跑） ──
    interface PendingModule {
      module: FrameworkModule
      resultId: string
      inputHash: string
    }
    const pending: PendingModule[] = []
    let skipped = 0

    for (const m of framework.modules) {
      const existing = existingByKey.get(m.key)
      if (!existing) continue

      const inputHash = computeInputHash({
        field: fieldValue(ctx, m),
        research: researchContent(ctx, m),
        docs: documentText(ctx, m),
        focus: m.focus,
      })

      // 指定模块强制重跑；否则增量判断
      const forced = opts.moduleKeys?.includes(m.key) || opts.force
      if (!forced && !needsAnalysis(existing, inputHash)) {
        skipped++
        continue
      }
      pending.push({ module: m, resultId: existing.id, inputHash })
    }

    // ── 并行子Agent分析 ──
    let failed = 0
    await runPool(pending, CONCURRENCY, async ({ module, resultId, inputHash }) => {
      await prisma.dDModuleResult.update({
        where: { id: resultId },
        data: { status: 'RUNNING', error: null },
      })

      const { output, error } = await analyzeModule(ctx, module, inputHash)

      if (output) {
        await prisma.dDModuleResult.update({
          where: { id: resultId },
          data: {
            status: output.status,
            conclusion: output.conclusion,
            citationsJson: JSON.stringify(output.citations),
            missing: output.status === 'INSUFFICIENT_DATA' ? (output.missing || null) : null,
            inputHash,
            analyzedAt: new Date(),
            error: null,
          },
        })
      } else {
        failed++
        await prisma.dDModuleResult.update({
          where: { id: resultId },
          data: {
            status: 'FAILED',
            inputHash,
            analyzedAt: new Date(),
            error: (error || '未知错误').substring(0, 500),
          },
        })
      }
    })

    // ── ③ 汇总缺口清单 ──
    const finalResults = await prisma.dDModuleResult.findMany({
      where: { reportId: report.id },
    })
    const gaps = aggregateGaps(finalResults)

    await prisma.dDReport.update({
      where: { id: report.id },
      data: {
        status: 'COMPLETED',
        gapsJson: JSON.stringify(gaps),
      },
    })

    return {
      reportId: report.id,
      totalModules: framework.modules.length,
      analyzed: pending.length,
      skipped,
      failed,
      gaps: gaps.length,
    }
  } finally {
    runningProjects.delete(projectId)
  }
}

/**
 * 阶段变更触发：项目进入「尽调」阶段时后台自动分析（不阻塞审批请求）
 */
export function triggerDueDiligenceOnStage(
  projectId: string,
  newStage: string,
  triggeredBy?: string
): void {
  if (newStage !== 'DUE_DILIGENCE') return
  // 后台执行，不 await；错误仅记录日志
  void runDueDiligence(projectId, { triggeredBy })
    .then(r => {
      console.log(
        `[DD Harness] 项目 ${projectId} 尽调分析完成: ` +
          `共${r.totalModules}模块, 分析${r.analyzed}, 跳过${r.skipped}, 失败${r.failed}, 缺口${r.gaps}`
      )
    })
    .catch(e => {
      console.error(`[DD Harness] 项目 ${projectId} 尽调分析失败:`, e instanceof Error ? e.message : e)
    })
}

/**
 * 查询尽调报告（API 用）
 */
export async function getDDReport(projectId: string) {
  const report = await prisma.dDReport.findUnique({
    where: { projectId },
    include: {
      moduleResults: {
        orderBy: [{ required: 'desc' }, { createdAt: 'asc' }],
      },
    },
  })
  if (!report) return null

  return {
    id: report.id,
    projectId: report.projectId,
    status: report.status,
    framework: report.frameworkJson ? (JSON.parse(report.frameworkJson) as DDFramework) : null,
    gaps: report.gapsJson ? JSON.parse(report.gapsJson) : [],
    lastRunAt: report.lastRunAt,
    error: report.error,
    modules: report.moduleResults.map(m => ({
      id: m.id,
      moduleKey: m.moduleKey,
      moduleName: m.moduleName,
      required: m.required,
      status: m.status,
      conclusion: m.conclusion,
      citations: m.citationsJson ? JSON.parse(m.citationsJson) : [],
      missing: m.missing,
      analyzedAt: m.analyzedAt,
      error: m.error,
    })),
  }
}

/** 项目是否正在尽调分析中（API 轮询用） */
export function isDDRunning(projectId: string): boolean {
  return runningProjects.has(projectId)
}
