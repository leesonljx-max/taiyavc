/**
 * 测试脚本：管理员删除账号 + 用户个人设置（姓名/密码/头像）
 *
 * 测试覆盖：
 * 1. 管理员删除账号（API + 权限校验 + 不能删除自己）
 * 2. 用户修改姓名（API + 校验）
 * 3. 用户修改密码（API + 旧密码验证 + 校验）
 * 4. 头像上传（API + 文件校验）
 * 5. 源码验证（UI 组件 + 弹窗 + 头像可点击）
 *
 * 运行: npx tsx scripts/test-admin-delete-and-profile.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { readFile } from 'fs/promises'
import path from 'path'

const BASE_URL = 'http://localhost:3000'
const prisma = new PrismaClient()

const ADMIN = { email: 'admin-test@example.com', password: 'admin123' }

interface TestResult { name: string; passed: boolean; detail?: string }
const results: TestResult[] = []
const createdUserIds: string[] = []

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

async function apiCall(path: string, options: { method?: string; cookie?: string; body?: any; headers?: Record<string, string> } = {}): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.cookie ? { Cookie: options.cookie } : {}), ...options.headers },
    body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function readFileContent(p: string): Promise<string> {
  return readFile(p, 'utf-8')
}

async function main() {
  console.log('\n========================================')
  console.log('  管理员删除账号 + 用户个人设置测试')
  console.log('========================================\n')

  // ── 组1：管理员登录 ──
  console.log('── 组1：管理员登录 ──')
  const adminCookie = await login(ADMIN.email, ADMIN.password).catch(() => '')
  log('管理员登录', !!adminCookie)

  // ── 组2：创建测试用户 ──
  console.log('\n── 组2：创建测试用户 ──')
  const suffix = Date.now()
  const testUserPwd = 'test123456'
  const passwordHash = await bcrypt.hash(testUserPwd, 10)

  const testUser1 = await prisma.user.create({
    data: {
      email: `delete-test-${suffix}@example.com`,
      username: `delete_test_${suffix}`,
      passwordHash,
      name: `删除测试用户_${suffix}`,
      role: 'INVESTMENT_MANAGER',
      status: 'ACTIVE',
    },
  })
  createdUserIds.push(testUser1.id)
  log('创建测试用户1（用于删除）', !!testUser1.id)

  const testUser2 = await prisma.user.create({
    data: {
      email: `profile-test-${suffix}@example.com`,
      username: `profile_test_${suffix}`,
      passwordHash,
      name: `个人设置测试用户_${suffix}`,
      role: 'INVESTMENT_MANAGER',
      status: 'ACTIVE',
    },
  })
  createdUserIds.push(testUser2.id)
  log('创建测试用户2（用于个人设置）', !!testUser2.id)

  const user2Cookie = await login(testUser2.email, testUserPwd).catch(() => '')
  log('测试用户2登录', !!user2Cookie)

  // ════════════════════════════════════════
  // 组3-6：管理员删除账号
  // ════════════════════════════════════════
  console.log('\n── 组3：管理员删除账号 - 正常删除 ──')

  // 3.1 管理员删除 testUser1
  const deleteRes = await apiCall(`/api/admin/users?id=${testUser1.id}`, {
    method: 'DELETE',
    cookie: adminCookie,
  })
  log('DELETE /api/admin/users 返回 200', deleteRes.status === 200, `status=${deleteRes.status} err=${deleteRes.data.error}`)

  // 3.2 验证用户已被删除
  const deletedUser = await prisma.user.findUnique({ where: { id: testUser1.id } })
  log('数据库中用户已被删除', !deletedUser)

  // 从清理列表中移除已删除的
  const idx = createdUserIds.indexOf(testUser1.id)
  if (idx >= 0) createdUserIds.splice(idx, 1)

  console.log('\n── 组4：管理员删除账号 - 权限校验 ──')

  // 4.1 未登录不能删除
  const noAuthDelete = await apiCall(`/api/admin/users?id=${testUser2.id}`, { method: 'DELETE' })
  log('未登录删除返回 401', noAuthDelete.status === 401, `status=${noAuthDelete.status}`)

  // 4.2 非管理员不能删除
  const nonAdminDelete = await apiCall(`/api/admin/users?id=${testUser2.id}`, {
    method: 'DELETE',
    cookie: user2Cookie,
  })
  log('非管理员删除返回 403', nonAdminDelete.status === 403, `status=${nonAdminDelete.status}`)

  console.log('\n── 组5：管理员删除账号 - 不能删除自己 ──')

  // 5.1 管理员删除自己
  const selfDelete = await apiCall(`/api/admin/users?id=admin-test-user-id`, {
    method: 'DELETE',
    cookie: adminCookie,
  })
  // 获取管理员 ID
  const adminUser = await prisma.user.findUnique({ where: { email: ADMIN.email } })
  const selfDeleteRes = await apiCall(`/api/admin/users?id=${adminUser?.id}`, {
    method: 'DELETE',
    cookie: adminCookie,
  })
  log('管理员删除自己返回 400', selfDeleteRes.status === 400, `status=${selfDeleteRes.status}`)
  log('错误消息为"不能删除自己的账号"', selfDeleteRes.data.error === '不能删除自己的账号', `error=${selfDeleteRes.data.error}`)

  console.log('\n── 组6：管理员删除账号 - 不存在的用户 ──')
  const notExistDelete = await apiCall(`/api/admin/users?id=non-existent-id`, {
    method: 'DELETE',
    cookie: adminCookie,
  })
  log('删除不存在用户返回 404', notExistDelete.status === 404, `status=${notExistDelete.status}`)

  // 6.1 缺少 id 参数
  const noIdDelete = await apiCall(`/api/admin/users`, {
    method: 'DELETE',
    cookie: adminCookie,
  })
  log('缺少 id 参数返回 400', noIdDelete.status === 400, `status=${noIdDelete.status}`)

  // ════════════════════════════════════════
  // 组7-9：用户修改姓名
  // ════════════════════════════════════════
  console.log('\n── 组7：用户修改姓名 - 正常修改 ──')

  const newName = `修改后姓名_${suffix}`
  const updateNameRes = await apiCall('/api/user/profile', {
    method: 'PATCH',
    cookie: user2Cookie,
    body: { name: newName },
  })
  log('PATCH /api/user/profile 返回 200', updateNameRes.status === 200, `status=${updateNameRes.status} err=${updateNameRes.data.error}`)
  log('响应包含新姓名', updateNameRes.data.user?.name === newName, `actual=${updateNameRes.data.user?.name}`)

  // 验证数据库
  const dbUser2 = await prisma.user.findUnique({ where: { id: testUser2.id } })
  log('数据库姓名已更新', dbUser2?.name === newName, `actual=${dbUser2?.name}`)

  console.log('\n── 组8：用户修改姓名 - 校验 ──')

  // 8.1 空姓名
  const emptyNameRes = await apiCall('/api/user/profile', {
    method: 'PATCH',
    cookie: user2Cookie,
    body: { name: '' },
  })
  log('空姓名返回 400', emptyNameRes.status === 400, `status=${emptyNameRes.status}`)

  // 8.2 超长姓名（>50字符）
  const longNameRes = await apiCall('/api/user/profile', {
    method: 'PATCH',
    cookie: user2Cookie,
    body: { name: 'a'.repeat(51) },
  })
  log('超长姓名返回 400', longNameRes.status === 400, `status=${longNameRes.status}`)

  console.log('\n── 组9：用户修改姓名 - 未登录 ──')
  const noAuthProfileRes = await apiCall('/api/user/profile', {
    method: 'PATCH',
    body: { name: 'test' },
  })
  log('未登录修改姓名返回 401', noAuthProfileRes.status === 401, `status=${noAuthProfileRes.status}`)

  // ════════════════════════════════════════
  // 组10-12：用户修改密码
  // ════════════════════════════════════════
  console.log('\n── 组10：用户修改密码 - 正常修改 ──')

  const newPassword = 'newpass654321'
  const changePwdRes = await apiCall('/api/user/password', {
    method: 'PATCH',
    cookie: user2Cookie,
    body: { currentPassword: testUserPwd, newPassword },
  })
  log('PATCH /api/user/password 返回 200', changePwdRes.status === 200, `status=${changePwdRes.status} err=${changePwdRes.data.error}`)
  log('成功消息', changePwdRes.data.message === '密码修改成功', `message=${changePwdRes.data.message}`)

  // 验证新密码可以登录
  const newLoginCookie = await login(testUser2.email, newPassword).catch(() => '')
  log('新密码可以登录', !!newLoginCookie)

  // 验证旧密码不能登录
  const oldPwdLogin = await login(testUser2.email, testUserPwd).catch(() => '')
  log('旧密码不能登录', !oldPwdLogin)

  console.log('\n── 组11：用户修改密码 - 旧密码错误 ──')
  const wrongPwdRes = await apiCall('/api/user/password', {
    method: 'PATCH',
    cookie: newLoginCookie,
    body: { currentPassword: 'wrongpassword', newPassword: 'another789' },
  })
  log('旧密码错误返回 400', wrongPwdRes.status === 400, `status=${wrongPwdRes.status}`)
  log('错误消息为"当前密码错误"', wrongPwdRes.data.error === '当前密码错误', `error=${wrongPwdRes.data.error}`)

  console.log('\n── 组12：用户修改密码 - 校验 ──')

  // 12.1 新密码太短
  const shortPwdRes = await apiCall('/api/user/password', {
    method: 'PATCH',
    cookie: newLoginCookie,
    body: { currentPassword: newPassword, newPassword: '123' },
  })
  log('新密码太短返回 400', shortPwdRes.status === 400, `status=${shortPwdRes.status}`)

  // 12.2 缺少必填字段
  const missingPwdRes = await apiCall('/api/user/password', {
    method: 'PATCH',
    cookie: newLoginCookie,
    body: { currentPassword: newPassword },
  })
  log('缺少新密码返回 400', missingPwdRes.status === 400, `status=${missingPwdRes.status}`)

  // 12.3 未登录
  const noAuthPwdRes = await apiCall('/api/user/password', {
    method: 'PATCH',
    body: { currentPassword: 'x', newPassword: 'y' },
  })
  log('未登录修改密码返回 401', noAuthPwdRes.status === 401, `status=${noAuthPwdRes.status}`)

  // ════════════════════════════════════════
  // 组13：头像上传
  // ════════════════════════════════════════
  console.log('\n── 组13：头像上传 ──')

  // 13.1 创建一个简单的 PNG 图片（1x1 像素）
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
  const formData = new FormData()
  formData.append('file', new Blob([pngBuffer], { type: 'image/png' }), 'test-avatar.png')

  const avatarRes = await fetch(`${BASE_URL}/api/user/avatar`, {
    method: 'POST',
    headers: { Cookie: newLoginCookie },
    body: formData,
  })
  const avatarData = await avatarRes.json()
  log('POST /api/user/avatar 返回 200', avatarRes.status === 200, `status=${avatarRes.status} err=${avatarData.error}`)
  log('响应包含 avatar URL', !!avatarData.avatar, `avatar=${avatarData.avatar}`)
  log('avatar URL 以 /avatars/ 开头', avatarData.avatar?.startsWith('/avatars/'), `avatar=${avatarData.avatar}`)

  // 验证数据库
  const dbUser2Avatar = await prisma.user.findUnique({ where: { id: testUser2.id } })
  log('数据库 avatar 已更新', dbUser2Avatar?.avatar === avatarData.avatar, `actual=${dbUser2Avatar?.avatar}`)

  // 13.2 未登录上传头像
  const noAuthAvatarRes = await fetch(`${BASE_URL}/api/user/avatar`, {
    method: 'POST',
    body: formData,
  })
  log('未登录上传头像返回 401', noAuthAvatarRes.status === 401, `status=${noAuthAvatarRes.status}`)

  // 13.3 不带文件
  const noFileRes = await fetch(`${BASE_URL}/api/user/avatar`, {
    method: 'POST',
    headers: { Cookie: newLoginCookie },
    body: new FormData(),
  })
  log('不带文件返回 400', noFileRes.status === 400, `status=${noFileRes.status}`)

  // ════════════════════════════════════════
  // 组14-18：源码验证
  // ════════════════════════════════════════
  console.log('\n── 组14：源码验证 - Prisma schema ──')
  const schemaContent = await readFileContent('./prisma/schema.prisma')
  log('schema.prisma: User 有 avatar 字段', /avatar\s+String\?/.test(schemaContent))

  console.log('\n── 组15：源码验证 - auth.ts ──')
  const authContent = await readFileContent('./src/lib/auth.ts')
  log('auth.ts: authorize 返回 avatar', authContent.includes('avatar: user.avatar'))
  log('auth.ts: jwt callback 包含 avatar', authContent.includes('token.avatar'))
  log('auth.ts: session callback 包含 avatar', authContent.includes('session.user.avatar'))

  console.log('\n── 组16：源码验证 - 管理员删除 API ──')
  const adminApiContent = await readFileContent('./src/app/api/admin/users/route.ts')
  log('api/admin/users: 有 DELETE 方法', adminApiContent.includes('export async function DELETE'))
  log('api/admin/users: 防止删除自己', adminApiContent.includes('不能删除自己的账号'))
  log('api/admin/users: 检查用户存在', adminApiContent.includes('用户不存在'))
  log('api/admin/users: 权限校验 canManageUsers', adminApiContent.includes('canManageUsers'))

  console.log('\n── 组17：源码验证 - 管理员后台 UI ──')
  const adminPageContent = await readFileContent('./src/app/admin/users/page.tsx')
  log('admin/users: 有删除按钮', adminPageContent.includes('删除'))
  log('admin/users: 有删除确认弹窗', adminPageContent.includes('deletingUser'))
  log('admin/users: 有 handleDeleteUser 函数', adminPageContent.includes('handleDeleteUser'))
  log('admin/users: 不删除自己（user.id !== session.user.id）', adminPageContent.includes('user.id !== session.user.id'))
  log('admin/users: 确认弹窗显示用户名', adminPageContent.includes('确认删除账号'))

  console.log('\n── 组18：源码验证 - 个人设置弹窗 + DashboardLayout ──')
  const modalContent = await readFileContent('./src/components/ProfileEditModal.tsx')
  log('ProfileEditModal: 有修改姓名 tab', modalContent.includes("key: 'info'"))
  log('ProfileEditModal: 有修改密码 tab', modalContent.includes("key: 'password'"))
  log('ProfileEditModal: 有修改头像 tab', modalContent.includes("key: 'avatar'"))
  log('ProfileEditModal: 调用 /api/user/profile', modalContent.includes('/api/user/profile'))
  log('ProfileEditModal: 调用 /api/user/password', modalContent.includes('/api/user/password'))
  log('ProfileEditModal: 调用 /api/user/avatar', modalContent.includes('/api/user/avatar'))
  log('ProfileEditModal: 密码确认校验', modalContent.includes('两次输入的新密码不一致'))
  log('ProfileEditModal: 头像文件大小校验', modalContent.includes('2MB'))

  const layoutContent = await readFileContent('./src/components/DashboardLayout.tsx')
  log('DashboardLayout: 导入 ProfileEditModal', layoutContent.includes('ProfileEditModal'))
  log('DashboardLayout: 有 profileModalOpen 状态', layoutContent.includes('profileModalOpen'))
  log('DashboardLayout: 头像可点击（onClick setProfileModalOpen）', layoutContent.includes('setProfileModalOpen(true)'))
  log('DashboardLayout: 头像显示 Image 组件', layoutContent.includes('session.user?.avatar'))
  log('DashboardLayout: 渲染 ProfileEditModal', layoutContent.includes('<ProfileEditModal'))

  console.log('\n── 组19：源码验证 - 用户 API ──')
  const profileApiContent = await readFileContent('./src/app/api/user/profile/route.ts')
  log('api/user/profile: 有 PATCH 方法', profileApiContent.includes('export async function PATCH'))
  log('api/user/profile: 姓名校验（非空）', profileApiContent.includes('姓名不能为空'))
  log('api/user/profile: 姓名长度校验（50字符）', profileApiContent.includes('50'))

  const passwordApiContent = await readFileContent('./src/app/api/user/password/route.ts')
  log('api/user/password: 有 PATCH 方法', passwordApiContent.includes('export async function PATCH'))
  log('api/user/password: 验证旧密码（bcrypt.compare）', passwordApiContent.includes('bcrypt.compare'))
  log('api/user/password: 密码长度校验（6位）', passwordApiContent.includes('6'))
  log('api/user/password: 旧密码错误提示', passwordApiContent.includes('当前密码错误'))

  const avatarApiContent = await readFileContent('./src/app/api/user/avatar/route.ts')
  log('api/user/avatar: 有 POST 方法', avatarApiContent.includes('export async function POST'))
  log('api/user/avatar: 文件类型校验', avatarApiContent.includes('allowedTypes'))
  log('api/user/avatar: 文件大小校验（2MB）', avatarApiContent.includes('2MB'))
  log('api/user/avatar: 保存到 public/avatars/', avatarApiContent.includes('avatars'))

  console.log('\n── 组20：源码验证 - next-auth 类型 ──')
  const typeContent = await readFileContent('./src/types/next-auth.d.ts')
  log('next-auth.d.ts: Session.user 有 avatar', typeContent.includes('avatar?: string'))
  log('next-auth.d.ts: JWT 有 avatar', typeContent.includes('avatar?: string'))

  // ── 组21：清理测试数据 ──
  console.log('\n── 组21：清理测试数据 ──')
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
  for (const id of createdUserIds) {
    try { await prisma.user.delete({ where: { id } }) } catch {}
  }
  await prisma.$disconnect()
  process.exit(1)
})
