export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

/**
 * GET /api/project-interpretation
 * 我的解读项目列表（新→旧），含问题/校验进度统计 + 卡片展示字段
 * （行业/公司定位摘要/校验状态/是否已创建项目库）
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
        verifyStatus: true,
        conclusionJson: true,
        linkedProjectId: true,
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
        let marketPosition: string | null = null
        if (r.interpretationJson) {
          try {
            const parsed = JSON.parse(r.interpretationJson) as { industry?: string; marketPosition?: string }
            industry = parsed.industry || null
            marketPosition = parsed.marketPosition ? parsed.marketPosition.replace(/\*\*/g, '').slice(0, 60) : null
          } catch {
            industry = null
          }
        }
        return {
          id: r.id,
          projectName: r.projectName,
          industry,
          marketPosition,
          fileName: r.fileName,
          status: r.status,
          questionsStatus: r.questionsStatus,
          verifyStatus: r.verifyStatus,
          hasConclusion: !!r.conclusionJson,
          linkedProjectId: r.linkedProjectId,
          error: r.error,
          createdAt: r.createdAt.toISOString(),
          questionCount: r.questions.length,
          verifiedCount: r.questions.filter(q => q.verifyStatus === 'VERIFIED').length,
        }
      }),
    })
  } catch (error) {
    console.error('Project interpretation list error:', error)
    // 透传具体错误（如 Prisma P2021 表不存在），便于部署环境排查数据库问题
    const detail = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ error: `获取列表失败：${detail}` }, { status: 500 })
  }
}
