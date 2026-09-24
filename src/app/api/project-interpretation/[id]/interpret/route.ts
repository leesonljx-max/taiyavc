export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { runInterpretation } from '@/lib/project-interpretation/runner'

/**
 * POST /api/project-interpretation/[id]/interpret
 * 执行"解读项目"：七维解读 + 联网检索行业融资案例（固定模板 v1）
 * 可重复执行（覆盖旧解读）
 */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const record = await prisma.projectInterpretation.findUnique({ where: { id: params.id } })
    if (!record || record.userId !== session.user.id) {
      return NextResponse.json({ error: '记录不存在' }, { status: 404 })
    }
    if (record.status === 'INTERPRETING') {
      return NextResponse.json({ error: '解读进行中，请稍候' }, { status: 400 })
    }

    await prisma.projectInterpretation.update({
      where: { id: record.id },
      data: { status: 'INTERPRETING', error: null },
    })

    try {
      const result = await runInterpretation({
        projectName: record.projectName,
        documentText: record.documentText || '',
      })
      await prisma.projectInterpretation.update({
        where: { id: record.id },
        data: { status: 'INTERPRETED', interpretationJson: JSON.stringify(result), error: null },
      })
      return NextResponse.json({ interpretation: result })
    } catch (err) {
      const message = err instanceof Error ? err.message : '解读失败'
      await prisma.projectInterpretation.update({
        where: { id: record.id },
        data: { status: 'FAILED', error: message },
      })
      return NextResponse.json({ error: message }, { status: 502 })
    }
  } catch (error) {
    console.error('Interpret run error:', error)
    return NextResponse.json({ error: '解读执行失败' }, { status: 500 })
  }
}
