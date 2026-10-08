export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { computePassedStages } from '@/lib/stage-utils'
import { copyFile, mkdir } from 'fs/promises'
import { join } from 'path'

/** BP 原文件目录（解读上传时留存的原文） */
const INTERPRETATION_DIR = join(process.cwd(), 'public', 'interpretation-docs')
/** 项目文档目录（项目详情页"项目文档"卡的存档目录，与项目文档上传一致） */
const PROJECT_DOCS_DIR = join(process.cwd(), 'public', 'project-docs')

/** 从 fileUrl 提取 interpretation-docs 下的本地文件名（防路径穿越） */
function localBpPath(fileUrl: string): string | null {
  const m = fileUrl.match(/^\/api\/uploads\/interpretation-docs\/([A-Za-z0-9._-]+)$/)
  return m ? join(INTERPRETATION_DIR, m[1]) : null
}

/**
 * POST /api/project-interpretation/[id]/create-project
 * 确认创建（P5：预填充表单由维护人补全必填项后提交，不再由 AI 直接创建）：
 * - body：表单数据（name/companyFullName/industry/companyPosition/mainProducts/coreAdvantage/coreTeam/
 *   description/financingRound/totalAmount/investmentValuation/targetDate）
 * - 必填校验：项目名称/所处行业/公司定位/融资金额/投资估值/初聊日期（与项目库新建页一致）
 * - 重名 409 拦截；创建后自动把 BP 原文转存到项目文档并回写 linkedProjectId（防重复创建）
 */
export async function POST(
  request: Request,
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

    // ── 表单数据与必填校验（与项目库新建页口径一致） ──
    const body = await request.json().catch(() => ({}))
    const name = String(body.name || '').trim().slice(0, 50)
    const companyFullName = String(body.companyFullName || '').trim().slice(0, 100) || null
    const industry = String(body.industry || '').trim().slice(0, 50)
    const companyPosition = String(body.companyPosition || '').trim().slice(0, 100)
    const mainProducts = String(body.mainProducts || '').trim().slice(0, 2000)
    const coreAdvantage = String(body.coreAdvantage || '').trim().slice(0, 2000) || '未披露'
    const coreTeam = String(body.coreTeam || '').trim().slice(0, 4000) || '未披露'
    const description = String(body.description || '').trim().slice(0, 1000) || null
    const financingRound = String(body.financingRound || '').trim().slice(0, 30) || null
    const totalAmount = String(body.totalAmount || '').trim().slice(0, 30)
    const investmentValuationRaw = body.investmentValuation
    const investmentValuation =
      investmentValuationRaw === null || investmentValuationRaw === undefined || investmentValuationRaw === ''
        ? null
        : Number(investmentValuationRaw)
    const targetDateRaw = String(body.targetDate || '').trim()
    const targetDate = targetDateRaw ? new Date(targetDateRaw) : null

    const missing: string[] = []
    if (!name) missing.push('项目名称')
    if (!industry) missing.push('所处行业')
    if (!companyPosition) missing.push('公司定位')
    if (!totalAmount) missing.push('融资金额')
    if (investmentValuation === null || !Number.isFinite(investmentValuation)) missing.push('投资估值')
    if (!targetDate || Number.isNaN(targetDate.getTime())) missing.push('初聊日期')
    if (missing.length > 0) {
      return NextResponse.json({ error: `请先填写必填项：${missing.join('、')}` }, { status: 400 })
    }

    // ── 重名检查（项目名唯一，不允许重复创建） ──
    const existing = await prisma.project.findFirst({
      where: { name },
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

    // ── 创建到项目库（初聊阶段） ──
    const initialStage = 'INITIAL_TALK'
    const project = await prisma.project.create({
      data: {
        name,
        companyFullName,
        industry,
        companyPosition,
        mainProducts: mainProducts || '未披露',
        coreAdvantage,
        coreTeam,
        competitors: null,
        description,
        financingRound,
        totalAmount,
        investmentValuation,
        followStage: initialStage,
        passedStages: JSON.stringify(computePassedStages([], initialStage)),
        targetDate: targetDate!,
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

    return NextResponse.json({ projectId: project.id, projectName: project.name })
  } catch (error) {
    console.error('Create project from interpretation error:', error)
    const detail = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ error: `创建到项目库失败：${detail}` }, { status: 500 })
  }
}
