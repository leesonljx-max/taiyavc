export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canGenerateReport, canViewReport } from '@/lib/annual-report/permissions'
import { generationWindow } from '@/lib/annual-report/time-window'
import { enqueueAnnualReport } from '@/lib/annual-report/queue'
import { toReportSummary } from '@/lib/annual-report/serialize'

/** POST /api/annual-reports/[id]/retry：失败重试 */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const role = session.user.role as UserRole
    const report = await prisma.annualReport.findUnique({ where: { id: params.id } })
    if (!report) return NextResponse.json({ error: '年报不存在' }, { status: 404 })
    if (!canViewReport(report, role, session.user.id)) {
      return NextResponse.json({ error: '无权操作该年报' }, { status: 403 })
    }
    if (!canGenerateReport(report.type as 'PERSONAL' | 'COMPANY', role)) {
      return NextResponse.json({ error: '无权重新生成该年报' }, { status: 403 })
    }
    if (report.type === 'PERSONAL' && report.ownerId !== session.user.id && role !== 'ADMIN' && role !== 'INVESTMENT_PARTNER') {
      return NextResponse.json({ error: '只能重试自己的个人版年报' }, { status: 403 })
    }
    if (report.status === 'QUEUED' || report.status === 'GENERATING') {
      return NextResponse.json({ report: toReportSummary(report), retried: false })
    }
    if (report.status === 'READY') {
      return NextResponse.json({ error: '该年报已生成，如需更新请重新生成' }, { status: 400 })
    }

    const window = generationWindow(report.year)
    if (!window.canGenerate) {
      return NextResponse.json({ error: window.reason || '当前不在年报生成窗口内' }, { status: 403 })
    }

    const updated = await prisma.annualReport.update({
      where: { id: report.id },
      data: {
        status: 'QUEUED',
        phase: null,
        progress: 0,
        error: null,
        generatedById: session.user.id,
        startedAt: null,
        finishedAt: null,
      },
    })
    enqueueAnnualReport(updated.id)
    return NextResponse.json({ report: toReportSummary(updated), retried: true })
  } catch (error) {
    console.error('Annual report retry error:', error)
    return NextResponse.json({ error: '重试年报失败' }, { status: 500 })
  }
}
