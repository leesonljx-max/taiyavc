/**
 * AI 分层记忆库（Mem0 式简化实现）
 *
 * 分层：
 * - 工作记忆：最近 2 轮对话原文（调用方传入，不落记忆表）
 * - 情景记忆（EPISODE）：每轮对话一句摘要，scope=session:<id>，回溯"聊过什么"
 * - 语义记忆（FACT）：全局共享的结构化事实（金额/日期/结论/偏好），同主体同字段新覆盖旧
 *
 * 成本控制：
 * - 召回：关键词 SQL 匹配 + 重要度排序（零 token）
 * - 提取：每轮一次轻量 LLM 调用（max_tokens 500，异步不阻塞回答）
 * - 冲突：同 subject+field 新事实覆盖旧事实（旧记录标记 superseded）
 */

import prisma from '@/lib/prisma'
import { runSingleCall, parseAgentJson } from '@/lib/dd-harness/agent'
import { recordTokenUsage } from '@/lib/token-accounting'

// ── 类型 ──

/** LLM 提取的记忆结构 */
export interface ExtractedMemory {
  type: 'FACT' | 'EPISODE'
  subject?: string
  field?: string
  content: string
  keywords?: string[]
  importance?: number
}

/** 召回的记忆条目 */
export interface RecalledMemory {
  id: string
  type: string
  subject: string | null
  field: string | null
  content: string
  importance: number
}

// ── 中文分词（轻量，召回用） ──

/** 停用词表（召回时过滤） */
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '什么', '这个', '那个', '怎么', '如何', '吗', '呢', '吧', '啊', '请', '帮',
  '分析', '一下', '可以', '现在', '还是', '以及', '对于', '关于', '还是',
])

/**
 * 从文本提取关键词（召回查询用）：
 * 中文按 2-4 字滑窗取词组 + 英文单词，过滤停用词与纯数字
 */
export function extractQueryKeywords(text: string): string[] {
  if (!text) return []
  const words = new Set<string>()

  // 英文单词（≥3 字母）
  const enMatches = text.match(/[a-zA-Z][a-zA-Z0-9-]{2,}/g) || []
  for (const w of enMatches) words.add(w.toLowerCase())

  // 中文 2-4 字组合（滑窗）
  const cnChunks = text.match(/[\u4e00-\u9fa5]+/g) || []
  for (const chunk of cnChunks) {
    for (let len = 2; len <= 4; len++) {
      for (let i = 0; i + len <= chunk.length; i++) {
        const w = chunk.substring(i, i + len)
        if (!STOP_WORDS.has(w)) words.add(w)
      }
    }
    // 单字也保留（公司名如"光枢"会命中）
    if (chunk.length <= 4) {
      for (const ch of chunk) {
        if (!STOP_WORDS.has(ch)) words.add(ch)
      }
    }
  }

  return Array.from(words).slice(0, 40)
}

// ── 召回（零 token） ──

/**
 * 召回相关记忆：
 * 1. 全局 FACT（未被覆盖）按关键词匹配 + 重要度排序，取 top-N
 * 2. 当前会话 EPISODE（最近 K 条，时序）
 */
export async function recallMemories(
  query: string,
  sessionId: string,
  limit = 5
): Promise<RecalledMemory[]> {
  const keywords = extractQueryKeywords(query)
  if (keywords.length === 0) {
    return recallSessionEpisodes(sessionId, 3)
  }

  // LIKE 匹配任一关键词（keywords 建了索引但 LIKE 走不了索引，量小无碍）
  const conditions = keywords.map(k => ({
    keywords: { contains: k },
  }))

  const facts = await prisma.aIMemory.findMany({
    where: {
      type: 'FACT',
      superseded: false,
      OR: conditions,
    },
    orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
    take: limit,
  })

  const episodes = await recallSessionEpisodes(sessionId, 3)

  // FACT 在前（重要），EPISODE 在后（时序上下文）
  const factList: RecalledMemory[] = facts.map(f => ({
    id: f.id,
    type: f.type,
    subject: f.subject,
    field: f.field,
    content: f.content,
    importance: f.importance,
  }))
  const episodeList: RecalledMemory[] = episodes.map(f => ({
    id: f.id,
    type: f.type,
    subject: f.subject,
    field: f.field,
    content: f.content,
    importance: f.importance,
  }))

  return [...factList, ...episodeList]
}

/** 会话情景记忆（最近 K 条，按时间正序） */
async function recallSessionEpisodes(sessionId: string, k: number): Promise<RecalledMemory[]> {
  const episodes = await prisma.aIMemory.findMany({
    where: { type: 'EPISODE', scope: `session:${sessionId}` },
    orderBy: { createdAt: 'desc' },
    take: k,
  })
  return episodes
    .reverse()
    .map(f => ({
      id: f.id,
      type: f.type,
      subject: f.subject,
      field: f.field,
      content: f.content,
      importance: f.importance,
    }))
}

// ── 提取（轻量 LLM） ──

/**
 * 从一轮对话中提取记忆（异步调用，失败静默）
 * - FACT：全局重要的投资事实（融资事件/估值/时间窗口判断/团队偏好）
 * - EPISODE：本轮对话一句摘要（scope=会话）
 *
 * @returns 提取入库的条数（调用方仅记录日志）
 */
export async function extractAndSaveMemories(
  userMessage: string,
  assistantMessage: string,
  sessionId: string
): Promise<number> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return 0

  const systemPrompt = `你是一个记忆提取器，服务一级市场投资研究ChatBot。从一段对话中提取值得长期记忆的信息。

提取规则：
1. FACT（全局事实）：融资事件（轮次/金额/投资方）、估值、关键时间点、行业时间窗口判断、用户的投资偏好。必须有明确主体（公司名/行业名/用户）
2. EPISODE（对话摘要）：本轮对话的一句话概括（≤50字）

注意：
- 只提取信息量高的内容，闲聊/客套不提取
- 事实与已有常识（如"OpenAI是AI公司"）不提取
- FACT 的 field 从这些里选：fundingRound/fundingAmount/valuation/investors/timeWindow/competition/team/preference/other
- importance：融资事件=5，估值/时间窗口=4，偏好=3，其他=2；EPISODE 固定=1
- keywords：3-6 个召回关键词（公司名/行业词/核心名词）

严格输出 JSON（无其他文字）：
{"memories": [{"type": "FACT", "subject": "主体", "field": "fundingRound", "content": "一句话（≤100字）", "keywords": ["词1","词2"], "importance": 5}]}`

  const userPrompt = `【用户提问】\n${userMessage.substring(0, 2000)}\n\n【AI回答】\n${assistantMessage.substring(0, 3000)}\n\n请提取记忆并输出 JSON。`

  try {
    const content = await runSingleCall(systemPrompt, userPrompt, 30000)
    // token 记账（记忆提取归属 AI行研 模块）
    // 注：runSingleCall 不返回 usage，此处按内容长度估算记账（1中文字≈1.5 token）
    recordTokenUsage('ai-research', {
      prompt_tokens: Math.ceil(systemPrompt.length * 0.6 + userPrompt.length * 1.5),
      completion_tokens: Math.ceil(content.length * 1.5),
    })

    const parsed = parseAgentJson<{ memories?: ExtractedMemory[] }>(content)
    if (!parsed?.memories || !Array.isArray(parsed.memories)) return 0

    let saved = 0
    for (const m of parsed.memories) {
      const ok = await saveMemory(m, sessionId)
      if (ok) saved++
    }
    return saved
  } catch (error) {
    console.warn('[AIMemory] 提取失败（不影响对话）:', error instanceof Error ? error.message : error)
    return 0
  }
}

/** 单条记忆入库（含冲突覆盖） */
export async function saveMemory(m: ExtractedMemory, sessionId: string): Promise<boolean> {
  const content = typeof m.content === 'string' ? m.content.trim() : ''
  if (!content || content.length > 200) return false

  const type = m.type === 'EPISODE' ? 'EPISODE' : 'FACT'
  const importance = Math.min(Math.max(Number(m.importance) || 2, 1), 5)
  const keywords = Array.isArray(m.keywords)
    ? m.keywords.filter(k => typeof k === 'string' && k.trim()).slice(0, 8).join(' ')
    : ''

  if (type === 'EPISODE') {
    await prisma.aIMemory.create({
      data: {
        type: 'EPISODE',
        scope: `session:${sessionId}`,
        content: content.substring(0, 200),
        keywords,
        importance: 1,
        sourceSessionId: sessionId,
      },
    })
    return true
  }

  // FACT：同 subject+field 冲突覆盖
  const subject = (m.subject || '').trim()
  const field = (m.field || 'other').trim()
  if (!subject) return false

  await prisma.aIMemory.updateMany({
    where: { type: 'FACT', subject, field, superseded: false },
    data: { superseded: true },
  })

  await prisma.aIMemory.create({
    data: {
      type: 'FACT',
      scope: 'global',
      subject,
      field,
      content: content.substring(0, 200),
      keywords: keywords || subject,
      importance,
      sourceSessionId: sessionId,
    },
  })
  return true
}

// ── 记忆注入格式化 ──

/** 将召回的记忆格式化为 prompt 片段 */
export function formatMemoriesForPrompt(memories: RecalledMemory[]): string {
  if (memories.length === 0) return '（暂无相关历史记忆）'

  const facts = memories.filter(m => m.type === 'FACT')
  const episodes = memories.filter(m => m.type === 'EPISODE')

  const parts: string[] = []
  if (facts.length > 0) {
    parts.push('【已知事实记忆（来自此前研究，供参考，如与最新检索冲突以检索为准）】')
    for (const f of facts) {
      parts.push(`- ${f.subject ? `[${f.subject}] ` : ''}${f.content}`)
    }
  }
  if (episodes.length > 0) {
    parts.push('【本轮会话上下文】')
    for (const e of episodes) {
      parts.push(`- ${e.content}`)
    }
  }
  return parts.join('\n')
}
