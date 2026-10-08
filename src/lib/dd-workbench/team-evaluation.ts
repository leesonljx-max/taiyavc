/**
 * 创业团队评价体系（尽调·团队与治理模块，10 分制）
 *
 * 源自《泰亚投资：创业团队判断系统》评价模型：
 * - 一级权重固定：实控人/CEO 独占 60 分；团队整体独占 20 分；联创&核心高管共享 20 分（取平均）
 * - 联创&核心高管分两种画像：产品&技术（TECH）/ 运营&销售（OPS）
 * - 二级权重可调（每人合计 100%），不调整按模板默认
 * - 每维度评分 0-10，行得分 = 二级权重 × 评分 × 区间系数（CEO=6，其余=2）
 * - 最终得分 =（CEO 得分 + 高管平均 + 团队整体得分）/ 10
 */

import prisma from '@/lib/prisma'
import { parseAgentJson } from '@/lib/dd-harness/agent'
import { recordTokenUsage } from '@/lib/token-accounting'
import { getProjectModuleResources } from './resources'
import { buildMultimodalDigest, buildMessageContent, type ExtractedImage } from './vision'
import { DEEPSEEK_MODEL } from '@/lib/deepseek-model'
import {
  CEO_TEMPLATE, TECH_TEMPLATE, OPS_TEMPLATE, TEAM_TEMPLATE, PROFILE_TEMPLATES,
  type ProfileType, type DimensionDef,
} from './team-templates'

// 模板与纯类型统一放在 team-templates.ts（客户端安全），此处重导出保持兼容
export {
  CEO_TEMPLATE, TECH_TEMPLATE, OPS_TEMPLATE, TEAM_TEMPLATE, PROFILE_TEMPLATES, PROFILE_LABELS,
  type ProfileType, type DimensionDef,
} from './team-templates'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

// ── 类型 ──

/** 成员打分维度（模板 + 评分） */
export interface MemberDimension {
  key: string
  label: string
  hint: string
  group: string
  weight: number
  score: number | null
}

export interface TeamMember {
  id: string
  name: string
  roleLabel: string
  profileType: ProfileType
  dimensions: MemberDimension[]
}

export interface TeamDimension extends MemberDimension {}

export interface TeamEvaluationData {
  members: TeamMember[]
  team: TeamDimension[]
}

/** 计算结果 */
export interface EvaluationResult {
  ceoScore: number
  ceoName: string
  execScores: Array<{ memberId: string; name: string; score: number }>
  execAvg: number
  teamScore: number
  finalScore: number
  allScored: boolean
}

// ── 计算 ──

/** 单人得分：Σ(权重×评分×系数)；有未评分维度时返回 null */
function memberScore(dimensions: MemberDimension[], coefficient: number): number | null {
  let total = 0
  for (const d of dimensions) {
    if (d.score === null || d.score === undefined || Number.isNaN(d.score)) return null
    total += d.weight * d.score * coefficient
  }
  return Math.round(total * 100) / 100
}

/** 计算团队评价：CEO 得分 + 高管平均 + 团队整体 → 最终 10 分制 */
export function computeEvaluation(data: TeamEvaluationData): EvaluationResult {
  const ceo = data.members.find(m => m.profileType === 'CEO') || null
  const execs = data.members.filter(m => m.profileType !== 'CEO')

  const ceoRaw = ceo ? memberScore(ceo.dimensions, 6) : null
  const execRaws = execs.map(m => ({ memberId: m.id, name: m.name, score: memberScore(m.dimensions, 2) }))
  const teamRaw = memberScore(data.team, 2)

  const allScored = ceoRaw !== null && teamRaw !== null && execRaws.every(e => e.score !== null)

  const ceoScore = ceoRaw ?? 0
  const scored = execRaws.filter(e => e.score !== null).map(e => e.score as number)
  const execAvg = scored.length > 0 ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100) / 100 : 0
  const teamScore = teamRaw ?? 0

  return {
    ceoScore,
    ceoName: ceo?.name || '未识别',
    execScores: execRaws.map(e => ({ ...e, score: e.score ?? 0 })),
    execAvg,
    teamScore,
    finalScore: Math.round(((ceoScore + execAvg + teamScore) / 10) * 100) / 100,
    allScored,
  }
}

/** 最终得分颜色分级：>8 绿 / 7.5-8 黄 / 7-7.5 橙 / ≤7 红 */
export function scoreColor(score: number): 'green' | 'yellow' | 'orange' | 'red' {
  if (score > 8) return 'green'
  if (score > 7.5) return 'yellow'
  if (score > 7) return 'orange'
  return 'red'
}

// ── 校验与序列化 ──

/** 校验评价数据（保存/确认前）：每人权重合计=100%（±0.5%）、评分 0-10、唯一 CEO */
export function validateEvaluation(data: TeamEvaluationData, requireScored: boolean): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  const ceoCount = data.members.filter(m => m.profileType === 'CEO').length
  if (ceoCount === 0) errors.push('缺少实控人/CEO（需从简历识别或手动指定一名 CEO）')
  if (ceoCount > 1) errors.push('实控人/CEO 只能有一名')

  const checkDims = (dims: MemberDimension[], owner: string) => {
    const weightSum = dims.reduce((a, d) => a + (Number(d.weight) || 0), 0)
    if (Math.abs(weightSum - 1) > 0.005) {
      errors.push(`${owner} 的二级权重合计为 ${(weightSum * 100).toFixed(1)}%，须等于 100%`)
    }
    for (const d of dims) {
      if (d.weight < 0 || d.weight > 1) {
        errors.push(`${owner}·${d.label} 的权重须在 0%-100% 之间`)
        break
      }
      if (requireScored && (d.score === null || d.score === undefined)) {
        errors.push(`${owner}·${d.label} 尚未评分`)
      } else if (d.score !== null && d.score !== undefined && (d.score < 0 || d.score > 10)) {
        errors.push(`${owner}·${d.label} 的评分须在 0-10 之间`)
      }
    }
  }

  for (const m of data.members) checkDims(m.dimensions, m.name)
  checkDims(data.team, '团队整体')
  return { ok: errors.length === 0, errors }
}

/** 解析 DB 记录为结构化数据（容错） */
export function parseEvaluation(membersJson: string, teamJson: string): TeamEvaluationData {
  const sanitizeDims = (raw: unknown): MemberDimension[] =>
    Array.isArray(raw)
      ? raw
          .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
          .map(d => ({
            key: String(d.key || ''),
            label: String(d.label || ''),
            hint: String(d.hint || ''),
            group: String(d.group || ''),
            weight: Number(d.weight) || 0,
            score: d.score === null || d.score === undefined ? null : Number(d.score),
          }))
      : []
  let members: TeamMember[] = []
  let team: TeamDimension[] = []
  try {
    const parsed = JSON.parse(membersJson) as unknown
    if (Array.isArray(parsed)) {
      members = parsed
        .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
        .map(m => ({
          id: String(m.id || ''),
          name: String(m.name || '未命名'),
          roleLabel: String(m.roleLabel || ''),
          profileType: (['CEO', 'TECH', 'OPS'] as const).includes(m.profileType as ProfileType) ? (m.profileType as ProfileType) : 'OPS',
          dimensions: sanitizeDims(m.dimensions),
        }))
    }
  } catch { members = [] }
  try {
    const parsed = JSON.parse(teamJson) as unknown
    team = sanitizeDims(parsed)
  } catch { team = [] }
  return { members, team }
}

// ── AI 成员识别（从团队与治理模块资料提取简历身份） ──

const MEMBER_EXTRACTION_SYSTEM_PROMPT = `你是投资机构的尽调分析师。从创业团队的简历等资料中识别核心团队成员。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "members": [
    { "name": "姓名", "roleLabel": "身份原文（如：实控人/CEO、联合创始人/CTO、联合创始人/CMO、核心高管/财务总监）", "profileType": "CEO 或 TECH 或 OPS" }
  ]
}
profileType 映射规则：
- CEO：实控人、创始人、CEO、董事长、总经理（只能有一人；多人疑似时选持股最高或资料中最主要的主创始人）
- TECH：CTO、技术合伙人、产品合伙人、研发负责人、首席科学家、架构师（产品&技术画像）
- OPS：CMO、COO、销售/市场/运营/财务/法务/人力等其他核心成员（运营&销售画像）
要求：
- 只输出资料中真实出现的核心成员（3-8 人），不编造
- 姓名从简历/资料原文提取；无法确定姓名时用身份代称（如"技术合伙人"）
- 身份不确定时 roleLabel 写资料原文描述，profileType 按 OPS 处理`

/** 汇总团队与治理模块资料（文档全文 + 文本框；文本框粘贴的截图提取为 [图N] 占位并随图片一起提供给模型） */
async function buildTeamDigest(documents: Array<{ fileName: string; text: string }>, textBlocks: Array<{ content: string }>): Promise<{ digest: string; images: ExtractedImage[] }> {
  const parts: string[] = []
  for (const doc of documents) {
    const text = (doc.text || '').trim()
    parts.push(`【文档：${doc.fileName}】\n${text ? text.slice(0, 15000) : '（未能提取文本）'}`)
  }
  const { plain, images } = await buildMultimodalDigest(textBlocks)
  if (plain) {
    parts.push(`【维护人填写】\n${plain}`)
  }
  return { digest: parts.join('\n\n') || '（无资料）', images }
}

/** AI 识别成员 → 按画像模板生成打分表 */
export async function runMemberExtraction(projectId: string): Promise<{
  ok: boolean
  error?: string
  data?: TeamEvaluationData
}> {
  const resources = await getProjectModuleResources(projectId)
  const res = resources.find(r => r.moduleKey === 'TEAM_GOVERNANCE')
  // 只判断资料存在（不用 isModuleComplete——团队模块的完整判定要求评价表已确认，会形成死锁）
  const hasData = !!res && (
    res.documents.length > 0 ||
    res.screenshots.length > 0 ||
    res.textBlocks.some(t => t.content.trim().length > 0)
  )
  if (!hasData) {
    return { ok: false, error: '「团队与治理」模块暂无资料，请先到资料中心上传核心成员简历' }
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DeepSeek API Key 未配置')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 90000)
  try {
    const { digest, images } = await buildTeamDigest(res.documents, res.textBlocks)
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: MEMBER_EXTRACTION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildMessageContent(`以下是「团队与治理」模块的团队资料（含简历，文本框截图已按图片提供），请识别核心成员：\n\n${digest}`, images),
          },
        ],
        temperature: 0.2,
        max_tokens: 1500,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`DeepSeek 调用失败: ${response.status} ${errText.substring(0, 150)}`)
    }
    const data = (await response.json()) as { usage?: unknown; choices?: Array<{ message?: { content?: string } }> }
    recordTokenUsage('dd-harness', data.usage as Parameters<typeof recordTokenUsage>[1])
    const parsed = parseAgentJson<{ members?: Array<{ name?: string; roleLabel?: string; profileType?: string }> }>(
      data.choices?.[0]?.message?.content || ''
    )
    const rawMembers = Array.isArray(parsed?.members) ? parsed!.members : []
    if (rawMembers.length === 0) {
      return { ok: false, error: '未能从资料中识别出核心成员，请检查简历内容后重试' }
    }

    const members: TeamMember[] = rawMembers
      .filter(m => m && typeof m.name === 'string' && m.name.trim())
      .slice(0, 10)
      .map((m, i) => {
        const profileType = (['CEO', 'TECH', 'OPS'] as const).includes(m.profileType as ProfileType)
          ? (m.profileType as ProfileType)
          : 'OPS'
        return {
          id: `member-${Date.now()}-${i}`,
          name: m.name!.trim().slice(0, 30),
          roleLabel: String(m.roleLabel || '').slice(0, 40),
          profileType,
          dimensions: PROFILE_TEMPLATES[profileType].map(d => ({ ...d, score: null })),
        }
      })
    // 保证唯一 CEO：无 CEO 时提升首位为 CEO；多个 CEO 时仅保留第一个
    const ceoIdx = members.findIndex(m => m.profileType === 'CEO')
    if (ceoIdx === -1 && members.length > 0) {
      const first = members[0]
      first.profileType = 'CEO'
      first.dimensions = CEO_TEMPLATE.map(d => ({ ...d, score: null }))
    } else if (ceoIdx > -1) {
      for (const m of members) {
        if (m.profileType === 'CEO' && m !== members[ceoIdx]) {
          m.profileType = 'OPS'
          m.dimensions = OPS_TEMPLATE.map(d => ({ ...d, score: null }))
        }
      }
    }

    return { ok: true, data: { members, team: TEAM_TEMPLATE.map(d => ({ ...d, score: null })) } }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ── AI 审评分（确认后：校验各维度打分与简历描述的一致性） ──

export interface TeamScoringReview {
  rating: number
  analysis: string
  issues: string[]
  reviewedAt: string
}

const SCORING_REVIEW_SYSTEM_PROMPT = `你是投资机构投委会的团队评分复核 Agent。投资经理已完成创业团队评分表，你的任务是校验本次评分的质量。
核心校验规则：
1. 一致性：各成员各维度的打分与简历/资料描述是否一致（例：简历显示 15 年从业经验而"从业经验"仅打 3 分、或简历毫无亮点却打 9 分，均为不一致）
2. 区分度：同一成员所有维度打成同一个分数时，是否有资料支撑（无差异打分通常说明未认真评估）
3. 合理性：维度间得分分布与权重分配是否符合资料的强弱信号（如"投入资金"无信息却打高分）
严格输出 JSON（不要 markdown 代码块），结构：
{
  "rating": 0-10 的一位小数（10=打分与资料高度一致且区分合理；5-6=存在明显不一致；0-4=大面积失真或打分与资料相悖），
  "analysis": "复核分析（300字内：先给总体判断，再逐人指出与简历一致/不一致的具体维度及依据）",
  "issues": ["具体问题点 1（成员·维度：问题描述）", "问题点 2", ...]
}
要求：只基于给定的简历资料与评分数据，不编造；无问题时 issues 为空数组`

/** 确认后 AI 审评分：校验各维度打分与简历描述的一致性 → 0-10 评分 + 分析落库 aiReviewJson */
export async function runScoringReview(projectId: string): Promise<{
  ok: boolean
  error?: string
  review?: TeamScoringReview
}> {
  const record = await prisma.dDTeamEvaluation.findUnique({ where: { projectId } })
  if (!record || record.status !== 'CONFIRMED') {
    return { ok: false, error: '评价表未确认，无法审评' }
  }
  const resources = await getProjectModuleResources(projectId)
  const res = resources.find(r => r.moduleKey === 'TEAM_GOVERNANCE')
  if (!res) return { ok: false, error: '「团队与治理」模块资料不存在' }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DeepSeek API Key 未配置')

  const data = parseEvaluation(record.membersJson, record.teamJson)
  const result = computeEvaluation(data)

  // 评分表文本（供模型核对）
  const memberLines = data.members.map(m => {
    const dims = m.dimensions.map(d => `${d.label}(权重${Math.round(d.weight * 100)}%:${d.score ?? '—'}分)`).join('、')
    const profileName = m.profileType === 'CEO' ? '实控人/CEO' : m.profileType === 'TECH' ? '产品&技术' : '运营&销售'
    const sub = m.profileType === 'CEO' ? result.ceoScore : result.execScores.find(e => e.memberId === m.id)?.score
    return `- ${m.name}（${m.roleLabel || profileName}，画像：${profileName}）：${dims}｜小计 ${sub ?? '—'}`
  })
  const teamLine = `- 团队整体：${data.team.map(d => `${d.label}(权重${Math.round(d.weight * 100)}%:${d.score ?? '—'}分)`).join('、')}｜小计 ${result.teamScore}`
  const scoringText = `【评分表数据】（10 分制 = CEO ${result.ceoScore} + 高管平均 ${result.execAvg} + 团队整体 ${result.teamScore} = 最终 ${result.finalScore} 分）\n${memberLines.join('\n')}\n${teamLine}`

  const { digest, images } = await buildTeamDigest(res.documents, res.textBlocks)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 90000)
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: SCORING_REVIEW_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildMessageContent(`以下是「团队与治理」模块的简历等资料（文本框截图已按图片提供）：\n\n${digest}\n\n${scoringText}\n\n请复核本次评分质量。`, images),
          },
        ],
        temperature: 0.2,
        max_tokens: 2000,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`DeepSeek 调用失败: ${response.status} ${errText.substring(0, 150)}`)
    }
    const resp = (await response.json()) as { usage?: unknown; choices?: Array<{ message?: { content?: string } }> }
    recordTokenUsage('dd-harness', resp.usage as Parameters<typeof recordTokenUsage>[1])
    const parsed = parseAgentJson<{ rating?: number | string; analysis?: string; issues?: string[] }>(
      resp.choices?.[0]?.message?.content || ''
    )
    const rating = Number(parsed?.rating)
    if (parsed && Number.isFinite(rating) && parsed.analysis) {
      const review: TeamScoringReview = {
        rating: Math.max(0, Math.min(10, Math.round(rating * 10) / 10)),
        analysis: String(parsed.analysis).slice(0, 800),
        issues: (Array.isArray(parsed.issues) ? parsed.issues : []).map(String).slice(0, 8),
        reviewedAt: new Date().toISOString(),
      }
      await prisma.dDTeamEvaluation.update({
        where: { id: record.id },
        data: { aiReviewJson: JSON.stringify(review) },
      })
      return { ok: true, review }
    }
    return { ok: false, error: 'AI 审评分结果不完整' }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 自动生成团队评价表：团队与治理模块有资料且尚无评价记录时触发（成员识别 AI，失败静默）
 * 由资料保存/上传路由 fire-and-forget 调用，不阻塞主流程
 */
export async function maybeAutoGenerateTeamEvaluation(projectId: string): Promise<void> {
  try {
    const existing = await prisma.dDTeamEvaluation.findUnique({ where: { projectId }, select: { id: true } })
    if (existing) return
    const resources = await getProjectModuleResources(projectId)
    const res = resources.find(r => r.moduleKey === 'TEAM_GOVERNANCE')
    // 只判断资料存在（不用 isModuleComplete——团队模块的完整判定要求评价表已确认，会形成死锁）
    const hasData = !!res && (
      res.documents.length > 0 ||
      res.screenshots.length > 0 ||
      res.textBlocks.some(t => t.content.trim().length > 0)
    )
    if (!hasData) return
    const result = await runMemberExtraction(projectId)
    if (!result.ok || !result.data) return
    await prisma.dDTeamEvaluation.upsert({
      where: { projectId },
      create: { projectId, membersJson: JSON.stringify(result.data.members), teamJson: JSON.stringify(result.data.team) },
      update: {},
    })
  } catch {
    // 自动生成失败静默（用户仍可通过卡片按钮手动生成）
  }
}
