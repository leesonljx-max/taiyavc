import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, canEditProject, type PermissionUser } from '@/lib/permissions'

interface AICardData {
  projectName: string
  highlights: string[]
  barriers: string[]
  risks: string[]
}

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

    if (!canEditProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })) {
      return NextResponse.json(
        { error: '无权生成该项目 AI 卡片' },
        { status: 403 }
      )
    }

    const financialDataStr = project.financialData || '{}'
    let financialData: Record<string, any> = {}
    try {
      financialData = JSON.parse(financialDataStr)
    } catch {
      financialData = { raw: financialDataStr }
    }

    const prompt = `你是一个资深的投资分析师。请根据以下项目信息，生成一份结构化的投资分析卡片。

项目名称：${project.name}
公司全称：${project.companyFullName || '未填写'}
所处行业：${project.industry || '未填写'}
公司定位：${project.companyPosition || '未填写'}
主要产品：${project.mainProducts || '未填写'}
财务数据：${JSON.stringify(financialData)}
订单进展：${project.orderProgress || '未填写'}
融资规划：${project.financingPlan || '未填写'}
项目描述：${project.description || '未填写'}
目标金额：${project.totalAmount}
已筹金额：¥${project.raisedAmount}万元
跟进阶段：${project.followStage}

请按照以下 JSON 格式输出，不要包含任何其他文字：
{
  "projectName": "项目名称",
  "highlights": ["投资亮点1", "投资亮点2", "投资亮点3"],
  "barriers": ["核心壁垒1", "核心壁垒2", "核心壁垒3"],
  "risks": ["风险提示1", "风险提示2", "风险提示3"]
}

要求：
- highlights：列出3-5个投资亮点，突出项目的优势和潜力
- barriers：列出3-5个核心壁垒，说明项目的竞争优势
- risks：列出3-5个风险提示，客观分析潜在风险
- 每个条目简明扼要，不超过30字`

    const deepseekApiKey = process.env.DEEPSEEK_API_KEY
    if (!deepseekApiKey) {
      return NextResponse.json(
        { error: 'DeepSeek API Key 未配置' },
        { status: 500 }
      )
    }

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
              content: '你是一个专业的投资分析助手，擅长分析项目信息并生成结构化的投资分析报告。',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.7,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'API 请求失败' }))
      return NextResponse.json(
        { error: `DeepSeek API 调用失败: ${errorData.message || response.statusText}` },
        { status: 500 }
      )
    }

    const result = await response.json()
    const aiCardJson = result.choices?.[0]?.message?.content

    if (!aiCardJson) {
      return NextResponse.json(
        { error: 'AI 返回数据为空' },
        { status: 500 }
      )
    }

    let aiCardData: AICardData
    try {
      aiCardData = JSON.parse(aiCardJson)
    } catch {
      return NextResponse.json(
        { error: 'AI 返回数据格式错误' },
        { status: 500 }
      )
    }

    await prisma.project.update({
      where: { id: params.id },
      data: { aiCardJson },
    })

    return NextResponse.json({ card: aiCardData })
  } catch (error) {
    console.error('AI Card generation error:', error)
    return NextResponse.json(
      { error: '生成 AI 卡片失败' },
      { status: 500 }
    )
  }
}

export async function GET(
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
        { error: '无权查看该项目' },
        { status: 403 }
      )
    }

    if (!project.aiCardJson) {
      return NextResponse.json({ card: null })
    }

    let aiCardData: AICardData
    try {
      aiCardData = JSON.parse(project.aiCardJson)
    } catch {
      return NextResponse.json({ card: null })
    }

    return NextResponse.json({ card: aiCardData })
  } catch (error) {
    return NextResponse.json(
      { error: '获取 AI 卡片失败' },
      { status: 500 }
    )
  }
}