/**
 * V2.1.0 测试：投后管理（文档上传 / 指标时序库 / 同比环比引擎 / AI 经营分析 / 列表）
 */

import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { resetMocks, mockState, chatCompletions } from './helpers/setup'
import {
  parsePeriod, prevQoQPeriod, prevYoYPeriod, calcChange, calcRunwayMonths, computeMetricsWithChange,
} from '@/lib/post-investment/calc'

import { GET as PI_LIST } from '@/app/api/post-investment/route'
import { POST as DOC_POST, DELETE as DOC_DELETE } from '@/app/api/post-investment/documents/route'
import { GET as PI_DETAIL } from '@/app/api/post-investment/[projectId]/route'
import { POST as ANALYZE_POST } from '@/app/api/post-investment/[projectId]/analyze/route'

const SUFFIX = String(Date.now()).slice(-6)
const MANAGER_EMAIL = `d5-mgr-${SUFFIX}@test.com`
const OUTSIDER_EMAIL = `d5-out-${SUFFIX}@test.com`

let managerId = ''
let outsiderId = ''
let projectId = ''

beforeEach(async () => {
  resetMocks()
  await prisma.postInvestAnalysis.deleteMany({})
  await prisma.postInvestMetric.deleteMany({})
  await prisma.postInvestDoc.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'D5测试项目' } } })
  await prisma.user.deleteMany({ where: { email: { in: [MANAGER_EMAIL, OUTSIDER_EMAIL] } } })

  managerId = (await prisma.user.create({
    data: { email: MANAGER_EMAIL, name: '维护经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
  outsiderId = (await prisma.user.create({
    data: { email: OUTSIDER_EMAIL, name: '路人经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id

  projectId = (await prisma.project.create({
    data: {
      name: `D5测试项目${SUFFIX}`,
      totalAmount: '500万',
      targetDate: new Date(),
      followStage: 'POST_INVESTMENT',
      createdById: managerId,
    },
  })).id
})

after(async () => {
  await prisma.postInvestAnalysis.deleteMany({})
  await prisma.postInvestMetric.deleteMany({})
  await prisma.postInvestDoc.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'D5测试项目' } } })
  await prisma.user.deleteMany({ where: { email: { in: [MANAGER_EMAIL, OUTSIDER_EMAIL] } } })
  await prisma.$disconnect()
})

function asUser(id: string, role: string) {
  mockState.session = { user: { id, name: null, email: 'x@t.com', role } }
}
const asManager = () => asUser(managerId, 'INVESTMENT_MANAGER')

/** mock 投后 AI：指标提取 + 经营分析 */
function mockPostInvestAI() {
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('投后数据抽取引擎')) {
      return chatCompletions(JSON.stringify({
        metrics: [
          { metricKey: 'revenue', value: 2353, unit: '万元', sourceText: '报告期累计实现营业收入2353万元，同比增长52%。' },
          { metricKey: 'operating_cash_flow', value: -2666, unit: '万元', sourceText: '报告期经营现金流-2666万元。' },
          { metricKey: 'cash_balance', value: 11700, unit: '万元', sourceText: '期末现金余额1.17亿元。' },
          { metricKey: 'new_orders', value: 2488, unit: '万元', sourceText: '新签订单2488万元。' },
        ],
      }))
    }
    if (system.includes('投后管理分析 Agent')) {
      return chatCompletions(JSON.stringify({
        executive_summary: '收入增长明显，盈利能力有所改善，但经营现金流仍为负，需关注回款质量。',
        financial_analysis: [{ metricName: '营业收入', value: '2353 万元', yoy: '+52%', qoq: '-', status: 'normal' }],
        anomalies: [{ level: 'medium', title: '收入与现金流背离', detail: '收入同比+52%，经营现金流-2666万元。', evidence: '营业收入 2353 万元；经营现金流 -2666 万元' }],
        cashflow_analysis: { cash_balance: '11700 万元', runway_months: 13.2, assessment: '现金余额可覆盖约 13 个月净消耗，短期安全。' },
        business_progress: [{ area: '订单', rating: 4, detail: '新签订单 2488 万元。' }],
        risk_alerts: [{ type: '现金流', level: 'medium', description: '经营现金流为负。', evidence: '经营现金流 -2666 万元' }],
      }))
    }
    return chatCompletions('{}')
  }
}

/** 直接入库一份文档（绕过上传） */
async function seedDoc(period: string, text = '报告期累计实现营业收入2353万元，同比增长52%。经营现金流-2666万元。') {
  return prisma.postInvestDoc.create({
    data: {
      projectId, docType: 'OPERATION_REPORT', period,
      fileName: `${period}经营报告.txt`, fileUrl: `/post-investment-docs/test-${Date.now()}.txt`,
      fileType: 'text/plain', fileSize: 100, text,
      uploadedById: managerId,
    },
  })
}

// ── 同比/环比引擎（纯函数） ──

test('报告期引擎：解析/环比/同比口径（Q1→上年Q4；H 不与 Q 互算；FY 无环比）', () => {
  assert.deepEqual(parsePeriod('2026Q1'), { year: 2026, seq: 1, type: 'Q' })
  assert.deepEqual(parsePeriod('2026H2'), { year: 2026, seq: 2, type: 'H' })
  assert.deepEqual(parsePeriod('2026FY'), { year: 2026, seq: 0, type: 'FY' })
  assert.equal(parsePeriod('2026Q5'), null)
  assert.equal(parsePeriod('bad'), null)

  // 环比：Q→上一季（Q1 跨年）
  assert.equal(prevQoQPeriod('2026Q2'), '2026Q1')
  assert.equal(prevQoQPeriod('2026Q1'), '2025Q4')
  // H→上一半年（H1 的上期为上年 H2）
  assert.equal(prevQoQPeriod('2026H2'), '2026H1')
  assert.equal(prevQoQPeriod('2026H1'), '2025H2')
  // FY 无环比
  assert.equal(prevQoQPeriod('2026FY'), null)

  // 同比：上年同期
  assert.equal(prevYoYPeriod('2026Q3'), '2025Q3')
  assert.equal(prevYoYPeriod('2026H1'), '2025H1')
  assert.equal(prevYoYPeriod('2026FY'), '2025FY')
})

test('变化计算：分母 0 → pct=null；runway 月数（经营现金流为正时 null）', () => {
  assert.deepEqual(calcChange(150, 100), { diff: 50, pct: 0.5 })
  assert.deepEqual(calcChange(-2666, -2588), { diff: -78, pct: -0.0301 })
  assert.equal(calcChange(100, 0)!.pct, null)
  assert.equal(calcChange(100, null), null)

  // Q：月均消耗 = 2666/3；runway = 11700 / 888.67 ≈ 13.2
  assert.equal(calcRunwayMonths(11700, -2666, '2026Q3'), 13.2)
  // 经营现金流为正 → null
  assert.equal(calcRunwayMonths(11700, 500, '2026Q3'), null)
  // 现金余额缺失 → null
  assert.equal(calcRunwayMonths(undefined, -2666, '2026Q3'), null)
  // H：月均消耗 = 7328/6
  assert.equal(calcRunwayMonths(11666.75, -7328, '2026H1'), 9.6)
})

test('批量同比环比：H1 不与 Q1 互算（环比 null）；Q→Q 正常', () => {
  const history = new Map<string, Map<string, number>>([
    ['2025Q4', new Map([['revenue', 2000]])],
    ['2025H1', new Map([['revenue', 5000]])],
    ['2025FY', new Map([['revenue', 12000]])],
    ['2026Q1', new Map([['revenue', 2353]])],
    ['2026H1', new Map([['revenue', 10571]])],
  ])
  const result = computeMetricsWithChange('2026H1', [
    { metricKey: 'revenue', metricName: '营业收入', category: 'financial', unit: '万元', value: 10571, sourceText: null },
  ], history)
  // 同比 = 10571/5000 - 1；环比 = null（H1 上期为 2025H2，不存在）
  assert.equal(result[0].yoy!.period, '2025H1')
  assert.ok(Math.abs(result[0].yoy!.pct! - 1.1142) < 0.001)
  assert.equal(result[0].qoq, null)

  const q1 = computeMetricsWithChange('2026Q1', [
    { metricKey: 'revenue', metricName: '营业收入', category: 'financial', unit: '万元', value: 2353, sourceText: null },
  ], history)
  assert.equal(q1[0].qoq!.period, '2025Q4')
  assert.ok(Math.abs(q1[0].qoq!.pct! - 0.1765) < 0.001)
  assert.equal(q1[0].yoy, null) // 2025Q1 不存在
})

// ── 上传 API ──

test('上传：txt 自动提取全文入库；无效报告期 400；路人 403；未登录 401', async () => {
  asManager()
  const fd = new FormData()
  fd.append('projectId', projectId)
  fd.append('period', '2026Q3')
  fd.append('docType', 'OPERATION_REPORT')
  fd.append('file', new File(['营业收入2353万元，同比增长52%。'], '2026Q3经营报告.txt', { type: 'text/plain' }))

  let res: Response = await DOC_POST(new Request('http://t/api/post-investment/documents', { method: 'POST', body: fd }))
  assert.equal(res.status, 200)
  let body = await res.json()
  assert.equal(body.doc.hasText, true)

  const doc = await prisma.postInvestDoc.findFirst({ where: { projectId } })
  assert.ok(doc)
  assert.ok(doc.text.includes('2353'))

  // 无效报告期
  const fd2 = new FormData()
  fd2.append('projectId', projectId)
  fd2.append('period', 'bad-period')
  fd2.append('docType', 'BP')
  fd2.append('file', new File(['x'], 'bp.pdf', { type: 'application/pdf' }))
  res = await DOC_POST(new Request('http://t/api/post-investment/documents', { method: 'POST', body: fd2 }))
  assert.equal(res.status, 400)

  // 路人 403
  asUser(outsiderId, 'INVESTMENT_MANAGER')
  const fd3 = new FormData()
  fd3.append('projectId', projectId)
  fd3.append('period', '2026Q3')
  fd3.append('docType', 'OTHER')
  fd3.append('file', new File(['x'], 'o.txt', { type: 'text/plain' }))
  res = await DOC_POST(new Request('http://t/api/post-investment/documents', { method: 'POST', body: fd3 }))
  assert.equal(res.status, 403)

  // 未登录 401
  mockState.session = null
  res = await DOC_POST(new Request('http://t/api/post-investment/documents', { method: 'POST', body: new FormData() }))
  assert.equal(res.status, 401)

  // 删除
  asManager()
  res = await DOC_DELETE(new Request(`http://t/api/post-investment/documents?docId=${doc!.id}`, { method: 'DELETE' }))
  assert.equal(res.status, 200)
  assert.equal(await prisma.postInvestDoc.count({ where: { projectId } }), 0)
})

// ── AI 分析 ──

test('AI 分析：提取指标入库 + 分析落库；无文档 400；runway 由程序计算', async () => {
  asManager()

  // 无文档 → 400
  let res: Response = await ANALYZE_POST(
    new Request(`http://t/api/post-investment/${projectId}/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: '2026Q3' }),
    }),
    { params: { projectId } }
  )
  assert.equal(res.status, 400)

  // 入库文档 → mock AI → 分析成功
  await seedDoc('2026Q3')
  mockPostInvestAI()
  res = await ANALYZE_POST(
    new Request(`http://t/api/post-investment/${projectId}/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: '2026Q3' }),
    }),
    { params: { projectId } }
  )
  assert.equal(res.status, 200)
  let body = await res.json()
  assert.equal(body.metricCount, 4)

  // 指标入库（含原文证据）
  const metrics = await prisma.postInvestMetric.findMany({ where: { projectId, period: '2026Q3' } })
  assert.equal(metrics.length, 4)
  const revenue = metrics.find(m => m.metricKey === 'revenue')!
  assert.equal(revenue.value, 2353)
  assert.ok(revenue.sourceText!.includes('2353'))

  // 分析落库
  const analysis = await prisma.postInvestAnalysis.findUnique({
    where: { projectId_period: { projectId, period: '2026Q3' } },
  })
  assert.ok(analysis)
  const parsed = JSON.parse(analysis.summaryJson)
  assert.ok(parsed.executive_summary.includes('现金流'))

  // 详情 API：periods + metricsByPeriod + analyses
  const detail = await (await PI_DETAIL(new Request(`http://t/api/post-investment/${projectId}`), { params: { projectId } })).json()
  assert.equal(detail.periods.length, 1)
  assert.equal(detail.metricsByPeriod['2026Q3'].length, 4)
  assert.equal(detail.analyses.length, 1)
  assert.equal(detail.canEdit, true)
})

// ── 列表（仅投后阶段项目） ──

test('列表：仅显示 POST_INVESTMENT 项目 + 最新分析摘要与风险', async () => {
  // 另建一个非投后阶段项目（不应出现）
  await prisma.project.create({
    data: { name: `D5测试项目B${SUFFIX}`, totalAmount: '300万', targetDate: new Date(), followStage: 'DUE_DILIGENCE', createdById: managerId },
  })

  asManager()
  // 用当前季度上传（列表的"本季已提交"按当前季度统计）
  const now = new Date()
  const currentQuarter = `${now.getFullYear()}Q${Math.floor(now.getMonth() / 3) + 1}`
  await seedDoc(currentQuarter)
  mockPostInvestAI()
  await ANALYZE_POST(
    new Request(`http://t/api/post-investment/${projectId}/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: currentQuarter }),
    }),
    { params: { projectId } }
  )

  const res = await PI_LIST(new Request('http://t/api/post-investment'))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.projects.length, 1)
  assert.equal(body.projects[0].name, `D5测试项目${SUFFIX}`)
  assert.equal(body.projects[0].latestPeriod, currentQuarter)
  assert.ok(body.projects[0].latestSummary.includes('现金流'))
  assert.equal(body.projects[0].riskLevel, 'medium')
  assert.equal(body.stats.total, 1)
  assert.equal(body.stats.submitted, 1)

  // 路人（非维护人）看不到该投后项目
  asUser(outsiderId, 'INVESTMENT_MANAGER')
  const res2 = await PI_LIST(new Request('http://t/api/post-investment'))
  const body2 = await res2.json()
  assert.equal(body2.projects.length, 0)
})
