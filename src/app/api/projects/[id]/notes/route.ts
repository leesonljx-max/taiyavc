import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, type PermissionUser } from '@/lib/permissions'

// POST: 创建跟进笔记
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    // 检查项目是否存在及用户是否有权查看
    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: { members: { select: { userId: true } } },
    })

    if (!project) {
      return NextResponse.json(
        { error: '项目不存在' },
        { status: 404 }
      )
    }

    const memberIds = project.members.map(m => m.userId)

    if (!canViewProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })) {
      return NextResponse.json(
        { error: '无权添加跟进笔记' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { content } = body

    if (!content || !content.trim()) {
      return NextResponse.json(
        { error: '跟进笔记内容不能为空' },
        { status: 400 }
      )
    }

    const note = await prisma.followUpNote.create({
      data: {
        projectId: params.id,
        userId: session.user.id,
        userName: session.user.name || session.user.email || '未知用户',
        content: content.trim(),
      },
    })

    return NextResponse.json({ note }, { status: 201 })
  } catch (error) {
    console.error('Create follow-up note error:', error)
    return NextResponse.json(
      { error: '创建跟进笔记失败', detail: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    )
  }
}
