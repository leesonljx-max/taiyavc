export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { isDDBatchStatus } from '@/lib/dd-workbench/constants'
import { loadBatchContext, UNAUTHORIZED_BODY } from '@/lib/dd-workbench/guards'

/**
 * GET /api/dd/batches/[id]
 * 批次详情：九大模块任务（含模板定义、负责人、证据计数）+ 报告版本列表
 */
export async function GET(
  _request: Request,
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

    const ctx = await loadBatchContext(params.id, currentUser, 'view')
    if (ctx === null) return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    if (ctx === 'FORBIDDEN') return NextResponse.json({ error: '无权查看该批次' }, { status: 403 })

    const batch = await prisma.dDBatch.findUnique({
      where: { id: params.id },
      include: {
        tasks: {
          orderBy: { sortKey: 'asc' },
          include: {
            owner: { select: { id: true, name: true, avatar: true } },
          },
        },
        reportVersions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            reportType: true,
            moduleKey: true,
            version: true,
            frozenAt: true,
            frozenBy: { select: { id: true, name: true } },
          },
        },
        initiatedBy: { select: { id: true, name: true } },
      },
    })

    if (!batch) return NextResponse.json({ error: '批次不存在' }, { status: 404 })

    // 按任务聚合证据状态计数（驱动模块卡四段进度：资料→抽取→复核→冻结）
    const evidenceAgg = await prisma.dDEvidence.groupBy({
      by: ['taskId', 'status', 'grade'],
      where: { batchId: params.id },
      _count: { _all: true },
    })
    const evStats = new Map<string, { total: number; confirmed: number; conflict: number; pending: number }>()
    for (const row of evidenceAgg) {
      const s = evStats.get(row.taskId) || { total: 0, confirmed: 0, conflict: 0, pending: 0 }
      const n = row._count._all
      s.total += n
      if (row.status === 'CONFIRMED' && ['A', 'B', 'C'].includes(row.grade)) s.confirmed += n
      else if (row.status === 'CONFLICT') s.conflict += n // 冲突含降级待裁决
      else s.pending += n // PENDING 确认态 / D 级 / 冲突外的待核验
      evStats.set(row.taskId, s)
    }

    return NextResponse.json({
      batch: {
        id: batch.id,
        projectId: batch.projectId,
        project: ctx.project,
        round: batch.round,
        templateVersion: batch.templateVersion,
        status: batch.status,
        dueDate: batch.dueDate?.toISOString() || null,
        createdAt: batch.createdAt.toISOString(),
        updatedAt: batch.updatedAt.toISOString(),
        initiatedBy: batch.initiatedBy,
        tasks: batch.tasks.map(t => {
          const ev = evStats.get(t.id) || { total: 0, confirmed: 0, conflict: 0, pending: 0 }
          return {
            id: t.id,
            moduleKey: t.moduleKey,
            status: t.status,
            conclusion: t.conclusion,
            aiDraft: t.aiDraft,
            ownerId: t.ownerId,
            owner: t.owner,
            redFlagLevel: t.redFlagLevel,
            sortKey: t.sortKey,
            evidenceCount: ev.total,
            confirmedEvidenceCount: ev.confirmed,
            conflictEvidenceCount: ev.conflict,
            pendingEvidenceCount: ev.pending,
            updatedAt: t.updatedAt.toISOString(),
          }
        }),
        reportVersions: batch.reportVersions,
      },
    })
  } catch (error) {
    console.error('DD batch detail error:', error)
    return NextResponse.json({ error: '获取批次详情失败' }, { status: 500 })
  }
}

/**
 * PATCH /api/dd/batches/[id]
 * 更新批次：round / dueDate / 状态流转
 * 状态规则：IN_PROGRESS ↔ IN_REVIEW（提请复核/打回）；
 * FROZEN 只能通过 POST /api/dd/batches/[id]/freeze 生成报告快照后进入，此处不接受。
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

    const ctx = await loadBatchContext(params.id, currentUser, 'edit')
    if (ctx === null) return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    if (ctx === 'FORBIDDEN') return NextResponse.json({ error: '无权操作该批次' }, { status: 403 })

    // 冻结批次不可再编辑（快照已固化，如需修改发起新批次）
    if (ctx.batch.status === 'FROZEN') {
      return NextResponse.json({ error: '批次已冻结，不可修改；如需更新尽调请发起新批次' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const data: { round?: string | null; dueDate?: Date | null; status?: string } = {}

    if (body.round !== undefined) {
      data.round = typeof body.round === 'string' && body.round.trim() ? body.round.trim() : null
    }
    if (body.dueDate !== undefined) {
      if (body.dueDate === null || body.dueDate === '') {
        data.dueDate = null
      } else {
        const d = new Date(body.dueDate)
        if (isNaN(d.getTime())) {
          return NextResponse.json({ error: '截止日格式无效（需完整 ISO-8601）' }, { status: 400 })
        }
        data.dueDate = d
      }
    }

    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !isDDBatchStatus(body.status)) {
        return NextResponse.json({ error: '无效的批次状态' }, { status: 400 })
      }
      if (body.status === 'FROZEN') {
        return NextResponse.json(
          { error: '冻结请使用报告中心的冻结操作（生成版本快照）' },
          { status: 400 }
        )
      }
      // 仅允许 IN_PROGRESS ↔ IN_REVIEW 双向流转
      const allowed: Record<string, string[]> = {
        IN_PROGRESS: ['IN_REVIEW'],
        IN_REVIEW: ['IN_PROGRESS'],
      }
      if (!allowed[ctx.batch.status]?.includes(body.status)) {
        return NextResponse.json(
          { error: `批次状态不允许从 ${ctx.batch.status} 变更为 ${body.status}` },
          { status: 400 }
        )
      }
      data.status = body.status
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '无可更新的字段' }, { status: 400 })
    }

    const updated = await prisma.dDBatch.update({
      where: { id: params.id },
      data,
    })

    return NextResponse.json({
      batch: { id: updated.id, status: updated.status, round: updated.round, dueDate: updated.dueDate?.toISOString() || null },
    })
  } catch (error) {
    console.error('DD batch update error:', error)
    return NextResponse.json({ error: '更新批次失败' }, { status: 500 })
  }
}
