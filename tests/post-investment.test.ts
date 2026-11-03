/**
 * V2.1.0 测试：投后管理（文档上传 / 指标时序库 / 同比环比引擎 / AI 经营分析 / 列表）
 */

import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, unlink, mkdir } from 'fs/promises'
import { join } from 'path'
import JSZip from 'jszip'
import prisma from '@/lib/prisma'
import { resetMocks, mockState, chatCompletions } from './helpers/setup'
import {
  parsePeriod, prevQoQPeriod, prevYoYPeriod, calcChange, calcRunwayMonths, computeMetricsWithChange,
} from '@/lib/post-investment/calc'
import { CORE_METRIC_KEYS, METRIC_BY_KEY, sortMetricsByFramework } from '@/lib/post-investment/metrics'
import { extractTextFromFile } from '@/lib/document-extract'

import { GET as PI_LIST } from '@/app/api/post-investment/route'
import { POST as DOC_POST, DELETE as DOC_DELETE } from '@/app/api/post-investment/documents/route'
import { GET as DOC_PREVIEW } from '@/app/api/post-investment/documents/preview/route'
import { GET as PI_DETAIL } from '@/app/api/post-investment/[projectId]/route'
import { POST as ANALYZE_POST } from '@/app/api/post-investment/[projectId]/analyze/route'
import { POST as INVESTMENT_POST } from '@/app/api/post-investment/[projectId]/investment/route'

const SUFFIX = String(Date.now()).slice(-6)
const MANAGER_EMAIL = `d5-mgr-${SUFFIX}@test.com`
const OUTSIDER_EMAIL = `d5-out-${SUFFIX}@test.com`

let managerId = ''
let outsiderId = ''
let projectId = ''

/** 与 API 一致：季度结束后 45 天内仍算上一季度（季报宽限期） */
function currentReportingQuarter(): string {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  const start = new Date(now.getFullYear(), q * 3, 1)
  if (now.getTime() < start.getTime() + 45 * 24 * 60 * 60 * 1000) {
    return q === 0 ? `${now.getFullYear() - 1}Q4` : `${now.getFullYear()}Q${q}`
  }
  return `${now.getFullYear()}Q${q + 1}`
}

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
  // 清理测试写入的真实文件
  for (const f of writtenFiles) await unlink(f).catch(() => {})
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

/** 投后 AI mock 的固定返回：指标提取 4 项 / 经营分析完整结果 */
const MOCK_METRICS_JSON = JSON.stringify({
  metrics: [
    { metricKey: 'revenue', value: 2353, unit: '万元', sourceText: '报告期累计实现营业收入2353万元，同比增长52%。' },
    { metricKey: 'operating_cash_flow', value: -2666, unit: '万元', sourceText: '报告期经营现金流-2666万元。' },
    { metricKey: 'cash_balance', value: 11700, unit: '万元', sourceText: '期末现金余额1.17亿元。' },
    { metricKey: 'new_orders', value: 2488, unit: '万元', sourceText: '新签订单2488万元。' },
  ],
})

const MOCK_ANALYSIS_OBJ = {
  executive_summary: '收入增长明显，盈利能力有所改善，但经营现金流仍为负，需关注回款质量。',
  financial_analysis: [{ metricName: '营业收入', value: '2353 万元', yoy: '+52%', qoq: '-', status: 'normal' }],
  anomalies: [{ level: 'medium', title: '收入与现金流背离', detail: '收入同比+52%，经营现金流-2666万元。', evidence: '营业收入 2353 万元；经营现金流 -2666 万元' }],
  cashflow_analysis: { cash_balance: '11700 万元', runway_months: 13.2, assessment: '现金余额可覆盖约 13 个月净消耗，短期安全。' },
  business_progress: [{ area: '订单', rating: 4, detail: '新签订单 2488 万元。' }],
  risk_alerts: [{ type: '现金流', level: 'medium', description: '经营现金流为负。', evidence: '经营现金流 -2666 万元' }],
  // 技能独立模块（无技能时 AI 应输出空数组；此处 mock 带一项验证清洗与落库）
  skill_modules: [{ skill_name: '融资窗口评估', title: '本轮融资窗口', content: '1. 窗口剩余约 **12 个月**\n2. 建议加快交割节奏' }],
}
const MOCK_ANALYSIS_JSON = JSON.stringify(MOCK_ANALYSIS_OBJ)

/** mock 投后 AI：指标提取 + 经营分析 */
function mockPostInvestAI() {
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('投后数据抽取引擎')) return chatCompletions(MOCK_METRICS_JSON)
    if (system.includes('投后管理分析 Agent')) return chatCompletions(MOCK_ANALYSIS_JSON)
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

test('指标框架：核心 12 项固定顺序；短期负债/应付账款纳入字典', () => {
  // 乱序输入 → 按固定框架排序：核心项按既定顺序，业务指标追加在后
  const shuffled = [
    { metricKey: 'new_orders' },
    { metricKey: 'inventory' },
    { metricKey: 'revenue' },
    { metricKey: 'financing_amount' },
    { metricKey: 'net_profit' },
  ]
  assert.deepEqual(
    sortMetricsByFramework(shuffled).map(m => m.metricKey),
    ['revenue', 'net_profit', 'inventory', 'financing_amount', 'new_orders']
  )

  assert.deepEqual([...CORE_METRIC_KEYS], [
    'revenue', 'net_profit', 'operating_cash_flow', 'cash_balance',
    'total_assets', 'total_liabilities', 'net_assets', 'short_term_debt',
    'accounts_receivable', 'accounts_payable', 'inventory', 'financing_amount',
  ])
  assert.equal(METRIC_BY_KEY.get('short_term_debt')!.name, '短期负债')
  assert.equal(METRIC_BY_KEY.get('accounts_payable')!.name, '应付账款')
})

test('Excel 文本提取：多工作表 + 同一工作表多张表全部提取（保留列位置）', async () => {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  // 工作表 1：利润表 + 空行分隔的现金流量表（同一 sheet 内两张表）
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['利润表（万元）'],
    ['项目', '本期', '上期'],
    ['营业收入', 10571, 7000],
    [],
    ['现金流量表'],
    ['经营现金流', -7328],
  ])
  // 工作表 2：资产负债表（标签/数值分散在整行）
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['资产负债表'],
    ['总资产', 45587, '', '总负债', 3335],
  ])
  XLSX.utils.book_append_sheet(wb, ws1, '利润表')
  XLSX.utils.book_append_sheet(wb, ws2, '资产负债表')

  const { text } = await extractTextFromFile(
    XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    '多表财务报表.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
  assert.ok(text.includes('【工作表：利润表】'), '应标注第一张工作表')
  assert.ok(text.includes('【工作表：资产负债表】'), '应提取全部工作表')
  assert.ok(text.includes('营业收入\t10571\t7000'), '同一工作表的首张表应完整保留')
  assert.ok(text.includes('经营现金流\t-7328'), '空行分隔的第二张表也应提取')
  assert.ok(text.includes('总资产\t45587\t\t总负债\t3335'), '分散标签/数值应保留列位置')
})

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

// ── 手动填写投后资料 ──

test('上传：手动填写投后资料（无文件、仅 text）→ 保存为 txt 资料，预览返回文本', async () => {
  asManager()
  const fd = new FormData()
  fd.append('projectId', projectId)
  fd.append('period', '2026Q3')
  fd.append('docType', 'OPERATION_REPORT')
  fd.append('text', '本季度营收 3000 万元，订单同比增长 60%。')

  const res = await DOC_POST(new Request('http://t/api/post-investment/documents', { method: 'POST', body: fd }))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.doc.hasText, true)
  assert.equal(body.doc.fileName, '手动填写-2026Q3.txt')

  const doc = await prisma.postInvestDoc.findUnique({ where: { id: body.doc.id } })
  assert.ok(doc)
  assert.equal(doc!.fileUrl, '')
  assert.ok(doc!.text!.includes('3000'))

  // 无实体文件：预览直接返回文本
  const preview = await DOC_PREVIEW(new Request(`http://t/api/post-investment/documents/preview?docId=${body.doc.id}`))
  const pj = await preview.json()
  assert.equal(pj.kind, 'text')
  assert.match(pj.text, /3000/)
})

test('上传：手动填写富文本（含截图）→ 保存为 html 资料，预览返回 HTML 并保留图片、清理脚本', async () => {
  asManager()
  const fd = new FormData()
  fd.append('projectId', projectId)
  fd.append('period', '2026Q3')
  fd.append('docType', 'OPERATION_REPORT')
  fd.append('text', '<p>本季度营收 3000 万元</p><p><img src="/project-images/abc.png" alt="截图"></p><script>alert(1)</script>')

  const res = await DOC_POST(new Request('http://t/api/post-investment/documents', { method: 'POST', body: fd }))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.doc.fileName, '手动填写-2026Q3.html', '富文本资料应使用 html 后缀')

  const doc = await prisma.postInvestDoc.findUnique({ where: { id: body.doc.id } })
  assert.equal(doc!.fileUrl, '')
  assert.equal(doc!.fileType, 'text/html')

  const preview = await DOC_PREVIEW(new Request(`http://t/api/post-investment/documents/preview?docId=${body.doc.id}`))
  const pj = await preview.json()
  assert.equal(pj.kind, 'html')
  assert.match(pj.html, /本季度营收/)
  assert.match(pj.html, /<img[^>]+src="\/project-images\/abc\.png"/)
  assert.ok(!pj.html.includes('<script'), '预览应清理脚本标签')
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
  // 技能独立模块清洗与落库（skill_modules 随 summaryJson 持久化）
  assert.equal(parsed.skill_modules.length, 1)
  assert.equal(parsed.skill_modules[0].skill_name, '融资窗口评估')
  assert.ok(parsed.skill_modules[0].content.includes('**12 个月**'))

  // 详情 API：periods + metricsByPeriod + analyses
  const detail = await (await PI_DETAIL(new Request(`http://t/api/post-investment/${projectId}`), { params: { projectId } })).json()
  assert.equal(detail.periods.length, 1)
  assert.equal(detail.metricsByPeriod['2026Q3'].length, 4)
  // 返回值按固定框架排序（营业收入 → 经营现金流 → 现金余额 → 业务指标）
  assert.deepEqual(
    detail.metricsByPeriod['2026Q3'].map((m: { metricKey: string }) => m.metricKey),
    ['revenue', 'operating_cash_flow', 'cash_balance', 'new_orders']
  )
  assert.equal(detail.analyses.length, 1)
  assert.equal(detail.canEdit, true)
})

test('AI 分析：输出被 max_tokens 截断时按最后一个完整字段兜底（不报"结果不完整"）', async () => {
  asManager()
  await seedDoc('2026Q3')

  // 模拟模型输出在 risk_alerts 字段中途被截断（finish_reason=length）
  const cut = MOCK_ANALYSIS_JSON.indexOf('"risk_alerts"') + 30
  const truncated = MOCK_ANALYSIS_JSON.slice(0, cut)
  mockState.fetchHandler = (_url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('投后数据抽取引擎')) return chatCompletions(MOCK_METRICS_JSON)
    return chatCompletions(truncated, 'length')
  }

  const res = await ANALYZE_POST(
    new Request(`http://t/api/post-investment/${projectId}/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: '2026Q3' }),
    }),
    { params: { projectId } }
  )
  assert.equal(res.status, 200, '截断输出应兜底成功，而不是 400「AI 分析结果不完整」')
  const body = await res.json()
  assert.equal(body.metricCount, 4)

  const analysis = await prisma.postInvestAnalysis.findUnique({
    where: { projectId_period: { projectId, period: '2026Q3' } },
  })
  assert.ok(analysis)
  const parsed = JSON.parse(analysis.summaryJson)
  assert.ok(parsed.executive_summary.includes('现金流'), '应保留截断前已完整的 executive_summary')
  assert.equal(parsed.risk_alerts.length, 0, '截断的尾部字段应被丢弃')
  assert.equal(parsed.skill_modules.length, 0)
})

test('AI 分析：输出完全无法解析时自动压缩重试一次', async () => {
  asManager()
  await seedDoc('2026Q3')

  let analysisCalls = 0
  mockState.fetchHandler = (_url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('投后数据抽取引擎')) return chatCompletions(MOCK_METRICS_JSON)
    analysisCalls++
    if (analysisCalls === 1) return chatCompletions('抱歉，本次无法生成结构化结果。')
    return chatCompletions(MOCK_ANALYSIS_JSON)
  }

  const res = await ANALYZE_POST(
    new Request(`http://t/api/post-investment/${projectId}/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: '2026Q3' }),
    }),
    { params: { projectId } }
  )
  assert.equal(res.status, 200, '首次输出不可解析时应自动重试')
  assert.equal(analysisCalls, 2, '恰好压缩重试一次')

  const retryBody = mockState.fetchCalls
    .filter(c => String((c.body.messages as Array<{ content: string }>)[0]?.content || '').includes('投后管理分析 Agent'))[1]
  const retryPrompt = String((retryBody.body.messages as Array<{ content: string }>)[1]?.content || '')
  assert.ok(retryPrompt.includes('压缩重试'))

  const analysis = await prisma.postInvestAnalysis.findUnique({
    where: { projectId_period: { projectId, period: '2026Q3' } },
  })
  const parsed = JSON.parse(analysis!.summaryJson)
  assert.ok(parsed.executive_summary.includes('现金流'))
  assert.equal(parsed.risk_alerts.length, 1)
})

// ── 列表（仅投后阶段项目） ──

test('列表：仅显示 POST_INVESTMENT 项目 + 最新分析摘要与风险', async () => {
  // 另建一个非投后阶段项目（不应出现）
  await prisma.project.create({
    data: { name: `D5测试项目B${SUFFIX}`, totalAmount: '300万', targetDate: new Date(), followStage: 'DUE_DILIGENCE', createdById: managerId },
  })

  asManager()
  // 用当前报告季度上传（列表的"本季已提交"按 45 天宽限期的报告季度统计）
  const currentQuarter = currentReportingQuarter()
  await seedDoc(currentQuarter)
  mockPostInvestAI()
  await ANALYZE_POST(
    new Request(`http://t/api/post-investment/${projectId}/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: currentQuarter }),
    }),
    { params: { projectId } }
  )

  const res = await PI_LIST()
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
  const res2 = await PI_LIST()
  const body2 = await res2.json()
  assert.equal(body2.projects.length, 0)
})

// ── 合并分析（V2.1.1：以往期补传 + 历史文档合并） ──

test('合并分析：分析当期时补齐以往期指标入库 + 历史期文档进入分析上下文；以往期可直接分析', async () => {
  asManager()
  // 补传以往期（2026Q1）经营报告
  await seedDoc('2026Q1', '2026Q1经营情况：营业收入2353万元，同比增长52%。经营现金流-2666万元。期末现金余额11700万元。')
  // 当前报告季度文档（若当前即 Q1 则用 Q2 避免冲突）
  let cur = currentReportingQuarter()
  if (cur === '2026Q1') cur = '2026Q2'
  await seedDoc(cur, `${cur}经营情况：营业收入3856万元，同比增长48%。`)

  // mock：指标提取按报告期分发；分析调用时记录输入是否包含 Q1 历史内容
  let analysisSawHistory = false
  mockState.fetchHandler = (url: string, body: Record<string, unknown>) => {
    const messages = body.messages as Array<{ content: string }>
    const system = String(messages[0]?.content || '')
    const user = String(messages[1]?.content || '')
    if (system.includes('投后数据抽取引擎')) {
      if (user.includes('报告期：2026Q1')) {
        return chatCompletions(JSON.stringify({
          metrics: [
            { metricKey: 'revenue', value: 2353, unit: '万元', sourceText: '营业收入2353万元，同比增长52%。' },
            { metricKey: 'operating_cash_flow', value: -2666, unit: '万元', sourceText: '经营现金流-2666万元。' },
            { metricKey: 'cash_balance', value: 11700, unit: '万元', sourceText: '期末现金余额11700万元。' },
          ],
        }))
      }
      return chatCompletions(JSON.stringify({
        metrics: [{ metricKey: 'revenue', value: 3856, unit: '万元', sourceText: '营业收入3856万元，同比增长48%。' }],
      }))
    }
    if (system.includes('投后管理分析 Agent')) {
      analysisSawHistory = user.includes('2026Q1') && user.includes('2353')
      return chatCompletions(JSON.stringify({
        executive_summary: '收入持续增长，经营现金流连续为负需关注。',
        financial_analysis: [], anomalies: [],
        cashflow_analysis: { cash_balance: 'x', runway_months: null, assessment: 'x' },
        business_progress: [], risk_alerts: [],
      }))
    }
    return chatCompletions('{}')
  }

  // 分析当期 → 以往期（Q1）指标被自动补齐提取入库
  let res: Response = await ANALYZE_POST(
    new Request(`http://t/api/post-investment/${projectId}/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: cur }),
    }),
    { params: { projectId } }
  )
  assert.equal(res.status, 200)

  const q1Metrics = await prisma.postInvestMetric.findMany({ where: { projectId, period: '2026Q1' } })
  assert.equal(q1Metrics.length, 3)
  const q1Revenue = q1Metrics.find(m => m.metricKey === 'revenue')!
  assert.equal(q1Revenue.value, 2353)

  // 分析输入包含历史期文档内容与指标
  assert.ok(analysisSawHistory, 'AI 分析输入应包含 2026Q1 历史文档内容')

  // 以往期（Q1）也可以直接分析
  res = await ANALYZE_POST(
    new Request(`http://t/api/post-investment/${projectId}/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: '2026Q1' }),
    }),
    { params: { projectId } }
  )
  assert.equal(res.status, 200)
  const q1Analysis = await prisma.postInvestAnalysis.findUnique({
    where: { projectId_period: { projectId, period: '2026Q1' } },
  })
  assert.ok(q1Analysis)
})

// ── V2.1.2：期次页签 = 文档∪指标∪分析 并集（新传以往季度立即出现页签） ──

test('期次页签并集：补传以往季度文档后（尚无指标）详情页立即返回该期次，且最新在前', async () => {
  asManager()
  await seedDoc('2025Q2', '2025Q2经营报告内容。')
  await seedDoc('2026Q3', '2026Q3经营报告内容。')

  const detail = await (await PI_DETAIL(new Request(`http://t/api/post-investment/${projectId}`), { params: { projectId } })).json()
  assert.ok(detail.periods.includes('2025Q2'), '文档期次（无指标）应出现在页签中')
  assert.ok(detail.periods.includes('2026Q3'))
  assert.equal(detail.periods[0], '2026Q3', '最新期次应排在首位（默认选中）')
  assert.equal(detail.docs.filter((d: { period: string }) => d.period === '2025Q2').length, 1)
})

// ── V2.1.2：文档在线预览（自渲染） ──

const UPLOAD_DIR = join(process.cwd(), 'public', 'post-investment-docs')
const writtenFiles: string[] = []

/** 写入真实文件到上传目录并返回文件名 */
async function writeUploadFile(name: string, buffer: Buffer): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true })
  await writeFile(join(UPLOAD_DIR, name), buffer)
  writtenFiles.push(join(UPLOAD_DIR, name))
  return name
}

/** 构造最小合法 docx（mammoth 可解析） */
async function makeDocx(text: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.folder('_rels')!.file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' }) as unknown as Promise<Buffer>
}

/** 构造最小 pptx（仅含一页文本） */
async function makePptx(text: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`)
  return zip.generateAsync({ type: 'nodebuffer' }) as unknown as Promise<Buffer>
}

/** 直接入库文档记录（自定义文件名与地址） */
async function seedDocWithName(fileName: string, fileUrl: string, text = '') {
  return prisma.postInvestDoc.create({
    data: {
      projectId, docType: 'OPERATION_REPORT', period: '2026Q3',
      fileName, fileUrl, fileType: 'application/octet-stream', fileSize: 100, text,
      uploadedById: managerId,
    },
  })
}

test('预览 API：docx→HTML、xlsx→HTML、pdf→文件地址、pptx→文本；权限校验', async () => {
  asManager()

  // docx（旧格式 fileUrl）→ mammoth 转 HTML
  const docxName = await writeUploadFile(`test-${Date.now()}-a.docx`, await makeDocx('投后经营报告测试内容'))
  const docxDoc = await seedDocWithName('2026Q3经营报告.docx', `/post-investment-docs/${docxName}`)
  let res = await DOC_PREVIEW(new Request(`http://t/api/post-investment/documents/preview?docId=${docxDoc.id}`))
  assert.equal(res.status, 200)
  let body = await res.json()
  assert.equal(body.kind, 'html')
  assert.ok(body.html.includes('投后经营报告测试内容'), 'docx 预览 HTML 应包含文档文本')

  // xlsx（新格式 fileUrl）→ SheetJS 转 HTML 表格（多工作表 + 合并单元格）
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const ws1 = XLSX.utils.aoa_to_sheet([['指标', '', '数值'], ['营业收入', '', 2353]])
  ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
  XLSX.utils.book_append_sheet(wb, ws1, '利润表')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['总资产', 45587]]), '资产负债表')
  const xlsxName = await writeUploadFile(`test-${Date.now()}-b.xlsx`, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
  const xlsxDoc = await seedDocWithName('2026Q3财务报表.xlsx', `/api/uploads/post-investment-docs/${xlsxName}`)
  res = await DOC_PREVIEW(new Request(`http://t/api/post-investment/documents/preview?docId=${xlsxDoc.id}`))
  assert.equal(res.status, 200)
  body = await res.json()
  assert.equal(body.kind, 'html')
  assert.ok(body.html.includes('营业收入') && body.html.includes('<td>'), 'xlsx 预览 HTML 应包含表格内容')
  assert.ok(body.html.includes('利润表') && body.html.includes('资产负债表'), '应展示全部工作表')
  assert.ok(body.html.includes('colspan="2"'), '合并单元格应保留 colspan')

  // pdf → 文件地址（/api/uploads 前缀，浏览器原生渲染）
  const pdfDoc = await seedDocWithName('2026Q3报告.pdf', '/post-investment-docs/legacy.pdf')
  res = await DOC_PREVIEW(new Request(`http://t/api/post-investment/documents/preview?docId=${pdfDoc.id}`))
  assert.equal(res.status, 200)
  body = await res.json()
  assert.equal(body.kind, 'file')
  assert.equal(body.url, '/api/uploads/post-investment-docs/legacy.pdf')

  // pptx → 按页提取文本
  const pptxDoc = await seedDocWithName('路演材料.pptx', '/api/uploads/post-investment-docs/x.pptx', '【第 1 页】\n营收增长')
  res = await DOC_PREVIEW(new Request(`http://t/api/post-investment/documents/preview?docId=${pptxDoc.id}`))
  assert.equal(res.status, 200)
  body = await res.json()
  assert.equal(body.kind, 'text')
  assert.ok(body.text.includes('第 1 页'))

  // 文件丢失的 docx → 回退提取文本
  const missingDoc = await seedDocWithName('丢失.docx', '/api/uploads/post-investment-docs/not-exist.docx', '回退文本内容')
  res = await DOC_PREVIEW(new Request(`http://t/api/post-investment/documents/preview?docId=${missingDoc.id}`))
  assert.equal(res.status, 200)
  body = await res.json()
  assert.equal(body.kind, 'text')
  assert.ok(body.text.includes('回退文本内容'))

  // 路人（非维护人）403
  asUser(outsiderId, 'INVESTMENT_MANAGER')
  res = await DOC_PREVIEW(new Request(`http://t/api/post-investment/documents/preview?docId=${docxDoc.id}`))
  assert.equal(res.status, 403)

  // 未登录 401；缺 docId 400
  mockState.session = null
  res = await DOC_PREVIEW(new Request(`http://t/api/post-investment/documents/preview?docId=${docxDoc.id}`))
  assert.equal(res.status, 401)
  asManager()
  res = await DOC_PREVIEW(new Request(`http://t/api/post-investment/documents/preview`))
  assert.equal(res.status, 400)
})

test('上传 pptx：自动按页提取文本入库（供 AI 分析与文本阅览）', async () => {
  asManager()
  const pptxBuffer = await makePptx('本季度订单大幅增长')
  const fd = new FormData()
  fd.append('projectId', projectId)
  fd.append('period', '2026Q3')
  fd.append('docType', 'OPERATION_REPORT')
  fd.append('file', new File([new Uint8Array(pptxBuffer)], '2026Q3路演.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }))

  const res = await DOC_POST(new Request('http://t/api/post-investment/documents', { method: 'POST', body: fd }))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.doc.hasText, true)

  const doc = await prisma.postInvestDoc.findFirst({ where: { projectId, fileName: '2026Q3路演.pptx' } })
  assert.ok(doc)
  assert.ok(doc.text.includes('第 1 页') && doc.text.includes('本季度订单大幅增长'))
  assert.ok(doc.fileUrl.startsWith('/api/uploads/post-investment-docs/'), '新上传文件应存 /api/uploads 前缀（生产可达）')

  // 清理上传的真实文件
  const m = doc.fileUrl.match(/post-investment-docs\/([A-Za-z0-9._-]+)$/)
  if (m) writtenFiles.push(join(UPLOAD_DIR, m[1]))
})

// ── V2.2.0：投资信息（基金/金额/日期，确认后锁定） ──

test('投资信息：录入确认后锁定不可更改；校验与权限；列表/详情返回基金筛选数据', async () => {
  const invUrl = `http://t/api/post-investment/${projectId}/investment`
  const invReq = (body: object) => new Request(invUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

  // 未登录 401
  mockState.session = null
  let res: Response = await INVESTMENT_POST(invReq({ fund: '泰亚三期', amount: 100, date: '2024-12' }), { params: { projectId } })
  assert.equal(res.status, 401)

  asManager()
  // 校验失败：空基金 / 非正金额 / 非法日期格式
  res = await INVESTMENT_POST(invReq({ fund: '', amount: 100, date: '2024-12' }), { params: { projectId } })
  assert.equal(res.status, 400)
  res = await INVESTMENT_POST(invReq({ fund: '泰亚三期', amount: -5, date: '2024-12' }), { params: { projectId } })
  assert.equal(res.status, 400)
  res = await INVESTMENT_POST(invReq({ fund: '泰亚三期', amount: 100, date: '2024-13' }), { params: { projectId } })
  assert.equal(res.status, 400)
  res = await INVESTMENT_POST(invReq({ fund: '泰亚三期', amount: 100, date: '2024/12' }), { params: { projectId } })
  assert.equal(res.status, 400)

  // 路人（非维护人）403
  asUser(outsiderId, 'INVESTMENT_MANAGER')
  res = await INVESTMENT_POST(invReq({ fund: '泰亚三期', amount: 100, date: '2024-12' }), { params: { projectId } })
  assert.equal(res.status, 403)

  // 合法录入（自定义基金 → 之后下拉可选）
  asManager()
  const fundName = `泰亚五期${SUFFIX}`
  res = await INVESTMENT_POST(invReq({ fund: fundName, amount: 2500, date: '2024-12' }), { params: { projectId } })
  assert.equal(res.status, 200)

  const proj = await prisma.project.findUnique({ where: { id: projectId } })
  assert.equal(proj!.postInvestFund, fundName)
  assert.equal(proj!.postInvestAmount, 2500)
  assert.equal(proj!.postInvestDate, '2024-12')
  assert.equal(proj!.postInvestConfirmed, true)

  // 确认后锁定 → 409
  res = await INVESTMENT_POST(invReq({ fund: '泰亚一期', amount: 100, date: '2025-01' }), { params: { projectId } })
  assert.equal(res.status, 409)

  // 详情 API：investment + funds（预置 + 自定义）
  const detail = await (await PI_DETAIL(new Request(`http://t/api/post-investment/${projectId}`), { params: { projectId } })).json()
  assert.equal(detail.investment.fund, fundName)
  assert.equal(detail.investment.amount, 2500)
  assert.equal(detail.investment.date, '2024-12')
  assert.equal(detail.investment.confirmed, true)
  assert.ok(detail.funds.includes(fundName), '自定义基金应出现在可选列表')
  assert.ok(detail.funds.includes('泰亚一期') && detail.funds.includes('泰亚四期'), '预置基金应在列表中')

  // 列表 API：investment + funds
  const list = await (await PI_LIST()).json()
  const item = list.projects.find((p: { id: string }) => p.id === projectId)
  assert.ok(item)
  assert.equal(item.investment.fund, fundName)
  assert.equal(item.investment.amount, 2500)
  assert.ok(list.funds.includes(fundName))
})
