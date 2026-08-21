/**
 * AI行研 ChatBot Runner（Harness 架构）
 *
 * 流程（成本前置）：
 * 1. 记忆召回（关键词 SQL，零 token）→ 注入 system prompt
 * 2. Harness Agent 循环（maxTurns=4）：
 *    - search_projects：内部项目库检索（SQL，零 token），优先投后/尽调项目
 *    - web_search：联网补充（collect 模式 + 12h 缓存，仅缺信息时）
 * 3. 生成回答：一级市场投资人视角 + 三原则 + 模板化输出
 * 4. 记忆提取（异步轻量调用，不阻塞回答）
 */

import { runAgent } from '@/lib/dd-harness/agent'
import type { HarnessTool } from '@/lib/dd-harness/types'
import { searchProjectsTool } from '@/lib/dd-harness/projects-tool'
import { webSearchTool } from '@/lib/dd-harness/tools'
import { recallMemories, formatMemoriesForPrompt, extractAndSaveMemories } from '@/lib/ai-memory'
import { recordTokenUsage } from '@/lib/token-accounting'

// ── System Prompt（一级市场投资人视角 + 三原则 + 模板契约） ──

export const AI_RESEARCH_SYSTEM_PROMPT = `你是「AI行研」，一家一级市场投资机构的投研助手，服务投资团队（投资人视角，非卖方视角）。

## 工作方式
1. 优先调用 search_projects 检索我们内部项目库（含投后/尽调项目），有相关项目时汇总其信息与尽调结论，并在回答中注明"信息来源：内部项目库·XX项目（阶段）"
2. 项目库没有或不完整时，调用 web_search 联网补充（每次分析最多 2 次，优先最关键信息缺口）
3. 基于内部数据 + 联网信息回答；两者都没有时如实说明，不编造

## 核心原则（必须遵守）
1️⃣ 融资时间窗口：凡对行业/项目做投资判断，必须评估当前融资时间窗口还剩多久；窗口不足半年的，在回答最顶部输出：
⚠️ 时间窗口风险：本行业/项目融资窗口预计剩余不足【X个月】，建议加快尽调或重新评估进入时点。
2️⃣ 竞争格局：涉及竞争激烈的行业时，必须分析该行业/项目是否属于领军者、是否存在差异化打法（技术/场景/商业模式任一维度），缺失则明确指出
3️⃣ 数据突出 + 模板化：
- 所有关键数据（金额/估值/轮次/百分比/日期/排名）用【】包裹，如【5亿元】【A轮】【18个月】
- 按模板输出保持条理

## 输出模板（按问题类型选择）
### 行业分析
① 行业概览（1-2句）
② 竞争格局与领军者判断
③ 融资热度与时间窗口评估
④ 内部项目关联（如有）
⑤ 投资建议（1-3条，含风险）

### 项目分析
① 项目概况（定位/产品/阶段）
② 核心竞争力与差异化
③ 融资情况与估值
④ 时间窗口与风险
⑤ 建议

### 对比分析
① 对比维度表（|维度|A|B|）
② 差异化结论
③ 建议

## 其他要求
- 回答末尾列出"信息来源"（内部项目库名单 + 联网来源链接，仅真实检索到的）
- 数字保留原始精度，不夸大
- 简洁专业，单次回答通常 300-800 字`

// ── Runner ──

export interface AIRunOptions {
  sessionId: string
  /** 最近 2 轮对话原文（工作记忆，调用方从消息表取） */
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface AIRunResult {
  content: string
  /** 内部命中项目（溯源展示） */
  projectHits: Array<{ projectId: string; projectName: string; followStage: string }>
  /** 联网引用来源 */
  citations: Array<{ label: string; url: string }>
}

/**
 * 执行一轮 AI行研对话：
 * 记忆召回 → Harness Agent（内部库+联网）→ 回答 → 异步记忆提取
 */
export async function runAIResearchChat(
  userMessage: string,
  opts: AIRunOptions
): Promise<AIRunResult> {
  // 1. 记忆召回（零 token）
  const memories = await recallMemories(userMessage, opts.sessionId)
  const memoryBlock = formatMemoriesForPrompt(memories)

  // 2. 构建 system prompt：核心契约 + 历史记忆 + 工作记忆
  const systemPrompt = [
    AI_RESEARCH_SYSTEM_PROMPT,
    `\n## 历史记忆\n${memoryBlock}`,
  ].join('\n')

  const tools: HarnessTool[] = [searchProjectsTool, webSearchTool]

  // 工作记忆：最近 2 轮原文（拼入首条 user 消息，保持 Agent 单次调用上下文精简）
  const recentContext = opts.recentMessages
    .slice(-4) // 2 轮 = 4 条消息
    .map(m => `${m.role === 'user' ? '用户' : '助手'}：${m.content.substring(0, 800)}`)
    .join('\n')
  const userPrompt = recentContext
    ? `【最近对话】\n${recentContext}\n\n【本次提问】\n${userMessage}`
    : userMessage

  // 3. Agent 循环（内部库检索 + 按需联网）
  const { content, sessionLog } = await runAgent({
    systemPrompt,
    userPrompt,
    tools,
    maxTurns: 4,
    temperature: 0.4,
  })

  // token 记账（归属 AI行研 模块；runAgent 内部多次调用，按会话日志估算）
  // 注：runAgent 未透传每次 usage，按消息量估算（输入≈prompt+工具结果，输出≈content）
  const estimatedInput = Math.ceil((systemPrompt.length + userPrompt.length) * 1.2)
  const estimatedOutput = Math.ceil(content.length * 1.5)
  recordTokenUsage('ai-research', {
    prompt_tokens: estimatedInput,
    completion_tokens: estimatedOutput,
  })

  // 4. 提取溯源信息：内部项目命中（从工具调用日志）+ 联网 URL
  const projectHits: AIRunResult['projectHits'] = []
  const citations: AIRunResult['citations'] = []
  const searchedUrls = sessionLog.searchedUrls()
  for (const entry of sessionLog.entries) {
    if (entry.type === 'tool_call' && entry.name === 'search_projects') {
      const kws = (entry.args as { keywords?: string[] })?.keywords || []
      if (kws.length > 0) {
        // 重新查询拿到命中清单（幂等 SQL，成本低）
        const { searchProjectsInternal } = await import('@/lib/dd-harness/projects-tool')
        const hits = await searchProjectsInternal(kws, 5)
        for (const h of hits) {
          if (!projectHits.some(p => p.projectId === h.projectId)) {
            projectHits.push({ projectId: h.projectId, projectName: h.projectName, followStage: h.followStage })
          }
        }
      }
    }
  }
  // 联网引用：正文中的真实搜索 URL（简单提取 http 链接并过滤在会话日志内的）
  const urlMatches = content.match(/https?:\/\/[^\s)）】\]]+/g) || []
  for (const url of urlMatches) {
    if (searchedUrls.includes(url) && !citations.some(c => c.url === url)) {
      citations.push({ label: url.replace(/^https?:\/\//, '').split('/')[0], url })
    }
  }

  // 5. 异步记忆提取（不阻塞回答返回）
  void extractAndSaveMemories(userMessage, content, opts.sessionId)
    .then(n => { if (n > 0) console.log(`[AIResearch] 记忆提取入库 ${n} 条`) })
    .catch(() => { /* 静默 */ })

  return { content, projectHits, citations }
}
