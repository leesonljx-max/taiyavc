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
import { getProjectModuleResources, isModuleComplete } from './resources'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-v4-flash'

// ── 类型 ──

export type ProfileType = 'CEO' | 'TECH' | 'OPS'

/** 维度定义（模板静态结构） */
export interface DimensionDef {
  key: string
  label: string
  hint: string
  group: string
  weight: number
}

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

// ── 评价模板（默认权重源自评价模型 Excel，可调） ──

/** 实控人/CEO 模板（13 维度，区间系数 6，满分 60） */
export const CEO_TEMPLATE: DimensionDef[] = [
  { key: 'education', label: '学历背景', hint: '是否与创业方向吻合', group: '创业素质', weight: 0.05 },
  { key: 'experience', label: '从业经验', hint: '是否与创业方向吻合', group: '创业素质', weight: 0.15 },
  { key: 'business_sense', label: '商业思维', hint: '利润追求/市场嗅觉/财务功底', group: '创业素质', weight: 0.15 },
  { key: 'financing', label: '融资能力', hint: '表达能力/形象/逻辑思路', group: '创业素质', weight: 0.10 },
  { key: 'system_building', label: '制度建设', hint: '内部管理/是否连续创业', group: '创业素质', weight: 0.10 },
  { key: 'strategy', label: '战略能力', hint: '短中长期是否清晰明了', group: '创业素质', weight: 0.05 },
  { key: 'rallying', label: '号召力', hint: '找人的能力/是否一呼百应', group: '创业素质', weight: 0.05 },
  { key: 'character', label: '人品性格', hint: '真诚度/品行修养/过往风评/背调', group: '创业素质', weight: 0.05 },
  { key: 'vision', label: '格局愿景', hint: '分享精神/对成功的渴望', group: '创业素质', weight: 0.05 },
  { key: 'capital_invested', label: '投入资金', hint: '投入与身家相关', group: '创业意愿', weight: 0.05 },
  { key: 'time_invested', label: '投入精力', hint: '上班时间/是否兼职/其他副业', group: '创业意愿', weight: 0.05 },
  { key: 'family_support', label: '家境支持', hint: '家境实力/家人是否支持创业', group: '创业意愿', weight: 0.05 },
  { key: 'salary', label: '薪酬', hint: '与发展阶段匹配', group: '创业意愿', weight: 0.10 },
]

/** 产品&技术画像模板（10 维度，区间系数 2，满分 20） */
export const TECH_TEMPLATE: DimensionDef[] = [
  { key: 'education', label: '学历背景', hint: '是否与创业方向吻合', group: '创业素质', weight: 0.10 },
  { key: 'experience', label: '从业经验', hint: '是否与创业方向吻合', group: '创业素质', weight: 0.15 },
  { key: 'role_involvement', label: '参与角色', hint: '全流程亲自下场干/把握大方向/问题专家/吉祥物', group: '创业素质', weight: 0.15 },
  { key: 'complementarity', label: '能力互补性', hint: '能力是否与CEO互补', group: '创业素质', weight: 0.10 },
  { key: 'character', label: '人品性格', hint: '真诚度/品行修养/背调', group: '创业素质', weight: 0.05 },
  { key: 'capital_invested', label: '投入资金', hint: '投入与身家相关', group: '创业意愿', weight: 0.10 },
  { key: 'time_invested', label: '投入精力', hint: '上班时间/是否兼职/其他副业', group: '创业意愿', weight: 0.05 },
  { key: 'salary', label: '薪酬', hint: '与发展阶段匹配', group: '创业意愿', weight: 0.15 },
  { key: 'equity', label: '持股情况', hint: '是否与能力匹配', group: '创业意愿', weight: 0.10 },
  { key: 'family_support', label: '家境支持', hint: '是否等米下锅/刚性支出情况', group: '创业意愿', weight: 0.05 },
]

/** 运营&销售画像模板（11 维度，区间系数 2，满分 20） */
export const OPS_TEMPLATE: DimensionDef[] = [
  { key: 'education', label: '学历背景', hint: '是否与创业方向吻合', group: '创业素质', weight: 0.10 },
  { key: 'experience', label: '从业经验', hint: '是否与创业方向吻合', group: '创业素质', weight: 0.15 },
  { key: 'role_involvement', label: '参与角色', hint: '全流程亲自下场干/把握大方向/问题专家/吉祥物', group: '创业素质', weight: 0.15 },
  { key: 'business_sense', label: '商业嗅觉', hint: '市场水温感知/客户需求把握', group: '创业素质', weight: 0.05 },
  { key: 'complementarity', label: '能力互补性', hint: '能力是否与CEO互补', group: '创业素质', weight: 0.05 },
  { key: 'character', label: '人品性格', hint: '真诚度/品行修养/背调', group: '创业素质', weight: 0.05 },
  { key: 'capital_invested', label: '投入资金', hint: '投入与身家相关', group: '创业意愿', weight: 0.05 },
  { key: 'time_invested', label: '投入精力', hint: '上班时间/是否兼职/其他副业', group: '创业意愿', weight: 0.10 },
  { key: 'salary', label: '薪酬', hint: '与发展阶段匹配', group: '创业意愿', weight: 0.15 },
  { key: 'equity', label: '持股情况', hint: '是否与能力匹配', group: '创业意愿', weight: 0.10 },
  { key: 'family_support', label: '家境支持', hint: '是否等米下锅/刚性支出情况', group: '创业意愿', weight: 0.05 },
]

/** 团队整体模板（4 维度，区间系数 2，满分 20） */
export const TEAM_TEMPLATE: DimensionDef[] = [
  { key: 'completeness', label: '完整性', hint: '目前是否有明显短板', group: '完整性', weight: 0.25 },
  { key: 'scalability', label: '可扩展性', hint: '未来引入核心人员的意愿和可行性', group: '完整性', weight: 0.10 },
  { key: 'past_connection', label: '过往连接', hint: '同事、同学等，看合作时间', group: '稳定性', weight: 0.40 },
  { key: 'interest_binding', label: '利益绑定', hint: '股权分布是否合理', group: '稳定性', weight: 0.25 },
]

const PROFILE_TEMPLATES: Record<ProfileType, DimensionDef[]> = {
  CEO: CEO_TEMPLATE,
  TECH: TECH_TEMPLATE,
  OPS: OPS_TEMPLATE,
}

export const PROFILE_LABELS: Record<ProfileType, string> = {
  CEO: '实控人/CEO（60分）',
  TECH: '产品&技术画像（20分）',
  OPS: '运营&销售画像（20分）',
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

/** 汇总团队与治理模块资料（文档全文 + 文本框，图片标记为占位） */
function buildTeamDigest(documents: Array<{ fileName: string; text: string }>, textBlocks: Array<{ content: string }>): string {
  const parts: string[] = []
  for (const doc of documents) {
    const text = (doc.text || '').trim()
    parts.push(`【文档：${doc.fileName}】\n${text ? text.slice(0, 15000) : '（未能提取文本）'}`)
  }
  const texts = textBlocks.filter(t => t.content && t.content.trim())
  if (texts.length > 0) {
    // 粘贴截图的富文本内容过滤 img 标签，避免 HTML 噪音进入模型
    const plain = texts.map((t, i) => `${i + 1}. ${t.content.replace(/<img[^>]*>/g, '[截图]').replace(/<[^>]+>/g, ' ').trim()}`).join('\n')
    parts.push(`【维护人填写】\n${plain}`)
  }
  return parts.join('\n\n') || '（无资料）'
}

/** AI 识别成员 → 按画像模板生成打分表 */
export async function runMemberExtraction(projectId: string): Promise<{
  ok: boolean
  error?: string
  data?: TeamEvaluationData
}> {
  const resources = await getProjectModuleResources(projectId)
  const res = resources.find(r => r.moduleKey === 'TEAM_GOVERNANCE')
  if (!res || !isModuleComplete(res)) {
    return { ok: false, error: '「团队与治理」模块暂无资料，请先到资料中心上传核心成员简历' }
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DeepSeek API Key 未配置')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 90000)
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: MEMBER_EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: `以下是「团队与治理」模块的团队资料（含简历），请识别核心成员：\n\n${buildTeamDigest(res.documents, res.textBlocks)}` },
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
