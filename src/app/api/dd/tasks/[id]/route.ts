export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import {
  isDDTaskStatus,
  isDDRedFlagLevel,
  DD_TASK_TRANSITIONS,
  REPORT_SUPPORTED_GRADES,
} from '@/lib/dd-workbench/constants'
import { loadBatchContext, UNAUTHORIZED_BODY } from '@/lib/dd-workbench/guards'

/**
 * PATCH /api/dd/tasks/[id]
 * 更新模块任务：结论 / AI 草稿 / 状态 / 负责人 / 红旗
 *
 * 完成校验（证据链规则，文档 §4）：
 * 任务置 DONE 必须同时满足——
 * 1. 结论非空（不以"有文字"替代"完成"，结论是人工判断）
 * 2. 至少一条已确认（CONFIRMED）且等级 A/B/C 的证据支撑
 *    （D 待核验不得支撑关键结论）
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(UNAUTHORIZED_BODY, { status: 401 })
    }
    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const task = await prisma.dDTask.findUnique({
      where: { id: params.id },
      select: { id: true, batchId: true, status: true, conclusion: true },
    })
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    const ctx = await loadBatchContext(task.batchId, currentUser, 'edit')
    if (ctx === null) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    if (ctx === 'FORBIDDEN') return NextResponse.json({ error: '无权操作该任务' }, { status: 403 })
    if (ctx.batch.status === 'FROZEN') {
      return NextResponse.json({ error: '批次已冻结，任务不可修改' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const data: {
      conclusion?: string | null
      aiDraft?: string | null
      status?: string
      ownerId?: string | null
      redFlagLevel?: string
    } = {}

    if (body.conclusion !== undefined) {
      if (body.conclusion !== null && typeof body.conclusion !== 'string') {
        return NextResponse.json({ error: '结论必须为字符串' }, { status: 400 })
      }
      data.conclusion = body.conclusion
    }
    if (body.aiDraft !== undefined) {
      if (body.aiDraft !== null && typeof body.aiDraft !== 'string') {
        return NextResponse.json({ error: 'AI 草稿必须为字符串' }, { status: 400 })
      }
      data.aiDraft = body.aiDraft
    }
    if (body.redFlagLevel !== undefined) {
      if (typeof body.redFlagLevel !== 'string' || !isDDRedFlagLevel(body.redFlagLevel)) {
        return NextResponse.json({ error: '无效的红旗级别（NONE/MEDIUM/HIGH）' }, { status: 400 })
      }
      data.redFlagLevel = body.redFlagLevel
    }
    if (body.ownerId !== undefined) {
      if (body.ownerId === null || body.ownerId === '') {
        data.ownerId = null
      } else {
        if (typeof body.ownerId !== 'string') {
          return NextResponse.json({ error: '无效的负责人' }, { status: 400 })
        }
        const owner = await prisma.user.findUnique({
          where: { id: body.ownerId },
          select: { id: true, status: true },
        })
        if (!owner || owner.status !== 'ACTIVE') {
          return NextResponse.json({ error: '负责人不存在或不可用' }, { status: 400 })
        }
        data.ownerId = body.ownerId
      }
    }

    // 状态流转校验
    let targetStatus: string | null = null
    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !isDDTaskStatus(body.status)) {
        return NextResponse.json({ error: '无效的任务状态' }, { status: 400 })
      }
      if (body.status !== task.status) {
        const allowed = DD_TASK_TRANSITIONS[task.status as keyof typeof DD_TASK_TRANSITIONS] || []
        if (!allowed.includes(body.status as never)) {
          return NextResponse.json(
            { error: `任务状态不允许从 ${task.status} 变更为 ${body.status}` },
            { status: 400 }
          )
        }
      }
      targetStatus = body.status
      data.status = body.status
    }

    // 完成校验：结论非空 + 至少一条已确认的 A/B/C 证据
    if (targetStatus === 'DONE') {
      const finalConclusion = data.conclusion !== undefined ? data.conclusion : task.conclusion
      if (!finalConclusion || !String(finalConclusion).trim()) {
        return NextResponse.json(
          { error: '任务完成需要先填写人工结论' },
          { status: 400 }
        )
      }
      const supporting = await prisma.dDEvidence.count({
        where: {
          taskId: task.id,
          status: 'CONFIRMED',
          grade: { in: REPORT_SUPPORTED_GRADES },
        },
      })
      if (supporting === 0) {
        return NextResponse.json(
          { error: '任务完成需要至少一条已确认（A/B/C 级）证据支撑；D 级待核验证据不可支撑结论' },
          { status: 400 }
        )
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '无可更新的字段' }, { status: 400 })
    }

    const updated = await prisma.dDTask.update({
      where: { id: task.id },
      data,
      include: {
        owner: { select: { id: true, name: true, avatar: true } },
        _count: { select: { evidences: true } },
      },
    })

    return NextResponse.json({
      task: {
        id: updated.id,
        batchId: updated.batchId,
        moduleKey: updated.moduleKey,
        status: updated.status,
        conclusion: updated.conclusion,
        aiDraft: updated.aiDraft,
        ownerId: updated.ownerId,
        owner: updated.owner,
        redFlagLevel: updated.redFlagLevel,
        sortKey: updated.sortKey,
        evidenceCount: updated._count.evidences,
        updatedAt: updated.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('DD task update error:', error)
    return NextResponse.json({ error: '更新任务失败' }, { status: 500 })
  }
}
