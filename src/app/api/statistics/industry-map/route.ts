import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, type PermissionUser } from '@/lib/permissions'

/**
 * GET /api/statistics/industry-map?year=2026
 * 行业图谱数据：按初聊日期（targetDate）年份筛选项目，按行业分组统计
 * 返回：[{ industry, count, projects: [{ name, companyFullName, financingRound, followStage }] }]
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

    // 获取所有项目（带权限过滤）
    const allProjects = await prisma.project.findMany({
      orderBy: { targetDate: 'desc' },
      include: {
        members: { select: { userId: true } },
      },
    })

    const visibleProjects = allProjects.filter(project => {
      const memberIds = project.members.map(m => m.userId)
      return canViewProject(currentUser, {
        followStage: project.followStage,
        createdById: project.createdById,
        memberIds,
      })
    })

    // 可用年份列表（从 targetDate 提取）
    const yearsSet = new Set<number>()
    visibleProjects.forEach(p => {
      if (p.targetDate) yearsSet.add(new Date(p.targetDate).getFullYear())
    })
    yearsSet.add(currentYear)
    const years = Array.from(yearsSet).sort((a, b) => b - a)

    // 按初聊日期年份筛选
    const yearFilteredProjects = visibleProjects.filter(
      p => p.targetDate && new Date(p.targetDate).getFullYear() === validYear
    )

    // 按行业分组统计
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

    for (const p of yearFilteredProjects) {
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
      year: validYear,
      years,
      totalProjects: yearFilteredProjects.length,
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
