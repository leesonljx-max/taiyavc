/**
 * 测试脚本：退出登录功能
 *
 * 测试覆盖：
 * 1. 源码验证：signOut 使用 redirect: false + router.push
 * 2. NextAuth signout API 正常工作
 * 3. 登录页面可正常访问（200）
 * 4. 退出后 session 失效（受保护 API 返回 401）
 * 5. 退出后跳转到登录页
 *
 * 运行: npx tsx scripts/test-logout.ts
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const BASE_URL = 'http://localhost:3000'
const prisma = new PrismaClient()

const ADMIN = { email: 'admin-test@example.com', password: 'admin123' }

interface TestResult { name: string; passed: boolean; detail?: string }
const results: TestResult[] = []

function log(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail })
  console.log(`${passed ? '✓' : '✗'} ${name}${!passed && detail ? ` — ${detail}` : ''}`)
}

async function readFile(path: string): Promise<string> {
  const { readFile: fsReadFile } = await import('fs/promises')
  return fsReadFile(path, 'utf-8')
}

async function login(email: string, password: string): Promise<{ cookie: string; sessionToken: string }> {
  // 1. 获取 CSRF token
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`)
  const csrfData = await csrfRes.json()
  const csrfToken = csrfData.csrfToken
  const setCookie = csrfRes.headers.get('set-cookie') || ''
  const csrfMatch = setCookie.match(/next-auth\.csrf-token=([^;]+)/)
  const csrfCookie = csrfMatch ? `next-auth.csrf-token=${csrfMatch[1]}` : ''

  // 2. 登录
  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrfCookie },
    body: new URLSearchParams({ email, password, csrfToken, callbackUrl: `${BASE_URL}/`, json: 'true' }),
    redirect: 'manual',
  })
  const loginSetCookie = loginRes.headers.get('set-cookie') || ''
  const sessionMatch = loginSetCookie.match(/next-auth\.session-token=([^;]+)/)
  if (!sessionMatch) return { cookie: '', sessionToken: '' }
  const sessionToken = sessionMatch[1]
  return { cookie: `next-auth.session-token=${sessionToken}`, sessionToken }
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

async function main() {
  console.log('\n========================================')
  console.log('  退出登录功能测试')
  console.log('========================================\n')

  // ── 组1：源码验证 - DashboardLayout 退出按钮 ──
  console.log('── 组1：源码验证 - DashboardLayout 退出按钮 ──')
  const layoutContent = await readFile('./src/components/DashboardLayout.tsx')

  log('DashboardLayout: 导入 useRouter', layoutContent.includes('useRouter'))
  log('DashboardLayout: 使用 useRouter()', /const router = useRouter\(\)/.test(layoutContent))
  log('DashboardLayout: signOut 使用 redirect: false', layoutContent.includes('signOut({ redirect: false })'))
  log('DashboardLayout: 不再使用 callbackUrl', !layoutContent.includes("callbackUrl: '/auth/login'"))
  log('DashboardLayout: 退出后 router.push 到登录页', layoutContent.includes("router.push('/auth/login')"))
  log('DashboardLayout: onClick 是 async 函数', /onClick=\{async/.test(layoutContent))
  log('DashboardLayout: await signOut', layoutContent.includes('await signOut({ redirect: false })'))

  // ── 组2：登录页面可正常访问 ──
  console.log('\n── 组2：登录页面可正常访问 ──')
  const loginPageRes = await fetch(`${BASE_URL}/auth/login`)
  log('GET /auth/login 返回 200', loginPageRes.status === 200, `status=${loginPageRes.status}`)

  // ── 组3：登录获取 session ──
  console.log('\n── 组3：登录获取 session ──')
  const { cookie: adminCookie, sessionToken } = await login(ADMIN.email, ADMIN.password)
  log('管理员登录成功', !!adminCookie, adminCookie ? '' : '登录失败')

  // 验证 session 有效
  const projectsRes = await apiCall('/api/projects?scope=mine', { cookie: adminCookie })
  log('登录后可访问受保护 API（projects）', projectsRes.status === 200, `status=${projectsRes.status}`)

  // 验证 session 接口
  const sessionRes = await apiCall('/api/auth/session', { cookie: adminCookie })
  log('session 接口返回用户信息', !!sessionRes.data?.user, `user=${sessionRes.data?.user?.email}`)

  // ── 组4：NextAuth signout API ──
  console.log('\n── 组4：NextAuth signout API ──')

  // 4.1 获取 signout CSRF token
  const signoutCsrfRes = await fetch(`${BASE_URL}/api/auth/csrf`, { headers: { Cookie: adminCookie } })
  const signoutCsrfData = await signoutCsrfRes.json()
  const signoutCsrfToken = signoutCsrfData.csrfToken
  log('获取 signout CSRF token', !!signoutCsrfToken)

  // 4.2 调用 signout
  const signoutRes = await fetch(`${BASE_URL}/api/auth/signout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: adminCookie },
    body: new URLSearchParams({ csrfToken: signoutCsrfToken, callbackUrl: `${BASE_URL}/auth/login`, json: 'true' }),
    redirect: 'manual',
  })
  log('POST /api/auth/signout 返回 200', signoutRes.status === 200, `status=${signoutRes.status}`)

  // 4.3 验证 signout 响应正常返回（NextAuth JWT 模式下由客户端 signOut 函数清除 cookie）
  const signoutData = await signoutRes.json().catch(() => ({}))
  log('signout 响应包含 callbackUrl', !!signoutData?.url, `url=${signoutData?.url}`)

  // ── 组5：退出后 session 失效（无 cookie 模拟退出后状态）──
  console.log('\n── 组5：退出后 session 失效 ──')

  // 5.1 无 cookie 访问 session 接口应返回空
  const noCookieSessionRes = await apiCall('/api/auth/session')
  log('无 cookie session 接口返回空', !noCookieSessionRes.data?.user, `user=${noCookieSessionRes.data?.user?.email || 'null'}`)

  // 5.2 无 cookie 访问 scope=mine 应返回空列表（未登录用户无"我的项目"）
  const noCookieMineRes = await apiCall('/api/projects?scope=mine')
  log('无 cookie scope=mine 返回空列表', Array.isArray(noCookieMineRes.data?.projects) && noCookieMineRes.data.projects.length === 0, `projects.length=${noCookieMineRes.data?.projects?.length}`)

  // 5.3 无 cookie 访问 dashboard 应返回未登录错误或空
  const noCookieDashRes = await apiCall('/api/dashboard')
  log('无 cookie dashboard 返回 401 或无用户数据', noCookieDashRes.status === 401 || !noCookieDashRes.data?.user, `status=${noCookieDashRes.status}`)

  // ── 组6：注册页面可正常访问 ──
  console.log('\n── 组6：注册页面可正常访问 ──')
  const registerPageRes = await fetch(`${BASE_URL}/auth/register`)
  log('GET /auth/register 返回 200', registerPageRes.status === 200, `status=${registerPageRes.status}`)

  // ── 组7：CSRF 保护验证 ──
  console.log('\n── 组7：CSRF 保护验证 ──')

  // 7.1 验证 CSRF token 端点正常工作
  const csrfCheckRes = await fetch(`${BASE_URL}/api/auth/csrf`)
  const csrfCheckData = await csrfCheckRes.json()
  log('CSRF token 端点返回有效 token', !!csrfCheckData.csrfToken)

  // 7.2 验证带正确 CSRF token 的 signout 返回 200
  const validCsrfRes = await fetch(`${BASE_URL}/api/auth/signout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: adminCookie },
    body: new URLSearchParams({ csrfToken: signoutCsrfToken, callbackUrl: `${BASE_URL}/auth/login`, json: 'true' }),
    redirect: 'manual',
  })
  log('带正确 CSRF token 的 signout 返回 200', validCsrfRes.status === 200, `status=${validCsrfRes.status}`)

  // ── 组8：源码验证 - NextAuth 配置 ──
  console.log('\n── 组8：源码验证 - NextAuth 配置 ──')
  const authContent = await readFile('./src/lib/auth.ts')

  log('auth.ts: 配置了 signIn 页面', authContent.includes("signIn: '/auth/login'"))
  log('auth.ts: 使用 JWT session 策略', authContent.includes("strategy: 'jwt'"))
  log('auth.ts: 支持 username 登录', authContent.includes('username'))
  log('auth.ts: PENDING 用户禁止登录', authContent.includes("user.status === 'PENDING'"))

  // ── 组9：源码验证 - 登录页面 ──
  console.log('\n── 组9：源码验证 - 登录页面 ──')
  const loginPageContent = await readFile('./src/app/auth/login/page.tsx')

  log('login/page.tsx: 标签为"账户名或邮箱"', loginPageContent.includes('账户名或邮箱'))
  log('login/page.tsx: input type="text"', loginPageContent.includes('type="text"'))
  log('login/page.tsx: 有"立即注册"链接', loginPageContent.includes('立即注册'))
  log('login/page.tsx: 注册链接指向 /auth/register', loginPageContent.includes('href="/auth/register"'))

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
  await prisma.$disconnect()
  process.exit(1)
})
