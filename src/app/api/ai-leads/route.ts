export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { type PermissionUser } from '@/lib/permissions'
import { runAIRetrieval } from '@/lib/ai-lead-retrieval'

/**
 * AI 项目线索 API
 *
 * GET  /api/ai-leads          列表（按权限过滤）
 *      ?scope=all|mine        all=已释放的全部 + 自己的未释放；mine=仅自己的
 *      ?keyword=xxx            关键词搜索
 *      ?released=true|false    是否已释放
 *
 * POST /api/ai-leads          触发 AI 检索任务
 *      Body: { trigger?: boolean }
 */

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope') === 'mine' ? 'mine' : 'all'
    const keyword = searchParams.get('keyword')?.trim() || ''
    const releasedParam = searchParams.get('released')

    const where: any = { source: 'AI' }

    // 权限矩阵：
    // - ADMIN / INVESTMENT_PARTNER: 查看全部
    // - INVESTMENT_MANAGER / POST_INVESTMENT_OFFICER:
    //     scope=all → 已释放的全部 + 自己的未释放
    //     scope=mine → 仅自己的
    // - 其他: 仅自己创建的
    if (currentUser.role === 'ADMIN' || currentUser.role === 'INVESTMENT_PARTNER') {
      // 全部可见
    } else if (scope === 'mine') {
      where.createdById = currentUser.id
    } else {
      // scope=all 且非管理员：已释放的全部 + 自己的未释放
      where.OR = [
        { releasedAt: { not: null } },
        { createdById: currentUser.id },
      ]
    }

    if (keyword) {
      const kwCond = {
        OR: [
          { name: { contains: keyword } },
          { industry: { contains: keyword } },
          { companyPosition: { contains: keyword } },
          { mainProducts: { contains: keyword } },
          { fundingRound: { contains: keyword } },
          { coreAdvantage: { contains: keyword } },
        ],
      }
      if (where.OR) {
        // 组合：((released OR mine) AND (keywordCond))
        where.AND = [kwCond]
      } else {
        where.OR = kwCond.OR
      }
    }

    if (releasedParam === 'true') {
      where.releasedAt = { not: null }
    } else if (releasedParam === 'false') {
      where.releasedAt = null
    }

    const leads = await prisma.projectLead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ leads, scope })
  } catch (error) {
    console.error('AI leads GET error:', error)
    return NextResponse.json(
      { error: '获取 AI 线索列表失败' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const role = session.user.role as UserRole

    // 权限：仅 ADMIN / INVESTMENT_PARTNER 可触发检索
    if (role !== 'ADMIN' && role !== 'INVESTMENT_PARTNER') {
      return NextResponse.json(
        { error: '无权触发 AI 检索任务' },
        { status: 403 }
      )
    }

    // 校验 DeepSeek API Key 是否已配置
    if (!process.env.DEEPSEEK_API_KEY) {
      return NextResponse.json(
        { error: 'DeepSeek API Key 未配置，请在 .env 中设置 DEEPSEEK_API_KEY' },
        { status: 500 }
      )
    }

    // 异步触发检索（不等待完成，避免请求超时）
    // 但要返回检索结果摘要，所以同步等待
    const result = await runAIRetrieval(session.user.id)

    return NextResponse.json({
      success: true,
      result,
    })
  } catch (error) {
    console.error('AI retrieval trigger error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '触发 AI 检索失败',
      },
      { status: 500 }
    )
  }
}
