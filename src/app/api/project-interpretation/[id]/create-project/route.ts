export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { runProjectDraftExtraction } from '@/lib/project-interpretation/runner'
import { computePassedStages } from '@/lib/stage-utils'
import { searchWebDual } from '@/lib/tavily-search'
import { copyFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { InterpretationResult, OverallConclusion } from '@/lib/project-interpretation/constants'

/** BP 原文件目录（解读上传时留存的原文） */
const INTERPRETATION_DIR = join(process.cwd(), 'public', 'interpretation-docs')
/** 项目文档目录（项目详情页"项目文档"卡的存档目录，与项目文档上传一致） */
const PROJECT_DOCS_DIR = join(process.cwd(), 'public', 'project-docs')

/** 从 fileUrl 提取 interpretation-docs 下的本地文件名（防路径穿越） */
function localBpPath(fileUrl: string): string | null {
  const m = fileUrl.match(/^\/api\/uploads\/interpretation-docs\/([A-Za-z0-9._-]+)$/)
  return m ? join(INTERPRETATION_DIR, m[1]) : null
}

/** 从搜索结果提取公司全称（XX有限公司/股份有限公司/有限责任公司等，优先含项目名的匹配） */
function extractCompanyFullName(searchTexts: string[], projectName: string): string | null {
  const re = /[（(]?[\u4e00-\u9fa5A-Za-z0-9·]{2,20}?(?:有限公司|股份有限公司|有限责任公司|集团有限公司)[）)]?/g
  const candidates: string[] = []
  for (const text of searchTexts) {
    const matches = text.match(re) || []
    candidates.push(...matches.map(s => s.replace(/[（）()]/g, '')))
  }
  if (candidates.length === 0) return null
  // 优先：包含项目名或项目名去掉常见后缀的候选
  const nameCore = projectName.replace(/(科技|智能|技术|信息)?$/, '')
  const preferred = candidates.find(c => c.includes(projectName) || c.includes(nameCore))
  return (preferred || candidates[0]).slice(0, 60)
}

/**
 * POST /api/project-interpretation/[id]/create-project
 * 闭环创建：解读生成校验结论后，AI 按项目库模板从 BP/解读/访谈纪要/结论提取关键信息
 * （主要产品/核心优势/核心团队截取 BP 原文资料 + 文字描述，融合访谈纪要的团队认识/创业契机），
 * 公司全称缺失时联网搜索补全；创建后自动把 BP 原文转存到项目文档。
 * 重名检查通过后创建到项目库并回写 linkedProjectId（防重复创建）
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

    // ── 公司全称补全：AI 未提取到时联网搜索（大模型搜索引擎） ──
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
      } catch {
        // 搜索失败不阻塞：公司全称留空
      }
    }

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

    // ── BP 原文自动转存到项目详情页"项目文档"（方便查阅） ──
    try {
      const bpPath = localBpPath(record.fileUrl)
      if (bpPath) {
        await mkdir(PROJECT_DOCS_DIR, { recursive: true })
        const ext = record.fileName.split('.').pop() || 'pdf'
        const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}.${ext}`
        await copyFile(bpPath, join(PROJECT_DOCS_DIR, uniqueName))
        await prisma.projectDocument.create({
          data: {
            projectId: project.id,
            fileName: record.fileName,
            fileUrl: `/project-docs/${uniqueName}`,
            fileType: record.fileType || 'application/octet-stream',
            fileSize: record.fileSize,
            uploadedById: session.user.id,
          },
        })
      }
    } catch (docErr) {
      // BP 转存失败不阻塞创建（项目已建好；用户可手动在详情页上传）
      console.error('BP document transfer error:', docErr)
    }

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
