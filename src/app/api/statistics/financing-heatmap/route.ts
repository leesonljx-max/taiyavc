export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { searchWeb } from '@/lib/tavily-search'

/**
 * GET /api/statistics/financing-heatmap?year=2026
 * 返回缓存的融资热点图数据（所有用户共享缓存）
 *
 * POST /api/statistics/financing-heatmap?year=2026
 * 刷新：Tavily 搜索各行业融资信息 → DeepSeek 分析 → 缓存
 */

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const currentYear = new Date().getFullYear()
    const yearParam = searchParams.get('year')
    const year = yearParam ? parseInt(yearParam, 10) : currentYear
    const validYear = isNaN(year) ? currentYear : year

    // 可用年份（从所有项目中提取，不按用户权限过滤）
    const allProjects = await prisma.project.findMany({
      select: { targetDate: true },
    })
    const yearsSet = new Set<number>()
    allProjects.forEach(p => {
      if (p.targetDate) yearsSet.add(new Date(p.targetDate).getFullYear())
    })
    yearsSet.add(currentYear)
    const years = Array.from(yearsSet).sort((a, b) => b - a)

    // 先读缓存（缓存是所有用户共享的，cron 自动刷新）
    const cacheKey = `heatmap:${validYear}`
    const cached = await prisma.aICache.findUnique({ where: { cacheKey } })

    if (cached) {
      const cachedData = JSON.parse(cached.data)
      const cacheAge = Date.now() - cached.updatedAt.getTime()
      const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000
      const isCacheValid = cacheAge < ONE_MONTH_MS

      return NextResponse.json({
        year: validYear,
        years,
        ...cachedData,
        cachedAt: cached.updatedAt,
        cacheAge: Math.floor(cacheAge / (24 * 60 * 60 * 1000)),
        isCacheValid,
        message: isCacheValid
          ? undefined
          : '缓存已超过 1 个月，建议点击刷新按钮更新数据',
      })
    }

    // 无缓存，返回空数据提示用户刷新
    return NextResponse.json({
      year: validYear,
      years,
      heatData: [],
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

    const { searchParams } = new URL(request.url)
    const currentYear = new Date().getFullYear()
    const yearParam = searchParams.get('year')
    const year = yearParam ? parseInt(yearParam, 10) : currentYear
    const validYear = isNaN(year) ? currentYear : year

    // 获取所有项目的行业（不按用户权限过滤，与 cron 一致）
    const allProjects = await prisma.project.findMany({
      select: { targetDate: true, industry: true },
    })
    const yearsSet = new Set<number>()
    allProjects.forEach(p => {
      if (p.targetDate) yearsSet.add(new Date(p.targetDate).getFullYear())
    })
    yearsSet.add(currentYear)
    const years = Array.from(yearsSet).sort((a, b) => b - a)

    const yearFiltered = allProjects.filter(
      p => p.targetDate && new Date(p.targetDate).getFullYear() === validYear
    )
    const industriesSet = new Set<string>()
    yearFiltered.forEach(p => {
      const ind = p.industry?.trim()
      if (ind) industriesSet.add(ind)
    })
    const industries = Array.from(industriesSet)

    if (industries.length === 0) {
      return NextResponse.json({
        year: validYear,
        years,
        heatData: [],
        message: '该年份暂无行业数据',
      })
    }

    // 检查缓存是否在 1 个月内（force 参数可强制刷新）
    const body = await request.json().catch(() => ({}))
    const forceRefresh = body.force === true
    const cacheKey = `heatmap:${validYear}`

    if (!forceRefresh) {
      const existingCache = await prisma.aICache.findUnique({ where: { cacheKey } })
      if (existingCache) {
        const cacheAge = Date.now() - existingCache.updatedAt.getTime()
        const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000
        if (cacheAge < ONE_MONTH_MS) {
          const cachedData = JSON.parse(existingCache.data)
          return NextResponse.json({
            year: validYear,
            years,
            ...cachedData,
            cachedAt: existingCache.updatedAt,
            cacheAge: Math.floor(cacheAge / (24 * 60 * 60 * 1000)),
            message: `缓存仍在有效期内（${Math.floor(cacheAge / (24 * 60 * 60 * 1000))} 天前生成），1 个月内不会重新调用 API。如需强制刷新，请传 force: true`,
          })
        }
      }
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

    // 3. 缓存结果（cacheKey 已在前面定义）
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
