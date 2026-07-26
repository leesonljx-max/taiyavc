export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, canEditProject, type PermissionUser } from '@/lib/permissions'
import { searchWeb } from '@/lib/tavily-search'

/**
 * GET /api/statistics/financing-heatmap?year=2026
 * 返回缓存的融资热点图数据（所有用户共享缓存）
 *
 * POST /api/statistics/financing-heatmap?year=2026
 * 刷新：Tavily 搜索各行业融资信息 → DeepSeek 分析 → 缓存
 */

/** 获取可见项目的行业列表和年份 */
async function getVisibleIndustries(currentUser: PermissionUser, year: number) {
  const allProjects = await prisma.project.findMany({
    select: {
      industry: true,
      targetDate: true,
      followStage: true,
      createdById: true,
      members: { select: { userId: true } },
    },
  })

  const visibleProjects = allProjects.filter(project => {
    const memberIds = project.members.map(m => m.userId)
    return canViewProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })
  })

  // 可用年份
  const yearsSet = new Set<number>()
  visibleProjects.forEach(p => {
    if (p.targetDate) yearsSet.add(new Date(p.targetDate).getFullYear())
  })
  yearsSet.add(new Date().getFullYear())
  const years = Array.from(yearsSet).sort((a, b) => b - a)

  // 按年份筛选
  const yearFiltered = visibleProjects.filter(
    p => p.targetDate && new Date(p.targetDate).getFullYear() === year
  )

  // 提取行业
  const industriesSet = new Set<string>()
  yearFiltered.forEach(p => {
    const ind = p.industry?.trim()
    if (ind) industriesSet.add(ind)
  })

  return { industries: Array.from(industriesSet), years }
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const { searchParams } = new URL(request.url)
    const currentYear = new Date().getFullYear()
    const yearParam = searchParams.get('year')
    const year = yearParam ? parseInt(yearParam, 10) : currentYear
    const validYear = isNaN(year) ? currentYear : year

    const { industries, years } = await getVisibleIndustries(currentUser, validYear)

    if (industries.length === 0) {
      return NextResponse.json({
        year: validYear,
        years,
        heatData: [],
        message: '该年份暂无行业数据',
      })
    }

    // 检查缓存
    const cacheKey = `heatmap:${validYear}`
    const cached = await prisma.aICache.findUnique({ where: { cacheKey } })

    if (cached) {
      const cachedData = JSON.parse(cached.data)
      return NextResponse.json({
        year: validYear,
        years,
        ...cachedData,
        cachedAt: cached.updatedAt,
      })
    }

    // 无缓存，返回空数据提示用户刷新
    return NextResponse.json({
      year: validYear,
      years,
      heatData: [],
      totalIndustries: industries.length,
      message: '暂无融资热点数据，请点击刷新按钮生成',
    })
  } catch (error) {
    console.error('Financing heatmap GET error:', error)
    return NextResponse.json(
      { error: '获取融资热点数据失败' },
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

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const { searchParams } = new URL(request.url)
    const currentYear = new Date().getFullYear()
    const yearParam = searchParams.get('year')
    const year = yearParam ? parseInt(yearParam, 10) : currentYear
    const validYear = isNaN(year) ? currentYear : year

    const { industries, years } = await getVisibleIndustries(currentUser, validYear)

    if (industries.length === 0) {
      return NextResponse.json({
        year: validYear,
        years,
        heatData: [],
        message: '该年份暂无行业数据',
      })
    }

    // 1. 用 Tavily 并发搜索各行业融资信息
    const searchPromises = industries.map(ind =>
      searchWeb(`${ind} 融资 ${validYear} 年`, { maxResults: 3 })
    )
    const searchArrays = await Promise.all(searchPromises)
    const searchByIndustry = industries.map((ind, i) => ({
      industry: ind,
      results: searchArrays[i],
    }))

    // 2. 构建 DeepSeek prompt
    const industrySearchInfo = searchByIndustry
      .map(({ industry, results }) => {
        const snippets = results
          .map((r, j) => `[${j + 1}] ${r.title}\n${r.content.substring(0, 300)}`)
          .join('\n')
        return `【${industry}】\n${snippets || '未找到相关搜索结果'}`
      })
      .join('\n\n')

    const deepseekApiKey = process.env.DEEPSEEK_API_KEY
    if (!deepseekApiKey) {
      return NextResponse.json(
        { error: 'DeepSeek API Key 未配置' },
        { status: 500 }
      )
    }

    const prompt = `你是一个资深的投资分析师。请根据以下各行业的搜索结果，分析 ${validYear} 年各行业赛道的融资热度。

外网搜索结果：
${industrySearchInfo}

任务要求：
1. 针对每个行业，基于搜索结果分析融资热度
2. 每个行业提供以下信息：
   - industry: 行业名称
   - financingCount: 该行业融资事件数量（估算值）
   - totalAmount: 融资总金额（估算值，格式如"约50亿元"）
   - heatLevel: 融资热度等级（1-5，5为最热）
   - notableCompanies: 代表性公司（2-4个，用顿号分隔）
   - summary: 一句话总结（不超过60字）

请严格按 JSON 格式输出：
{"heatData":[{"industry":"行业","financingCount":30,"totalAmount":"约50亿元","heatLevel":4,"notableCompanies":"公司A、公司B","summary":"摘要"}]}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)

    let response: Response
    try {
      response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [
            {
              role: 'system',
              content: '你是一个专业的投资分析助手，擅长行业融资趋势分析。',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.3,
          max_tokens: 2000,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: 'DeepSeek API 调用失败' },
        { status: 502 }
      )
    }

    const aiData = await response.json()
    const content = aiData.choices?.[0]?.message?.content || ''

    let heatData: Array<{
      industry: string
      financingCount: number
      totalAmount: string
      heatLevel: number
      notableCompanies: string
      summary: string
    }> = []

    try {
      // 使用 repairJson 容错处理 DeepSeek 返回的常见格式问题
      const repaired = content
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .replace(/,(\s*[}\]])/g, '$1')
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .trim()
      const jsonMatch = repaired.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        heatData = parsed.heatData || []
      }
    } catch {
      console.error('Failed to parse DeepSeek response:', content)
    }

    // 补全缺失行业
    const returnedIndustries = new Set(heatData.map(h => h.industry))
    for (const ind of industries) {
      if (!returnedIndustries.has(ind)) {
        heatData.push({
          industry: ind,
          financingCount: 0,
          totalAmount: '暂无数据',
          heatLevel: 0,
          notableCompanies: '暂无',
          summary: '暂无该行业的融资数据',
        })
      }
    }

    heatData.sort((a, b) => b.heatLevel - a.heatLevel)

    // 3. 缓存结果
    const cacheKey = `heatmap:${validYear}`
    const cacheData = JSON.stringify({ heatData, totalIndustries: industries.length })

    await prisma.aICache.upsert({
      where: { cacheKey },
      create: { cacheKey, data: cacheData },
      update: { data: cacheData },
    })

    return NextResponse.json({
      year: validYear,
      years,
      heatData,
      totalIndustries: industries.length,
      refreshedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Financing heatmap POST error:', error)
    return NextResponse.json(
      { error: '刷新融资热点数据失败' },
      { status: 500 }
    )
  }
}
