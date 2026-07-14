import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, type PermissionUser } from '@/lib/permissions'

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

// 维护人卡片左侧显示的阶段（用户指定：初聊/PreDD/立项/尽调/协议/交割）
const MAINTAINER_STAGES = [
  'INITIAL_TALK',
  'PRE_DD',
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'AGREEMENT',
  'CLOSING',
] as const

export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    const currentUser: PermissionUser | null = session?.user
      ? { id: session.user.id, role: session.user.role as UserRole }
      : null

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

    // 本周新增项目：以初聊日期为准（targetDate >= weekStart）或本周变更阶段（stageChangedAt >= weekStart）
    const weeklyNewProjects = visibleProjects.filter(
      p => {
        const initialDate = p.targetDate ? new Date(p.targetDate) : null
        const stageChangedAt = p.stageChangedAt ? new Date(p.stageChangedAt) : null
        return (initialDate !== null && initialDate >= weekStart) || (stageChangedAt !== null && stageChangedAt >= weekStart)
      }
    )

    // 顶部四个统计卡片（本周维度）
    // 1) 本周新增：本周新建项目（targetDate >= weekStart）
    const weeklyNewCount = visibleProjects.filter(p => {
      const initialDate = p.targetDate ? new Date(p.targetDate) : null
      return initialDate !== null && initialDate >= weekStart
    }).length

    // 2) PreDD：本周变更为 PRE_DD 阶段的项目数
    // 3) 立项：本周变更为 PROJECT_INITIATION 阶段的项目数
    // 4) 尽调：本周变更为 DUE_DILIGENCE 阶段的项目数
    const preDDCount = visibleProjects.filter(p => {
      const stageChangedAt = p.stageChangedAt ? new Date(p.stageChangedAt) : null
      return stageChangedAt !== null && stageChangedAt >= weekStart && p.followStage === 'PRE_DD'
    }).length

    const initiatedCount = visibleProjects.filter(p => {
      const stageChangedAt = p.stageChangedAt ? new Date(p.stageChangedAt) : null
      return stageChangedAt !== null && stageChangedAt >= weekStart && p.followStage === 'PROJECT_INITIATION'
    }).length

    const dueDiligenceCount = visibleProjects.filter(p => {
      const stageChangedAt = p.stageChangedAt ? new Date(p.stageChangedAt) : null
      return stageChangedAt !== null && stageChangedAt >= weekStart && p.followStage === 'DUE_DILIGENCE'
    }).length

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
    // stageCounts 基于本周变更统计
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

    // 初始化所有维护人（从本周新增项目中收集）
    const allUserIds = new Set<string>()
    weeklyNewProjects.forEach(p => allUserIds.add(p.createdById))

    for (const userId of allUserIds) {
      const sampleProject = weeklyNewProjects.find(p => p.createdById === userId)
      const userName = sampleProject?.createdBy?.name || '未分配'

      maintainerMap.set(userId, {
        userId,
        userName,
        stageCounts: {
          INITIAL_TALK: 0,
          PRE_DD: 0,
          PROJECT_INITIATION: 0,
          DUE_DILIGENCE: 0,
          AGREEMENT: 0,
          CLOSING: 0,
        },
        projects: [],
      })
    }

    // 周维度统计：仅统计本周发生变更的阶段
    // - INITIAL_TALK: 当周新增项目（targetDate >= weekStart）时统计
    // - 其它阶段: 当周发生了阶段变更（stageChangedAt >= weekStart）且当前处于该阶段时统计
    for (const p of weeklyNewProjects) {
      const entry = maintainerMap.get(p.createdById)
      if (!entry) continue

      // 初聊：当周新增项目时统计
      const initialDate = p.targetDate ? new Date(p.targetDate) : null
      if (initialDate && initialDate >= weekStart) {
        entry.stageCounts.INITIAL_TALK++
      }

      // 其它阶段：当周发生了阶段变更时统计（当前阶段即为变更后的阶段）
      const stageChangedAt = p.stageChangedAt ? new Date(p.stageChangedAt) : null
      if (stageChangedAt && stageChangedAt >= weekStart) {
        const currentStage = p.followStage
        if (currentStage !== 'INITIAL_TALK' && (MAINTAINER_STAGES as readonly string[]).includes(currentStage)) {
          entry.stageCounts[currentStage]++
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
        weeklyNew: weeklyNewCount,
        preDD: preDDCount,
        initiated: initiatedCount,
        dueDiligence: dueDiligenceCount,
      },
      weekStart: weekStart.toISOString(),
      weeklyProjects: weeklyProjectsWithCards,
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
