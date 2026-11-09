/**
 * 尽调工作台统一 LLM JSON 调用（带 token 记账）
 */

import { DEEPSEEK_MODEL } from '@/lib/deepseek-model'
import { parseAgentJson } from '@/lib/dd-harness/agent'
import { recordTokenUsage, type TokenModule } from '@/lib/token-accounting'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

export interface DeepSeekJsonOptions {
  system: string
  user: string
  module: TokenModule
  maxTokens?: number
  timeoutMs?: number
  temperature?: number
}

export async function callDeepSeekJson<T>(options: DeepSeekJsonOptions): Promise<T | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DeepSeek API Key 未配置')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000)
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content: options.user },
        ],
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 4000,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`DeepSeek 调用失败: ${response.status} ${errText.slice(0, 200)}`)
    }

    const data = (await response.json()) as {
      usage?: unknown
      choices?: Array<{ message?: { content?: string } }>
    }
    recordTokenUsage(options.module, data.usage as Parameters<typeof recordTokenUsage>[1])
    return parseAgentJson<T>(data.choices?.[0]?.message?.content || '')
  } finally {
    clearTimeout(timeoutId)
  }
}
