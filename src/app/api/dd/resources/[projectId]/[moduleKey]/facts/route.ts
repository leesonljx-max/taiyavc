export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { upsertModuleResource, isValidModuleKey, type DDFact } from '@/lib/dd-workbench/resources'

/**
 * PUT /api/dd/resources/[projectId]/[moduleKey]/facts
 * 更新事实卡条目状态（维护人确认/标记冲突/重置待确认）
 * body: { factId: string, status: 'PENDING' | 'CONFIRMED' | 'CONFLICT' }
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

    const body = (await request.json().catch(() => ({}))) as { factId?: string; status?: string }
    const factId = String(body.factId || '')
    const status = String(body.status || '')
    if (!factId || !['PENDING', 'CONFIRMED', 'CONFLICT'].includes(status)) {
      return NextResponse.json({ error: '参数无效（factId + status: PENDING/CONFIRMED/CONFLICT）' }, { status: 400 })
    }

    const record = await prisma.dDModuleResource.findUnique({
      where: { projectId_moduleKey: { projectId, moduleKey } },
    })
    if (!record?.analysisJson) {
      return NextResponse.json({ error: '该模块尚未分析，无事实卡' }, { status: 400 })
    }
    let facts: DDFact[]
    let analyzedAt: string
    try {
      const parsed = JSON.parse(record.analysisJson) as { facts?: DDFact[]; analyzedAt?: string }
      facts = Array.isArray(parsed.facts) ? parsed.facts : []
      analyzedAt = parsed.analyzedAt || new Date().toISOString()
    } catch {
      return NextResponse.json({ error: '事实卡数据损坏' }, { status: 500 })
    }
    const target = facts.find(f => f.id === factId)
    if (!target) return NextResponse.json({ error: '事实条目不存在' }, { status: 404 })

    target.status = status as DDFact['status']
    await prisma.dDModuleResource.update({
      where: { id: record.id },
      data: { analysisJson: JSON.stringify({ facts, actions: (JSON.parse(record.analysisJson) as { actions?: string[] }).actions || [], analyzedAt }) },
    })

    return NextResponse.json({ ok: true, fact: target })
  } catch (error) {
    console.error('DD fact update error:', error)
    return NextResponse.json({ error: '更新事实状态失败' }, { status: 500 })
  }
}
