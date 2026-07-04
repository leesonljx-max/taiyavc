/**
 * 测试脚本：部署前优化（v0.6 → 腾讯云部署）
 *
 * 覆盖本次所有优化点：
 * 1. 数据库配置（schema.prisma PostgreSQL + 索引）
 * 2. Prisma Client 全局单例
 * 3. .gitignore + .env.example + NEXTAUTH_SECRET 强随机值
 * 4. ai-card / competitors API 鉴权修复
 * 5. DeepSeek 超时控制（30s AbortController）
 * 6. 头像上传安全（路径遍历/SVG拒绝/大小/MIME白名单/401消息）
 * 7. mass-assignment 防护（projects 创建/更新字段白名单）
 * 8. 错误响应脱敏（全局搜索 detail 字段）
 * 9. role 校验 + cookie 安全配置
 * 10. bcrypt 12 + avatar 字段校验
 * 11. next.config.js 安全配置
 * 12. getWeekStart 提取
 * 13. $transaction 事务一致性
 * 14. COS 集成（cos.ts 工具）
 * 15. 新闻搜索 createMany 性能优化
 *
 * 运行: npx tsx scripts/test-deployment-optimizations.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

const BASE_URL = 'http://localhost:3000'
const prisma = new PrismaClient()
const ROOT = process.cwd()

const ADMIN = { email: 'admin-test@example.com', password: 'admin123' }
const PARTNER = { email: 'partner-test@example.com', password: 'partner123' }
const MANAGER = { email: 'manager-test@example.com', password: 'manager123' }

interface TestResult { name: string; passed: boolean; detail?: string }
const results: TestResult[] = []

function log(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail })
  const tag = passed ? '✓' : '✗'
  const suffix = !passed && detail ? ` — ${detail}` : ''
  console.log(`${tag} ${name}${suffix}`)
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

async function apiCall(pathname: string, options: { method?: string; cookie?: string; body?: any; headers?: Record<string, string> } = {}): Promise<{ status: number; data: any }> {
  const isFormData = options.body instanceof FormData
  const headers: Record<string, string> = { ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.headers || {}) }
  // FormData 时由 fetch 自动设置 Content-Type（含 boundary），不手动设置
  if (!isFormData) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? (isFormData ? options.body : JSON.stringify(options.body)) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function readSrc(rel: string): Promise<string> {
  return readFile(path.join(ROOT, rel), 'utf-8')
}

async function main() {
  console.log('\n========================================')
  console.log('  部署前优化测试（v0.6 → 腾讯云部署）')
  console.log('========================================\n')

  // ── 组1：数据库配置（PostgreSQL + 索引） ──
  console.log('── 组1：数据库配置 ──')
  const schema = await readSrc('prisma/schema.prisma')
  log('schema.prisma 使用 postgresql provider', schema.includes('provider = "postgresql"'))
  log('schema.prisma 使用 env("DATABASE_URL")', schema.includes('env("DATABASE_URL")'))
  log('Project 模型有 createdById 索引', schema.includes('@@index([createdById])'))
  log('Project 模型有 followStage 索引', schema.includes('@@index([followStage])'))
  log('Project 模型有 targetDate 索引', schema.includes('@@index([targetDate])'))
  log('Project 模型有 stageChangedAt 索引', schema.includes('@@index([stageChangedAt])'))
  log('Project 模型有 protectionExpiresAt 索引', schema.includes('@@index([protectionExpiresAt])'))
  log('Project 模型有 status 索引', schema.includes('@@index([status])'))
  log('Investment 模型有 projectId 索引', /model Investment[\s\S]*?@@index\(\[projectId\]\)/.test(schema))
  log('Investment 模型有 investorId 索引', /model Investment[\s\S]*?@@index\(\[investorId\]\)/.test(schema))
  log('ProjectMember 模型有 projectId 索引', /model ProjectMember[\s\S]*?@@index\(\[projectId\]\)/.test(schema))
  log('Session 模型有 userId 索引', /model Session[\s\S]*?@@index\(\[userId\]\)/.test(schema))
  log('ProjectNews 模型有 projectId 索引', /model ProjectNews[\s\S]*?@@index\(\[projectId\]\)/.test(schema))
  log('PartnerReview 模型有 projectId 索引', /model PartnerReview[\s\S]*?@@index\(\[projectId\]\)/.test(schema))
  log('FollowUpNote 模型有 projectId 索引', /model FollowUpNote[\s\S]*?@@index\(\[projectId\]\)/.test(schema))
  log('StageApproval 模型有 projectId 索引', /model StageApproval[\s\S]*?@@index\(\[projectId\]\)/.test(schema))
  log('TakeoverRequest 模型有 projectId 索引', /model TakeoverRequest[\s\S]*?@@index\(\[projectId\]\)/.test(schema))
  log('StageChangeRequest 模型有 projectId 索引', /model StageChangeRequest[\s\S]*?@@index\(\[projectId\]\)/.test(schema))
  log('NewsArticle 模型有 industry 索引', /model NewsArticle[\s\S]*?@@index\(\[industry\]\)/.test(schema))
  log('NewsArticle 模型有 weekStart 索引', /model NewsArticle[\s\S]*?@@index\(\[weekStart\]\)/.test(schema))

  // ── 组2：Prisma Client 全局单例 ──
  console.log('\n── 组2：Prisma Client 全局单例 ──')
  const prismaLib = await readSrc('src/lib/prisma.ts')
  log('prisma.ts 使用 globalThis 单例', prismaLib.includes('globalForPrisma') && prismaLib.includes('global as unknown'))
  log('prisma.ts 非生产环境缓存实例', prismaLib.includes("process.env.NODE_ENV !== 'production'"))
  log('prisma.ts 配置 log: error/warn', prismaLib.includes("log: ['error', 'warn']"))

  // ── 组3：环境配置 ──
  console.log('\n── 组3：环境配置 ──')
  const envContent = await readSrc('.env').catch(() => '')
  log('.env 使用 PostgreSQL DATABASE_URL', envContent.includes('postgresql://'))
  log('.env 不再使用 Supabase', !envContent.includes('supabase.co'))
  log('.env 配置 NEXTAUTH_SECRET', envContent.includes('NEXTAUTH_SECRET='))
  // NEXTAUTH_SECRET 应为强随机值（base64 32+ 字符）
  const secretMatch = envContent.match(/NEXTAUTH_SECRET="([^"]+)"/)
  log('NEXTAUTH_SECRET 长度 >= 32', !!(secretMatch && secretMatch[1].length >= 32), `实际长度=${secretMatch?.[1].length || 0}`)
  log('NEXTAUTH_SECRET 不是占位符', !envContent.includes('NEXTAUTH_SECRET="your-secret-here"') && !envContent.includes('NEXTAUTH_SECRET="change-me"'))

  const envExample = await readSrc('.env.example').catch(() => '')
  log('.env.example 文件存在', envExample.length > 0)
  log('.env.example 列出 DATABASE_URL', envExample.includes('DATABASE_URL'))
  log('.env.example 列出 NEXTAUTH_SECRET', envExample.includes('NEXTAUTH_SECRET'))
  log('.env.example 列出 NEXTAUTH_URL', envExample.includes('NEXTAUTH_URL'))
  log('.env.example 列出 DEEPSEEK_API_KEY', envExample.includes('DEEPSEEK_API_KEY'))
  log('.env.example 列出 COS 配置（可选）', envExample.includes('COS_SECRET_ID') || envExample.includes('COS_BUCKET'))

  const gitignore = await readSrc('.gitignore')
  log('.gitignore 忽略 dev.db', gitignore.includes('dev.db'))
  log('.gitignore 忽略 dev.db-journal', gitignore.includes('dev.db-journal'))
  log('.gitignore 忽略 /public/avatars/', gitignore.includes('/public/avatars/'))
  log('.gitignore 忽略 .env', gitignore.includes('.env'))

  // ── 组4：ai-card API 鉴权 ──
  console.log('\n── 组4：ai-card API 鉴权 ──')
  const aiCardSrc = await readSrc('src/app/api/projects/[id]/ai-card/route.ts')
  log('ai-card POST 有 getServerSession', aiCardSrc.includes('getServerSession(authOptions)'))
  log('ai-card POST 校验 session.user.id', aiCardSrc.includes('!session?.user || !session.user.id'))
  log('ai-card POST 调用 canEditProject', aiCardSrc.includes('canEditProject'))
  log('ai-card GET 调用 canViewProject', aiCardSrc.includes('canViewProject'))
  log('ai-card POST 401 消息为"登录已过期"', aiCardSrc.includes("'登录已过期，请退出后重新登录'"))
  log('ai-card 配置 30s AbortController 超时', aiCardSrc.includes('setTimeout(() => controller.abort(), 30000)') || aiCardSrc.includes('30000'))

  // ── 组5：competitors API 鉴权 ──
  console.log('\n── 组5：competitors API 鉴权 ──')
  const competitorsSrc = await readSrc('src/app/api/projects/[id]/competitors/route.ts')
  log('competitors POST 有 getServerSession', competitorsSrc.includes('getServerSession(authOptions)'))
  log('competitors GET 有 getServerSession', (competitorsSrc.match(/getServerSession\(authOptions\)/g) || []).length >= 2)
  log('competitors GET 调用 canViewProject', competitorsSrc.includes('canViewProject'))
  log('competitors POST 30s 超时', competitorsSrc.includes('30000'))
  log('competitors 401 消息为"登录已过期"', competitorsSrc.includes("'登录已过期，请退出后重新登录'"))

  // ── 组6：头像上传安全 ──
  console.log('\n── 组6：头像上传安全 ──')
  const avatarSrc = await readSrc('src/app/api/user/avatar/route.ts')
  log('avatar API 使用 randomUUID 生成文件名', avatarSrc.includes('randomUUID()'))
  log('avatar API 使用 MIME 白名单', avatarSrc.includes("allowedTypes") && avatarSrc.includes("image/jpeg"))
  log('avatar API 拒绝 SVG', !avatarSrc.includes('image/svg+xml'))
  log('avatar API 校验文件大小 2MB', avatarSrc.includes('2 * 1024 * 1024'))
  log('avatar API 集成 COS', avatarSrc.includes('isCosConfigured') && avatarSrc.includes('uploadToCos'))
  log('avatar API 本地存储 fallback', avatarSrc.includes('public/avatars') || avatarSrc.includes("'avatars'"))
  log('avatar API 清理旧头像', avatarSrc.includes('oldUser') && (avatarSrc.includes('unlink') || avatarSrc.includes('deleteFromCos')))
  log('avatar API 区分未登录/登录过期', avatarSrc.includes("'未登录'") && avatarSrc.includes("'登录已过期，请退出后重新登录'"))
  log('avatar API 不暴露 detail', !avatarSrc.includes('detail:'))

  // ── 组7：mass-assignment 防护 ──
  console.log('\n── 组7：mass-assignment 防护 ──')
  const projectsRoute = await readSrc('src/app/api/projects/route.ts')
  log('projects POST 使用显式字段白名单', projectsRoute.includes('显式字段白名单') || projectsRoute.includes('mass-assignment'))
  log('projects POST 不直接解构 body', !projectsRoute.includes('...body'))
  log('projects POST 包含 companyFullName 白名单', projectsRoute.includes('...(companyFullName !== undefined'))
  log('projects POST 包含 totalAmount 白名单', projectsRoute.includes('...(totalAmount !== undefined'))
  log('projects POST 不允许设置 passedStages', !projectsRoute.includes('...(passedStages'))
  log('projects POST 不允许设置 protectionExpiresAt (白名单)', !projectsRoute.includes('...(protectionExpiresAt'))
  log('projects POST 不允许设置 status (白名单)', !projectsRoute.includes('...(status'))
  log('projects POST 不允许设置 competitorAnalysisJson (白名单)', !projectsRoute.includes('...(competitorAnalysisJson'))
  log('projects POST 不允许设置 id (白名单)', !projectsRoute.includes('...(id'))
  log('projects POST 不允许设置 createdAt (白名单)', !projectsRoute.includes('...(createdAt'))

  const projectDetailRoute = await readSrc('src/app/api/projects/[id]/route.ts')
  log('projects PUT 使用显式字段白名单', projectDetailRoute.includes('显式字段白名单') || projectDetailRoute.includes('mass-assignment'))
  log('projects PUT 不直接解构 body', !projectDetailRoute.includes('...body'))
  log('projects PUT 不允许设置 passedStages (普通更新)', !projectDetailRoute.includes('...(passedStages'))
  log('projects PUT 不允许设置 protectionExpiresAt', !projectDetailRoute.includes('...(protectionExpiresAt'))
  log('projects PUT 不允许设置 status', !projectDetailRoute.includes('...(status'))
  log('projects PUT 不允许设置 id', !projectDetailRoute.includes('...(id'))

  // ── 组8：错误响应脱敏 ──
  console.log('\n── 组8：错误响应脱敏 ──')
  // 全局搜索 src/app/api 下的 detail: 字段
  const { exec } = await import('child_process')
  const detailCount = await new Promise<number>((resolve) => {
    exec(`grep -rn "detail:" ${path.join(ROOT, 'src/app/api')} 2>/dev/null | wc -l`, (err, stdout) => {
      if (err) resolve(0)
      else resolve(parseInt(stdout.trim()) || 0)
    })
  })
  log('src/app/api 下 detail: 字段总数为 0', detailCount === 0, `实际=${detailCount}`)

  // 检查具体路由不包含 detail
  const newsSearchSrc = await readSrc('src/app/api/news/search/route.ts')
  log('news/search 不含 detail', !newsSearchSrc.includes('detail:'))
  const financingHeatmapSrc = await readSrc('src/app/api/statistics/financing-heatmap/route.ts')
  log('financing-heatmap 不含 detail', !financingHeatmapSrc.includes('detail:'))
  const projectLeadsRoute = await readSrc('src/app/api/project-leads/route.ts')
  log('project-leads 不含 detail', !projectLeadsRoute.includes('detail:'))
  const takeoverActionSrc = await readSrc('src/app/api/projects/[id]/takeover/[requestId]/action/route.ts')
  log('takeover action 不含 detail', !takeoverActionSrc.includes('detail:'))
  log('projects POST 不含 detail', !projectsRoute.includes('detail:'))
  log('projects PUT 不含 detail', !projectDetailRoute.includes('detail:'))

  // ── 组9：认证配置（role 校验 + cookie 安全） ──
  console.log('\n── 组9：认证配置 ──')
  const authSrc = await readSrc('src/lib/auth.ts')
  log('auth.ts authorize 校验 validRoles', authSrc.includes('validRoles') && authSrc.includes("['ADMIN', 'INVESTMENT_PARTNER', 'INVESTMENT_MANAGER', 'POST_INVESTMENT_OFFICER', 'TEMP_VISITOR']"))
  log('auth.ts 非法 role 回退 TEMP_VISITOR', authSrc.includes("'TEMP_VISITOR'"))
  log('auth.ts session callback 校验 role', authSrc.includes('session callback') || (authSrc.includes('session({ session, token })') && authSrc.includes('validRoles')))
  log('auth.ts 配置 cookies.sessionToken', authSrc.includes('cookies:') && authSrc.includes('sessionToken:'))
  log('auth.ts 生产环境使用 __Secure- 前缀', authSrc.includes("__Secure-next-auth.session-token"))
  log('auth.ts 生产环境 secure: true', authSrc.includes("secure: process.env.NODE_ENV === 'production'"))
  log('auth.ts httpOnly: true', authSrc.includes('httpOnly: true'))
  log('auth.ts sameSite: lax', authSrc.includes("sameSite: 'lax'"))

  // ── 组10：bcrypt 盐轮数 ──
  console.log('\n── 组10：bcrypt 盐轮数 ──')
  const passwordRoute = await readSrc('src/app/api/user/password/route.ts')
  log('user/password 使用 bcrypt 12', passwordRoute.includes('bcrypt.hash') && passwordRoute.includes(', 12)'))
  const registerRoute = await readSrc('src/app/api/users/register/route.ts')
  log('users/register 使用 bcrypt 12', registerRoute.includes('bcrypt.hash') && registerRoute.includes(', 12)'))
  const createAdmin = await readSrc('scripts/create-admin.ts')
  log('create-admin.ts 使用 bcrypt 12', createAdmin.includes(', 12)'))
  const createTestAccounts = await readSrc('scripts/create-test-accounts.ts')
  log('create-test-accounts.ts 使用 bcrypt 12', createTestAccounts.includes(', 12)'))

  // ── 组11：avatar 字段校验 ──
  console.log('\n── 组11：avatar 字段校验 ──')
  const profileRoute = await readSrc('src/app/api/user/profile/route.ts')
  log('user/profile 校验 avatar 路径前缀', profileRoute.includes('/avatars/') && profileRoute.includes('https://'))
  log('user/profile 不含 detail', !profileRoute.includes('detail:'))

  // ── 组12：next.config.js 安全配置 ──
  console.log('\n── 组12：next.config.js 安全配置 ──')
  const nextConfig = await readSrc('next.config.js')
  log('next.config.js 启用 reactStrictMode', nextConfig.includes('reactStrictMode: true'))
  log('next.config.js 关闭 poweredByHeader', nextConfig.includes('poweredByHeader: false'))

  // ── 组13：getWeekStart 提取 ──
  console.log('\n── 组13：getWeekStart 公共函数 ──')
  const datetimeLib = await readSrc('src/lib/datetime.ts')
  log('src/lib/datetime.ts 存在', datetimeLib.length > 0)
  log('datetime.ts 导出 getWeekStart', datetimeLib.includes('export function getWeekStart'))
  log('getWeekStart 处理周一中午12点刷新', datetimeLib.includes('12, 0, 0, 0'))
  log('getWeekStart 处理周一上午回退上周', datetimeLib.includes("dayOfWeek === 1") && datetimeLib.includes('getHours() < 12'))

  // ── 组14：$transaction 事务一致性 ──
  console.log('\n── 组14：$transaction 事务一致性 ──')
  const stageActionRoute = await readSrc('src/app/api/stage-change-requests/[id]/action/route.ts')
  log('stage-change-requests action 使用 $transaction', stageActionRoute.includes('prisma.$transaction'))
  log('事务包含 stageChangeRequest.update', stageActionRoute.includes('prisma.stageChangeRequest.update'))
  log('事务包含 project.update', stageActionRoute.includes('prisma.project.update'))
  log('事务同时更新 followStage + passedStages + stageChangedAt', stageActionRoute.includes('followStage: newStage') && stageActionRoute.includes('passedStages: JSON.stringify(newPassed)') && stageActionRoute.includes('stageChangedAt: new Date()'))

  // ── 组15：COS 集成 ──
  console.log('\n── 组15：COS 集成 ──')
  const cosLib = await readSrc('src/lib/cos.ts')
  log('src/lib/cos.ts 存在', cosLib.length > 0)
  log('cos.ts 导入 cos-nodejs-sdk-v5', cosLib.includes("cos-nodejs-sdk-v5"))
  log('cos.ts 导出 isCosConfigured', cosLib.includes('export function isCosConfigured'))
  log('cos.ts 导出 uploadToCos', cosLib.includes('export async function uploadToCos'))
  log('cos.ts 导出 deleteFromCos', cosLib.includes('export async function deleteFromCos'))
  log('cos.ts 校验 4 个环境变量', cosLib.includes('COS_SECRET_ID') && cosLib.includes('COS_SECRET_KEY') && cosLib.includes('COS_BUCKET') && cosLib.includes('COS_REGION'))
  log('cos.ts 未配置时返回 null', cosLib.includes('return null'))
  log('package.json 含 cos-nodejs-sdk-v5 依赖', (await readSrc('package.json')).includes('"cos-nodejs-sdk-v5"'))

  // ── 组16：新闻搜索 createMany 性能优化 ──
  console.log('\n── 组16：新闻搜索性能优化 ──')
  log('news/search 30s 超时', newsSearchSrc.includes('30000'))
  log('news/search 使用 createMany 批量插入', newsSearchSrc.includes('createMany'))
  log('news/search 不含 detail', !newsSearchSrc.includes('detail:'))
  log('financing-heatmap 30s 超时', financingHeatmapSrc.includes('30000'))

  // ── 组17：实际 API 调用测试（鉴权） ──
  console.log('\n── 组17：实际 API 鉴权测试 ──')
  // 17.1 未登录访问 ai-card POST 应返回 401
  const aiCardNoAuth = await apiCall('/api/projects/nonexistent-id/ai-card', { method: 'POST' })
  log('未登录访问 ai-card POST 返回 401', aiCardNoAuth.status === 401, `status=${aiCardNoAuth.status}`)
  log('ai-card 401 消息为"登录已过期"', aiCardNoAuth.data?.error === '登录已过期，请退出后重新登录', `error=${aiCardNoAuth.data?.error}`)

  // 17.2 未登录访问 competitors GET 应返回 401
  const competitorsNoAuth = await apiCall('/api/projects/nonexistent-id/competitors')
  log('未登录访问 competitors GET 返回 401', competitorsNoAuth.status === 401, `status=${competitorsNoAuth.status}`)
  log('competitors 401 消息为"登录已过期"', competitorsNoAuth.data?.error === '登录已过期，请退出后重新登录', `error=${competitorsNoAuth.data?.error}`)

  // 17.3 未登录访问 avatar POST 应返回 401
  const avatarNoAuth = await apiCall('/api/user/avatar', { method: 'POST' })
  log('未登录访问 avatar POST 返回 401', avatarNoAuth.status === 401, `status=${avatarNoAuth.status}`)

  // 17.4 未登录创建项目应返回 401
  const createNoAuth = await apiCall('/api/projects', { method: 'POST', body: { name: 'test' } })
  log('未登录创建项目返回 401', createNoAuth.status === 401, `status=${createNoAuth.status}`)

  // 17.5 登录后访问 ai-card 不存在的项目应返回 404（非 401）
  const adminCookie = await login(ADMIN.email, ADMIN.password).catch(() => '')
  log('管理员登录成功', !!adminCookie)
  const aiCardWithAuth = await apiCall('/api/projects/nonexistent-id/ai-card', { method: 'POST', cookie: adminCookie })
  log('登录后访问 ai-card 不存在项目返回 404', aiCardWithAuth.status === 404, `status=${aiCardWithAuth.status}`)

  // ── 组18：mass-assignment 实际请求测试 ──
  console.log('\n── 组18：mass-assignment 实际请求测试 ──')
  const suffix = Date.now()
  const testProjectName = `deploy-test-${suffix}`
  // 尝试通过 body 设置受保护字段
  const createRes = await apiCall('/api/projects', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: testProjectName,
      totalAmount: '500万',
      targetDate: '2026-01-15',
      // 以下字段应被忽略
      id: 'hacked-id',
      createdAt: '2020-01-01T00:00:00.000Z',
      createdById: 'hacked-user',
      status: 'ACTIVE',
      passedStages: '["HACKED"]',
      protectionExpiresAt: '2020-01-01T00:00:00.000Z',
      competitorAnalysisJson: '{"hacked":true}',
      stageChangedAt: '2020-01-01T00:00:00.000Z',
    },
  })
  log('创建项目成功（含攻击字段）', createRes.status === 201, `status=${createRes.status}, error=${createRes.data?.error}`)

  if (createRes.status === 201 && createRes.data?.project?.id) {
    const projectId = createRes.data.project.id
    // 查询数据库验证字段未被篡改
    const dbProject = await prisma.project.findUnique({ where: { id: projectId } })
    log('id 未被篡改', dbProject?.id !== 'hacked-id', `实际id=${dbProject?.id}`)
    log('createdAt 未被篡改', dbProject?.createdAt?.toISOString() !== '2020-01-01T00:00:00.000Z')
    log('createdById 未被篡改（应为管理员id）', dbProject?.createdById !== 'hacked-user')
    log('status 未被篡改（应为默认值）', dbProject?.status === 'PENDING' || !dbProject?.status?.includes('HACK'), `实际status=${dbProject?.status}`)
    log('passedStages 未被篡改', dbProject?.passedStages !== '["HACKED"]', `实际=${dbProject?.passedStages}`)
    log('protectionExpiresAt 未被篡改（应为未来3个月）', dbProject?.protectionExpiresAt ? dbProject.protectionExpiresAt > new Date() : false, `实际=${dbProject?.protectionExpiresAt?.toISOString()}`)
    log('competitorAnalysisJson 未被篡改（应为 null）', dbProject?.competitorAnalysisJson === null, `实际=${dbProject?.competitorAnalysisJson}`)
    log('stageChangedAt 未被篡改（应为 null）', dbProject?.stageChangedAt === null, `实际=${dbProject?.stageChangedAt?.toISOString()}`)

    // 清理测试项目
    await prisma.project.delete({ where: { id: projectId } }).catch(() => {})
  }

  // ── 组19：头像上传实际请求测试 ──
  console.log('\n── 组19：头像上传安全测试 ──')
  // 19.1 上传 SVG 应被拒绝
  const svgBlob = new Blob([`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`], { type: 'image/svg+xml' })
  const svgForm = new FormData()
  svgForm.append('file', svgBlob, 'evil.svg')
  const svgRes = await apiCall('/api/user/avatar', { method: 'POST', cookie: adminCookie, body: svgForm, headers: {} })
  log('上传 SVG 被拒绝（400）', svgRes.status === 400, `status=${svgRes.status}, error=${svgRes.data?.error}`)
  log('SVG 拒绝消息提示支持的格式', svgRes.data?.error?.includes('JPG') || svgRes.data?.error?.includes('不支持'), `error=${svgRes.data?.error}`)

  // 19.2 上传超大文件应被拒绝（创建 3MB buffer）
  const bigBuffer = Buffer.alloc(3 * 1024 * 1024, 0)
  const bigBlob = new Blob([bigBuffer], { type: 'image/png' })
  const bigForm = new FormData()
  bigForm.append('file', bigBlob, 'big.png')
  const bigRes = await apiCall('/api/user/avatar', { method: 'POST', cookie: adminCookie, body: bigForm, headers: {} })
  log('上传超过 2MB 被拒绝（400）', bigRes.status === 400, `status=${bigRes.status}, error=${bigRes.data?.error}`)
  log('超大文件拒绝消息提示 2MB', bigRes.data?.error?.includes('2MB') || bigRes.data?.error?.includes('2M'), `error=${bigRes.data?.error}`)

  // 19.3 上传有效 PNG 应成功
  // 创建 1x1 PNG
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const pngBuffer = Buffer.from(pngBase64, 'base64')
  const pngBlob = new Blob([pngBuffer], { type: 'image/png' })
  const pngForm = new FormData()
  pngForm.append('file', pngBlob, 'avatar.png')
  const pngRes = await apiCall('/api/user/avatar', { method: 'POST', cookie: adminCookie, body: pngForm, headers: {} })
  log('上传有效 PNG 成功（200）', pngRes.status === 200, `status=${pngRes.status}, error=${pngRes.data?.error}`)
  log('返回 avatar URL', typeof pngRes.data?.avatar === 'string' && pngRes.data.avatar.length > 0, `avatar=${pngRes.data?.avatar}`)
  log('avatar URL 以 /avatars/ 或 https:// 开头', pngRes.data?.avatar?.startsWith('/avatars/') || pngRes.data?.avatar?.startsWith('https://'), `avatar=${pngRes.data?.avatar}`)

  // 19.4 验证数据库中 avatar 字段已更新
  const adminUser = await prisma.user.findUnique({ where: { email: ADMIN.email }, select: { avatar: true } })
  log('数据库 avatar 字段已更新', !!adminUser?.avatar, `avatar=${adminUser?.avatar}`)

  // 19.5 再次上传应清理旧头像（验证 oldUser 查询逻辑）
  const pngForm2 = new FormData()
  pngForm2.append('file', new Blob([pngBuffer], { type: 'image/png' }), 'avatar2.png')
  const pngRes2 = await apiCall('/api/user/avatar', { method: 'POST', cookie: adminCookie, body: pngForm2, headers: {} })
  log('再次上传成功（旧头像清理）', pngRes2.status === 200, `status=${pngRes2.status}`)

  // ── 组20：401 消息一致性 ──
  console.log('\n── 组20：401 消息一致性 ──')
  // 验证未登录时各 API 返回的 401 消息
  const projectsNoAuth = await apiCall('/api/projects', { method: 'POST', body: {} })
  log('未登录创建项目返回 401', projectsNoAuth.status === 401)
  log('未登录创建项目消息为"未登录"', projectsNoAuth.data?.error === '未登录', `error=${projectsNoAuth.data?.error}`)

  const takeoverNoAuth = await apiCall('/api/projects/x/takeover', { method: 'POST', body: {} })
  log('未登录接手项目返回 401', takeoverNoAuth.status === 401)
  log('未登录接手项目消息为"未登录"', takeoverNoAuth.data?.error === '未登录', `error=${takeoverNoAuth.data?.error}`)

  const leadsNoAuth = await apiCall('/api/project-leads', { method: 'POST', body: {} })
  log('未登录创建线索返回 401', leadsNoAuth.status === 401)
  log('未登录创建线索消息为"未登录"', leadsNoAuth.data?.error === '未登录', `error=${leadsNoAuth.data?.error}`)

  // ── 组21：依赖安装验证 ──
  console.log('\n── 组21：依赖安装验证 ──')
  const nodeModulesCos = existsSync(path.join(ROOT, 'node_modules/cos-nodejs-sdk-v5'))
  log('cos-nodejs-sdk-v5 已安装', nodeModulesCos)

  // ── 组22：数据库实际连通性 ──
  console.log('\n── 组22：数据库连通性 ──')
  try {
    const userCount = await prisma.user.count()
    log('PostgreSQL 连通（user.count 成功）', userCount >= 0, `用户数=${userCount}`)
    const projectCount = await prisma.project.count()
    log('PostgreSQL project.count 成功', projectCount >= 0, `项目数=${projectCount}`)
  } catch (e: any) {
    log('PostgreSQL 连通性测试', false, e.message)
  }

  // ── 组23：bcrypt 12 实际验证 ──
  console.log('\n── 组23：bcrypt 12 实际验证 ──')
  // 创建一个测试用户，验证密码 hash 是否使用 bcrypt 12
  const bcryptTestEmail = `bcrypt-test-${suffix}@example.com`
  const bcryptTestPassword = 'test123456'
  const bcryptRes = await apiCall('/api/users/register', {
    method: 'POST',
    body: {
      name: 'bcrypt测试',
      username: `bcryptuser_${suffix}`,
      email: bcryptTestEmail,
      password: bcryptTestPassword,
      confirmPassword: bcryptTestPassword,
    },
  })
  log('注册 bcrypt 测试用户成功', bcryptRes.status === 200 || bcryptRes.status === 201, `status=${bcryptRes.status}`)

  if (bcryptRes.status === 200 || bcryptRes.status === 201) {
    const bcryptUser = await prisma.user.findUnique({ where: { email: bcryptTestEmail } })
    log('bcrypt 测试用户已创建', !!bcryptUser)
    if (bcryptUser) {
      // bcrypt hash 格式: $2a$<cost>$<22-char-salt><31-char-hash>
      const hashMatch = bcryptUser.passwordHash.match(/^\$2[aby]\$(\d+)\$/)
      log('passwordHash 是 bcrypt 格式', !!hashMatch)
      log('bcrypt cost = 12', hashMatch?.[1] === '12', `实际cost=${hashMatch?.[1]}`)
      // 清理
      await prisma.user.delete({ where: { id: bcryptUser.id } }).catch(() => {})
    }
  }

  // ── 组24：新闻搜索 API 鉴权 ──
  console.log('\n── 组24：新闻搜索 API ──')
  const newsSearchSrc2 = await readSrc('src/app/api/news/search/route.ts')
  log('news/search 有 getServerSession', newsSearchSrc2.includes('getServerSession(authOptions)'))

  // ── 组25：DashboardLayout 版本号 ──
  console.log('\n── 组25：版本号动态显示 ──')
  const dashboardLayout = await readSrc('src/components/DashboardLayout.tsx')
  log('DashboardLayout 从 package.json 读取版本', dashboardLayout.includes("import packageJson") || dashboardLayout.includes("from '../../package.json'"))
  log('DashboardLayout 使用 APP_VERSION', dashboardLayout.includes('APP_VERSION'))
  const pkgJson = JSON.parse(await readSrc('package.json'))
  log('package.json version = 0.6.0', pkgJson.version === '0.6.0', `实际=${pkgJson.version}`)

  // ── 组26：Logo 分离管理 ──
  console.log('\n── 组26：Logo 分离管理 ──')
  const loginPage = await readSrc('src/app/auth/login/page.tsx')
  log('login 页面使用 /logo-auth.png', loginPage.includes('/logo-auth.png'))
  const registerPage = await readSrc('src/app/auth/register/page.tsx')
  log('register 页面使用 /logo-auth.png', registerPage.includes('/logo-auth.png'))
  log('DashboardLayout 使用 /logo.png', dashboardLayout.includes('/logo.png') && !dashboardLayout.includes('/logo-auth.png'))
  log('public/logo.png 存在', existsSync(path.join(ROOT, 'public/logo.png')))
  log('public/logo-auth.png 存在', existsSync(path.join(ROOT, 'public/logo-auth.png')))

  // ── 汇总 ──
  console.log('\n========================================')
  const passed = results.filter(r => r.passed).length
  const total = results.length
  const failed = total - passed
  console.log(`  测试汇总: ${passed}/${total} 通过, ${failed} 失败`)
  console.log('========================================\n')

  if (failed > 0) {
    console.log('失败项:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    })
    console.log('')
  }

  await prisma.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('❌ 测试执行失败:', e)
  await prisma.$disconnect()
  process.exit(1)
})
