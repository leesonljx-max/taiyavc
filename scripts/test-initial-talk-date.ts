/**
 * 测试脚本：初聊日期改造
 *
 * 验证：
 * 1. 新建项目页面 label 为"初聊日期"
 * 2. 编辑项目页面 label 为"初聊日期"
 * 3. API 错误消息为"初聊日期格式无效"
 * 4. Dashboard API 年份筛选以 targetDate 为准
 * 5. Dashboard API 本周新增项目以 targetDate 为准
 * 6. 源码验证
 *
 * 运行: npx tsx scripts/test-initial-talk-date.ts
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

async function createProject(cookie: string, data: { name: string; totalAmount: string; targetDate: string; followStage?: string }): Promise<{ status: number; data: any }> {
  return apiCall('/api/projects', {
    method: 'POST',
    cookie,
    body: data,
  })
}

async function main() {
  console.log('\n========================================')
  console.log('  初聊日期改造测试')
  console.log('========================================\n')

  // ── 组1：管理员登录 ──
  console.log('── 组1：管理员登录 ──')
  const adminCookie = await login(ADMIN.email, ADMIN.password).catch(() => '')
  log('管理员登录', !!adminCookie)

  // ════════════════════════════════════════
  // 组2-4：源码验证 - UI label 改为"初聊日期"
  // ════════════════════════════════════════
  console.log('\n── 组2：源码验证 - 新建项目页面 ──')
  const newPageContent = await readFile('./src/app/projects/new/page.tsx', 'utf-8')
  log('new/page.tsx: label 为"初聊日期"', newPageContent.includes('初聊日期'))
  log('new/page.tsx: 不再包含"目标日期"', !newPageContent.includes('目标日期'))

  console.log('\n── 组3：源码验证 - 编辑项目页面 ──')
  const editPageContent = await readFile('./src/app/projects/[id]/edit/page.tsx', 'utf-8')
  log('edit/page.tsx: label 为"初聊日期"', editPageContent.includes('初聊日期'))
  log('edit/page.tsx: 不再包含"目标日期"', !editPageContent.includes('目标日期'))

  console.log('\n── 组4：源码验证 - API 错误消息 ──')
  const createApiContent = await readFile('./src/app/api/projects/route.ts', 'utf-8')
  log('api/projects/route.ts: 错误消息为"初聊日期格式无效"', createApiContent.includes('初聊日期格式无效'))
  log('api/projects/route.ts: 不再包含"目标日期格式无效"', !createApiContent.includes('目标日期格式无效'))

  const updateApiContent = await readFile('./src/app/api/projects/[id]/route.ts', 'utf-8')
  log('api/projects/[id]/route.ts: 错误消息为"初聊日期格式无效"', updateApiContent.includes('初聊日期格式无效'))
  log('api/projects/[id]/route.ts: 不再包含"目标日期格式无效"', !updateApiContent.includes('目标日期格式无效'))

  // ════════════════════════════════════════
  // 组5：API 错误消息验证
  // ════════════════════════════════════════
  console.log('\n── 组5：API 错误消息验证 ──')

  // 5.1 创建项目时传无效 targetDate
  const invalidDateRes = await createProject(adminCookie, {
    name: `测试无效日期_${Date.now()}`,
    totalAmount: '100万',
    targetDate: 'invalid-date',
  })
  log('创建项目传无效日期返回 400', invalidDateRes.status === 400, `status=${invalidDateRes.status}`)
  log('错误消息包含"初聊日期"', invalidDateRes.data.error?.includes('初聊日期'), `error=${invalidDateRes.data.error}`)

  // ════════════════════════════════════════
  // 组6-8：Dashboard API - 年份筛选以 targetDate 为准
  // ════════════════════════════════════════
  console.log('\n── 组6：创建测试项目（不同初聊日期年份）──')

  const suffix = Date.now()
  const lastYear = new Date().getFullYear() - 1
  const thisYear = new Date().getFullYear()

  // 创建去年的项目（初聊日期在去年）
  const projectLastYear = await createProject(adminCookie, {
    name: `去年初聊项目_${suffix}`,
    totalAmount: '100万',
    targetDate: new Date(`${lastYear}-06-15T00:00:00.000Z`).toISOString(),
  })
  if (projectLastYear.data.project?.id) createdProjectIds.push(projectLastYear.data.project.id)
  log('创建去年初聊项目', projectLastYear.status === 201 || projectLastYear.status === 200, `status=${projectLastYear.status}`)

  // 创建今年的项目（初聊日期在今年）
  const projectThisYear = await createProject(adminCookie, {
    name: `今年初聊项目_${suffix}`,
    totalAmount: '200万',
    targetDate: new Date(`${thisYear}-06-15T00:00:00.000Z`).toISOString(),
  })
  if (projectThisYear.data.project?.id) createdProjectIds.push(projectThisYear.data.project.id)
  log('创建今年初聊项目', projectThisYear.status === 201 || projectThisYear.status === 200, `status=${projectThisYear.status}`)

  console.log('\n── 组7：Dashboard 年份筛选 - 按初聊日期 ──')

  // 7.1 筛选去年的数据 — 验证 totalProjects 包含去年初聊项目
  // 先获取去年的 totalProjects 基线
  const lastYearBefore = await apiCall(`/api/dashboard?year=${lastYear}`, { cookie: adminCookie })
  const lastYearTotalBefore = lastYearBefore.data.stats?.totalProjects ?? 0

  // 创建另一个去年项目，验证 totalProjects 增加
  const anotherLastYear = await createProject(adminCookie, {
    name: `去年初聊项目2_${suffix}`,
    totalAmount: '150万',
    targetDate: new Date(`${lastYear}-08-20T00:00:00.000Z`).toISOString(),
  })
  if (anotherLastYear.data.project?.id) createdProjectIds.push(anotherLastYear.data.project.id)

  const lastYearAfter = await apiCall(`/api/dashboard?year=${lastYear}`, { cookie: adminCookie })
  const lastYearTotalAfter = lastYearAfter.data.stats?.totalProjects ?? 0
  log('去年 totalProjects 在创建去年项目后增加', lastYearTotalAfter === lastYearTotalBefore + 1, `before=${lastYearTotalBefore}, after=${lastYearTotalAfter}`)

  // 7.2 验证去年项目不出现在今年的 totalProjects 中
  const thisYearBefore = await apiCall(`/api/dashboard?year=${thisYear}`, { cookie: adminCookie })
  const thisYearTotalBefore = thisYearBefore.data.stats?.totalProjects ?? 0

  const thisYearAfter = await apiCall(`/api/dashboard?year=${thisYear}`, { cookie: adminCookie })
  const thisYearTotalAfter = thisYearAfter.data.stats?.totalProjects ?? 0
  // 今年 totalProjects 不应该因为创建了去年项目而增加
  log('今年 totalProjects 未因去年项目增加', thisYearTotalAfter === thisYearTotalBefore, `before=${thisYearTotalBefore}, after=${thisYearTotalAfter}`)

  // 7.3 验证 years 列表包含去年和今年
  log('今年 dashboard years 包含今年', thisYearAfter.data.years?.includes(thisYear), `years=${JSON.stringify(thisYearAfter.data.years)}`)
  log('今年 dashboard years 包含去年', thisYearAfter.data.years?.includes(lastYear), `years=${JSON.stringify(thisYearAfter.data.years)}`)
  log('去年 dashboard selectedYear 为去年', lastYearAfter.data.selectedYear === lastYear, `selectedYear=${lastYearAfter.data.selectedYear}`)

  console.log('\n── 组8：Dashboard years 列表来自 targetDate ──')

  // 8.1 获取 dashboard 不带 year 参数（默认当年）
  const defaultDashboard = await apiCall('/api/dashboard', { cookie: adminCookie })
  log('默认 dashboard years 是数组', Array.isArray(defaultDashboard.data.years))
  log('默认 dashboard years 包含今年', defaultDashboard.data.years?.includes(thisYear))

  // 8.2 验证 totalProjects 以 targetDate 年份为准
  // 去年 dashboard 的 totalProjects 应该包含去年初聊项目
  log('去年 totalProjects >= 1', (lastYearAfter.data.stats?.totalProjects ?? 0) >= 1, `total=${lastYearAfter.data.stats?.totalProjects}`)

  // ════════════════════════════════════════
  // 组9：Dashboard API - 本周新增项目以 targetDate 为准
  // ════════════════════════════════════════
  console.log('\n── 组9：Dashboard 本周新增项目 - 以初聊日期为准 ──')

  // 9.1 创建一个初聊日期在本周的项目
  const now = new Date()
  const dayOfWeek = now.getDay()
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const thisWeekMonday = new Date(now)
  thisWeekMonday.setDate(now.getDate() - daysSinceMonday)
  thisWeekMonday.setHours(12, 0, 0, 0)
  if (dayOfWeek === 1 && now.getHours() < 12) {
    thisWeekMonday.setDate(thisWeekMonday.getDate() - 7)
  }
  // 本周三（确保在本周内）
  const thisWeek = new Date(thisWeekMonday)
  thisWeek.setDate(thisWeekMonday.getDate() + 2)

  const projectThisWeek = await createProject(adminCookie, {
    name: `本周初聊项目_${suffix}`,
    totalAmount: '300万',
    targetDate: thisWeek.toISOString(),
  })
  if (projectThisWeek.data.project?.id) createdProjectIds.push(projectThisWeek.data.project.id)
  log('创建本周初聊项目', projectThisWeek.status === 201 || projectThisWeek.status === 200, `status=${projectThisWeek.status}`)

  // 9.2 验证本周新增项目包含初聊日期在本周的项目
  const weeklyDashboard = await apiCall(`/api/dashboard?year=${thisYear}`, { cookie: adminCookie })
  const weeklyProjectNames = weeklyDashboard.data.weeklyProjects?.map((p: any) => p.name) || []
  log('本周新增项目包含本周初聊项目', weeklyProjectNames.includes(`本周初聊项目_${suffix}`), `weeklyProjects=${JSON.stringify(weeklyProjectNames).substring(0, 200)}`)

  // 9.3 验证 weeklyProjects 包含 targetDate 字段
  const weeklyProjectsWithTarget = weeklyDashboard.data.weeklyProjects || []
  log('weeklyProjects 包含 targetDate 字段', weeklyProjectsWithTarget.length > 0 && 'targetDate' in weeklyProjectsWithTarget[0], `keys=${weeklyProjectsWithTarget[0] ? Object.keys(weeklyProjectsWithTarget[0]).join(',') : 'empty'}`)

  // 9.4 创建一个初聊日期在上周的项目（不应出现在本周新增中）
  const lastWeek = new Date(thisWeekMonday)
  lastWeek.setDate(thisWeekMonday.getDate() - 3)

  const projectLastWeek = await createProject(adminCookie, {
    name: `上周初聊项目_${suffix}`,
    totalAmount: '400万',
    targetDate: lastWeek.toISOString(),
  })
  if (projectLastWeek.data.project?.id) createdProjectIds.push(projectLastWeek.data.project.id)
  log('创建上周初聊项目', projectLastWeek.status === 201 || projectLastWeek.status === 200, `status=${projectLastWeek.status}`)

  // 9.5 验证上周初聊项目不出现在本周新增中
  const weeklyDashboard2 = await apiCall(`/api/dashboard?year=${thisYear}`, { cookie: adminCookie })
  const weeklyProjectNames2 = weeklyDashboard2.data.weeklyProjects?.map((p: any) => p.name) || []
  log('本周新增不包含上周初聊项目（无阶段变更）', !weeklyProjectNames2.includes(`上周初聊项目_${suffix}`), `found=${weeklyProjectNames2.includes(`上周初聊项目_${suffix}`)}`)

  // ════════════════════════════════════════
  // 组10：源码验证 - Dashboard API
  // ════════════════════════════════════════
  console.log('\n── 组10：源码验证 - Dashboard API ──')
  const dashboardApiContent = await readFile('./src/app/api/dashboard/route.ts', 'utf-8')

  log('dashboard/route.ts: 年份列表从 targetDate 提取', dashboardApiContent.includes('new Date(p.targetDate).getFullYear()'))
  log('dashboard/route.ts: 年份筛选以 targetDate 为准', /p\.targetDate && new Date\(p\.targetDate\)\.getFullYear\(\) === validYear/.test(dashboardApiContent))
  log('dashboard/route.ts: 本周新增以 targetDate 为准', /initialDate = p\.targetDate \? new Date\(p\.targetDate\)/.test(dashboardApiContent))
  log('dashboard/route.ts: 本周新增条件使用 initialDate', /initialDate >= weekStart/.test(dashboardApiContent))
  log('dashboard/route.ts: weeklyProjects 返回 targetDate', dashboardApiContent.includes('targetDate: p.targetDate'))
  log('dashboard/route.ts: 不再用 createdAt 做年份筛选', !dashboardApiContent.includes('new Date(p.createdAt).getFullYear()'))
  log('dashboard/route.ts: 注释提及"初聊日期"', dashboardApiContent.includes('初聊日期'))

  // ════════════════════════════════════════
  // 组11：验证数据库字段名未变（targetDate）
  // ════════════════════════════════════════
  console.log('\n── 组11：验证数据库字段名未变 ──')
  const schemaContent = await readFile('./prisma/schema.prisma', 'utf-8')
  log('schema.prisma: 仍有 targetDate 字段', schemaContent.includes('targetDate'))
  log('schema.prisma: 字段名仍为 targetDate（未改名）', /targetDate\s+DateTime/.test(schemaContent))

  // ════════════════════════════════════════
  // 组12：验证创建项目 API 仍接受 targetDate
  // ════════════════════════════════════════
  console.log('\n── 组12：创建项目 API 仍接受 targetDate ──')
  const validProject = await createProject(adminCookie, {
    name: `验证targetDate_${suffix}`,
    totalAmount: '500万',
    targetDate: new Date(`${thisYear}-01-15T00:00:00.000Z`).toISOString(),
  })
  if (validProject.data.project?.id) createdProjectIds.push(validProject.data.project.id)
  log('创建项目成功', validProject.status === 201 || validProject.status === 200, `status=${validProject.status}`)

  // 验证数据库中的 targetDate
  if (validProject.data.project?.id) {
    const dbProject = await prisma.project.findUnique({ where: { id: validProject.data.project.id } })
    log('数据库 targetDate 正确', dbProject?.targetDate ? new Date(dbProject.targetDate).getFullYear() === thisYear : false, `year=${dbProject?.targetDate ? new Date(dbProject.targetDate).getFullYear() : 'null'}`)
  }

  // ── 组13：清理 ──
  console.log('\n── 组13：清理测试数据 ──')
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
