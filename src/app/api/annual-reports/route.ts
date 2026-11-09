export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewCompanyReport, canGenerateReport } from '@/lib/annual-report/permissions'
import { toReportSummary } from '@/lib/annual-report/serialize'
import { generationWindow } from '@/lib/annual-report/time-window'
import { enqueueAnnualReport } from '@/lib/annual-report/queue'

/** GET /api/annual-reports：我的个人版 + 可查看的公司版 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const role = session.user.role as UserRole
    const reports = await prisma.annualReport.findMany({
      where: {
        OR: [
          { type: 'PERSONAL', ownerId: session.user.id },
          ...(canViewCompanyReport(role) ? [{ type: 'COMPANY' }] : []),
        ],
      },
      orderBy: [{ year: 'desc' }, { type: 'asc' }, { version: 'desc' }],
      take: 30,
    })
    return NextResponse.json({ reports: reports.map(toReportSummary) })
  } catch (error) {
    console.error('Annual report list error:', error)
    return NextResponse.json({ error: '获取年报列表失败' }, { status: 500 })
  }
}

/**
 * POST /api/annual-reports
 * body: { year, type: 'PERSONAL' | 'COMPANY', regenerate?: boolean }
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const role = session.user.role as UserRole
    const body = (await request.json().catch(() => ({}))) as {
      year?: number
      type?: string
      regenerate?: boolean
    }
    const year = Number(body.year)
    const type = body.type === 'COMPANY' ? 'COMPANY' : body.type === 'PERSONAL' ? 'PERSONAL' : null
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !type) {
      return NextResponse.json({ error: '参数错误：需要 year 和 type' }, { status: 400 })
    }
    if (!canGenerateReport(type, role)) {
      return NextResponse.json({ error: type === 'COMPANY' ? '只有管理员/合伙人可以生成公司版年报' : '无权生成个人版年报' }, { status: 403 })
    }

    const ownerKey = type === 'PERSONAL' ? session.user.id : '__company__'
    const ownerId = type === 'PERSONAL' ? session.user.id : null

    const existing = await prisma.annualReport.findFirst({
      where: { year, type, ownerKey },
      orderBy: { version: 'desc' },
    })

    // 已在排队/生成中，直接返回
    if (existing && (existing.status === 'QUEUED' || existing.status === 'GENERATING')) {
      return NextResponse.json({ report: toReportSummary(existing), created: false })
    }
    // 已生成且不要求重生成，直接返回
    if (existing?.status === 'READY' && !body.regenerate) {
      return NextResponse.json({ report: toReportSummary(existing), created: false })
    }

    const window = generationWindow(year)
    if (!window.canGenerate) {
      return NextResponse.json({ error: window.reason || '当前不在年报生成窗口内' }, { status: 403 })
    }

    // 失败重试：复用同一条记录
    if (existing?.status === 'FAILED' && !body.regenerate) {
      const retried = await prisma.annualReport.update({
        where: { id: existing.id },
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
      enqueueAnnualReport(retried.id)
      return NextResponse.json({ report: toReportSummary(retried), created: false })
    }

    const version = existing ? existing.version + 1 : 1
    const created = await prisma.annualReport.create({
      data: {
        year,
        type,
        ownerKey,
        ownerId,
        status: 'QUEUED',
        progress: 0,
        version,
        pageCount: type === 'PERSONAL' ? 8 : 10,
        generatedById: session.user.id,
      },
    })
    enqueueAnnualReport(created.id)
    return NextResponse.json({ report: toReportSummary(created), created: true })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      console.error('Annual report duplicate create:', error)
      return NextResponse.json({ error: '该年度报告正在生成，请刷新查看' }, { status: 409 })
    }
    console.error('Annual report create error:', error)
    return NextResponse.json({ error: '创建年报失败' }, { status: 500 })
  }
}
