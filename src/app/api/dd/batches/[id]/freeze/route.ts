export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { loadBatchContext, UNAUTHORIZED_BODY } from '@/lib/dd-workbench/guards'
import { assembleFullPackage } from '@/lib/dd-workbench/report'

/**
 * POST /api/dd/batches/[id]/freeze
 * 冻结整包报告：生成版本快照（DDReportVersion），批次转入 FROZEN
 *
 * 冻结门槛（人工审批关口，文档 §1/§5）：
 * 1. 批次处于 IN_REVIEW（须先提请复核）
 * 2. 九大模块任务全部 DONE（证据链校验已在任务完成时把守）
 *
 * 冻结后：任务/证据只读；快照不可静默修改；仅冻结版本可进入投委会材料库。
 */
export async function POST(
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

    const ctx = await loadBatchContext(params.id, currentUser, 'edit')
    if (ctx === null) return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    if (ctx === 'FORBIDDEN') return NextResponse.json({ error: '无权操作该批次' }, { status: 403 })

    if (ctx.batch.status === 'FROZEN') {
      return NextResponse.json({ error: '批次已冻结' }, { status: 400 })
    }
    if (ctx.batch.status !== 'IN_REVIEW') {
      return NextResponse.json(
        { error: '冻结前需先将批次提请复核（IN_REVIEW）' },
        { status: 400 }
      )
    }

    const [batch, evidences] = await Promise.all([
      prisma.dDBatch.findUnique({
        where: { id: params.id },
        include: { tasks: { include: { owner: { select: { id: true, name: true } } } } },
      }),
      prisma.dDEvidence.findMany({ where: { batchId: params.id } }),
    ])
    if (!batch) return NextResponse.json({ error: '批次不存在' }, { status: 404 })

    const notDone = batch.tasks.filter(t => t.status !== 'DONE')
    if (notDone.length > 0) {
      return NextResponse.json(
        {
          error: `尚有 ${notDone.length} 个模块任务未完成（${notDone.map(t => t.moduleKey).join('、')}），全部完成后方可冻结`,
        },
        { status: 400 }
      )
    }

    // 组装快照（同预览结构，投委会材料以快照为准）
    const report = assembleFullPackage({
      batch,
      project: ctx.project,
      tasks: batch.tasks,
      evidences,
    })

    // 版本号：批次内自增（含 MODULE 类型，整包冻结占位下一个号）
    const maxVersion = await prisma.dDReportVersion.findFirst({
      where: { batchId: params.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    })

    const [version, updatedBatch] = await prisma.$transaction([
      prisma.dDReportVersion.create({
        data: {
          batchId: params.id,
          reportType: 'FULL_PACKAGE',
          version: (maxVersion?.version || 0) + 1,
          contentJson: JSON.stringify(report),
          frozenById: session.user.id,
        },
        include: { frozenBy: { select: { id: true, name: true } } },
      }),
      prisma.dDBatch.update({
        where: { id: params.id },
        data: { status: 'FROZEN' },
      }),
    ])

    return NextResponse.json({
      version: {
        id: version.id,
        version: version.version,
        reportType: version.reportType,
        frozenAt: version.frozenAt.toISOString(),
        frozenBy: version.frozenBy,
      },
      batch: { id: updatedBatch.id, status: updatedBatch.status },
    })
  } catch (error) {
    console.error('DD report freeze error:', error)
    return NextResponse.json({ error: '冻结报告失败' }, { status: 500 })
  }
}
