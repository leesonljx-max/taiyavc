export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

/**
 * GET /api/project-interpretation
 * 我的解读项目列表（新→旧），含问题/校验进度统计
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const records = await prisma.projectInterpretation.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        projectName: true,
        fileName: true,
        status: true,
        questionsStatus: true,
        error: true,
        createdAt: true,
        updatedAt: true,
        interpretationJson: true,
        questions: {
          select: { id: true, category: true, verifyStatus: true },
        },
      },
    })

    return NextResponse.json({
      interpretations: records.map(r => {
        let industry: string | null = null
        if (r.interpretationJson) {
          try {
            industry = (JSON.parse(r.interpretationJson) as { industry?: string }).industry || null
          } catch {
            industry = null
          }
        }
        return {
          id: r.id,
          projectName: r.projectName,
          industry,
          fileName: r.fileName,
          status: r.status,
          questionsStatus: r.questionsStatus,
          error: r.error,
          createdAt: r.createdAt.toISOString(),
          questionCount: r.questions.length,
          verifiedCount: r.questions.filter(q => q.verifyStatus === 'VERIFIED').length,
        }
      }),
    })
  } catch (error) {
    console.error('Project interpretation list error:', error)
    return NextResponse.json({ error: '获取列表失败' }, { status: 500 })
  }
}
