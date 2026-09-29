/**
 * 尽调报告生成：按九大模块分别总结
 *
 * 输入：各模块的文档全文 + 文本框内容（截图不进文本模型，随报告原样嵌入展示）
 * 输出：每模块 { summary, opportunities[], risks[] }（含机会与风险），存 DDModuleResource.reportJson
 */

import prisma from '@/lib/prisma'
import { parseAgentJson } from '@/lib/dd-harness/agent'
import { recordTokenUsage } from '@/lib/token-accounting'
import { getProjectModuleResources, isModuleComplete, findMissingModules, type ParsedModuleResource, type DDModuleReport, type DDModuleAnalysis } from './resources'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-v4-flash'

/** 单模块文档全文参与总结的最大长度 */
const MAX_DOC_TEXT = 12000

const MODULE_REPORT_SYSTEM_PROMPT = `你是一级市场资深尽调分析师。基于该尽调模块的全部资料（上传文档内容、维护人填写的文本说明），输出该模块的详细尽调分析报告。
严格输出 JSON（不要 markdown 代码块），结构：
{
  "summary": "该模块的详细尽调分析（600-900字，用换行分三段展开：「关键事实」罗列资料中的核心数据与事实；「分析判断」给出条理清晰的专业分析（优势、缺口、逻辑一致性，判断必须援引具体数据）；「核心结论」用 2-3 句话给出该模块整体判断。对最核心的结论、关键数据与重大风险用 **加粗** 标注（Markdown 双星号语法）",
  "opportunities": ["机会点 1（基于资料的具体机会，如技术领先/订单增长/团队强项）", "机会点 2", ...],
  "risks": ["风险点 1（基于资料的具体风险/缺口/待核实项）", "风险点 2", ...]
}
要求：
- 只基于给定资料总结，资料未涉及的信息不编造；关键缺口可作为风险点指出（如"良率数据未提供，需补充验证"）
- 先事实后判断：分析判断必须援引关键事实中的具体数据，禁止空泛定性
- opportunities 与 risks 各 2-5 条，每条具体可核验
- 核心结论、关键数据、重大风险必须用 **加粗** 标注，便于投委会快速抓住重点
- 语气克制客观，符合投委会阅读习惯`

async function callModuleReport(moduleName: string, coreQuestion: string, inputsHint: string, contentDigest: string): Promise<DDModuleReport> {
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
          { role: 'system', content: MODULE_REPORT_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `尽调模块：${moduleName}\n投委会核心问题：${coreQuestion}\n建议输入：${inputsHint}\n\n该模块资料：\n\n${contentDigest}\n\n请输出该模块的尽调总结报告 JSON。`,
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
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/** 组装单模块的资料摘要（文档全文截断 + 文本框 + 截图说明） */
function buildContentDigest(res: ParsedModuleResource): string {
  const parts: string[] = []
  for (const doc of res.documents) {
    const text = (doc.text || '').trim()
    parts.push(`【文档：${doc.fileName}】\n${text ? text.slice(0, MAX_DOC_TEXT) : '（未能提取文本）'}`)
  }
  const texts = res.textBlocks.filter(t => t.content.trim())
  if (texts.length > 0) {
    // 文本框支持粘贴截图（富文本 HTML）：img 转为 [截图] 占位，其余标签剥除，避免噪音进入模型
    const plain = texts
      .map((t, i) => `${i + 1}. ${t.content.replace(/<img[^>]*>/g, '[截图]').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim()}`)
      .join('\n')
    parts.push(`【维护人填写】\n${plain}`)
  }
  if (res.screenshots.length > 0) {
    parts.push(`【截图材料】共 ${res.screenshots.length} 张截图（随报告原样展示，含关键界面/数据图）`)
  }
  return parts.join('\n\n') || '（无资料）'
}

/**
 * 生成尽调报告：九大模块分别总结（并发 3 组控制速率），逐模块落库 reportJson
 * 返回生成后的全量模块资料
 */
export async function runModuleReportGeneration(projectId: string, projectName: string): Promise<{
  ok: boolean
  error?: string
  missing: string[]
  resources?: ParsedModuleResource[]
}> {
  const resources = await getProjectModuleResources(projectId)

  // 完整性检查：九大模块任一缺资料即拒绝
  const missing = findMissingModules(resources)
  if (missing.length > 0) {
    return { ok: false, missing, error: `以下模块资料不完整：${missing.join('、')}。请到资料中心补充（上传文档/填写文本（可粘贴截图）任一项即可）` }
  }

  const { DD_TEMPLATE_MODULES } = await import('./template')
  const tplByKey = new Map(DD_TEMPLATE_MODULES.map(m => [m.key, m]))

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
          const report = await callModuleReport(
            `${res.moduleName}（项目：${projectName}）`,
            tpl.coreQuestion,
            tpl.inputs,
            buildContentDigest(res)
          )
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

  // 逐模块落库
  for (const [moduleKey, report] of reports) {
    await prisma.dDModuleResource.update({
      where: { projectId_moduleKey: { projectId, moduleKey } },
      data: { reportJson: JSON.stringify(report) },
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

/** 单模块分析：AI 从模块资料提取事实卡（facts）与下一步行动（actions） */
export async function runModuleAnalysis(projectId: string, moduleKey: string): Promise<{
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

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 90000)
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: MODULE_ANALYSIS_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `尽调模块：${res.moduleName}\n模块核心问题：${res.coreQuestion}\n\n该模块资料：\n\n${buildContentDigest(res)}\n\n请输出事实卡与下一步行动 JSON。`,
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
