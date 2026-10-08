/**
 * 声明校验器（ClaimVerifier）测试：报告声明提取 → 双源搜索 → 四级裁决（P2.1）
 *
 * lib  runClaimVerification：
 *   - 前置：无报告 → 错误
 *   - happy path：声明提取 → 搜索（collect 模式）→ 裁决落库 verificationJson；
 *     证据 URL 只来自真实搜索结果（越界/跨声明索引被过滤）
 *   - 搜索无结果 → 全部未证实 + 汇总标注
 *   - AI 裁决缺失声明 → 默认 UNVERIFIED
 * API  POST /api/dd/resources/[projectId]/[moduleKey]/verify：
 *   - 401 未登录 / 403 非维护人 / 400 无效模块或无报告 / 200 成功返回
 * 联动：
 *   - 报告重生成清空 verificationJson；GET 资料中心返回 verification
 */

import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { resetMocks, mockState, chatCompletions, searchResult } from './helpers/setup'
import { DD_TEMPLATE_MODULES } from '@/lib/dd-workbench/template'
import { CEO_TEMPLATE, TEAM_TEMPLATE } from '@/lib/dd-workbench/team-evaluation'

import { runClaimVerification } from '@/lib/dd-workbench/claim-verifier'
import { GET as RES_GET } from '@/app/api/dd/resources/[projectId]/route'
import { PUT as TEXT_PUT } from '@/app/api/dd/resources/[projectId]/[moduleKey]/route'
import { POST as VERIFY_POST } from '@/app/api/dd/resources/[projectId]/[moduleKey]/verify/route'
import { POST as REPORT_POST } from '@/app/api/dd/resources/[projectId]/report/route'

const SUFFIX = String(Date.now()).slice(-6)
const MANAGER_EMAIL = `cv-mgr-${SUFFIX}@test.com`
const OTHER_EMAIL = `cv-other-${SUFFIX}@test.com`

let managerId = ''
let otherId = ''
let projectId = ''
const MODULE_KEY = 'PRODUCT_TECHNOLOGY'

/** 测试用报告（含可核验声明素材） */
const TEST_REPORT = {
  summary: '一、关键事实：公司2025年营收1.2亿元，与华为签订战略合作协议，量产良率达95%。【图1】\n二、分析判断：营收增长明确。\n三、核心结论：**整体判断正常**。',
  opportunities: ['订单增长明确'],
  risks: ['良率数据待验证'],
  generatedAt: new Date().toISOString(),
}

beforeEach(async () => {
  resetMocks()
  await prisma.agentSkill.deleteMany({})
  await prisma.dDTeamEvaluation.deleteMany({})
  await prisma.dDModuleResource.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'CV测试项目' } } })
  await prisma.user.deleteMany({ where: { email: { in: [MANAGER_EMAIL, OTHER_EMAIL] } } })

  managerId = (await prisma.user.create({
    data: { email: MANAGER_EMAIL, name: '维护经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
  otherId = (await prisma.user.create({
    data: { email: OTHER_EMAIL, name: '其他经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id

  const project = await prisma.project.create({
    data: {
      name: `CV测试项目${SUFFIX}`,
      totalAmount: '500万',
      targetDate: new Date(),
      followStage: 'DUE_DILIGENCE',
      createdById: managerId,
    },
  })
  projectId = project.id
})

after(async () => {
  await prisma.dDTeamEvaluation.deleteMany({})
  await prisma.dDModuleResource.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'CV测试项目' } } })
  await prisma.user.deleteMany({ where: { email: { in: [MANAGER_EMAIL, OTHER_EMAIL] } } })
  await prisma.$disconnect()
})

function asUser(id: string, role: string) {
  mockState.session = { user: { id, name: null, email: 'x@t.com', role } }
}

/** 直接入库一份带报告的模块资料 */
async function seedReportedModule() {
  await prisma.dDModuleResource.create({
    data: {
      projectId,
      moduleKey: MODULE_KEY,
      reportJson: JSON.stringify(TEST_REPORT),
    },
  })
}

/** mock 声明提取 + 裁决两级 DeepSeek 响应（可定制 verdicts） */
function mockVerifierAI(verdicts: unknown[]) {
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('核验的事实性声明')) {
      return chatCompletions(
        JSON.stringify({
          claims: [
            { claim: '公司2025年营收1.2亿元', queries: ['甲公司 营收', '甲公司 华为 合作'] },
            { claim: '量产良率达95%', queries: ['甲公司 良率'] },
          ],
        })
      )
    }
    if (system.includes('交叉比对')) {
      return chatCompletions(JSON.stringify({ verdicts }))
    }
    return chatCompletions('{}')
  }
}

/** mock 搜索结果（按查询词返回） */
function mockSearch() {
  mockState.searchResponses.set('甲公司 营收', [
    searchResult('甲公司营收报道', 'https://news.example.com/revenue', '甲公司2025年营收约1.1亿元，同比增长40%。'),
    searchResult('甲公司融资历程', 'https://news.example.com/funding', '甲公司累计完成3轮融资。'),
  ])
  mockState.searchResponses.set('甲公司 华为 合作', [
    searchResult('甲公司与华为签署战略合作', 'https://news.example.com/huawei', '双方签署战略合作协议，覆盖智能制造场景。'),
  ])
  mockState.searchResponses.set('甲公司 良率', [
    searchResult('行业良率分析', 'https://research.example.com/yield', '同行业平均量产良率约85%，头部厂商可达92%。'),
  ])
}

// ── lib：runClaimVerification ──

test('lib：模块无报告 → 返回错误，不调用 AI 与搜索', async () => {
  mockVerifierAI([])
  const result = await runClaimVerification(projectId, MODULE_KEY)
  assert.equal(result.ok, false)
  assert.match(result.error || '', /尚未生成尽调报告/)
  assert.equal(mockState.fetchCalls.length, 0)
  assert.equal(mockState.searchCalls.length, 0)
})

test('lib：happy path——声明提取→搜索→裁决落库；证据只来自真实搜索结果', async () => {
  await seedReportedModule()
  mockVerifierAI([
    { claimIdx: 0, verdict: 'SUPPORTED', note: '证据显示营收约1.1亿元，与声明数量级一致', evidenceIdx: [0, 2] },
    { claimIdx: 1, verdict: 'EXAGGERATED', note: '行业平均85%，头部92%，声称95%明显偏高', evidenceIdx: [3, 99, 0] },
  ])
  mockSearch()

  const result = await runClaimVerification(projectId, MODULE_KEY)
  assert.equal(result.ok, true)
  const v = result.verification!
  assert.equal(v.claims.length, 2)

  // 裁决与说明
  assert.equal(v.claims[0].verdict, 'SUPPORTED')
  assert.equal(v.claims[1].verdict, 'EXAGGERATED')
  assert.match(v.claims[1].note, /85%/)

  // 证据防编造：claim0 取 [0,2]（均为声明0的证据）；claim1 中 99 越界、0 跨声明 → 只保留 [3]
  assert.deepEqual(v.claims[0].evidence.map(e => e.url), ['https://news.example.com/revenue', 'https://news.example.com/huawei'])
  assert.deepEqual(v.claims[1].evidence.map(e => e.url), ['https://research.example.com/yield'])

  // 汇总
  assert.match(v.summary, /共 2 条声明/)
  assert.match(v.summary, /✅ 一致 1/)
  assert.match(v.summary, /⚠️ 夸大 1/)

  // 搜索护栏：collect 模式、module 标记、全局查询去重（3 组唯一查询）
  assert.equal(mockState.searchCalls.length, 3)
  assert.ok(mockState.searchCalls.every(c => c.options.mode === 'collect'))
  assert.ok(mockState.searchCalls.every(c => (c.options as { module?: string }).module === 'dd-claim-verify'))

  // 落库
  const record = await prisma.dDModuleResource.findUnique({
    where: { projectId_moduleKey: { projectId, moduleKey: MODULE_KEY } },
  })
  assert.ok(record?.verificationJson)
  const saved = JSON.parse(record!.verificationJson!)
  assert.equal(saved.claims.length, 2)
})

test('lib：报告中的【图N】标记不进入声明提取文本', async () => {
  await seedReportedModule()
  mockVerifierAI([])
  mockSearch()
  await runClaimVerification(projectId, MODULE_KEY)
  // 提取调用的 user prompt 不含插图标记
  const extractCall = mockState.fetchCalls.find(c =>
    String((c.body.messages as Array<{ content: string }>)[0]?.content || '').includes('核验的事实性声明')
  )
  assert.ok(extractCall)
  const userPrompt = String((extractCall!.body.messages as Array<{ content: string }>)[1]?.content || '')
  assert.ok(!userPrompt.includes('【图1】'))
})

test('lib：搜索无结果 → 全部未证实 + 汇总标注', async () => {
  await seedReportedModule()
  mockVerifierAI([
    { claimIdx: 0, verdict: 'UNVERIFIED', note: '公开渠道无营收数据', evidenceIdx: [] },
    { claimIdx: 1, verdict: 'UNVERIFIED', note: '公开渠道良率信息不足', evidenceIdx: [] },
  ])
  // searchResponses 未配置 → searchDefault = [] 无结果

  const result = await runClaimVerification(projectId, MODULE_KEY)
  assert.equal(result.ok, true)
  const v = result.verification!
  assert.equal(v.claims.length, 2)
  assert.ok(v.claims.every(c => c.verdict === 'UNVERIFIED'))
  assert.ok(v.claims.every(c => c.evidence.length === 0))
  assert.match(v.summary, /联网检索暂无结果/)
})

test('lib：AI 裁决缺失声明 → 缺失项默认 UNVERIFIED', async () => {
  await seedReportedModule()
  mockVerifierAI([{ claimIdx: 0, verdict: 'SUPPORTED', note: '一致', evidenceIdx: [0] }])
  mockSearch()

  const result = await runClaimVerification(projectId, MODULE_KEY)
  const v = result.verification!
  assert.equal(v.claims[0].verdict, 'SUPPORTED')
  assert.equal(v.claims[1].verdict, 'UNVERIFIED')
  assert.match(v.claims[1].note, /AI 裁决不完整/)
})

// ── API：POST verify ──

const verifyUrl = () => `http://t/api/dd/resources/${projectId}/${MODULE_KEY}/verify`

test('API：未登录 401', async () => {
  const res = await VERIFY_POST(new Request(verifyUrl(), { method: 'POST' }), {
    params: { projectId, moduleKey: MODULE_KEY },
  })
  assert.equal(res.status, 401)
})

test('API：非维护人（其他经理）403', async () => {
  await seedReportedModule()
  asUser(otherId, 'INVESTMENT_MANAGER')
  const res = await VERIFY_POST(new Request(verifyUrl(), { method: 'POST' }), {
    params: { projectId, moduleKey: MODULE_KEY },
  })
  assert.equal(res.status, 403)
})

test('API：无效模块 400；无报告 400', async () => {
  asUser(managerId, 'INVESTMENT_MANAGER')
  const res1 = await VERIFY_POST(new Request(verifyUrl(), { method: 'POST' }), {
    params: { projectId, moduleKey: 'NOT_A_MODULE' },
  })
  assert.equal(res1.status, 400)

  await seedReportedModule()
  const res2 = await VERIFY_POST(
    new Request(`http://t/api/dd/resources/${projectId}/MARKET_CUSTOMERS/verify`, { method: 'POST' }),
    { params: { projectId, moduleKey: 'MARKET_CUSTOMERS' } }
  )
  assert.equal(res2.status, 400)
  const body2 = await res2.json()
  assert.match(body2.error, /尚未生成尽调报告/)
})

test('API：维护人 200——返回校验结果，GET 资料中心含 verification', async () => {
  await seedReportedModule()
  asUser(managerId, 'INVESTMENT_MANAGER')
  mockVerifierAI([
    { claimIdx: 0, verdict: 'SUPPORTED', note: '一致', evidenceIdx: [0] },
    { claimIdx: 1, verdict: 'EXAGGERATED', note: '行业平均85%', evidenceIdx: [3] },
  ])
  mockSearch()

  const res = await VERIFY_POST(new Request(verifyUrl(), { method: 'POST' }), {
    params: { projectId, moduleKey: MODULE_KEY },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.verification.claims.length, 2)

  // GET 资料中心返回解析后的 verification
  const getRes = await RES_GET(new Request(`http://t/api/dd/resources/${projectId}`), { params: { projectId } })
  assert.equal(getRes.status, 200)
  const getData = await getRes.json()
  const mod = getData.resources.find((r: { moduleKey: string }) => r.moduleKey === MODULE_KEY)
  assert.equal(mod.verification.claims.length, 2)
  assert.equal(mod.verification.claims[1].verdict, 'EXAGGERATED')
})

// ── 联动：报告重生成清空校验 ──

test('报告重生成 → verificationJson 清空', async () => {
  asUser(managerId, 'INVESTMENT_MANAGER')
  // 1. 九模块资料齐全 + 确认评分表 + 已有报告 + 已有校验
  for (const m of DD_TEMPLATE_MODULES) {
    const res = await TEXT_PUT(
      new Request(`http://t/api/dd/resources/${projectId}/${m.key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textBlocks: [{ content: `${m.name}的资料内容。` }] }),
      }),
      { params: { projectId, moduleKey: m.key } }
    )
    assert.equal(res.status, 200)
  }
  await prisma.dDTeamEvaluation.create({
    data: {
      projectId,
      membersJson: JSON.stringify([
        { id: 'm-ceo', name: '张三', roleLabel: '实控人/CEO', profileType: 'CEO', dimensions: CEO_TEMPLATE.map(d => ({ ...d, score: 8 })) },
      ]),
      teamJson: JSON.stringify(TEAM_TEMPLATE.map(d => ({ ...d, score: 8 }))),
      status: 'CONFIRMED',
      finalScore: 8.0,
      confirmedAt: new Date(),
    },
  })
  // 既有校验结果（直接入库模拟历史校验）
  await prisma.dDModuleResource.update({
    where: { projectId_moduleKey: { projectId, moduleKey: MODULE_KEY } },
    data: { reportJson: JSON.stringify(TEST_REPORT), verificationJson: JSON.stringify({ claims: [{ claim: '旧声明', verdict: 'UNVERIFIED', note: '', evidence: [] }], summary: '旧校验', verifiedAt: new Date().toISOString() }) },
  })

  // 2. mock 报告生成 AI 并重新生成
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('尽调分析报告')) {
      return chatCompletions(
        JSON.stringify({
          summary: '一、关键事实：资料完整。\n二、分析判断：正常。\n三、核心结论：**正常**。',
          opportunities: ['机会'],
          risks: ['风险'],
        })
      )
    }
    return chatCompletions('{}')
  }
  const res = await REPORT_POST(new Request(`http://t/api/dd/resources/${projectId}/report`, { method: 'POST' }), {
    params: { projectId },
  })
  assert.equal(res.status, 200)

  // 3. 校验被清空（报告内容已变，旧校验失效）
  const record = await prisma.dDModuleResource.findUnique({
    where: { projectId_moduleKey: { projectId, moduleKey: MODULE_KEY } },
  })
  assert.equal(record?.verificationJson, null)
})
