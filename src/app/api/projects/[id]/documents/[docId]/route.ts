import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canEditProject, type PermissionUser } from '@/lib/permissions'
import { unlink } from 'fs/promises'
import path from 'path'

/**
 * DELETE /api/projects/[id]/documents/[docId]
 * 删除项目文档（需要 canEditProject 权限）
 * 同时删除本地文件（如果是本地存储）
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; docId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    if (!session.user.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: { members: { select: { userId: true } } },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    const memberIds = project.members.map(m => m.userId)
    if (!canEditProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })) {
      return NextResponse.json({ error: '无权删除文档' }, { status: 403 })
    }

    const document = await prisma.projectDocument.findUnique({
      where: { id: params.docId },
    })

    if (!document || document.projectId !== params.id) {
      return NextResponse.json({ error: '文档不存在' }, { status: 404 })
    }

    // 删除本地文件（仅当 URL 指向本地 /project-docs/ 时）
    if (document.fileUrl.startsWith('/project-docs/')) {
      try {
        const filePath = path.join(process.cwd(), 'public', document.fileUrl)
        await unlink(filePath)
      } catch (err) {
        // 文件可能已被删除，忽略错误
        console.warn('删除本地文件失败:', err)
      }
    }

    // 删除数据库记录
    await prisma.projectDocument.delete({
      where: { id: params.docId },
    })

    return NextResponse.json({ message: '文档已删除' })
  } catch (error) {
    console.error('Delete project document error:', error)
    return NextResponse.json({ error: '删除文档失败' }, { status: 500 })
  }
}
