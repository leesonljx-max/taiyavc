/**
 * 尽调工作台 v2 测试：资料中心 + 分模块报告 + 投资决策
 *
 * GET  /api/dd/resources/[projectId]                九大模块资料 + 完整性
 * PUT  /api/dd/resources/[projectId]/[moduleKey]     保存文本框
 * POST/DELETE .../documents、.../screenshots          文档/截图管理
 * POST /api/dd/resources/[projectId]/report          生成尽调报告（完整性门槛 + 九模块 AI）
 * GET/POST /api/dd/decision/[projectId]              投资决策（三人规则）
 */

import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { resetMocks, mockState, chatCompletions } from './helpers/setup'
import { DD_TEMPLATE_MODULES } from '@/lib/dd-workbench/template'

import { GET as RES_GET } from '@/app/api/dd/resources/[projectId]/route'
import { PUT as TEXT_PUT } from '@/app/api/dd/resources/[projectId]/[moduleKey]/route'
import { POST as DOC_POST, DELETE as DOC_DELETE } from '@/app/api/dd/resources/[projectId]/[moduleKey]/documents/route'
import { POST as SHOT_POST, DELETE as SHOT_DELETE } from '@/app/api/dd/resources/[projectId]/[moduleKey]/screenshots/route'
import { POST as REPORT_POST } from '@/app/api/dd/resources/[projectId]/report/route'
import { GET as DECISION_GET, POST as DECISION_POST } from '@/app/api/dd/decision/[projectId]/route'

const SUFFIX = String(Date.now()).slice(-6)
const MANAGER_EMAIL = `d2-mgr-${SUFFIX}@test.com`
const PARTNER_EMAILS = [`d2-p1-${SUFFIX}@test.com`, `d2-p2-${SUFFIX}@test.com`, `d2-p3-${SUFFIX}@test.com`]

let managerId = ''
let partnerIds: string[] = []
let projectId = ''

beforeEach(async () => {
  resetMocks()
  await prisma.dDInvestmentDecision.deleteMany({})
  await prisma.dDModuleResource.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'D2测试项目' } } })
  await prisma.user.deleteMany({
    where: { email: { in: [MANAGER_EMAIL, ...PARTNER_EMAILS] } },
  })

  managerId = (await prisma.user.create({
    data: { email: MANAGER_EMAIL, name: '维护经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
  partnerIds = []
  for (let i = 0; i < 3; i++) {
    const p = await prisma.user.create({
      data: { email: PARTNER_EMAILS[i], name: `合伙人${i + 1}`, passwordHash: 'x', role: 'INVESTMENT_PARTNER', status: 'ACTIVE' },
    })
    partnerIds.push(p.id)
  }

  const project = await prisma.project.create({
    data: {
      name: `D2测试项目${SUFFIX}`,
      totalAmount: '500万',
      targetDate: new Date(),
      followStage: 'DUE_DILIGENCE',
      createdById: managerId,
    },
  })
  projectId = project.id
})

after(async () => {
  await prisma.dDInvestmentDecision.deleteMany({})
  await prisma.dDModuleResource.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'D2测试项目' } } })
  await prisma.user.deleteMany({
    where: { email: { in: [MANAGER_EMAIL, ...PARTNER_EMAILS] } },
  })
  await prisma.$disconnect()
})

function asUser(id: string, role: string) {
  mockState.session = { user: { id, name: null, email: 'x@t.com', role } }
}
const asManager = () => asUser(managerId, 'INVESTMENT_MANAGER')
const asPartner = (i: number) => asUser(partnerIds[i], 'INVESTMENT_PARTNER')

const resUrl = (pid = projectId) => `http://t/api/dd/resources/${pid}`
const modUrl = (moduleKey: string) => `http://t/api/dd/resources/${projectId}/${moduleKey}`

/** 九大模块全部补齐资料（每模块一个文本框） */
async function fillAllModules() {
  for (const m of DD_TEMPLATE_MODULES) {
    const res = await TEXT_PUT(
      new Request(modUrl(m.key), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textBlocks: [{ content: `${m.name}的资料内容：核心事实与数据要点。` }] }),
      }),
      { params: { projectId, moduleKey: m.key } }
    )
    assert.equal(res.status, 200)
  }
}

/** mock 模块报告 AI 响应 */
function mockReportAI() {
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('尽调总结报告')) {
      return chatCompletions(
        JSON.stringify({
          summary: '该模块资料完整，关键事实清晰。',
          opportunities: ['技术路线领先', '订单增长明确'],
          risks: ['良率数据未提供，需补充验证'],
        })
      )
    }
    return chatCompletions('{}')
  }
}

// ── 资料中心 ──

test('GET 资料中心：初始九模块全空、不完整；PUT 文本框后该模块完整', async () => {
  asManager()
  let res: Response = await RES_GET(new Request(resUrl()), { params: { projectId } })
  assert.equal(res.status, 200)
  let body = await res.json()
  assert.equal(body.resources.length, 9)
  assert.equal(body.allComplete, false)
  assert.equal(body.reportReady, false)

  // 保存文本框（第一个模块）
  const firstKey = DD_TEMPLATE_MODULES[0].key
  res = await TEXT_PUT(
    new Request(modUrl(firstKey), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textBlocks: [{ content: '主体与轮次信息：拟融资 500 万。' }, { content: '' }] }),
    }),
    { params: { projectId, moduleKey: firstKey } }
  )
  assert.equal(res.status, 200)

  body = await (await RES_GET(new Request(resUrl()), { params: { projectId } })).json()
  const first = body.resources.find((r: { moduleKey: string }) => r.moduleKey === firstKey)
  assert.equal(first.textBlocks.length, 2)
  assert.equal(first.textBlocks[0].content.includes('500 万'), true)
  // 有非空文本框 → 完整
  const completeCount = body.resources.filter((r: { textBlocks: Array<{ content: string }> }) => r.textBlocks.some((t: { content: string }) => t.content.trim())).length
  assert.equal(completeCount, 1)
  assert.equal(body.allComplete, false)

  // 无效 moduleKey → 400
  res = await TEXT_PUT(
    new Request(modUrl('INVALID_KEY'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textBlocks: [] }),
    }),
    { params: { projectId, moduleKey: 'INVALID_KEY' } }
  )
  assert.equal(res.status, 400)
})

test('文档上传（txt 自动提取全文）与删除；截图上传与删除', async () => {
  asManager()
  const key = DD_TEMPLATE_MODULES[1].key

  // 上传 txt 文档
  const fd = new FormData()
  fd.append('file', new File(['技术架构：硅光计算加速芯片，性能对标 Lightmatter。'], '技术架构.txt', { type: 'text/plain' }))
  let res: Response = await DOC_POST(new Request(`${modUrl(key)}/documents`, { method: 'POST', body: fd }), {
    params: { projectId, moduleKey: key },
  })
  assert.equal(res.status, 200)

  let body = await (await RES_GET(new Request(resUrl()), { params: { projectId } })).json()
  const mod = body.resources.find((r: { moduleKey: string }) => r.moduleKey === key)
  assert.equal(mod.documents.length, 1)
  assert.equal(mod.documents[0].fileName, '技术架构.txt')
  assert.ok(mod.documents[0].text.includes('硅光'))

  // 上传截图（伪造 PNG 头）
  const fdShot = new FormData()
  fdShot.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], '架构图.png', { type: 'image/png' }))
  res = await SHOT_POST(new Request(`${modUrl(key)}/screenshots`, { method: 'POST', body: fdShot }), {
    params: { projectId, moduleKey: key },
  })
  assert.equal(res.status, 200)

  body = await (await RES_GET(new Request(resUrl()), { params: { projectId } })).json()
  const mod2 = body.resources.find((r: { moduleKey: string }) => r.moduleKey === key)
  assert.equal(mod2.screenshots.length, 1)
  assert.ok(mod2.screenshots[0].url.includes('project-images'))
  const shotId = mod2.screenshots[0].id
  const docId = mod2.documents[0].id

  // 删除截图
  res = await SHOT_DELETE(new Request(`${modUrl(key)}/screenshots?shotId=${shotId}`, { method: 'DELETE' }), {
    params: { projectId, moduleKey: key },
  })
  assert.equal(res.status, 200)

  // 删除文档
  res = await DOC_DELETE(new Request(`${modUrl(key)}/documents?docId=${docId}`, { method: 'DELETE' }), {
    params: { projectId, moduleKey: key },
  })
  assert.equal(res.status, 200)

  body = await (await RES_GET(new Request(resUrl()), { params: { projectId } })).json()
  const mod3 = body.resources.find((r: { moduleKey: string }) => r.moduleKey === key)
  assert.equal(mod3.documents.length, 0)
  assert.equal(mod3.screenshots.length, 0)
})

// ── 尽调报告 ──

test('生成报告：资料不完整 400 + 缺失清单；补齐后生成九模块报告（含机会与风险）', async () => {
  asManager()

  // 不完整 → 400 + missing
  let res: Response = await REPORT_POST(new Request(`${resUrl()}/report`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 400)
  let body = await res.json()
  assert.equal(body.missing.length, 9)

  // 补齐全部九模块
  await fillAllModules()

  // 完整 → mock AI → 生成成功
  mockReportAI()
  res = await REPORT_POST(new Request(`${resUrl()}/report`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 200)

  body = await (await RES_GET(new Request(resUrl()), { params: { projectId } })).json()
  assert.equal(body.reportReady, true)
  assert.equal(body.allComplete, true)
  for (const r of body.resources) {
    assert.ok(r.report, `${r.moduleName} 应有报告`)
    assert.ok(r.report.summary.includes('资料完整'))
    assert.equal(r.report.opportunities.length, 2)
    assert.equal(r.report.risks.length, 1)
  }

  // AI 失败（返回空）→ 502
  mockState.fetchHandler = () => chatCompletions('{}')
  await prisma.dDModuleResource.updateMany({
    where: { projectId },
    data: { reportJson: null },
  })
  res = await REPORT_POST(new Request(`${resUrl()}/report`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 502)
})

// ── 投资决策 ──

test('投资决策：报告未生成不可决策；三人规则（全投→投资 / 任一不投→不投资 / 未满→待决策）', async () => {
  // 报告未生成 → POST 400
  asPartner(0)
  let res: Response = await DECISION_POST(
    new Request(`http://t/api/dd/decision/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'INVEST', amount: 500 }),
    }),
    { params: { projectId } }
  )
  assert.equal(res.status, 400)

  // GET：reportReady=false
  let body = await (await DECISION_GET(new Request(`http://t/api/dd/decision/${projectId}`), { params: { projectId } })).json()
  assert.equal(body.reportReady, false)
  assert.equal(body.finalStatus, 'PENDING')

  // 生成报告
  asManager()
  await fillAllModules()
  mockReportAI()
  res = await REPORT_POST(new Request(`${resUrl()}/report`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 200)

  // INVEST 必填金额
  asPartner(0)
  res = await DECISION_POST(
    new Request(`http://t/api/dd/decision/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'INVEST' }),
    }),
    { params: { projectId } }
  )
  assert.equal(res.status, 400)

  // 维护人（非合伙人）不可决策
  asManager()
  res = await DECISION_POST(
    new Request(`http://t/api/dd/decision/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'NO_INVEST', reason: '技术存疑' }),
    }),
    { params: { projectId } }
  )
  assert.equal(res.status, 403)

  // 合伙人 1 投（500 万）→ 未满 3 人 PENDING
  asPartner(0)
  res = await DECISION_POST(
    new Request(`http://t/api/dd/decision/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'INVEST', amount: 500, reason: '技术领先' }),
    }),
    { params: { projectId } }
  )
  assert.equal(res.status, 200)
  body = await (await DECISION_GET(new Request(`http://t/api/dd/decision/${projectId}`), { params: { projectId } })).json()
  assert.equal(body.reportReady, true)
  assert.equal(body.finalStatus, 'PENDING')
  assert.equal(body.decisionCount, 1)

  // 维护人视角：待决策中（PENDING + canDecide=false）
  asManager()
  body = await (await DECISION_GET(new Request(`http://t/api/dd/decision/${projectId}`), { params: { projectId } })).json()
  assert.equal(body.finalStatus, 'PENDING')
  assert.equal(body.canDecide, false)
  assert.equal(body.decisions[0].partnerName, '合伙人1')
  assert.equal(body.decisions[0].amount, 500)

  // 合伙人 2、3 投 → 三人全投 → INVEST（各合伙人+金额）
  asPartner(1)
  await DECISION_POST(
    new Request(`http://t/api/dd/decision/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'INVEST', amount: 300 }),
    }),
    { params: { projectId } }
  )
  asPartner(2)
  await DECISION_POST(
    new Request(`http://t/api/dd/decision/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'INVEST', amount: 200 }),
    }),
    { params: { projectId } }
  )
  body = await (await DECISION_GET(new Request(`http://t/api/dd/decision/${projectId}`), { params: { projectId } })).json()
  assert.equal(body.finalStatus, 'INVEST')
  assert.equal(body.decisionCount, 3)
  assert.ok(body.decisions.every((d: { decision: string }) => d.decision === 'INVEST'))

  // 合伙人 3 改为不投资 → 任一不投 → NO_INVEST
  asPartner(2)
  res = await DECISION_POST(
    new Request(`http://t/api/dd/decision/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'NO_INVEST', reason: '估值过高' }),
    }),
    { params: { projectId } }
  )
  assert.equal(res.status, 200)
  body = await (await DECISION_GET(new Request(`http://t/api/dd/decision/${projectId}`), { params: { projectId } })).json()
  assert.equal(body.finalStatus, 'NO_INVEST')
  // 决策记录仍是 3 条（upsert 不新增）
  assert.equal(body.decisionCount, 3)
})
