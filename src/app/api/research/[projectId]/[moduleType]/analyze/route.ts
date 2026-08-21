export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { searchWebDual } from '@/lib/tavily-search'
import {
  canEditResearchProject,
  isValidModuleType,
  needsAIAnalysis,
  needsTavilySearch,
  type ResearchModuleType,
} from '@/lib/research-permissions'
import { MODULE_PROMPTS } from '@/lib/research-prompts'

/** JSON 修复 */
function repairJson(text: string): string {
  return text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
}

/**
 * POST /api/research/[projectId]/[moduleType]/analyze
 * AI 分析模块（Tavily 搜索 + 文档提取文本 + DeepSeek 归纳总结）
 *
 * 流程：
 * 1. Tavily 搜索外网信息（如需）
 * 2. 读取模块上传文档的提取文本
 * 3. 读取模块手动输入内容
 * 4. 调用 DeepSeek 分析
 * 5. 缓存结果到 aiJson / aiSummary 字段
 */
export async function POST(
  _request: Request,
  { params }: { params: { projectId: string; moduleType: string } }
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

    const { projectId, moduleType } = params

    // 验证 moduleType
    if (!isValidModuleType(moduleType)) {
      return NextResponse.json(
        { error: `无效的模块类型: ${moduleType}` },
        { status: 400 }
      )
    }

    // 纯手动模块不支持 AI 分析
    if (!needsAIAnalysis(moduleType as ResearchModuleType)) {
      return NextResponse.json(
        { error: '该模块为手动输入模式，不支持 AI 分析' },
        { status: 400 }
      )
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        companyFullName: true,
        industry: true,
        companyPosition: true,
        mainProducts: true,
        coreAdvantage: true,
        coreTeam: true,
        competitors: true,
        description: true,
        totalAmount: true,
        raisedAmount: true,
        createdById: true,
        members: { select: { userId: true } },
      },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权分析该项目' }, { status: 403 })
    }

    const deepseekApiKey = process.env.DEEPSEEK_API_KEY
    if (!deepseekApiKey) {
      return NextResponse.json(
        { error: 'DeepSeek API Key 未配置' },
        { status: 500 }
      )
    }

    // 获取或创建模块
    const module = await prisma.researchModule.upsert({
      where: {
        projectId_moduleType: { projectId, moduleType },
      },
      create: { projectId, moduleType },
      update: {},
      include: {
        documents: {
          select: { extractedText: true, fileName: true },
        },
      },
    })

    const config = MODULE_PROMPTS[moduleType as ResearchModuleType]

    // 1. 研究型双源搜索（Tavily + DeepSeek web_search 比较 + 归纳，如需）
    let externalInfo = ''
    if (needsTavilySearch(moduleType as ResearchModuleType)) {
      const queries = config.searchQueries(project)
      if (queries.length > 0) {
        try {
          const searchResults = await Promise.all(
            queries.map(q => searchWebDual(q, { maxResults: 3, mode: 'research', module: 'research' }))
          )
          externalInfo = searchResults
            .flat()
            .map((r, i) => `[${i + 1}] ${r.title}\n来源: ${r.url}\n${r.content.substring(0, 500)}`)
            .join('\n\n')
        } catch (error) {
          console.error('双源搜索失败:', error)
          externalInfo = '外网搜索失败，请稍后重试'
        }
      }
    }

    // 2. 拼接文档提取文本
    const documentText = module.documents
      .filter(d => d.extractedText)
      .map(d => `--- 文档: ${d.fileName} ---\n${d.extractedText}`)
      .join('\n\n')

    // 3. 手动输入内容
    const manualContent = module.content || ''

    // 4. 构建 prompt 并调用 DeepSeek
    const prompt = config.userPromptBuilder(
      project,
      externalInfo,
      documentText,
      manualContent
    )

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 90000) // 90s 超时（文档内容可能较多）

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
            { role: 'system', content: config.systemPrompt },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_tokens: 4000,
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
        { status: 502 }
      )
    }

    const aiData = await response.json()
    const content = aiData.choices?.[0]?.message?.content || ''

    if (!content) {
      return NextResponse.json({ error: 'AI 返回数据为空' }, { status: 500 })
    }

    // 解析 JSON（使用 repairJson 容错）
    let parsed: Record<string, unknown> = {}
    try {
      const repaired = repairJson(content)
      const jsonMatch = repaired.match(/\{[\s\S]*\}/)
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
    } catch {
      console.error('Failed to parse AI response:', content)
    }

    // 提取摘要
    const aiSummary = (parsed.summary as string) || content.substring(0, 200)

    // 5. 缓存结果
    const updatedModule = await prisma.researchModule.update({
      where: { id: module.id },
      data: {
        aiJson: content,
        aiSummary,
        analyzedAt: new Date(),
      },
    })

    return NextResponse.json({
      moduleId: updatedModule.id,
      moduleType: updatedModule.moduleType,
      aiJson: parsed,
      aiSummary,
      analyzedAt: updatedModule.analyzedAt,
    })
  } catch (error) {
    console.error('Research AI analysis error:', error)
    return NextResponse.json(
      { error: 'AI 分析失败' },
      { status: 500 }
    )
  }
}
