export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/dd-research/api-auth'
import { refreshGapsForProject } from '@/lib/dd-research/gap'

/**
 * PATCH /api/dd/research/facts/[factId]
 * 维护人确认/排除研究事实
 */
export async function PATCH(
  request: Request,
  { params }: { params: { factId: string } }
) {
  try {
    const fact = await prisma.dDResearchFact.findUnique({
      where: { id: params.factId },
      include: { run: { select: { projectId: true } } },
    })
    if (!fact) return NextResponse.json({ error: '事实不存在' }, { status: 404 })

    const access = await requireProjectAccess(fact.run.projectId, 'edit')
    if (!access.ok) return access.response

    const body = await request.json().catch(() => ({})) as { status?: unknown }
    const status = String(body.status || '')
    if (status !== 'CONFIRMED' && status !== 'REJECTED' && status !== 'PENDING') {
      return NextResponse.json({ error: 'status 仅支持 CONFIRMED / REJECTED / PENDING' }, { status: 400 })
    }

    const updated = await prisma.dDResearchFact.update({
      where: { id: params.factId },
      data: { status },
    })
    await refreshGapsForProject(fact.run.projectId)

    return NextResponse.json({ fact: updated })
  } catch (error) {
    console.error('[dd-research] 更新事实失败:', error)
    return NextResponse.json({ error: '更新事实失败' }, { status: 500 })
  }
}
