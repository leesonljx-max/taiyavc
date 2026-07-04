/**
 * 测试脚本：统计分析功能（行业图谱 + 融资热点图）
 *
 * 测试覆盖：
 * 1. 行业图谱 API（按初聊日期年份筛选、按行业分组统计、权限校验）
 * 2. 融资热点图 API（DeepSeek 检索、数据结构、权限校验）
 * 3. 统计分析页面可访问
 * 4. 源码验证（API 逻辑 + 页面组件）
 *
 * 运行: npx tsx scripts/test-statistics.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { readFile } from 'fs/promises'

const BASE_URL = 'http://localhost:3000'
const prisma = new PrismaClient()

const ADMIN = { email: 'admin-test@example.com', password: 'admin123' }

interface TestResult { name: string; passed: boolean; detail?: string }
const results: TestResult[] = []
const createdProjectIds: string[] = []

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

async function createProject(cookie: string, data: { name: string; totalAmount: string; targetDate: string; industry?: string; followStage?: string }): Promise<{ status: number; data: any }> {
  return apiCall('/api/projects', { method: 'POST', cookie, body: data })
}

async function main() {
  console.log('\n========================================')
  console.log('  统计分析功能测试（行业图谱 + 融资热点图）')
  console.log('========================================\n')

  // ── 组1：管理员登录 ──
  console.log('── 组1：管理员登录 ──')
  const adminCookie = await login(ADMIN.email, ADMIN.password).catch(() => '')
  log('管理员登录', !!adminCookie)

  // ── 组2：创建测试项目 ──
  console.log('\n── 组2：创建测试项目（不同行业）──')
  const suffix = Date.now()
  const thisYear = new Date().getFullYear()
  const lastYear = thisYear - 1

  // 创建3个不同行业的今年项目
  const industries = ['人工智能', '新能源', '医疗器械']
  for (const ind of industries) {
    const res = await createProject(adminCookie, {
      name: `统计测试_${ind}_${suffix}`,
      totalAmount: '500万',
      targetDate: new Date(`${thisYear}-03-15T00:00:00.000Z`).toISOString(),
      industry: ind,
    })
    if (res.data.project?.id) createdProjectIds.push(res.data.project.id)
    log(`创建 ${ind} 项目`, res.status === 201 || res.status === 200, `status=${res.status}`)
  }

  // 创建1个去年的项目
  const lastYearRes = await createProject(adminCookie, {
    name: `统计测试_去年_${suffix}`,
    totalAmount: '300万',
    targetDate: new Date(`${lastYear}-05-10T00:00:00.000Z`).toISOString(),
    industry: '人工智能',
  })
  if (lastYearRes.data.project?.id) createdProjectIds.push(lastYearRes.data.project.id)
  log('创建去年项目', lastYearRes.status === 201 || lastYearRes.status === 200, `status=${lastYearRes.status}`)

  // 创建1个无行业的项目（应归入"未分类"）
  const noIndustryRes = await createProject(adminCookie, {
    name: `统计测试_无行业_${suffix}`,
    totalAmount: '100万',
    targetDate: new Date(`${thisYear}-04-20T00:00:00.000Z`).toISOString(),
  })
  if (noIndustryRes.data.project?.id) createdProjectIds.push(noIndustryRes.data.project.id)
  log('创建无行业项目', noIndustryRes.status === 201 || noIndustryRes.status === 200, `status=${noIndustryRes.status}`)

  // ════════════════════════════════════════
  // 组3-6：行业图谱 API 测试
  // ════════════════════════════════════════
  console.log('\n── 组3：行业图谱 API - 基本返回 ──')

  const mapRes = await apiCall(`/api/statistics/industry-map?year=${thisYear}`, { cookie: adminCookie })
  log('GET /api/statistics/industry-map 返回 200', mapRes.status === 200, `status=${mapRes.status} err=${mapRes.data.error}`)
  log('返回 year 字段', mapRes.data.year === thisYear, `year=${mapRes.data.year}`)
  log('返回 years 数组', Array.isArray(mapRes.data.years), `years=${JSON.stringify(mapRes.data.years)}`)
  log('返回 totalProjects', typeof mapRes.data.totalProjects === 'number', `totalProjects=${mapRes.data.totalProjects}`)
  log('返回 totalIndustries', typeof mapRes.data.totalIndustries === 'number', `totalIndustries=${mapRes.data.totalIndustries}`)
  log('返回 industries 数组', Array.isArray(mapRes.data.industries), `industries.length=${mapRes.data.industries?.length}`)

  console.log('\n── 组4：行业图谱 API - 行业分组统计 ──')

  const industryNames = mapRes.data.industries?.map((i: any) => i.industry) || []
  log('包含"人工智能"行业', industryNames.includes('人工智能'), `industries=${JSON.stringify(industryNames)}`)
  log('包含"新能源"行业', industryNames.includes('新能源'))
  log('包含"医疗器械"行业', industryNames.includes('医疗器械'))
  log('包含"未分类"（无行业项目）', industryNames.includes('未分类'))

  // 验证每个行业对象的结构
  const sampleIndustry = mapRes.data.industries?.[0]
  if (sampleIndustry) {
    log('行业对象有 industry 字段', 'industry' in sampleIndustry)
    log('行业对象有 count 字段', 'count' in sampleIndustry)
    log('行业对象有 projects 数组', Array.isArray(sampleIndustry.projects))
    log('项目对象有 name 字段', sampleIndustry.projects?.[0] && 'name' in sampleIndustry.projects[0])
    log('项目对象有 followStage 字段', sampleIndustry.projects?.[0] && 'followStage' in sampleIndustry.projects[0])
    log('项目对象有 financingRound 字段', sampleIndustry.projects?.[0] && 'financingRound' in sampleIndustry.projects[0])
  }

  // 验证按数量降序排序
  const counts = mapRes.data.industries?.map((i: any) => i.count) || []
  const isSorted = counts.every((c: number, i: number) => i === 0 || counts[i - 1] >= c)
  log('行业按项目数量降序排序', isSorted, `counts=${JSON.stringify(counts)}`)

  console.log('\n── 组5：行业图谱 API - 年份筛选 ──')

  // 去年的项目
  const lastYearMapRes = await apiCall(`/api/statistics/industry-map?year=${lastYear}`, { cookie: adminCookie })
  const lastYearIndustries = lastYearMapRes.data.industries?.map((i: any) => i.industry) || []
  log('去年包含"人工智能"行业', lastYearIndustries.includes('人工智能'), `industries=${JSON.stringify(lastYearIndustries)}`)
  // 去年不应该包含今年才创建的新能源和医疗器械项目
  // 注意：可能有其他历史项目，所以只验证我们创建的测试项目不在去年
  const lastYearProjectNames = lastYearMapRes.data.industries?.flatMap((i: any) => i.projects.map((p: any) => p.name)) || []
  log('去年不包含今年的测试项目', !lastYearProjectNames.some((n: string) => n.includes(`新能源_${suffix}`) || n.includes(`医疗器械_${suffix}`)))

  // 默认年份（不传 year 参数）
  const defaultMapRes = await apiCall('/api/statistics/industry-map', { cookie: adminCookie })
  log('不传 year 默认当年', defaultMapRes.data.year === thisYear, `year=${defaultMapRes.data.year}`)

  console.log('\n── 组6：行业图谱 API - 权限校验 ──')

  // 6.1 未登录
  const noAuthMapRes = await apiCall('/api/statistics/industry-map')
  log('未登录返回 401', noAuthMapRes.status === 401, `status=${noAuthMapRes.status}`)

  // ════════════════════════════════════════
  // 组7-8：融资热点图 API 测试
  // ════════════════════════════════════════
  console.log('\n── 组7：融资热点图 API - 基本返回 ──')

  const heatRes = await apiCall(`/api/statistics/financing-heatmap?year=${thisYear}`, { cookie: adminCookie })
  // DeepSeek API 是外部依赖，可能因网络问题返回 502，属于正常情况
  const isDeepSeekError = heatRes.status === 502 || heatRes.data.error?.includes('DeepSeek')
  log('GET /api/statistics/financing-heatmap 返回 200 或 DeepSeek 外部错误', heatRes.status === 200 || isDeepSeekError, `status=${heatRes.status} err=${heatRes.data.error}`)

  if (heatRes.status === 200) {
    log('返回 year 字段', heatRes.data.year === thisYear, `year=${heatRes.data.year}`)
    log('返回 years 数组', Array.isArray(heatRes.data.years))
    log('返回 heatData 数组', Array.isArray(heatRes.data.heatData), `heatData.length=${heatRes.data.heatData?.length}`)

    // 验证 heatData 数据结构
    if (heatRes.data.heatData?.length > 0) {
      const sampleHeat = heatRes.data.heatData[0]
      log('热度对象有 industry 字段', 'industry' in sampleHeat)
      log('热度对象有 financingCount 字段', 'financingCount' in sampleHeat)
      log('热度对象有 totalAmount 字段', 'totalAmount' in sampleHeat)
      log('热度对象有 heatLevel 字段', 'heatLevel' in sampleHeat)
      log('热度对象有 notableCompanies 字段', 'notableCompanies' in sampleHeat)
      log('热度对象有 summary 字段', 'summary' in sampleHeat)
      log('heatLevel 在 0-5 范围内', sampleHeat.heatLevel >= 0 && sampleHeat.heatLevel <= 5, `heatLevel=${sampleHeat.heatLevel}`)
    }

    // 验证包含所有行业
    const heatIndustries = heatRes.data.heatData?.map((h: any) => h.industry) || []
    log('heatData 包含"人工智能"', heatIndustries.includes('人工智能'), `industries=${JSON.stringify(heatIndustries)}`)
    log('heatData 包含"新能源"', heatIndustries.includes('新能源'))
    log('heatData 包含"医疗器械"', heatIndustries.includes('医疗器械'))

    // 验证按热度降序排序
    const heatLevels = heatRes.data.heatData?.map((h: any) => h.heatLevel) || []
    const heatSorted = heatLevels.every((l: number, i: number) => i === 0 || heatLevels[i - 1] >= l)
    log('heatData 按热度降序排序', heatSorted, `levels=${JSON.stringify(heatLevels)}`)
  } else if (heatRes.data.error?.includes('DeepSeek')) {
    log('DeepSeek API Key 未配置（跳过数据结构验证）', true, `error=${heatRes.data.error}`)
  }

  console.log('\n── 组8：融资热点图 API - 权限校验 ──')

  // 8.1 未登录
  const noAuthHeatRes = await apiCall('/api/statistics/financing-heatmap')
  log('未登录返回 401', noAuthHeatRes.status === 401, `status=${noAuthHeatRes.status}`)

  // 8.2 无行业的年份（返回空数据或 message）
  const emptyYearRes = await apiCall('/api/statistics/financing-heatmap?year=2099', { cookie: adminCookie })
  log('无数据年份返回 200', emptyYearRes.status === 200, `status=${emptyYearRes.status}`)
  log('无数据年份 heatData 为空数组', Array.isArray(emptyYearRes.data.heatData) && emptyYearRes.data.heatData.length === 0, `heatData=${JSON.stringify(emptyYearRes.data.heatData)}`)

  // ════════════════════════════════════════
  // 组9：统计分析页面可访问
  // ════════════════════════════════════════
  console.log('\n── 组9：统计分析页面可访问 ──')

  const pageRes = await fetch(`${BASE_URL}/statistics`, {
    headers: { Cookie: adminCookie },
  })
  log('GET /statistics 返回 200', pageRes.status === 200, `status=${pageRes.status}`)

  // ════════════════════════════════════════
  // 组10-13：源码验证
  // ════════════════════════════════════════
  console.log('\n── 组10：源码验证 - 行业图谱 API ──')
  const industryApiContent = await readFile('./src/app/api/statistics/industry-map/route.ts', 'utf-8')
  log('industry-map: 有 GET 方法', industryApiContent.includes('export async function GET'))
  log('industry-map: 按 targetDate 年份筛选', industryApiContent.includes('new Date(p.targetDate).getFullYear()'))
  log('industry-map: 按 industry 分组', industryApiContent.includes('p.industry'))
  log('industry-map: 空行业归入"未分类"', industryApiContent.includes('未分类'))
  log('industry-map: 按数量降序排序', industryApiContent.includes('b.count - a.count'))
  log('industry-map: 权限校验 canViewProject', industryApiContent.includes('canViewProject'))
  log('industry-map: 返回 years 列表', industryApiContent.includes('yearsSet'))
  log('industry-map: 未登录返回 401', industryApiContent.includes("{ error: '未登录' }"))

  console.log('\n── 组11：源码验证 - 融资热点图 API ──')
  const heatApiContent = await readFile('./src/app/api/statistics/financing-heatmap/route.ts', 'utf-8')
  log('financing-heatmap: 有 GET 方法', heatApiContent.includes('export async function GET'))
  log('financing-heatmap: 调用 DeepSeek API', heatApiContent.includes('api.deepseek.com'))
  log('financing-heatmap: 使用 DEEPSEEK_API_KEY', heatApiContent.includes('DEEPSEEK_API_KEY'))
  log('financing-heatmap: 按行业检索融资信息', heatApiContent.includes('financingCount'))
  log('financing-heatmap: 有热度等级 heatLevel', heatApiContent.includes('heatLevel'))
  log('financing-heatmap: 有代表公司 notableCompanies', heatApiContent.includes('notableCompanies'))
  log('financing-heatmap: 按热度降序排序', heatApiContent.includes('b.heatLevel - a.heatLevel'))
  log('financing-heatmap: 权限校验 canViewProject', heatApiContent.includes('canViewProject'))
  log('financing-heatmap: API Key 未配置返回 500', heatApiContent.includes('DeepSeek API Key 未配置'))
  log('financing-heatmap: 无行业数据返回空数组', heatApiContent.includes('heatData: []'))
  log('financing-heatmap: 补充遗漏行业', heatApiContent.includes('returnedIndustries'))

  console.log('\n── 组12：源码验证 - 统计分析页面 ──')
  const pageContent = await readFile('./src/app/statistics/page.tsx', 'utf-8')
  log('statistics/page: 使用 DashboardLayout', pageContent.includes('DashboardLayout'))
  log('statistics/page: 有年份选择器', pageContent.includes('selectedYear'))
  log('statistics/page: 有行业图谱模块（标题）', pageContent.includes('行业图谱'))
  log('statistics/page: 有融资热点图模块（标题）', pageContent.includes('融资热点图'))
  log('statistics/page: 有气泡图渲染', pageContent.includes('getBubbleSize'))
  log('statistics/page: 气泡可点击查看项目列表', pageContent.includes('setSelectedIndustry'))
  log('statistics/page: 有热度颜色映射', pageContent.includes('heatColors'))
  log('statistics/page: 有检索融资信息按钮', pageContent.includes('检索融资信息'))
  log('statistics/page: 调用 industry-map API', pageContent.includes('/api/statistics/industry-map'))
  log('statistics/page: 调用 financing-heatmap API', pageContent.includes('/api/statistics/financing-heatmap'))
  log('statistics/page: 有热度图例', pageContent.includes('热度'))
  log('statistics/page: 有 loading 状态', pageContent.includes('heatmapLoading'))

  console.log('\n── 组13：源码验证 - DashboardLayout 导航 ──')
  const layoutContent = await readFile('./src/components/DashboardLayout.tsx', 'utf-8')
  log('DashboardLayout: 有统计分析导航项', layoutContent.includes("label: '统计分析'"))
  log('DashboardLayout: 导航链接指向 /statistics', layoutContent.includes("href: '/statistics'"))

  // ── 组14：清理 ──
  console.log('\n── 组14：清理测试数据 ──')
  for (const id of createdProjectIds) {
    try {
      await prisma.project.delete({ where: { id } })
      console.log(`  · 已删除项目: ${id}`)
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
  for (const id of createdProjectIds) {
    try { await prisma.project.delete({ where: { id } }) } catch {}
  }
  await prisma.$disconnect()
  process.exit(1)
})
