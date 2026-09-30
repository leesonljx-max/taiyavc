export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { upsertModuleResource, isValidModuleKey } from '@/lib/dd-workbench/resources'
import { maybeAutoGenerateTeamEvaluation } from '@/lib/dd-workbench/team-evaluation'

/**
 * PUT /api/dd/resources/[projectId]/[moduleKey]
 * 保存模块内容：
 * - body: { textBlocks: [{ content }] } 文本框（全量覆盖保存）
 * - body: { conclusion: string } 人工结论（回答模块核心问题，进入正式报告）
 */
export async function PUT(
  request: Request,
  { params }: { params: { projectId: string; moduleKey: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const currentUser: PermissionUser = { id: session.user.id, role: session.user.role as UserRole }

    const { projectId, moduleKey } = params
    if (!isValidModuleKey(moduleKey)) {
      return NextResponse.json({ error: `无效的模块标识: ${moduleKey}` }, { status: 400 })
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { createdById: true, members: { select: { userId: true } } },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })

    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权编辑该项目' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      textBlocks?: Array<{ content?: string }>
      conclusion?: string
    }

    const record = await upsertModuleResource(projectId, moduleKey)

    // 人工结论（单独保存，不覆盖文本框）
    if (typeof body.conclusion === 'string') {
      await prisma.dDModuleResource.update({
        where: { id: record.id },
        data: { conclusion: body.conclusion.slice(0, 5000) },
      })
      return NextResponse.json({ ok: true })
    }

    const blocks = (Array.isArray(body.textBlocks) ? body.textBlocks : [])
      .map(b => (typeof b?.content === 'string' ? b.content : ''))
      .map(content => content.slice(0, 20000))
    if (blocks.length > 20) {
      return NextResponse.json({ error: '文本框数量超过上限（20 个）' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const textBlocks = blocks.map((content, i) => ({ id: `tb-${Date.now()}-${i}`, content, createdAt: now }))

    await prisma.dDModuleResource.update({
      where: { id: record.id },
      data: { textBlocks: JSON.stringify(textBlocks) },
    })

    // 团队与治理：识别到团队资料（含文本框粘贴的简历截图）且尚无评价表时，自动生成团队评分表（后台执行，不阻塞保存）
    if (moduleKey === 'TEAM_GOVERNANCE') {
      void maybeAutoGenerateTeamEvaluation(projectId)
    }

    return NextResponse.json({ ok: true, count: textBlocks.length })
  } catch (error) {
    console.error('DD textBlocks save error:', error)
    return NextResponse.json({ error: '保存文本内容失败' }, { status: 500 })
  }
}
