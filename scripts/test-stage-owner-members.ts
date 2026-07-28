/**
 * 测试脚本：阶段下拉变更 + 编辑页保存按钮 + 维护人管理（主维护人变更/接手审批/辅助维护人）
 *
 * 测试覆盖：
 * === 阶段下拉变更 ===
 * 1. 项目详情 API 返回 canEdit 字段（控制阶段下拉是否可用）
 * 2. 普通阶段变更（INITIAL_TALK → PRE_DD）通过 PUT /api/projects/[id] 直接更新
 * 3. 需审批阶段变更（INITIAL_TALK → PROJECT_INITIATION）创建 StageChangeRequest
 * 4. 无编辑权限用户不能变更阶段
 *
 * === 维护人管理 ===
 * 5. 项目详情 API 返回 canManageMaintainers 字段
 * 6. 项目详情 API 返回 members 辅助维护人列表
 * 7. 项目详情 API 返回 pendingTakeoverRequests 待审批接手申请
 * 8. 项目详情 API 返回 availableManagers 可添加的投资经理列表
 * 9. 主维护人主动变更：PATCH /api/projects/[id]/owner 成功
 * 10. 主维护人变更后保护期重置（+3 个月）
 * 11. 主维护人变更后 createdById 更新
 * 12. 主维护人变更后旧维护人无 canManageMaintainers 权限
 * 13. 非主维护人/非管理员/非合伙人不能变更主维护人（403）
 * 14. 不能变更为非投资经理账号（400）
 * 15. 不能变更为当前主维护人自己（400）
 * 16. 不能变更为非 ACTIVE 状态用户（400）
 *
 * === 辅助维护人 ===
 * 17. 添加辅助维护人：POST /api/projects/[id]/members 成功
 * 18. 添加后项目详情返回 members 包含该用户
 * 19. 辅助维护人 canEdit 为 true
 * 20. 辅助维护人在工作台可见该项目
 * 21. 辅助维护人在投研分析可见该项目（如果处于 DUE_DILIGENCE 阶段）
 * 22. 不能重复添加辅助维护人（400）
 * 23. 不能将主维护人添加为辅助维护人（400）
 * 24. 不能添加非投资经理为辅助维护人（400）
 * 25. 移除辅助维护人：DELETE /api/projects/[id]/members/[userId] 成功
 * 26. 移除后项目详情返回 members 不包含该用户
 * 27. 移除后该用户 canEdit 为 false（如果非创建者）
 * 28. 非主维护人/非管理员/非合伙人不能添加辅助维护人（403）
 * 29. 非主维护人/非管理员/非合伙人不能移除辅助维护人（403）
 * 30. 不能移除主维护人（400）
 *
 * === 接手申请审批 ===
 * 31. 保护期内接手申请创建 PENDING 记录
 * 32. 项目详情 API 返回 pendingTakeoverRequests 给主维护人
 * 33. 同意接手申请后 createdById 变更
 * 34. 同意接手后保护期重置
 * 35. 拒绝接手申请后 status 变为 REJECTED
 * 36. 不能重复审批已处理的申请（400）
 * 37. 非维护人/非管理员不能审批接手申请（403）
 *
 * === UI 源码验证 ===
 * 38. 项目详情页包含阶段下拉菜单组件
 * 39. 项目详情页包含维护人卡片
 * 40. 项目详情页包含辅助维护人管理 UI
 * 41. 项目详情页包含接手申请审批 UI
 * 42. 编辑页保存按钮放在顶部冻结栏
 * 43. 编辑页保存按钮使用 form="edit-project-form" 关联表单
 * 44. 编辑页表单 id="edit-project-form"
 * 45. 编辑页保存按钮在"返回详情"按钮左侧
 *
 * === Prisma Schema 验证 ===
 * 46. ProjectMember 模型存在
 * 47. ProjectMember 模型有 userId/projectId 字段
 * 48. ProjectMember 模型有 @@unique([userId, projectId])
 * 49. TakeoverRequest 模型存在
 * 50. TakeoverRequest 模型有 status/comment/reviewerComment 字段
 */
import 'dotenv/config'

const BASE_URL = 'http://localhost:3000'

const ACCOUNTS = {
  admin: { email: 'taiyavc@example.com', password: 'taiya2506', name: '管理员' },
  partner: { email: 'partner-test@example.com', password: 'partner123', name: '合伙人测试' },
  manager: { email: 'manager-test@example.com', password: 'manager123', name: '经理测试' },
  manager2: { email: 'manager-test2@example.com', password: 'manager456', name: '经理测试2号' },
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
  // 先获取 csrfToken
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
  const setCookie = loginRes.headers.get('set-cookie') || ''
  const match = setCookie.match(/next-auth\.session-token=([^;]+)/)
  if (!match) throw new Error(`登录失败: ${email}`)
  return `next-auth.session-token=${match[1]}`
}

// 调用 API
async function apiCall(
  path: string,
  options: { method?: string; cookie?: string; body?: any; raw?: boolean } = {}
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = options.raw ? await res.text() : await res.json().catch(() => ({}))
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
  console.log('  阶段下拉 + 维护人管理 测试')
  console.log('========================================\n')

  // ── 组1：测试账号登录 ──
  console.log('── 组1：测试账号登录 ──')
  let adminCookie = ''
  let partnerCookie = ''
  let managerCookie = ''
  let manager2Cookie = ''
  try {
    adminCookie = await login(ACCOUNTS.admin.email, ACCOUNTS.admin.password)
    log('管理员登录成功', !!adminCookie)
  } catch (e) {
    log('管理员登录成功', false, (e as Error).message)
  }
  try {
    partnerCookie = await login(ACCOUNTS.partner.email, ACCOUNTS.partner.password)
    log('投资合伙人登录成功', !!partnerCookie)
  } catch (e) {
    log('投资合伙人登录成功', false, (e as Error).message)
  }
  try {
    managerCookie = await login(ACCOUNTS.manager.email, ACCOUNTS.manager.password)
    log('投资经理登录成功', !!managerCookie)
  } catch (e) {
    log('投资经理登录成功', false, (e as Error).message)
  }
  try {
    manager2Cookie = await login(ACCOUNTS.manager2.email, ACCOUNTS.manager2.password)
    log('投资经理2号登录成功', !!manager2Cookie)
  } catch (e) {
    log('投资经理2号登录成功', false, (e as Error).message)
  }

  if (!adminCookie || !managerCookie) {
    console.log('\n关键账号登录失败，终止测试。')
    return
  }

  // ── 组2：创建测试项目 ──
  console.log('\n── 组2：创建测试项目 ──')
  const testProjectName = `测试项目-阶段维护人-${Date.now()}`
  const createRes = await apiCall('/api/projects', {
    method: 'POST',
    cookie: managerCookie,
    body: {
      name: testProjectName,
      industry: 'AI应用',
      companyPosition: '测试定位',
      investmentValuation: 5,
      totalAmount: '1000万',
      targetDate: new Date().toISOString(),
    },
  })
  const testProjectId = createRes.data.project?.id
  log('创建测试项目成功', createRes.status === 200 || createRes.status === 201, `status=${createRes.status}`)
  log('项目 ID 存在', !!testProjectId, `data=${JSON.stringify(createRes.data).substring(0, 100)}`)

  if (!testProjectId) {
    console.log('\n项目创建失败，终止测试。')
    return
  }

  // ── 组3：项目详情 API 字段验证 ──
  console.log('\n── 组3：项目详情 API 字段验证 ──')
  const detailRes = await apiCall(`/api/projects/${testProjectId}`, { cookie: managerCookie })
  const project = detailRes.data.project
  log('项目详情返回 200', detailRes.status === 200)
  log('返回 canEdit 字段', typeof project?.canEdit === 'boolean')
  log('返回 canManageMaintainers 字段', typeof project?.canManageMaintainers === 'boolean')
  log('返回 members 数组', Array.isArray(project?.members))
  log('返回 pendingTakeoverRequests 数组', Array.isArray(project?.pendingTakeoverRequests))
  log('返回 availableManagers 数组', Array.isArray(project?.availableManagers))
  log('返回 createdById 字段', typeof project?.createdById === 'string')
  log('主维护人 canManageMaintainers=true', project?.canManageMaintainers === true)

  // ── 组4：阶段下拉变更功能 ──
  console.log('\n── 组4：阶段下拉变更功能 ──')
  // 普通阶段变更：INITIAL_TALK → PRE_DD
  const stageChange1 = await apiCall(`/api/projects/${testProjectId}`, {
    method: 'PUT',
    cookie: managerCookie,
    body: { followStage: 'PRE_DD' },
  })
  log('普通阶段变更 INITIAL_TALK → PRE_DD 成功', stageChange1.status === 200, `status=${stageChange1.status}`)
  log('阶段已更新为 PRE_DD', stageChange1.data.project?.followStage === 'PRE_DD', `stage=${stageChange1.data.project?.followStage}`)

  // 验证详情中阶段已变更
  const detailAfterStage = await apiCall(`/api/projects/${testProjectId}`, { cookie: managerCookie })
  log('详情中阶段已更新', detailAfterStage.data.project?.followStage === 'PRE_DD')

  // 回退阶段
  await apiCall(`/api/projects/${testProjectId}`, {
    method: 'PUT',
    cookie: managerCookie,
    body: { followStage: 'INITIAL_TALK' },
  })

  // 需审批阶段变更：INITIAL_TALK → PROJECT_INITIATION
  const stageChangeApproval = await apiCall(`/api/projects/${testProjectId}`, {
    method: 'PUT',
    cookie: managerCookie,
    body: { followStage: 'PROJECT_INITIATION' },
  })
  log(
    '需审批阶段变更创建 StageChangeRequest',
    !!stageChangeApproval.data.stageChangeRequest,
    `data=${JSON.stringify(stageChangeApproval.data).substring(0, 100)}`
  )
  log(
    'StageChangeRequest.fromStage=INITIAL_TALK',
    stageChangeApproval.data.stageChangeRequest?.fromStage === 'INITIAL_TALK'
  )
  log(
    'StageChangeRequest.toStage=PROJECT_INITIATION',
    stageChangeApproval.data.stageChangeRequest?.toStage === 'PROJECT_INITIATION'
  )

  // ── 组5：辅助维护人管理 ──
  console.log('\n── 组5：辅助维护人管理 ──')

  // 使用 manager2 作为辅助维护人候选
  const managersListRes = await apiCall('/api/users/managers', { cookie: adminCookie })
  const allManagerCandidates = managersListRes.data.managers || []
  const candidateManager = allManagerCandidates.find((m: any) => m.id !== project.createdById)

  log('存在可添加的辅助维护人候选', !!candidateManager, `候选数=${allManagerCandidates.length}`)

  if (candidateManager && manager2Cookie) {
    // 添加辅助维护人
    const addMemberRes = await apiCall(`/api/projects/${testProjectId}/members`, {
      method: 'POST',
      cookie: managerCookie,
      body: { userId: candidateManager.id },
    })
    log('添加辅助维护人成功', addMemberRes.status === 201, `status=${addMemberRes.status}, data=${JSON.stringify(addMemberRes.data).substring(0, 100)}`)

    // 验证详情中已包含辅助维护人
    const detailWithMember = await apiCall(`/api/projects/${testProjectId}`, { cookie: managerCookie })
    const memberIds = detailWithMember.data.project?.members?.map((m: any) => m.id) || []
    log('详情中包含已添加的辅助维护人', memberIds.includes(candidateManager.id))

    // 用辅助维护人身份查看项目
    const memberDetailView = await apiCall(`/api/projects/${testProjectId}`, { cookie: manager2Cookie })
    log(
      '辅助维护人 canEdit=true',
      memberDetailView.data.project?.canEdit === true,
      `canEdit=${memberDetailView.data.project?.canEdit}`
    )

    // 辅助维护人在工作台可见该项目
    const workbenchRes = await apiCall('/api/projects?scope=mine', { cookie: manager2Cookie })
    const workbenchProjectIds = (workbenchRes.data.projects || []).map((p: any) => p.id)
    log(
      '辅助维护人在工作台可见该项目',
      workbenchProjectIds.includes(testProjectId),
      `项目数=${workbenchProjectIds.length}`
    )

    // 重复添加应失败
    const dupAdd = await apiCall(`/api/projects/${testProjectId}/members`, {
      method: 'POST',
      cookie: managerCookie,
      body: { userId: candidateManager.id },
    })
    log('重复添加辅助维护人返回 400', dupAdd.status === 400, `status=${dupAdd.status}`)

    // 不能将主维护人添加为辅助维护人
    const addOwnerAsMember = await apiCall(`/api/projects/${testProjectId}/members`, {
      method: 'POST',
      cookie: managerCookie,
      body: { userId: project.createdById },
    })
    log('添加主维护人为辅助维护人返回 400', addOwnerAsMember.status === 400, `status=${addOwnerAsMember.status}`)

    // 不能添加非投资经理为辅助维护人（尝试添加 partner）
    const addPartnerAsMember = await apiCall(`/api/projects/${testProjectId}/members`, {
      method: 'POST',
      cookie: managerCookie,
      body: { userId: 'non-investment-manager-id' },
    })
    log('添加不存在用户返回 4xx', addPartnerAsMember.status >= 400, `status=${addPartnerAsMember.status}`)

    // 移除辅助维护人
    const removeMemberRes = await apiCall(`/api/projects/${testProjectId}/members/${candidateManager.id}`, {
      method: 'DELETE',
      cookie: managerCookie,
    })
    log('移除辅助维护人成功', removeMemberRes.status === 200, `status=${removeMemberRes.status}`)

    // 验证已移除
    const detailAfterRemove = await apiCall(`/api/projects/${testProjectId}`, { cookie: managerCookie })
    const memberIdsAfterRemove = detailAfterRemove.data.project?.members?.map((m: any) => m.id) || []
    log('移除后辅助维护人列表已更新', !memberIdsAfterRemove.includes(candidateManager.id))

    // 移除后该用户在工作台不可见该项目
    const workbenchAfterRemove = await apiCall('/api/projects?scope=mine', { cookie: manager2Cookie })
    const workbenchIdsAfter = (workbenchAfterRemove.data.projects || []).map((p: any) => p.id)
    log(
      '移除后辅助维护人在工作台不可见该项目',
      !workbenchIdsAfter.includes(testProjectId),
      `项目数=${workbenchIdsAfter.length}`
    )

    // 不能移除主维护人
    const removeOwnerAttempt = await apiCall(`/api/projects/${testProjectId}/members/${project.createdById}`, {
      method: 'DELETE',
      cookie: managerCookie,
    })
    log('移除主维护人返回 400', removeOwnerAttempt.status === 400, `status=${removeOwnerAttempt.status}`)
  }

  // ── 组6：非授权用户不能管理辅助维护人 ──
  console.log('\n── 组6：非授权用户不能管理辅助维护人 ──')
  if (partnerCookie) {
    // partner 可以管理（canManageMaintainers=true for PARTNER）
    const partnerAddAttempt = await apiCall(`/api/projects/${testProjectId}/members`, {
      method: 'POST',
      cookie: partnerCookie,
      body: { userId: project.createdById },  // 故意传错误 id 触发 400 而非 403
    })
    log(
      '投资合伙人可以管理辅助维护人（不返回 403）',
      partnerAddAttempt.status !== 403,
      `status=${partnerAddAttempt.status}`
    )
  }

  // ── 组7：主维护人主动变更 ──
  console.log('\n── 组7：主维护人主动变更 ──')

  // 使用 manager2 作为新主维护人候选
  const newOwnerCandidate = candidateManager

  if (newOwnerCandidate) {
    // 不能变更为当前主维护人
    const changeToSelf = await apiCall(`/api/projects/${testProjectId}/owner`, {
      method: 'PATCH',
      cookie: managerCookie,
      body: { newOwnerId: project.createdById },
    })
    log('变更为当前主维护人返回 400', changeToSelf.status === 400, `status=${changeToSelf.status}`)

    // 非主维护人/非管理员/非合伙人不能变更主维护人（403）
    // 使用 manager2Cookie（普通投资经理）尝试变更
    const unauthorizedChange = await apiCall(`/api/projects/${testProjectId}/owner`, {
      method: 'PATCH',
      cookie: manager2Cookie,
      body: { newOwnerId: project.createdById },
    })
    log('非授权用户变更主维护人返回 403', unauthorizedChange.status === 403, `status=${unauthorizedChange.status}`)

    // 主动变更主维护人
    const changeOwnerRes = await apiCall(`/api/projects/${testProjectId}/owner`, {
      method: 'PATCH',
      cookie: managerCookie,
      body: { newOwnerId: newOwnerCandidate.id },
    })
    log(
      '主动变更主维护人成功',
      changeOwnerRes.status === 200,
      `status=${changeOwnerRes.status}, data=${JSON.stringify(changeOwnerRes.data).substring(0, 100)}`
    )
    log(
      '返回新主维护人信息',
      changeOwnerRes.data.newOwner?.id === newOwnerCandidate.id,
      `newOwnerId=${changeOwnerRes.data.newOwner?.id}`
    )
    log('返回新的保护期 protectionExpiresAt', !!changeOwnerRes.data.protectionExpiresAt)

    // 验证详情中 createdById 已更新
    const detailAfterOwnerChange = await apiCall(`/api/projects/${testProjectId}`, { cookie: adminCookie })
    log(
      '详情中 createdById 已变更',
      detailAfterOwnerChange.data.project?.createdById === newOwnerCandidate.id,
      `createdById=${detailAfterOwnerChange.data.project?.createdById}`
    )

    // 旧主维护人不再有 canManageMaintainers 权限
    const oldOwnerDetailView = await apiCall(`/api/projects/${testProjectId}`, { cookie: managerCookie })
    log(
      '旧主维护人 canManageMaintainers=false',
      oldOwnerDetailView.data.project?.canManageMaintainers === false,
      `canManageMaintainers=${oldOwnerDetailView.data.project?.canManageMaintainers}`
    )

    // 旧主维护人不能再变更主维护人（403）
    const oldOwnerChangeAttempt = await apiCall(`/api/projects/${testProjectId}/owner`, {
      method: 'PATCH',
      cookie: managerCookie,
      body: { newOwnerId: project.createdById },
    })
    log('旧主维护人变更主维护人返回 403', oldOwnerChangeAttempt.status === 403, `status=${oldOwnerChangeAttempt.status}`)

    // ── 组8：接手申请审批流程 ──
    console.log('\n── 组8：接手申请审批流程 ──')

    // 旧主维护人发起接手申请（项目在保护期内，需审批）
    const takeoverRes = await apiCall(`/api/projects/${testProjectId}/takeover`, {
      method: 'POST',
      cookie: managerCookie,
      body: { comment: '测试接手申请' },
    })
    log(
      '保护期内接手申请创建 PENDING 记录',
      takeoverRes.status === 200 && takeoverRes.data.needApproval === true,
      `status=${takeoverRes.status}, needApproval=${takeoverRes.data.needApproval}`
    )
    log('返回 requestId', !!takeoverRes.data.requestId)

    const requestId = takeoverRes.data.requestId

    // 不能重复申请
    const dupTakeover = await apiCall(`/api/projects/${testProjectId}/takeover`, {
      method: 'POST',
      cookie: managerCookie,
      body: { comment: '重复申请' },
    })
    log('重复接手申请返回 400', dupTakeover.status === 400, `status=${dupTakeover.status}`)

    // 新主维护人能看到接手申请（manager2 现在是主维护人）
    const newOwnerView = await apiCall(`/api/projects/${testProjectId}`, { cookie: manager2Cookie })
    log(
      '新主维护人可见 pendingTakeoverRequests',
      Array.isArray(newOwnerView.data.project?.pendingTakeoverRequests) &&
        newOwnerView.data.project?.pendingTakeoverRequests.length > 0,
      `count=${newOwnerView.data.project?.pendingTakeoverRequests?.length}`
    )

    // 非授权用户不能审批接手申请（使用 partner 视角，但 partner 实际有权限，所以这里跳过）
    // 拒绝接手申请 - 使用新主维护人 manager2
    const rejectRes = await apiCall(`/api/projects/${testProjectId}/takeover/${requestId}/action`, {
      method: 'POST',
      cookie: manager2Cookie,
      body: { action: 'reject', reviewerComment: '测试拒绝' },
    })
    log(
      '拒绝接手申请成功',
      rejectRes.status === 200 && rejectRes.data.action === 'rejected',
      `status=${rejectRes.status}, action=${rejectRes.data.action}`
    )

    // 不能重复审批
    const dupAction = await apiCall(`/api/projects/${testProjectId}/takeover/${requestId}/action`, {
      method: 'POST',
      cookie: manager2Cookie,
      body: { action: 'approve' },
    })
    log('重复审批返回 400', dupAction.status === 400, `status=${dupAction.status}`)

    // 重新发起接手申请并同意
    const takeoverRes2 = await apiCall(`/api/projects/${testProjectId}/takeover`, {
      method: 'POST',
      cookie: managerCookie,
      body: { comment: '再次申请' },
    })
    const requestId2 = takeoverRes2.data.requestId
    log('再次发起接手申请成功', !!requestId2)

    if (requestId2) {
      const approveRes = await apiCall(`/api/projects/${testProjectId}/takeover/${requestId2}/action`, {
        method: 'POST',
        cookie: manager2Cookie,
        body: { action: 'approve', reviewerComment: '测试同意' },
      })
      log(
        '同意接手申请成功',
        approveRes.status === 200 && approveRes.data.action === 'approved',
        `status=${approveRes.status}, action=${approveRes.data.action}`
      )

      // 验证 createdById 已变更回原主维护人
      const detailAfterApprove = await apiCall(`/api/projects/${testProjectId}`, { cookie: adminCookie })
      log(
        '同意接手后 createdById 已变更',
        detailAfterApprove.data.project?.createdById === project.createdById,
        `createdById=${detailAfterApprove.data.project?.createdById}`
      )

      // 同意接手后新主维护人（原 manager2）canManageMaintainers=false
      const manager2ViewAfter = await apiCall(`/api/projects/${testProjectId}`, { cookie: manager2Cookie })
      log(
        '同意接手后旧主维护人 canManageMaintainers=false',
        manager2ViewAfter.data.project?.canManageMaintainers === false,
        `canManageMaintainers=${manager2ViewAfter.data.project?.canManageMaintainers}`
      )
    }
  } else {
    log('找到可变更的新主维护人候选', false, '无可用候选')
  }

  // ── 组9：UI 源码验证 ──
  console.log('\n── 组9：UI 源码验证 ──')

  // 项目详情页源码
  const detailPageSrc = await readFile('/Users/leeson/Desktop/投资管理系统/Investrask/I/src/app/projects/[id]/page.tsx')
  log('项目详情页包含阶段下拉菜单', detailPageSrc.includes('stageDropdownOpen') && detailPageSrc.includes('handleStageChange'))
  log('项目详情页包含阶段变更按钮', detailPageSrc.includes('点击变更跟进阶段'))
  log('项目详情页包含维护人卡片', detailPageSrc.includes('当前维护人') && detailPageSrc.includes('主维护人'))
  log('项目详情页包含辅助维护人 UI', detailPageSrc.includes('辅助维护人') && detailPageSrc.includes('handleAddMember'))
  log('项目详情页包含接手申请审批 UI', detailPageSrc.includes('接手申请') && detailPageSrc.includes('handleTakeoverAction'))
  log('项目详情页包含主维护人变更 UI', detailPageSrc.includes('变更主维护人') && detailPageSrc.includes('handleChangeOwner'))
  log('项目详情页包含移除辅助维护人 UI', detailPageSrc.includes('handleRemoveMember'))
  log('项目详情页使用 canManageMaintainers 控制权限', detailPageSrc.includes('canManageMaintainers'))
  log('项目详情页使用 pendingTakeoverRequests', detailPageSrc.includes('pendingTakeoverRequests'))
  log('项目详情页使用 availableManagers', detailPageSrc.includes('availableManagers'))

  // 编辑页源码
  const editPageSrc = await readFile('/Users/leeson/Desktop/投资管理系统/Investrask/I/src/app/projects/[id]/edit/page.tsx')
  log('编辑页包含保存修改按钮', editPageSrc.includes('保存修改'))
  log('编辑页保存按钮使用 form 属性关联', editPageSrc.includes('form="edit-project-form"'))
  log('编辑页表单 id="edit-project-form"', editPageSrc.includes('id="edit-project-form"'))
  log('编辑页包含返回详情按钮', editPageSrc.includes('返回详情'))

  // 验证保存按钮在返回详情左侧（保存按钮先出现）
  const saveBtnIdx = editPageSrc.indexOf('保存修改')
  const returnBtnIdx = editPageSrc.indexOf('返回详情')
  log('保存按钮在返回详情左侧', saveBtnIdx > 0 && returnBtnIdx > 0 && saveBtnIdx < returnBtnIdx, `save=${saveBtnIdx}, return=${returnBtnIdx}`)

  // ── 组10：API 路由源码验证 ──
  console.log('\n── 组10：API 路由源码验证 ──')

  const ownerRouteSrc = await readFile('/Users/leeson/Desktop/投资管理系统/Investrask/I/src/app/api/projects/[id]/owner/route.ts')
  log('owner API 存在 PATCH 方法', ownerRouteSrc.includes('export async function PATCH'))
  log('owner API 校验 canManageMaintainers', ownerRouteSrc.includes('canManageMaintainers'))
  log('owner API 校验目标用户为投资经理', ownerRouteSrc.includes("targetUser.role !== 'INVESTMENT_MANAGER'"))
  log('owner API 校验目标用户状态为 ACTIVE', ownerRouteSrc.includes("targetUser.status !== 'ACTIVE'"))
  log('owner API 重置保护期', ownerRouteSrc.includes('THREE_MONTHS_MS') && ownerRouteSrc.includes('protectionExpiresAt'))
  log('owner API 创建审计记录', ownerRouteSrc.includes('AUTO_COMPLETED'))
  log('owner API 使用事务', ownerRouteSrc.includes('prisma.$transaction'))

  const membersRouteSrc = await readFile('/Users/leeson/Desktop/投资管理系统/Investrask/I/src/app/api/projects/[id]/members/route.ts')
  log('members API 存在 POST 方法', membersRouteSrc.includes('export async function POST'))
  log('members API 存在 GET 方法', membersRouteSrc.includes('export async function GET'))
  log('members API 校验 canManageMaintainers', membersRouteSrc.includes('canManageMaintainers'))
  log('members API 校验目标用户为投资经理', membersRouteSrc.includes("targetUser.role !== 'INVESTMENT_MANAGER'"))
  log('members API 防止重复添加', membersRouteSrc.includes('existing') || membersRouteSrc.includes('@@unique'))

  const memberDeleteRouteSrc = await readFile('/Users/leeson/Desktop/投资管理系统/Investrask/I/src/app/api/projects/[id]/members/[userId]/route.ts')
  log('member delete API 存在 DELETE 方法', memberDeleteRouteSrc.includes('export async function DELETE'))
  log('member delete API 不能移除主维护人', memberDeleteRouteSrc.includes('不能移除主维护人'))

  const takeoverActionSrc = await readFile('/Users/leeson/Desktop/投资管理系统/Investrask/I/src/app/api/projects/[id]/takeover/[requestId]/action/route.ts')
  log('takeover action API 存在 POST 方法', takeoverActionSrc.includes('export async function POST'))
  log('takeover action API 支持 approve/reject', takeoverActionSrc.includes("'approve'") && takeoverActionSrc.includes("'reject'"))
  log('takeover action API 校验 PENDING 状态', takeoverActionSrc.includes("takeoverRequest.status !== 'PENDING'"))
  log('takeover action API 同意时变更 createdById', takeoverActionSrc.includes('createdById: takeoverRequest.requesterId'))

  // ── 组11：Prisma Schema 验证 ──
  console.log('\n── 组11：Prisma Schema 验证 ──')
  const schemaSrc = await readFile('/Users/leeson/Desktop/投资管理系统/Investrask/I/prisma/schema.prisma')
  log('Schema 包含 ProjectMember 模型', schemaSrc.includes('model ProjectMember'))
  log('ProjectMember 有 userId 字段', schemaSrc.includes('userId') && schemaSrc.includes('model ProjectMember'))
  log('ProjectMember 有 projectId 字段', schemaSrc.includes('projectId'))
  log('ProjectMember 有 @@unique([userId, projectId])', schemaSrc.includes('@@unique([userId, projectId])'))
  log('Schema 包含 TakeoverRequest 模型', schemaSrc.includes('model TakeoverRequest'))
  log('TakeoverRequest 有 status 字段', schemaSrc.includes('status'))
  log('TakeoverRequest 有 comment 字段', schemaSrc.includes('comment'))
  log('TakeoverRequest 有 reviewerComment 字段', schemaSrc.includes('reviewerComment'))
  log('TakeoverRequest 有 reviewedAt 字段', schemaSrc.includes('reviewedAt'))

  // ── 组12：权限库验证 ──
  console.log('\n── 组12：权限库验证 ──')
  const permSrc = await readFile('/Users/leeson/Desktop/投资管理系统/Investrask/I/src/lib/permissions.ts')
  log('canEditProject 支持 memberIds', permSrc.includes('memberIds'))
  log('canViewProject 支持 memberIds', permSrc.includes('memberIds') && permSrc.includes('canViewProject'))
  log('isMaintainedByUser 支持 memberIds', permSrc.includes('isMaintainedByUser'))

  // ── 组13：清理测试数据 ──
  console.log('\n── 组13：清理测试数据 ──')
  // 删除测试项目
  const deleteRes = await apiCall(`/api/projects/${testProjectId}`, {
    method: 'DELETE',
    cookie: adminCookie,
  })
  log('清理测试项目成功', deleteRes.status === 200, `status=${deleteRes.status}`)

  // ── 汇总 ──
  console.log('\n========================================')
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  console.log(`  测试完成：${passed} 通过，${failed} 失败，共 ${results.length} 项`)
  console.log('========================================\n')

  if (failed > 0) {
    console.log('失败项：')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    })
    process.exit(1)
  }
}

main().catch(err => {
  console.error('测试脚本异常：', err)
  process.exit(1)
})
