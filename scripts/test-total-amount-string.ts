/**
 * 测试脚本：融资金额改为文本类型（用户自填单位）
 *
 * 测试覆盖：
 * 1. 新建项目：totalAmount 可以是文本（如"500万"、"2亿"）
 * 2. API 响应：totalAmount 返回字符串
 * 3. 编辑项目：totalAmount 可以更新为文本
 * 4. 源码验证：标签去掉"（万元）"、显示不拼接"万"、AI 解析保留原始单位
 *
 * 运行: npx tsx scripts/test-total-amount-string.ts
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
  console.log('  融资金额文本类型测试（用户自填单位）')
  console.log('========================================\n')

  // ── 组1：管理员登录 ──
  console.log('── 组1：管理员登录 ──')
  const adminCookie = await login(ADMIN.email, ADMIN.password).catch(() => '')
  log('管理员登录', !!adminCookie)

  const suffix = Date.now()

  // ── 组2：新建项目 - totalAmount 为带单位文本 ──
  console.log('\n── 组2：新建项目 - totalAmount 为带单位文本 ──')

  // 2.1 创建项目 totalAmount = "500万"
  const proj1Name = `文本金额测试_万_${suffix}`
  const createRes1 = await apiCall('/api/projects', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: proj1Name,
      totalAmount: '500万',
      targetDate: new Date().toISOString(),
      followStage: 'INITIAL_TALK',
    },
  })
  log('创建项目 totalAmount="500万" 返回 201', createRes1.status === 201, `status=${createRes1.status} err=${createRes1.data.error}`)
  log('创建响应 totalAmount = "500万"（字符串）', createRes1.data.project?.totalAmount === '500万', `actual=${createRes1.data.project?.totalAmount}`)
  log('totalAmount 类型为 string', typeof createRes1.data.project?.totalAmount === 'string', `type=${typeof createRes1.data.project?.totalAmount}`)
  const proj1Id = createRes1.data.project?.id
  if (proj1Id) createdProjectIds.push(proj1Id)

  // 2.2 创建项目 totalAmount = "2亿"
  const proj2Name = `文本金额测试_亿_${suffix}`
  const createRes2 = await apiCall('/api/projects', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: proj2Name,
      totalAmount: '2亿',
      targetDate: new Date().toISOString(),
      followStage: 'INITIAL_TALK',
    },
  })
  log('创建项目 totalAmount="2亿" 返回 201', createRes2.status === 201, `status=${createRes2.status} err=${createRes2.data.error}`)
  log('创建响应 totalAmount = "2亿"（字符串，不做亿转万元）', createRes2.data.project?.totalAmount === '2亿', `actual=${createRes2.data.project?.totalAmount}`)
  const proj2Id = createRes2.data.project?.id
  if (proj2Id) createdProjectIds.push(proj2Id)

  // 2.3 创建项目 totalAmount = "1000"（纯数字字符串）
  const proj3Name = `文本金额测试_纯数字_${suffix}`
  const createRes3 = await apiCall('/api/projects', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: proj3Name,
      totalAmount: '1000',
      targetDate: new Date().toISOString(),
      followStage: 'INITIAL_TALK',
    },
  })
  log('创建项目 totalAmount="1000"（纯数字）返回 201', createRes3.status === 201, `status=${createRes3.status}`)
  log('创建响应 totalAmount = "1000"（保留原始字符串）', createRes3.data.project?.totalAmount === '1000', `actual=${createRes3.data.project?.totalAmount}`)
  const proj3Id = createRes3.data.project?.id
  if (proj3Id) createdProjectIds.push(proj3Id)

  // ── 组3：数据库验证 ──
  console.log('\n── 组3：数据库验证 ──')
  const dbProj1 = proj1Id ? await prisma.project.findUnique({ where: { id: proj1Id } }) : null
  log('数据库 totalAmount = "500万"', dbProj1?.totalAmount === '500万', `actual=${dbProj1?.totalAmount}`)

  const dbProj2 = proj2Id ? await prisma.project.findUnique({ where: { id: proj2Id } }) : null
  log('数据库 totalAmount = "2亿"（未做亿转万元）', dbProj2?.totalAmount === '2亿', `actual=${dbProj2?.totalAmount}`)

  // ── 组4：GET API 返回字符串 ──
  console.log('\n── 组4：GET API 返回字符串 ──')

  // 4.1 项目详情 API
  const detailRes = await apiCall(`/api/projects/${proj1Id}`, { cookie: adminCookie })
  log('详情 API totalAmount = "500万"', detailRes.data.project?.totalAmount === '500万', `actual=${detailRes.data.project?.totalAmount}`)
  log('详情 API totalAmount 类型为 string', typeof detailRes.data.project?.totalAmount === 'string')

  // 4.2 项目列表 API
  const listRes = await apiCall('/api/projects?scope=all', { cookie: adminCookie })
  const listProj1 = listRes.data.projects?.find((p: any) => p.id === proj1Id)
  log('列表 API totalAmount = "500万"', listProj1?.totalAmount === '500万', `actual=${listProj1?.totalAmount}`)

  // 4.3 Dashboard API
  const dashRes = await apiCall('/api/dashboard', { cookie: adminCookie })
  const dashProj1 = dashRes.data.maintainerStats?.flatMap((m: any) => m.projects || []).find((p: any) => p.id === proj1Id)
  log('Dashboard API totalAmount = "500万"', dashProj1?.totalAmount === '500万', `actual=${dashProj1?.totalAmount}`)

  // ── 组5：编辑项目 - 更新 totalAmount 为文本 ──
  console.log('\n── 组5：编辑项目 - 更新 totalAmount 为文本 ──')
  const editRes = await apiCall(`/api/projects/${proj1Id}`, {
    method: 'PUT',
    cookie: adminCookie,
    body: { totalAmount: '3000万' },
  })
  log('编辑项目 totalAmount → "3000万" 返回 200', editRes.status === 200, `status=${editRes.status} err=${editRes.data.error}`)
  log('编辑响应 totalAmount = "3000万"', editRes.data.project?.totalAmount === '3000万', `actual=${editRes.data.project?.totalAmount}`)

  const dbProj1After = proj1Id ? await prisma.project.findUnique({ where: { id: proj1Id } }) : null
  log('数据库 totalAmount 已更新为 "3000万"', dbProj1After?.totalAmount === '3000万', `actual=${dbProj1After?.totalAmount}`)

  // ── 组6：空字符串校验 ──
  console.log('\n── 组6：空字符串校验 ──')
  const emptyRes = await apiCall('/api/projects', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: `空金额测试_${suffix}`,
      totalAmount: '',
      targetDate: new Date().toISOString(),
      followStage: 'INITIAL_TALK',
    },
  })
  log('空字符串 totalAmount 返回 400', emptyRes.status === 400, `status=${emptyRes.status}`)

  // ── 组7：源码验证 - 新建项目页面 ──
  console.log('\n── 组7：源码验证 - 新建项目页面 ──')
  const newPageContent = await readFile('./src/app/projects/new/page.tsx')

  log('new/page.tsx: totalAmount 标签不含"（万元）"', !/融资金额（万元）\s*<span/.test(newPageContent))
  log('new/page.tsx: 标签为"融资金额"', /融资金额\s*<span/.test(newPageContent))
  log('new/page.tsx: totalAmount input type="text"', /<input[^>]*id="totalAmount"[^>]*type="text"/.test(newPageContent))
  log('new/page.tsx: totalAmount input type 不再是 number', !/<input[^>]*id="totalAmount"[^>]*type="number"/.test(newPageContent))
  log('new/page.tsx: 提交逻辑不含 parseFloat(formData.totalAmount)', !newPageContent.includes('parseFloat(formData.totalAmount)'))
  log('new/page.tsx: 提交逻辑使用 trim()', newPageContent.includes('formData.totalAmount.trim()'))
  log('new/page.tsx: placeholder 提示单位', newPageContent.includes('如 500万 / 2亿'))

  // AI 解析逻辑验证
  log('new/page.tsx: AI 解析"万"保留原始单位', newPageContent.includes('`${wanMatch[1]}万`'))
  log('new/page.tsx: AI 解析"亿"保留原始单位', newPageContent.includes('`${yiMatch[1]}亿`'))
  log('new/page.tsx: AI 解析不再做亿转万元（×10000）', !newPageContent.includes('* 10000)'))

  // ── 组8：源码验证 - 编辑项目页面 ──
  console.log('\n── 组8：源码验证 - 编辑项目页面 ──')
  const editPageContent = await readFile('./src/app/projects/[id]/edit/page.tsx')

  log('edit/page.tsx: totalAmount 标签不含"（万元）"', !/融资金额（万元）\s*<span/.test(editPageContent))
  log('edit/page.tsx: 标签为"融资金额"', /融资金额\s*<span/.test(editPageContent))
  log('edit/page.tsx: totalAmount input type="text"', /<input[^>]*id="totalAmount"[^>]*type="text"/.test(editPageContent))
  log('edit/page.tsx: totalAmount input type 不再是 number', !/<input[^>]*id="totalAmount"[^>]*type="number"/.test(editPageContent))
  log('edit/page.tsx: 提交逻辑不含 parseFloat(formData.totalAmount)', !editPageContent.includes('parseFloat(formData.totalAmount)'))
  log('edit/page.tsx: 提交逻辑使用 trim()', editPageContent.includes('formData.totalAmount.trim()'))

  // ── 组9：源码验证 - 显示页面不拼接"万" ──
  console.log('\n── 组9：源码验证 - 显示页面不拼接"万" ──')

  // 9.1 首页
  const homeContent = await readFile('./src/app/page.tsx')
  log('page.tsx (首页): 不含 `${project.totalAmount}万`', !homeContent.includes('${project.totalAmount}万'))
  log('page.tsx (首页): 显示用 project.totalAmount ? project.totalAmount : "未填写"', homeContent.includes('project.totalAmount ? project.totalAmount'))
  log('page.tsx (首页): 类型声明 totalAmount: string', homeContent.includes('totalAmount: string'))

  // 9.2 项目库
  const projectsContent = await readFile('./src/app/projects/page.tsx')
  log('projects/page.tsx: 不含 toLocaleString()万', !projectsContent.includes('totalAmount.toLocaleString()}万'))

  // 9.3 工作台
  const workbenchContent = await readFile('./src/app/workbench/page.tsx')
  log('workbench/page.tsx: 不含 toLocaleString()万', !workbenchContent.includes('totalAmount.toLocaleString()}万'))

  // 9.4 项目详情
  const detailContent = await readFile('./src/app/projects/[id]/page.tsx')
  log('projects/[id]/page.tsx: 不含 toLocaleString()万', !detailContent.includes('totalAmount.toLocaleString()}万'))

  // ── 组10：源码验证 - API 路由 ──
  console.log('\n── 组10：源码验证 - API 路由 ──')
  const apiProjectsContent = await readFile('./src/app/api/projects/route.ts')
  log('api/projects/route.ts: 不含 Number(p.totalAmount)', !apiProjectsContent.includes('Number(p.totalAmount)'))
  log('api/projects/route.ts: totalAmount 校验不含 isNaN', !/totalAmount[\s\S]{0,100}isNaN/.test(apiProjectsContent))
  log('api/projects/route.ts: 使用 String(data.totalAmount).trim()', apiProjectsContent.includes('String(data.totalAmount).trim()'))

  const apiProjectsIdContent = await readFile('./src/app/api/projects/[id]/route.ts')
  log('api/projects/[id]/route.ts: 不含 Number(project.totalAmount)', !apiProjectsIdContent.includes('Number(project.totalAmount)'))
  log('api/projects/[id]/route.ts: 不含 Number(updatedProject.totalAmount)', !apiProjectsIdContent.includes('Number(updatedProject.totalAmount)'))

  const dashApiContent = await readFile('./src/app/api/dashboard/route.ts')
  log('api/dashboard/route.ts: 不含 Number(p.totalAmount)', !dashApiContent.includes('Number(p.totalAmount)'))
  log('api/dashboard/route.ts: 类型声明 totalAmount: string', dashApiContent.includes('totalAmount: string'))

  const aiCardContent = await readFile('./src/app/api/projects/[id]/ai-card/route.ts')
  log('api/ai-card/route.ts: 不含 "万元" 拼接', !aiCardContent.includes('${project.totalAmount}万元'))
  log('api/ai-card/route.ts: 使用 ${project.totalAmount}', aiCardContent.includes('${project.totalAmount}'))

  // ── 组11：源码验证 - Prisma schema ──
  console.log('\n── 组11：源码验证 - Prisma schema ──')
  const schemaContent = await readFile('./prisma/schema.prisma')
  log('schema.prisma: totalAmount 类型为 String', /totalAmount\s+String/.test(schemaContent))
  log('schema.prisma: totalAmount 不再是 Float', !/totalAmount\s+Float/.test(schemaContent))

  // ── 组12：清理测试数据 ──
  console.log('\n── 组12：清理测试数据 ──')
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
