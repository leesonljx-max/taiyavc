/**
 * 知识沉淀库（KnowledgeEntry）：已核验事实 + 证据链的写入与召回
 *
 * 设计（四层架构·第三层，P2.3 打通）：
 * - 写入：ClaimVerifier 校验完成后，将 ✅一致/⚠️夸大/❌矛盾 的声明沉淀入库
 *   （❓未证实信息量低，不入库）；同主体同事实重复核验 → hitCount +1 并刷新证据
 * - 读取：AI行研按关键词召回注入 system prompt；后续同赛道解读/尽调可复用
 * - scope：SECTOR（赛道标签，如 具身智能）/ ENTITY（公司名，如 宇树科技）
 */

import prisma from '@/lib/prisma'
import type { VerifiedClaim } from '@/lib/dd-workbench/claim-verifier'

/** 写入的知识条目（已归一化） */
export interface KnowledgeEntryData {
  scope: 'SECTOR' | 'ENTITY'
  subject: string
  field: string
  content: string
  verdict: string
  evidenceJson: string | null
  sourceFeature: string
  sourceProjectName?: string | null
}

/** 沉淀范围解析：优先赛道（跨项目复用），无赛道时回落公司主体 */
function resolveScope(industry: string | null | undefined, entity?: string | null): { scope: 'SECTOR' | 'ENTITY'; subject: string } | null {
  const sector = String(industry || '').trim()
  if (sector) return { scope: 'SECTOR', subject: sector.slice(0, 30) }
  const ent = String(entity || '').trim()
  if (ent) return { scope: 'ENTITY', subject: ent.slice(0, 30) }
  return null
}

/**
 * 沉淀校验结论：将已核验声明写入知识库（幂等：同 scope+subject+field+content → hitCount+1 并刷新证据）
 * @returns 实际写入条数
 */
export async function saveVerifiedClaims(input: {
  claims: VerifiedClaim[]
  industry?: string | null
  sourceFeature: string
  sourceProjectName?: string | null
}): Promise<number> {
  const entries: KnowledgeEntryData[] = []
  for (const c of input.claims) {
    // ❓未证实不入库（信息量低）；无裁决说明的异常条目跳过
    if (c.verdict === 'UNVERIFIED') continue
    // 主体归档：优先赛道，其次声明自身的公司主体（entity）
    const target = resolveScope(input.industry, c.entity)
    if (!target) continue
    entries.push({
      scope: target.scope,
      subject: target.subject,
      field: c.field || 'general',
      content: `${c.claim}${c.note ? `（核验：${c.note}）` : ''}`.slice(0, 300),
      verdict: c.verdict,
      evidenceJson: c.evidence.length > 0 ? JSON.stringify(c.evidence.slice(0, 3)) : null,
      sourceFeature: input.sourceFeature,
      sourceProjectName: input.sourceProjectName || null,
    })
  }
  if (entries.length === 0) return 0

  let saved = 0
  for (const e of entries) {
    await prisma.knowledgeEntry.upsert({
      where: {
        scope_subject_field_content: {
          scope: e.scope,
          subject: e.subject,
          field: e.field,
          content: e.content,
        },
      },
      create: { ...e, hitCount: 0 },
      update: {
        verdict: e.verdict,
        evidenceJson: e.evidenceJson,
        sourceFeature: e.sourceFeature,
        sourceProjectName: e.sourceProjectName,
        hitCount: { increment: 1 },
      },
    })
    saved++
  }
  return saved
}

/** 召回的知识条目 */
export interface RecalledKnowledge {
  id: string
  scope: string
  subject: string
  field: string
  content: string
  verdict: string
}

/**
 * 按关键词召回相关知识（LIKE 任一命中，hitCount 优先）
 * 关键词提取复用 ai-memory 的分词逻辑（中英文）
 */
export async function recallKnowledge(query: string, limit = 5): Promise<RecalledKnowledge[]> {
  const { extractQueryKeywords } = await import('./ai-memory')
  const keywords = extractQueryKeywords(query)
  if (keywords.length === 0) return []

  const conditions = keywords.map(k => ({ content: { contains: k } }))
  const entries = await prisma.knowledgeEntry.findMany({
    where: { OR: conditions },
    orderBy: [{ hitCount: 'desc' }, { updatedAt: 'desc' }],
    take: limit,
    select: { id: true, scope: true, subject: true, field: true, content: true, verdict: true },
  })
  return entries
}

/** 召回知识格式化为 system prompt 注入块 */
export function formatKnowledgeForPrompt(entries: RecalledKnowledge[]): string {
  if (entries.length === 0) return ''
  const lines = entries.map(e =>
    `- [${e.subject}·${e.verdict === 'SUPPORTED' ? '已核验' : e.verdict === 'EXAGGERATED' ? '曾发现夸大' : '曾发现矛盾'}] ${e.content}`
  )
  return `\n## 已核验知识库（来自尽调/解读/行研的联网核验事实，可信度高于一般联网信息）\n${lines.join('\n')}\n`
}
