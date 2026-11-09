export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewReport } from '@/lib/annual-report/permissions'
import { enqueueAnnualReport } from '@/lib/annual-report/queue'

/** GET /api/annual-reports/[id]/status：轮询生成进度 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const role = session.user.role as UserRole
    const report = await prisma.annualReport.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        type: true,
        ownerId: true,
        status: true,
        phase: true,
        progress: true,
        error: true,
        pageCount: true,
        startedAt: true,
        finishedAt: true,
        updatedAt: true,
      },
    })
    if (!report) return NextResponse.json({ error: '年报不存在' }, { status: 404 })
    if (!canViewReport(report, role, session.user.id)) {
      return NextResponse.json({ error: '无权查看该年报' }, { status: 403 })
    }

    // 队列丢失兜底：QUEUED 超过 20 秒仍未开始，重新入队
    if (report.status === 'QUEUED' && Date.now() - report.updatedAt.getTime() > 20_000) {
      enqueueAnnualReport(report.id)
    }

    return NextResponse.json({
      id: report.id,
      status: report.status,
      phase: report.phase,
      progress: report.progress,
      error: report.error,
      pageCount: report.pageCount,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      updatedAt: report.updatedAt,
    })
  } catch (error) {
    console.error('Annual report status error:', error)
    return NextResponse.json({ error: '获取年报进度失败' }, { status: 500 })
  }
}
