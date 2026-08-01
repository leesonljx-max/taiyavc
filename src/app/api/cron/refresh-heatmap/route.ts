export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { authorizeCronRequest, unauthorizedResponse } from '@/lib/cron-auth'
import { searchWeb } from '@/lib/tavily-search'

/**
 * 定时刷新融资热点图数据
 *
 * GET /api/cron/refresh-heatmap?token=XXX
 * POST /api/cron/refresh-heatmap  (Body: { token: "XXX" })
 *
 * 定时计划：每月 1 号早上 6:00 执行
 * 使用方式（Linux crontab）：
 *   0 6 1 * * curl -s "http://localhost:3000/api/cron/refresh-heatmap?token=$CRON_SECRET"
 *
 * 缓存策略：
 * - 融资热点图数据 1 个月内不重新调用 API
 * - 此 cron 每月刷新一次，保证数据不会太旧
 * - 所有用户共享缓存
 */

/**
 * 获取所有项目涉及的行业（不限用户权限，cron 无用户上下文）
 */
async function getAllIndustries(year: number): Promise<string[]> {
  const allProjects = await prisma.project.findMany({
    select: {
      industry: true,
      targetDate: true,
    },
  })

  const yearFiltered = allProjects.filter(
    p => p.targetDate && new Date(p.targetDate).getFullYear() === year
  )

  const industriesSet = new Set<string>()
  yearFiltered.forEach(p => {
    const ind = p.industry?.trim()
    if (ind) industriesSet.add(ind)
  })

  return Array.from(industriesSet)
}

/**
 * 刷新指定年份的融资热点图数据
 */
async function refreshHeatmap(year: number): Promise<{ success: boolean; heatDataCount: number; message: string }> {
  const industries = await getAllIndustries(year)

  if (industries.length === 0) {
    return { success: false, heatDataCount: 0, message: `${year} 年暂无行业数据` }
  }

  // 1. 用 Tavily 并发搜索各行业融资信息
  const searchPromises = industries.map(ind =>
    searchWeb(`${ind} 融资 ${year} 年`, { maxResults: 3 })
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
    return { success: false, heatDataCount: 0, message: 'DeepSeek API Key 未配置' }
  }

  const prompt = `你是一个资深的投资分析师。请根据以下各行业的搜索结果，分析 ${year} 年各行业赛道的融资热度。

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
        max_tokens: 8000,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    return { success: false, heatDataCount: 0, message: `DeepSeek API 调用失败: ${response.status}` }
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
    const repaired = content
      .replace(/<think>[\s\S]*?<\/think>/g, '')  // 移除 DeepSeek 思考标签
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
    if (heatData.length === 0) {
      console.error('[Cron refresh-heatmap] DeepSeek 返回内容前500字符:', content.substring(0, 500))
    }
  } catch {
    console.error('[Cron refresh-heatmap] Failed to parse DeepSeek response, 前500字符:', content.substring(0, 500))
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
  const cacheKey = `heatmap:${year}`
  const cacheData = JSON.stringify({ heatData, totalIndustries: industries.length })

  await prisma.aICache.upsert({
    where: { cacheKey },
    create: { cacheKey, data: cacheData },
    update: { data: cacheData },
  })

  return { success: true, heatDataCount: heatData.length, message: `融资热点图刷新成功，共 ${heatData.length} 个行业` }
}

export async function GET(request: Request) {
  try {
    if (!authorizeCronRequest(request)) {
      return unauthorizedResponse()
    }

    console.log('[Cron] 融资热点图刷新开始:', new Date().toISOString())
    const currentYear = new Date().getFullYear()
    const result = await refreshHeatmap(currentYear)
    console.log('[Cron] 融资热点图刷新完成:', result.message)

    return NextResponse.json({
      success: result.success,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Cron] 融资热点图刷新失败:', error)
    return NextResponse.json(
      { success: false, error: '刷新融资热点图失败' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    if (!authorizeCronRequest(request)) {
      return unauthorizedResponse()
    }

    console.log('[Cron] 融资热点图刷新开始 (POST):', new Date().toISOString())
    const currentYear = new Date().getFullYear()
    const result = await refreshHeatmap(currentYear)
    console.log('[Cron] 融资热点图刷新完成:', result.message)

    return NextResponse.json({
      success: result.success,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Cron] 融资热点图刷新失败:', error)
    return NextResponse.json(
      { success: false, error: '刷新融资热点图失败' },
      { status: 500 }
    )
  }
}
