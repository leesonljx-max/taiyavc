/**
 * 测试脚本：注册登录系统（v0.4 改造）
 *
 * 覆盖功能：
 * 1. 注册 API 校验（必填、密码确认、密码长度、邮箱格式、邮箱/账户名唯一性）
 * 2. 注册成功后默认 PENDING 状态
 * 3. 登录 API：账户名登录、邮箱登录、PENDING 用户禁止登录、密码错误、不存在用户
 * 4. 管理员审批：通过 → ACTIVE 可登录；分配角色；拒绝 → REJECTED 不能登录
 * 5. 管理员 API：非管理员禁止访问；返回 username 字段
 * 6. 退出按钮跳转到 /auth/login（源码验证）
 * 7. 源码验证：login 页面 Link 导入、register 页面字段、auth.ts 双模式登录
 * 8. Prisma schema 验证：User.username 字段存在
 *
 * 运行: npx tsx scripts/test-auth-system.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const BASE_URL = 'http://localhost:3000'
const prisma = new PrismaClient()

const ADMIN = { email: 'admin-test@example.com', password: 'admin123' }
const PARTNER = { email: 'partner-test@example.com', password: 'partner123' }
const MANAGER = { email: 'manager-test@example.com', password: 'manager123' }

interface TestResult { name: string; passed: boolean; detail?: string }
const results: TestResult[] = []
const createdUserIds: string[] = []

function log(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail })
  console.log(`${passed ? '✓' : '✗'} ${name}${!passed && detail ? ` — ${detail}` : ''}`)
}

async function login(identifier: string, password: string): Promise<string> {
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`)
  const csrfData = await csrfRes.json()
  const csrfToken = csrfData.csrfToken
  const cookie = csrfRes.headers.get('set-cookie') || ''
  const csrfMatch = cookie.match(/next-auth\.csrf-token=([^;]+)/)
  const csrfCookie = csrfMatch ? `next-auth.csrf-token=${csrfMatch[1]}` : ''

  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrfCookie },
    body: new URLSearchParams({ email: identifier, password, csrfToken, callbackUrl: `${BASE_URL}/`, json: 'true' }),
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
  console.log('  注册登录系统测试（v0.4 改造）')
  console.log('========================================\n')

  // 清理可能残留的测试数据
  const suffix = Date.now()
  const testEmail = `auth-test-${suffix}@example.com`
  const testUsername = `authuser_${suffix}`
  const testPassword = 'test123456'

  // ── 组1：管理员/合伙人/经理登录 ──
  console.log('── 组1：测试账号登录 ──')
  const adminCookie = await login(ADMIN.email, ADMIN.password).catch(() => '')
  const partnerCookie = await login(PARTNER.email, PARTNER.password).catch(() => '')
  const managerCookie = await login(MANAGER.email, MANAGER.password).catch(() => '')
  log('管理员登录（邮箱）', !!adminCookie)
  log('投资合伙人登录（邮箱）', !!partnerCookie)
  log('投资经理登录（邮箱）', !!managerCookie)

  // ── 组2：注册 API 校验 ──
  console.log('\n── 组2：注册 API 校验 ──')

  // 2.1 缺少必填字段
  const r1 = await apiCall('/api/users/register', {
    method: 'POST',
    body: { username: 'u1', email: 'e1@e.com', password: 'p', confirmPassword: 'p' },
  })
  log('缺少姓名返回 400', r1.status === 400, `status=${r1.status}`)

  const r2 = await apiCall('/api/users/register', {
    method: 'POST',
    body: { name: 'n', email: 'e1@e.com', password: 'p', confirmPassword: 'p' },
  })
  log('缺少账户名返回 400', r2.status === 400, `status=${r2.status}`)

  const r3 = await apiCall('/api/users/register', {
    method: 'POST',
    body: { name: 'n', username: 'u1', password: 'p', confirmPassword: 'p' },
  })
  log('缺少邮箱返回 400', r3.status === 400, `status=${r3.status}`)

  const r4 = await apiCall('/api/users/register', {
    method: 'POST',
    body: { name: 'n', username: 'u1', email: 'e1@e.com', confirmPassword: 'p' },
  })
  log('缺少密码返回 400', r4.status === 400, `status=${r4.status}`)

  // 2.2 密码确认不一致
  const r5 = await apiCall('/api/users/register', {
    method: 'POST',
    body: { name: 'n', username: 'u1', email: 'e1@e.com', password: 'pass123', confirmPassword: 'pass456' },
  })
  log('两次密码不一致返回 400', r5.status === 400 && r5.data.error?.includes('不一致'), `status=${r5.status} err=${r5.data.error}`)

  // 2.3 密码长度不足
  const r6 = await apiCall('/api/users/register', {
    method: 'POST',
    body: { name: 'n', username: 'u_short', email: 'short@example.com', password: '12345', confirmPassword: '12345' },
  })
  log('密码长度不足 6 位返回 400', r6.status === 400 && r6.data.error?.includes('6'), `status=${r6.status} err=${r6.data.error}`)

  // 2.4 邮箱格式错误
  const r7 = await apiCall('/api/users/register', {
    method: 'POST',
    body: { name: 'n', username: 'u_bad', email: 'not-an-email', password: 'pass123', confirmPassword: 'pass123' },
  })
  log('邮箱格式错误返回 400', r7.status === 400 && r7.data.error?.includes('邮箱'), `status=${r7.status} err=${r7.data.error}`)

  // 2.5 邮箱已存在（使用管理员邮箱）
  const r8 = await apiCall('/api/users/register', {
    method: 'POST',
    body: { name: 'n', username: 'dup_email_user', email: ADMIN.email, password: 'pass123', confirmPassword: 'pass123' },
  })
  log('邮箱已存在返回 409', r8.status === 409, `status=${r8.status}`)

  // ── 组3：注册成功 + 默认 PENDING ──
  console.log('\n── 组3：注册成功 + 默认 PENDING ──')
  const regRes = await apiCall('/api/users/register', {
    method: 'POST',
    body: {
      name: '认证测试用户',
      username: testUsername,
      email: testEmail,
      password: testPassword,
      confirmPassword: testPassword,
    },
  })
  log('注册成功返回 201', regRes.status === 201, `status=${regRes.status} err=${regRes.data.error}`)
  log('注册返回 user 对象', !!regRes.data.user, `data=${JSON.stringify(regRes.data.user || {}).slice(0, 120)}`)
  log('注册返回成功提示', !!regRes.data.message?.includes('审批'), `msg=${regRes.data.message}`)
  log('默认 status = PENDING', regRes.data.user?.status === 'PENDING', `status=${regRes.data.user?.status}`)
  log('默认 role = TEMP_VISITOR', regRes.data.user?.role === 'TEMP_VISITOR', `role=${regRes.data.user?.role}`)
  log('返回 username 字段', regRes.data.user?.username === testUsername, `username=${regRes.data.user?.username}`)
  const newUserId = regRes.data.user?.id
  if (newUserId) createdUserIds.push(newUserId)

  // 数据库验证
  const dbUser = newUserId ? await prisma.user.findUnique({ where: { id: newUserId } }) : null
  log('数据库记录 status = PENDING', dbUser?.status === 'PENDING', `status=${dbUser?.status}`)
  log('数据库记录 role = TEMP_VISITOR', dbUser?.role === 'TEMP_VISITOR', `role=${dbUser?.role}`)
  log('数据库记录 username 已存储', dbUser?.username === testUsername, `username=${dbUser?.username}`)
  log('数据库记录 passwordHash 已加密', !!dbUser?.passwordHash && dbUser.passwordHash !== testPassword)

  // 3.1 账户名重复注册
  const r9 = await apiCall('/api/users/register', {
    method: 'POST',
    body: {
      name: '另一个用户',
      username: testUsername,
      email: `another-${suffix}@example.com`,
      password: testPassword,
      confirmPassword: testPassword,
    },
  })
  log('账户名已存在返回 409', r9.status === 409, `status=${r9.status} err=${r9.data.error}`)

  // ── 组4：PENDING 用户不能登录 ──
  console.log('\n── 组4：PENDING 用户登录限制 ──')
  const pendingLoginEmail = await login(testEmail, testPassword).catch(() => '')
  log('PENDING 用户用邮箱登录被拒', !pendingLoginEmail, pendingLoginEmail ? '异常：登录成功' : '登录失败符合预期')

  const pendingLoginUsername = await login(testUsername, testPassword).catch(() => '')
  log('PENDING 用户用账户名登录被拒', !pendingLoginUsername, pendingLoginUsername ? '异常：登录成功' : '登录失败符合预期')

  // 错误密码
  const wrongPwdLogin = await login(testEmail, 'wrongpassword').catch(() => '')
  log('错误密码登录被拒', !wrongPwdLogin)

  // 不存在的用户
  const noUserLogin = await login('nonexistent_user_xyz', testPassword).catch(() => '')
  log('不存在的用户登录被拒', !noUserLogin)

  // ── 组5：管理员审批 - 通过 ──
  console.log('\n── 组5：管理员审批 - 通过 ──')
  // 5.1 非管理员不能访问 admin API
  const noAccessRes = await apiCall('/api/admin/users', { cookie: managerCookie })
  log('投资经理访问 /api/admin/users 返回 403', noAccessRes.status === 403, `status=${noAccessRes.status}`)

  const noAuthRes = await apiCall('/api/admin/users')
  log('未登录访问 /api/admin/users 返回 401', noAuthRes.status === 401, `status=${noAuthRes.status}`)

  // 5.2 管理员获取用户列表（验证 username 字段返回）
  const listRes = await apiCall('/api/admin/users', { cookie: adminCookie })
  log('管理员获取用户列表 200', listRes.status === 200, `status=${listRes.status}`)
  const pendingList = (listRes.data.users || []).filter((u: any) => u.status === 'PENDING')
  log('用户列表包含待审批用户', pendingList.length > 0, `pending=${pendingList.length}`)
  log('用户列表返回 username 字段', pendingList.some((u: any) => u.username), `username存在=${pendingList.some((u: any) => u.username)}`)
  log('pendingCount 字段返回', typeof listRes.data.pendingCount === 'number', `pendingCount=${listRes.data.pendingCount}`)

  // 5.3 管理员通过审批 + 分配角色 INVESTMENT_MANAGER
  const approveRes = await apiCall('/api/admin/users', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { id: newUserId, role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })
  log('管理员审批通过返回 200', approveRes.status === 200, `status=${approveRes.status} err=${approveRes.data.error}`)
  log('审批后返回 username 字段', approveRes.data.user?.username === testUsername, `username=${approveRes.data.user?.username}`)

  // 数据库验证
  const approvedUser = newUserId ? await prisma.user.findUnique({ where: { id: newUserId } }) : null
  log('审批后数据库 status = ACTIVE', approvedUser?.status === 'ACTIVE', `status=${approvedUser?.status}`)
  log('审批后数据库 role = INVESTMENT_MANAGER', approvedUser?.role === 'INVESTMENT_MANAGER', `role=${approvedUser?.role}`)

  // ── 组6：审批通过后可登录 ──
  console.log('\n── 组6：审批通过后登录 ──')
  const loginByEmail = await login(testEmail, testPassword).catch(() => '')
  log('审批后用邮箱登录成功', !!loginByEmail, loginByEmail ? 'OK' : '登录失败')

  const loginByUsername = await login(testUsername, testPassword).catch(() => '')
  log('审批后用账户名登录成功', !!loginByUsername, loginByUsername ? 'OK' : '登录失败')

  // 6.1 验证 session 携带正确角色
  const sessionRes = await apiCall('/api/auth/session', { cookie: loginByUsername })
  log('session 返回 user.role = INVESTMENT_MANAGER', sessionRes.data.user?.role === 'INVESTMENT_MANAGER', `role=${sessionRes.data.user?.role}`)

  // ── 组7：管理员拒绝审批 ──
  console.log('\n── 组7：管理员拒绝审批 ──')
  // 创建第二个待审批用户
  const rejectEmail = `reject-${suffix}@example.com`
  const rejectUsername = `reject_${suffix}`
  const reg2 = await apiCall('/api/users/register', {
    method: 'POST',
    body: {
      name: '拒绝测试',
      username: rejectUsername,
      email: rejectEmail,
      password: testPassword,
      confirmPassword: testPassword,
    },
  })
  const rejectUserId = reg2.data.user?.id
  if (rejectUserId) createdUserIds.push(rejectUserId)
  log('第二个测试用户注册成功', reg2.status === 201, `status=${reg2.status}`)

  // 拒绝
  const rejectRes = await apiCall('/api/admin/users', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { id: rejectUserId, status: 'REJECTED' },
  })
  log('拒绝审批返回 200', rejectRes.status === 200, `status=${rejectRes.status} err=${rejectRes.data.error}`)

  // 数据库验证
  const rejectedUser = rejectUserId ? await prisma.user.findUnique({ where: { id: rejectUserId } }) : null
  log('拒绝后数据库 status = REJECTED', rejectedUser?.status === 'REJECTED', `status=${rejectedUser?.status}`)

  // 拒绝后不能登录
  const rejectedLogin = await login(rejectEmail, testPassword).catch(() => '')
  log('REJECTED 用户不能登录', !rejectedLogin, rejectedLogin ? '异常：登录成功' : '登录失败符合预期')

  // ── 组8：管理员禁用账号 ──
  console.log('\n── 组8：管理员禁用账号 ──')
  const disableRes = await apiCall('/api/admin/users', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { id: newUserId, status: 'DISABLED' },
  })
  log('禁用账号返回 200', disableRes.status === 200, `status=${disableRes.status}`)

  const disabledLogin = await login(testEmail, testPassword).catch(() => '')
  log('DISABLED 用户不能登录', !disabledLogin, disabledLogin ? '异常：登录成功' : '登录失败符合预期')

  // 恢复 ACTIVE 以便后续测试
  await apiCall('/api/admin/users', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { id: newUserId, status: 'ACTIVE' },
  })

  // ── 组9：无效角色/状态校验 ──
  console.log('\n── 组9：无效角色/状态校验 ──')
  const badRoleRes = await apiCall('/api/admin/users', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { id: newUserId, role: 'INVALID_ROLE' },
  })
  log('无效角色返回 400', badRoleRes.status === 400, `status=${badRoleRes.status}`)

  const badStatusRes = await apiCall('/api/admin/users', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { id: newUserId, status: 'INVALID_STATUS' },
  })
  log('无效状态返回 400', badStatusRes.status === 400, `status=${badStatusRes.status}`)

  // ── 组10：源码验证 ──
  console.log('\n── 组10：源码验证 ──')

  // 10.1 Prisma schema: User.username 字段
  const schemaContent = await readFile('./prisma/schema.prisma')
  log('schema.prisma: User 模型包含 username 字段', /username\s+String\?\s+@unique/.test(schemaContent), '需要 username String? @unique')

  // 10.2 auth.ts 支持双模式登录
  const authContent = await readFile('./src/lib/auth.ts')
  log('auth.ts: 标签为"账户名或邮箱"', authContent.includes('账户名或邮箱'))
  log('auth.ts: 包含 @ 符号判断', authContent.includes("includes('@')"))
  log('auth.ts: 按邮箱查询', authContent.includes('where: { email: loginInput }'))
  log('auth.ts: 按账户名查询', authContent.includes('where: { username: loginInput }'))
  log('auth.ts: PENDING 状态禁止登录', authContent.includes("'PENDING'") && authContent.includes('等待管理员审批'))
  log('auth.ts: REJECTED 状态禁止登录', authContent.includes("'REJECTED'"))
  log('auth.ts: DISABLED 状态禁止登录', authContent.includes("'DISABLED'"))

  // 10.3 注册页面：5 个字段
  const registerContent = await readFile('./src/app/auth/register/page.tsx')
  log('register/page.tsx: 包含姓名字段', registerContent.includes('姓名'))
  log('register/page.tsx: 包含账户名字段', registerContent.includes('账户名'))
  log('register/page.tsx: 包含邮箱字段', registerContent.includes('邮箱'))
  log('register/page.tsx: 包含密码字段', registerContent.includes('密码') && registerContent.includes('password'))
  log('register/page.tsx: 包含确认密码字段', registerContent.includes('确认密码') && registerContent.includes('confirmPassword'))
  log('register/page.tsx: 提交后提示等待审批', registerContent.includes('等待管理员审批'))
  log('register/page.tsx: 底部返回登录链接', registerContent.includes('href="/auth/login"'))

  // 10.4 登录页面
  const loginContent = await readFile('./src/app/auth/login/page.tsx')
  log('login/page.tsx: 导入 Link from next/link', /import\s+Link\s+from\s+['"]next\/link['"]/.test(loginContent))
  log('login/page.tsx: 标签为"账户名或邮箱"', loginContent.includes('账户名或邮箱'))
  log('login/page.tsx: input type="text"（允许账户名）', /type="text"/.test(loginContent))
  log('login/page.tsx: autoComplete="username"', loginContent.includes('autoComplete="username"'))
  log('login/page.tsx: 底部立即注册链接', loginContent.includes('href="/auth/register"') && loginContent.includes('立即注册'))

  // 10.5 DashboardLayout: 退出按钮跳转到 /auth/login
  const layoutContent = await readFile('./src/components/DashboardLayout.tsx')
  log('DashboardLayout: signOut callbackUrl=/auth/login', layoutContent.includes("signOut({ callbackUrl: '/auth/login' })"))

  // 10.6 注册 API
  const regApiContent = await readFile('./src/app/api/users/register/route.ts')
  log('register API: 接受 name/username/email/password/confirmPassword', regApiContent.includes('confirmPassword'))
  log('register API: 默认 role=TEMP_VISITOR', regApiContent.includes("role: 'TEMP_VISITOR'"))
  log('register API: 默认 status=PENDING', regApiContent.includes("status: 'PENDING'"))
  log('register API: 密码长度≥6 校验', regApiContent.includes('password.length < 6'))
  log('register API: 邮箱格式校验', regApiContent.includes('emailRegex'))
  log('register API: 密码确认校验', regApiContent.includes('password !== confirmPassword'))
  log('register API: 邮箱唯一性检查', regApiContent.includes('existingEmail'))
  log('register API: 账户名唯一性检查', regApiContent.includes('existingUsername'))
  log('register API: bcrypt 加密', regApiContent.includes('bcrypt.hash'))

  // 10.7 管理员用户 API
  const adminApiContent = await readFile('./src/app/api/admin/users/route.ts')
  log('admin/users API: GET 返回 username 字段', adminApiContent.includes('username: true'))
  log('admin/users API: PATCH 返回 username 字段', /select:\s*\{[^}]*username:\s*true/.test(adminApiContent))

  // 10.8 管理员用户页面
  const adminPageContent = await readFile('./src/app/admin/users/page.tsx')
  log('admin/users page: interface 包含 username', /username:\s*string\s*\|\s*null/.test(adminPageContent))
  log('admin/users page: 表头包含"账户名"', adminPageContent.includes('账户名'))
  log('admin/users page: 显示 user.username', adminPageContent.includes('user.username'))
  log('admin/users page: 待审批"通过"按钮', adminPageContent.includes("handleUpdateUser(user.id, user.role, 'ACTIVE')") && adminPageContent.includes('通过'))
  log('admin/users page: 待审批"拒绝"按钮', adminPageContent.includes("handleUpdateUser(user.id, user.role, 'REJECTED')") && adminPageContent.includes('拒绝'))
  log('admin/users page: 编辑模式下角色下拉', adminPageContent.includes('roleLabels') && adminPageContent.includes('<select'))

  // ── 组11：清理测试数据 ──
  console.log('\n── 组11：清理测试数据 ──')
  for (const id of createdUserIds) {
    try {
      await prisma.user.delete({ where: { id } })
      console.log(`  · 已删除用户: ${id}`)
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
  // 清理
  for (const id of createdUserIds) {
    try { await prisma.user.delete({ where: { id } }) } catch {}
  }
  await prisma.$disconnect()
  process.exit(1)
})
