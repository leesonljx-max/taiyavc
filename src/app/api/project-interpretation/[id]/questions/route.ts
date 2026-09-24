export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { runQuestionGeneration } from '@/lib/project-interpretation/runner'
import type { InterpretationResult } from '@/lib/project-interpretation/constants'

/**
 * POST /api/project-interpretation/[id]/questions
 * 执行"生成问题清单"：15-20 问（技术 ≥10）+ 每题理想答案（固定模板 v1）
 * 与"解读项目"无逻辑承接：可直接生成（有解读结果时作为补充上下文）；
 * 可重复执行（覆盖旧清单，已校验结果一并清除）
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
    if (record.questionsStatus === 'GENERATING') {
      return NextResponse.json({ error: '问题清单生成中，请稍候' }, { status: 400 })
    }

    // 解读结果可选：存在且合法时作为问题生成的补充上下文
    let interpretation: InterpretationResult | null = null
    if (record.interpretationJson) {
      try {
        interpretation = JSON.parse(record.interpretationJson)
      } catch {
        interpretation = null
      }
    }

    await prisma.projectInterpretation.update({
      where: { id: record.id },
      data: { questionsStatus: 'GENERATING', error: null },
    })

    try {
      const questions = await runQuestionGeneration({
        projectName: record.projectName,
        documentText: record.documentText || '',
        interpretation,
      })

      // 覆盖式重建（事务：删旧建新；重新生成问题后旧校验结果作废）
      const saved = await prisma.$transaction(async tx => {
        await tx.interpretationQuestion.deleteMany({ where: { interpretationId: record.id } })
        await tx.interpretationQuestion.createMany({
          data: questions.map((q, i) => ({
            interpretationId: record.id,
            order: i + 1,
            category: q.category,
            question: q.question,
            idealAnswer: q.idealAnswer,
          })),
        })
        await tx.projectInterpretation.update({
          where: { id: record.id },
          data: {
            questionsStatus: 'READY',
            conclusionJson: null,
            verifyStatus: 'PENDING',
            interviewFileName: null,
            interviewFileUrl: null,
            interviewText: null,
            error: null,
          },
        })
        return tx.interpretationQuestion.findMany({
          where: { interpretationId: record.id },
          orderBy: { order: 'asc' },
        })
      })

      return NextResponse.json({
        questions: saved.map(q => ({
          id: q.id,
          order: q.order,
          category: q.category,
          question: q.question,
          idealAnswer: q.idealAnswer,
          verifyStatus: q.verifyStatus,
        })),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '问题清单生成失败'
      await prisma.projectInterpretation.update({
        where: { id: record.id },
        data: { questionsStatus: 'FAILED', error: message },
      })
      return NextResponse.json({ error: message }, { status: 502 })
    }
  } catch (error) {
    console.error('Questions generation error:', error)
    return NextResponse.json({ error: '生成问题清单失败' }, { status: 500 })
  }
}
