export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canViewResearchProject, canEditResearchProject } from '@/lib/research-permissions'
import { DD_TEMPLATE_MODULES, DD_TEMPLATE_VERSION } from '@/lib/dd-workbench/template'
import { UNAUTHORIZED_BODY } from '@/lib/dd-workbench/guards'

/** 批次列表/详情中每批返回的统计结构 */
export interface DDBatchStats {
  total: number
  pending: number
  inProgress: number
  inReview: number
  done: number
  blocked: number
  redFlagMedium: number
  redFlagHigh: number
  evidenceCount: number
  frozenReportCount: number
  latestFrozenReport: { id: string; version: number; frozenAt: string; frozenBy: string } | null
}

/** 从任务行计算批次统计（9 个任务内存计算，无额外查询） */
function computeBatchStats(
  tasks: Array<{ status: string; redFlagLevel: string }>,
  evidenceCount: number,
  versions: Array<{ id: string; version: number; reportType: string; frozenAt: Date; frozenBy: { name: string | null } | null }>
): DDBatchStats {
  const frozen = versions.filter(v => v.reportType === 'FULL_PACKAGE')
  const latest = frozen.sort((a, b) => b.version - a.version)[0]
  return {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'PENDING').length,
    inProgress: tasks.filter(t => t.status === 'IN_PROGRESS').length,
    inReview: tasks.filter(t => t.status === 'IN_REVIEW').length,
    done: tasks.filter(t => t.status === 'DONE').length,
    blocked: tasks.filter(t => t.status === 'BLOCKED').length,
    redFlagMedium: tasks.filter(t => t.redFlagLevel === 'MEDIUM').length,
    redFlagHigh: tasks.filter(t => t.redFlagLevel === 'HIGH').length,
    evidenceCount,
    frozenReportCount: frozen.length,
    latestFrozenReport: latest
      ? {
          id: latest.id,
          version: latest.version,
          frozenAt: latest.frozenAt.toISOString(),
          frozenBy: latest.frozenBy?.name || '未知',
        }
      : null,
  }
}

/**
 * POST /api/dd/batches
 * 发起尽调批次：按模板 v1 自动生成九大模块任务
 * body: { projectId, round?, dueDate? }
 *
 * 规则：一个项目同一时间只允许一个进行中批次（IN_PROGRESS/IN_REVIEW），
 * 历史批次冻结（FROZEN）后可发起新批次（每批独立报告版本）。
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(UNAUTHORIZED_BODY, { status: 401 })
    }
    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const body = await request.json().catch(() => ({}))
    const projectId = typeof body.projectId === 'string' ? body.projectId : ''
    if (!projectId) {
      return NextResponse.json({ error: '缺少 projectId' }, { status: 400 })
    }
    const round = typeof body.round === 'string' && body.round.trim() ? body.round.trim() : null

    // 截止日：完整 ISO-8601（项目惯例，与 targetDate 校验一致）
    let dueDate: Date | null = null
    if (body.dueDate !== undefined && body.dueDate !== null && body.dueDate !== '') {
      const d = new Date(body.dueDate)
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: '截止日格式无效（需完整 ISO-8601）' }, { status: 400 })
      }
      dueDate = d
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, createdById: true, members: { select: { userId: true } } },
    })
    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '仅项目维护人、投资合伙人或管理员可发起尽调批次' }, { status: 403 })
    }

    // 同一项目仅允许一个进行中批次
    const activeBatch = await prisma.dDBatch.findFirst({
      where: { projectId, status: { not: 'FROZEN' } },
      select: { id: true, status: true },
    })
    if (activeBatch) {
      return NextResponse.json(
        { error: '该项目已有进行中的尽调批次，请先完成或冻结后再发起新批次' },
        { status: 400 }
      )
    }

    // 创建批次 + 按模板生成九大模块任务（同事务，保证任务完整性）
    const batch = await prisma.dDBatch.create({
      data: {
        projectId,
        round,
        templateVersion: DD_TEMPLATE_VERSION,
        status: 'IN_PROGRESS',
        initiatedById: session.user.id,
        dueDate,
        tasks: {
          create: DD_TEMPLATE_MODULES.map(m => ({
            moduleKey: m.key,
            status: 'PENDING',
            redFlagLevel: 'NONE',
            sortKey: m.sortKey,
          })),
        },
      },
      include: {
        tasks: { orderBy: { sortKey: 'asc' } },
        initiatedBy: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ batch }, { status: 201 })
  } catch (error) {
    console.error('DD batch create error:', error)
    return NextResponse.json({ error: '发起尽调批次失败' }, { status: 500 })
  }
}

/**
 * GET /api/dd/batches?projectId=xxx
 * 项目尽调批次列表（新→旧）+ 各批次进度/红旗/证据/冻结报告统计
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(UNAUTHORIZED_BODY, { status: 401 })
    }
    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId') || ''
    if (!projectId) {
      return NextResponse.json({ error: '缺少 projectId' }, { status: 400 })
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, createdById: true, members: { select: { userId: true } } },
    })
    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }
    const memberIds = project.members.map(m => m.userId)
    if (!canViewResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权查看该项目' }, { status: 403 })
    }

    const batches = await prisma.dDBatch.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        tasks: { select: { status: true, redFlagLevel: true } },
        _count: { select: { evidences: true } },
        reportVersions: {
          select: {
            id: true,
            version: true,
            reportType: true,
            frozenAt: true,
            frozenBy: { select: { name: true } },
          },
        },
        initiatedBy: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({
      batches: batches.map(b => ({
        id: b.id,
        projectId: b.projectId,
        round: b.round,
        templateVersion: b.templateVersion,
        status: b.status,
        dueDate: b.dueDate?.toISOString() || null,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
        initiatedBy: b.initiatedBy,
        stats: computeBatchStats(b.tasks, b._count.evidences, b.reportVersions),
      })),
    })
  } catch (error) {
    console.error('DD batch list error:', error)
    return NextResponse.json({ error: '获取尽调批次失败' }, { status: 500 })
  }
}
