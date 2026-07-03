import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, type PermissionUser } from '@/lib/permissions'

interface CompetitorItem {
  projectName: string
  latestRound: string
  amount: string
  founderBackground: string
}

// POST: 调用 AI 生成竞争态势分析
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
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

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: { members: { select: { userId: true } } },
    })

    if (!project) {
      return NextResponse.json(
        { error: '项目不存在' },
        { status: 404 }
      )
    }

    const memberIds = project.members.map(m => m.userId)

    if (!canViewProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })) {
      return NextResponse.json(
        { error: '无权分析该项目' },
        { status: 403 }
      )
    }

    const deepseekApiKey = process.env.DEEPSEEK_API_KEY
    if (!deepseekApiKey) {
      return NextResponse.json(
        { error: 'DeepSeek API Key 未配置' },
        { status: 500 }
      )
    }

    const prompt = `你是一个资深的投资分析师，擅长竞争格局与市场竞品研究。请根据以下项目信息，检索并整理出与该项目相关的市场竞争对手信息。

待分析项目名称：${project.name}
公司全称：${project.companyFullName || '未填写'}
所处行业：${project.industry || '未填写'}
公司定位：${project.companyPosition || '未填写'}
主要产品：${project.mainProducts || '未填写'}
已知竞争对手：${project.competitors || '未填写'}

任务要求：
1. 结合"主要产品"和"已知竞争对手"信息，检索市场上相关的竞争对手（若已知竞争对手已给出，应优先包含这些公司，并补充其他相关竞品）。
2. 每个竞争对手请提供以下信息：
   - projectName：竞争对手公司/项目名称
   - latestRound：最近一轮融资轮次（如 A轮、B轮、战略融资等；如无公开信息请填"未公开"）
   - amount：融资金额（如 "1亿元人民币"、"5000万美元"；如无公开信息请填"未公开"）
   - founderBackground：创始人一句话背景（不超过40字，概括创始人履历亮点；如无公开信息请填"未公开"）
3. 列出 3-8 个主要竞争对手，按相关度或市场知名度排序。
4. 若某项信息无法确定，请填写"未公开"，不要编造具体数字。

请严格按照以下 JSON 格式输出，不要包含任何其他文字：
{
  "competitors": [
    {
      "projectName": "竞争对手名称",
      "latestRound": "最近融资轮次",
      "amount": "融资金额",
      "founderBackground": "创始人一句话背景"
    }
  ]
}`

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
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
            content: '你是一个专业的投资分析助手，擅长市场竞品研究与竞争格局分析。请基于公开信息作答，无法确定的信息请标注"未公开"，不要编造数据。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'API 请求失败' }))
      return NextResponse.json(
        { error: `DeepSeek API 调用失败: ${errorData.message || response.statusText}` },
        { status: 500 }
      )
    }

    const result = await response.json()
    const contentJson = result.choices?.[0]?.message?.content

    if (!contentJson) {
      return NextResponse.json(
        { error: 'AI 返回数据为空' },
        { status: 500 }
      )
    }

    let parsed: { competitors?: CompetitorItem[] }
    try {
      parsed = JSON.parse(contentJson)
    } catch {
      return NextResponse.json(
        { error: 'AI 返回数据格式错误' },
        { status: 500 }
      )
    }

    const competitors = Array.isArray(parsed.competitors) ? parsed.competitors : []

    if (competitors.length === 0) {
      return NextResponse.json(
        { error: 'AI 未能检索到相关竞争对手信息' },
        { status: 500 }
      )
    }

    // 缓存分析结果到数据库
    await prisma.project.update({
      where: { id: params.id },
      data: { competitorAnalysisJson: contentJson },
    })

    return NextResponse.json({ competitors })
  } catch (error) {
    console.error('Competitor analysis error:', error)
    return NextResponse.json(
      { error: '生成竞争态势分析失败' },
      { status: 500 }
    )
  }
}

// GET: 获取已缓存的竞争态势分析
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: params.id },
      select: { competitorAnalysisJson: true },
    })

    if (!project) {
      return NextResponse.json(
        { error: '项目不存在' },
        { status: 404 }
      )
    }

    if (!project.competitorAnalysisJson) {
      return NextResponse.json({ competitors: null })
    }

    let parsed: { competitors?: CompetitorItem[] }
    try {
      parsed = JSON.parse(project.competitorAnalysisJson)
    } catch {
      return NextResponse.json({ competitors: null })
    }

    return NextResponse.json({ competitors: parsed.competitors || null })
  } catch (error) {
    return NextResponse.json(
      { error: '获取竞争态势分析失败' },
      { status: 500 }
    )
  }
}
