/**
 * 尽调 Harness Agent 循环
 *
 * Agent = Model + Harness：
 * - Model（DeepSeek V4-Flash）思考并决定调用哪个工具
 * - Harness（本模块）执行工具 → 回填结果 → 循环，直到产出最终结论
 *
 * 会话日志（SessionLog）记录每一次工具调用与结果，
 * 支撑"结论带资料索引、可点击溯源"（引用交叉验证见 framework.filterCitations）
 */

import type { AgentMessage, AgentResult, HarnessTool, SessionLog } from './types'
import { SessionLog as SessionLogClass } from './types'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

/** JSON 基础清洗：移除思考标签、代码块围栏、尾逗号（保留引号原样） */
export function stripJsonNoise(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .trim()
}

/** JSON 修复（兜底用）：在基础清洗之上，将中文弯引号替换为英文引号 */
export function repairJson(text: string): string {
  return stripJsonNoise(text)
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
}

/**
 * 提取第一个大括号平衡的 JSON 对象块（容忍 JSON 前后的说明文字）
 * 扫描时跳过字符串内部（不计数），未找到平衡块返回 null
 */
export function extractJsonBlock(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { if (inString) escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.substring(start, i + 1)
    }
  }
  return null
}

/**
 * 修复字符串值内部未转义的英文双引号（启发式）：
 * 引号后（跳过空白）若紧跟结构字符（: , } ]）视为字符串闭合，否则视为内容引号并转义
 */
export function escapeInnerQuotes(text: string): string {
  let result = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\' && inString) {
      result += ch + (text[i + 1] ?? '')
      i++
      continue
    }
    if (ch === '"') {
      if (!inString) {
        inString = true
        result += ch
        continue
      }
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      const next = text[j]
      if (next === ':' || next === ',' || next === '}' || next === ']') {
        inString = false
        result += ch
      } else {
        result += '\\"'
      }
      continue
    }
    result += ch
  }
  return result
}

export interface RunAgentOptions {
  systemPrompt: string
  userPrompt: string
  tools: HarnessTool[]
  /** 最大轮次（每轮可含多次工具调用），默认 4 */
  maxTurns?: number
  /** 单次模型调用超时（ms），默认 60s */
  timeoutMs?: number
  temperature?: number
}

/**
 * 运行单个 Agent：循环调用 DeepSeek + 执行工具，返回最终文本与会话日志
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const sessionLog = new SessionLogClass()
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DeepSeek API Key 未配置')

  const maxTurns = opts.maxTurns ?? 4
  const messages: AgentMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    { role: 'user', content: opts.userPrompt },
  ]

  for (let turn = 0; turn < maxTurns; turn++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60000)

    let response: Response
    try {
      response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages,
          tools: opts.tools.map(t => t.definition),
          tool_choice: 'auto',
          thinking: { type: 'disabled' },
          temperature: opts.temperature ?? 0.3,
          max_tokens: 4000,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`DeepSeek API 调用失败: ${response.status} ${errText.substring(0, 200)}`)
    }

    const data = await response.json()
    const message = data.choices?.[0]?.message
    const toolCalls = message?.tool_calls

    // 模型决定调用工具 → 执行并回填，继续循环
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: message?.content ?? null,
        tool_calls: toolCalls,
      })

      for (const tc of toolCalls) {
        const tool = opts.tools.find(t => t.definition.function.name === tc.function.name)
        let resultText: string
        if (!tool) {
          resultText = `错误：工具 ${tc.function.name} 不存在`
          sessionLog.append({ type: 'tool_result', name: tc.function.name, content: resultText })
        } else {
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(tc.function.arguments || '{}')
          } catch {
            args = {}
          }
          // Harness 层记录模型的工具调用（会话日志，溯源用）
          sessionLog.append({ type: 'tool_call', name: tc.function.name, args })
          try {
            resultText = await tool.execute(args, sessionLog)
          } catch (e) {
            resultText = `工具执行失败: ${e instanceof Error ? e.message : String(e)}`
            sessionLog.append({ type: 'tool_result', name: tc.function.name, content: resultText })
          }
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultText.substring(0, 6000),
        })
      }
      continue
    }

    // 无工具调用 → 最终回答
    const content = message?.content || ''
    sessionLog.append({ type: 'assistant', content: content.substring(0, 2000) })
    return { content, sessionLog }
  }

  // 达到最大轮次：追加提示要求直接给结论（兜底一轮）
  messages.push({
    role: 'user',
    content: '已达工具调用上限，请基于已获取的信息直接输出最终 JSON 结论，不要再调用工具。',
  })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60000)
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages,
        thinking: { type: 'disabled' },
        temperature: opts.temperature ?? 0.3,
        max_tokens: 4000,
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`DeepSeek API 调用失败: ${response.status}`)
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    sessionLog.append({ type: 'assistant', content: content.substring(0, 2000) })
    return { content, sessionLog }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 运行单次模型调用（无工具，用于尽调框架生成）
 */
export async function runSingleCall(
  systemPrompt: string,
  userPrompt: string,
  timeoutMs = 60000
): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DeepSeek API Key 未配置')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        thinking: { type: 'disabled' },
        temperature: 0.3,
        max_tokens: 2500,
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`DeepSeek API 调用失败: ${response.status} ${errText.substring(0, 200)}`)
    }
    const data = await response.json()
    return data.choices?.[0]?.message?.content || ''
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 解析 Agent 最终输出为 JSON（多层容错策略）
 *
 * 背景：模型输出可能存在以下问题，需逐层兜底：
 * 1. JSON 前后带说明文字 → 平衡块提取 / 贪婪正则匹配
 * 2. 字符串值内部含中文弯引号（“”）→ 原样保留即可解析（不能盲目替换，否则破坏 JSON）
 * 3. JSON 结构本身用中文弯引号 → 替换为英文引号后解析
 * 4. 字符串值内部含未转义英文双引号 → 启发式转义
 */
export function parseAgentJson<T>(content: string): T | null {
  // 按优先级依次尝试候选文本：基础清洗版（保留中文引号）→ 引号替换版
  for (const text of [stripJsonNoise(content), repairJson(content)]) {
    // 提取候选 JSON 块（优先平衡块提取，回退贪婪正则）
    const block = extractJsonBlock(text) || text.match(/\{[\s\S]*\}/)?.[0]
    if (!block) continue
    // 尝试直接解析（值内含中文引号的合法 JSON 在第一轮即成功）
    try { return JSON.parse(block) as T } catch { /* 继续尝试 */ }
    // 尝试转义值内未转义英文双引号后重试
    try { return JSON.parse(escapeInnerQuotes(block)) as T } catch { /* 继续尝试 */ }
  }
  return null
}
