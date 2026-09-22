export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { type PermissionUser } from '@/lib/permissions'
import { buildProjectVisibilityWhere } from '@/lib/project-where'

/** 时间维度：近1月(30天) / 近季度(90天) / 近半年(180天) / 当年(自然年) */
type RangeKey = 'month' | 'quarter' | 'half' | 'year'

const RANGE_DAYS: Record<Exclude<RangeKey, 'year'>, number> = {
  month: 30,
  quarter: 90,
  half: 180,
}

/** 计算时间窗口 [start, end)（滚动窗口按请求时刻实时计算；year 按自然年） */
function resolveWindow(range: RangeKey, year: number): { start: Date; end: Date } {
  if (range === 'year') {
    return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) }
  }
  const end = new Date()
  const start = new Date(end.getTime() - RANGE_DAYS[range] * 24 * 3600 * 1000)
  return { start, end }
}

/**
 * GET /api/statistics/industry-map?range=year&year=2026
 * 行业图谱数据：按初聊日期（targetDate）时间窗口筛选项目，按行业分组统计
 * - range=month|quarter|half：滚动窗口（近 30/90/180 天）
 * - range=year（默认）：自然年，year 参数可选历史年份（与旧行为兼容）
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const { searchParams } = new URL(request.url)
    const currentYear = new Date().getFullYear()
    const yearParam = searchParams.get('year')
    const year = yearParam ? parseInt(yearParam, 10) : currentYear
    const validYear = isNaN(year) ? currentYear : year

    const rangeParam = searchParams.get('range')
    const range: RangeKey =
      rangeParam === 'month' || rangeParam === 'quarter' || rangeParam === 'half'
        ? rangeParam
        : 'year'

    // 可见性 where 下推（等价性由 tests/project-where-equivalence.test.ts 保证）
    const { start: windowStart, end: windowEnd } = resolveWindow(range, validYear)

    // 轻量查询：只取分组与年份列表需要的字段
    const rows = await prisma.project.findMany({
      orderBy: { targetDate: 'desc' },
      where: {
        AND: [
          buildProjectVisibilityWhere(currentUser),
          { targetDate: { gte: windowStart, lt: windowEnd } },
        ],
      },
      select: {
        id: true,
        name: true,
        companyFullName: true,
        industry: true,
        financingRound: true,
        followStage: true,
        totalAmount: true,
        targetDate: true,
      },
    })

    // 可用年份列表（基于可见项目全集，不受时间窗口影响；供 year 模式下拉）
    const yearRows = await prisma.project.findMany({
      where: buildProjectVisibilityWhere(currentUser),
      select: { targetDate: true },
    })
    const yearsSet = new Set<number>()
    yearRows.forEach(p => {
      if (p.targetDate) yearsSet.add(new Date(p.targetDate).getFullYear())
    })
    yearsSet.add(currentYear)
    const years = Array.from(yearsSet).sort((a, b) => b - a)

    // 按行业分组统计（窗口内项目）
    const industryMap = new Map<string, {
      industry: string
      count: number
      projects: Array<{
        id: string
        name: string
        companyFullName: string | null
        financingRound: string | null
        followStage: string
        totalAmount: string
      }>
    }>()

    for (const p of rows) {
      // 行业为空的项目归入"未分类"
      const industry = p.industry?.trim() || '未分类'

      if (!industryMap.has(industry)) {
        industryMap.set(industry, {
          industry,
          count: 0,
          projects: [],
        })
      }

      const entry = industryMap.get(industry)!
      entry.count++
      entry.projects.push({
        id: p.id,
        name: p.name,
        companyFullName: p.companyFullName,
        financingRound: p.financingRound,
        followStage: p.followStage,
        totalAmount: p.totalAmount,
      })
    }

    // 按项目数量降序排序
    const industryStats = Array.from(industryMap.values()).sort((a, b) => b.count - a.count)

    return NextResponse.json({
      range,
      year: validYear,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      years,
      totalProjects: rows.length,
      totalIndustries: industryStats.length,
      industries: industryStats,
    })
  } catch (error) {
    console.error('Industry map API error:', error)
    return NextResponse.json(
      { error: '获取行业图谱数据失败' },
      { status: 500 }
    )
  }
}
