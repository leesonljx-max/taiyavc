/**
 * 跟踪信号 API 路由测试
 *
 * 覆盖：
 * - POST /api/tracking-signals        保存信号（登录/字段校验/规范化/落库）
 * - GET  /api/tracking-signals        列表权限（ADMIN/PARTNER 全量，其他人仅自己）
 * - PATCH /api/tracking-signals/[id]  启停/频率编辑（403/400/200）
 * - DELETE /api/tracking-signals/[id] 删除权限
 * - POST /api/tracking-signals/[id]/run  手动执行
 * - POST /api/tracking-signals/generate  自然语言生成信号草稿（校验 + DeepSeek 规范化）
 */
import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mockState, resetMocks, chatCompletions, searchResult } from './helpers/setup'

import { GET, POST } from '@/app/api/tracking-signals/route'
import { PATCH, DELETE } from '@/app/api/tracking-signals/[id]/route'
import { POST as RUN_POST } from '@/app/api/tracking-signals/[id]/run/route'
import { POST as GENERATE_POST } from '@/app/api/tracking-signals/generate/route'
import prisma from '@/lib/prisma'

const SUFFIX = String(Date.now()).slice(-6)

const ADMIN = { id: '', email: `api-admin-${SUFFIX}@test.local` }
const MANAGER = { id: '', email: `api-manager-${SUFFIX}@test.local` }

function asUser(user: { id: string; email: string }, role: string): void {
  mockState.session = { user: { id: user.id, email: user.email, role, name: '测试用户' } }
}

function jsonRequest(url: string, method: string, payload?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
}

beforeEach(async () => {
  resetMocks()
  await prisma.projectLead.deleteMany({})
  await prisma.trackingSignal.deleteMany({})

  // 两个测试用户（幂等）
  const admin = await prisma.user.upsert({
    where: { email: ADMIN.email },
    update: {},
    create: { email: ADMIN.email, name: '管理员', passwordHash: 'x', role: 'ADMIN' },
  })
  ADMIN.id = admin.id
  const manager = await prisma.user.upsert({
    where: { email: MANAGER.email },
    update: {},
    create: { email: MANAGER.email, name: '投资经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER' },
  })
  MANAGER.id = manager.id
})

after(async () => {
  await prisma.projectLead.deleteMany({})
  await prisma.trackingSignal.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN.email, MANAGER.email] } } })
  await prisma.$disconnect()
})

// ── POST /api/tracking-signals：保存 ──

test('POST 未登录返回 401', async () => {
  const res = await POST(jsonRequest('http://t/api/tracking-signals', 'POST', { name: 'x', description: 'x', keywords: ['x'] }))
  assert.equal(res.status, 401)
})

test('POST 缺 name / description / keywords 分别返回 400', async () => {
  asUser(ADMIN, 'ADMIN')
  const base = { description: '描述内容', keywords: ['关键词'] }

  const noName = await POST(jsonRequest('http://t/api/tracking-signals', 'POST', base))
  assert.equal(noName.status, 400)

  const noDesc = await POST(jsonRequest('http://t/api/tracking-signals', 'POST', { name: '名称', keywords: ['关键词'] }))
  assert.equal(noDesc.status, 400)

  const noKw = await POST(jsonRequest('http://t/api/tracking-signals', 'POST', { name: '名称', description: '描述内容' }))
  assert.equal(noKw.status, 400)

  const emptyKw = await POST(jsonRequest('http://t/api/tracking-signals', 'POST', { name: '名称', description: '描述', keywords: ['', '   '] }))
  assert.equal(emptyKw.status, 400)
})

test('POST 合法输入：落库并规范化（keywords 截断 3 组、非法枚举回退默认、watchTargets 非法置 null）', async () => {
  asUser(ADMIN, 'ADMIN')

  const res = await POST(
    jsonRequest('http://t/api/tracking-signals', 'POST', {
      name: '  大厂核心成员离职跟踪  ',
      description: '跟踪大厂核心成员离职创业',
      signalType: 'NOT_A_TYPE',        // 非法 → CUSTOM
      frequency: 'MONTHLY',            // 非法 → WEEKLY
      keywords: ['字节跳动 高管 离职', '腾讯 研究员 离职', '大厂 联创 创业', '第四组应被截断'],
      watchTargets: 'not-a-json-array', // 非法 JSON → null
      industry: 'AI应用',
    })
  )
  assert.equal(res.status, 201)

  const { signal } = (await res.json()) as { signal: { id: string; keywords: string; signalType: string; frequency: string; watchTargets: string | null; name: string } }
  assert.equal(signal.name, '大厂核心成员离职跟踪', '名称去除首尾空白')
  assert.equal(signal.signalType, 'CUSTOM')
  assert.equal(signal.frequency, 'WEEKLY')

  const kws = JSON.parse(signal.keywords) as string[]
  assert.equal(kws.length, 3, '关键词最多 3 组')
  assert.ok(!kws.includes('第四组应被截断'))
  assert.equal(signal.watchTargets, null)

  const dbSignal = await prisma.trackingSignal.findUnique({ where: { id: signal.id } })
  assert.ok(dbSignal)
  assert.equal(dbSignal.createdById, ADMIN.id)
  assert.equal(dbSignal.isActive, true)
})

// ── GET /api/tracking-signals：列表权限 ──

test('GET 普通用户仅见自己的信号；ADMIN 见全部', async () => {
  await prisma.trackingSignal.create({
    data: {
      name: '管理员信号', description: 'd', keywords: '["k"]', createdById: ADMIN.id,
    },
  })
  await prisma.trackingSignal.create({
    data: {
      name: '经理信号', description: 'd', keywords: '["k"]', createdById: MANAGER.id,
    },
  })

  asUser(MANAGER, 'INVESTMENT_MANAGER')
  const managerRes = await GET()
  const managerList = ((await managerRes.json()) as { signals: Array<{ createdById: string }> }).signals
  assert.equal(managerList.length, 1)
  assert.equal(managerList[0].createdById, MANAGER.id)

  asUser(ADMIN, 'ADMIN')
  const adminRes = await GET()
  const adminList = ((await adminRes.json()) as { signals: Array<{ name: string }> }).signals
  assert.equal(adminList.length, 2)
})

// ── PATCH /api/tracking-signals/[id]：编辑 ──

test('PATCH：未登录 401 / 非创建者 403 / 空 body 400 / 创建者切换 isActive 生效', async () => {
  const signal = await prisma.trackingSignal.create({
    data: { name: '待编辑信号', description: 'd', keywords: '["k"]', createdById: ADMIN.id },
  })
  const url = `http://t/api/tracking-signals/${signal.id}`

  // 未登录
  const unauth = await PATCH(jsonRequest(url, 'PATCH', { isActive: false }), { params: { id: signal.id } })
  assert.equal(unauth.status, 401)

  // 非创建者（INVESTMENT_MANAGER）
  asUser(MANAGER, 'INVESTMENT_MANAGER')
  const forbidden = await PATCH(jsonRequest(url, 'PATCH', { isActive: false }), { params: { id: signal.id } })
  assert.equal(forbidden.status, 403)

  // 创建者：空 body
  asUser(ADMIN, 'ADMIN')
  const empty = await PATCH(jsonRequest(url, 'PATCH', {}), { params: { id: signal.id } })
  assert.equal(empty.status, 400)

  // 创建者：合法更新（启停 + 频率）
  const ok = await PATCH(jsonRequest(url, 'PATCH', { isActive: false, frequency: 'DAILY' }), { params: { id: signal.id } })
  assert.equal(ok.status, 200)
  const updated = await prisma.trackingSignal.findUnique({ where: { id: signal.id } })
  assert.ok(updated)
  assert.equal(updated.isActive, false)
  assert.equal(updated.frequency, 'DAILY')

  // 不存在的信号
  const notFoundOwner = await PATCH(jsonRequest('http://t/api/tracking-signals/nonexistent', 'PATCH', { isActive: true }), { params: { id: 'nonexistent' } })
  assert.equal(notFoundOwner.status, 403)
})

// ── DELETE /api/tracking-signals/[id] ──

test('DELETE：非创建者 403；创建者删除成功', async () => {
  const signal = await prisma.trackingSignal.create({
    data: { name: '待删除信号', description: 'd', keywords: '["k"]', createdById: ADMIN.id },
  })
  const url = `http://t/api/tracking-signals/${signal.id}`

  asUser(MANAGER, 'INVESTMENT_MANAGER')
  const forbidden = await DELETE(new Request(url, { method: 'DELETE' }), { params: { id: signal.id } })
  assert.equal(forbidden.status, 403)

  asUser(ADMIN, 'ADMIN')
  const ok = await DELETE(new Request(url, { method: 'DELETE' }), { params: { id: signal.id } })
  assert.equal(ok.status, 200)
  const gone = await prisma.trackingSignal.findUnique({ where: { id: signal.id } })
  assert.equal(gone, null)
})

// ── POST /api/tracking-signals/[id]/run：手动执行 ──

test('run：未登录 401 / 不存在 404 / 创建者执行 200 且返回结果', async () => {
  // 未登录
  const unauth = await RUN_POST(new Request('http://t/x', { method: 'POST' }), { params: { id: 'any' } })
  assert.equal(unauth.status, 401)

  asUser(ADMIN, 'ADMIN')
  const notFound = await RUN_POST(new Request('http://t/x', { method: 'POST' }), { params: { id: 'nonexistent' } })
  assert.equal(notFound.status, 404)

  const signal = await prisma.trackingSignal.create({
    data: {
      name: '手动执行信号',
      description: 'd',
      keywords: JSON.stringify(['手动执行 关键词']),
      createdById: ADMIN.id,
    },
  })
  mockState.searchResponses.set('手动执行 关键词', [searchResult('新闻', 'https://example.com/run-test')])
  mockState.fetchHandler = () =>
    chatCompletions(
      JSON.stringify({
        leads: [
          { eventName: '某人离职创业', person: '某人', company: '某大厂', newVenture: '新公司', sourceIndex: 0 },
        ],
      })
    )

  const res = await RUN_POST(new Request(`http://t/api/tracking-signals/${signal.id}/run`, { method: 'POST' }), { params: { id: signal.id } })
  assert.equal(res.status, 200)
  const { result } = (await res.json()) as { result: { savedCount: number; foundCount: number } }
  assert.equal(result.foundCount, 1)
  assert.equal(result.savedCount, 1)

  const lead = await prisma.projectLead.findFirst({ where: { signalId: signal.id } })
  assert.ok(lead)
  assert.equal(lead.name, '新公司')
})

// ── POST /api/tracking-signals/generate：自然语言生成 ──

test('generate：未登录 401 / 描述过短 400 / 超长 400', async () => {
  const unauth = await GENERATE_POST(jsonRequest('http://t/api/tracking-signals/generate', 'POST', { description: '我想跟踪一些信号' }))
  assert.equal(unauth.status, 401)

  asUser(ADMIN, 'ADMIN')
  const tooShort = await GENERATE_POST(jsonRequest('http://t/api/tracking-signals/generate', 'POST', { description: '太短' }))
  assert.equal(tooShort.status, 400)

  const tooLong = await GENERATE_POST(
    jsonRequest('http://t/api/tracking-signals/generate', 'POST', { description: '长'.repeat(501) })
  )
  assert.equal(tooLong.status, 400)
})

test('generate：DeepSeek 返回合法草稿 → 规范化输出（keywords/watchTargets 截断、枚举白名单校验）', async () => {
  asUser(ADMIN, 'ADMIN')

  mockState.fetchHandler = (url, body) => {
    assert.ok(url.includes('api.deepseek.com'))
    // system prompt 应包含行业列表与信号类型说明
    const system = (body.messages as Array<{ role: string; content: string }>)[0].content
    assert.ok(system.includes('AI应用'))
    assert.ok(system.includes('PERSONNEL_CHANGE'))
    return chatCompletions(
      JSON.stringify({
        name: '大厂核心成员离职跟踪',
        signalType: 'PERSONNEL_CHANGE',
        keywords: ['字节跳动 高管 离职', '腾讯 AI 研究员 离职', '明星项目 联创 离职', '第四组被截断'],
        watchTargets: ['字节跳动', '  ', '腾讯', 42, null],
        industry: 'AI应用',
        frequency: 'DAILY',
        reason: '按用户描述配置人事变动跟踪',
      })
    )
  }

  const res = await GENERATE_POST(
    jsonRequest('http://t/api/tracking-signals/generate', 'POST', { description: '我想跟踪大厂或明星项目核心成员离职的信号' })
  )
  assert.equal(res.status, 200)
  const { draft } = (await res.json()) as {
    draft: {
      name: string
      signalType: string
      keywords: string[]
      watchTargets: string[]
      industry: string
      frequency: string
      reason: string
    }
  }

  assert.equal(draft.name, '大厂核心成员离职跟踪')
  assert.equal(draft.signalType, 'PERSONNEL_CHANGE')
  assert.equal(draft.keywords.length, 3, '关键词截断至 3 组')
  assert.deepEqual(draft.watchTargets, ['字节跳动', '腾讯'], 'watchTargets 过滤空值与非字符串')
  assert.equal(draft.industry, 'AI应用')
  assert.equal(draft.frequency, 'DAILY')
})

test('generate：DeepSeek 输出无效（无名称/关键词）→ 502；行业白名单外 → 置空', async () => {
  asUser(ADMIN, 'ADMIN')

  // 无效输出
  mockState.fetchHandler = () => chatCompletions('抱歉，我无法理解您的需求。')
  const invalid = await GENERATE_POST(
    jsonRequest('http://t/api/tracking-signals/generate', 'POST', { description: '我想跟踪一些创业信号' })
  )
  assert.equal(invalid.status, 502)

  // 有效但行业/类型/频率不在白名单
  mockState.fetchHandler = () =>
    chatCompletions(
      JSON.stringify({
        name: '某信号',
        signalType: 'UNKNOWN_TYPE',
        keywords: ['k'],
        watchTargets: [],
        industry: '不存在的行业',
        frequency: 'HOURLY',
      })
    )
  const res = await GENERATE_POST(
    jsonRequest('http://t/api/tracking-signals/generate', 'POST', { description: '我想跟踪某些信号' })
  )
  assert.equal(res.status, 200)
  const { draft } = (await res.json()) as { draft: { signalType: string; industry: string; frequency: string } }
  assert.equal(draft.signalType, 'CUSTOM', '非法类型回退 CUSTOM')
  assert.equal(draft.industry, '', '白名单外行业置空')
  assert.equal(draft.frequency, 'WEEKLY', '非 DAILY 频率回退 WEEKLY')
})
