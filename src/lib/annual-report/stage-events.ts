/**
 * 项目阶段事件：写入与历史回填
 *
 * 年度报告的月度分布、年度进入数、年末存量都依赖「何时进入某阶段」。
 * 现有 Project.passedStages 只能判断「是否经过」，stageChangedAt 只保留最后一次，
 * 因此新增 ProjectStageEvent 作为时间线基础。
 */

import prisma from '@/lib/prisma'
import { parsePassedStages } from '@/lib/stage-utils'
import type { FollowStage } from '@/app/projects/types'

export type StageEventSource = 'SYSTEM' | 'APPROVAL' | 'BACKFILL' | 'MANUAL'
export type StageEventPrecision = 'DAY' | 'MONTH' | 'UNKNOWN'

interface RecordStageEventInput {
  projectId: string
  fromStage?: string | null
  toStage: string
  occurredAt?: Date | null
  precision?: StageEventPrecision
  source?: StageEventSource
  actorId?: string | null
  requestId?: string | null
  note?: string | null
}

/** 写入一条阶段事件（幂等：同项目 + 同阶段 + 同时间只保留一条） */
export async function recordStageEvent(input: RecordStageEventInput): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date()
  const precision = input.precision ?? 'DAY'

  const existing = await prisma.projectStageEvent.findFirst({
    where: {
      projectId: input.projectId,
      toStage: input.toStage,
      ...(precision === 'UNKNOWN'
        ? { occurredAt: null }
        : { occurredAt: { gte: new Date(occurredAt.getTime() - 1000), lte: new Date(occurredAt.getTime() + 1000) } }),
    },
    select: { id: true },
  })
  if (existing) return

  await prisma.projectStageEvent.create({
    data: {
      projectId: input.projectId,
      fromStage: input.fromStage ?? null,
      toStage: input.toStage,
      occurredAt: precision === 'UNKNOWN' ? null : occurredAt,
      precision,
      source: input.source ?? 'SYSTEM',
      actorId: input.actorId ?? null,
      requestId: input.requestId ?? null,
      note: input.note ?? null,
    },
  })
}

let backfillPromise: Promise<void> | null = null

/**
 * 历史回填（进程内只执行一次）
 * - 每个项目补 INITIAL_TALK（targetDate = 初聊日期）
 * - 已审批的阶段变更按 reviewedAt 补 APPROVAL
 * - 当前阶段按 stageChangedAt 补 BACKFILL
 * - passedStages 中其余阶段补 UNKNOWN（只进漏斗，不进月度）
 */
export async function backfillStageEvents(): Promise<void> {
  if (!backfillPromise) {
    backfillPromise = doBackfill().catch(error => {
      backfillPromise = null
      throw error
    })
  }
  return backfillPromise
}

async function doBackfill(): Promise<void> {
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      targetDate: true,
      createdAt: true,
      followStage: true,
      passedStages: true,
      stageChangedAt: true,
      stageEvents: { select: { toStage: true, occurredAt: true } },
      stageChangeRequests: {
        where: { status: 'APPROVED' },
        select: { id: true, fromStage: true, toStage: true, reviewedAt: true },
      },
    },
  })

  type Row = {
    projectId: string
    fromStage: string | null
    toStage: string
    occurredAt: Date | null
    precision: StageEventPrecision
    source: StageEventSource
    requestId: string | null
  }
  const rows: Row[] = []

  for (const project of projects) {
    const seen: Array<{ toStage: string; occurredAt: Date | null }> = [...project.stageEvents]

    const has = (toStage: string, occurredAt: Date | null) =>
      seen.some(e =>
        e.toStage === toStage &&
        (occurredAt === null
          ? e.occurredAt === null
          : e.occurredAt !== null && Math.abs(e.occurredAt.getTime() - occurredAt.getTime()) < 1000)
      )

    const push = (row: Row) => {
      if (has(row.toStage, row.occurredAt)) return
      rows.push(row)
      seen.push({ toStage: row.toStage, occurredAt: row.occurredAt })
    }

    // 1) 初聊：以 targetDate（初聊日期）为准
    push({
      projectId: project.id,
      fromStage: null,
      toStage: 'INITIAL_TALK',
      occurredAt: project.targetDate ?? project.createdAt,
      precision: 'DAY',
      source: 'BACKFILL',
      requestId: null,
    })

    // 2) 已审批的阶段变更：优先使用审批时间
    for (const request of project.stageChangeRequests) {
      if (!request.reviewedAt) continue
      push({
        projectId: project.id,
        fromStage: request.fromStage,
        toStage: request.toStage,
        occurredAt: request.reviewedAt,
        precision: 'DAY',
        source: 'BACKFILL',
        requestId: request.id,
      })
    }

    // 3) 当前阶段：使用最近一次变更时间
    if (project.followStage !== 'INITIAL_TALK' && project.stageChangedAt) {
      push({
        projectId: project.id,
        fromStage: null,
        toStage: project.followStage,
        occurredAt: project.stageChangedAt,
        precision: 'DAY',
        source: 'BACKFILL',
        requestId: null,
      })
    }

    // 4) passedStages 中其余阶段：日期不可知，只参与漏斗计数
    const passed = parsePassedStages(project.passedStages) as FollowStage[]
    for (const stage of passed) {
      if (stage === 'INITIAL_TALK') continue
      if (stage === project.followStage && project.stageChangedAt) continue
      if (project.stageChangeRequests.some(r => r.toStage === stage && r.reviewedAt)) continue
      push({
        projectId: project.id,
        fromStage: null,
        toStage: stage,
        occurredAt: null,
        precision: 'UNKNOWN',
        source: 'BACKFILL',
        requestId: null,
      })
    }
  }

  if (rows.length > 0) {
    // 分批写入，避免单条 SQL 参数过多
    const CHUNK = 200
    for (let i = 0; i < rows.length; i += CHUNK) {
      await prisma.projectStageEvent.createMany({ data: rows.slice(i, i + CHUNK) })
    }
  }

  console.log(`[annual-report] 阶段事件回填完成：${rows.length} 条`)
}
