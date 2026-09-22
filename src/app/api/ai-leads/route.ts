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
    const keyword = (searchParams.get('keyword') || '').trim().slice(0, 100)
    const releasedParam = searchParams.get('released')
    // status 筛选（与前端 filter 语义一致）：released=已释放且未转化 / locked=未释放且未转化 / converted=已转化
    const statusParam = searchParams.get('status')

    // 权限 where（stats 计数也基于此，不含 keyword/status 筛选）
    const permissionConditions: any[] = [{ source: 'AI' }]

    // 权限矩阵：
    // - ADMIN / INVESTMENT_PARTNER: 查看全部
    // - INVESTMENT_MANAGER / POST_INVESTMENT_OFFICER:
    //     scope=all → 已释放的全部 + 自己的未释放
    //     scope=mine → 仅自己的
    // - 其他: 仅自己创建的
    if (currentUser.role === 'ADMIN' || currentUser.role === 'INVESTMENT_PARTNER') {
      // 全部可见
    } else if (scope === 'mine') {
      permissionConditions.push({ createdById: currentUser.id })
    } else {
      // scope=all 且非管理员：已释放的全部 + 自己的未释放
      permissionConditions.push({
        OR: [
          { releasedAt: { not: null } },
          { createdById: currentUser.id },
        ],
      })
    }
    const permissionWhere = permissionConditions.length === 1
      ? permissionConditions[0]
      : { AND: permissionConditions }

    // 列表 where = 权限 AND (keyword | status)
    const conditions: any[] = [...permissionConditions]
    if (keyword) {
      conditions.push({
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { industry: { contains: keyword, mode: 'insensitive' } },
          { companyPosition: { contains: keyword, mode: 'insensitive' } },
          { mainProducts: { contains: keyword, mode: 'insensitive' } },
          { fundingRound: { contains: keyword, mode: 'insensitive' } },
          { coreAdvantage: { contains: keyword, mode: 'insensitive' } },
        ],
      })
    }

    if (statusParam === 'released') {
      conditions.push({ AND: [{ releasedAt: { not: null } }, { status: { not: 'CONVERTED' } }] })
    } else if (statusParam === 'locked') {
      conditions.push({ AND: [{ releasedAt: null }, { status: { not: 'CONVERTED' } }] })
    } else if (statusParam === 'converted') {
      conditions.push({ status: 'CONVERTED' })
    } else if (releasedParam === 'true') {
      // 旧参数兼容（status 优先）
      conditions.push({ releasedAt: { not: null } })
    } else if (releasedParam === 'false') {
      conditions.push({ releasedAt: null })
    }

    const where = conditions.length === 1 ? conditions[0] : { AND: conditions }

    // 分页参数（不传 page = 兼容全量模式）
    const pageParam = searchParams.get('page')
    const paged = pageParam !== null && pageParam.trim() !== ''
    const page = Math.max(1, parseInt(pageParam || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '30', 10) || 30))

    // stats：权限基础集上的四象限计数（与前端统计卡片语义一致）
    const [leads, total, stats] = await Promise.all([
      prisma.projectLead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...(paged ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
        include: {
          createdBy: { select: { id: true, name: true } },
        },
      }),
      prisma.projectLead.count({ where }),
      (async () => {
        const [totalCount, releasedCount, lockedCount, convertedCount] = await Promise.all([
          prisma.projectLead.count({ where: permissionWhere }),
          prisma.projectLead.count({
            where: { AND: [permissionWhere, { releasedAt: { not: null } }, { status: { not: 'CONVERTED' } }] },
          }),
          prisma.projectLead.count({
            where: { AND: [permissionWhere, { releasedAt: null }, { status: { not: 'CONVERTED' } }] },
          }),
          prisma.projectLead.count({
            where: { AND: [permissionWhere, { status: 'CONVERTED' }] },
          }),
        ])
        return { total: totalCount, released: releasedCount, locked: lockedCount, converted: convertedCount }
      })(),
    ])

    return NextResponse.json({
      leads,
      total,
      page: paged ? page : 1,
      pageSize: paged ? pageSize : total,
      scope,
      stats,
    })
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
