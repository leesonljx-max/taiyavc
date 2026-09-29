export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { runProjectDraftExtraction } from '@/lib/project-interpretation/runner'
import { computePassedStages } from '@/lib/stage-utils'
import type { InterpretationResult, OverallConclusion } from '@/lib/project-interpretation/constants'

/**
 * POST /api/project-interpretation/[id]/create-project
 * 闭环创建：解读生成校验结论后，AI 按项目库模板从 BP/解读/结论提取关键信息
 * （主要产品/核心优势/核心团队 截取 BP 原文对应资料 + 文字描述），
 * 重名检查后创建到项目库并回写 linkedProjectId（防重复创建）
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

    // ── AI 按项目库模板提取（BP 原文 + 七维解读 + 综合结论） ──
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
      interpretation,
      conclusionSummary,
    })

    // ── 重名检查（项目名唯一，不允许重复创建） ──
    const existing = await prisma.project.findFirst({
      where: { name: draft.name },
      select: { id: true, name: true, createdBy: { select: { name: true, email: true } } },
    })
    if (existing) {
      return NextResponse.json(
        {
          error: `项目库已存在同名项目「${existing.name}」（维护人：${existing.createdBy?.name || existing.createdBy?.email || '未知'}），请先在项目库处理同名项目（接管或改名）后再创建`,
          existingProjectId: existing.id,
        },
        { status: 409 }
      )
    }

    // ── 创建到项目库（初聊阶段；初聊日期取解读上传日期） ──
    const initialStage = 'INITIAL_TALK'
    const project = await prisma.project.create({
      data: {
        name: draft.name,
        companyFullName: draft.companyFullName || null,
        industry: draft.industry || null,
        companyPosition: draft.companyPosition || null,
        mainProducts: draft.mainProducts,
        coreAdvantage: draft.coreAdvantage,
        coreTeam: draft.coreTeam,
        competitors: null,
        description: draft.description || null,
        financingRound: draft.financingRound || null,
        totalAmount: draft.totalAmount || '待补充',
        investmentValuation: draft.investmentValuation,
        followStage: initialStage,
        passedStages: JSON.stringify(computePassedStages([], initialStage)),
        targetDate: record.createdAt,
        createdById: session.user.id,
      },
      select: { id: true, name: true },
    })

    // 回写关联（防重复创建/重复弹窗）
    await prisma.projectInterpretation.update({
      where: { id: record.id },
      data: { linkedProjectId: project.id },
    })

    return NextResponse.json({ projectId: project.id, projectName: project.name, draft })
  } catch (error) {
    console.error('Create project from interpretation error:', error)
    const detail = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ error: `创建到项目库失败：${detail}` }, { status: 500 })
  }
}
