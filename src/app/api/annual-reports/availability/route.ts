export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { AnnualReport } from '@prisma/client'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { generationWindow, resolveReportYear } from '@/lib/annual-report/time-window'
import {
  canGenerateReport,
  canViewCompanyReport,
} from '@/lib/annual-report/permissions'

function summary(report: AnnualReport) {
  let extra: { theme?: string; overview?: string; keywords?: string[] } = {}
  if (report.summaryJson) {
    try {
      extra = JSON.parse(report.summaryJson)
    } catch {
      extra = {}
    }
  }
  return {
    id: report.id,
    year: report.year,
    type: report.type,
    ownerKey: report.ownerKey,
    ownerId: report.ownerId,
    status: report.status,
    phase: report.phase,
    progress: report.progress,
    version: report.version,
    pageCount: report.pageCount,
    generatedAt: report.generatedAt,
    createdAt: report.createdAt,
    error: report.error,
    ...extra,
  }
}

/**
 * GET /api/annual-reports/availability
 * 工作台入口：窗口状态、两版最新报告、当前用户权限
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const role = session.user.role as UserRole
    const url = new URL(request.url)
    const yearParam = Number.parseInt(url.searchParams.get('year') || '', 10)
    const year = Number.isFinite(yearParam) && yearParam >= 2000 && yearParam <= 2100
      ? yearParam
      : resolveReportYear()
    const window = generationWindow(year)

    const [personal, company] = await Promise.all([
      prisma.annualReport.findFirst({
        where: { year, type: 'PERSONAL', ownerKey: session.user.id },
        orderBy: { version: 'desc' },
      }),
      prisma.annualReport.findFirst({
        where: { year, type: 'COMPANY', ownerKey: '__company__' },
        orderBy: { version: 'desc' },
      }),
    ])

    return NextResponse.json({
      year,
      window,
      user: {
        id: session.user.id,
        name: session.user.name || '',
        role,
      },
      permissions: {
        personal: canGenerateReport('PERSONAL', role),
        company: canGenerateReport('COMPANY', role),
        viewCompany: canViewCompanyReport(role),
      },
      reports: {
        personal: personal ? summary(personal) : null,
        company: company && canViewCompanyReport(role) ? summary(company) : null,
      },
    })
  } catch (error) {
    console.error('Annual report availability error:', error)
    return NextResponse.json({ error: '获取年报状态失败' }, { status: 500 })
  }
}
