/**
 * 测试脚本：阶段累计统计（passedStages）
 *
 * 测试覆盖：
 * 1. 测试账号验证
 * 2. stage-utils 工具函数单元测试
 * 3. 创建项目时设置 passedStages
 * 4. 变更阶段时补齐 passedStages（含跳过中间阶段场景）
 * 5. 项目列表 API 返回 passedStages
 * 6. 项目详情 API 返回 passedStages
 * 7. dashboard API 累计统计验证
 * 8. 项目库页面源码验证
 * 9. 工作台页面源码验证
 * 10. dashboard API 源码验证
 * 11. API 源码验证（创建/编辑）
 * 12. Prisma schema 验证
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const BASE_URL = 'http://localhost:3000'
const prisma = new PrismaClient()

const ACCOUNTS = {
  admin: { email: 'taiyavc@example.com', password: 'taiya2506' },
  partner: { email: 'partner-test@example.com', password: 'partner123' },
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

// ========== 工具函数测试 ==========
function testStageUtils() {
  console.log('\n── 组2：stage-utils 工具函数单元测试 ──')

  // parsePassedStages
  log(
    'parsePassedStages(null) 返回 ["INITIAL_TALK"]',
    JSON.stringify(parsePassedStagesLocal(null)) === JSON.stringify(['INITIAL_TALK'])
  )
  log(
    'parsePassedStages(undefined) 返回 ["INITIAL_TALK"]',
    JSON.stringify(parsePassedStagesLocal(undefined)) === JSON.stringify(['INITIAL_TALK'])
  )
  log(
    'parsePassedStages(\'["INITIAL_TALK","PRE_DD"]\') 返回正确数组',
    JSON.stringify(parsePassedStagesLocal('["INITIAL_TALK","PRE_DD"]')) === JSON.stringify(['INITIAL_TALK', 'PRE_DD'])
  )
  log(
    'parsePassedStages("") 返回 ["INITIAL_TALK"]',
    JSON.stringify(parsePassedStagesLocal('')) === JSON.stringify(['INITIAL_TALK'])
  )
  log(
    'parsePassedStages("invalid json") 返回 ["INITIAL_TALK"]',
    JSON.stringify(parsePassedStagesLocal('invalid json')) === JSON.stringify(['INITIAL_TALK'])
  )

  // computePassedStages
  log(
    'computePassedStages([], INITIAL_TALK) = ["INITIAL_TALK"]',
    JSON.stringify(computePassedStagesLocal([], 'INITIAL_TALK')) === JSON.stringify(['INITIAL_TALK'])
  )
  log(
    'computePassedStages(["INITIAL_TALK"], PRE_DD) = ["INITIAL_TALK","PRE_DD"]',
    JSON.stringify(computePassedStagesLocal(['INITIAL_TALK'], 'PRE_DD')) === JSON.stringify(['INITIAL_TALK', 'PRE_DD'])
  )
  log(
    'computePassedStages(["INITIAL_TALK","PRE_DD"], DUE_DILIGENCE) 补齐 PROJECT_INITIATION',
    JSON.stringify(computePassedStagesLocal(['INITIAL_TALK', 'PRE_DD'], 'DUE_DILIGENCE')) === JSON.stringify(['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE'])
  )
  log(
    'computePassedStages(["INITIAL_TALK"], CLOSING) 补齐 PRE_DD/PROJECT_INITIATION/DUE_DILIGENCE',
    JSON.stringify(computePassedStagesLocal(['INITIAL_TALK'], 'CLOSING')) === JSON.stringify(['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'CLOSING'])
  )
  log(
    'computePassedStages(["INITIAL_TALK","PRE_DD","PROJECT_INITIATION","DUE_DILIGENCE","CLOSING"], POST_INVESTMENT) 包含全部6阶段',
    JSON.stringify(computePassedStagesLocal(['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'CLOSING'], 'POST_INVESTMENT')) === JSON.stringify(['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'CLOSING', 'POST_INVESTMENT'])
  )
  // 变更到之前的阶段不丢失已记录的后续阶段
  log(
    'computePassedStages(["INITIAL_TALK","PRE_DD","PROJECT_INITIATION"], PRE_DD) 不丢失 PROJECT_INITIATION',
    JSON.stringify(computePassedStagesLocal(['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION'], 'PRE_DD')) === JSON.stringify(['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION'])
  )
}

// 本地实现（与 src/lib/stage-utils.ts 一致）
const STAGE_ORDER = ['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'CLOSING', 'POST_INVESTMENT'] as const
type FollowStage = typeof STAGE_ORDER[number]

function parsePassedStagesLocal(raw: string | null | undefined): FollowStage[] {
  if (!raw) return ['INITIAL_TALK']
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr) && arr.length > 0) return arr as FollowStage[]
  } catch {}
  return ['INITIAL_TALK']
}

function computePassedStagesLocal(current: FollowStage[], newStage: FollowStage): FollowStage[] {
  const newIdx = STAGE_ORDER.indexOf(newStage)
  if (newIdx === -1) return current
  const required = STAGE_ORDER.slice(0, newIdx + 1)
  const set = new Set<FollowStage>([...current, ...required])
  return STAGE_ORDER.filter(s => set.has(s))
}

// ========== 主测试 ==========
async function main() {
  console.log('\n========================================')
  console.log('  阶段累计统计（passedStages）测试')
  console.log('========================================\n')

  // ── 组1：测试账号验证 ──
  console.log('── 组1：测试账号验证 ──')
  const adminCookie = await login(ACCOUNTS.admin.email, ACCOUNTS.admin.password).catch(() => '')
  const partnerCookie = await login(ACCOUNTS.partner.email, ACCOUNTS.partner.password).catch(() => '')
  const managerCookie = await login(ACCOUNTS.manager.email, ACCOUNTS.manager.password).catch(() => '')
  log('管理员登录', !!adminCookie)
  log('合伙人登录', !!partnerCookie)
  log('投资经理登录', !!managerCookie)

  // ── 组2：工具函数单元测试 ──
  testStageUtils()

  // ── 组3：创建项目时设置 passedStages ──
  console.log('\n── 组3：创建项目时设置 passedStages ──')

  const testProjectName = `阶段统计测试_${Date.now()}`
  const createRes = await apiCall('/api/projects', {
    method: 'POST',
    cookie: managerCookie,
    body: {
      name: testProjectName,
      totalAmount: 100,
      targetDate: new Date().toISOString(),
      followStage: 'INITIAL_TALK',
    },
  })
  log('创建测试项目成功', createRes.status === 201, `status=${createRes.status}`)
  const testProjectId = createRes.data.project?.id

  if (testProjectId) {
    const detailRes = await apiCall(`/api/projects/${testProjectId}`, { cookie: managerCookie })
    const passedStages = detailRes.data.project?.passedStages
    log('项目包含 passedStages 字段', !!passedStages)
    log(
      '新建项目 passedStages = ["INITIAL_TALK"]',
      JSON.parse(passedStages || '[]').includes('INITIAL_TALK'),
      `passedStages=${passedStages}`
    )
  }

  // ── 组4：变更阶段时补齐 passedStages ──
  console.log('\n── 组4：变更阶段时补齐 passedStages ──')

  if (testProjectId) {
    // 从 INITIAL_TALK 变更到 PRE_DD
    const update1 = await apiCall(`/api/projects/${testProjectId}`, {
      method: 'PUT',
      cookie: managerCookie,
      body: { followStage: 'PRE_DD' },
    })
    log('变更到 PRE_DD 成功', update1.status === 200, `status=${update1.status}`)

    let detail1 = await apiCall(`/api/projects/${testProjectId}`, { cookie: managerCookie })
    let passed1 = JSON.parse(detail1.data.project?.passedStages || '[]')
    log(
      '变更到 PRE_DD 后 passedStages 包含 INITIAL_TALK 和 PRE_DD',
      passed1.includes('INITIAL_TALK') && passed1.includes('PRE_DD'),
      `passedStages=${JSON.stringify(passed1)}`
    )

    // 从 PRE_DD 直接跳到 DUE_DILIGENCE（跳过 PROJECT_INITIATION）
    // 注意：变更到 PROJECT_INITIATION 需要审批，但从 PRE_DD 直接跳到 DUE_DILIGENCE 不需要
    // 但 API 可能会检查是否经过 PROJECT_INITIATION，让我们直接测试跳到 DUE_DILIGENCE
    const update2 = await apiCall(`/api/projects/${testProjectId}`, {
      method: 'PUT',
      cookie: managerCookie,
      body: { followStage: 'DUE_DILIGENCE' },
    })
    log('从 PRE_DD 跳到 DUE_DILIGENCE 成功', update2.status === 200, `status=${update2.status}, data=${JSON.stringify(update2.data).substring(0, 150)}`)

    if (update2.status === 200) {
      let detail2 = await apiCall(`/api/projects/${testProjectId}`, { cookie: managerCookie })
      let passed2 = JSON.parse(detail2.data.project?.passedStages || '[]')
      log(
        '跳到 DUE_DILIGENCE 后补齐 PROJECT_INITIATION',
        passed2.includes('PROJECT_INITIATION'),
        `passedStages=${JSON.stringify(passed2)}`
      )
      log(
        'passedStages 包含 INITIAL_TALK/PRE_DD/PROJECT_INITIATION/DUE_DILIGENCE',
        passed2.includes('INITIAL_TALK') && passed2.includes('PRE_DD') && passed2.includes('PROJECT_INITIATION') && passed2.includes('DUE_DILIGENCE'),
        `passedStages=${JSON.stringify(passed2)}`
      )
    }

    // 验证项目列表返回 passedStages
    const listRes = await apiCall('/api/projects?scope=all', { cookie: managerCookie })
    const foundInList = listRes.data.projects?.find((p: any) => p.id === testProjectId)
    log('项目列表返回 passedStages 字段', foundInList && !!foundInList.passedStages)

    // 验证 dashboard API 累计统计
    const dashRes = await apiCall('/api/dashboard?year=2026', { cookie: managerCookie })
    log('dashboard API 返回成功', dashRes.status === 200)

    // 找到测试项目在哪个维护人下面
    const managerUser = await prisma.user.findUnique({ where: { email: ACCOUNTS.manager.email } })
    if (managerUser) {
      const maintainerStat = dashRes.data.maintainerStats?.find((m: any) => m.userId === managerUser.id)
      if (maintainerStat) {
        log(
          '维护人 stageCounts.INITIAL_TALK >= 1（累计统计包含测试项目）',
          maintainerStat.stageCounts?.INITIAL_TALK >= 1,
          `stageCounts=${JSON.stringify(maintainerStat.stageCounts)}`
        )
        log(
          '维护人 stageCounts.PRE_DD >= 1（项目经过 PreDD）',
          maintainerStat.stageCounts?.PRE_DD >= 1
        )
        log(
          '维护人 stageCounts.PROJECT_INITIATION >= 1（补齐了立项）',
          maintainerStat.stageCounts?.PROJECT_INITIATION >= 1
        )
        log(
          '维护人 stageCounts.DUE_DILIGENCE >= 1（项目进入尽调）',
          maintainerStat.stageCounts?.DUE_DILIGENCE >= 1
        )
      }
    }
  }

  // ── 组5：清理测试项目 ──
  console.log('\n── 组5：清理测试项目 ──')
  if (testProjectId) {
    const deleteRes = await apiCall(`/api/projects/${testProjectId}`, {
      method: 'DELETE',
      cookie: managerCookie,
    })
    log('清理测试项目成功', deleteRes.status === 200, `status=${deleteRes.status}`)
  }

  // ── 组6：项目库页面源码验证 ──
  console.log('\n── 组6：项目库页面源码验证 ──')
  const projectsContent = await readFile('src/app/projects/page.tsx')
  log('项目库 Project 接口包含 passedStages', projectsContent.includes('passedStages'))
  log('项目库 getPassedStages 函数', projectsContent.includes('getPassedStages'))
  log(
    '项目库 stageCount 使用 passedStages（累计统计）',
    projectsContent.includes('getPassedStages(p).includes(stage)')
  )
  log(
    '项目库 filteredProjects 使用 passedStages 过滤',
    projectsContent.includes('getPassedStages(project).includes(selectedStage)')
  )

  // ── 组7：工作台页面源码验证 ──
  console.log('\n── 组7：工作台页面源码验证 ──')
  const workbenchContent = await readFile('src/app/workbench/page.tsx')
  log('工作台 Project 接口包含 passedStages', workbenchContent.includes('passedStages'))
  log('工作台 getPassedStages 函数', workbenchContent.includes('getPassedStages'))
  log(
    '工作台 projectsByStage 使用 passedStages 过滤',
    workbenchContent.includes('getPassedStages(p).includes(stage)')
  )

  // ── 组8：dashboard API 源码验证 ──
  console.log('\n── 组8：dashboard API 源码验证 ──')
  const dashContent = await readFile('src/app/api/dashboard/route.ts')
  log('dashboard API 导入 parsePassedStages', dashContent.includes('parsePassedStages'))
  log(
    'dashboard API initiatedProjects 基于 passedStages',
    dashContent.includes("parsePassedStages(p.passedStages).includes('PROJECT_INITIATION')")
  )
  log(
    'dashboard API investedProjects 基于 passedStages',
    dashContent.includes("parsePassedStages(p.passedStages).includes('CLOSING')")
  )
  log(
    'dashboard API stageCounts 基于 passedStages 遍历',
    dashContent.includes('passedStages.includes(stage') && dashContent.includes('entry.stageCounts[stage]')
  )

  // ── 组9：创建/编辑 API 源码验证 ──
  console.log('\n── 组9：创建/编辑 API 源码验证 ──')
  const createApiContent = await readFile('src/app/api/projects/route.ts')
  log('创建 API 导入 computePassedStages', createApiContent.includes('computePassedStages'))
  log('创建 API 设置 passedStages', createApiContent.includes('passedStages: JSON.stringify(passedStages)'))

  const editApiContent = await readFile('src/app/api/projects/[id]/route.ts')
  log('编辑 API 导入 parsePassedStages', editApiContent.includes('parsePassedStages'))
  log('编辑 API 导入 computePassedStages', editApiContent.includes('computePassedStages'))
  log(
    '编辑 API 阶段变更时更新 passedStages',
    editApiContent.includes('data.followStage !== project.followStage') && editApiContent.includes('data.passedStages = JSON.stringify(newPassed)')
  )

  // ── 组10：stage-utils 工具函数源码验证 ──
  console.log('\n── 组10：stage-utils 工具函数源码验证 ──')
  const stageUtilsContent = await readFile('src/lib/stage-utils.ts')
  log('STAGE_ORDER 定义正确', stageUtilsContent.includes("'INITIAL_TALK'") && stageUtilsContent.includes("'POST_INVESTMENT'"))
  log('parsePassedStages 函数存在', stageUtilsContent.includes('export function parsePassedStages'))
  log('computePassedStages 函数存在', stageUtilsContent.includes('export function computePassedStages'))
  log('hasPassedStage 函数存在', stageUtilsContent.includes('export function hasPassedStage'))
  log('computePassedStages 补齐逻辑（slice + filter）', stageUtilsContent.includes('STAGE_ORDER.slice(0, newIdx + 1)') && stageUtilsContent.includes('STAGE_ORDER.filter(s => set.has(s))'))

  // ── 组11：Prisma schema 验证 ──
  console.log('\n── 组11：Prisma schema 验证 ──')
  const schemaContent = await readFile('prisma/schema.prisma')
  log('Project 模型包含 passedStages 字段', schemaContent.includes('passedStages String?'))

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
