export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { runProjectDraftExtraction } from '@/lib/project-interpretation/runner'
import { searchWebDual } from '@/lib/tavily-search'
import type { InterpretationResult, OverallConclusion } from '@/lib/project-interpretation/constants'

/** 从搜索结果提取公司全称（与 create-project 同口径） */
function extractCompanyFullName(searchTexts: string[], projectName: string): string | null {
  const re = /[（(]?[\u4e00-\u9fa5A-Za-z0-9·]{2,20}?(?:有限公司|股份有限公司|有限责任公司|集团有限公司)[）)]?/g
  const candidates: string[] = []
  for (const text of searchTexts) {
    const matches = text.match(re) || []
    candidates.push(...matches.map(s => s.replace(/[（）()]/g, '')))
  }
  if (candidates.length === 0) return null
  const nameCore = projectName.replace(/(科技|智能|技术|信息)?$/, '')
  const preferred = candidates.find(c => c.includes(projectName) || c.includes(nameCore))
  return (preferred || candidates[0]).slice(0, 60)
}

/**
 * POST /api/project-interpretation/[id]/create-project/draft
 * 预取填充信息（P5：不直接创建项目）：
 * AI 按项目库模板提取（排版化：序号分点 + 重点加粗；主要产品/核心优势/核心团队截取 BP 原文），
 * 公司全称缺失时联网补全；返回 draft 供前端预填充创建表单，由维护人补全必填项后确认创建。
 * 重名时返回 409（前端提示先处理同名项目）。
 */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const record = await prisma.projectInterpretation.findUnique({ where: { id: params.id } })
    if (!record || record.userId !== session.user.id) {
      return NextResponse.json({ error: '记录不存在' }, { status: 404 })
    }
    if (record.linkedProjectId) {
      return NextResponse.json({ error: '该项目已创建到项目库', projectId: record.linkedProjectId }, { status: 400 })
    }
    if (record.verifyStatus !== 'DONE' || !record.conclusionJson) {
      return NextResponse.json({ error: '请先完成访谈校验并生成综合结论后再创建到项目库' }, { status: 400 })
    }

    // ── AI 按项目库模板提取（BP 原文 + 访谈纪要 + 七维解读 + 综合结论） ──
    let interpretation: InterpretationResult | null = null
    if (record.interpretationJson) {
      try { interpretation = JSON.parse(record.interpretationJson) } catch { interpretation = null }
    }
    let conclusionSummary = ''
    try {
      const c = JSON.parse(record.conclusionJson) as OverallConclusion
      conclusionSummary = [c.summary, ...(c.dimensions || []).map(d => `${d.aspect}：${d.conclusion}`)].join('；')
    } catch { /* 结论解析失败不阻塞 */ }

    const draft = await runProjectDraftExtraction({
      projectName: record.projectName,
      documentText: record.documentText || '',
      interviewText: record.interviewText,
      interpretation,
      conclusionSummary,
    })

    // ── 公司全称补全：AI 未提取到时联网搜索 ──
    if (!draft.companyFullName.trim()) {
      try {
        const results = await searchWebDual(`${draft.name} ${draft.industry || ''} 公司 工商注册 全称`, {
          maxResults: 5,
          mode: 'collect',
          module: 'project-interpretation',
        })
        const fullName = extractCompanyFullName(
          results.flatMap(r => [r.title, r.content]),
          draft.name
        )
        if (fullName) draft.companyFullName = fullName
      } catch { /* 搜索失败不阻塞 */ }
    }

    // ── 重名预检查（项目名唯一）──
    const existing = await prisma.project.findFirst({
      where: { name: draft.name },
      select: { id: true, name: true, createdBy: { select: { name: true, email: true } } },
    })
    if (existing) {
      return NextResponse.json(
        {
          error: `项目库已存在同名项目「${existing.name}」（维护人：${existing.createdBy?.name || existing.createdBy?.email || '未知'}），请先在项目库处理同名项目（接管或改名），或修改项目名称后创建`,
          existingProjectId: existing.id,
        },
        { status: 409 }
      )
    }

    // 初聊日期默认取解读上传日期（表单可改）
    return NextResponse.json({ draft, defaultTargetDate: record.createdAt.toISOString().split('T')[0] })
  } catch (error) {
    console.error('Draft extraction error:', error)
    const detail = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ error: `AI 提取项目信息失败：${detail}` }, { status: 500 })
  }
}
