/**
 * 尽调工作台 API 权限守卫
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canEditResearchProject, canViewResearchProject } from '@/lib/research-permissions'

export type DDAccessResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; response: NextResponse }

export async function requireProjectAccess(
  projectId: string,
  mode: 'view' | 'edit'
): Promise<DDAccessResult> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 }) }
  }

  const user = { id: session.user.id, role: session.user.role as UserRole }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { createdById: true, members: { select: { userId: true } } },
  })
  if (!project) {
    return { ok: false, response: NextResponse.json({ error: '项目不存在' }, { status: 404 }) }
  }

  const context = {
    createdById: project.createdById,
    memberIds: project.members.map(m => m.userId),
  }
  const allowed = mode === 'view'
    ? canViewResearchProject(user, context)
    : canEditResearchProject(user, context)

  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: mode === 'view' ? '无权查看该项目' : '无权编辑该项目' },
        { status: 403 }
      ),
    }
  }

  return { ok: true, userId: user.id, role: user.role }
}

export function canWaive(role: string): boolean {
  return role === 'ADMIN' || role === 'INVESTMENT_PARTNER'
}
