export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewReport } from '@/lib/annual-report/permissions'
import { toReportSummary } from '@/lib/annual-report/serialize'
import type { AnnualReportData } from '@/lib/annual-report/types'

/** GET /api/annual-reports/[id]：报告详情（READY 时返回快照数据） */
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
    const report = await prisma.annualReport.findUnique({ where: { id: params.id } })
    if (!report) return NextResponse.json({ error: '年报不存在' }, { status: 404 })
    if (!canViewReport(report, role, session.user.id)) {
      return NextResponse.json({ error: '无权查看该年报' }, { status: 403 })
    }

    let data: AnnualReportData | null = null
    if (report.status === 'READY' && report.dataJson) {
      try {
        data = JSON.parse(report.dataJson) as AnnualReportData
      } catch {
        return NextResponse.json({ error: '年报数据已损坏，请重新生成' }, { status: 500 })
      }
    }

    return NextResponse.json({ report: toReportSummary(report), data })
  } catch (error) {
    console.error('Annual report detail error:', error)
    return NextResponse.json({ error: '获取年报失败' }, { status: 500 })
  }
}
