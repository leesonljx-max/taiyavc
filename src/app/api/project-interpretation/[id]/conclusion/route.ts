export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { runConclusion } from '@/lib/project-interpretation/runner'
import type { VerifyResult } from '@/lib/project-interpretation/constants'

/** 生成综合结论所需的最低已覆盖（非 UNCOVERED）问题数 */
const MIN_VERIFIED = 3

/**
 * POST /api/project-interpretation/[id]/conclusion
 * 汇总已校验问题的差距分析，生成综合分析结论（固定模板 v1）
 * 前置：≥3 个问题已被访谈覆盖（UNCOVERED 不计入）；批量校验完成后会自动调用
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

    const record = await prisma.projectInterpretation.findUnique({
      where: { id: params.id },
      include: { questions: { orderBy: { order: 'asc' } } },
    })
    if (!record || record.userId !== session.user.id) {
      return NextResponse.json({ error: '记录不存在' }, { status: 404 })
    }

    const verified = record.questions
      .filter(q => q.verifyStatus === 'VERIFIED' && q.verifyResultJson)
      .map(q => ({
        question: q.question,
        category: q.category,
        idealAnswer: q.idealAnswer,
        verifyResult: JSON.parse(q.verifyResultJson!) as VerifyResult,
      }))
      // 访谈未涉及的问题不计入综合结论
      .filter(v => v.verifyResult.matchLevel !== 'UNCOVERED')

    if (verified.length < MIN_VERIFIED) {
      return NextResponse.json(
        { error: `至少需要 ${MIN_VERIFIED} 个问题被访谈覆盖后才能生成综合结论（当前 ${verified.length} 个）` },
        { status: 400 }
      )
    }

    const conclusion = await runConclusion({
      projectName: record.projectName,
      verified,
    })

    await prisma.projectInterpretation.update({
      where: { id: record.id },
      data: { conclusionJson: JSON.stringify(conclusion) },
    })

    return NextResponse.json({ conclusion })
  } catch (error) {
    console.error('Conclusion generation error:', error)
    return NextResponse.json({ error: '生成综合结论失败' }, { status: 500 })
  }
}
