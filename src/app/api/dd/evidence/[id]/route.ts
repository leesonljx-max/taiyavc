export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { isDDEvidenceStatus, type DDEvidenceStatus } from '@/lib/dd-workbench/constants'
import { loadBatchContext, UNAUTHORIZED_BODY } from '@/lib/dd-workbench/guards'

/** 证据状态流转（人工复核留痕；冲突不静默覆盖，需人工裁决） */
const EVIDENCE_TRANSITIONS: Record<DDEvidenceStatus, DDEvidenceStatus[]> = {
  PENDING: ['CONFIRMED', 'CONFLICT'],
  CONFIRMED: ['CONFLICT', 'PENDING'], // 已确认后发现冲突 → 标记冲突；误确认 → 重开
  CONFLICT: ['PENDING', 'CONFIRMED'], // 裁决后重新确认或回到待确认
}

/**
 * PATCH /api/dd/evidence/[id]
 * 证据复核：确认 / 标记冲突 / 重开；补充 note / sourceLabel / location
 * body: { status?, note?, sourceLabel?, location? }
 * - status=CONFLICT 时必须携带 note（冲突说明）
 * - 确认动作记录 confirmedById / confirmedAt（责任留痕）
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

    const evidence = await prisma.dDEvidence.findUnique({
      where: { id: params.id },
      select: { id: true, batchId: true, status: true },
    })
    if (!evidence) return NextResponse.json({ error: '证据不存在' }, { status: 404 })

    const ctx = await loadBatchContext(evidence.batchId, currentUser, 'edit')
    if (ctx === null) return NextResponse.json({ error: '证据不存在' }, { status: 404 })
    if (ctx === 'FORBIDDEN') return NextResponse.json({ error: '无权操作该批次' }, { status: 403 })
    if (ctx.batch.status === 'FROZEN') {
      return NextResponse.json({ error: '批次已冻结，证据不可修改' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const data: {
      status?: string
      note?: string | null
      sourceLabel?: string | null
      location?: string | null
      confirmedById?: string | null
      confirmedAt?: Date | null
    } = {}

    if (body.note !== undefined) {
      data.note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null
    }
    if (body.sourceLabel !== undefined) {
      data.sourceLabel = typeof body.sourceLabel === 'string' && body.sourceLabel.trim() ? body.sourceLabel.trim() : null
    }
    if (body.location !== undefined) {
      data.location = typeof body.location === 'string' && body.location.trim() ? body.location.trim() : null
    }

    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !isDDEvidenceStatus(body.status)) {
        return NextResponse.json({ error: '无效的证据状态（PENDING/CONFIRMED/CONFLICT）' }, { status: 400 })
      }
      if (body.status !== evidence.status) {
        const allowed = EVIDENCE_TRANSITIONS[evidence.status as DDEvidenceStatus] || []
        if (!allowed.includes(body.status as never)) {
          return NextResponse.json(
            { error: `证据状态不允许从 ${evidence.status} 变更为 ${body.status}` },
            { status: 400 }
          )
        }
      }
      if (body.status === 'CONFLICT') {
        const note = (data.note !== undefined ? data.note : (body.note as string | undefined))?.trim?.() || ''
        if (!note) {
          return NextResponse.json({ error: '标记冲突必须填写冲突说明' }, { status: 400 })
        }
      }
      data.status = body.status
      // 确认动作：记录确认人与时间（责任留痕）；离开确认态清空
      if (body.status === 'CONFIRMED') {
        data.confirmedById = session.user.id
        data.confirmedAt = new Date()
      } else {
        data.confirmedById = null
        data.confirmedAt = null
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '无可更新的字段' }, { status: 400 })
    }

    const updated = await prisma.dDEvidence.update({
      where: { id: evidence.id },
      data,
      include: {
        createdBy: { select: { id: true, name: true } },
        confirmedBy: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ evidence: updated })
  } catch (error) {
    console.error('DD evidence update error:', error)
    return NextResponse.json({ error: '更新证据失败' }, { status: 500 })
  }
}

/**
 * DELETE /api/dd/evidence/[id]
 * 删除证据（冻结批次不可删；任务已 DONE 时删除支撑证据会导致完成度失真，前端提示）
 */
export async function DELETE(
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

    const evidence = await prisma.dDEvidence.findUnique({
      where: { id: params.id },
      select: { id: true, batchId: true },
    })
    if (!evidence) return NextResponse.json({ error: '证据不存在' }, { status: 404 })

    const ctx = await loadBatchContext(evidence.batchId, currentUser, 'edit')
    if (ctx === null) return NextResponse.json({ error: '证据不存在' }, { status: 404 })
    if (ctx === 'FORBIDDEN') return NextResponse.json({ error: '无权操作该批次' }, { status: 403 })
    if (ctx.batch.status === 'FROZEN') {
      return NextResponse.json({ error: '批次已冻结，证据不可删除' }, { status: 400 })
    }

    await prisma.dDEvidence.delete({ where: { id: evidence.id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DD evidence delete error:', error)
    return NextResponse.json({ error: '删除证据失败' }, { status: 500 })
  }
}
