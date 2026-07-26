export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { unlink } from 'fs/promises'
import { join } from 'path'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'

/**
 * DELETE /api/research/[projectId]/documents/[docId]
 * 删除投研分析模块文档
 *
 * 1. 验证文档归属当前项目（防止越权）
 * 2. 删除文件系统中的文件（仅 /research-docs/ 路径）
 * 3. 删除数据库记录
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { projectId: string; docId: string } }
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

    const { projectId, docId } = params

    // 查询文档，并验证归属当前项目
    const document = await prisma.researchDocument.findUnique({
      where: { id: docId },
      include: {
        module: {
          select: {
            projectId: true,
            project: {
              select: {
                createdById: true,
                members: { select: { userId: true } },
              },
            },
          },
        },
      },
    })

    if (!document) {
      return NextResponse.json({ error: '文档不存在' }, { status: 404 })
    }

    // 验证文档归属当前项目（防止授权绕过）
    if (document.module.projectId !== projectId) {
      return NextResponse.json({ error: '文档不属于该项目' }, { status: 403 })
    }

    const project = document.module.project
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权删除文档' }, { status: 403 })
    }

    // 删除文件系统中的文件（仅本地 /research-docs/ 路径）
    if (document.fileUrl.startsWith('/research-docs/')) {
      const filePath = join(process.cwd(), 'public', document.fileUrl)
      try {
        await unlink(filePath)
      } catch (error) {
        // 文件不存在时忽略错误
        console.warn('File not found, skipping deletion:', filePath)
      }
    }

    // 删除数据库记录
    await prisma.researchDocument.delete({
      where: { id: docId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Research document delete error:', error)
    return NextResponse.json(
      { error: '删除文档失败' },
      { status: 500 }
    )
  }
}
