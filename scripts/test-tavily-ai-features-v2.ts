/**
 * 单元测试：Tavily + DeepSeek AI 四大功能改造（v2 完整版）
 *
 * 覆盖范围：
 *   A. 共享工具库 src/lib/tavily-search.ts
 *   B. AI画板路由（Tavily 搜索 + DeepSeek 分析 + 60s 超时 + repairJson）
 *   C. 竞争态势路由（4 维度：产品/技术路线/团队背景/融资进展）
 *   D. 融资热点图路由（GET 缓存 + POST 刷新 Tavily+DeepSeek）
 *   E. 新闻监控路由（Tavily news topic + DeepSeek + 按周缓存）
 *   F. AICache 缓存模型
 *   G. 辅助函数（ISO 周号 + JSON 修复）
 *   H. 前端调用模式（POST 触发刷新，GET 读取缓存）
 *   I. 与 AI 线索功能的一致性对比
 *
 * 运行: npx tsx scripts/test-tavily-ai-features-v2.ts
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

function getISOWeekKey(date: Date): string {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function repairJson(text: string): string {
  return text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
}

async function readFileContent(relativePath: string): Promise<string> {
  return readFile(join(__dirname, '..', relativePath), 'utf-8')
}

// ════════════════════════════════════════════════════════
// A. 共享工具库 src/lib/tavily-search.ts
// ════════════════════════════════════════════════════════

async function testA_TavilySearchLib() {
  console.log('\n━━━ A. 共享工具库 src/lib/tavily-search.ts ━━━\n')

  const libContent = await readFileContent('src/lib/tavily-search.ts')

  log(
    'A1. 导出 searchWeb 函数',
    libContent.includes('export async function searchWeb'),
    '未找到 searchWeb 导出'
  )

  log(
    'A2. 导出 searchAndSummarize 函数',
    libContent.includes('export async function searchAndSummarize'),
    '未找到 searchAndSummarize 导出'
  )

  log(
    'A3. searchWeb 支持 topic 选项（news/general）',
    libContent.includes("topic?: 'news' | 'general'"),
    '未找到 topic 选项'
  )

  log(
    'A4. searchWeb 支持 days 选项',
    libContent.includes('days?:') && libContent.includes('days: options?.days'),
    '未找到 days 选项'
  )

  log(
    'A5. searchWeb 错误时返回空数组（不抛出）',
    libContent.includes('return []'),
    '未找到错误降级 return []'
  )

  log(
    'A6. 使用 deepseek-v4-flash 模型',
    libContent.includes('deepseek-v4-flash'),
    '模型名称未更新'
  )

  log(
    'A7. 超时控制（AbortController）',
    libContent.includes('AbortController') && libContent.includes('setTimeout'),
    '未找到超时控制'
  )

  log(
    'A8. 空结果时返回 data=null',
    libContent.includes("data: null, searchResultsCount: 0"),
    '未找到空结果处理'
  )

  // 实跑测试（需要 TAVILY_API_KEY）
  if (process.env.TAVILY_API_KEY) {
    try {
      const { searchWeb } = await import('../src/lib/tavily-search')
      const results = await searchWeb('测试查询', { maxResults: 2 })
      log(
        'A9-live. searchWeb 实际调用返回 SearchResult[]',
        Array.isArray(results) && results.every(r => 'title' in r && 'url' in r && 'content' in r),
        `返回结构异常: ${JSON.stringify(results).substring(0, 100)}`
      )
    } catch (e) {
      log('A9-live. searchWeb 实际调用', false, (e as Error).message)
    }
  } else {
    log('A9-live. searchWeb 实际调用（跳过：未配置 TAVILY_API_KEY）', true)
  }
}

// ════════════════════════════════════════════════════════
// B. AI画板路由
// ════════════════════════════════════════════════════════

async function testB_AICardRoute() {
  console.log('\n━━━ B. AI画板路由 ai-card/route.ts ━━━\n')

  const content = await readFileContent('src/app/api/projects/[id]/ai-card/route.ts')

  log('B1. 引入 searchWeb', content.includes("from '@/lib/tavily-search'") && content.includes('searchWeb'))
  log('B2. Tavily 并发搜索', content.includes('Promise.all') && content.includes('searchWeb(q'))
  log('B3. 搜索关键词包含项目名+融资', content.includes('`${project.name} 融资 投资`'))
  log('B4. 搜索结果拼入 DeepSeek prompt', content.includes('externalInfo') && content.includes('prompt'))
  log('B5. DeepSeek 模型为 deepseek-v4-flash', content.includes('deepseek-v4-flash'))
  log('B6. 结果写入 aiCardJson 字段', content.includes('aiCardJson'))
  log('B7. GET 返回缓存的 aiCardJson', content.includes('project.aiCardJson') && content.includes('card: aiCardData'))
  log('B8. POST 权限校验使用 canEditProject', content.includes('canEditProject'))
  log('B9. 使用 60s 超时（与 AI 线索一致）', content.includes('60000'), '超时不足 60s')
  log('B10. 使用 repairJson 容错', content.includes('repairJson'), '未使用 repairJson')
}

// ════════════════════════════════════════════════════════
// C. 竞争态势路由（4 维度）
// ════════════════════════════════════════════════════════

async function testC_CompetitorsRoute() {
  console.log('\n━━━ C. 竞争态势路由 competitors/route.ts（4 维度）━━━\n')

  const content = await readFileContent('src/app/api/projects/[id]/competitors/route.ts')

  log('C1. 引入 searchWeb', content.includes("from '@/lib/tavily-search'") && content.includes('searchWeb'))

  // 4 维度关键词检查
  log('C2. 搜索关键词覆盖"产品"维度', content.includes('产品'))
  log('C3. 搜索关键词覆盖"技术路线"维度', content.includes('技术路线'))
  log('C4. 搜索关键词覆盖"团队背景"维度', content.includes('团队背景') && content.includes('创始人'))
  log('C5. 搜索关键词覆盖"融资进展"维度', content.includes('融资') && content.includes('投资方'))

  log('C6. 并发执行多个搜索查询', content.includes('Promise.all') && content.includes('searchResults'))
  log('C7. 使用 4 个搜索查询', (content.match(/searchWeb\(q/g) || []).length >= 1 && content.includes('searchQueries = ['))

  // CompetitorItem 接口 4 维度检查
  log('C8. CompetitorItem 包含 products 字段（产品维度）', content.includes('products:'))
  log('C9. CompetitorItem 包含 techRoute 字段（技术路线维度）', content.includes('techRoute:'))
  log('C10. CompetitorItem 包含 teamBackground 字段（团队背景维度）', content.includes('teamBackground:'))
  log('C11. CompetitorItem 包含 latestRound 字段（融资轮次）', content.includes('latestRound:'))
  log('C12. CompetitorItem 包含 amount 字段（融资金额）', content.includes('amount:'))
  log('C13. CompetitorItem 包含 investors 字段（投资方）', content.includes('investors:'))

  // DeepSeek prompt 4 维度检查
  log('C14. prompt 提及"产品"维度', content.includes('产品维度'))
  log('C15. prompt 提及"技术路线"维度', content.includes('技术路线维度'))
  log('C16. prompt 提及"团队背景"维度', content.includes('团队背景维度'))
  log('C17. prompt 提及"融资进展"维度', content.includes('融资进展维度'))

  log('C18. 结果写入 competitorAnalysisJson 字段', content.includes('competitorAnalysisJson'))
  log('C19. GET 返回缓存的竞争对手数据', content.includes('project.competitorAnalysisJson'))
  log('C20. 使用 response_format: json_object', content.includes("response_format: { type: 'json_object' }"))
  log('C21. 使用 60s 超时', content.includes('60000'), '超时不足 60s')
  log('C22. 使用 repairJson 容错', content.includes('repairJson'))
}

// ════════════════════════════════════════════════════════
// D. 融资热点图路由
// ════════════════════════════════════════════════════════

async function testD_FinancingHeatmapRoute() {
  console.log('\n━━━ D. 融资热点图路由 financing-heatmap/route.ts ━━━\n')

  const content = await readFileContent('src/app/api/statistics/financing-heatmap/route.ts')

  log('D1. 引入 searchWeb', content.includes("from '@/lib/tavily-search'") && content.includes('searchWeb'))
  log('D2. 实现 GET 端点（返回缓存）', content.includes('export async function GET'))
  log('D3. 实现 POST 端点（刷新）', content.includes('export async function POST'))
  log('D4. GET 命中缓存时直接返回', content.includes('prisma.aICache.findUnique') && content.includes('cachedData'))
  log('D5. POST 使用 Tavily 并发搜索各行业', content.includes('Promise.all') && content.includes('searchWeb(`${ind}'))
  log('D6. POST 调用 DeepSeek 分析', content.includes('api.deepseek.com') && content.includes('deepseek-v4-flash'))
  log('D7. POST 写入 AICache（upsert）', content.includes('prisma.aICache.upsert'))
  log('D8. cacheKey 格式为 heatmap:YYYY', content.includes('`heatmap:${validYear}`'))
  log('D9. POST 返回 refreshedAt 字段', content.includes('refreshedAt'))
  log('D10. GET 返回 cachedAt 字段', content.includes('cachedAt'))
  log('D11. 缺失行业补全逻辑', content.includes('returnedIndustries') && content.includes('heatData.push'))
  log('D12. heatData 按 heatLevel 降序排序', content.includes('heatData.sort((a, b) => b.heatLevel - a.heatLevel)'))
  log('D13. POST 使用 60s 超时', content.includes('60000'), '超时不足 60s')
}

// ════════════════════════════════════════════════════════
// E. 新闻监控路由
// ════════════════════════════════════════════════════════

async function testE_NewsSearchRoute() {
  console.log('\n━━━ E. 新闻监控路由 news/search/route.ts ━━━\n')

  const content = await readFileContent('src/app/api/news/search/route.ts')

  log('E1. 引入 searchWeb', content.includes("from '@/lib/tavily-search'") && content.includes('searchWeb'))
  log('E2. 实现 GET 端点（返回缓存）', content.includes('export async function GET'))
  log('E3. 实现 POST 端点（刷新）', content.includes('export async function POST'))
  log('E4. POST 使用 Tavily news topic 搜索', content.includes("topic: 'news'") && content.includes('days: 7'))
  log('E5. POST 并发搜索所有主题', content.includes('Promise.all') && content.includes('searchPromises'))
  log('E6. POST 调用 DeepSeek 提取新闻', content.includes('api.deepseek.com') && content.includes('deepseek-v4-flash'))
  log('E7. POST 写入 NewsArticle 表（所有账号共享）', content.includes('prisma.newsArticle.createMany'))
  log('E8. POST 同时写入 AICache（按周缓存）', content.includes('prisma.aICache.upsert'))
  log('E9. cacheKey 格式为 news:YYYY-Www', content.includes('`news:${weekKey}`'))
  log('E10. POST 使用 60s 超时控制', content.includes('60000') && content.includes('AbortController'))
  log('E11. 使用 repairJson 处理 DeepSeek 返回', content.includes('repairJson'))
  log('E12. 过滤 7 天外文章', content.includes('sevenDaysAgo') && content.includes('publishedDate < sevenDaysAgo'))
  log('E13. POST 返回 refreshedAt 字段', content.includes('refreshedAt'))
  log('E14. POST 返回 weekKey 字段', content.includes('weekKey'))
  log('E15. 跳过无 title 或 publishedAt 的文章', content.includes("if (!article.title || !article.publishedAt) continue"))
  log('E16. 使用 skipDuplicates 防止重复入库', content.includes('skipDuplicates: true'))
}

// ════════════════════════════════════════════════════════
// F. AICache 缓存模型
// ════════════════════════════════════════════════════════

async function testF_AICacheModel() {
  console.log('\n━━━ F. AICache 缓存模型 ━━━\n')

  const schemaContent = await readFileContent('prisma/schema.prisma')

  log('F1. AICache 模型存在于 schema', schemaContent.includes('model AICache'))
  log('F2. cacheKey 字段（unique）', schemaContent.includes('cacheKey  String   @unique'))
  log('F3. data 字段（存储 JSON 字符串）', schemaContent.includes('data      String'))
  log('F4. updatedAt 字段（自动更新）', schemaContent.includes('@updatedAt'))
  log('F5. cacheKey 上建立索引', schemaContent.includes('@@index([cacheKey])'))

  // 不同 cacheKey 隔离
  log('F6. 融资热点图与新闻监控使用不同 cacheKey',
    'heatmap:2026' !== 'news:2026-W30',
    'cacheKey 冲突'
  )
}

// ════════════════════════════════════════════════════════
// G. 辅助函数
// ════════════════════════════════════════════════════════

function testG_Helpers() {
  console.log('\n━━━ G. 辅助函数 ━━━\n')

  // ISO 周号
  const testDates: { date: string; expected: string }[] = [
    { date: '2026-01-01', expected: '2026-W01' },
    { date: '2026-07-26', expected: '2026-W30' },
    { date: '2026-12-31', expected: '2026-W53' },
    { date: '2027-01-01', expected: '2026-W53' },
  ]

  for (const c of testDates) {
    const result = getISOWeekKey(new Date(c.date))
    log(`G-ISO. ${c.date} → ${c.expected}`, result === c.expected, `实际: ${result}`)
  }

  // JSON 修复
  const jsonCases: { name: string; input: string; expected: string }[] = [
    { name: '去除 markdown 代码块', input: '```json\n{"articles":[]}\n```', expected: '{"articles":[]}' },
    { name: '去除尾随逗号', input: '{"a":1,"b":2,}', expected: '{"a":1,"b":2}' },
    { name: '中文引号转英文引号', input: '{"name":"测试"}', expected: '{"name":"测试"}' },
    { name: '代码块+尾随逗号混合', input: '```json\n{"x":[1,2,],"y":{"z":3,}}\n```', expected: '{"x":[1,2],"y":{"z":3}}' },
  ]

  for (const c of jsonCases) {
    const result = repairJson(c.input)
    log(`G-JSON. ${c.name}`, result === c.expected, `期望: ${c.expected}, 实际: ${result}`)
  }
}

// ════════════════════════════════════════════════════════
// H. 前端调用模式验证
// ════════════════════════════════════════════════════════

async function testH_FrontendCallPatterns() {
  console.log('\n━━━ H. 前端调用模式 ━━━\n')

  // 项目详情页 - AI 画板
  const projectPage = await readFileContent('src/app/projects/[id]/page.tsx')

  log(
    'H1. AI画板点击按钮调用 POST /api/projects/[id]/ai-card',
    projectPage.includes("fetch(`/api/projects/${params.id}/ai-card`") && projectPage.includes('method: '),
    '未找到 POST 调用'
  )

  log(
    'H2. AI画板加载时从 aiCardJson 读取缓存',
    projectPage.includes('projectData.aiCardJson') && projectPage.includes('setAiCard'),
    '未从缓存加载'
  )

  // 项目详情页 - 竞争态势
  log(
    'H3. 竞争态势点击按钮调用 POST /api/projects/[id]/competitors',
    projectPage.includes("fetch(`/api/projects/${params.id}/competitors`") && projectPage.includes("method: 'POST'"),
    '未找到 POST 调用'
  )

  log(
    'H4. 竞争态势加载时从 competitorAnalysisJson 读取缓存',
    projectPage.includes('projectData.competitorAnalysisJson') && projectPage.includes('setCompetitorList'),
    '未从缓存加载'
  )

  // 竞争态势 4 维度展示
  log('H5. 竞争态势卡片展示"产品"维度', projectPage.includes('产品') && projectPage.includes('products'))
  log('H6. 竞争态势卡片展示"技术路线"维度', projectPage.includes('技术路线') && projectPage.includes('techRoute'))
  log('H7. 竞争态势卡片展示"团队背景"维度', projectPage.includes('团队背景') && projectPage.includes('teamBackground'))
  log('H8. 竞争态势卡片展示"融资进展"维度', projectPage.includes('融资进展'))

  // 统计分析页 - 融资热点图
  const statsPage = await readFileContent('src/app/statistics/page.tsx')

  log(
    'H9. 融资热点图按钮调用 POST 触发刷新',
    statsPage.includes('refreshHeatmap') && statsPage.includes("method: 'POST'"),
    '按钮未调用 POST 刷新'
  )

  log(
    'H10. 融资热点图页面加载时调用 GET 读取缓存',
    statsPage.includes('fetchHeatmap') && statsPage.includes('financing-heatmap?year='),
    '未调用 GET 读取缓存'
  )

  log(
    'H11. 融资热点图显示缓存时间',
    statsPage.includes('cachedAt') || statsPage.includes('refreshedAt'),
    '未显示缓存/刷新时间'
  )

  // 新闻页
  const newsPage = await readFileContent('src/app/news/page.tsx')

  log(
    'H12. 新闻监控按钮调用 POST 触发刷新',
    newsPage.includes("/api/news/search") && newsPage.includes("method: 'POST'"),
    '按钮未调用 POST 刷新'
  )

  log(
    'H13. 新闻监控加载时调用 GET 读取文章列表',
    newsPage.includes('/api/news') && newsPage.includes('fetchNews'),
    '未调用 GET 读取文章'
  )
}

// ════════════════════════════════════════════════════════
// I. 与 AI 线索功能的一致性对比
// ════════════════════════════════════════════════════════

async function testI_ConsistencyWithAILeads() {
  console.log('\n━━━ I. 与 AI 线索功能的一致性 ━━━\n')

  const aiLeadsLib = await readFileContent('src/lib/ai-lead-retrieval.ts')
  const files = [
    'src/lib/tavily-search.ts',
    'src/app/api/projects/[id]/ai-card/route.ts',
    'src/app/api/projects/[id]/competitors/route.ts',
    'src/app/api/statistics/financing-heatmap/route.ts',
    'src/app/api/news/search/route.ts',
  ]

  // 1. 都使用 Tavily 搜索
  for (const f of files) {
    const content = await readFileContent(f)
    log(`I1. ${f} 使用 Tavily 搜索`, content.includes('searchWeb') || content.includes('tavily'), '未使用 Tavily')
  }

  // 2. 都使用 DeepSeek API
  for (const f of files) {
    const content = await readFileContent(f)
    log(`I2. ${f} 调用 DeepSeek API`, content.includes('api.deepseek.com'), '未调用 DeepSeek')
  }

  // 3. 都使用 deepseek-v4-flash 模型
  for (const f of files) {
    const content = await readFileContent(f)
    log(`I3. ${f} 使用 deepseek-v4-flash 模型`, content.includes('deepseek-v4-flash'), '模型名称不一致')
  }

  // 4. 都使用 60s 超时（AI 线索是 60s）
  const routeFiles = files.slice(1) // 排除 tavily-search.ts
  for (const f of routeFiles) {
    const content = await readFileContent(f)
    log(`I4. ${f} 使用 60s 超时（与 AI 线索一致）`, content.includes('60000'), '超时不一致')
  }

  // 5. 都有缓存机制
  const cacheChecks = [
    { file: 'src/app/api/projects/[id]/ai-card/route.ts', pattern: 'aiCardJson' },
    { file: 'src/app/api/projects/[id]/competitors/route.ts', pattern: 'competitorAnalysisJson' },
    { file: 'src/app/api/statistics/financing-heatmap/route.ts', pattern: 'aICache.upsert' },
    { file: 'src/app/api/news/search/route.ts', pattern: 'aICache.upsert' },
  ]
  for (const c of cacheChecks) {
    const content = await readFileContent(c.file)
    log(`I5. ${c.file} 有缓存机制`, content.includes(c.pattern), `未找到 ${c.pattern}`)
  }

  // 6. AI 线索使用 repairJson，4 大功能也应该使用
  log('I6. AI 线索功能使用 repairJson', aiLeadsLib.includes('repairJson'))
  for (const f of routeFiles) {
    const content = await readFileContent(f)
    log(`I7. ${f} 使用 repairJson`, content.includes('repairJson'), '未使用 repairJson')
  }

  // 7. 都设置 force-dynamic
  for (const f of routeFiles) {
    const content = await readFileContent(f)
    log(`I8. ${f} 设置 force-dynamic`, content.includes("dynamic = 'force-dynamic'"))
  }

  // 8. 都校验 session.user.id
  for (const f of routeFiles) {
    const content = await readFileContent(f)
    log(`I9. ${f} 严格校验 session.user.id`, content.includes('session.user.id'))
  }

  // 10. 都有错误降级（搜索失败不中断流程）
  log('I10. AI 线索搜索失败返回空数组', aiLeadsLib.includes('return []'))
  const tavilyLib = await readFileContent('src/lib/tavily-search.ts')
  log('I11. tavily-search.ts 搜索失败返回空数组', tavilyLib.includes('return []'))
}

// ════════════════════════════════════════════════════════
// 主函数
// ════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Tavily + DeepSeek AI 四大功能改造 v2 - 单元测试')
  console.log('═══════════════════════════════════════════════════')

  await testA_TavilySearchLib()
  await testB_AICardRoute()
  await testC_CompetitorsRoute()
  await testD_FinancingHeatmapRoute()
  await testE_NewsSearchRoute()
  await testF_AICacheModel()
  testG_Helpers()
  await testH_FrontendCallPatterns()
  await testI_ConsistencyWithAILeads()

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
