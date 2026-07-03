import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, canEditProject, canDeleteProject, type PermissionUser } from '@/lib/permissions'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    
    const currentUser: PermissionUser | null = session?.user 
      ? { id: session.user.id, role: session.user.role as UserRole }
      : null

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: {
        investors: { select: { id: true, name: true, email: true, phone: true } },
        investments: { 
          select: { id: true, amount: true, date: true, investorId: true },
          orderBy: { date: 'desc' },
        },
        members: { select: { userId: true } },
        createdBy: { select: { id: true, name: true } },
      },
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
        { error: '无权查看该项目' },
        { status: 403 }
      )
    }

    const result = {
      ...project,
      totalAmount: Number(project.totalAmount),
      raisedAmount: Number(project.raisedAmount),
      investments: project.investments.map(i => ({
        ...i,
        amount: Number(i.amount),
      })),
      memberIds,
      aiCardJson: project.aiCardJson,
      canEdit: canEditProject(currentUser, {
        followStage: project.followStage,
        createdById: project.createdById,
        memberIds,
      }),
      canDelete: canDeleteProject(currentUser, {
        followStage: project.followStage,
        createdById: project.createdById,
        memberIds,
      }),
    }

    return NextResponse.json({ project: result })
  } catch (error) {
    return NextResponse.json(
      { error: '获取项目详情失败' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = { 
      id: session.user.id, 
      role: session.user.role as UserRole 
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: {
        members: { select: { userId: true } },
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: '项目不存在' },
        { status: 404 }
      )
    }

    const memberIds = project.members.map(m => m.userId)
    
    if (!canEditProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })) {
      return NextResponse.json(
        { error: '无权编辑该项目' },
        { status: 403 }
      )
    }

    const body = await request.json()

    const updatedProject = await prisma.project.update({
      where: { id: params.id },
      data: body,
    })

    return NextResponse.json(
      { project: { ...updatedProject, totalAmount: Number(updatedProject.totalAmount), raisedAmount: Number(updatedProject.raisedAmount) } }
    )
  } catch (error) {
    return NextResponse.json(
      { error: '更新项目失败' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = { 
      id: session.user.id, 
      role: session.user.role as UserRole 
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: {
        members: { select: { userId: true } },
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: '项目不存在' },
        { status: 404 }
      )
    }

    const memberIds = project.members.map(m => m.userId)
    
    if (!canDeleteProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })) {
      return NextResponse.json(
        { error: '无权删除该项目' },
        { status: 403 }
      )
    }

    await prisma.project.delete({
      where: { id: params.id },
    })

    return NextResponse.json({ message: '项目已删除' })
  } catch (error) {
    return NextResponse.json(
      { error: '删除项目失败' },
      { status: 500 }
    )
  }
}