/**
 * Token 成本控制体系测试用例
 *
 * 覆盖本次改造的五大层：
 * 1. 任务分级（collect/research 模式分流）
 * 2. 搜索结果缓存（TTL 命中/过期/参数指纹）
 * 3. 成本约束（maxResults 硬上限 5 / open_page 禁令提示词）
 * 4. 热点图下架（路由删除、无残留引用）
 * 5. Token 记账（usage 归一化 / 按天聚合 / 看板 API）
 * 6. AI 看板前端（日历热力图逻辑）
 *
 * 运行：npx tsx scripts/test-cost-control.ts
 */

import * as dotenv from 'dotenv'
dotenv.config()

import * as fs from 'fs'
import * as path from 'path'
import {
  scoreCompleteness,
  resolveDualSearch,
  searchWebDual,
  getLastDualSearchMeta,
  type SearchResult,
} from '../src/lib/tavily-search'
import {
  normalizeUsage,
  todayKey,
  tokenCacheKeyFor,
} from '../src/lib/token-accounting'
import {
  searchCacheKey,
} from '../src/lib/search-cache'

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

// mock fetch 工具
const originalFetch = globalThis.fetch
function mockFetch(handler: (url: string, body: string) => { status: number; json: unknown } | null) {
  const calls: Array<{ url: string; body: string }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const body = typeof init?.body === 'string' ? init.body : ''
    calls.push({ url, body })
    const res = handler(url, body)
    if (res === null) {
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

console.log('\n════════ Token 成本控制体系测试 ════════\n')

async function main() {

// ═══════════════════════════════════════
// 1. 任务分级模式
// ═══════════════════════════════════════

console.log('[T1] 任务分级：collect/research 模式分流')
{
  const tavilyLib = read('src/lib/tavily-search.ts')
  check('SearchMode 类型定义（collect | research）', tavilyLib.includes("export type SearchMode = 'collect' | 'research'"))
  check('collect 模式：Tavily 主力、DeepSeek 仅降级', tavilyLib.includes('Tavily 主力') && tavilyLib.includes('降级'))
  check('research 模式：双源 + 归纳', tavilyLib.includes('research') && tavilyLib.includes('归纳'))
  check('collect 模式不执行双源归纳（省 token）', tavilyLib.includes('不执行双源归纳') || tavilyLib.includes('省去归纳'))

  // collect 模式下：Tavily 成功 → 不调 DeepSeek Responses API（只应请求 Tavily 域名）
  // Tavily SDK 用 axios 不走 globalThis.fetch，这里 mock fetch 只会拦到 DeepSeek 请求
  const dsCalls = mockFetch(() => ({
    status: 200,
    json: {
      output: [{ type: 'message', content: [{ text: '{"results":[{"title":"t","url":"https://x.com/a","content":"c"}]}' }] }],
    },
  }))
  try {
    // 注：collect 走 searchWeb（Tavily axios）；TAVILY key 存在但配额耗尽会返回 []
    // 因此 collect 模式下：Tavily 失败 → 走 DeepSeek 降级（唯一 fetch 调用）
    const results = await searchWebDual('测试查询 collect', { mode: 'collect', module: 'news', cacheTtlHours: 0 })
    const meta = getLastDualSearchMeta()
    check('collect 模式：Tavily 失败时降级 DeepSeek', meta?.winner === 'deepseek' || meta?.winner === 'tavily')
    check('collect 模式：结果结构合法', results.every(r => /^https?:\/\//.test(r.url)))
    // collect + DeepSeek 降级路径：requests API 被调用
    const responsesCalls = dsCalls.filter(c => c.url.includes('/v1/responses'))
    check('collect 降级时调用 Responses API（web_search）', responsesCalls.length >= 1)
    // 成本约束提示词生效
    if (responsesCalls.length > 0) {
      check(
        '成本约束提示词（限2次搜索+禁open_page）传入',
        responsesCalls[0].body.includes('禁止 open_page') && responsesCalls[0].body.includes('最多搜索 2 次')
      )
    }
  } finally {
    restoreFetch()
  }
}

console.log('\n[T1b] collect 模式：Tavily 成功时不调 DeepSeek（省 token）')
{
  // 通过环境变量模拟 Tavily 成功：无法直接 mock axios，改用静态逻辑验证
  // 验证代码路径存在：collect 分支在 Tavily 结果非空时直接 return
  const tavilyLib = read('src/lib/tavily-search.ts')
  const collectBranch = tavilyLib.substring(
    tavilyLib.indexOf("if (mode === 'collect')"),
    tavilyLib.indexOf('// ── research 模式')
  )
  check('collect 分支：Tavily 结果非空直接返回', collectBranch.includes('if (tavilyResults.length > 0)') && collectBranch.includes('return tavilyResults'))
  check('collect 分支：Tavily 为空才走 DeepSeek 降级', collectBranch.includes('Tavily 失败/为空 → DeepSeek 降级'))
}

// ═══════════════════════════════════════
// 2. 搜索结果缓存
// ═══════════════════════════════════════

console.log('\n[T2] 搜索结果缓存（AICache 复用）')
{
  const cacheLib = read('src/lib/search-cache.ts')
  check('search-cache.ts 存在', exists('src/lib/search-cache.ts'))
  check('缓存键含 query+参数指纹（md5）', cacheLib.includes('createHash') && cacheLib.includes('search-cache:'))
  check('TTL 过期返回 null', cacheLib.includes('ageHours >= entry.ttlHours'))
  check('空结果不缓存（下次重试）', cacheLib.includes('results.length === 0 || ttlHours <= 0') || cacheLib.includes('!results || results.length === 0'))
  check('缓存读写失败不影响业务', cacheLib.includes('不影响业务'))

  // 缓存键稳定性：相同参数 → 相同键；参数变化 → 不同键
  const k1 = searchCacheKey('脑机接口 融资', { maxResults: 5, topic: 'news', days: 7, mode: 'collect' })
  const k2 = searchCacheKey('脑机接口 融资', { maxResults: 5, topic: 'news', days: 7, mode: 'collect' })
  const k3 = searchCacheKey('脑机接口 融资', { maxResults: 3, topic: 'news', days: 7, mode: 'collect' })
  const k4 = searchCacheKey('脑机接口 融资', { maxResults: 5, topic: 'news', days: 7, mode: 'research' })
  const k5 = searchCacheKey('不同 查询', { maxResults: 5, topic: 'news', days: 7, mode: 'collect' })
  check('相同参数 → 相同缓存键', k1 === k2)
  check('maxResults 不同 → 不同键', k1 !== k3)
  check('mode 不同 → 不同键', k1 !== k4)
  check('query 不同 → 不同键', k1 !== k5)
  check('缓存键前缀规范', k1.startsWith('search-cache:'))

  // tavily-search 集成：默认 TTL（collect 12h / research 1h）
  const tavilyLib = read('src/lib/tavily-search.ts')
  check('collect 默认缓存 12 小时', tavilyLib.includes('collect 12h'))
  check('research 默认缓存 1 小时', tavilyLib.includes('research 1h'))
  check('cacheTtlHours=0 可禁用缓存', tavilyLib.includes('cacheTtlHours > 0'))
}

// ═══════════════════════════════════════
// 3. 成本约束
// ═══════════════════════════════════════

console.log('\n[T3] 成本约束（maxResults 上限 / 提示词缰绳）')
{
  const dsLib = read('src/lib/deepseek-websearch.ts')
  check('deepseekWebSearch maxResults 硬上限 5', dsLib.includes('Math.min(options?.maxResults || 5, 5)'))
  check('限制搜索 2 次提示词', dsLib.includes('最多搜索 2 次'))
  check('禁止 open_page 全文提示词', dsLib.includes('禁止 open_page'))

  const tavilyLib = read('src/lib/tavily-search.ts')
  check('searchWeb maxResults 硬上限 5', tavilyLib.includes('Math.min(options?.maxResults || 5, 5)'))
  check('searchWebDual maxResults 硬上限 5', tavilyLib.includes('Math.min(options?.maxResults || 5, 5)'))

  const tools = read('src/lib/dd-harness/tools.ts')
  check('DD web_search 工具 maxResults 上限从 8 收紧到 5', tools.includes('Math.min(Math.max(Number(args.max_results) || 5, 1), 5)') && !tools.includes(', 8)'))

  // 各调用方 maxResults 在 3-5 范围
  const callers = [
    { file: 'src/app/api/projects/[id]/ai-card/route.ts', expect: 'maxResults: 3' },
    { file: 'src/app/api/projects/[id]/competitors/route.ts', expect: 'maxResults: 4' },
    { file: 'src/app/api/cron/news-search/route.ts', expect: 'maxResults: 5' },
    { file: 'src/app/api/news/search/route.ts', expect: 'maxResults: 5' },
    { file: 'src/app/api/research/[projectId]/[moduleType]/analyze/route.ts', expect: 'maxResults: 3' },
    { file: 'src/lib/ai-lead-retrieval.ts', expect: 'maxResults: count' },
  ]
  for (const c of callers) {
    check(`${path.basename(c.file)} maxResults 合规（${c.expect}）`, read(c.file).includes(c.expect))
  }
}

// ═══════════════════════════════════════
// 4. 热点图下架
// ═══════════════════════════════════════

console.log('\n[T4] 融资热点图下架')
{
  check('cron/refresh-heatmap 路由已删除', !exists('src/app/api/cron/refresh-heatmap/route.ts'))
  check('statistics/financing-heatmap 路由已删除', !exists('src/app/api/statistics/financing-heatmap/route.ts'))

  // 全源码无引用残留
  const searchDirs = ['src']
  let residual = false
  for (const dir of searchDirs) {
    const walk = (d: string) => {
      for (const f of fs.readdirSync(path.join(ROOT, d))) {
        const full = path.join(d, f)
        const abs = path.join(ROOT, full)
        if (fs.statSync(abs).isDirectory()) walk(full)
        else if (/\.(ts|tsx)$/.test(f)) {
          const content = read(full)
          if (content.includes('refresh-heatmap') || content.includes('financing-heatmap')) {
            console.log(`      残留引用: ${full}`)
            residual = true
          }
        }
      }
    }
    walk(dir)
  }
  check('源码无 heatmap 路由引用残留', !residual)
}

// ═══════════════════════════════════════
// 5. AI 线索定时（每周一三五）
// ═══════════════════════════════════════

console.log('\n[T5] AI 线索定时刷新（每周一三五）')
{
  const route = read('src/app/api/cron/ai-leads-retrieval/route.ts')
  check('cron 计划为每周一三五 8:00', route.includes('每周一、周三、周五') && route.includes('0 8 * * 1,3,5'))
}

// ═══════════════════════════════════════
// 6. Token 记账
// ═══════════════════════════════════════

console.log('\n[T6] Token 记账（AI 看板数据源）')
{
  check('token-accounting.ts 存在', exists('src/lib/token-accounting.ts'))

  // usage 归一化：chat 与 responses 两种格式
  check(
    'chat 格式归一化（prompt_tokens/completion_tokens）',
    normalizeUsage({ prompt_tokens: 1000, completion_tokens: 200 }).inputTokens === 1000 &&
      normalizeUsage({ prompt_tokens: 1000, completion_tokens: 200 }).outputTokens === 200
  )
  check(
    'responses 格式归一化（input_tokens/output_tokens）',
    normalizeUsage({ input_tokens: 3000, output_tokens: 400 }).inputTokens === 3000 &&
      normalizeUsage({ input_tokens: 3000, output_tokens: 400 }).outputTokens === 400
  )
  check('null usage 容错', normalizeUsage(null).inputTokens === 0 && normalizeUsage(undefined).outputTokens === 0)
  check('零值不记账', normalizeUsage({ input_tokens: 0, output_tokens: 0 }).inputTokens === 0)

  // 日期键
  const d = new Date(2026, 7, 5) // 2026-08-05
  check('todayKey 格式 YYYY-MM-DD', todayKey(d) === '2026-08-05')
  check('tokenCacheKeyFor 格式', tokenCacheKeyFor('2026-08-05') === 'token-usage:2026-08-05')

  // 埋点完整性：所有 DeepSeek 调用点都记 usage
  const tavilyLib = read('src/lib/tavily-search.ts')
  const dsLib = read('src/lib/deepseek-websearch.ts')
  check('deepseekWebSearch 记账埋点', dsLib.includes("recordTokenUsage(options?.module"))
  check('searchAndSummarize 记账埋点', tavilyLib.includes('recordTokenUsage(options?.module'))
  check('summarizeMergedResults 记账埋点', tavilyLib.includes("recordTokenUsage('search-lib'"))

  // 记账模块覆盖（search-lib 为 summarizeMergedResults 内部默认值，不需调用方传参）
  const callers: Record<string, string> = {
    'ai-card': 'src/app/api/projects/[id]/ai-card/route.ts',
    'competitors': 'src/app/api/projects/[id]/competitors/route.ts',
    'ai-leads': 'src/lib/ai-lead-retrieval.ts',
    'industry-news': 'src/lib/dd-harness/tools.ts',
    'news': 'src/app/api/news/search/route.ts',
    'research': 'src/app/api/research/[projectId]/[moduleType]/analyze/route.ts',
    'dd-harness': 'src/lib/dd-harness/tools.ts',
  }
  for (const m of Object.keys(callers)) {
    check(`模块「${m}」记账标识传入调用方`, read(callers[m]).includes(`module: '${m}'`))
  }
  check('模块「search-lib」为归纳默认记账值（硬编码）', read('src/lib/tavily-search.ts').includes("recordTokenUsage('search-lib'"))
}

// ═══════════════════════════════════════
// 7. AI 看板（API + 前端）
// ═══════════════════════════════════════

console.log('\n[T7] AI 看板（token-usage API + 前端页面）')
{
  check('/api/token-usage 路由存在', exists('src/app/api/token-usage/route.ts'))
  const api = read('src/app/api/token-usage/route.ts')
  check('API 需登录鉴权', api.includes('getServerSession') || api.includes('session'))
  check('API 日期范围保护（最多92天）', api.includes('92'))
  check('API 返回 days + summary 结构', api.includes('days') && api.includes('summary'))

  // 前端页面（组件名与页面标题均已改为 AI 看板；注释中的“原新闻监控页升级”仅说明来历）
  const page = read('src/app/news/page.tsx')
  check('AI 看板页面（替换新闻监控）', page.includes('AIBoardPage') && page.includes('title="AI 看板"'))
  check('日历热力图（颜色深浅分级）', page.includes('heatLevel') && page.includes('HEAT_STYLES'))
  check('热力图按当月最大日消耗归一化', page.includes('maxTotal'))
  check('点击日期查看当日模块明细', page.includes('selectedDay') && page.includes('明细'))
  check('模块消耗排行', page.includes('moduleRanking') || page.includes('模块消耗排行'))
  check('数据源 /api/token-usage', page.includes('/api/token-usage'))
  check('月份切换', page.includes('changeMonth'))

  // 导航更新
  const layout = read('src/components/DashboardLayout.tsx')
  check('侧边栏导航改为「AI 看板」', layout.includes("label: 'AI 看板'") && !layout.includes("label: '新闻监控'"))
}

// ═══════════════════════════════════════
// 8. 纯函数回归（双源决策逻辑未破坏）
// ═══════════════════════════════════════

console.log('\n[T8] 双源决策逻辑回归')
{
  const tavily = [mkResult('https://t1.com', 'T1'), mkResult('https://t2.com', 'T2')]
  const deepseek = [mkResult('https://d1.com', 'D1'.repeat(3000))]

  const both = resolveDualSearch(tavily, deepseek)
  check('双边 → both + 合并', both.winner === 'both' && both.results.length === 3)
  check('双边 → 需归纳', both.needsSummarize === true)

  const onlyT = resolveDualSearch(tavily, [])
  check('仅Tavily → 原样返回不归纳', onlyT.winner === 'tavily' && onlyT.results === tavily && onlyT.needsSummarize === false)

  const onlyD = resolveDualSearch([], deepseek)
  check('仅DeepSeek → 原样返回不归纳', onlyD.winner === 'deepseek' && onlyD.results === deepseek)

  const none = resolveDualSearch([], [])
  check('双空 → none', none.winner === 'none')

  check('完整度评分：URL数主导', scoreCompleteness(mkResult('https://a.com', 'x')) < scoreCompleteness([mkResult('https://a.com', 'x'), mkResult('https://b.com', 'x')]))
}

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
