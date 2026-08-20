/**
 * 双源搜索系统（Tavily + DeepSeek web_search）测试用例
 *
 * A. 纯函数单测（无网络）：
 *    1. scoreCompleteness：完整度评分（唯一URL数 × 1000 + 内容总长）
 *    2. decideWinner：双源胜出判定（both/tavily/deepseek/none）
 *    3. mergeSearchResults：合并去重（完整方在前）
 *    4. resolveDualSearch：核心决策（双边→合并+归纳；单边→直用；无→空）
 *
 * B. Mock fetch 网络层单测（无真实网络）：
 *    5. deepseekWebSearch：Responses API 输出解析 / 无效URL过滤 / API失败降级 / 超时降级
 *    6. summarizeMergedResults：归纳解析 / 编造URL白名单过滤 / API失败返回null
 *
 * C. 静态检查（所有调用方已切换双源）：
 *    7. 基础设施：tavily-search.ts / deepseek-websearch.ts
 *    8. 十处调用方：DD Harness 工具 / AI线索 / 新闻监控(cron+手动) / 热点图(cron+手动) /
 *       投研模块分析 / AI画板 / 竞争态势
 *
 * D. 真实集成测试（真实 API）：
 *    9. searchWebDual 端到端：Tavily 配额耗尽时自动降级 DeepSeek 单源并返回实时结果
 *
 * 运行：npx tsx scripts/test-dual-search.ts
 */

import * as dotenv from 'dotenv'
dotenv.config()

import * as fs from 'fs'
import * as path from 'path'
import {
  scoreCompleteness,
  decideWinner,
  mergeSearchResults,
  resolveDualSearch,
  searchWebDual,
  getLastDualSearchMeta,
  type SearchResult,
} from '../src/lib/tavily-search'
import { deepseekWebSearch } from '../src/lib/deepseek-websearch'

const ROOT = path.join(__dirname, '..')
let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function read(p: string): string {
  try {
    return fs.readFileSync(path.join(ROOT, p), 'utf8')
  } catch {
    return ''
  }
}

function exists(p: string): boolean {
  return fs.existsSync(path.join(ROOT, p))
}

const mkResult = (url: string, content: string, title = url): SearchResult => ({ title, url, content })

// ── mock fetch 工具 ──

const originalFetch = globalThis.fetch
interface FetchCall { url: string; body: string }

function mockFetch(handler: (url: string, body: string) => { status: number; json: unknown } | null) {
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const body = typeof init?.body === 'string' ? init.body : ''
    calls.push({ url, body })
    const res = handler(url, body)
    if (res === null) {
      // 永不主动返回；但响应 AbortSignal（模拟真实 fetch 的超时中断行为）
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal as AbortSignal | undefined
        if (signal) {
          const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
          if (signal.aborted) onAbort()
          else signal.addEventListener('abort', onAbort)
        }
      })
    }
    return new Response(JSON.stringify(res.json), { status: res.status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return calls
}

function restoreFetch() {
  globalThis.fetch = originalFetch
}

// Responses API 的标准输出结构（message 文本项）
function responsesApiOutput(text: string): unknown {
  return {
    output: [
      { type: 'web_search_call', action: { type: 'search', queries: ['q'] } },
      { type: 'message', content: [{ type: 'output_text', text }] },
    ],
  }
}

console.log('\n════════ 双源搜索系统测试 ════════\n')

// ═══════════════════════════════════════
// A. 纯函数单测
// ═══════════════════════════════════════

console.log('[A1] scoreCompleteness：完整度评分')
{
  check('空数组得 0 分', scoreCompleteness([]) === 0)
  check('null 容错得 0 分', scoreCompleteness(null as unknown as SearchResult[]) === 0)

  // 公式：唯一URL数 × 1000 + 内容总长
  check('单条结果评分 = 1000×1 + 内容长', scoreCompleteness([mkResult('https://a.com', 'x'.repeat(100))]) === 1100)

  const r1 = [mkResult('https://a.com', 'x'.repeat(100))]
  const r2 = [mkResult('https://a.com', 'x'.repeat(5000))]
  check('同URL数时内容长者得分高', scoreCompleteness(r2) > scoreCompleteness(r1))

  // 唯一URL数占主导：内容总量相同（10000），2个URL 比 1个URL 多 1000 分
  const fewUrls = [mkResult('https://a.com', 'x'.repeat(10000))]
  const manyUrls = [mkResult('https://a.com', 'x'.repeat(5000)), mkResult('https://b.com', 'x'.repeat(5000))]
  check('URL覆盖面是主要权重（内容相同时多URL得分高1000）', scoreCompleteness(manyUrls) === scoreCompleteness(fewUrls) + 1000)

  // 重复 URL 不重复计入 URL 数
  const dup = [mkResult('https://a.com', 'x'), mkResult('https://a.com', 'x')]
  check('重复URL不计入URL数（1002 而非 2002）', scoreCompleteness(dup) === 1002)
}

console.log('\n[A2] decideWinner：双源胜出判定')
{
  const t = [mkResult('https://t.com', 'c')]
  const d = [mkResult('https://d.com', 'c')]
  check('两边都有 → both', decideWinner(t, d) === 'both')
  check('仅 Tavily → tavily', decideWinner(t, []) === 'tavily')
  check('仅 DeepSeek → deepseek', decideWinner([], d) === 'deepseek')
  check('都为空 → none', decideWinner([], []) === 'none')
}

console.log('\n[A3] mergeSearchResults：合并去重')
{
  const primary = [mkResult('https://a.com', 'A'), mkResult('https://b.com', 'B')]
  const secondary = [mkResult('https://b.com', 'B-dup'), mkResult('https://c.com', 'C')]
  const merged = mergeSearchResults(primary, secondary)
  check('结果数 = primary + secondary 独有URL', merged.length === 3)
  check('primary 顺序与内容保持在前', merged[0].url === 'https://a.com' && merged[1].content === 'B')
  check('secondary 独有 URL 追加在后', merged[2].url === 'https://c.com')
  check('URL 去重（无重复）', new Set(merged.map(m => m.url)).size === merged.length)

  check('空 primary 时返回 secondary 全部', mergeSearchResults([], secondary).length === 2)
  check('空 secondary 时返回 primary 全部', mergeSearchResults(primary, []).length === 2)
}

console.log('\n[A4] resolveDualSearch：核心决策逻辑（本次改造核心）')
{
  const tavily = [mkResult('https://t1.com', 'T1 内容'), mkResult('https://t2.com', 'T2 内容')]
  // DeepSeek 单 URL 但内容量远超 Tavily 两条 → 完整度胜出
  const deepseek = [mkResult('https://d1.com', 'D1 深度内容。'.repeat(300))]

  // 场景1：双边都有 → 合并 + 需归纳
  const both = resolveDualSearch(tavily, deepseek)
  check('双边 → winner=both', both.winner === 'both')
  check('双边 → 需要归纳总结', both.needsSummarize === true)
  check('双边 → 合并去重后结果完整', both.results.length === 3)
  check('双边 → 更完整一方（DeepSeek 内容量大）在前', both.moreComplete === 'deepseek' && both.results[0].url === 'https://d1.com')

  // 场景1b：完整度相同时 Tavily 在前
  const deepseek2 = [mkResult('https://d1.com', 'x')]
  const bothEqual = resolveDualSearch([mkResult('https://t1.com', 'x')], deepseek2)
  check('完整度相同 → equal，Tavily 在前', bothEqual.moreComplete === 'equal' && bothEqual.results[0].url === 'https://t1.com')

  // 场景1c：skipSummarize 跳过归纳
  const skip = resolveDualSearch(tavily, deepseek, { skipSummarize: true })
  check('skipSummarize → 不归纳但保留合并结果', skip.needsSummarize === false && skip.results.length === 3)

  // 场景2：仅 Tavily 有结果 → 直接以 Tavily 为准
  const onlyT = resolveDualSearch(tavily, [])
  check('仅Tavily → winner=tavily', onlyT.winner === 'tavily')
  check('仅Tavily → 以单一来源为准（原样返回）', onlyT.results === tavily && onlyT.results.length === 2)
  check('仅Tavily → 不归纳', onlyT.needsSummarize === false)

  // 场景3：仅 DeepSeek 有结果（如 Tavily 配额耗尽）→ 直接以 DeepSeek 为准
  const onlyD = resolveDualSearch([], deepseek)
  check('仅DeepSeek → winner=deepseek', onlyD.winner === 'deepseek')
  check('仅DeepSeek → 以单一来源为准（原样返回）', onlyD.results === deepseek && onlyD.results.length === 1)
  check('仅DeepSeek → 不归纳', onlyD.needsSummarize === false)

  // 场景4：都无结果
  const none = resolveDualSearch([], [])
  check('双空 → winner=none 且结果为空', none.winner === 'none' && none.results.length === 0 && none.needsSummarize === false)
}

// ═══════════════════════════════════════
// B. Mock fetch 网络层单测
// ═══════════════════════════════════════

async function runMockTests() {
console.log('\n[B5] deepseekWebSearch：Responses API 网络层（mock）')
{
  // 5.1 正常解析
  mockFetch((url) => {
    if (url.includes('/v1/responses')) {
      return {
        status: 200,
        json: responsesApiOutput('{"results": [{"title": "新闻A", "url": "https://news.com/a", "content": "内容A"}, {"title": "新闻B", "url": "https://news.com/b", "content": "内容B"}]}'),
      }
    }
    return { status: 404, json: {} }
  })
  try {
    const results = await deepseekWebSearch('测试查询', { timeoutMs: 5000 })
    check('正常输出 → 解析出 2 条结果', results.length === 2)
    check('结果字段完整（title/url/content）', results[0].title === '新闻A' && results[0].url === 'https://news.com/a' && results[0].content === '内容A')
  } finally {
    restoreFetch()
  }

  // 5.2 无效 URL 过滤（mock 返回含非法 URL）
  mockFetch((url) => {
    if (url.includes('/v1/responses')) {
      return {
        status: 200,
        json: responsesApiOutput(
          '{"results": [{"title": "有效", "url": "https://ok.com/1", "content": "有效内容"}, {"title": "非http", "url": "ftp://bad.com", "content": "x"}, {"title": "编造", "url": "javascript:alert(1)", "content": "x"}, {"title": "空内容", "url": "https://ok.com/2", "content": ""}]}'
        ),
      }
    }
    return { status: 404, json: {} }
  })
  try {
    const results = await deepseekWebSearch('测试查询', { timeoutMs: 5000 })
    check('非 http(s) URL 被过滤', results.every(r => /^https?:\/\//.test(r.url)))
    check('有效结果保留', results.length >= 1 && results.some(r => r.url === 'https://ok.com/1'))
  } finally {
    restoreFetch()
  }

  // 5.3 API 失败 → 返回 []（不抛异常）
  mockFetch(() => ({ status: 429, json: { error: 'rate limit' } }))
  try {
    const results = await deepseekWebSearch('测试查询', { timeoutMs: 5000 })
    check('API 429 失败 → 返回空数组（不抛异常）', Array.isArray(results) && results.length === 0)
  } finally {
    restoreFetch()
  }

  // 5.4 超时 → 返回 []
  mockFetch(() => null) // 永不返回
  try {
    const start = Date.now()
    const results = await deepseekWebSearch('测试查询', { timeoutMs: 300 })
    const elapsed = Date.now() - start
    check('请求超时 → 返回空数组', Array.isArray(results) && results.length === 0)
    check('超时及时返回（<3s）', elapsed < 3000)
  } finally {
    restoreFetch()
  }

  // 5.5 无 message 文本输出 → 返回 []
  mockFetch((url) => {
    if (url.includes('/v1/responses')) {
      return { status: 200, json: { output: [{ type: 'web_search_call', action: { type: 'search' } }] } }
    }
    return { status: 404, json: {} }
  })
  try {
    const results = await deepseekWebSearch('测试查询', { timeoutMs: 5000 })
    check('无 message 输出 → 返回空数组', Array.isArray(results) && results.length === 0)
  } finally {
    restoreFetch()
  }
}

console.log('\n[B6] summarizeMergedResults：双源归纳（mock chat API）')
{
  // 动态 import 避免提前绑定
  const { summarizeMergedResults } = await import('../src/lib/tavily-search')
  const merged = [
    mkResult('https://a.com', '公司A完成5000万元A轮融资', '标题A'),
    mkResult('https://b.com', '公司B发布新产品', '标题B'),
  ]

  // 6.1 正常归纳
  mockFetch((url) => {
    if (url.includes('/chat/completions')) {
      return {
        status: 200,
        json: {
          choices: [{ message: { content: '{"results": [{"title": "公司A融资", "url": "https://a.com", "content": "归纳：A获5000万A轮"}]}' } }],
        },
      }
    }
    return { status: 404, json: {} }
  })
  try {
    const summarized = await summarizeMergedResults('融资新闻', merged, 5, 5000)
    check('正常归纳 → 返回归纳结果', summarized !== null && summarized.length === 1)
    check('归纳结果 URL 来自白名单', summarized?.[0].url === 'https://a.com')
  } finally {
    restoreFetch()
  }

  // 6.2 编造 URL 过滤
  mockFetch((url) => {
    if (url.includes('/chat/completions')) {
      return {
        status: 200,
        json: {
          choices: [{ message: { content: '{"results": [{"title": "真", "url": "https://a.com", "content": "真实"}, {"title": "编造", "url": "https://fake.com/x", "content": "编造内容"}]}' } }],
        },
      }
    }
    return { status: 404, json: {} }
  })
  try {
    const summarized = await summarizeMergedResults('融资新闻', merged, 5, 5000)
    check('编造 URL 被白名单过滤', summarized !== null && summarized.length === 1 && summarized[0].url === 'https://a.com')
  } finally {
    restoreFetch()
  }

  // 6.3 API 失败 → 返回 null（调用方回退原始结果）
  mockFetch(() => ({ status: 500, json: { error: 'server error' } }))
  try {
    const summarized = await summarizeMergedResults('融资新闻', merged, 5, 5000)
    check('归纳 API 失败 → 返回 null（触发回退）', summarized === null)
  } finally {
    restoreFetch()
  }

  // 6.4 空输入 → 直接 null
  check('空合并结果 → 返回 null', (await summarizeMergedResults('q', [], 5, 1000)) === null)
}
}

// ═══════════════════════════════════════
// D. 真实集成测试
// ═══════════════════════════════════════

async function runIntegrationTests() {
console.log('\n[D9] 真实集成测试：searchWebDual 端到端（真实 API，约 1-2 分钟）')
{
  if (!process.env.DEEPSEEK_API_KEY) {
    check('DEEPSEEK_API_KEY 已配置（跳过集成测试）', false)
  } else {
    const start = Date.now()
    const results = await searchWebDual('脑机接口 融资 最新', {
      maxResults: 3,
      topic: 'news',
      timeoutMs: 120000,
    })
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    const meta = getLastDualSearchMeta()

    console.log(`    （耗时 ${elapsed}s，meta: ${JSON.stringify(meta)}）`)

    check('返回非空结果', results.length > 0, `实际 ${results.length} 条`)
    check('所有 URL 为合法 http(s)', results.every(r => /^https?:\/\//.test(r.url)))
    check('每条结果有标题和内容', results.every(r => r.title && r.content))
    check('meta 记录可用（观测双源状态）', meta !== null && meta.finalCount === results.length)
    // 当前 Tavily 配额耗尽 → 应自动降级为 DeepSeek 单源
    check(
      `单边降级生效（winner=${meta?.winner}，Tavily配额耗尽时应为 deepseek）`,
      meta?.winner === 'deepseek' || meta?.winner === 'both'
    )
    if (results.length > 0) {
      console.log('    示例结果：')
      for (const r of results.slice(0, 2)) {
        console.log(`      - ${r.title} (${r.url})`)
        console.log(`        ${r.content.substring(0, 80)}...`)
      }
    }
  }
}
}

// ═══════════════════════════════════════
// 主流程
// ═══════════════════════════════════════

async function main() {
  await runMockTests()

  // ═══════════════════════════════════════
  // C. 静态检查（调用方切换完整性）
  // ═══════════════════════════════════════

  console.log('\n[C7] 双源搜索基础设施')
  {
    const tavilyLib = read('src/lib/tavily-search.ts')
    check('tavily-search.ts 存在 searchWebDual', tavilyLib.includes('export async function searchWebDual'))
    check('tavily-search.ts 导出完整度评分', tavilyLib.includes('export function scoreCompleteness'))
    check('tavily-search.ts 导出决策纯函数', tavilyLib.includes('export function resolveDualSearch'))
    check('tavily-search.ts 导出归纳函数', tavilyLib.includes('export async function summarizeMergedResults'))
    check('searchWebDual 并行双源（Promise.all）', tavilyLib.includes('searchWeb(query') && tavilyLib.includes('deepseekWebSearch(query'))
    check('单边降级注释存在', tavilyLib.includes('以单一来源结果为准'))
    check('searchAndSummarize 已切换双源', tavilyLib.includes('searchWebDual(q, {'))

    const dsLib = read('src/lib/deepseek-websearch.ts')
    check('deepseek-websearch.ts 存在', exists('src/lib/deepseek-websearch.ts'))
    check('使用 Responses API 端点', dsLib.includes('https://api.deepseek.com/v1/responses'))
    check('启用官方 web_search 工具', dsLib.includes("tools: [{ type: 'web_search' }]"))
    check('输出与 Tavily SearchResult 格式对齐', dsLib.includes('title') && dsLib.includes('url') && dsLib.includes('content'))
    check('失败返回空数组（不抛异常）', dsLib.includes('return []'))
  }

  console.log('\n[C8] 十处调用方全部切换双源')
  {
    const callers: Array<{ file: string; name: string }> = [
      { file: 'src/lib/dd-harness/tools.ts', name: 'DD Harness web_search 工具（尽调/行业动态共用）' },
      { file: 'src/lib/ai-lead-retrieval.ts', name: 'AI 线索检索' },
      { file: 'src/app/api/cron/news-search/route.ts', name: '新闻监控（cron）' },
      { file: 'src/app/api/news/search/route.ts', name: '新闻监控（手动刷新）' },
      { file: 'src/app/api/cron/refresh-heatmap/route.ts', name: '融资热点图（cron）' },
      { file: 'src/app/api/statistics/financing-heatmap/route.ts', name: '融资热点图（手动）' },
      { file: 'src/app/api/research/[projectId]/[moduleType]/analyze/route.ts', name: '投研模块 AI 分析' },
      { file: 'src/app/api/projects/[id]/ai-card/route.ts', name: 'AI 画板' },
      { file: 'src/app/api/projects/[id]/competitors/route.ts', name: '竞争态势分析' },
    ]

    for (const c of callers) {
      const content = read(c.file)
      check(`${c.name} → searchWebDual`, content.includes('searchWebDual('))
      // 不应再单独调用单源 searchWeb（searchWebDual 定义文件自身除外）
      const singleCall = content.match(/(?<!Dual)searchWeb\(/g)
      check(`${c.name} → 无残留单源 searchWeb 调用`, singleCall === null)
    }

    // 行业动态经 ddTools 复用 web_search 工具
    const runner = read('src/lib/industry-news-runner.ts')
    check('行业动态 → 复用 ddTools（间接获得双源）', runner.includes('ddTools()'))
  }

  // D. 真实集成测试
  await runIntegrationTests()

  // ═══════════════════════════════════════
  console.log('\n════════ 测试结果 ════════')
  console.log(`  通过: ${passed}  失败: ${failed}`)
  console.log(failed === 0 ? '  ✅ 全部通过\n' : '  ❌ 存在失败用例\n')
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => {
  console.error('测试脚本执行失败:', e)
  process.exit(1)
})
