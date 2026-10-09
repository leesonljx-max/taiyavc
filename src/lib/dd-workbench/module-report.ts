/**
 * 尽调报告生成：按九大模块分别总结
 *
 * 输入：各模块的文档全文 + 文本框内容（文本框粘贴的截图以图片形式提供给模型理解，报告中按【图N】引用嵌入）
 * 输出：每模块 { summary, opportunities[], risks[], images[], teamEvaluation? }（含机会与风险），存 DDModuleResource.reportJson
 */

import prisma from '@/lib/prisma'
import { parseAgentJson } from '@/lib/dd-harness/agent'
import { recordTokenUsage } from '@/lib/token-accounting'
import { getProjectModuleResources, isModuleComplete, findMissingModules, type ParsedModuleResource, type DDModuleReport, type DDModuleAnalysis } from './resources'
import { buildMultimodalDigest, buildMessageContent, type ExtractedImage } from './vision'
import { parseEvaluation, computeEvaluation } from './team-evaluation'
import { DEEPSEEK_MODEL } from '@/lib/deepseek-model'
import { buildUserSkillPromptBlock } from '@/lib/skill-registry'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

/** 单模块文档全文参与总结的最大长度 */
const MAX_DOC_TEXT = 12000

const MODULE_REPORT_SYSTEM_PROMPT = `你是一级市场资深尽调分析师。基于该尽调模块的全部资料（上传文档内容、维护人填写的文本说明、文本框粘贴的截图——截图已按图片原样提供给你），输出该模块的详细尽调分析报告。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "summary": "详细尽调分析（700-1000字）。必须按以下结构分段输出（换行分段，每段以小标题开头）：\\n一、关键事实：逐条罗列资料中的核心数据、事件与表述（每条一行，重要数据加粗）\\n二、分析判断：基于关键事实层层递进分析——先优势、再缺口、后逻辑一致性，每条判断必须援引上文的具体数据\\n三、核心结论：2-3 句话给出该模块整体判断与建议\\n四、技能视角：仅当挂载的用户技能分析视角超出本模块固定框架（独立领域）时输出——每个独立技能一小节，小标题为「技能视角·技能名」，内容按该技能的分析框架展开（分点+加粗）；与本模块框架相似的技能不单列，其视角已融入上文对应段落\\n核心结论、关键数据、重大风险一律用 **加粗** 标注；资料中含 [图N] 截图且该图对分析有佐证价值时，在对应分析句后插入【图N】引用（报告会将该图原样嵌入）",
  "opportunities": ["机会点 1（基于资料的具体机会，如技术领先/订单增长/团队强项）", "机会点 2", ...],
  "risks": ["风险点 1（基于资料的具体风险/缺口/待核实项）", "风险点 2", ...]
}
要求：
- 只基于给定资料（含提供的截图内容）总结，资料未涉及的信息不编造；关键缺口可作为风险点指出（如"良率数据未提供，需补充验证"）
- 层层递推：先事实、再判断、后结论；判断与结论必须援引事实中的具体数据，禁止空泛定性
- 需要图片佐证解释时在分析中插入【图N】标记（如"产品形态见【图2】"），无佐证价值的图不引用
- opportunities 与 risks 各 2-5 条，每条具体可核验，条目内重点用 **加粗** 标注
- 排版：summary 全文分点分段展示（每点/每段独立一行），不得输出无分段的整段文字
- 语气克制客观，符合投委会阅读习惯`

/** 团队与治理模块附加指令：评分表逻辑分析 */
const TEAM_EVAL_ANALYSIS_HINT = `\n\n【团队评分表（已确认，必须纳入分析）】
本模块除常规分析外，还必须在「二、分析判断」中包含一段"评分逻辑分析"：结合简历资料评估各维度打分是否与描述一致（引用 AI 审评结论）、得分分布反映的团队强项与短板；并在「三、核心结论」中给出对团队评分的总体判断（评分是否可信、团队的核心风险点）。`

async function callModuleReport(
  moduleName: string,
  coreQuestion: string,
  inputsHint: string,
  contentDigest: string,
  images: ExtractedImage[],
  extraPrompt = '',
  skillBlock = ''
): Promise<DDModuleReport> {
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
          { role: 'system', content: MODULE_REPORT_SYSTEM_PROMPT + skillBlock },
          {
            role: 'user',
            content: buildMessageContent(
              `尽调模块：${moduleName}\n投委会核心问题：${coreQuestion}\n建议输入：${inputsHint}\n\n该模块资料：\n\n${contentDigest}${extraPrompt}\n\n请输出该模块的详细尽调分析报告 JSON。`,
              images
            ),
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`DeepSeek 调用失败: ${response.status} ${errText.substring(0, 150)}`)
    }
    const data = (await response.json()) as {
      usage?: unknown
      choices?: Array<{ message?: { content?: string } }>
    }
    recordTokenUsage('dd-harness', data.usage as Parameters<typeof recordTokenUsage>[1])
    const parsed = parseAgentJson<{ summary?: string; opportunities?: string[]; risks?: string[] }>(
      data.choices?.[0]?.message?.content || ''
    )
    if (!parsed || !parsed.summary) throw new Error(`「${moduleName}」模块报告生成不完整，请重试`)
    return {
      summary: String(parsed.summary),
      opportunities: (Array.isArray(parsed.opportunities) ? parsed.opportunities : []).map(String).slice(0, 5),
      risks: (Array.isArray(parsed.risks) ? parsed.risks : []).map(String).slice(0, 5),
      generatedAt: new Date().toISOString(),
      images: images.map(i => ({ marker: i.marker, src: i.src })),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/** 组装单模块的资料摘要：文档全文截断 + 文本框（截图→[图N] 占位并收集图片，随消息以图片形式提供给模型）+ 历史截图 */
async function buildContentDigest(res: ParsedModuleResource): Promise<{ digest: string; images: ExtractedImage[] }> {
  const parts: string[] = []
  for (const doc of res.documents) {
    const text = (doc.text || '').trim()
    parts.push(`【文档：${doc.fileName}】\n${text ? text.slice(0, MAX_DOC_TEXT) : '（未能提取文本）'}`)
  }
  const { plain, images } = await buildMultimodalDigest(res.textBlocks)
  if (plain) {
    parts.push(`【维护人填写】\n${plain}`)
  }
  // 历史上传的截图（功能已下线，存量数据仍参与理解与引用）
  if (res.screenshots.length > 0) {
    const legacy = res.screenshots.slice(0, Math.max(0, 6 - images.length))
    if (legacy.length > 0) {
      const startIdx = images.length
      legacy.forEach((s, i) => {
        images.push({ marker: `图${startIdx + i + 1}`, src: s.url, dataUri: undefined })
      })
      parts.push(`【历史截图】${legacy.map((_, i) => `[图${startIdx + i + 1}]`).join('、')}`)
    }
  }
  return { digest: parts.join('\n\n') || '（无资料）', images }
}

/** 团队与治理：已确认评分表快照（进报告展示与评分逻辑分析） */
async function buildTeamEvaluationSnapshot(projectId: string): Promise<NonNullable<DDModuleReport['teamEvaluation']> | null> {
  const record = await prisma.dDTeamEvaluation.findUnique({ where: { projectId } })
  if (!record || record.status !== 'CONFIRMED') return null
  const data = parseEvaluation(record.membersJson, record.teamJson)
  const result = computeEvaluation(data)
  let aiReview: { rating: number; analysis: string } | null = null
  if (record.aiReviewJson) {
    try {
      const r = JSON.parse(record.aiReviewJson) as { rating?: number; analysis?: string }
      if (Number.isFinite(Number(r.rating))) aiReview = { rating: Number(r.rating), analysis: String(r.analysis || '') }
    } catch { aiReview = null }
  }
  return {
    finalScore: record.finalScore ?? result.finalScore,
    ceoName: result.ceoName,
    ceoScore: result.ceoScore,
    execAvg: result.execAvg,
    teamScore: result.teamScore,
    members: data.members.map(m => ({
      name: m.name,
      identity: m.profileType === 'CEO' ? '实控人/CEO' : m.profileType === 'TECH' ? '联创·产品&技术' : '联创·运营&销售',
      score: m.profileType === 'CEO' ? result.ceoScore : result.execScores.find(e => e.memberId === m.id)?.score ?? null,
    })),
    aiReview,
    confirmedAt: record.confirmedAt?.toISOString() || null,
  }
}

/**
 * 生成尽调报告：九大模块分别总结（并发 3 组控制速率），逐模块落库 reportJson
 * 返回生成后的全量模块资料
 * userId（P3.6）：传入时注入本人 CONFIRMED 技能（分析框架冲突时以用户技能为准）
 */
export async function runModuleReportGeneration(projectId: string, projectName: string, userId?: string): Promise<{
  ok: boolean
  error?: string
  missing: string[]
  resources?: ParsedModuleResource[]
}> {
  const resources = await getProjectModuleResources(projectId)

  // 完整性检查：九大模块任一缺资料即拒绝（团队与治理必须已确认评分表）
  const missing = findMissingModules(resources)
  if (missing.length > 0) {
    return { ok: false, missing, error: `以下模块资料不完整：${missing.join('、')}。请到资料中心补充（上传文档/填写文本（可粘贴截图）任一项即可）` }
  }

  // 用户技能块（本人 CONFIRMED 技能；无技能时为空串，完全走固定框架）
  const skillBlock = await buildUserSkillPromptBlock(userId).catch(() => '')

  const { DD_TEMPLATE_MODULES } = await import('./template')
  const tplByKey = new Map(DD_TEMPLATE_MODULES.map(m => [m.key, m]))

  // 团队与治理：评分表快照（生成时点数据，随报告落库）
  const teamEvaluation = await buildTeamEvaluationSnapshot(projectId).catch(() => null)

  // 并发 3 组（9 模块 ÷ 3），兼顾速度与 API 限流
  const groups: ParsedModuleResource[][] = [[], [], []]
  resources.forEach((r, i) => groups[i % 3].push(r))

  const reports = new Map<string, DDModuleReport>()
  const failures: string[] = []
  for (const group of groups) {
    await Promise.all(
      group.map(async res => {
        try {
          const tpl = tplByKey.get(res.moduleKey)!
          const { digest, images } = await buildContentDigest(res)
          // 团队与治理：评分表数据 + 评分逻辑分析指令
          let extraPrompt = ''
          if (res.moduleKey === 'TEAM_GOVERNANCE' && teamEvaluation) {
            const memberText = teamEvaluation.members
              .map(m => `${m.name}（${m.identity}）${m.score?.toFixed(2) ?? '—'} 分`)
              .join('、')
            extraPrompt = `${TEAM_EVAL_ANALYSIS_HINT}\n最终得分 ${teamEvaluation.finalScore}（10 分制）＝CEO ${teamEvaluation.ceoScore} + 高管平均 ${teamEvaluation.execAvg} + 团队整体 ${teamEvaluation.teamScore}\n成员得分：${memberText}\nAI 审评分：${teamEvaluation.aiReview ? `${teamEvaluation.aiReview.rating}（${teamEvaluation.aiReview.analysis}）` : '未生成'}`
          }
          const report = await callModuleReport(
            `${res.moduleName}（项目：${projectName}）`,
            tpl.coreQuestion,
            tpl.inputs,
            digest,
            images,
            extraPrompt,
            skillBlock
          )
          if (res.moduleKey === 'TEAM_GOVERNANCE' && teamEvaluation) {
            report.teamEvaluation = teamEvaluation
          }
          reports.set(res.moduleKey, report)
        } catch (err) {
          failures.push(`${res.moduleName}: ${err instanceof Error ? err.message : '生成失败'}`)
        }
      })
    )
  }

  if (failures.length > 0) {
    return { ok: false, missing: [], error: `部分模块报告生成失败（${failures.join('；')}），已生成的不受影响，可重试` }
  }

  // 逐模块落库（报告内容已更新 → 同步清空旧的外部校验结果，避免校验与报告脱节）
  for (const [moduleKey, report] of reports) {
    await prisma.dDModuleResource.update({
      where: { projectId_moduleKey: { projectId, moduleKey } },
      data: { reportJson: JSON.stringify(report), verificationJson: null },
    })
  }

  return { ok: true, missing: [], resources: await getProjectModuleResources(projectId) }
}

// ═══════════ 单模块分析（事实卡 + 证据与行动） ═══════════

const MODULE_ANALYSIS_SYSTEM_PROMPT = `你是一级市场资深尽调分析师。基于该尽调模块上传的资料，提取事实卡与下一步行动。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "facts": [
    {
      "fact": "一条可核验的关键事实（数据/事件/表述，60字内，摘自资料原文或忠实概括）",
      "source": "来源（如：文档《技术架构.txt》/ 维护人填写 / 访谈纪要）",
      "grade": "证据等级：A=文档原文可定位；B=维护人说明/访谈内容；C=由资料推断；D=待核验（资料中仅有间接线索）"
    }
  ],
  "actions": ["下一步行动 1（如：补充良率验证报告、向项目方确认订单金额）", "行动 2"]
}
要求：
- facts 提取 5-12 条，覆盖该模块的关键信息点；只基于给定资料，不编造
- grade 只能取 A/B/C/D 单字母
- actions 2-5 条，针对资料缺口与待核验项给出可执行的下一步`

/** 单模块分析：AI 从模块资料提取事实卡（facts）与下一步行动（actions）；userId 注入本人技能（P3.6） */
export async function runModuleAnalysis(projectId: string, moduleKey: string, userId?: string): Promise<{
  ok: boolean
  error?: string
  analysis?: DDModuleAnalysis
}> {
  const resources = await getProjectModuleResources(projectId)
  const res = resources.find(r => r.moduleKey === moduleKey)
  if (!res) return { ok: false, error: '无效的模块标识' }
  if (!isModuleComplete(res)) {
    return { ok: false, error: `「${res.moduleName}」模块暂无资料，请先到资料中心上传文档/填写文本/上传截图` }
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DeepSeek API Key 未配置')

  // 用户技能块（本人 CONFIRMED 技能；无技能时为空串）
  const skillBlock = await buildUserSkillPromptBlock(userId).catch(() => '')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 90000)
  try {
    const { digest, images } = await buildContentDigest(res)
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: MODULE_ANALYSIS_SYSTEM_PROMPT + skillBlock },
          {
            role: 'user',
            content: buildMessageContent(`尽调模块：${res.moduleName}\n模块核心问题：${res.coreQuestion}\n\n该模块资料：\n\n${digest}\n\n请输出事实卡与下一步行动 JSON。`, images),
          },
        ],
        temperature: 0.3,
        max_tokens: 3000,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`DeepSeek 调用失败: ${response.status} ${errText.substring(0, 150)}`)
    }
    const data = (await response.json()) as {
      usage?: unknown
      choices?: Array<{ message?: { content?: string } }>
    }
    recordTokenUsage('dd-harness', data.usage as Parameters<typeof recordTokenUsage>[1])
    const parsed = parseAgentJson<{ facts?: Array<{ fact?: string; source?: string; grade?: string }>; actions?: string[] }>(
      data.choices?.[0]?.message?.content || ''
    )
    const rawFacts = Array.isArray(parsed?.facts) ? parsed!.facts : []
    if (rawFacts.length === 0) {
      return { ok: false, error: `「${res.moduleName}」分析结果为空，请重试` }
    }
    const analysis: DDModuleAnalysis = {
      facts: rawFacts
        .filter(f => f && typeof f.fact === 'string' && f.fact.trim())
        .slice(0, 15)
        .map((f, i) => ({
          id: `fact-${Date.now()}-${i}`,
          fact: f.fact!.trim().slice(0, 200),
          source: (f.source || '—').slice(0, 60),
          grade: (['A', 'B', 'C', 'D'] as const).includes(f.grade as 'A') ? (f.grade as 'A' | 'B' | 'C' | 'D') : 'C',
          status: 'PENDING' as const,
        })),
      actions: (Array.isArray(parsed?.actions) ? parsed!.actions : []).map(String).slice(0, 5),
      analyzedAt: new Date().toISOString(),
    }
    if (analysis.facts.length === 0) {
      return { ok: false, error: `「${res.moduleName}」分析结果为空，请重试` }
    }

    const record = await prisma.dDModuleResource.upsert({
      where: { projectId_moduleKey: { projectId, moduleKey } },
      create: { projectId, moduleKey },
      update: {},
    })
    await prisma.dDModuleResource.update({
      where: { id: record.id },
      data: { analysisJson: JSON.stringify(analysis) },
    })

    return { ok: true, analysis }
  } finally {
    clearTimeout(timeoutId)
  }
}
