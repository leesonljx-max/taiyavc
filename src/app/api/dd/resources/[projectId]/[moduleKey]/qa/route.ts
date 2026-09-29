export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canViewResearchProject, canEditResearchProject } from '@/lib/research-permissions'
import { upsertModuleResource, isValidModuleKey } from '@/lib/dd-workbench/resources'

/**
 * GET /api/dd/resources/[projectId]/[moduleKey]/qa
 * 模块问答列表（投委会合伙人发布的问题 + 维护人回答，含账户名）
 */
export async function GET(
  _request: Request,
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
    if (!canViewResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权查看该项目' }, { status: 403 })
    }

    const qas = await prisma.dDModuleQA.findMany({
      where: { projectId, moduleKey },
      include: {
        questioner: { select: { id: true, name: true, email: true } },
        answerer: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      questions: qas.map(q => ({
        id: q.id,
        question: q.question,
        questionerName: q.questioner.name || q.questioner.email,
        createdAt: q.createdAt.toISOString(),
        answer: q.answer,
        answererName: q.answerer?.name || q.answerer?.email || null,
        answeredAt: q.answeredAt?.toISOString() || null,
      })),
    })
  } catch (error) {
    console.error('DD qa list error:', error)
    return NextResponse.json({ error: '获取问答失败' }, { status: 500 })
  }
}

/**
 * POST /api/dd/resources/[projectId]/[moduleKey]/qa
 * 提问（仅投资合伙人/管理员——投委会发布问题）
 * body: { question: string }
 * 回答（维护人/合伙人/管理员）：body: { qaId: string, answer: string }
 */
export async function POST(
  request: Request,
  { params }: { params: { projectId: string; moduleKey: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const role = session.user.role
    const currentUser: PermissionUser = { id: session.user.id, role: role as UserRole }

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
      return NextResponse.json({ error: '无权操作该项目' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as { question?: string; qaId?: string; answer?: string }

    // ── 回答分支 ──
    if (body.qaId) {
      const answer = String(body.answer || '').trim()
      if (!answer) return NextResponse.json({ error: '回答内容不能为空' }, { status: 400 })
      const qa = await prisma.dDModuleQA.findUnique({ where: { id: body.qaId } })
      if (!qa || qa.projectId !== projectId || qa.moduleKey !== moduleKey) {
        return NextResponse.json({ error: '问题不存在' }, { status: 404 })
      }
      await prisma.dDModuleQA.update({
        where: { id: qa.id },
        data: { answer: answer.slice(0, 2000), answererId: session.user.id, answeredAt: new Date() },
      })
      return NextResponse.json({ ok: true })
    }

    // ── 提问分支（仅投委会：投资合伙人/管理员） ──
    if (role !== 'INVESTMENT_PARTNER' && role !== 'ADMIN') {
      return NextResponse.json({ error: '仅投资合伙人（投委会）可发布问题' }, { status: 403 })
    }
    const question = String(body.question || '').trim()
    if (!question) return NextResponse.json({ error: '问题内容不能为空' }, { status: 400 })

    await upsertModuleResource(projectId, moduleKey)
    await prisma.dDModuleQA.create({
      data: {
        projectId,
        moduleKey,
        questionerId: session.user.id,
        question: question.slice(0, 1000),
      },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DD qa post error:', error)
    return NextResponse.json({ error: '发布/回答失败' }, { status: 500 })
  }
}
