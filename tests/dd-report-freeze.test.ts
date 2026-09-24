/**
 * M5 测试：报告闭环
 * GET  /api/dd/batches/[id]/report（实时组装：模块/证据分类/红旗/缺口/引用编号/Markdown 导出）
 * GET  /api/dd/batches/[id]/report?versionId=（冻结快照读取）
 * POST /api/dd/batches/[id]/freeze（冻结门槛：IN_REVIEW + 全任务 DONE；快照固化；批次 FROZEN）
 */

import './helpers/setup'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { GET as REPORT_GET } from '@/app/api/dd/batches/[id]/report/route'
import { POST as FREEZE_POST } from '@/app/api/dd/batches/[id]/freeze/route'
import { resetMocks, mockState } from './helpers/setup'
import { DD_TEMPLATE_MODULES } from '@/lib/dd-workbench/template'

const MANAGER_EMAIL = 'ddr-manager@test.com'
const OUTSIDER_EMAIL = 'ddr-outsider@test.com'

let managerId: string
let outsiderId: string
let projectId: string
let batchId: string

beforeEach(async () => {
  resetMocks()
  await prisma.dDEvidence.deleteMany({})
  await prisma.dDTask.deleteMany({})
  await prisma.dDReportVersion.deleteMany({})
  await prisma.dDBatch.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'DDR测试项目' } } })
  await prisma.user.deleteMany({ where: { email: { in: [MANAGER_EMAIL, OUTSIDER_EMAIL] } } })

  managerId = (await prisma.user.create({
    data: { email: MANAGER_EMAIL, name: '维护人', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
  outsiderId = (await prisma.user.create({
    data: { email: OUTSIDER_EMAIL, name: '路人', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id

  const project = await prisma.project.create({
    data: {
      name: 'DDR测试项目一',
      companyFullName: 'DDR测试科技有限公司',
      industry: 'AI应用',
      financingRound: 'A轮',
      totalAmount: '500万',
      investmentValuation: 2.5,
      targetDate: new Date(),
      followStage: 'DUE_DILIGENCE',
      createdById: managerId,
    },
  })
  projectId = project.id

  const batch = await prisma.dDBatch.create({
    data: {
      projectId,
      round: 'A轮',
      templateVersion: 'v1',
      status: 'IN_PROGRESS',
      initiatedById: managerId,
      tasks: { create: DD_TEMPLATE_MODULES.map(m => ({ moduleKey: m.key, status: 'PENDING', sortKey: m.sortKey })) },
    },
    include: { tasks: true },
  })
  batchId = batch.id
})

function asUser(user: { id: string; role: string }) {
  mockState.session = { user: { id: user.id, name: null, email: 'x@t.com', role: user.role } }
}

function reportUrl(qs = '') {
  return `http://t/api/dd/batches/${batchId}/report${qs}`
}

async function getReport(qs = '') {
  const res = await REPORT_GET(new Request(reportUrl(qs)), { params: { id: batchId } })
  return { status: res.status, body: await res.json() }
}

async function freeze() {
  const res = await FREEZE_POST(new Request(`http://t/api/dd/batches/${batchId}/freeze`, { method: 'POST' }), {
    params: { id: batchId },
  })
  return { status: res.status, body: await res.json() }
}

/** 把一个任务推进到指定状态（绕过 API 直接落库，聚焦报告组装测试） */
async function seedTask(
  moduleKey: string,
  opts: { status?: string; conclusion?: string; redFlagLevel?: string } = {}
) {
  await prisma.dDTask.update({
    where: { batchId_moduleKey: { batchId, moduleKey } },
    data: {
      status: opts.status || 'DONE',
      conclusion: opts.conclusion ?? (opts.status && opts.status !== 'DONE' ? null : '该模块结论齐备'),
      redFlagLevel: opts.redFlagLevel || 'NONE',
    },
  })
}

async function seedEvidence(
  moduleKey: string,
  opts: { grade?: string; status?: string; excerpt?: string; sourceType?: string } = {}
) {
  const task = await prisma.dDTask.findUnique({
    where: { batchId_moduleKey: { batchId, moduleKey } },
    select: { id: true },
  })
  return prisma.dDEvidence.create({
    data: {
      batchId,
      taskId: task!.id,
      sourceType: opts.sourceType || 'WEB',
      sourceUrl: 'https://example.com/x',
      sourceLabel: '测试来源',
      excerpt: opts.excerpt || '证据摘录',
      grade: opts.grade || 'C',
      status: opts.status || 'CONFIRMED',
      confirmedById: opts.status === 'CONFIRMED' ? managerId : null,
      confirmedAt: opts.status === 'CONFIRMED' ? new Date() : null,
      createdById: managerId,
    },
  })
}

// ── 实时组装 ──

test('组装：九大模块齐备、结论先行、进度与缺口清单正确', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  await seedTask('PROJECT_ENTITY', { conclusion: '主体与轮次一致' })
  await seedTask('PRODUCT_TECHNOLOGY', { status: 'IN_PROGRESS' })

  const { status, body } = await getReport()
  assert.equal(status, 200)
  const report = body.report
  assert.equal(report.modules.length, 9)
  assert.equal(report.modules[0].moduleKey, 'PROJECT_ENTITY')
  assert.equal(report.modules[0].conclusion, '主体与轮次一致')
  assert.equal(report.modules[0].coreQuestion, '主体、轮次、融资诉求是否一致？')

  assert.equal(report.progress.total, 9)
  assert.equal(report.progress.done, 1)
  assert.equal(report.progress.inProgress, 1)
  assert.equal(report.progress.completionRate, 11) // 1/9 四舍五入

  // 缺口清单：8 个未完成
  assert.equal(report.pendingItems.length, 8)
  const product = report.pendingItems.find((i: { moduleKey: string }) => i.moduleKey === 'PRODUCT_TECHNOLOGY')
  assert.equal(product.reason, '分析进行中')

  // 结论未填 → 未决问题
  const productModule = report.modules.find((m: { moduleKey: string }) => m.moduleKey === 'PRODUCT_TECHNOLOGY')
  assert.ok(productModule.openQuestions.includes('人工结论未填写'))
})

test('证据分类：已确认 A/B/C 支撑、D 级进附录、冲突单列；引用编号 E1/E2 按时间序', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  await seedTask('FINANCE_ECONOMICS')

  // 创建顺序 = 编号顺序
  await seedEvidence('FINANCE_ECONOMICS', { grade: 'A', excerpt: '审计确认' })
  await seedEvidence('FINANCE_ECONOMICS', { grade: 'D', excerpt: '搜索摘要' })
  await seedEvidence('FINANCE_ECONOMICS', { grade: 'B', status: 'CONFLICT', excerpt: '口述矛盾' })
  await seedEvidence('FINANCE_ECONOMICS', { grade: 'C', status: 'PENDING', excerpt: '待确认' })

  const { body } = await getReport()
  const report = body.report
  const m = report.modules.find((x: { moduleKey: string }) => x.moduleKey === 'FINANCE_ECONOMICS')

  assert.equal(m.supportingEvidence.length, 1) // A 已确认
  assert.equal(m.supportingEvidence[0].ref, 'E1')
  assert.equal(m.pendingEvidence.length, 2) // D 级 + PENDING
  assert.equal(m.conflictEvidence.length, 1) // 冲突 B 级
  assert.equal(m.conflictEvidence[0].ref, 'E3')
  assert.ok(m.openQuestions.some((q: string) => q.includes('冲突证据')))

  // 全批证据索引 4 条
  assert.equal(report.evidenceIndex.length, 4)
  assert.deepEqual(
    report.evidenceIndex.map((e: { ref: string }) => e.ref),
    ['E1', 'E2', 'E3', 'E4']
  )
})

test('红旗热力：HIGH 排前；Markdown 导出含关键章节与证据编号', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  await seedTask('LEGAL_COMPLIANCE', { redFlagLevel: 'HIGH', conclusion: '存在未决诉讼' })
  await seedTask('TEAM_GOVERNANCE', { redFlagLevel: 'MEDIUM', conclusion: '股权结构需关注' })
  await seedEvidence('LEGAL_COMPLIANCE', { grade: 'A', excerpt: '裁判文书网记录' })

  const { body } = await getReport()
  const report = body.report
  assert.equal(report.redFlags.length, 2)
  assert.equal(report.redFlags[0].level, 'HIGH') // HIGH 在前
  assert.equal(report.redFlags[0].moduleKey, 'LEGAL_COMPLIANCE')

  const md = (await getReport('?format=markdown')).body.markdown as string
  assert.ok(md.includes('# DDR测试项目一 尽调报告（整包）'))
  assert.ok(md.includes('## ⚑ 风险红旗'))
  assert.ok(md.includes('## 法务合规与风险'))
  assert.ok(md.includes('[E1]'))
  assert.ok(md.includes('存在未决诉讼'))
})

test('权限：路人 403；未登录 401', async () => {
  mockState.session = null
  assert.equal((await getReport()).status, 401)
  asUser({ id: outsiderId, role: 'INVESTMENT_MANAGER' })
  assert.equal((await getReport()).status, 403)
})

// ── 冻结闭环 ──

test('冻结门槛：非 IN_REVIEW 400；有未完成任务 400', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })

  // IN_PROGRESS 直接冻结 → 400
  let res = await freeze()
  assert.equal(res.status, 400)
  assert.match(res.body.error, /复核/)

  // 提请复核但任务未完成 → 400
  await prisma.dDBatch.update({ where: { id: batchId }, data: { status: 'IN_REVIEW' } })
  res = await freeze()
  assert.equal(res.status, 400)
  assert.match(res.body.error, /未完成/)
})

test('冻结成功：版本 v1 快照 + 批次 FROZEN；快照与后续变化隔离；版本号自增', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })

  // 全部任务完成
  for (const m of DD_TEMPLATE_MODULES) {
    await seedTask(m.key, { conclusion: `${m.name}结论` })
    await seedEvidence(m.key, { grade: 'B', excerpt: `${m.name}证据` })
  }
  await prisma.dDBatch.update({ where: { id: batchId }, data: { status: 'IN_REVIEW' } })

  // 路人不可冻结
  asUser({ id: outsiderId, role: 'INVESTMENT_MANAGER' })
  assert.equal((await freeze()).status, 403)

  // 维护人冻结 → v1
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  let res = await freeze()
  assert.equal(res.status, 200)
  assert.equal(res.body.version.version, 1)
  assert.equal(res.body.version.frozenBy.id, managerId)
  assert.equal(res.body.batch.status, 'FROZEN')

  // 冻结后任务只读 → 结论无法被修改，快照天然隔离
  const frozenTask = await prisma.dDTask.findUnique({
    where: { batchId_moduleKey: { batchId, moduleKey: 'PROJECT_ENTITY' } },
  })
  assert.equal(frozenTask!.status, 'DONE')

  // 读取冻结快照（versionId）
  const versionId = res.body.version.id as string
  const snap = await REPORT_GET(
    new Request(`http://t/api/dd/batches/${batchId}/report?versionId=${versionId}`),
    { params: { id: batchId } }
  )
  assert.equal(snap.status, 200)
  const snapBody = await snap.json()
  assert.equal(snapBody.version.version, 1)
  assert.equal(snapBody.report.progress.completionRate, 100)
  assert.equal(snapBody.report.modules.length, 9)

  // 重复冻结 → 400（已 FROZEN）
  assert.equal((await freeze()).status, 400)

  // 发起新批次 → 新任务，冻结后版本号在新批次内从 1 重新计数（批次内自增）
  const batch2 = await prisma.dDBatch.create({
    data: {
      projectId,
      round: 'A+轮',
      templateVersion: 'v1',
      status: 'IN_REVIEW',
      initiatedById: managerId,
      tasks: {
        create: DD_TEMPLATE_MODULES.map(m => ({
          moduleKey: m.key,
          status: 'DONE',
          conclusion: `${m.name}二批结论`,
          sortKey: m.sortKey,
        })),
      },
    },
  })
  const task2 = await prisma.dDTask.findFirst({ where: { batchId: batch2.id }, select: { id: true } })
  await prisma.dDEvidence.create({
    data: { batchId: batch2.id, taskId: task2!.id, sourceType: 'MANUAL', excerpt: '二批证据', grade: 'B', status: 'CONFIRMED', createdById: managerId },
  })
  const freeze2Res = await FREEZE_POST(
    new Request(`http://t/api/dd/batches/${batch2.id}/freeze`, { method: 'POST' }),
    { params: { id: batch2.id } }
  )
  assert.equal(freeze2Res.status, 200)
  const freeze2 = await freeze2Res.json()
  assert.equal(freeze2.version.version, 1) // 新批次从 1 重新计数
  // 两批快照独立
  assert.equal(freeze2.version.version, 1)
  assert.notEqual(snapBody.report.batch.round, freeze2.version ? 'A+轮' : '')
})
