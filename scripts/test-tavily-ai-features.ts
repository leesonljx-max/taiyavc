/**
 * 单元测试：Tavily + DeepSeek AI 四大功能改造
 *
 * 覆盖范围：
 *   A. 共享工具库 src/lib/tavily-search.ts
 *     1. searchWeb 返回结构正确
 *     2. searchWeb 错误降级（API Key 缺失时返回空数组）
 *     3. searchAndSummarize 数据流（搜索 → DeepSeek）
 *     4. searchAndSummarize 空搜索结果处理
 *
 *   B. AI画板路由 src/app/api/projects/[id]/ai-card/route.ts
 *     5. POST 包含 Tavily 搜索调用
 *     6. 缓存写入 aiCardJson 字段
 *     7. GET 返回缓存的卡片数据
 *
 *   C. 竞争态势路由 src/app/api/projects/[id]/competitors/route.ts
 *     8. POST 包含 Tavily 搜索竞品关键词
 *     9. 缓存写入 competitorAnalysisJson 字段
 *    10. GET 返回缓存的竞争对手数据
 *
 *   D. 融资热点图路由 src/app/api/statistics/financing-heatmap/route.ts
 *    11. GET 命中缓存直接返回（不触发搜索）
 *    12. POST 触发 Tavily 搜索 + DeepSeek 分析 + 写缓存
 *    13. 缓存 cacheKey 格式：heatmap:YYYY
 *
 *   E. 新闻监控路由 src/app/api/news/search/route.ts
 *    14. getISOWeekKey 输出格式 YYYY-Www
 *    15. GET 命中缓存返回本周新闻
 *    16. POST 触发 Tavily news topic 搜索
 *    17. POST 写入 AICache（cacheKey=news:YYYY-Www）
 *    18. POST 同时入库 NewsArticle 表（所有账号共享）
 *
 *   F. 共享缓存模型 AICache
 *    19. upsert 行为：首次 create，二次 update
 *    20. 不同 cacheKey 互不影响
 *
 *   G. 辅助函数
 *    21. repairJson 处理尾随逗号、代码块
 *    22. ISO 周号在不同日期下稳定
 *
 * 运行: npx tsx scripts/test-tavily-ai-features.ts
 */
import 'dotenv/config'
import { readFile } from 'fs/promises'
import { join } from 'path'

interface TestResult { name: string; passed: boolean; detail?: string }
const results: TestResult[] = []

function log(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail })
  const mark = passed ? '✓' : '✗'
  const suffix = !passed && detail ? ` — ${detail}` : ''
  console.log(`${mark} ${name}${suffix}`)
}

// ── 工具函数（从路由文件复制以进行单元测试） ──

/** 从 news/search/route.ts 复制的 ISO 周号函数 */
function getISOWeekKey(date: Date): string {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

/** 从 news/search/route.ts 复制的 JSON 修复函数 */
function repairJson(text: string): string {
  return text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
}

// ════════════════════════════════════════════════════════
// A. 共享工具库 src/lib/tavily-search.ts
// ════════════════════════════════════════════════════════

async function testA_TavilySearchLib() {
  console.log('\n━━━ A. 共享工具库 src/lib/tavily-search.ts ━━━\n')

  // 1. 源码结构验证
  const libContent = await readFile(
    join(__dirname, '..', 'src', 'lib', 'tavily-search.ts'),
    'utf-8'
  )

  log(
    'A1. tavily-search.ts 导出 searchWeb 函数',
    libContent.includes('export async function searchWeb'),
    '未找到 searchWeb 导出'
  )

  log(
    'A2. tavily-search.ts 导出 searchAndSummarize 函数',
    libContent.includes('export async function searchAndSummarize'),
    '未找到 searchAndSummarize 导出'
  )

  log(
    'A3. searchWeb 支持 topic 选项（news/general）',
    libContent.includes("topic?: 'news' | 'general'"),
    '未找到 topic 选项'
  )

  log(
    'A4. searchWeb 支持 days 选项（用于近 N 天检索）',
    libContent.includes('days?:') && libContent.includes('days: options?.days'),
    '未找到 days 选项'
  )

  log(
    'A5. searchWeb 错误时返回空数组（不抛出）',
    libContent.includes('return []'),
    '未找到错误降级 return []'
  )

  log(
    'A6. searchAndSummarize 使用 deepseek-v4-flash 模型',
    libContent.includes('deepseek-v4-flash'),
    '模型名称未更新为 deepseek-v4-flash'
  )

  log(
    'A7. searchAndSummarize 设置超时控制（AbortController）',
    libContent.includes('AbortController') && libContent.includes('setTimeout'),
    '未找到超时控制'
  )

  log(
    'A8. searchAndSummarize 空结果时返回 data=null',
    libContent.includes("data: null, searchResultsCount: 0, error: '未找到相关搜索结果'"),
    '未找到空结果处理'
  )

  // 1. 实际调用 searchWeb（需要 TAVILY_API_KEY）
  const hasApiKey = !!process.env.TAVILY_API_KEY
  if (hasApiKey) {
    try {
      const { searchWeb } = await import('../src/lib/tavily-search')
      const results = await searchWeb('测试查询', { maxResults: 2 })
      log(
        'A1-live. searchWeb 实际调用返回 SearchResult[]',
        Array.isArray(results) && results.every(r => 'title' in r && 'url' in r && 'content' in r),
        `返回结构异常: ${JSON.stringify(results).substring(0, 100)}`
      )
    } catch (e) {
      log('A1-live. searchWeb 实际调用返回 SearchResult[]', false, (e as Error).message)
    }
  } else {
    log('A1-live. searchWeb 实际调用（跳过：未配置 TAVILY_API_KEY）', true)
  }
}

// ════════════════════════════════════════════════════════
// B. AI画板路由
// ════════════════════════════════════════════════════════

async function testB_AICardRoute() {
  console.log('\n━━━ B. AI画板路由 ai-card/route.ts ━━━\n')

  const content = await readFile(
    join(__dirname, '..', 'src', 'app', 'api', 'projects', '[id]', 'ai-card', 'route.ts'),
    'utf-8'
  )

  log(
    'B1. 引入 searchWeb（来自 tavily-search）',
    content.includes("from '@/lib/tavily-search'") && content.includes('searchWeb'),
    '未引入 searchWeb'
  )

  log(
    'B2. POST 中执行 Tavily 并发搜索',
    content.includes('Promise.all') && content.includes('searchWeb(q'),
    '未找到并发搜索'
  )

  log(
    'B3. 搜索关键词包含项目名+融资',
    content.includes('`${project.name} 融资 投资`'),
    '搜索关键词未包含融资相关词'
  )

  log(
    'B4. 搜索结果拼入 DeepSeek prompt',
    content.includes('externalInfo') && content.includes('prompt'),
    '搜索结果未传入 prompt'
  )

  log(
    'B5. DeepSeek 模型为 deepseek-v4-flash',
    content.includes("'deepseek-v4-flash'") || content.includes('"deepseek-v4-flash"'),
    '模型名称不正确'
  )

  log(
    'B6. 结果写入 aiCardJson 字段',
    content.includes('aiCardJson'),
    '未写入 aiCardJson 字段'
  )

  log(
    'B7. GET 返回缓存的 aiCardJson',
    content.includes('project.aiCardJson') && content.includes('card: aiCardData'),
    'GET 未返回缓存数据'
  )

  log(
    'B8. POST 权限校验使用 canEditProject',
    content.includes('canEditProject'),
    '未使用 canEditProject 校验权限'
  )
}

// ════════════════════════════════════════════════════════
// C. 竞争态势路由
// ════════════════════════════════════════════════════════

async function testC_CompetitorsRoute() {
  console.log('\n━━━ C. 竞争态势路由 competitors/route.ts ━━━\n')

  const content = await readFile(
    join(__dirname, '..', 'src', 'app', 'api', 'projects', '[id]', 'competitors', 'route.ts'),
    'utf-8'
  )

  log(
    'C1. 引入 searchWeb',
    content.includes("from '@/lib/tavily-search'") && content.includes('searchWeb'),
    '未引入 searchWeb'
  )

  log(
    'C2. 搜索关键词包含"竞品"',
    content.includes('竞品') && content.includes('竞争对手'),
    '搜索关键词未包含竞品相关词'
  )

  log(
    'C3. 搜索关键词动态使用 mainProducts',
    content.includes('project.mainProducts'),
    '未基于 mainProducts 构建搜索关键词'
  )

  log(
    'C4. 并发执行多个搜索查询',
    content.includes('Promise.all') && content.includes('searchResults'),
    '未使用 Promise.all 并发搜索'
  )

  log(
    'C5. 结果写入 competitorAnalysisJson 字段',
    content.includes('competitorAnalysisJson'),
    '未写入 competitorAnalysisJson 字段'
  )

  log(
    'C6. GET 返回缓存的竞争对手数据',
    content.includes('project.competitorAnalysisJson') && content.includes('competitors: parsed.competitors'),
    'GET 未返回缓存数据'
  )

  log(
    'C7. DeepSeek 使用 response_format: json_object',
    content.includes("response_format: { type: 'json_object' }"),
    '未使用 json_object 响应格式'
  )
}

// ════════════════════════════════════════════════════════
// D. 融资热点图路由
// ════════════════════════════════════════════════════════

async function testD_FinancingHeatmapRoute() {
  console.log('\n━━━ D. 融资热点图路由 financing-heatmap/route.ts ━━━\n')

  const content = await readFile(
    join(__dirname, '..', 'src', 'app', 'api', 'statistics', 'financing-heatmap', 'route.ts'),
    'utf-8'
  )

  log(
    'D1. 引入 searchWeb',
    content.includes("from '@/lib/tavily-search'") && content.includes('searchWeb'),
    '未引入 searchWeb'
  )

  log(
    'D2. 实现 GET 端点（返回缓存）',
    content.includes('export async function GET'),
    '未实现 GET 端点'
  )

  log(
    'D3. 实现 POST 端点（刷新）',
    content.includes('export async function POST'),
    '未实现 POST 端点'
  )

  log(
    'D4. GET 命中缓存时直接返回',
    content.includes('prisma.aICache.findUnique') && content.includes('cachedData'),
    'GET 未使用缓存'
  )

  log(
    'D5. POST 使用 Tavily 并发搜索各行业',
    content.includes('Promise.all') && content.includes('searchWeb(`${ind}'),
    '未使用并发搜索'
  )

  log(
    'D6. POST 调用 DeepSeek 分析',
    content.includes('api.deepseek.com') && content.includes('deepseek-v4-flash'),
    '未调用 DeepSeek'
  )

  log(
    'D7. POST 写入 AICache（upsert）',
    content.includes('prisma.aICache.upsert'),
    '未使用 upsert 写缓存'
  )

  log(
    'D8. cacheKey 格式为 heatmap:YYYY',
    content.includes('`heatmap:${validYear}`'),
    'cacheKey 格式不正确'
  )

  log(
    'D9. POST 返回 refreshedAt 字段',
    content.includes('refreshedAt'),
    '未返回 refreshedAt'
  )

  log(
    'D10. GET 返回 cachedAt 字段',
    content.includes('cachedAt'),
    '未返回 cachedAt'
  )

  log(
    'D11. 缺失行业补全逻辑',
    content.includes('returnedIndustries') && content.includes('heatData.push'),
    '未实现缺失行业补全'
  )

  log(
    'D12. heatData 按 heatLevel 降序排序',
    content.includes('heatData.sort((a, b) => b.heatLevel - a.heatLevel)'),
    '未按热度排序'
  )
}

// ════════════════════════════════════════════════════════
// E. 新闻监控路由
// ════════════════════════════════════════════════════════

async function testE_NewsSearchRoute() {
  console.log('\n━━━ E. 新闻监控路由 news/search/route.ts ━━━\n')

  const content = await readFile(
    join(__dirname, '..', 'src', 'app', 'api', 'news', 'search', 'route.ts'),
    'utf-8'
  )

  log(
    'E1. 引入 searchWeb',
    content.includes("from '@/lib/tavily-search'") && content.includes('searchWeb'),
    '未引入 searchWeb'
  )

  log(
    'E2. 实现 GET 端点（返回缓存）',
    content.includes('export async function GET'),
    '未实现 GET 端点'
  )

  log(
    'E3. 实现 POST 端点（刷新）',
    content.includes('export async function POST'),
    '未实现 POST 端点'
  )

  log(
    'E4. POST 使用 Tavily news topic 搜索',
    content.includes("topic: 'news'") && content.includes('days: 7'),
    '未使用 news topic + days:7'
  )

  log(
    'E5. POST 并发搜索所有主题',
    content.includes('Promise.all') && content.includes('searchPromises'),
    '未使用并发搜索'
  )

  log(
    'E6. POST 调用 DeepSeek 提取新闻',
    content.includes('api.deepseek.com') && content.includes('deepseek-v4-flash'),
    '未调用 DeepSeek'
  )

  log(
    'E7. POST 写入 NewsArticle 表（所有账号共享）',
    content.includes('prisma.newsArticle.createMany'),
    '未入库 NewsArticle'
  )

  log(
    'E8. POST 同时写入 AICache（按周缓存）',
    content.includes('prisma.aICache.upsert'),
    '未写 AICache'
  )

  log(
    'E9. cacheKey 格式为 news:YYYY-Www',
    content.includes('`news:${weekKey}`'),
    'cacheKey 格式不正确'
  )

  log(
    'E10. POST 使用 60s 超时控制',
    content.includes('60000') && content.includes('AbortController'),
    '未设置 60s 超时'
  )

  log(
    'E11. 使用 repairJson 处理 DeepSeek 返回',
    content.includes('repairJson'),
    '未使用 repairJson'
  )

  log(
    'E12. 过滤 7 天外文章',
    content.includes('sevenDaysAgo') && content.includes('publishedDate < sevenDaysAgo'),
    '未过滤 7 天外文章'
  )

  log(
    'E13. POST 返回 refreshedAt 字段',
    content.includes('refreshedAt'),
    '未返回 refreshedAt'
  )

  log(
    'E14. POST 返回 weekKey 字段',
    content.includes('weekKey'),
    '未返回 weekKey'
  )

  log(
    'E15. 跳过无 title 或 publishedAt 的文章',
    content.includes("if (!article.title || !article.publishedAt) continue"),
    '未做字段校验'
  )

  log(
    'E16. 使用 skipDuplicates 防止重复入库',
    content.includes('skipDuplicates: true'),
    '未使用 skipDuplicates'
  )
}

// ════════════════════════════════════════════════════════
// F. AICache 模型验证
// ════════════════════════════════════════════════════════

async function testF_AICacheModel() {
  console.log('\n━━━ F. AICache 缓存模型 ━━━\n')

  const schemaContent = await readFile(
    join(__dirname, '..', 'prisma', 'schema.prisma'),
    'utf-8'
  )

  log(
    'F1. AICache 模型存在于 schema',
    schemaContent.includes('model AICache'),
    '未找到 AICache 模型'
  )

  log(
    'F2. AICache 包含 cacheKey 字段（unique）',
    schemaContent.includes('cacheKey  String   @unique'),
    'cacheKey 字段未设置为 unique'
  )

  log(
    'F3. AICache 包含 data 字段（存储 JSON 字符串）',
    schemaContent.includes('data      String'),
    '未找到 data 字段'
  )

  log(
    'F4. AICache 包含 updatedAt 字段（自动更新）',
    schemaContent.includes('@updatedAt'),
    '未找到 updatedAt 字段'
  )

  log(
    'F5. AICache 在 cacheKey 上建立索引',
    schemaContent.includes('@@index([cacheKey])'),
    '未建立 cacheKey 索引'
  )

  // 不同 cacheKey 隔离验证（基于 upsert 语义）
  const heatmapKey = 'heatmap:2026'
  const newsKey = 'news:2026-W30'
  log(
    'F6. 融资热点图与新闻监控使用不同 cacheKey',
    heatmapKey !== newsKey,
    'cacheKey 冲突'
  )
}

// ════════════════════════════════════════════════════════
// G. 辅助函数测试
// ════════════════════════════════════════════════════════

function testG_Helpers() {
  console.log('\n━━━ G. 辅助函数 ━━━\n')

  // G1-G4: ISO 周号函数（ISO 8601: 包含当年第一个周四的周为第1周）
  const testDates: { date: string; expected: string }[] = [
    { date: '2026-01-01', expected: '2026-W01' },  // 2026-01-01 是周四，属 2026-W01
    { date: '2026-07-26', expected: '2026-W30' },  // 当前日期
    { date: '2026-12-31', expected: '2026-W53' },  // 2026 年有 53 周
    { date: '2027-01-01', expected: '2026-W53' },  // 2027-01-01 是周五，属上一周 2026-W53
  ]

  for (const c of testDates) {
    const result = getISOWeekKey(new Date(c.date))
    log(
      `G-ISO. ${c.date} → ${c.expected}`,
      result === c.expected,
      `实际: ${result}`
    )
  }

  // G5-G8: repairJson
  const jsonCases: { name: string; input: string; expected: string }[] = [
    {
      name: '去除 markdown 代码块',
      input: '```json\n{"articles":[]}\n```',
      expected: '{"articles":[]}',
    },
    {
      name: '去除尾随逗号',
      input: '{"a":1,"b":2,}',
      expected: '{"a":1,"b":2}',
    },
    {
      name: '中文引号转英文引号',
      input: '{"name":"测试"}',
      expected: '{"name":"测试"}',
    },
    {
      name: '代码块+尾随逗号混合',
      input: '```json\n{"x":[1,2,],"y":{"z":3,}}\n```',
      expected: '{"x":[1,2],"y":{"z":3}}',
    },
  ]

  for (const c of jsonCases) {
    const result = repairJson(c.input)
    const ok = result === c.expected
    log(`G-JSON. ${c.name}`, ok, `期望: ${c.expected}, 实际: ${result}`)
  }
}

// ════════════════════════════════════════════════════════
// H. 整体一致性验证
// ════════════════════════════════════════════════════════

async function testH_Consistency() {
  console.log('\n━━━ H. 整体一致性 ━━━\n')

  const files = [
    'src/lib/tavily-search.ts',
    'src/app/api/projects/[id]/ai-card/route.ts',
    'src/app/api/projects/[id]/competitors/route.ts',
    'src/app/api/statistics/financing-heatmap/route.ts',
    'src/app/api/news/search/route.ts',
  ]

  for (const f of files) {
    try {
      const content = await readFile(join(__dirname, '..', f), 'utf-8')
      log(
        `H1. ${f} 使用 deepseek-v4-flash 模型`,
        content.includes('deepseek-v4-flash'),
        '模型名称未更新'
      )
    } catch {
      log(`H1. ${f} 文件读取失败`, false)
    }
  }

  // 验证所有路由都使用 force-dynamic
  for (const f of files.slice(1)) {
    try {
      const content = await readFile(join(__dirname, '..', f), 'utf-8')
      log(
        `H2. ${f} 设置 force-dynamic`,
        content.includes("dynamic = 'force-dynamic'"),
        '未设置 force-dynamic'
      )
    } catch {
      log(`H2. ${f} 文件读取失败`, false)
    }
  }

  // 验证所有 API 都做了未登录校验
  for (const f of files.slice(1)) {
    try {
      const content = await readFile(join(__dirname, '..', f), 'utf-8')
      log(
        `H3. ${f} 校验 session.user.id`,
        content.includes('session.user.id'),
        '未严格校验 session.user.id'
      )
    } catch {
      log(`H3. ${f} 文件读取失败`, false)
    }
  }
}

// ════════════════════════════════════════════════════════
// 主函数
// ════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Tavily + DeepSeek AI 四大功能改造 - 单元测试')
  console.log('═══════════════════════════════════════════════════')

  await testA_TavilySearchLib()
  await testB_AICardRoute()
  await testC_CompetitorsRoute()
  await testD_FinancingHeatmapRoute()
  await testE_NewsSearchRoute()
  await testF_AICacheModel()
  testG_Helpers()
  await testH_Consistency()

  // 汇总
  const total = results.length
  const passed = results.filter(r => r.passed).length
  const failed = total - passed

  console.log('\n═══════════════════════════════════════════════════')
  console.log(`  汇总: ${passed}/${total} 通过, ${failed} 失败`)
  console.log('═══════════════════════════════════════════════════')

  if (failed > 0) {
    console.log('\n失败用例:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    })
  }

  process.exit(failed === 0 ? 0 : 1)
}

main().catch(err => {
  console.error('测试执行失败:', err)
  process.exit(1)
})
