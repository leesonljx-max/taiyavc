/**
 * V2.0.0 测试：单模块分析（事实卡 + 行动）/ 人工结论 / 投委会问答
 *
 * POST /api/dd/resources/[projectId]/[moduleKey]/analyze   单模块 AI 分析（facts + actions 落库）
 * PUT  /api/dd/resources/[projectId]/[moduleKey]/facts     更新事实状态（确认/冲突/重置）
 * PUT  /api/dd/resources/[projectId]/[moduleKey]           保存人工结论
 * GET/POST .../qa                                          投委会问答（合伙人提问 / 维护人回答）
 */

import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { resetMocks, mockState, chatCompletions } from './helpers/setup'
import { DD_TEMPLATE_MODULES } from '@/lib/dd-workbench/template'

import { GET as RES_GET } from '@/app/api/dd/resources/[projectId]/route'
import { PUT as TEXT_PUT } from '@/app/api/dd/resources/[projectId]/[moduleKey]/route'
import { POST as ANALYZE_POST } from '@/app/api/dd/resources/[projectId]/[moduleKey]/analyze/route'
import { PUT as FACTS_PUT } from '@/app/api/dd/resources/[projectId]/[moduleKey]/facts/route'
import { GET as QA_GET, POST as QA_POST } from '@/app/api/dd/resources/[projectId]/[moduleKey]/qa/route'

const SUFFIX = String(Date.now()).slice(-6)
const MANAGER_EMAIL = `d3-mgr-${SUFFIX}@test.com`
const PARTNER_EMAIL = `d3-p1-${SUFFIX}@test.com`
const OUTSIDER_EMAIL = `d3-out-${SUFFIX}@test.com`

let managerId = ''
let partnerId = ''
let outsiderId = ''
let projectId = ''

beforeEach(async () => {
  resetMocks()
  await prisma.dDModuleQA.deleteMany({})
  await prisma.dDModuleResource.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'D3测试项目' } } })
  await prisma.user.deleteMany({
    where: { email: { in: [MANAGER_EMAIL, PARTNER_EMAIL, OUTSIDER_EMAIL] } },
  })

  managerId = (await prisma.user.create({
    data: { email: MANAGER_EMAIL, name: '维护经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
  partnerId = (await prisma.user.create({
    data: { email: PARTNER_EMAIL, name: '决策合伙人', passwordHash: 'x', role: 'INVESTMENT_PARTNER', status: 'ACTIVE' },
  })).id
  outsiderId = (await prisma.user.create({
    data: { email: OUTSIDER_EMAIL, name: '路人经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id

  const project = await prisma.project.create({
    data: {
      name: `D3测试项目${SUFFIX}`,
      totalAmount: '500万',
      targetDate: new Date(),
      followStage: 'DUE_DILIGENCE',
      createdById: managerId,
    },
  })
  projectId = project.id
})

after(async () => {
  await prisma.dDModuleQA.deleteMany({})
  await prisma.dDModuleResource.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'D3测试项目' } } })
  await prisma.user.deleteMany({
    where: { email: { in: [MANAGER_EMAIL, PARTNER_EMAIL, OUTSIDER_EMAIL] } },
  })
  await prisma.$disconnect()
})

function asUser(id: string, role: string) {
  mockState.session = { user: { id, name: null, email: 'x@t.com', role } }
}
const asManager = () => asUser(managerId, 'INVESTMENT_MANAGER')
const asPartner = () => asUser(partnerId, 'INVESTMENT_PARTNER')

const resUrl = () => `http://t/api/dd/resources/${projectId}`
const modUrl = (moduleKey: string) => `http://t/api/dd/resources/${projectId}/${moduleKey}`

/** 给指定模块上传一个文本框（让模块资料完整） */
async function fillModule(moduleKey: string, content = '财务要点：2025 年营收 8000 万元，毛利率 60%。创始人曾任大厂技术总监。') {
  const res = await TEXT_PUT(
    new Request(modUrl(moduleKey), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textBlocks: [{ content }] }),
    }),
    { params: { projectId, moduleKey } }
  )
  assert.equal(res.status, 200)
}

/** mock 单模块分析 AI 响应（system prompt 含「事实卡与下一步行动」） */
function mockAnalysisAI() {
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('事实卡与下一步行动')) {
      return chatCompletions(JSON.stringify({
        facts: [
          { fact: '公司 2025 年营收 8000 万元', source: '维护人填写', grade: 'A' },
          { fact: '创始人曾任大厂技术总监', source: '维护人填写', grade: 'B' },
          { fact: '毛利率约 60%（推断）', source: '由资料推断', grade: 'X' },
        ],
        actions: ['补充良率验证报告', '向项目方确认订单金额'],
      }))
    }
    return chatCompletions('{}')
  }
}

/** 读取 resources 中指定模块 */
async function getModule(moduleKey: string) {
  const body = await (await RES_GET(new Request(resUrl()), { params: { projectId } })).json()
  return body.resources.find((r: { moduleKey: string }) => r.moduleKey === moduleKey)
}

// ── 单模块分析（事实卡 + 行动） ──

test('单模块分析：无资料 400；有资料 + mock AI → 落库 facts（grade 白名单/状态默认 PENDING）+ actions', async () => {
  asManager()
  const key = DD_TEMPLATE_MODULES[6].key // FINANCE_ECONOMICS

  // 无资料 → 400（提示先上传）
  let res: Response = await ANALYZE_POST(new Request(`${modUrl(key)}/analyze`, { method: 'POST' }), {
    params: { projectId, moduleKey: key },
  })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /暂无资料/)

  // 上传资料 → mock AI → 分析成功
  await fillModule(key)
  mockAnalysisAI()
  res = await ANALYZE_POST(new Request(`${modUrl(key)}/analyze`, { method: 'POST' }), {
    params: { projectId, moduleKey: key },
  })
  assert.equal(res.status, 200)
  const { analysis } = await res.json()
  assert.equal(analysis.facts.length, 3)
  assert.equal(analysis.facts[0].fact, '公司 2025 年营收 8000 万元')
  assert.equal(analysis.facts[0].grade, 'A')
  assert.equal(analysis.facts[0].status, 'PENDING')
  // 非法 grade 'X' → 回退 'C'
  assert.equal(analysis.facts[2].grade, 'C')
  assert.deepEqual(analysis.actions, ['补充良率验证报告', '向项目方确认订单金额'])

  // GET resources 返回 analysis（其它模块 analysis 为 null）
  const mod = await getModule(key)
  assert.ok(mod.analysis)
  assert.equal(mod.analysis.facts.length, 3)
  assert.equal(mod.conclusion, null)
  const other = await getModule(DD_TEMPLATE_MODULES[0].key)
  assert.equal(other.analysis, null)

  // AI 返回空 facts → 400
  mockState.fetchHandler = () => chatCompletions(JSON.stringify({ facts: [], actions: [] }))
  res = await ANALYZE_POST(new Request(`${modUrl(key)}/analyze`, { method: 'POST' }), {
    params: { projectId, moduleKey: key },
  })
  assert.equal(res.status, 400)

  // 路人无权 → 403；无效模块 → 400；未登录 → 401
  asUser(outsiderId, 'INVESTMENT_MANAGER')
  res = await ANALYZE_POST(new Request(`${modUrl(key)}/analyze`, { method: 'POST' }), {
    params: { projectId, moduleKey: key },
  })
  assert.equal(res.status, 403)
  asManager()
  res = await ANALYZE_POST(new Request(`${modUrl('BAD_KEY')}/analyze`, { method: 'POST' }), {
    params: { projectId, moduleKey: 'BAD_KEY' },
  })
  assert.equal(res.status, 400)
  mockState.session = null
  res = await ANALYZE_POST(new Request(`${modUrl(key)}/analyze`, { method: 'POST' }), {
    params: { projectId, moduleKey: key },
  })
  assert.equal(res.status, 401)
})

// ── 事实状态更新 ──

test('事实状态更新：确认/冲突/重置落库；无效 factId 404；无效 status 400；未分析 400', async () => {
  asManager()
  const key = DD_TEMPLATE_MODULES[0].key

  // 未分析 → 400
  let res: Response = await FACTS_PUT(
    new Request(`${modUrl(key)}/facts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factId: 'f1', status: 'CONFIRMED' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  assert.equal(res.status, 400)

  // 分析后取 factId
  await fillModule(key)
  mockAnalysisAI()
  await ANALYZE_POST(new Request(`${modUrl(key)}/analyze`, { method: 'POST' }), {
    params: { projectId, moduleKey: key },
  })
  let mod = await getModule(key)
  const factId = mod.analysis.facts[0].id as string
  const factId2 = mod.analysis.facts[1].id as string

  // 确认 → 200 + 落库
  res = await FACTS_PUT(
    new Request(`${modUrl(key)}/facts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factId, status: 'CONFIRMED' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  assert.equal(res.status, 200)
  mod = await getModule(key)
  assert.equal(mod.analysis.facts[0].status, 'CONFIRMED')
  assert.equal(mod.analysis.facts[1].status, 'PENDING')

  // 冲突 → 落库
  await FACTS_PUT(
    new Request(`${modUrl(key)}/facts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factId: factId2, status: 'CONFLICT' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  mod = await getModule(key)
  assert.equal(mod.analysis.facts[1].status, 'CONFLICT')
  // 冲突数计入（前端 VisualTaskStats 红旗驱动源）
  assert.equal(mod.analysis.facts.filter((f: { status: string }) => f.status === 'CONFLICT').length, 1)

  // 重置待确认
  await FACTS_PUT(
    new Request(`${modUrl(key)}/facts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factId: factId2, status: 'PENDING' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  mod = await getModule(key)
  assert.equal(mod.analysis.facts[1].status, 'PENDING')

  // 无效 factId → 404；无效 status → 400
  res = await FACTS_PUT(
    new Request(`${modUrl(key)}/facts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factId: 'nope', status: 'CONFIRMED' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  assert.equal(res.status, 404)
  res = await FACTS_PUT(
    new Request(`${modUrl(key)}/facts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factId, status: 'WHATEVER' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  assert.equal(res.status, 400)

  // 路人无权 → 403
  asUser(outsiderId, 'INVESTMENT_MANAGER')
  res = await FACTS_PUT(
    new Request(`${modUrl(key)}/facts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factId, status: 'CONFIRMED' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  assert.equal(res.status, 403)
})

// ── 人工结论 ──

test('人工结论：单独保存不覆盖文本框；GET resources 回显 conclusion', async () => {
  asManager()
  const key = DD_TEMPLATE_MODULES[2].key
  await fillModule(key, '团队要点：创始人 2 名，均 10 年以上经验。')

  let res: Response = await TEXT_PUT(
    new Request(modUrl(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conclusion: '团队结构完整，与阶段目标匹配；建议补充 CTO 招聘计划。' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  assert.equal(res.status, 200)

  const mod = await getModule(key)
  assert.equal(mod.conclusion, '团队结构完整，与阶段目标匹配；建议补充 CTO 招聘计划。')
  // 文本框未被覆盖
  assert.equal(mod.textBlocks.length, 1)
  assert.ok(mod.textBlocks[0].content.includes('创始人 2 名'))
})

// ── 投委会问答 ──

test('投委会问答：合伙人提问 → 维护人回答 → 列表显示账户名与回答；经理提问 403', async () => {
  const key = DD_TEMPLATE_MODULES[1].key

  // 合伙人提问
  asPartner()
  let res: Response = await QA_POST(
    new Request(`${modUrl(key)}/qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '该技术是否可第三方验证？量产良率数据是否已有？' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  assert.equal(res.status, 200)

  // 维护人（经理）不可提问 → 403（仅投委会可发布问题）
  asManager()
  res = await QA_POST(
    new Request(`${modUrl(key)}/qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '经理能提问吗？' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  assert.equal(res.status, 403)

  // 列表：1 个问题、显示提问人账户名、无回答
  let body = await (await QA_GET(new Request(`${modUrl(key)}/qa`), { params: { projectId, moduleKey: key } })).json()
  assert.equal(body.questions.length, 1)
  assert.equal(body.questions[0].questionerName, '决策合伙人')
  assert.equal(body.questions[0].answer, null)
  const qaId = body.questions[0].id as string

  // 维护人回答
  res = await QA_POST(
    new Request(`${modUrl(key)}/qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qaId, answer: '已提供第三方检测报告；量产良率 92%，数据见附件。' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  assert.equal(res.status, 200)

  // 列表：回答显示回答人账户名
  body = await (await QA_GET(new Request(`${modUrl(key)}/qa`), { params: { projectId, moduleKey: key } })).json()
  assert.equal(body.questions.length, 1)
  assert.equal(body.questions[0].answer, '已提供第三方检测报告；量产良率 92%，数据见附件。')
  assert.equal(body.questions[0].answererName, '维护经理')
  assert.ok(body.questions[0].answeredAt)

  // 空问题 400；空回答 400；跨项目 qaId 404
  asPartner()
  res = await QA_POST(
    new Request(`${modUrl(key)}/qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '   ' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  assert.equal(res.status, 400)
  asManager()
  res = await QA_POST(
    new Request(`${modUrl(key)}/qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qaId, answer: '' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  assert.equal(res.status, 400)
  res = await QA_POST(
    new Request(`${modUrl(key)}/qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qaId: 'nonexistent', answer: 'x' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  assert.equal(res.status, 404)

  // 路人 POST 403 / 未登录 GET 401
  asUser(outsiderId, 'INVESTMENT_MANAGER')
  res = await QA_POST(
    new Request(`${modUrl(key)}/qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '路人提问' }),
    }),
    { params: { projectId, moduleKey: key } }
  )
  assert.equal(res.status, 403)
  mockState.session = null
  res = await QA_GET(new Request(`${modUrl(key)}/qa`), { params: { projectId, moduleKey: key } })
  assert.equal(res.status, 401)
  assert.equal((await res.json()).error, '登录已过期，请退出后重新登录')
})
