export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, type PermissionUser } from '@/lib/permissions'

/**
 * GET /api/statistics/financing-heatmap?year=2026
 * 融资热点图数据：通过 DeepSeek 检索外网融资信息，分析各行业赛道融资热度
 *
 * 流程：
 * 1. 获取该年初聊项目涉及的所有行业
 * 2. 调用 DeepSeek API 检索各行业的外部融资信息
 * 3. 返回每个行业的融资热度数据
 *
 * 返回：{
 *   year, years,
 *   heatData: [{ industry, financingCount, totalAmount, heatLevel, notableCompanies, summary }]
 * }
 */
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

    // 获取所有项目（带权限过滤）
    const allProjects = await prisma.project.findMany({
      select: {
        id: true,
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

    // 可用年份列表
    const yearsSet = new Set<number>()
    visibleProjects.forEach(p => {
      if (p.targetDate) yearsSet.add(new Date(p.targetDate).getFullYear())
    })
    yearsSet.add(currentYear)
    const years = Array.from(yearsSet).sort((a, b) => b - a)

    // 按初聊日期年份筛选
    const yearFilteredProjects = visibleProjects.filter(
      p => p.targetDate && new Date(p.targetDate).getFullYear() === validYear
    )

    // 提取所有行业（去重）
    const industriesSet = new Set<string>()
    yearFilteredProjects.forEach(p => {
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

    // 调用 DeepSeek API 检索外网融资信息
    const deepseekApiKey = process.env.DEEPSEEK_API_KEY
    if (!deepseekApiKey) {
      return NextResponse.json(
        { error: 'DeepSeek API Key 未配置，无法检索融资信息' },
        { status: 500 }
      )
    }

    const prompt = `你是一个资深的投资分析师，擅长行业融资趋势分析。请根据以下行业列表，检索并分析 ${validYear} 年各行业赛道的外部融资信息。

待分析的行业赛道：${industries.join('、')}

任务要求：
1. 针对 EACH 行业，检索 ${validYear} 年该行业的公开融资事件信息
2. 每个行业提供以下信息：
   - industry: 行业名称
   - financingCount: 该行业 ${validYear} 年公开的融资事件数量（估算值）
   - totalAmount: 该行业 ${validYear} 年公开的融资总金额（估算值，格式如 "约50亿元人民币"）
   - heatLevel: 融资热度等级（1-5，5为最热）
   - notableCompanies: 该行业融资活跃的代表性公司（2-4个，用顿号分隔）
   - summary: 一句话总结该行业融资趋势（不超过60字）
3. 热度等级参考：5=极度热门(月均20+融资事件)、4=热门(月均10-20)、3=正常(月均5-10)、2=较冷(月均1-5)、1=冷门(月均<1)
4. 若无法确定具体数字，请给出合理估算并标注"约"字

请严格按照以下 JSON 格式输出，不要包含任何其他文字：
{
  "heatData": [
    {
      "industry": "行业名称",
      "financingCount": 30,
      "totalAmount": "约50亿元人民币",
      "heatLevel": 4,
      "notableCompanies": "公司A、公司B、公司C",
      "summary": "该行业融资活跃，主要集中在早期阶段"
    }
  ]
}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    let response: Response
    try {
      response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: '你是一个专业的投资分析助手，擅长行业融资趋势分析。请基于公开信息作答，无法确定的信息请合理估算并标注。',
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
      const errorText = await response.text()
      console.error('DeepSeek API error:', errorText)
      return NextResponse.json(
        { error: 'DeepSeek API 调用失败' },
        { status: 502 }
      )
    }

    const aiData = await response.json()
    const content = aiData.choices?.[0]?.message?.content || ''

    // 解析 AI 返回的 JSON
    let heatData: Array<{
      industry: string
      financingCount: number
      totalAmount: string
      heatLevel: number
      notableCompanies: string
      summary: string
    }> = []

    try {
      // 尝试直接解析
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        heatData = parsed.heatData || []
      }
    } catch {
      // 解析失败，返回空数据
      console.error('Failed to parse DeepSeek response:', content)
    }

    // 确保每个行业都有数据（DeepSeek 可能遗漏某些行业）
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

    // 按热度降序排序
    heatData.sort((a, b) => b.heatLevel - a.heatLevel)

    return NextResponse.json({
      year: validYear,
      years,
      heatData,
      totalIndustries: industries.length,
    })
  } catch (error) {
    console.error('Financing heatmap API error:', error)
    return NextResponse.json(
      { error: '获取融资热点数据失败' },
      { status: 500 }
    )
  }
}
