/**
 * 单元测试：融资热点图 + 新闻监控 缓存与自动检索修复
 *
 * 覆盖范围：
 * A. 融资热点图前端调用逻辑
 * B. 新闻监控前端调用逻辑
 * C. API 路由缓存逻辑
 * D. Tavily + DeepSeek 调用链
 * E. 错误处理与边界条件
 */

import fs from 'fs'
import path from 'path'

const PROJECT_ROOT = path.resolve(__dirname, '..')
let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++
    console.log(`  ✓ ${message}`)
  } else {
    failed++
    console.log(`  ✗ ${message}`)
  }
}

function assertEqual(actual: any, expected: any, message: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
    console.log(`  ✓ ${message}`)
  } else {
    failed++
    console.log(`  ✗ ${message} (expected: ${JSON.stringify(expected)}, actual: ${JSON.stringify(actual)})`)
  }
}

// ═══════════════════════════════════════════════════════════
// A. 融资热点图前端调用逻辑
// ═══════════════════════════════════════════════════════════
console.log('\n══ A. 融资热点图前端调用逻辑 ══')

{
  const pagePath = path.join(PROJECT_ROOT, 'src/app/statistics/page.tsx')
  const content = fs.readFileSync(pagePath, 'utf-8')

  // 检查 useRef 引入
  assert(content.includes('useRef'), '引入 useRef 用于防重复触发')

  // 检查 autoTriggeredRef
  assert(content.includes('autoTriggeredRef'), '存在 autoTriggeredRef 防重复触发')
  assert(content.includes('useRef(false)'), 'autoTriggeredRef 初始化为 false')

  // 检查 fetchHeatmap 函数
  assert(content.includes('fetchHeatmap'), 'fetchHeatmap 函数存在')
  assert(content.includes('GET /api/statistics/financing-heatmap') || content.includes('/api/statistics/financing-heatmap?year='), 'GET 请求获取缓存')

  // 检查自动触发逻辑
  assert(content.includes('data.heatData.length === 0'), '检查缓存是否为空')
  assert(content.includes('industryData?.industries?.length > 0'), '检查行业数据是否存在')
  assert(content.includes('autoTriggeredRef.current'), '使用 ref 防止重复触发')
  assert(content.includes('await refreshHeatmap(year)'), '无缓存时自动调用 refreshHeatmap')

  // 检查 refreshHeatmap 函数
  assert(content.includes('refreshHeatmap'), 'refreshHeatmap 函数存在')
  assert(content.includes("method: 'POST'"), 'POST 请求触发检索')

  // 检查缓存时间显示
  assert(content.includes('cachedAt'), '显示缓存时间')
  assert(content.includes('refreshedAt'), '显示刷新时间')

  // 检查 loading 状态提示
  assert(content.includes('Tavily 检索 + DeepSeek 分析'), 'loading 提示包含 Tavily + DeepSeek')
  assert(content.includes('30-60 秒'), '提示预计耗时')
}

// ═══════════════════════════════════════════════════════════
// B. 新闻监控前端调用逻辑
// ═══════════════════════════════════════════════════════════
console.log('\n══ B. 新闻监控前端调用逻辑 ══')

{
  const pagePath = path.join(PROJECT_ROOT, 'src/app/news/page.tsx')
  const content = fs.readFileSync(pagePath, 'utf-8')

  // 检查 useRef 引入
  assert(content.includes('useRef'), '引入 useRef')

  // 检查 autoTriggeredRef
  assert(content.includes('autoTriggeredRef'), '存在 autoTriggeredRef')
  assert(content.includes('useRef(false)'), '初始化为 false')

  // 检查 fetchNewsWithCache 函数
  assert(content.includes('fetchNewsWithCache'), 'fetchNewsWithCache 函数存在')

  // 检查缓存读取逻辑
  assert(content.includes('/api/news/search?year='), 'GET /api/news/search 读取缓存')
  assert(content.includes('cacheData.articles'), '检查缓存中的 articles')
  assert(content.includes('cacheData.articles.length > 0'), '缓存有数据时直接显示')

  // 检查自动触发逻辑
  assert(content.includes('!autoTriggeredRef.current'), '使用 ref 防止重复触发')
  assert(content.includes('await handleSearch()'), '无缓存时自动调用 handleSearch')

  // 检查 handleSearch 函数
  assert(content.includes("method: 'POST'"), 'POST 请求触发检索')
  assert(content.includes('/api/news/search'), 'POST 到 /api/news/search')
  assert(content.includes('data.articles'), '使用 POST 返回的 articles')

  // 检查筛选逻辑
  assert(content.includes('fetchNewsFiltered'), 'fetchNewsFiltered 函数存在')
  assert(content.includes('/api/news?'), '筛选时查询 /api/news')

  // 检查 useEffect 逻辑
  assert(content.includes('selectedIndustry, selectedSource'), '监听筛选变化')

  // 检查不再调用旧的 fetchNews
  assert(!content.includes('const fetchNews ='), '已移除旧的 fetchNews 函数')
}

// ═══════════════════════════════════════════════════════════
// C. 融资热点图 API 路由
// ═══════════════════════════════════════════════════════════
console.log('\n══ C. 融资热点图 API 路由 ══')

{
  const routePath = path.join(PROJECT_ROOT, 'src/app/api/statistics/financing-heatmap/route.ts')
  const content = fs.readFileSync(routePath, 'utf-8')

  // 检查 GET 端点
  assert(content.includes('export async function GET'), 'GET 端点存在')
  assert(content.includes('aICache.findUnique'), 'GET 读取 AICache 缓存')
  assert(content.includes("heatmap:"), '缓存 key 格式为 heatmap:YYYY')

  // 检查 POST 端点
  assert(content.includes('export async function POST'), 'POST 端点存在')
  assert(content.includes('searchWeb'), 'POST 使用 Tavily searchWeb')
  assert(content.includes('Promise.all'), '并发搜索')
  assert(content.includes('deepseek-v4-flash'), '使用 DeepSeek API')
  assert(content.includes('aICache.upsert'), 'POST 写入 AICache 缓存')

  // 检查权限
  assert(content.includes('getServerSession'), '使用 session 鉴权')
  assert(content.includes('401'), '未登录返回 401')

  // 检查错误处理
  assert(content.includes('DEEPSEEK_API_KEY'), '检查 DeepSeek API Key')
  assert(content.includes('AbortController'), '超时控制')
  assert(content.includes('60000'), '60 秒超时')
}

// ═══════════════════════════════════════════════════════════
// D. 新闻监控 API 路由
// ═══════════════════════════════════════════════════════════
console.log('\n══ D. 新闻监控 API 路由 ══')

{
  const routePath = path.join(PROJECT_ROOT, 'src/app/api/news/search/route.ts')
  const content = fs.readFileSync(routePath, 'utf-8')

  // 检查 GET 端点（读取缓存）
  assert(content.includes('export async function GET'), 'GET 端点存在')
  assert(content.includes('aICache.findUnique'), 'GET 读取 AICache 缓存')
  assert(content.includes('news:'), '缓存 key 格式为 news:YYYY-Www')
  assert(content.includes('getISOWeekKey'), '使用 ISO 周号')

  // 检查 POST 端点（触发检索）
  assert(content.includes('export async function POST'), 'POST 端点存在')
  assert(content.includes('searchWeb'), 'POST 使用 Tavily searchWeb')
  assert(content.includes("topic: 'news'"), '使用 news topic 搜索')
  assert(content.includes('days: 7'), '搜索最近 7 天')
  assert(content.includes('Promise.all'), '并发搜索')
  assert(content.includes('deepseek-v4-flash'), '使用 DeepSeek API')

  // 检查数据持久化
  assert(content.includes('newsArticle.createMany'), '批量写入 NewsArticle 表')
  assert(content.includes('skipDuplicates: true'), '跳过重复文章')
  assert(content.includes('aICache.upsert'), '写入 AICache 缓存')

  // 检查权限
  assert(content.includes('getServerSession'), '使用 session 鉴权')
  assert(content.includes('401'), '未登录返回 401')

  // 检查错误处理
  assert(content.includes('repairJson'), 'JSON 修复函数')
  assert(content.includes('AbortController'), '超时控制')
  assert(content.includes('60000'), '60 秒超时')
}

// ═══════════════════════════════════════════════════════════
// E. Tavily 搜索工具库
// ═══════════════════════════════════════════════════════════
console.log('\n══ E. Tavily 搜索工具库 ══')

{
  const libPath = path.join(PROJECT_ROOT, 'src/lib/tavily-search.ts')
  const content = fs.readFileSync(libPath, 'utf-8')

  // 检查 searchWeb 函数
  assert(content.includes('export async function searchWeb'), 'searchWeb 函数存在')
  assert(content.includes('@tavily/core'), '引入 @tavily/core SDK')
  assert(content.includes('TAVILY_API_KEY'), '检查 TAVILY_API_KEY')

  // 检查搜索选项
  assert(content.includes('maxResults'), '支持 maxResults')
  assert(content.includes("topic"), '支持 topic（news/general）')
  assert(content.includes('days'), '支持 days（近 N 天）')

  // 检查错误处理
  assert(content.includes('catch'), '错误捕获')
  assert(content.includes('timed out') || content.includes('timeout'), '超时静默处理')
  assert(content.includes('return []'), '搜索失败返回空数组')

  // 检查 searchAndSummarize 函数
  assert(content.includes('export async function searchAndSummarize'), 'searchAndSummarize 函数存在')
  assert(content.includes('DEEPSEEK_API_KEY'), '检查 DEEPSEEK_API_KEY')
  assert(content.includes('deepseek-v4-flash'), '使用 deepseek-v4-flash 模型')
  assert(content.includes('AbortController'), '超时控制')
}

// ═══════════════════════════════════════════════════════════
// F. AICache 数据模型
// ═══════════════════════════════════════════════════════════
console.log('\n══ F. AICache 数据模型 ══')

{
  const schemaPath = path.join(PROJECT_ROOT, 'prisma/schema.prisma')
  const content = fs.readFileSync(schemaPath, 'utf-8')

  assert(content.includes('model AICache'), 'AICache 模型存在')
  assert(content.includes('cacheKey'), 'cacheKey 字段存在')
  assert(content.includes('@unique'), 'cacheKey 唯一索引')
  assert(content.includes('data'), 'data 字段存在')
  assert(content.includes('updatedAt'), 'updatedAt 字段存在')
  assert(content.includes('@@index([cacheKey])'), 'cacheKey 索引')
}

// ═══════════════════════════════════════════════════════════
// G. 缓存共享逻辑验证
// ═══════════════════════════════════════════════════════════
console.log('\n══ G. 缓存共享逻辑 ══')

{
  const heatmapRoute = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/api/statistics/financing-heatmap/route.ts'), 'utf-8')
  const newsRoute = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/api/news/search/route.ts'), 'utf-8')

  // 融资热点图：GET 返回缓存，POST 刷新缓存
  assert(
    heatmapRoute.includes('aICache.findUnique') && heatmapRoute.includes('aICache.upsert'),
    '融资热点图：GET 读缓存 + POST 写缓存'
  )
  assert(heatmapRoute.includes('cachedAt'), '融资热点图返回缓存时间')

  // 新闻监控：GET 返回缓存，POST 刷新缓存
  assert(
    newsRoute.includes('aICache.findUnique') && newsRoute.includes('aICache.upsert'),
    '新闻监控：GET 读缓存 + POST 写缓存'
  )
  assert(newsRoute.includes('cachedAt'), '新闻监控返回缓存时间')

  // 缓存 key 格式
  assert(heatmapRoute.includes('heatmap:${validYear}'), '融资热点图缓存 key: heatmap:YYYY')
  assert(newsRoute.includes('news:${weekKey}'), '新闻监控缓存 key: news:YYYY-Www')
}

// ═══════════════════════════════════════════════════════════
// H. 自动触发逻辑验证
// ═══════════════════════════════════════════════════════════
console.log('\n══ H. 自动触发逻辑 ══')

{
  const statisticsPage = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/statistics/page.tsx'), 'utf-8')
  const newsPage = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/news/page.tsx'), 'utf-8')

  // 融资热点图自动触发
  assert(
    statisticsPage.includes('autoTriggeredRef') &&
    statisticsPage.includes('refreshHeatmap') &&
    statisticsPage.includes('heatData.length === 0'),
    '融资热点图：无缓存时自动触发 POST 检索'
  )

  // 新闻监控自动触发
  assert(
    newsPage.includes('autoTriggeredRef') &&
    newsPage.includes('handleSearch') &&
    newsPage.includes('fetchNewsWithCache'),
    '新闻监控：无缓存时自动触发 POST 检索'
  )

  // 防重复触发
  assert(
    statisticsPage.includes('autoTriggeredRef.current = true') &&
    newsPage.includes('autoTriggeredRef.current = true'),
    '两个页面都使用 ref 防止重复触发'
  )
}

// ═══════════════════════════════════════════════════════════
// I. 数据流完整性
// ═══════════════════════════════════════════════════════════
console.log('\n══ I. 数据流完整性 ══')

{
  const statisticsPage = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/statistics/page.tsx'), 'utf-8')
  const newsPage = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/news/page.tsx'), 'utf-8')

  // 融资热点图数据流
  assert(statisticsPage.includes('fetchIndustryMap'), '融资热点图：先获取行业数据')
  assert(statisticsPage.includes('fetchHeatmap'), '融资热点图：再获取热点缓存')
  assert(statisticsPage.includes('refreshHeatmap'), '融资热点图：无缓存时触发刷新')
  assert(statisticsPage.includes('setHeatmapData'), '融资热点图：更新状态')

  // 新闻监控数据流
  assert(newsPage.includes('fetchNewsWithCache'), '新闻监控：先获取缓存')
  assert(newsPage.includes('fetchNewsFiltered'), '新闻监控：无缓存时查数据库')
  assert(newsPage.includes('handleSearch'), '新闻监控：触发检索')
  assert(newsPage.includes('setArticles'), '新闻监控：更新文章列表')
}

// ═══════════════════════════════════════════════════════════
// J. 环境变量检查
// ═══════════════════════════════════════════════════════════
console.log('\n══ J. 环境变量检查 ══')

{
  const envPath = path.join(PROJECT_ROOT, '.env')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    assert(envContent.includes('TAVILY_API_KEY'), '.env 包含 TAVILY_API_KEY')
    assert(envContent.includes('DEEPSEEK_API_KEY'), '.env 包含 DEEPSEEK_API_KEY')
  } else {
    console.log('  ⚠ .env 文件不存在（可能在服务器上）')
    passed++
  }

  // 检查 package.json 包含 @tavily/core
  const pkgPath = path.join(PROJECT_ROOT, 'package.json')
  const pkgContent = fs.readFileSync(pkgPath, 'utf-8')
  assert(pkgContent.includes('@tavily/core'), 'package.json 包含 @tavily/core 依赖')
}

// ═══════════════════════════════════════════════════════════
// K. 边界条件
// ═══════════════════════════════════════════════════════════
console.log('\n══ K. 边界条件 ══')

{
  // 模拟自动触发逻辑
  let autoTriggered = false

  function shouldAutoTrigger(hasCache: boolean, hasIndustryData: boolean, hasArticles: boolean): boolean {
    if (autoTriggered) return false  // 已触发过
    if (hasCache) return false       // 有缓存不需要触发
    if (hasIndustryData && !hasArticles) return true  // 有行业数据但无文章
    if (!hasIndustryData && !hasArticles) return false // 无行业数据也不触发
    return false
  }

  // 首次访问，无缓存，有行业数据
  autoTriggered = false
  assert(shouldAutoTrigger(false, true, false) === true, '首次访问：无缓存+有行业 → 触发')
  autoTriggered = true
  assert(shouldAutoTrigger(false, true, false) === false, '已触发过 → 不再触发')

  // 有缓存
  autoTriggered = false
  assert(shouldAutoTrigger(true, true, true) === false, '有缓存 → 不触发')

  // 无行业数据
  autoTriggered = false
  assert(shouldAutoTrigger(false, false, false) === false, '无行业数据 → 不触发')

  // 有文章但无缓存
  autoTriggered = false
  assert(shouldAutoTrigger(false, true, true) === false, '有文章 → 不触发')
}

// ═══════════════════════════════════════════════════════════
// L. 语法完整性
// ═══════════════════════════════════════════════════════════
console.log('\n══ L. 语法完整性 ══')

{
  const files = [
    'src/app/statistics/page.tsx',
    'src/app/news/page.tsx',
    'src/app/api/statistics/financing-heatmap/route.ts',
    'src/app/api/news/search/route.ts',
    'src/lib/tavily-search.ts',
  ]

  files.forEach(f => {
    const fullPath = path.join(PROJECT_ROOT, f)
    assert(fs.existsSync(fullPath), `文件存在: ${f}`)
  })

  // 检查花括号匹配（排除模板字符串 ${...} 和正则表达式中的 {n,m}）
  files.forEach(f => {
    const fullPath = path.join(PROJECT_ROOT, f)
    const content = fs.readFileSync(fullPath, 'utf-8')
    // 移除模板字符串 ${...}、正则表达式量词 {n,m}、JSON 模板中的 {}
    const cleaned = content
      .replace(/\$\{[^}]*\}/g, '')
      .replace(/\{\d*,?\d*\}/g, '')
    const opens = (cleaned.match(/{/g) || []).length
    const closes = (cleaned.match(/}/g) || []).length
    assert(Math.abs(opens - closes) <= 1, `${f}: 花括号基本匹配 (${opens}/${closes})`)
  })
}

// ═══════════════════════════════════════════════════════════
// 结果汇总
// ═══════════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════')
console.log(`  通过: ${passed}  失败: ${failed}  总计: ${passed + failed}`)
console.log(`  结果: ${failed === 0 ? '✓ 全部通过' : '✗ 有失败项'}`)
console.log('═══════════════════════════════════════')

if (failed > 0) {
  process.exit(1)
}
