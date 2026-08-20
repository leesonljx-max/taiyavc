export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import {
  canViewResearchProject,
  canEditResearchProject,
} from '@/lib/research-permissions'
import { runDueDiligence, getDDReport, isDDRunning } from '@/lib/dd-harness/runner'

/**
 * GET /api/research/[projectId]/dd
 * 获取尽调报告（框架 + 模块结果 + 缺口清单）
 *
 * POST /api/research/[projectId]/dd
 * 触发尽调分析（后台执行，前端轮询 GET 获取进度）
 * body: { force?: boolean, moduleKeys?: string[] }
 * - 默认增量：输入未变且已完成的模块自动跳过
 * - force: true 全量重跑（含重新生成框架）
 * - moduleKeys: 只重跑指定模块
 */

export async function GET(
  _request: Request,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: {
        createdById: true,
        followStage: true,
        members: { select: { userId: true } },
      },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    const memberIds = project.members.map(m => m.userId)
    if (!canViewResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权查看该项目' }, { status: 403 })
    }

    const report = await getDDReport(params.projectId)

    return NextResponse.json({
      report,
      running: isDDRunning(params.projectId),
      // 是否处于尽调阶段（用于前端提示自动触发条件）
      inDueDiligenceStage: project.followStage === 'DUE_DILIGENCE',
    })
  } catch (error) {
    console.error('DD report GET error:', error)
    return NextResponse.json({ error: '获取尽调报告失败' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: {
        createdById: true,
        members: { select: { userId: true } },
      },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权触发尽调分析' }, { status: 403 })
    }

    if (isDDRunning(params.projectId)) {
      return NextResponse.json(
        { error: '尽调分析正在运行中，请等待完成' },
        { status: 409 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const force = body.force === true
    const moduleKeys = Array.isArray(body.moduleKeys)
      ? body.moduleKeys.filter((k: unknown) => typeof k === 'string').slice(0, 20)
      : undefined

    // 后台执行（不阻塞请求），前端轮询 GET 获取进度
    void runDueDiligence(params.projectId, {
      force,
      moduleKeys,
      triggeredBy: session.user.id,
    })
      .then(r => {
        console.log(
          `[DD Harness] 手动触发完成 ${params.projectId}: ` +
            `共${r.totalModules}模块, 分析${r.analyzed}, 跳过${r.skipped}, 失败${r.failed}, 缺口${r.gaps}`
        )
      })
      .catch(e => {
        console.error(
          `[DD Harness] 手动触发失败 ${params.projectId}:`,
          e instanceof Error ? e.message : e
        )
      })

    return NextResponse.json({ started: true })
  } catch (error) {
    console.error('DD report POST error:', error)
    return NextResponse.json({ error: '触发尽调分析失败' }, { status: 500 })
  }
}
