/**
 * 测试脚本：本周新增项目规则
 *
 * 规则：
 * 1. 本周新建的项目显示（createdAt >= weekStart）
 * 2. 本周变更阶段的项目显示（stageChangedAt >= weekStart）
 * 3. 每周一12:00为刷新点
 * 4. 维护人分组只显示有本周新增项目的维护人
 *
 * 测试覆盖：
 * 1. 测试账号验证
 * 2. getWeekStart 逻辑验证
 * 3. 本周新建项目显示
 * 4. 本周变更阶段的项目显示
 * 5. 非本周项目不显示
 * 6. 维护人分组只含本周新增项目
 * 7. dashboard API 源码验证
 * 8. 编辑 API 源码验证
 * 9. Prisma schema 验证
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const BASE_URL = 'http://localhost:3000'
const prisma = new PrismaClient()

const ACCOUNTS = {
  admin: { email: 'taiyavc@example.com', password: 'taiya2506' },
  manager: { email: 'manager-test@example.com', password: 'manager123' },
}

interface TestResult { name: string; passed: boolean; detail?: string }
const results: TestResult[] = []

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
  if (!match) throw new Error(`登录失败: ${email}`)
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

// 模拟 getWeekStart 逻辑
function getWeekStart(): Date {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysSinceMonday)
  monday.setHours(12, 0, 0, 0)
  if (dayOfWeek === 1 && now.getHours() < 12) {
    monday.setDate(monday.getDate() - 7)
  }
  return monday
}

async function main() {
  console.log('\n========================================')
  console.log('  本周新增项目规则测试')
  console.log('========================================\n')

  // ── 组1：测试账号验证 ──
  console.log('── 组1：测试账号验证 ──')
  const adminCookie = await login(ACCOUNTS.admin.email, ACCOUNTS.admin.password).catch(() => '')
  const managerCookie = await login(ACCOUNTS.manager.email, ACCOUNTS.manager.password).catch(() => '')
  log('管理员登录', !!adminCookie)
  log('投资经理登录', !!managerCookie)

  const managerUser = await prisma.user.findUnique({ where: { email: ACCOUNTS.manager.email } })
  const weekStart = getWeekStart()
  console.log(`本周起始时间（周一12:00）: ${weekStart.toISOString()}`)

  // ── 组2：getWeekStart 逻辑验证 ──
  console.log('\n── 组2：getWeekStart 逻辑验证 ──')
  log(
    'weekStart 是周一',
    weekStart.getDay() === 1,
    `day=${weekStart.getDay()}`
  )
  log(
    'weekStart 时间是 12:00:00',
    weekStart.getHours() === 12 && weekStart.getMinutes() === 0,
    `time=${weekStart.getHours()}:${weekStart.getMinutes()}`
  )
  log(
    'weekStart 在过去或现在',
    weekStart <= new Date()
  )

  // ── 组3：本周新建项目显示 ──
  console.log('\n── 组3：本周新建项目显示 ──')

  // 创建一个本周新项目
  const newProjectName = `本周新建测试_${Date.now()}`
  const createRes = await apiCall('/api/projects', {
    method: 'POST',
    cookie: managerCookie,
    body: {
      name: newProjectName,
      totalAmount: 100,
      targetDate: new Date().toISOString(),
      followStage: 'INITIAL_TALK',
    },
  })
  log('创建本周新项目成功', createRes.status === 201, `status=${createRes.status}`)
  const newProjectId = createRes.data.project?.id

  if (newProjectId) {
    // 调用 dashboard API 验证
    const dashRes = await apiCall('/api/dashboard?year=2026', { cookie: adminCookie })
    const weeklyProjectIds = dashRes.data.weeklyProjects?.map((p: any) => p.id) || []
    log(
      '本周新建项目出现在 weeklyProjects 中',
      weeklyProjectIds.includes(newProjectId),
      `weeklyProjects count=${weeklyProjectIds.length}`
    )

    // 验证维护人分组中包含该项目
    const maintainerStats = dashRes.data.maintainerStats || []
    const managerStat = maintainerStats.find((m: any) => m.userId === managerUser?.id)
    if (managerStat) {
      const projectInMaintainer = managerStat.projects.find((p: any) => p.id === newProjectId)
      log(
        '本周新建项目出现在维护人分组的项目列表中',
        !!projectInMaintainer,
        `projects count=${managerStat.projects.length}`
      )
    } else {
      log('维护人分组包含经理（有本周新增项目）', false, '经理不在 maintainerStats 中')
    }
  }

  // ── 组4：本周变更阶段的项目显示 ──
  console.log('\n── 组4：本周变更阶段的项目显示 ──')

  // 创建一个上周的项目（createdAt 在 weekStart 之前）
  const oldProjectName = `上周项目阶段变更测试_${Date.now()}`
  const oldProject = await prisma.project.create({
    data: {
      name: oldProjectName,
      totalAmount: 200,
      targetDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      createdById: managerUser!.id,
      protectionExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      passedStages: JSON.stringify(['INITIAL_TALK']),
      followStage: 'INITIAL_TALK',
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8天前创建
    },
  })
  log('创建上周项目（直接操作数据库）', !!oldProject)

  // 验证变更前不在 weeklyProjects 中
  const dashBefore = await apiCall('/api/dashboard?year=2026', { cookie: adminCookie })
  const weeklyBefore = dashBefore.data.weeklyProjects?.map((p: any) => p.id) || []
  log(
    '变更阶段前：上周项目不在 weeklyProjects 中',
    !weeklyBefore.includes(oldProject.id),
    `weeklyProjects count=${weeklyBefore.length}`
  )

  // 变更阶段（从 INITIAL_TALK → PRE_DD）
  const updateRes = await apiCall(`/api/projects/${oldProject.id}`, {
    method: 'PUT',
    cookie: managerCookie,
    body: { followStage: 'PRE_DD' },
  })
  log('变更阶段成功（INITIAL_TALK → PRE_DD）', updateRes.status === 200, `status=${updateRes.status}`)

  // 验证 stageChangedAt 已设置
  const updatedProject = await prisma.project.findUnique({ where: { id: oldProject.id } })
  log(
    'stageChangedAt 已设置（在本周内）',
    !!updatedProject?.stageChangedAt && new Date(updatedProject.stageChangedAt) >= weekStart,
    `stageChangedAt=${updatedProject?.stageChangedAt}`
  )

  // 验证变更后出现在 weeklyProjects 中
  const dashAfter = await apiCall('/api/dashboard?year=2026', { cookie: adminCookie })
  const weeklyAfter = dashAfter.data.weeklyProjects?.map((p: any) => p.id) || []
  log(
    '变更阶段后：上周项目出现在 weeklyProjects 中',
    weeklyAfter.includes(oldProject.id),
    `weeklyProjects count=${weeklyAfter.length}`
  )

  // 验证维护人分组中也包含该项目
  const maintainerAfter = dashAfter.data.maintainerStats || []
  const managerStatAfter = maintainerAfter.find((m: any) => m.userId === managerUser?.id)
  if (managerStatAfter) {
    const oldProjectInMaintainer = managerStatAfter.projects.find((p: any) => p.id === oldProject.id)
    log(
      '变更阶段后：上周项目出现在维护人分组中',
      !!oldProjectInMaintainer,
      `projects count=${managerStatAfter.projects.length}`
    )
  }

  // ── 组5：非本周项目不显示 ──
  console.log('\n── 组5：非本周项目不显示 ──')

  // 创建一个更早的项目，不变更阶段
  const veryOldProject = await prisma.project.create({
    data: {
      name: `很久以前项目_${Date.now()}`,
      totalAmount: 300,
      targetDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      createdById: managerUser!.id,
      protectionExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      passedStages: JSON.stringify(['INITIAL_TALK']),
      followStage: 'INITIAL_TALK',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30天前
      stageChangedAt: null, // 没有变更阶段
    },
  })

  const dashCheck = await apiCall('/api/dashboard?year=2026', { cookie: adminCookie })
  const weeklyCheck = dashCheck.data.weeklyProjects?.map((p: any) => p.id) || []
  log(
    '很久以前的项目（未变更阶段）不出现在 weeklyProjects 中',
    !weeklyCheck.includes(veryOldProject.id)
  )

  // ── 组6：清理测试项目 ──
  console.log('\n── 组6：清理测试项目 ──')
  if (newProjectId) {
    const del1 = await apiCall(`/api/projects/${newProjectId}`, { method: 'DELETE', cookie: managerCookie })
    log('清理本周新建测试项目', del1.status === 200)
  }
  if (oldProject) {
    await prisma.project.delete({ where: { id: oldProject.id } })
    log('清理上周项目', true)
  }
  if (veryOldProject) {
    await prisma.project.delete({ where: { id: veryOldProject.id } })
    log('清理很久以前项目', true)
  }

  // ── 组7：dashboard API 源码验证 ──
  console.log('\n── 组7：dashboard API 源码验证 ──')
  const dashContent = await readFile('src/app/api/dashboard/route.ts')

  log(
    'dashboard API 包含 stageChangedAt 检查',
    dashContent.includes('stageChangedAt') && dashContent.includes('weekStart')
  )
  log(
    'weeklyNewProjects 从 visibleProjects 筛选（不限于年份）',
    dashContent.includes('visibleProjects.filter') && dashContent.includes('stageChangedAt')
  )
  log(
    'weeklyNewProjects 逻辑：createdAt >= weekStart || stageChangedAt >= weekStart',
    dashContent.includes('createdAt >= weekStart') && dashContent.includes('stageChangedAt >= weekStart')
  )
  log(
    '维护人 projects 仅包含本周新增项目',
    dashContent.includes('for (const p of weeklyNewProjects)') && dashContent.includes('entry.projects.push')
  )
  log(
    '维护人分组过滤掉无本周新增项目的维护人',
    dashContent.includes('m.projects.length > 0')
  )
  log(
    'stageCounts 仍基于 yearFilteredProjects（累计统计）',
    dashContent.includes('for (const p of yearFilteredProjects)') && dashContent.includes('stageCounts')
  )
  log(
    'getWeekStart 周一12:00 逻辑',
    dashContent.includes('setHours(12, 0, 0, 0)') && dashContent.includes('dayOfWeek === 1')
  )

  // ── 组8：编辑 API 源码验证 ──
  console.log('\n── 组8：编辑 API 源码验证 ──')
  const editContent = await readFile('src/app/api/projects/[id]/route.ts')

  log(
    '编辑 API 阶段变更时设置 stageChangedAt',
    editContent.includes('data.stageChangedAt = new Date()')
  )
  log(
    '编辑 API 阶段变更检查（followStage !== project.followStage）',
    editContent.includes('data.followStage !== project.followStage')
  )

  // ── 组9：Prisma schema 验证 ──
  console.log('\n── 组9：Prisma schema 验证 ──')
  const schemaContent = await readFile('prisma/schema.prisma')

  log(
    'Project 模型包含 stageChangedAt 字段',
    schemaContent.includes('stageChangedAt DateTime?')
  )

  await prisma.$disconnect()

  // ── 汇总 ──
  console.log('\n========================================')
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  console.log(`  通过: ${passed}  失败: ${failed}  总计: ${results.length}`)
  console.log('========================================\n')

  if (failed > 0) {
    console.log('失败用例：')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    })
    process.exit(1)
  }
}

main().catch(e => {
  console.error('测试执行失败:', e)
  process.exit(1)
})
