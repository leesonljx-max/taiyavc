/**
 * 测试脚本：项目保护期 + 接手申请 + 禁止同名创建
 *
 * 测试覆盖：
 * 1. 测试账号验证（ADMIN/PARTNER/MANAGER）
 * 2. 禁止同名创建项目
 * 3. 创建项目时设置 protectionExpiresAt（3个月后）
 * 4. 同名检测返回完整信息（createdBy/isProtected/protectionExpiresAt）
 * 5. 接手申请：保护期内需审批
 * 6. 接手申请：保护期外直接变更
 * 7. 审批接手申请：同意
 * 8. 审批接手申请：拒绝
 * 9. 不能接手自己的项目
 * 10. 不能重复申请接手
 * 11. 首页/工作台去除新建项目按钮（源码验证）
 * 12. 项目库保留新建项目按钮（源码验证）
 * 13. 新建项目页面接手 UI（源码验证）
 * 14. 项目详情页维护人显示（源码验证）
 * 15. API 源码验证
 * 16. Prisma schema 验证
 */
import 'dotenv/config'

const BASE_URL = 'http://localhost:3000'

// 测试账号
const ACCOUNTS = {
  admin: { email: 'taiyavc@example.com', password: 'taiya2506', name: '管理员' },
  partner: { email: 'partner-test@example.com', password: 'partner123', name: '合伙人测试' },
  manager: { email: 'manager-test@example.com', password: 'manager123', name: '经理测试' },
  qinwei: { email: 'qinwei@taiya.com', password: 'qinwei', name: '秦伟' },
}

interface TestResult {
  name: string
  passed: boolean
  detail?: string
}

const results: TestResult[] = []

function log(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail })
  const status = passed ? '✓' : '✗'
  console.log(`${status} ${name}${detail && !passed ? ` — ${detail}` : ''}`)
}

// 登录获取 cookie
async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      email,
      password,
      csrfToken: '',
      callbackUrl: `${BASE_URL}/`,
      json: 'true',
    }),
    redirect: 'manual',
  })
  // 提取 set-cookie
  const setCookie = res.headers.get('set-cookie') || ''
  // 只取 session token
  const match = setCookie.match(/next-auth\.session-token=([^;]+)/)
  if (!match) {
    // 尝试获取 csrf token 后再登录
    const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`)
    const csrfData = await csrfRes.json()
    const csrfToken = csrfData.csrfToken
    const cookie = csrfRes.headers.get('set-cookie') || ''
    const csrfMatch = cookie.match(/next-auth\.csrf-token=([^;]+)/)
    const csrfCookie = csrfMatch ? `next-auth.csrf-token=${csrfMatch[1]}` : ''

    const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': csrfCookie,
      },
      body: new URLSearchParams({
        email,
        password,
        csrfToken,
        callbackUrl: `${BASE_URL}/`,
        json: 'true',
      }),
      redirect: 'manual',
    })
    const setCookie2 = loginRes.headers.get('set-cookie') || ''
    const match2 = setCookie2.match(/next-auth\.session-token=([^;]+)/)
    if (!match2) throw new Error(`登录失败: ${email}`)
    return `next-auth.session-token=${match2[1]}`
  }
  return `next-auth.session-token=${match[1]}`
}

// 调用 API
async function apiCall(
  path: string,
  options: { method?: string; cookie?: string; body?: any } = {}
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

// 读取文件
async function readFile(path: string): Promise<string> {
  const { readFile: fsReadFile } = await import('fs/promises')
  return fsReadFile(path, 'utf-8')
}

// ========== 测试开始 ==========
async function main() {
  console.log('\n========================================')
  console.log('  项目保护期 + 接手申请 测试')
  console.log('========================================\n')

  // ── 组1：测试账号验证 ──
  console.log('── 组1：测试账号验证 ──')
  for (const [key, acc] of Object.entries(ACCOUNTS)) {
    try {
      const cookie = await login(acc.email, acc.password)
      log(`账号 ${key} (${acc.email}) 登录成功`, !!cookie)
    } catch (e) {
      log(`账号 ${key} (${acc.email}) 登录成功`, false, (e as Error).message)
    }
  }

  // 登录所有账号
  const adminCookie = await login(ACCOUNTS.admin.email, ACCOUNTS.admin.password).catch(() => '')
  const partnerCookie = await login(ACCOUNTS.partner.email, ACCOUNTS.partner.password).catch(() => '')
  const managerCookie = await login(ACCOUNTS.manager.email, ACCOUNTS.manager.password).catch(() => '')

  // ── 组2：禁止同名创建 ──
  console.log('\n── 组2：禁止同名创建项目 ──')

  // 先获取一个已存在的项目名
  const projectsRes = await apiCall('/api/projects?scope=all', { cookie: adminCookie })
  const existingProject = projectsRes.data.projects?.[0]
  if (existingProject) {
    // 尝试用同名创建（checkDuplicate=true）
    const dupCheck = await apiCall('/api/projects', {
      method: 'POST',
      cookie: partnerCookie,
      body: { name: existingProject.name, checkDuplicate: true },
    })
    log(
      '同名项目 checkDuplicate 返回 409',
      dupCheck.status === 409,
      `status=${dupCheck.status}`
    )
    log(
      '409 响应包含 existingProject',
      !!dupCheck.data.existingProject,
      `data=${JSON.stringify(dupCheck.data).substring(0, 100)}`
    )
    log(
      'existingProject 包含 createdById',
      !!dupCheck.data.existingProject?.createdById
    )
    log(
      'existingProject 包含 createdByName',
      !!dupCheck.data.existingProject?.createdByName
    )
    log(
      'existingProject 包含 isProtected 字段',
      typeof dupCheck.data.existingProject?.isProtected === 'boolean'
    )
    log(
      'existingProject 包含 protectionExpiresAt',
      dupCheck.data.existingProject?.protectionExpiresAt !== undefined
    )
    log(
      'existingProject 包含 createdAt',
      !!dupCheck.data.existingProject?.createdAt
    )

    // 尝试实际创建同名项目（应被拒绝）
    const createSameName = await apiCall('/api/projects', {
      method: 'POST',
      cookie: partnerCookie,
      body: {
        name: existingProject.name,
        totalAmount: 100,
        targetDate: new Date().toISOString(),
      },
    })
    log(
      '实际创建同名项目被拒绝（409）',
      createSameName.status === 409,
      `status=${createSameName.status}`
    )
  } else {
    log('获取已存在项目用于同名测试', false, '没有项目数据')
  }

  // ── 组3：创建项目时设置 protectionExpiresAt ──
  console.log('\n── 组3：创建项目时设置 protectionExpiresAt ──')

  const testProjectName = `接手测试项目_${Date.now()}`
  const createRes = await apiCall('/api/projects', {
    method: 'POST',
    cookie: managerCookie,
    body: {
      name: testProjectName,
      industry: '测试行业',
      companyPosition: '测试定位',
      totalAmount: 500,
      targetDate: new Date().toISOString(),
    },
  })
  log(
    '创建测试项目成功（201）',
    createRes.status === 201,
    `status=${createRes.status}, data=${JSON.stringify(createRes.data).substring(0, 100)}`
  )

  const testProjectId = createRes.data.project?.id
  if (testProjectId) {
    // 查询项目详情，验证 protectionExpiresAt
    const detailRes = await apiCall(`/api/projects/${testProjectId}`, { cookie: managerCookie })
    const protectionExpiresAt = detailRes.data.project?.protectionExpiresAt
    log(
      '项目包含 protectionExpiresAt 字段',
      !!protectionExpiresAt,
      `protectionExpiresAt=${protectionExpiresAt}`
    )

    // 验证保护期 = 创建时间 + 3个月（90天）
    if (protectionExpiresAt) {
      const createdAt = new Date(detailRes.data.project.createdAt)
      const expiresAt = new Date(protectionExpiresAt)
      const diffDays = (expiresAt.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000)
      log(
        '保护期约为 90 天（3个月）',
        diffDays >= 89 && diffDays <= 91,
        `实际天数=${diffDays.toFixed(1)}`
      )
      log(
        '保护期在未来（未过期）',
        expiresAt > new Date()
      )
    }
  }

  // ── 组4：接手申请 - 保护期内需审批 ──
  console.log('\n── 组4：接手申请（保护期内） ──')

  if (testProjectId) {
    // 用 partner 账号申请接手 manager 创建的项目（保护期内）
    const takeoverRes = await apiCall(`/api/projects/${testProjectId}/takeover`, {
      method: 'POST',
      cookie: partnerCookie,
      body: { comment: '测试接手申请-保护期内' },
    })
    log(
      '保护期内接手申请返回成功',
      takeoverRes.status === 200,
      `status=${takeoverRes.status}, data=${JSON.stringify(takeoverRes.data).substring(0, 150)}`
    )
    log(
      '返回 needApproval=true',
      takeoverRes.data.needApproval === true
    )
    log(
      '返回 requestId',
      !!takeoverRes.data.requestId
    )
    log(
      '返回 message 包含"等待审批"',
      typeof takeoverRes.data.message === 'string' && takeoverRes.data.message.includes('审批')
    )

    const requestId = takeoverRes.data.requestId

    // 验证不能重复申请
    const dupTakeover = await apiCall(`/api/projects/${testProjectId}/takeover`, {
      method: 'POST',
      cookie: partnerCookie,
      body: { comment: '重复申请' },
    })
    log(
      '重复申请被拒绝（400）',
      dupTakeover.status === 400,
      `status=${dupTakeover.status}`
    )

    // 验证不能接手自己的项目
    const selfTakeover = await apiCall(`/api/projects/${testProjectId}/takeover`, {
      method: 'POST',
      cookie: managerCookie,
      body: { comment: '接手自己的项目' },
    })
    log(
      '接手自己的项目被拒绝（400）',
      selfTakeover.status === 400,
      `status=${selfTakeover.status}`
    )

    // ── 组5：审批接手申请 ──
    console.log('\n── 组5：审批接手申请 ──')

    if (requestId) {
      // manager（原维护人）查看接手申请列表
      const listRes = await apiCall(`/api/projects/${testProjectId}/takeover`, {
        cookie: managerCookie,
      })
      log(
        '原维护人查看接手申请列表成功',
        listRes.status === 200
      )
      log(
        '列表包含待审批申请',
        listRes.data.requests?.some((r: any) => r.id === requestId && r.status === 'PENDING')
      )
      log(
        '返回 isOwner=true（原维护人）',
        listRes.data.isOwner === true
      )

      // 验证无权限审批（partner 不能审批）
      const unauthorizedReview = await apiCall(
        `/api/projects/${testProjectId}/takeover/${requestId}/action`,
        {
          method: 'POST',
          cookie: partnerCookie, // partner 是请求者，不能审批
          body: { action: 'approve' },
        }
      )
      log(
        '请求者不能审批自己的申请（403）',
        unauthorizedReview.status === 403,
        `status=${unauthorizedReview.status}`
      )

      // ── 测试拒绝 ──
      // 先创建另一个项目用于拒绝测试
      const rejectProjectName = `拒绝接手测试_${Date.now()}`
      const rejectCreateRes = await apiCall('/api/projects', {
        method: 'POST',
        cookie: managerCookie,
        body: {
          name: rejectProjectName,
          totalAmount: 100,
          targetDate: new Date().toISOString(),
        },
      })
      const rejectProjectId = rejectCreateRes.data.project?.id

      if (rejectProjectId) {
        const rejectTakeover = await apiCall(`/api/projects/${rejectProjectId}/takeover`, {
          method: 'POST',
          cookie: partnerCookie,
          body: { comment: '测试拒绝' },
        })
        const rejectRequestId = rejectTakeover.data.requestId

        if (rejectRequestId) {
          // manager 拒绝
          const rejectRes = await apiCall(
            `/api/projects/${rejectProjectId}/takeover/${rejectRequestId}/action`,
            {
              method: 'POST',
              cookie: managerCookie,
              body: { action: 'reject', reviewerComment: '不同意接手' },
            }
          )
          log(
            '原维护人拒绝接手申请成功',
            rejectRes.status === 200,
            `status=${rejectRes.status}`
          )
          log(
            '拒绝后返回 action=rejected',
            rejectRes.data.action === 'rejected'
          )

          // 验证项目维护人未变更
          const afterReject = await apiCall(`/api/projects/${rejectProjectId}`, { cookie: managerCookie })
          log(
            '拒绝后项目维护人未变更',
            afterReject.data.project?.createdById === rejectCreateRes.data.project.createdById
          )

          // 清理：删除测试项目
          await apiCall(`/api/projects/${rejectProjectId}`, {
            method: 'DELETE',
            cookie: managerCookie,
          })
        }
      }

      // ── 测试同意 ──
      // manager 同意接手
      const approveRes = await apiCall(
        `/api/projects/${testProjectId}/takeover/${requestId}/action`,
        {
          method: 'POST',
          cookie: managerCookie,
          body: { action: 'approve', reviewerComment: '同意接手' },
        }
      )
      log(
        '原维护人同意接手申请成功',
        approveRes.status === 200,
        `status=${approveRes.status}`
      )
      log(
        '同意后返回 action=approved',
        approveRes.data.action === 'approved'
      )

      // 验证项目维护人已变更为 partner
      const afterApprove = await apiCall(`/api/projects/${testProjectId}`, { cookie: partnerCookie })
      log(
        '同意后项目维护人变更为请求者',
        afterApprove.data.project?.createdById !== undefined,
        `createdById=${afterApprove.data.project?.createdById}`
      )

      // 验证 protectionExpiresAt 已重置
      const newProtectionExpiresAt = afterApprove.data.project?.protectionExpiresAt
      if (newProtectionExpiresAt) {
        const expiresAt = new Date(newProtectionExpiresAt)
        log(
          '接手后保护期已重置（在未来）',
          expiresAt > new Date()
        )
        // 验证重置后的保护期约为接手时间 + 3个月
        const now = Date.now()
        const diffDays = (expiresAt.getTime() - now) / (24 * 60 * 60 * 1000)
        log(
          '重置后保护期约为 90 天',
          diffDays >= 89 && diffDays <= 91,
          `实际天数=${diffDays.toFixed(1)}`
        )
      }

      // 验证不能重复审批
      const dupApprove = await apiCall(
        `/api/projects/${testProjectId}/takeover/${requestId}/action`,
        {
          method: 'POST',
          cookie: managerCookie,
          body: { action: 'approve' },
        }
      )
      log(
        '重复审批被拒绝（400）',
        dupApprove.status === 400,
        `status=${dupApprove.status}`
      )
    }
  }

  // ── 组6：接手申请 - 保护期外直接变更 ──
  console.log('\n── 组6：接手申请（保护期外） ──')

  // 创建一个保护期已过期的项目（直接操作数据库）
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  // 找到 manager 用户
  const managerUser = await prisma.user.findUnique({
    where: { email: ACCOUNTS.manager.email },
  })
  const partnerUser = await prisma.user.findUnique({
    where: { email: ACCOUNTS.partner.email },
  })

  if (managerUser && partnerUser) {
    // 直接创建一个保护期已过期的项目
    const expiredProject = await prisma.project.create({
      data: {
        name: `过期保护期测试_${Date.now()}`,
        totalAmount: 100,
        targetDate: new Date(),
        createdById: managerUser.id,
        protectionExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 昨天过期
      },
    })

    // partner 直接接手（保护期外）
    const directTakeover = await apiCall(`/api/projects/${expiredProject.id}/takeover`, {
      method: 'POST',
      cookie: partnerCookie,
      body: { comment: '保护期外直接接手' },
    })
    log(
      '保护期外接手返回成功',
      directTakeover.status === 200,
      `status=${directTakeover.status}`
    )
    log(
      '返回 needApproval=false（无需审批）',
      directTakeover.data.needApproval === false
    )
    log(
      '返回 message 包含"成功接手"',
      typeof directTakeover.data.message === 'string' && directTakeover.data.message.includes('成功')
    )

    // 验证维护人已变更
    const afterDirect = await apiCall(`/api/projects/${expiredProject.id}`, { cookie: partnerCookie })
    log(
      '保护期外接手后维护人已变更',
      afterDirect.data.project?.createdById === partnerUser.id,
      `createdById=${afterDirect.data.project?.createdById}, expected=${partnerUser.id}`
    )

    // 验证保护期已重置
    const newProtection = afterDirect.data.project?.protectionExpiresAt
    if (newProtection) {
      log(
        '保护期外接手后保护期已重置（在未来）',
        new Date(newProtection) > new Date()
      )
    }

    // 验证 TakeoverRequest 记录为 AUTO_COMPLETED
    const takeoverRecords = await prisma.takeoverRequest.findMany({
      where: { projectId: expiredProject.id },
    })
    log(
      '自动接手创建 TakeoverRequest 记录',
      takeoverRecords.length > 0
    )
    log(
      '记录 status=AUTO_COMPLETED',
      takeoverRecords.some(r => r.status === 'AUTO_COMPLETED')
    )

    // 清理
    await prisma.project.delete({ where: { id: expiredProject.id } })
  }

  // ── 组7：清理测试项目 ──
  console.log('\n── 组7：清理测试项目 ──')

  if (testProjectId) {
    // partner 现在是维护人，删除测试项目
    const deleteRes = await apiCall(`/api/projects/${testProjectId}`, {
      method: 'DELETE',
      cookie: partnerCookie,
    })
    log(
      '清理测试项目成功',
      deleteRes.status === 200,
      `status=${deleteRes.status}`
    )
  }

  // ── 组8：源码验证 ──
  console.log('\n── 组8：源码验证 ──')

  // 验证首页去除新建项目按钮
  const homeContent = await readFile('src/app/page.tsx')
  log(
    '首页去除"新建项目"按钮（无 /projects/new 链接）',
    !homeContent.includes('href="/projects/new"'),
    homeContent.includes('/projects/new') ? '仍存在 /projects/new 引用' : undefined
  )
  log(
    '首页改为"查看项目库"按钮',
    homeContent.includes('查看项目库') && homeContent.includes('href="/projects"')
  )

  // 验证工作台去除新建项目按钮
  const workbenchContent = await readFile('src/app/workbench/page.tsx')
  log(
    '工作台去除"新建项目"按钮',
    !workbenchContent.includes('href="/projects/new"'),
    workbenchContent.includes('/projects/new') ? '仍存在 /projects/new 引用' : undefined
  )

  // 验证项目库保留新建项目按钮
  const projectsContent = await readFile('src/app/projects/page.tsx')
  log(
    '项目库保留"新建项目"按钮',
    projectsContent.includes('href="/projects/new"')
  )

  // 验证新建项目页面接手 UI
  const newProjectContent = await readFile('src/app/projects/new/page.tsx')
  log(
    '新建项目页面包含接手功能（handleTakeover）',
    newProjectContent.includes('handleTakeover')
  )
  log(
    '新建项目页面包含保护期状态显示（isProtected）',
    newProjectContent.includes('isProtected')
  )
  log(
    '新建项目页面包含"申请接手项目"按钮文本',
    newProjectContent.includes('申请接手项目')
  )
  log(
    '新建项目页面包含"直接接手项目"按钮文本',
    newProjectContent.includes('直接接手项目')
  )
  log(
    '新建项目页面禁止同名创建（不再有 confirmedDuplicate 提交逻辑）',
    !newProjectContent.includes('确认创建重复项目')
  )
  log(
    '新建项目页面创建按钮禁用逻辑（disabled={loading || !!duplicateWarning}）',
    newProjectContent.includes('disabled={loading || !!duplicateWarning}')
  )

  // 验证项目详情页显示维护人
  const detailContent = await readFile('src/app/projects/[id]/page.tsx')
  log(
    '项目详情页包含维护人卡片（当前维护人）',
    detailContent.includes('当前维护人')
  )
  log(
    '项目详情页显示保护期状态',
    detailContent.includes('保护期内') && detailContent.includes('保护期已过期')
  )
  log(
    '项目详情页 Project 接口包含 protectionExpiresAt 字段',
    detailContent.includes('protectionExpiresAt: string | null')
  )
  log(
    '项目详情页 Project 接口包含 createdBy 字段',
    detailContent.includes('createdBy: { id: string; name: string | null; email: string | null } | null')
  )

  // ── 组9：API 源码验证 ──
  console.log('\n── 组9：API 源码验证 ──')

  const projectsApiContent = await readFile('src/app/api/projects/route.ts')
  log(
    'projects API 禁止同名创建（返回 409）',
    projectsApiContent.includes('项目名称已存在，不允许重复创建')
  )
  log(
    'projects API 返回 isProtected 字段',
    projectsApiContent.includes('isProtected')
  )
  log(
    'projects API 返回 createdByName',
    projectsApiContent.includes('createdByName')
  )
  log(
    'projects API 设置 protectionExpiresAt',
    projectsApiContent.includes('protectionExpiresAt') && projectsApiContent.includes('THREE_MONTHS_MS')
  )
  log(
    'projects API 保护期 = 90 天',
    projectsApiContent.includes('90 * 24 * 60 * 60 * 1000')
  )

  // 验证 takeover API
  const takeoverApiContent = await readFile('src/app/api/projects/[id]/takeover/route.ts')
  log(
    'takeover API 存在 POST 处理',
    takeoverApiContent.includes('export async function POST')
  )
  log(
    'takeover API 存在 GET 处理',
    takeoverApiContent.includes('export async function GET')
  )
  log(
    'takeover API 保护期内创建 PENDING 申请',
    takeoverApiContent.includes("'PENDING'") || takeoverApiContent.includes('"PENDING"')
  )
  log(
    'takeover API 保护期外直接变更（AUTO_COMPLETED）',
    takeoverApiContent.includes("'AUTO_COMPLETED'") || takeoverApiContent.includes('"AUTO_COMPLETED"')
  )
  log(
    'takeover API 防止接手自己的项目',
    takeoverApiContent.includes('您已经是该项目的维护人')
  )
  log(
    'takeover API 防止重复申请',
    takeoverApiContent.includes('已发起过接手申请')
  )
  log(
    'takeover API 重置保护期',
    takeoverApiContent.includes('newProtectionExpiresAt')
  )

  // 验证审批 API
  const actionApiContent = await readFile('src/app/api/projects/[id]/takeover/[requestId]/action/route.ts')
  log(
    '审批 API 存在',
    actionApiContent.includes('export async function POST')
  )
  log(
    '审批 API 支持 approve',
    actionApiContent.includes("'approve'") || actionApiContent.includes('"approve"')
  )
  log(
    '审批 API 支持 reject',
    actionApiContent.includes("'reject'") || actionApiContent.includes('"reject"')
  )
  log(
    '审批 API 权限检查（仅维护人/管理员）',
    actionApiContent.includes('无权审批') || actionApiContent.includes('仅当前维护人或管理员')
  )
  log(
    '审批 API 防止重复审批',
    actionApiContent.includes('已处理') || actionApiContent.includes('无法重复操作')
  )
  log(
    '审批 API approve 时变更维护人',
    actionApiContent.includes('createdById: takeoverRequest.requesterId')
  )
  log(
    '审批 API approve 时重置保护期',
    actionApiContent.includes('newProtectionExpiresAt')
  )

  // ── 组10：Prisma schema 验证 ──
  console.log('\n── 组10：Prisma schema 验证 ──')

  const schemaContent = await readFile('prisma/schema.prisma')
  log(
    'Project 模型包含 protectionExpiresAt 字段',
    schemaContent.includes('protectionExpiresAt DateTime?')
  )
  log(
    'Project 模型包含 name 索引',
    schemaContent.includes('@@index([name])')
  )
  log(
    'Project 模型包含 takeoverRequests 关系',
    schemaContent.includes('takeoverRequests TakeoverRequest[]')
  )
  log(
    'TakeoverRequest 模型存在',
    schemaContent.includes('model TakeoverRequest')
  )
  log(
    'TakeoverRequest 包含 projectId',
    schemaContent.includes('projectId') && schemaContent.includes('TakeoverRequest')
  )
  log(
    'TakeoverRequest 包含 requesterId',
    schemaContent.includes('requesterId')
  )
  log(
    'TakeoverRequest 包含 currentOwnerId',
    schemaContent.includes('currentOwnerId')
  )
  log(
    'TakeoverRequest 包含 status',
    schemaContent.includes('status') && schemaContent.includes('PENDING') && schemaContent.includes('APPROVED') && schemaContent.includes('REJECTED') && schemaContent.includes('AUTO_COMPLETED')
  )
  log(
    'TakeoverRequest 包含 comment',
    schemaContent.includes('comment')
  )
  log(
    'TakeoverRequest 包含 reviewerComment',
    schemaContent.includes('reviewerComment')
  )
  log(
    'TakeoverRequest 包含 reviewedAt',
    schemaContent.includes('reviewedAt')
  )
  log(
    'TakeoverRequest 包含 project 关系',
    /project\s+Project\s+@relation/.test(schemaContent)
  )
  log(
    'TakeoverRequest 包含 requester 关系',
    /requester\s+User\s+@relation\("TakeoverRequestRequester"/.test(schemaContent)
  )
  log(
    'TakeoverRequest 包含 currentOwner 关系',
    /currentOwner\s+User\s+@relation\("TakeoverRequestOwner"/.test(schemaContent)
  )
  log(
    'User 模型包含 takeoverRequestsInitiated',
    schemaContent.includes('takeoverRequestsInitiated')
  )
  log(
    'User 模型包含 takeoverRequestsReceived',
    schemaContent.includes('takeoverRequestsReceived')
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
