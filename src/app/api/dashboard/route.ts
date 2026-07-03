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

    // 统计数据
    const totalProjects = visibleProjects.length

    const weeklyNewProjects = visibleProjects.filter(
      p => new Date(p.createdAt) >= weekStart
    )

    const initiatedProjects = visibleProjects.filter(p =>
      ['PROJECT_INITIATION', 'DUE_DILIGENCE', 'CLOSING', 'POST_INVESTMENT'].includes(p.followStage)
    )

    const investedProjects = visibleProjects.filter(p =>
      ['CLOSING', 'POST_INVESTMENT'].includes(p.followStage)
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
        createdAt: p.createdAt,
        aiCard,
      }
    })

    return NextResponse.json({
      stats: {
        totalProjects,
        weeklyNew: weeklyNewProjects.length,
        initiated: initiatedProjects.length,
        invested: investedProjects.length,
      },
      weekStart: weekStart.toISOString(),
      weeklyProjects: weeklyProjectsWithCards,
    })
  } catch (error) {
    console.error('Dashboard API error:', error)
    return NextResponse.json(
      { error: '获取仪表盘数据失败' },
      { status: 500 }
    )
  }
}
