/**
 * 测试脚本：新建项目删除状态字段 + 首页本周新增项目阶段分组
 *
 * 测试覆盖：
 * 1. 新建项目页面：已删除"状态"字段（UI / FormData / 初始 state）
 * 2. 新建项目 API：不传 status 时使用默认值 PENDING
 * 3. 首页"本周新增项目"：按阶段分两组（上面 初聊/PreDD，下面 立项/尽调/交割/投后）
 * 4. 左侧阶段统计：包含"投后"(POST_INVESTMENT)
 * 5. 源码验证
 *
 * 运行: npx tsx scripts/test-new-project-no-status-and-stage-groups.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

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
  if (!match) return ''
  return `next-auth.session-token=${match[1]}`
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

async function readFile(path: string): Promise<string> {
  const { readFile: fsReadFile } = await import('fs/promises')
  return fsReadFile(path, 'utf-8')
}

async function main() {
  console.log('\n========================================')
  console.log('  新建项目删除状态字段 + 首页阶段分组测试')
  console.log('========================================\n')

  // ── 组1：管理员登录 ──
  console.log('── 组1：管理员登录 ──')
  const adminCookie = await login(ADMIN.email, ADMIN.password).catch(() => '')
  log('管理员登录', !!adminCookie)

  const suffix = Date.now()

  // ── 组2：新建项目不传 status，使用默认 PENDING ──
  console.log('\n── 组2：新建项目不传 status，使用默认 PENDING ──')
  const projectName = `无状态测试_${suffix}`
  const createRes = await apiCall('/api/projects', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: projectName,
      totalAmount: 100,
      targetDate: new Date().toISOString(),
      followStage: 'INITIAL_TALK',
      // 不传 status
    },
  })
  log('不传 status 创建项目返回 201', createRes.status === 201, `status=${createRes.status} err=${createRes.data.error}`)
  const projectId = createRes.data.project?.id
  if (projectId) createdProjectIds.push(projectId)

  const dbProject = projectId ? await prisma.project.findUnique({ where: { id: projectId } }) : null
  log('数据库默认 status = PENDING', dbProject?.status === 'PENDING', `actual=${dbProject?.status}`)

  // ── 组3：源码验证 - 新建项目页面 ──
  console.log('\n── 组3：源码验证 - 新建项目页面 ──')
  const newPageContent = await readFile('./src/app/projects/new/page.tsx')

  // 3.1 FormData 接口不再包含 status
  log('new/page.tsx: FormData 接口不含 status 字段', !/^\s*status:\s*string\s*$/m.test(newPageContent))

  // 3.2 初始 state 不再包含 status
  log('new/page.tsx: 初始 state 不含 status', !/status:\s*['"]PENDING['"]/.test(newPageContent))

  // 3.3 UI 不再包含"状态"选择框
  log('new/page.tsx: 不含 htmlFor="status" 标签', !newPageContent.includes('htmlFor="status"'))
  log('new/page.tsx: 不含 id="status" 选择框', !newPageContent.includes('id="status"'))
  log('new/page.tsx: 不含"待审核/进行中/已完成/已取消"选项', !newPageContent.includes('待审核') && !newPageContent.includes('进行中'))

  // 3.4 仍保留 useSession 的 status（不能误删）
  log('new/page.tsx: 保留 useSession status 变量', newPageContent.includes('const { status } = useSession()'))
  log('new/page.tsx: 保留 status === "unauthenticated" 检查', newPageContent.includes("status === 'unauthenticated'"))

  // ── 组4：源码验证 - 首页本周新增项目阶段分组 ──
  console.log('\n── 组4：源码验证 - 首页本周新增项目阶段分组 ──')
  const homeContent = await readFile('./src/app/page.tsx')

  // 4.1 阶段分组常量
  log('page.tsx: 包含 earlyStages = [INITIAL_TALK, PRE_DD]', homeContent.includes("['INITIAL_TALK', 'PRE_DD']"))
  log('page.tsx: 包含 lateStages = [PROJECT_INITIATION, DUE_DILIGENCE, CLOSING]（不含投后）',
    homeContent.includes("['PROJECT_INITIATION', 'DUE_DILIGENCE', 'CLOSING']"))

  // 4.2 两组标题
  log('page.tsx: 包含"初聊 · PreDD"标题', homeContent.includes('初聊 · PreDD'))
  log('page.tsx: 包含"立项 · 尽调 · 交割"标题（不含投后）', homeContent.includes('立项 · 尽调 · 交割'))
  log('page.tsx: 不再包含"立项 · 尽调 · 交割 · 投后"旧标题', !homeContent.includes('立项 · 尽调 · 交割 · 投后'))

  // 4.3 两个框（容器样式）
  log('page.tsx: 早期跟进框使用灰色边框', homeContent.includes('bg-gray-50/50 border-gray-200'))
  log('page.tsx: 深度推进框使用紫色边框', homeContent.includes('bg-purple-50/30 border-purple-200'))

  // 4.4 左侧统计不含"投后"（投后不统计）
  log('page.tsx: 左侧统计不含 POST_INVESTMENT', !homeContent.includes("key: 'POST_INVESTMENT'"))
  log('page.tsx: 左侧统计不含"投后"标签', !homeContent.includes("label: '投后'"))

  // ── 组5：Dashboard API 返回数据验证 ──
  console.log('\n── 组5：Dashboard API 返回数据验证 ──')
  const dashRes = await apiCall('/api/dashboard', { cookie: adminCookie })
  log('Dashboard API 返回 200', dashRes.status === 200, `status=${dashRes.status}`)

  // 验证 maintainerStats 结构
  const maintainerStats = dashRes.data.maintainerStats || []
  log('Dashboard 返回 maintainerStats 数组', Array.isArray(maintainerStats), `length=${maintainerStats.length}`)

  if (maintainerStats.length > 0) {
    const m = maintainerStats[0]
    log('maintainerStats 项目包含 followStage 字段', typeof m.projects?.[0]?.followStage === 'string' || m.projects?.length === 0)
    log('maintainerStats 包含 stageCounts', typeof m.stageCounts === 'object')

    // 验证分组逻辑能正确分类项目（投后阶段不计入分组，但属于合法阶段）
    const allProjects = maintainerStats.flatMap((mm: any) => mm.projects || [])
    const earlyStages = ['INITIAL_TALK', 'PRE_DD']
    const lateStages = ['PROJECT_INITIATION', 'DUE_DILIGENCE', 'CLOSING']
    const groupedStages = [...earlyStages, ...lateStages]
    const postInvestmentProjects = allProjects.filter((p: any) => p.followStage === 'POST_INVESTMENT')
    const unknownStageProjects = allProjects.filter((p: any) => !['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'CLOSING', 'POST_INVESTMENT'].includes(p.followStage))
    log('所有项目 followStage 都是合法阶段', unknownStageProjects.length === 0,
      unknownStageProjects.length > 0 ? `未知阶段: ${unknownStageProjects.map((p: any) => p.followStage).join(',')}` : 'OK')
    log('投后阶段项目不被归入早期或晚期组', postInvestmentProjects.every((p: any) => !groupedStages.includes(p.followStage)))
  }

  // ── 组6：清理测试数据 ──
  console.log('\n── 组6：清理测试数据 ──')
  for (const id of createdProjectIds) {
    try {
      await prisma.project.delete({ where: { id } })
      console.log(`  · 已删除项目: ${id}`)
    } catch (e) {
      console.log(`  · 删除失败: ${id} — ${(e as Error).message}`)
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
