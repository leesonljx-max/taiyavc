/**
 * 测试脚本：投资合伙人工作台 + 阶段变更审批
 *
 * 测试覆盖：
 * 1. 测试账号验证（ADMIN/PARTNER/MANAGER）
 * 2. 投资合伙人工作台视图（只看立项/尽调/交割/投后）
 * 3. 项目详情页投资估值字段
 * 4. 阶段变更请求创建（需审批的两种场景）
 * 5. 阶段变更请求审批（同意/拒绝）
 * 6. 非需审批的阶段变更（直接生效）
 * 7. 重复请求检查
 * 8. 权限验证（非合伙人不能审批）
 * 9. API 源码验证
 * 10. Prisma schema 验证
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

async function main() {
  console.log('\n========================================')
  console.log('  投资合伙人工作台 + 阶段变更审批测试')
  console.log('========================================\n')

  // ── 组1：测试账号验证 ──
  console.log('── 组1：测试账号验证 ──')
  const adminCookie = await login(ACCOUNTS.admin.email, ACCOUNTS.admin.password).catch(() => '')
  const partnerCookie = await login(ACCOUNTS.partner.email, ACCOUNTS.partner.password).catch(() => '')
  const managerCookie = await login(ACCOUNTS.manager.email, ACCOUNTS.manager.password).catch(() => '')
  log('管理员登录', !!adminCookie)
  log('投资合伙人登录', !!partnerCookie)
  log('投资经理登录', !!managerCookie)

  const managerUser = await prisma.user.findUnique({ where: { email: ACCOUNTS.manager.email } })

  // ── 组2：创建测试项目 ──
  console.log('\n── 组2：创建测试项目 ──')
  const testProjectName = `阶段审批测试_${Date.now()}`
  const createRes = await apiCall('/api/projects', {
    method: 'POST',
    cookie: managerCookie,
    body: {
      name: testProjectName,
      totalAmount: 500,
      investmentValuation: 5000,
      targetDate: new Date().toISOString(),
      followStage: 'PRE_DD',
      companyPosition: '测试公司定位',
      financingRound: 'A轮',
    },
  })
  log('创建测试项目（PRE_DD阶段）', createRes.status === 201, `status=${createRes.status}`)
  const projectId = createRes.data.project?.id
  log('获取项目ID', !!projectId)

  // ── 组3：投资估值字段验证 ──
  console.log('\n── 组3：投资估值字段验证 ──')
  if (projectId) {
    // 直接查询数据库验证
    const dbProject = await prisma.project.findUnique({ where: { id: projectId } })
    log(
      '数据库存储 investmentValuation（5000万）',
      dbProject?.investmentValuation === 5000,
      `actual=${dbProject?.investmentValuation}`
    )

    // 通过 API 验证
    const detailRes = await apiCall(`/api/projects/${projectId}`, { cookie: adminCookie })
    const proj = detailRes.data.project || detailRes.data
    log(
      'API 返回 investmentValuation 字段',
      proj.investmentValuation !== undefined,
      `investmentValuation=${proj.investmentValuation}`
    )
    log(
      'API 返回投资估值正确（5000万）',
      proj.investmentValuation === 5000,
      `actual=${proj.investmentValuation}`
    )
  }

  // ── 组4：阶段变更请求创建（PRE_DD → PROJECT_INITIATION，需审批）──
  console.log('\n── 组4：阶段变更请求创建（PRE_DD → 立项，需审批）──')
  let stageRequestId: string | undefined
  if (projectId) {
    const updateRes = await apiCall(`/api/projects/${projectId}`, {
      method: 'PUT',
      cookie: managerCookie,
      body: { followStage: 'PROJECT_INITIATION' },
    })
    log(
      '阶段变更请求已提交（返回 stageChangeRequest）',
      !!updateRes.data.stageChangeRequest,
      `status=${updateRes.status}`
    )
    stageRequestId = updateRes.data.stageChangeRequest?.id
    log('获取阶段变更请求ID', !!stageRequestId)

    // 验证项目阶段未变更
    const projectAfter = await prisma.project.findUnique({ where: { id: projectId } })
    log(
      '项目阶段未变更（仍为 PRE_DD）',
      projectAfter?.followStage === 'PRE_DD',
      `actual=${projectAfter?.followStage}`
    )
  }

  // ── 组5：待办请求列表 ──
  console.log('\n── 组5：待办请求列表 ──')
  const reqListRes = await apiCall('/api/stage-change-requests?status=PENDING', { cookie: partnerCookie })
  log(
    '合伙人可见待办请求列表',
    Array.isArray(reqListRes.data.requests),
    `count=${reqListRes.data.requests?.length}`
  )
  if (stageRequestId) {
    const found = reqListRes.data.requests?.find((r: any) => r.id === stageRequestId)
    log(
      '待办列表包含刚创建的请求',
      !!found,
      `requests=${reqListRes.data.requests?.length}`
    )
    // 验证待办卡片包含项目信息
    if (found) {
      log('待办请求包含项目名称', !!found.project?.name)
      log('待办请求包含投资估值', found.project?.investmentValuation === 5000, `actual=${found.project?.investmentValuation}`)
      log('待办请求包含融资金额', found.project?.totalAmount === 500, `actual=${found.project?.totalAmount}`)
      log('待办请求包含维护人', !!found.project?.createdBy?.name || !!found.requester?.name)
    }
  }

  // ── 组6：审批阶段变更请求（同意）──
  console.log('\n── 组6：审批阶段变更请求（同意）──')
  if (stageRequestId) {
    const approveRes = await apiCall(`/api/stage-change-requests/${stageRequestId}/action`, {
      method: 'POST',
      cookie: partnerCookie,
      body: { action: 'approve', comment: '同意立项' },
    })
    log('审批同意成功', approveRes.status === 200, `status=${approveRes.status}`)
    log('返回 action=approve', approveRes.data.action === 'approve')

    // 验证项目阶段已变更
    const projectAfter = await prisma.project.findUnique({ where: { id: projectId! } })
    log(
      '项目阶段已变更为 PROJECT_INITIATION',
      projectAfter?.followStage === 'PROJECT_INITIATION',
      `actual=${projectAfter?.followStage}`
    )

    // 验证请求状态已更新
    const reqAfter = await prisma.stageChangeRequest.findUnique({ where: { id: stageRequestId } })
    log('请求状态为 APPROVED', reqAfter?.status === 'APPROVED')
    log('审批人已记录', !!reqAfter?.reviewerId)
    log('审批时间已记录', !!reqAfter?.reviewedAt)
  }

  // ── 组7：非需审批的阶段变更（PROJECT_INITIATION → DUE_DILIGENCE，直接生效）──
  console.log('\n── 组7：非需审批的阶段变更（立项 → 尽调，直接生效）──')
  if (projectId) {
    const updateRes = await apiCall(`/api/projects/${projectId}`, {
      method: 'PUT',
      cookie: managerCookie,
      body: { followStage: 'DUE_DILIGENCE' },
    })
    log('直接变更成功（无 stageChangeRequest）', !updateRes.data.stageChangeRequest, `status=${updateRes.status}`)

    const projectAfter = await prisma.project.findUnique({ where: { id: projectId } })
    log('阶段已变更为 DUE_DILIGENCE', projectAfter?.followStage === 'DUE_DILIGENCE')
  }

  // ── 组8：阶段变更请求创建（DUE_DILIGENCE → CLOSING，需审批）──
  console.log('\n── 组8：阶段变更请求创建（尽调 → 交割，需审批）──')
  let closingRequestId: string | undefined
  if (projectId) {
    const updateRes = await apiCall(`/api/projects/${projectId}`, {
      method: 'PUT',
      cookie: managerCookie,
      body: { followStage: 'CLOSING' },
    })
    log(
      '阶段变更请求已提交（DUE_DILIGENCE → CLOSING）',
      !!updateRes.data.stageChangeRequest,
      `status=${updateRes.status}`
    )
    closingRequestId = updateRes.data.stageChangeRequest?.id

    // 项目阶段未变更
    const projectAfter = await prisma.project.findUnique({ where: { id: projectId } })
    log('项目阶段仍为 DUE_DILIGENCE', projectAfter?.followStage === 'DUE_DILIGENCE')
  }

  // ── 组9：审批拒绝 ──
  console.log('\n── 组9：审批拒绝 ──')
  if (closingRequestId) {
    const rejectRes = await apiCall(`/api/stage-change-requests/${closingRequestId}/action`, {
      method: 'POST',
      cookie: partnerCookie,
      body: { action: 'reject', comment: '暂不满足交割条件' },
    })
    log('审批拒绝成功', rejectRes.status === 200)
    log('返回 action=reject', rejectRes.data.action === 'reject')

    // 项目阶段不变
    const projectAfter = await prisma.project.findUnique({ where: { id: projectId! } })
    log('项目阶段仍为 DUE_DILIGENCE（拒绝后不变）', projectAfter?.followStage === 'DUE_DILIGENCE')
  }

  // ── 组10：重复请求检查 ──
  console.log('\n── 组10：重复请求检查 ──')
  if (projectId) {
    // 先创建一个 DUE_DILIGENCE → CLOSING 的请求
    const req1 = await apiCall(`/api/projects/${projectId}`, {
      method: 'PUT',
      cookie: managerCookie,
      body: { followStage: 'CLOSING' },
    })
    log('第一次请求创建成功', !!req1.data.stageChangeRequest)

    // 第二次请求应被拒绝
    const req2 = await apiCall(`/api/projects/${projectId}`, {
      method: 'PUT',
      cookie: managerCookie,
      body: { followStage: 'CLOSING' },
    })
    log('重复请求被拒绝', req2.status === 400, `status=${req2.status}`)

    // 清理：审批掉这个请求
    if (req1.data.stageChangeRequest?.id) {
      await apiCall(`/api/stage-change-requests/${req1.data.stageChangeRequest.id}/action`, {
        method: 'POST',
        cookie: partnerCookie,
        body: { action: 'reject' },
      })
    }
  }

  // ── 组11：权限验证 ──
  console.log('\n── 组11：权限验证 ──')
  // 投资经理不能审批
  if (stageRequestId) {
    // 先创建一个新的请求用于权限测试
    const permReq = await apiCall(`/api/projects/${projectId}`, {
      method: 'PUT',
      cookie: managerCookie,
      body: { followStage: 'CLOSING' },
    })
    const permReqId = permReq.data.stageChangeRequest?.id
    if (permReqId) {
      const managerActionRes = await apiCall(`/api/stage-change-requests/${permReqId}/action`, {
        method: 'POST',
        cookie: managerCookie,
        body: { action: 'approve' },
      })
      log('投资经理不能审批（403）', managerActionRes.status === 403, `status=${managerActionRes.status}`)
      // 清理
      await apiCall(`/api/stage-change-requests/${permReqId}/action`, {
        method: 'POST',
        cookie: partnerCookie,
        body: { action: 'reject' },
      })
    }
  }

  // ── 组12：投资合伙人工作台视图 ──
  console.log('\n── 组12：投资合伙人工作台视图 ──')
  // 投资合伙人调用 scope=all 获取所有项目
  const partnerProjectsRes = await apiCall('/api/projects?scope=all', { cookie: partnerCookie })
  const partnerProjects = partnerProjectsRes.data.projects || []
  const partnerVisibleStages = ['PROJECT_INITIATION', 'DUE_DILIGENCE', 'CLOSING', 'POST_INVESTMENT']
  const hasInvisibleStages = partnerProjects.some((p: any) => !partnerVisibleStages.includes(p.followStage))
  log('合伙人可获取所有项目（scope=all）', partnerProjects.length > 0)

  // ── 组13：清理测试项目 ──
  console.log('\n── 组13：清理测试项目 ──')
  if (projectId) {
    await prisma.stageChangeRequest.deleteMany({ where: { projectId } })
    await prisma.project.delete({ where: { id: projectId } })
    log('清理测试项目', true)
  }

  // ── 组14：API 源码验证 ──
  console.log('\n── 组14：API 源码验证 ──')
  const editApiContent = await readFile('src/app/api/projects/[id]/route.ts')
  log('编辑 API 包含 requiresApproval 逻辑', editApiContent.includes('requiresApproval'))
  log('编辑 API 检查 PRE_DD → PROJECT_INITIATION', editApiContent.includes("PROJECT_INITIATION") && editApiContent.includes("PRE_DD"))
  log('编辑 API 检查 DUE_DILIGENCE → CLOSING', editApiContent.includes("CLOSING") && editApiContent.includes("DUE_DILIGENCE"))
  log('编辑 API 创建 StageChangeRequest', editApiContent.includes('stageChangeRequest.create'))
  log('编辑 API 重复请求检查', editApiContent.includes('PENDING'))

  const listApiContent = await readFile('src/app/api/stage-change-requests/route.ts')
  log('列表 API 存在', listApiContent.length > 0)
  log('列表 API 按角色过滤（非合伙人只看自己）', listApiContent.includes('requesterId'))

  const actionApiContent = await readFile('src/app/api/stage-change-requests/[id]/action/route.ts')
  log('审批 API 存在', actionApiContent.length > 0)
  log('审批 API 调用 canApproveStage', actionApiContent.includes('canApproveStage'))
  log('审批 API 同意时变更阶段', actionApiContent.includes('followStage') && actionApiContent.includes('computePassedStages'))
  log('审批 API 拒绝时不变更', actionApiContent.includes('REJECTED'))

  // ── 组15：工作台源码验证 ──
  console.log('\n── 组15：工作台源码验证 ──')
  const workbenchContent = await readFile('src/app/workbench/page.tsx')
  log('工作台包含 PARTNER_VISIBLE_STAGES', workbenchContent.includes('PARTNER_VISIBLE_STAGES'))
  log('工作台合伙人只看立项及之后', workbenchContent.includes('PROJECT_INITIATION') && workbenchContent.includes('CLOSING'))
  log('工作台项目卡片显示维护人', workbenchContent.includes('createdBy?.name'))
  log('工作台包含待办请求区块', workbenchContent.includes('待办请求'))
  log('工作台待办卡片显示项目名称', workbenchContent.includes('req.project.name'))
  log('工作台待办卡片显示维护人', workbenchContent.includes('req.project.createdBy') || workbenchContent.includes('req.requester.name'))
  log('工作台待办卡片显示投资估值', workbenchContent.includes('investmentValuation'))
  log('工作台待办卡片显示融资金额', workbenchContent.includes('totalAmount'))
  log('工作台包含同意/拒绝按钮', workbenchContent.includes('approve') && workbenchContent.includes('reject'))
  log('工作台合伙人调用 scope=all', workbenchContent.includes("scope=${scope}") || workbenchContent.includes("'all'"))

  // ── 组16：项目详情页源码验证 ──
  console.log('\n── 组16：项目详情页源码验证 ──')
  const detailContent = await readFile('src/app/projects/[id]/page.tsx')
  log('详情页包含投资估值字段', detailContent.includes('投资估值'))
  log('详情页 investmentValuation 类型定义', detailContent.includes('investmentValuation: number | null'))

  // ── 组17：编辑页面源码验证 ──
  console.log('\n── 组17：编辑页面源码验证 ──')
  const editContent = await readFile('src/app/projects/[id]/edit/page.tsx')
  log('编辑页面包含投资估值输入框', editContent.includes('投资估值') && editContent.includes('investmentValuation'))

  // ── 组18：Prisma schema 验证 ──
  console.log('\n── 组18：Prisma schema 验证 ──')
  const schemaContent = await readFile('prisma/schema.prisma')
  log('Project 包含 investmentValuation 字段', schemaContent.includes('investmentValuation Float?'))
  log('StageChangeRequest 模型存在', schemaContent.includes('model StageChangeRequest'))
  log('StageChangeRequest 包含 fromStage/toStage', schemaContent.includes('fromStage') && schemaContent.includes('toStage'))
  log('StageChangeRequest 包含 status', schemaContent.includes('status') && schemaContent.includes('PENDING'))
  log('StageChangeRequest 关联 Project', schemaContent.includes('projectId') && /project\s+Project\s+@relation/.test(schemaContent))
  log('StageChangeRequest 关联 requester/reviewer', schemaContent.includes('requesterId') && schemaContent.includes('reviewerId'))

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
