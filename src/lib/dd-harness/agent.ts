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

/** JSON 修复：处理 DeepSeek 返回的常见格式问题 */
export function repairJson(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
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

/** 解析 Agent 最终输出为 JSON（容错） */
export function parseAgentJson<T>(content: string): T | null {
  try {
    const repaired = repairJson(content)
    const jsonMatch = repaired.match(/\{[\s\S]*\}/)
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as T
  } catch {
    // 忽略，返回 null
  }
  return null
}
