/**
 * 测试脚本：新闻监控功能
 *
 * 测试覆盖：
 * 1. 新闻列表 API（GET /api/news）— 权限校验、筛选、数据结构
 * 2. 新闻详情 API（GET /api/news/[id]）— 权限校验、404
 * 3. 新闻搜索 API（POST /api/news/search）— DeepSeek 检索、数据存储
 * 4. 新闻监控页面可访问
 * 5. 源码验证（API 逻辑 + 页面组件 + 卡片样式）
 *
 * 运行: npx tsx scripts/test-news-monitoring.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { readFile } from 'fs/promises'

const BASE_URL = 'http://localhost:3000'
const prisma = new PrismaClient()

const ADMIN = { email: 'admin-test@example.com', password: 'admin123' }

interface TestResult { name: string; passed: boolean; detail?: string }
const results: TestResult[] = []
const createdArticleIds: string[] = []

function log(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail })
  console.log(`${passed ? '✓' : '✗'} ${name}${!passed && detail ? ` — ${detail}` : ''}`)
}

async function login(email: string, password: string): Promise<string> {
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`)
  const csrfData = await csrfRes.json()
  const csrfToken = csrfData.csrfToken
  const cookie = csrfRes.headers.get('set-cookie') || ''
  const csrfMatch = cookie.match(/next-auth\.csrf-token=([^;]+)/)
  const csrfCookie = csrfMatch ? `next-auth.csrf-token=${csrfMatch[1]}` : ''

  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrfCookie },
    body: new URLSearchParams({ email, password, csrfToken, callbackUrl: `${BASE_URL}/`, json: 'true' }),
    redirect: 'manual',
  })
  const setCookie = loginRes.headers.get('set-cookie') || ''
  const match = setCookie.match(/next-auth\.session-token=([^;]+)/)
  return match ? `next-auth.session-token=${match[1]}` : ''
}

async function apiCall(path: string, options: { method?: string; cookie?: string; body?: any } = {}): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.cookie ? { Cookie: options.cookie } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function main() {
  console.log('\n========================================')
  console.log('  新闻监控功能测试')
  console.log('========================================\n')

  // ── 组1：管理员登录 ──
  console.log('── 组1：管理员登录 ──')
  const adminCookie = await login(ADMIN.email, ADMIN.password).catch(() => '')
  log('管理员登录', !!adminCookie)

  // ── 组2：插入测试新闻数据 ──
  console.log('\n── 组2：插入测试新闻数据 ──')
  const now = new Date()
  const dayOfWeek = now.getDay()
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - daysSinceMonday)
  weekStart.setHours(12, 0, 0, 0)
  if (dayOfWeek === 1 && now.getHours() < 12) {
    weekStart.setDate(weekStart.getDate() - 7)
  }

  const testArticles = [
    { title: 'AI芯片公司融资10亿元', source: '36氪', industry: '人工智能', summary: '某AI芯片公司完成C轮融资10亿元', content: '某AI芯片公司今日宣布完成C轮融资，融资金额达10亿元人民币，由高瓴创投领投。', author: '张三', publishedAt: now },
    { title: '新能源车企获战略投资', source: '投资界', industry: '新能源', summary: '某新能源车企获得战略投资5亿元', content: '某新能源车企宣布获得战略投资5亿元，投资方为线性资本。', author: '李四', publishedAt: now },
    { title: '医疗器械公司完成B轮', source: '量子位', industry: '医疗器械', summary: '某医疗器械公司完成B轮融资', content: '某医疗器械公司完成B轮融资2亿元，将用于产品研发和市场推广。', author: null, publishedAt: now },
  ]

  for (const a of testArticles) {
    const created = await prisma.newsArticle.create({
      data: { ...a, sourceUrl: null, weekStart },
    })
    createdArticleIds.push(created.id)
  }
  log('插入 3 篇测试新闻', createdArticleIds.length === 3)

  // ════════════════════════════════════════
  // 组3-4：新闻列表 API
  // ════════════════════════════════════════
  console.log('\n── 组3：新闻列表 API - 基本返回 ──')

  const listRes = await apiCall('/api/news?week=current', { cookie: adminCookie })
  log('GET /api/news 返回 200', listRes.status === 200, `status=${listRes.status} err=${listRes.data.error}`)
  log('返回 articles 数组', Array.isArray(listRes.data.articles), `length=${listRes.data.articles?.length}`)
  log('返回 industries 数组', Array.isArray(listRes.data.industries))
  log('返回 sources 数组', Array.isArray(listRes.data.sources))
  log('返回 total 字段', typeof listRes.data.total === 'number', `total=${listRes.data.total}`)
  log('返回 weekStart 字段', !!listRes.data.weekStart)

  // 验证文章数据结构
  if (listRes.data.articles?.length > 0) {
    const sample = listRes.data.articles[0]
    log('文章对象有 id 字段', 'id' in sample)
    log('文章对象有 title 字段', 'title' in sample)
    log('文章对象有 source 字段', 'source' in sample)
    log('文章对象有 industry 字段', 'industry' in sample)
    log('文章对象有 summary 字段', 'summary' in sample)
    log('文章对象有 publishedAt 字段', 'publishedAt' in sample)
    log('文章对象有 author 字段', 'author' in sample)
    log('文章对象有 sourceUrl 字段', 'sourceUrl' in sample)
  }

  console.log('\n── 组4：新闻列表 API - 筛选 ──')

  // 4.1 按行业筛选
  const industryFilterRes = await apiCall('/api/news?week=current&industry=人工智能', { cookie: adminCookie })
  const industryArticles = industryFilterRes.data.articles || []
  log('按行业筛选返回正确结果', industryArticles.length > 0 && industryArticles.every((a: any) => a.industry === '人工智能'), `length=${industryArticles.length}`)

  // 4.2 按来源筛选
  const sourceFilterRes = await apiCall('/api/news?week=current&source=36氪', { cookie: adminCookie })
  const sourceArticles = sourceFilterRes.data.articles || []
  log('按来源筛选返回正确结果', sourceArticles.length > 0 && sourceArticles.every((a: any) => a.source === '36氪'), `length=${sourceArticles.length}`)

  // 4.3 获取全部新闻（不限于本周）
  const allNewsRes = await apiCall('/api/news?week=all', { cookie: adminCookie })
  log('week=all 返回全部新闻', Array.isArray(allNewsRes.data.articles) && allNewsRes.data.articles.length >= 3, `length=${allNewsRes.data.articles?.length}`)

  // 4.4 权限校验
  const noAuthRes = await apiCall('/api/news')
  log('未登录返回 401', noAuthRes.status === 401, `status=${noAuthRes.status}`)

  // ════════════════════════════════════════
  // 组5：新闻详情 API
  // ════════════════════════════════════════
  console.log('\n── 组5：新闻详情 API ──')

  const articleId = createdArticleIds[0]
  const detailRes = await apiCall(`/api/news/${articleId}`, { cookie: adminCookie })
  log('GET /api/news/[id] 返回 200', detailRes.status === 200, `status=${detailRes.status}`)
  log('返回 article 对象', !!detailRes.data.article)
  log('文章有 content 字段', !!detailRes.data.article?.content)
  log('文章有 title 字段', !!detailRes.data.article?.title)

  // 5.1 不存在的新闻
  const notFoundRes = await apiCall('/api/news/non-existent-id', { cookie: adminCookie })
  log('不存在的新闻返回 404', notFoundRes.status === 404, `status=${notFoundRes.status}`)

  // 5.2 权限校验
  const noAuthDetailRes = await apiCall(`/api/news/${articleId}`)
  log('未登录获取详情返回 401', noAuthDetailRes.status === 401, `status=${noAuthDetailRes.status}`)

  // ════════════════════════════════════════
  // 组6：新闻搜索 API
  // ════════════════════════════════════════
  console.log('\n── 组6：新闻搜索 API ──')

  const searchRes = await apiCall('/api/news/search', {
    method: 'POST',
    cookie: adminCookie,
    body: { year: new Date().getFullYear() },
  })

  // DeepSeek API 是外部依赖，可能失败
  const isDeepSeekError = searchRes.status === 502 || searchRes.data.error?.includes('DeepSeek')
  log('POST /api/news/search 返回 200 或 DeepSeek 外部错误', searchRes.status === 200 || isDeepSeekError, `status=${searchRes.status} err=${searchRes.data.error}`)

  if (searchRes.status === 200) {
    log('返回 articles 数组', Array.isArray(searchRes.data.articles), `length=${searchRes.data.articles?.length}`)
    log('返回 industries 数组', Array.isArray(searchRes.data.industries))
    log('返回 message 字段', !!searchRes.data.message)
    log('返回 weekStart 字段', !!searchRes.data.weekStart)

    // 如果有文章，验证数据结构
    if (searchRes.data.articles?.length > 0) {
      const sample = searchRes.data.articles[0]
      log('搜索结果有 title 字段', !!sample.title)
      log('搜索结果有 source 字段', !!sample.source)
      log('搜索结果有 industry 字段', !!sample.industry)
      log('搜索结果有 summary 字段', !!sample.summary)
      log('搜索结果有 content 字段', !!sample.content)
      log('搜索结果有 publishedAt 字段', !!sample.publishedAt)

      // 清理搜索 API 创建的文章
      if (sample.id && !createdArticleIds.includes(sample.id)) {
        createdArticleIds.push(sample.id)
      }
    }
  }

  // 6.1 权限校验
  const noAuthSearchRes = await apiCall('/api/news/search', { method: 'POST', body: {} })
  log('未登录搜索返回 401', noAuthSearchRes.status === 401, `status=${noAuthSearchRes.status}`)

  // ════════════════════════════════════════
  // 组7：新闻监控页面可访问
  // ════════════════════════════════════════
  console.log('\n── 组7：新闻监控页面可访问 ──')
  const pageRes = await fetch(`${BASE_URL}/news`, { headers: { Cookie: adminCookie } })
  log('GET /news 返回 200', pageRes.status === 200, `status=${pageRes.status}`)

  // ════════════════════════════════════════
  // 组8-11：源码验证
  // ════════════════════════════════════════
  console.log('\n── 组8：源码验证 - Prisma schema ──')
  const schemaContent = await readFile('./prisma/schema.prisma', 'utf-8')
  log('schema.prisma: 有 NewsArticle 模型', schemaContent.includes('model NewsArticle'))
  log('schema.prisma: NewsArticle 有 title 字段', schemaContent.includes('title') && schemaContent.includes('String   // 文章标题'))
  log('schema.prisma: NewsArticle 有 source 字段', /source\s+String\s+\/\/ 来源/.test(schemaContent))
  log('schema.prisma: NewsArticle 有 industry 字段', /industry\s+String\s+\/\/ 所属行业赛道/.test(schemaContent))
  log('schema.prisma: NewsArticle 有 summary 字段', /summary\s+String\s+\/\/ 摘要/.test(schemaContent))
  log('schema.prisma: NewsArticle 有 content 字段', /content\s+String\s+\/\/ 详细内容/.test(schemaContent))
  log('schema.prisma: NewsArticle 有 weekStart 字段', schemaContent.includes('weekStart   DateTime'))
  log('schema.prisma: NewsArticle 有 publishedAt 索引', schemaContent.includes('@@index([publishedAt])'))
  log('schema.prisma: NewsArticle 有 weekStart 索引', schemaContent.includes('@@index([weekStart])'))

  console.log('\n── 组9：源码验证 - 新闻列表 API ──')
  const listApiContent = await readFile('./src/app/api/news/route.ts', 'utf-8')
  log('api/news: 有 GET 方法', listApiContent.includes('export async function GET'))
  log('api/news: 支持 week=current 筛选', listApiContent.includes("week === 'current'"))
  log('api/news: 支持 week=all', listApiContent.includes("'all'"))
  log('api/news: 支持 industry 筛选', listApiContent.includes('industry'))
  log('api/news: 支持 source 筛选', listApiContent.includes('source'))
  log('api/news: 返回 industries 列表', listApiContent.includes('industriesSet'))
  log('api/news: 返回 sources 列表', listApiContent.includes('sourcesSet'))
  log('api/news: 权限校验', listApiContent.includes('未登录') && listApiContent.includes('401'))

  console.log('\n── 组10：源码验证 - 新闻搜索 API ──')
  const searchApiContent = await readFile('./src/app/api/news/search/route.ts', 'utf-8')
  log('api/news/search: 有 POST 方法', searchApiContent.includes('export async function POST'))
  log('api/news/search: 调用 DeepSeek API', searchApiContent.includes('api.deepseek.com'))
  log('api/news/search: 使用 DEEPSEEK_API_KEY', searchApiContent.includes('DEEPSEEK_API_KEY'))
  log('api/news/search: 关注 36氪', searchApiContent.includes('36氪'))
  log('api/news/search: 关注 投资界', searchApiContent.includes('投资界'))
  log('api/news/search: 关注 量子位', searchApiContent.includes('量子位'))
  log('api/news/search: 关注 智东西', searchApiContent.includes('智东西'))
  log('api/news/search: 关注 Founder Park', searchApiContent.includes('Founder Park'))
  log('api/news/search: 关注 高瓴创投', searchApiContent.includes('高瓴创投'))
  log('api/news/search: 关注 线性资本', searchApiContent.includes('线性资本'))
  log('api/news/search: 按行业检索融资新闻', searchApiContent.includes('融资新闻'))
  log('api/news/search: 结果存入 NewsArticle 表', searchApiContent.includes('prisma.newsArticle.create'))
  log('api/news/search: 计算本周起始时间', searchApiContent.includes('getWeekStart'))
  log('api/news/search: 权限校验', searchApiContent.includes('未登录') && searchApiContent.includes('401'))

  console.log('\n── 组11：源码验证 - 新闻详情 API ──')
  const detailApiContent = await readFile('./src/app/api/news/[id]/route.ts', 'utf-8')
  log('api/news/[id]: 有 GET 方法', detailApiContent.includes('export async function GET'))
  log('api/news/[id]: 返回 article 对象', detailApiContent.includes('article'))
  log('api/news/[id]: 不存在返回 404', detailApiContent.includes('404'))
  log('api/news/[id]: 权限校验', detailApiContent.includes('未登录') && detailApiContent.includes('401'))

  console.log('\n── 组12：源码验证 - 新闻监控页面 ──')
  const pageContent = await readFile('./src/app/news/page.tsx', 'utf-8')
  log('news/page: 使用 DashboardLayout', pageContent.includes('DashboardLayout'))
  log('news/page: 有检索按钮', pageContent.includes('检索本周融资新闻'))
  log('news/page: 调用 /api/news API', pageContent.includes('/api/news'))
  log('news/page: 调用 /api/news/search API', pageContent.includes('/api/news/search'))
  log('news/page: 有新闻卡片', pageContent.includes('rounded-2xl') && pageContent.includes('shadow-sm'))
  log('news/page: 卡片样式与项目线索一致（gradient-card + rounded-2xl）', pageContent.includes('bg-gradient-card'))
  log('news/page: 有行业筛选器', pageContent.includes('selectedIndustry'))
  log('news/page: 有来源筛选器', pageContent.includes('selectedSource'))
  log('news/page: 有详情弹窗', pageContent.includes('viewingArticle'))
  log('news/page: 点击卡片查看详情', pageContent.includes('handleViewDetail'))
  log('news/page: 详情弹窗有 content 字段', pageContent.includes('viewingArticle.content'))
  log('news/page: 有 loading 状态', pageContent.includes('loading'))
  log('news/page: 有 searching 状态', pageContent.includes('searching'))
  log('news/page: 有原文链接', pageContent.includes('sourceUrl'))
  log('news/page: 有来源标签', pageContent.includes('article.source'))
  log('news/page: 有行业标签', pageContent.includes('article.industry'))
  log('news/page: 有发布日期', pageContent.includes('publishedAt'))
  log('news/page: 有空状态提示', pageContent.includes('暂无融资新闻'))

  console.log('\n── 组13：源码验证 - DashboardLayout 导航 ──')
  const layoutContent = await readFile('./src/components/DashboardLayout.tsx', 'utf-8')
  log('DashboardLayout: 有新闻监控导航项', layoutContent.includes("label: '新闻监控'"))
  log('DashboardLayout: 导航链接指向 /news', layoutContent.includes("href: '/news'"))

  // ── 组14：清理 ──
  console.log('\n── 组14：清理测试数据 ──')
  for (const id of createdArticleIds) {
    try {
      await prisma.newsArticle.delete({ where: { id } })
      console.log(`  · 已删除新闻: ${id}`)
    } catch (e) {
      console.log(`  · 删除失败: ${id}`)
    }
  }

  // ── 结果汇总 ──
  console.log('\n' + '='.repeat(50))
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  console.log(`📊 测试结果: ${passed} 通过 / ${failed} 失败 / ${results.length} 总计`)
  console.log('='.repeat(50))

  if (failed > 0) {
    console.log('\n失败项：')
    results.filter(r => !r.passed).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    })
  }

  await prisma.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('❌ 测试脚本异常:', e)
  for (const id of createdArticleIds) {
    try { await prisma.newsArticle.delete({ where: { id } }) } catch {}
  }
  await prisma.$disconnect()
  process.exit(1)
})
