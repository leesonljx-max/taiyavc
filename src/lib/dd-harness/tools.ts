/**
 * 尽调 Harness 工具注册表（一切皆插件）
 *
 * web_search 工具当前实现：Tavily Search
 * （接口不变，后续可无缝替换为 DeepSeek Harness 的 web_search 或其他搜索源）
 */

import { searchWeb } from '@/lib/tavily-search'
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

    const results = await searchWeb(query, { maxResults })
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
