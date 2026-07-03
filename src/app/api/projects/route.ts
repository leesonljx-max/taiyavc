import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, type PermissionUser } from '@/lib/permissions'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    
    const currentUser: PermissionUser | null = session?.user 
      ? { id: session.user.id, role: session.user.role as UserRole }
      : null

    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        investors: { select: { id: true, name: true } },
        investments: { select: { id: true, amount: true, date: true } },
        members: { select: { userId: true } },
        createdBy: { select: { id: true, name: true } },
      },
    })

    const filteredProjects = projects.filter(project => {
      const memberIds = project.members.map(m => m.userId)
      return canViewProject(currentUser, {
        followStage: project.followStage,
        createdById: project.createdById,
        memberIds,
      })
    })

    const result = filteredProjects.map(p => ({
      ...p,
      totalAmount: Number(p.totalAmount),
      raisedAmount: Number(p.raisedAmount),
      investmentCount: p.investments.length,
      investorCount: p.investors.length,
      memberIds: p.members.map(m => m.userId),
    }))

    return NextResponse.json({ projects: result })
  } catch (error) {
    return NextResponse.json(
      { error: '获取项目列表失败' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { name, checkDuplicate, ...data } = body

    if (!name) {
      return NextResponse.json(
        { error: '项目名称是必填项' },
        { status: 400 }
      )
    }

    if (checkDuplicate) {
      const existingProject = await prisma.project.findFirst({
        where: { name },
      })

      if (existingProject) {
        return NextResponse.json(
          { 
            error: '可能存在重复项目', 
            warning: '数据库中已存在同名项目',
            existingProject: {
              id: existingProject.id,
              name: existingProject.name,
              companyFullName: existingProject.companyFullName,
            }
          },
          { status: 409 }
        )
      }

      return NextResponse.json({ exists: false })
    }

    const existingProject = await prisma.project.findFirst({
      where: { name },
    })

    if (existingProject) {
      return NextResponse.json(
        { 
          error: '可能存在重复项目', 
          warning: '数据库中已存在同名项目',
          existingProject: {
            id: existingProject.id,
            name: existingProject.name,
            companyFullName: existingProject.companyFullName,
          }
        },
        { status: 409 }
      )
    }

    const project = await prisma.project.create({
      data: {
        name,
        createdById: session.user.id,
        ...data,
      },
    })

    return NextResponse.json(
      { project: { ...project, totalAmount: Number(project.totalAmount), raisedAmount: Number(project.raisedAmount) } },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { error: '创建项目失败' },
      { status: 500 }
    )
  }
}