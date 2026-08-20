/**
 * 尽调 Harness 工具注册表（一切皆插件）
 *
 * web_search 工具实现：双源搜索（Tavily + DeepSeek 官方 web_search）
 * - 并行双源 → 比较信息完整度 → 合并去重 → DeepSeek 归纳总结
 * - 只有一边可用时（如 Tavily 配额耗尽）自动降级为单一来源
 * - 返回给子Agent 的内容为归纳后的清洁结果，URL 均来自真实搜索
 */

import { searchWebDual } from '@/lib/tavily-search'
import type { HarnessTool, SessionLog } from './types'

/** web_search 工具：子Agent 联网检索补充资料 */
export const webSearchTool: HarnessTool = {
  definition: {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        '联网搜索公开资料（融资新闻、竞品信息、团队背景、行业数据等）。每次分析最多调用 4 次，优先搜索最关键的信息缺口。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词（中文，可含公司名/人名/行业词）' },
          max_results: { type: 'integer', description: '返回结果数，默认 5，最大 8' },
        },
        required: ['query'],
      },
    },
  },

  async execute(args, sessionLog: SessionLog) {
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) return '错误：query 不能为空'
    const maxResults = Math.min(Math.max(Number(args.max_results) || 5, 1), 8)

    // 双源搜索：Tavily + DeepSeek web_search 比较 + 归纳
    const results = await searchWebDual(query, { maxResults })
    const urls = results.map(r => r.url)
    // 记录真实返回的 URL（tool_call 由 Harness 层记录；此处记录结果供引用交叉验证）
    sessionLog.append({ type: 'tool_result', name: 'web_search', urls })

    if (results.length === 0) {
      return `未找到与「${query}」相关的搜索结果`
    }
    return results
      .map((r, i) => `[${i + 1}] ${r.title}\n来源: ${r.url}\n内容: ${r.content.substring(0, 400)}`)
      .join('\n\n')
  },
}

/** 尽调子Agent可用工具集（可插拔扩展） */
export function ddTools(): HarnessTool[] {
  return [webSearchTool]
}
