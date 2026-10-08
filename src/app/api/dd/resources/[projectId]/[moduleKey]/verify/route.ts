export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { isValidModuleKey } from '@/lib/dd-workbench/resources'
import { runClaimVerification } from '@/lib/dd-workbench/claim-verifier'

/**
 * POST /api/dd/resources/[projectId]/[moduleKey]/verify
 * 报告外部校验（ClaimVerifier 互联网交叉核验）：提取报告关键声明 → 双源搜索 → 四级裁决
 * 前置：模块报告已生成；结果覆盖写入 verificationJson
 */
export async function POST(
  _request: Request,
  { params }: { params: { projectId: string; moduleKey: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const currentUser: PermissionUser = { id: session.user.id, role: session.user.role as UserRole }

    if (!isValidModuleKey(params.moduleKey)) {
      return NextResponse.json({ error: '无效的模块标识' }, { status: 400 })
    }

    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { createdById: true, members: { select: { userId: true } } },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权操作该项目' }, { status: 403 })
    }

    const result = await runClaimVerification(params.projectId, params.moduleKey)
    if (!result.ok || !result.verification) {
      return NextResponse.json({ error: result.error || '外部校验失败，请稍后重试' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, verification: result.verification })
  } catch (error) {
    console.error('DD claim verification error:', error)
    return NextResponse.json({ error: '外部校验失败' }, { status: 500 })
  }
}
