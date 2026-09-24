export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { loadBatchContext, UNAUTHORIZED_BODY } from '@/lib/dd-workbench/guards'
import {
  assembleFullPackage,
  fullPackageToMarkdown,
  type AssembledFullPackage,
} from '@/lib/dd-workbench/report'

/**
 * GET /api/dd/batches/[id]/report
 * 整包报告预览（实时组装九大模块 + 证据索引 + 红旗 + 缺口清单）
 * ?versionId=xxx → 返回指定冻结版本的快照（投委会正式材料）
 * ?format=markdown → 导出 Markdown（整包导出）
 */
export async function GET(
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

    const ctx = await loadBatchContext(params.id, currentUser, 'view')
    if (ctx === null) return NextResponse.json({ error: '批次不存在' }, { status: 404 })
    if (ctx === 'FORBIDDEN') return NextResponse.json({ error: '无权查看该批次' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const versionId = searchParams.get('versionId')
    const format = searchParams.get('format')

    // ── 冻结版本快照（投委会正式材料；不可篡改） ──
    if (versionId) {
      const version = await prisma.dDReportVersion.findUnique({
        where: { id: versionId },
        include: { frozenBy: { select: { id: true, name: true } } },
      })
      if (!version || version.batchId !== params.id) {
        return NextResponse.json({ error: '报告版本不存在' }, { status: 404 })
      }
      const content = JSON.parse(version.contentJson) as AssembledFullPackage
      const versionMeta = {
        id: version.id,
        version: version.version,
        reportType: version.reportType,
        frozenAt: version.frozenAt.toISOString(),
        frozenBy: version.frozenBy,
      }
      if (format === 'markdown') {
        return NextResponse.json({ markdown: fullPackageToMarkdown(content), version: versionMeta })
      }
      return NextResponse.json({ version: versionMeta, report: content })
    }

    // ── 实时组装预览 ──
    const batch = await prisma.dDBatch.findUnique({
      where: { id: params.id },
      include: { tasks: { include: { owner: { select: { id: true, name: true } } } } },
    })
    if (!batch) return NextResponse.json({ error: '批次不存在' }, { status: 404 })

    const evidences = await prisma.dDEvidence.findMany({ where: { batchId: params.id } })

    const report = assembleFullPackage({
      batch,
      project: ctx.project,
      tasks: batch.tasks,
      evidences,
    })

    if (format === 'markdown') {
      return NextResponse.json({ markdown: fullPackageToMarkdown(report) })
    }
    return NextResponse.json({ report })
  } catch (error) {
    console.error('DD report preview error:', error)
    return NextResponse.json({ error: '生成报告失败' }, { status: 500 })
  }
}
