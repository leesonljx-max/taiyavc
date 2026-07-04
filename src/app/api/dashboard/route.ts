import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, type PermissionUser } from '@/lib/permissions'
import { parsePassedStages } from '@/lib/stage-utils'

/**
 * 计算本周起始时间（每周一中午12:00）
 * 如果今天是周一且时间在12:00之前，则返回上周一12:00
 */
function getWeekStart(): Date {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  // 计算距离周一的天数
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1

  // 本周一
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysSinceMonday)
  monday.setHours(12, 0, 0, 0)

  // 如果今天是周一但还没到中午12点，则回退到上周一
  if (dayOfWeek === 1 && now.getHours() < 12) {
    monday.setDate(monday.getDate() - 7)
  }

  return monday
}

// 维护人卡片左侧显示的阶段（用户指定：初聊/PreDD/立项/尽调/交割）
const MAINTAINER_STAGES = [
  'INITIAL_TALK',
  'PRE_DD',
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'CLOSING',
] as const

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    const currentUser: PermissionUser | null = session?.user
      ? { id: session.user.id, role: session.user.role as UserRole }
      : null

    // 年份筛选（默认当年）
    const { searchParams } = new URL(request.url)
    const currentYear = new Date().getFullYear()
    const yearParam = searchParams.get('year')
    const year = yearParam ? parseInt(yearParam, 10) : currentYear
    const validYear = isNaN(year) ? currentYear : year

    const weekStart = getWeekStart()

    // 获取所有项目（带权限过滤）
    const allProjects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        members: { select: { userId: true } },
        createdBy: { select: { id: true, name: true } },
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

    // 可用年份列表（从项目初聊日期 targetDate 提取，去重排序降序）
    const yearsSet = new Set<number>()
    visibleProjects.forEach(p => {
      if (p.targetDate) yearsSet.add(new Date(p.targetDate).getFullYear())
    })
    yearsSet.add(currentYear) // 确保当年始终可选
    const years = Array.from(yearsSet).sort((a, b) => b - a)

    // 按年份筛选项目（以初聊日期 targetDate 为准）
    const yearFilteredProjects = visibleProjects.filter(
      p => p.targetDate && new Date(p.targetDate).getFullYear() === validYear
    )

    // 统计数据（基于年份筛选后的项目）
    const totalProjects = yearFilteredProjects.length

    // 本周新增项目：以初聊日期为准（targetDate >= weekStart）或本周变更阶段（stageChangedAt >= weekStart）
    // 注意：不限于当年，之前创建的项目如果本周变更了阶段也会显示
    const weeklyNewProjects = visibleProjects.filter(
      p => {
        const initialDate = p.targetDate ? new Date(p.targetDate) : null
        const stageChangedAt = p.stageChangedAt ? new Date(p.stageChangedAt) : null
        return (initialDate !== null && initialDate >= weekStart) || (stageChangedAt !== null && stageChangedAt >= weekStart)
      }
    )

    // 累计统计：基于 passedStages（经过某阶段即计入）
    const initiatedProjects = yearFilteredProjects.filter(p =>
      parsePassedStages(p.passedStages).includes('PROJECT_INITIATION')
    )

    const investedProjects = yearFilteredProjects.filter(p =>
      parsePassedStages(p.passedStages).includes('CLOSING')
    )

    // 本周新增项目（带AI画板数据）
    const weeklyProjectsWithCards = weeklyNewProjects.map(p => {
      let aiCard = null
      if (p.aiCardJson) {
        try {
          aiCard = JSON.parse(p.aiCardJson)
        } catch {
          aiCard = null
        }
      }
      return {
        id: p.id,
        name: p.name,
        companyFullName: p.companyFullName,
        industry: p.industry,
        followStage: p.followStage,
        targetDate: p.targetDate,
        createdAt: p.createdAt,
        aiCard,
        maintainerName: p.createdBy?.name || '未分配',
      }
    })

    // 按维护人分组统计
    // stageCounts 基于年份筛选后的所有项目（累计统计）
    // projects 仅包含本周新增项目（本周新建或本周变更阶段）
    const maintainerMap = new Map<string, {
      userId: string
      userName: string
      stageCounts: Record<string, number>
      projects: Array<{
        id: string
        name: string
        companyPosition: string | null
        industry: string | null
        financingRound: string | null
        totalAmount: string
        followStage: string
      }>
    }>()

    // 初始化所有维护人（从年份筛选项目 + 本周新增项目中收集）
    const allUserIds = new Set<string>()
    yearFilteredProjects.forEach(p => allUserIds.add(p.createdById))
    weeklyNewProjects.forEach(p => allUserIds.add(p.createdById))

    for (const userId of allUserIds) {
      // 从年份筛选项目中找该用户的项目获取用户名
      const sampleProject = yearFilteredProjects.find(p => p.createdById === userId)
        || weeklyNewProjects.find(p => p.createdById === userId)
      const userName = sampleProject?.createdBy?.name || '未分配'

      maintainerMap.set(userId, {
        userId,
        userName,
        stageCounts: {
          INITIAL_TALK: 0,
          PRE_DD: 0,
          PROJECT_INITIATION: 0,
          DUE_DILIGENCE: 0,
          CLOSING: 0,
        },
        projects: [],
      })
    }

    // 累计统计：基于 passedStages（经过某阶段即+1，不因变更到后续阶段而-1）
    for (const p of yearFilteredProjects) {
      const entry = maintainerMap.get(p.createdById)
      if (!entry) continue

      const passedStages = parsePassedStages(p.passedStages)
      for (const stage of MAINTAINER_STAGES) {
        if (passedStages.includes(stage as any)) {
          entry.stageCounts[stage]++
        }
      }
    }

    // 项目卡片：仅本周新增项目（本周新建或本周变更阶段）
    for (const p of weeklyNewProjects) {
      const entry = maintainerMap.get(p.createdById)
      if (!entry) continue

      entry.projects.push({
        id: p.id,
        name: p.name,
        companyPosition: p.companyPosition,
        industry: p.industry,
        financingRound: p.financingRound,
        totalAmount: p.totalAmount,
        followStage: p.followStage,
      })
    }

    // 仅保留有本周新增项目的维护人
    const maintainerStats = Array.from(maintainerMap.values()).filter(m => m.projects.length > 0)

    return NextResponse.json({
      stats: {
        totalProjects,
        weeklyNew: weeklyNewProjects.length,
        initiated: initiatedProjects.length,
        invested: investedProjects.length,
      },
      weekStart: weekStart.toISOString(),
      weeklyProjects: weeklyProjectsWithCards,
      years,
      selectedYear: validYear,
      maintainerStats,
    })
  } catch (error) {
    console.error('Dashboard API error:', error)
    return NextResponse.json(
      { error: '获取仪表盘数据失败' },
      { status: 500 }
    )
  }
}
