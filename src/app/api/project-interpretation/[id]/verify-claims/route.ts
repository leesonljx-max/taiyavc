export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { verifyTextClaims, type ClaimVerification } from '@/lib/dd-workbench/claim-verifier'
import { saveVerifiedClaims } from '@/lib/knowledge-base'
import { recordSkillRun } from '@/lib/skill-registry'
import type { InterpretationResult } from '@/lib/project-interpretation/constants'

/**
 * POST /api/project-interpretation/[id]/verify-claims
 * BP 关键声明外部校验（P2.2）：七维解读 + BP 原文的关键声明联网交叉核验
 * 前置：解读已完成（interpretationJson 存在）；结果覆盖写入 verificationJson；
 * 已核验结论沉淀知识库（SECTOR=行业，跨项目复用）；夸大/矛盾声明在下次生成问题清单时自动转为优先追问
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
    if (!record.interpretationJson) {
      return NextResponse.json({ error: '请先完成「解读项目」，再进行外部校验' }, { status: 400 })
    }

    let interpretation: InterpretationResult | null = null
    try {
      interpretation = JSON.parse(record.interpretationJson)
    } catch {
      interpretation = null
    }
    if (!interpretation) {
      return NextResponse.json({ error: '解读结果数据异常，请重新解读' }, { status: 400 })
    }

    // 核验文本：七维解读（BP 提炼的核心表述）+ BP 原文节选（客户logo/订单/性能等自述声明）
    const digest = [
      `行业：${interpretation.industry}`,
      `市场地位：${interpretation.marketPosition}`,
      `技术领先性：${interpretation.techLeadership}`,
      `团队咖位：${interpretation.teamStanding}`,
      `竞争分析：${interpretation.competitionAnalysis}`,
      `市场地位预估：${interpretation.marketEstimate}`,
    ].join('\n')
    const bpExcerpt = (record.documentText || '').slice(0, 3500)
    const text = `【七维解读】\n${digest}\n\n【BP 原文节选】\n${bpExcerpt}`

    const verification: ClaimVerification = await verifyTextClaims(text, { module: 'project-interpretation' })

    // 落库 + 知识沉淀（✅/⚠️/❌ 结论入知识库，SECTOR=行业）
    const [, kbSaved] = await Promise.all([
      prisma.projectInterpretation.update({
        where: { id: record.id },
        data: { verificationJson: JSON.stringify(verification) },
      }),
      saveVerifiedClaims({
        claims: verification.claims,
        industry: interpretation.industry,
        sourceFeature: 'project-interpretation',
        sourceProjectName: record.projectName,
      }).catch(() => 0),
    ])
    await recordSkillRun('claim-verifier').catch(() => {})

    return NextResponse.json({ ok: true, verification, kbSaved })
  } catch (error) {
    console.error('PI claim verification error:', error)
    return NextResponse.json({ error: '外部校验失败，请稍后重试' }, { status: 500 })
  }
}
