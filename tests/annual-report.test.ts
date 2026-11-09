/**
 * 年度报告：时间窗口 / 聚合口径 / 行业归一化 / 权限 纯函数测试
 *
 * 覆盖：
 * - 上海时区年度与生成窗口边界（含 3/1 关闭、闰年 2/29、强制年份）
 * - 初聊、阶段进入、月度分布、月末存量、同比、行业别名合并
 * - 公司版/个人版查看与生成权限
 * - 报告摘要 JSON 解析容错
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  yearRange,
  shanghaiParts,
  generationWindow,
  resolveReportYear,
  formatShanghaiDate,
} from '@/lib/annual-report/time-window'
import { normalizeIndustry, UNCLASSIFIED_INDUSTRY } from '@/lib/annual-report/industry-alias'
import { computeCore, buildAnnualMetrics, type ProjectInput } from '@/lib/annual-report/metrics'
import {
  canGenerateReport,
  canViewCompanyReport,
  canViewPersonalReport,
  canViewReport,
} from '@/lib/annual-report/permissions'
import { toReportSummary } from '@/lib/annual-report/serialize'
import type { AnnualReport } from '@prisma/client'

let seq = 0

function makeProject(overrides: Partial<ProjectInput> = {}): ProjectInput {
  seq += 1
  return {
    id: `p${seq}`,
    name: `项目${seq}`,
    companyFullName: null,
    industry: 'AI',
    followStage: 'INITIAL_TALK',
    passedStages: null,
    targetDate: new Date('2025-03-15T02:00:00Z'),
    createdAt: new Date('2025-03-15T02:00:00Z'),
    stageChangedAt: null,
    totalAmount: '1000万',
    investmentValuation: null,
    financingRound: null,
    companyPosition: null,
    description: null,
    createdById: 'u1',
    createdByName: '张三',
    createdByAvatar: null,
    memberIds: [],
    events: [],
    counts: { documents: 0, notes: 0, reviews: 0 },
    ...overrides,
  }
}

test('年度区间按 Asia/Shanghai 解释', () => {
  const range = yearRange(2025)
  assert.equal(range.start.toISOString(), '2024-12-31T16:00:00.000Z')
  assert.equal(range.end.toISOString(), '2025-12-31T16:00:00.000Z')

  // UTC 2024-12-31 15:59:59 仍是上海 2024 年；16:00 起进入 2025 年
  assert.deepEqual(shanghaiParts(new Date('2024-12-31T15:59:59.999Z')), { year: 2024, month: 12, day: 31 })
  assert.deepEqual(shanghaiParts(new Date('2024-12-31T16:00:00.000Z')), { year: 2025, month: 1, day: 1 })
  assert.equal(formatShanghaiDate(new Date('2025-02-28T16:30:00.000Z')), '2025-03-01')
})

test('生成窗口：1/1 开放、2/29 仍可生成、3/1 00:00 关闭', () => {
  const before = generationWindow(2025, new Date('2025-12-31T15:59:59.999Z'))
  assert.equal(before.state, 'BEFORE_WINDOW')
  assert.equal(before.canGenerate, false)

  const opening = generationWindow(2025, new Date('2025-12-31T16:00:00.000Z'))
  assert.equal(opening.state, 'OPEN')
  assert.equal(opening.canGenerate, true)

  const lastMoment = generationWindow(2025, new Date('2026-02-28T15:59:59.999Z'))
  assert.equal(lastMoment.state, 'OPEN')

  const closed = generationWindow(2025, new Date('2026-02-28T16:00:00.000Z'))
  assert.equal(closed.state, 'CLOSED')
  assert.equal(closed.canGenerate, false)

  // 2027 年报窗口跨闰年：2028-02-29 23:00（上海）仍开放
  const leap = generationWindow(2027, new Date('2028-02-29T15:00:00.000Z'))
  assert.equal(leap.state, 'OPEN')
  const leapClosed = generationWindow(2027, new Date('2028-02-29T16:00:00.000Z'))
  assert.equal(leapClosed.state, 'CLOSED')
})

test('ANNUAL_REPORT_FORCE_YEAR 强制开放窗口', () => {
  const previous = process.env.ANNUAL_REPORT_FORCE_YEAR
  process.env.ANNUAL_REPORT_FORCE_YEAR = '2025'
  try {
    const window = generationWindow(2025, new Date('2026-06-01T00:00:00Z'))
    assert.equal(window.state, 'OPEN')
    assert.equal(window.forced, true)
    assert.equal(resolveReportYear(new Date('2026-06-01T00:00:00Z')), 2025)
  } finally {
    if (previous === undefined) delete process.env.ANNUAL_REPORT_FORCE_YEAR
    else process.env.ANNUAL_REPORT_FORCE_YEAR = previous
  }
})

test('默认目标年份为上海时区的上一年', () => {
  const previous = process.env.ANNUAL_REPORT_FORCE_YEAR
  delete process.env.ANNUAL_REPORT_FORCE_YEAR
  try {
    assert.equal(resolveReportYear(new Date('2026-01-01T00:30:00Z')), 2025)
    assert.equal(resolveReportYear(new Date('2025-12-31T15:59:00Z')), 2024)
  } finally {
    if (previous !== undefined) process.env.ANNUAL_REPORT_FORCE_YEAR = previous
  }
})

test('行业别名归一化', () => {
  assert.equal(normalizeIndustry(' AI '), 'AI应用')
  assert.equal(normalizeIndustry('人工智能'), 'AI应用')
  assert.equal(normalizeIndustry('机器人'), '具身智能')
  assert.equal(normalizeIndustry('芯片'), '半导体芯片')
  assert.equal(normalizeIndustry(''), UNCLASSIFIED_INDUSTRY)
  assert.equal(normalizeIndustry('—'), UNCLASSIFIED_INDUSTRY)
  assert.equal(normalizeIndustry('Web3'), 'Web3')
})

test('核对：初聊 / 阶段进入 / 月度分布 / 年末存量', () => {
  const active = makeProject({
    industry: '人工智能',
    followStage: 'DUE_DILIGENCE',
    targetDate: new Date('2025-02-10T02:00:00Z'),
    createdAt: new Date('2025-02-10T02:00:00Z'),
    passedStages: JSON.stringify(['INITIAL_TALK', 'PRE_DD', 'DUE_DILIGENCE']),
    events: [
      { toStage: 'INITIAL_TALK', occurredAt: new Date('2025-02-10T02:00:00Z') },
      { toStage: 'PRE_DD', occurredAt: new Date('2025-03-01T02:00:00Z') },
      { toStage: 'DUE_DILIGENCE', occurredAt: new Date('2025-06-15T02:00:00Z') },
    ],
  })
  const historicalNoDates = makeProject({
    industry: '芯片',
    followStage: 'PRE_DD',
    targetDate: new Date('2023-05-10T02:00:00Z'),
    createdAt: new Date('2023-05-10T02:00:00Z'),
    passedStages: JSON.stringify(['INITIAL_TALK', 'PRE_DD']),
  })
  const postInvested = makeProject({
    industry: 'SaaS',
    followStage: 'POST_INVESTMENT',
    targetDate: new Date('2024-04-10T02:00:00Z'),
    createdAt: new Date('2024-04-10T02:00:00Z'),
    passedStages: JSON.stringify(['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'AGREEMENT', 'CLOSING']),
    events: [
      { toStage: 'CLOSING', occurredAt: new Date('2024-08-10T02:00:00Z') },
      { toStage: 'POST_INVESTMENT', occurredAt: new Date('2024-09-10T02:00:00Z') },
    ],
  })
  const rejected = makeProject({
    industry: '机器人',
    followStage: 'REJECTED',
    targetDate: new Date('2025-04-10T02:00:00Z'),
    createdAt: new Date('2025-04-10T02:00:00Z'),
    events: [{ toStage: 'REJECTED', occurredAt: new Date('2025-04-20T02:00:00Z') }],
  })

  const core = computeCore([active, historicalNoDates, postInvested, rejected], 2025)

  assert.equal(core.newProjects, 2)
  assert.equal(core.entered.INITIAL_TALK, 2)
  assert.equal(core.entered.PRE_DD, 1)
  assert.equal(core.entered.DUE_DILIGENCE, 1)
  // 历史项目的 PreDD 无日期：只进存量，不伪造月度与进入数
  assert.equal(core.entered.PRE_DD, 1)

  assert.equal(core.monthly[1].newProjects, 1) // 2 月初聊
  assert.equal(core.monthly[2].newProjects, 0)
  assert.equal(core.monthly[2].entries.PRE_DD, 1) // 3 月进入 PreDD
  assert.equal(core.monthly[5].entries.DUE_DILIGENCE, 1) // 6 月进入尽调
  assert.equal(core.monthly[3].newProjects, 1) // 4 月新初聊

  // 月度行业按「当月有初聊/阶段进展」的项目去重
  assert.equal(core.monthlyIndustries.get(2)?.get('AI应用'), 1)
  assert.equal(core.monthlyIndustries.get(3)?.get('AI应用'), 1)
  assert.equal(core.monthlyIndustries.get(6)?.get('AI应用'), 1)
  assert.equal(core.monthlyIndustries.get(4)?.get('具身智能'), 1)

  // 年末存量：历史 PreDD、当前尽调、投后计入交割
  assert.equal(core.stock.PRE_DD, 1)
  assert.equal(core.stock.DUE_DILIGENCE, 1)
  assert.equal(core.stock.CLOSING, 1)
  assert.equal(core.postInvest, 1)
  assert.equal(core.rejected, 1)

  assert.equal(core.industryCounts.get('AI应用'), 1)
  assert.equal(core.industryCounts.get('具身智能'), 1)
})

test('历史项目只有本年度新建时才推断阶段进入', () => {
  const old = makeProject({
    followStage: 'DUE_DILIGENCE',
    targetDate: new Date('2023-05-10T02:00:00Z'),
    createdAt: new Date('2023-05-10T02:00:00Z'),
    passedStages: JSON.stringify(['INITIAL_TALK', 'PRE_DD', 'DUE_DILIGENCE']),
  })
  const core = computeCore([old], 2025)
  assert.equal(core.newProjects, 0)
  assert.equal(core.entered.INITIAL_TALK, 0)
  assert.equal(core.entered.PRE_DD, 0)
  assert.equal(core.entered.DUE_DILIGENCE, 0)
  assert.equal(core.cohortIds.size, 0)
  assert.equal(core.stock.DUE_DILIGENCE, 1)
})

test('同比与行业新增标记', () => {
  const lastYear = makeProject({
    industry: 'AI',
    targetDate: new Date('2024-05-10T02:00:00Z'),
    createdAt: new Date('2024-05-10T02:00:00Z'),
  })
  const thisYear = makeProject({
    industry: 'AI',
    targetDate: new Date('2025-05-10T02:00:00Z'),
    createdAt: new Date('2025-05-10T02:00:00Z'),
  })
  const newSector = makeProject({
    industry: '机器人',
    targetDate: new Date('2025-07-10T02:00:00Z'),
    createdAt: new Date('2025-07-10T02:00:00Z'),
  })

  const result = buildAnnualMetrics([lastYear, thisYear, newSector], 2025, 'COMPANY')
  const kpi = result.kpis.find(item => item.key === 'newProjects')
  assert.equal(kpi?.value, 2)
  assert.equal(kpi?.yoy, 100) // 去年 1 → 今年 2
  assert.equal(result.comparison.year, 2024)
  assert.equal(result.comparison.newProjects, 1)

  const ai = result.industries.find(item => item.name === 'AI应用')
  const robot = result.industries.find(item => item.name === '具身智能')
  assert.equal(ai?.isNew, false)
  assert.equal(robot?.isNew, true)

  // 漏斗承接率：初聊 2 → PreDD 0（本项目仅初聊）
  const preDd = result.funnel.find(item => item.stage === 'PRE_DD')
  assert.equal(preDd?.entered, 0)
  assert.equal(preDd?.conversion, 0)
})

test('年报权限：生成与查看', () => {
  assert.equal(canGenerateReport('PERSONAL', 'INVESTMENT_MANAGER'), true)
  assert.equal(canGenerateReport('COMPANY', 'INVESTMENT_MANAGER'), false)
  assert.equal(canGenerateReport('COMPANY', 'INVESTMENT_PARTNER'), true)
  assert.equal(canGenerateReport('COMPANY', 'ADMIN'), true)
  assert.equal(canGenerateReport('PERSONAL', 'TEMP_VISITOR'), false)
  assert.equal(canGenerateReport('COMPANY', 'TEMP_VISITOR'), false)

  assert.equal(canViewCompanyReport('INVESTMENT_MANAGER'), true)
  assert.equal(canViewCompanyReport('TEMP_VISITOR'), false)

  assert.equal(canViewPersonalReport('INVESTMENT_MANAGER', 'u1', 'u1'), true)
  assert.equal(canViewPersonalReport('INVESTMENT_MANAGER', 'u2', 'u1'), false)
  assert.equal(canViewPersonalReport('ADMIN', 'u2', 'u1'), true)
  assert.equal(canViewPersonalReport('INVESTMENT_PARTNER', 'u2', 'u1'), true)

  assert.equal(canViewReport({ type: 'COMPANY', ownerId: null }, 'INVESTMENT_MANAGER', 'u1'), true)
  assert.equal(canViewReport({ type: 'COMPANY', ownerId: null }, 'TEMP_VISITOR', 'u1'), false)
  assert.equal(canViewReport({ type: 'PERSONAL', ownerId: 'u2' }, 'INVESTMENT_MANAGER', 'u1'), false)
})

test('报告摘要：summaryJson 解析容错', () => {
  const base = {
    id: 'r1',
    year: 2025,
    type: 'COMPANY',
    ownerKey: '__company__',
    ownerId: null,
    status: 'READY',
    phase: null,
    progress: 100,
    version: 1,
    templateVersion: 'v1',
    dataJson: null,
    summaryJson: JSON.stringify({ theme: '硬科技主线', overview: '全年聚焦 AI 与机器人', keywords: ['AI', '机器人'] }),
    pageCount: 10,
    generatedById: 'u1',
    generatedAt: new Date('2026-01-10T00:00:00Z'),
    startedAt: null,
    finishedAt: null,
    error: null,
    createdAt: new Date('2026-01-10T00:00:00Z'),
    updatedAt: new Date('2026-01-10T00:00:00Z'),
  } as AnnualReport

  const summary = toReportSummary(base)
  assert.equal(summary.theme, '硬科技主线')
  assert.equal(summary.overview, '全年聚焦 AI 与机器人')
  assert.deepEqual(summary.keywords, ['AI', '机器人'])

  const broken = toReportSummary({ ...base, summaryJson: '{not-json' })
  assert.equal(broken.theme, undefined)
  assert.equal(broken.pageCount, 10)
})
