/**
 * 测试脚本：新建项目投资估值字段
 *
 * 测试覆盖：
 * 1. 新建项目时带 investmentValuation 能正确保存（API + 数据库）
 * 2. 新建项目时不带 investmentValuation（空值）正确处理为 null
 * 3. 新建项目时 investmentValuation 为无效值返回 400
 * 4. 创建后通过 GET API 能读取到 investmentValuation
 * 5. 源码验证：新建页面包含投资估值输入框；API 路由处理 investmentValuation
 *
 * 运行: npx tsx scripts/test-new-project-valuation.ts
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
  console.log('  新建项目投资估值字段测试')
  console.log('========================================\n')

  // ── 组1：管理员登录 ──
  console.log('── 组1：管理员登录 ──')
  const adminCookie = await login(ADMIN.email, ADMIN.password).catch(() => '')
  log('管理员登录', !!adminCookie, adminCookie ? 'OK' : '登录失败')

  const suffix = Date.now()

  // ── 组2：新建项目带投资估值 ──
  console.log('\n── 组2：新建项目带投资估值 ──')
  const projectName1 = `估值测试_${suffix}_1`
  const createRes1 = await apiCall('/api/projects', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: projectName1,
      totalAmount: 500,
      investmentValuation: 5.5,  // 5.5 亿
      targetDate: new Date().toISOString(),
      followStage: 'INITIAL_TALK',
      companyPosition: '测试公司定位',
    },
  })
  log('带投资估值创建项目返回 201', createRes1.status === 201, `status=${createRes1.status} err=${createRes1.data.error}`)
  const projectId1 = createRes1.data.project?.id
  if (projectId1) createdProjectIds.push(projectId1)

  // 数据库验证
  const dbProject1 = projectId1 ? await prisma.project.findUnique({ where: { id: projectId1 } }) : null
  log('数据库存储 investmentValuation = 5.5', dbProject1?.investmentValuation === 5.5, `actual=${dbProject1?.investmentValuation}`)

  // GET API 验证
  if (projectId1) {
    const detailRes = await apiCall(`/api/projects/${projectId1}`, { cookie: adminCookie })
    const proj = detailRes.data.project || detailRes.data
    log('GET API 返回 investmentValuation = 5.5', proj?.investmentValuation === 5.5, `actual=${proj?.investmentValuation}`)
  }

  // ── 组3：新建项目不带投资估值（空值）──
  console.log('\n── 组3：新建项目不带投资估值（空值）──')
  const projectName2 = `估值测试_${suffix}_2`
  const createRes2 = await apiCall('/api/projects', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: projectName2,
      totalAmount: 300,
      // 不传 investmentValuation
      targetDate: new Date().toISOString(),
      followStage: 'INITIAL_TALK',
    },
  })
  log('不带投资估值创建项目返回 201', createRes2.status === 201, `status=${createRes2.status} err=${createRes2.data.error}`)
  const projectId2 = createRes2.data.project?.id
  if (projectId2) createdProjectIds.push(projectId2)

  const dbProject2 = projectId2 ? await prisma.project.findUnique({ where: { id: projectId2 } }) : null
  log('数据库 investmentValuation 为 null', dbProject2?.investmentValuation === null, `actual=${dbProject2?.investmentValuation}`)

  // ── 组4：新建项目投资估值为空字符串 ──
  console.log('\n── 组4：新建项目投资估值为空字符串 ──')
  const projectName3 = `估值测试_${suffix}_3`
  const createRes3 = await apiCall('/api/projects', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: projectName3,
      totalAmount: 200,
      investmentValuation: '',  // 空字符串
      targetDate: new Date().toISOString(),
      followStage: 'INITIAL_TALK',
    },
  })
  log('空字符串投资估值创建项目返回 201', createRes3.status === 201, `status=${createRes3.status} err=${createRes3.data.error}`)
  const projectId3 = createRes3.data.project?.id
  if (projectId3) createdProjectIds.push(projectId3)

  const dbProject3 = projectId3 ? await prisma.project.findUnique({ where: { id: projectId3 } }) : null
  log('空字符串投资估值存储为 null', dbProject3?.investmentValuation === null, `actual=${dbProject3?.investmentValuation}`)

  // ── 组5：新建项目投资估值为 null ──
  console.log('\n── 组5：新建项目投资估值为 null ──')
  const projectName4 = `估值测试_${suffix}_4`
  const createRes4 = await apiCall('/api/projects', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: projectName4,
      totalAmount: 100,
      investmentValuation: null,
      targetDate: new Date().toISOString(),
      followStage: 'INITIAL_TALK',
    },
  })
  log('null 投资估值创建项目返回 201', createRes4.status === 201, `status=${createRes4.status} err=${createRes4.data.error}`)
  const projectId4 = createRes4.data.project?.id
  if (projectId4) createdProjectIds.push(projectId4)

  const dbProject4 = projectId4 ? await prisma.project.findUnique({ where: { id: projectId4 } }) : null
  log('null 投资估值存储为 null', dbProject4?.investmentValuation === null, `actual=${dbProject4?.investmentValuation}`)

  // ── 组6：新建项目投资估值为无效字符串 ──
  console.log('\n── 组6：新建项目投资估值为无效字符串 ──')
  const projectName5 = `估值测试_${suffix}_5`
  const createRes5 = await apiCall('/api/projects', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: projectName5,
      totalAmount: 100,
      investmentValuation: 'not-a-number',
      targetDate: new Date().toISOString(),
      followStage: 'INITIAL_TALK',
    },
  })
  log('无效投资估值返回 400', createRes5.status === 400, `status=${createRes5.status}`)
  log('错误信息包含"投资估值"', createRes5.data.error?.includes('投资估值'), `err=${createRes5.data.error}`)

  // ── 组7：投资估值为 0 ──
  console.log('\n── 组7：投资估值为 0 ──')
  const projectName6 = `估值测试_${suffix}_6`
  const createRes6 = await apiCall('/api/projects', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: projectName6,
      totalAmount: 100,
      investmentValuation: 0,
      targetDate: new Date().toISOString(),
      followStage: 'INITIAL_TALK',
    },
  })
  log('投资估值为 0 创建项目返回 201', createRes6.status === 201, `status=${createRes6.status} err=${createRes6.data.error}`)
  const projectId6 = createRes6.data.project?.id
  if (projectId6) createdProjectIds.push(projectId6)

  const dbProject6 = projectId6 ? await prisma.project.findUnique({ where: { id: projectId6 } }) : null
  log('投资估值 0 正确存储', dbProject6?.investmentValuation === 0, `actual=${dbProject6?.investmentValuation}`)

  // ── 组8：源码验证 ──
  console.log('\n── 组8：源码验证 ──')

  // 8.1 新建项目页面包含投资估值输入框
  const newPageContent = await readFile('./src/app/projects/new/page.tsx')
  log('new/page.tsx: FormData 接口包含 investmentValuation', /investmentValuation:\s*string/.test(newPageContent))
  log('new/page.tsx: 初始 state 包含 investmentValuation', /investmentValuation:\s*['"]['"]/.test(newPageContent))
  log('new/page.tsx: 提交逻辑转换 investmentValuation', newPageContent.includes('investmentValuation: formData.investmentValuation ? parseFloat(formData.investmentValuation) : null'))
  log('new/page.tsx: 包含投资估值输入框标签', newPageContent.includes('投资估值（亿元）'))
  log('new/page.tsx: input id="investmentValuation"', newPageContent.includes('id="investmentValuation"'))
  log('new/page.tsx: 输入框位于融资金额之后', newPageContent.indexOf('投资估值（亿元）') > newPageContent.indexOf('融资金额（万元）'))

  // 8.2 API 路由处理 investmentValuation
  const apiContent = await readFile('./src/app/api/projects/route.ts')
  log('api/projects/route.ts: 处理 investmentValuation 类型转换', apiContent.includes('investmentValuation') && apiContent.includes('Number(data.investmentValuation)'))
  log('api/projects/route.ts: 空值处理为 null', apiContent.includes('data.investmentValuation = null'))
  log('api/projects/route.ts: 无效值返回 400', apiContent.includes('投资估值格式无效'))

  // 8.3 Prisma schema 包含字段
  const schemaContent = await readFile('./prisma/schema.prisma')
  log('schema.prisma: Project 模型包含 investmentValuation', /investmentValuation\s+Float\?/.test(schemaContent))

  // ── 组9：清理测试数据 ──
  console.log('\n── 组9：清理测试数据 ──')
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
