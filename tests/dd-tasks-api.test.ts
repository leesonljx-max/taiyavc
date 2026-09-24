/**
 * M3 测试：模块任务 API
 * PATCH /api/dd/tasks/[id]
 * 覆盖：字段更新（结论/AI草稿/红旗/负责人）、状态机流转、
 *       DONE 证据链校验（结论非空 + ≥1 条已确认 A/B/C 证据）、冻结批次只读、权限
 */

import './helpers/setup'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { PATCH } from '@/app/api/dd/tasks/[id]/route'
import { resetMocks, mockState } from './helpers/setup'

const MANAGER_EMAIL = 'ddt-manager@test.com'
const PARTNER_EMAIL = 'ddt-partner@test.com'
const OUTSIDER_EMAIL = 'ddt-outsider@test.com'
const FINANCE_EMAIL = 'ddt-finance@test.com'

let managerId: string
let partnerId: string
let outsiderId: string
let financeId: string
let projectId: string
let batchId: string
let taskId: string

beforeEach(async () => {
  resetMocks()
  await prisma.dDEvidence.deleteMany({})
  await prisma.dDTask.deleteMany({})
  await prisma.dDReportVersion.deleteMany({})
  await prisma.dDBatch.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'DDT测试项目' } } })
  await prisma.user.deleteMany({
    where: { email: { in: [MANAGER_EMAIL, PARTNER_EMAIL, OUTSIDER_EMAIL, FINANCE_EMAIL] } },
  })

  const mk = (email: string, role: string, name: string) =>
    prisma.user.create({ data: { email, name, passwordHash: 'x', role, status: 'ACTIVE' } })
  managerId = (await mk(MANAGER_EMAIL, 'INVESTMENT_MANAGER', '维护经理')).id
  partnerId = (await mk(PARTNER_EMAIL, 'INVESTMENT_PARTNER', '合伙人')).id
  outsiderId = (await mk(OUTSIDER_EMAIL, 'INVESTMENT_MANAGER', '路人')).id
  financeId = (await mk(FINANCE_EMAIL, 'INVESTMENT_MANAGER', '财务专家')).id

  const project = await prisma.project.create({
    data: {
      name: 'DDT测试项目',
      totalAmount: '500万',
      targetDate: new Date(),
      followStage: 'DUE_DILIGENCE',
      createdById: managerId,
    },
  })
  projectId = project.id

  const batch = await prisma.dDBatch.create({
    data: {
      projectId,
      templateVersion: 'v1',
      status: 'IN_PROGRESS',
      initiatedById: managerId,
      tasks: { create: [{ moduleKey: 'FINANCE_ECONOMICS', status: 'PENDING', sortKey: 7 }] },
    },
    include: { tasks: true },
  })
  batchId = batch.id
  taskId = batch.tasks[0].id
})

function asUser(user: { id: string; role: string }) {
  mockState.session = { user: { id: user.id, name: null, email: 'x@t.com', role: user.role } }
}

async function patchTask(data: Record<string, unknown>, id = taskId) {
  const res = await PATCH(
    new Request(`http://t/api/dd/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: { id } }
  )
  return { status: res.status, body: await res.json() }
}

async function addEvidence(overrides: Record<string, unknown> = {}) {
  return prisma.dDEvidence.create({
    data: {
      batchId,
      taskId,
      sourceType: 'MANUAL',
      excerpt: '创始人访谈：预计 Q4 现金流转正',
      grade: 'B',
      createdById: managerId,
      ...overrides,
    },
  })
}

// ── 字段更新 ──

test('PATCH：更新结论/AI草稿/红旗/负责人（清空与指派）', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })

  let res = await patchTask({ conclusion: '收入增长与现金消耗基本自洽', aiDraft: 'AI 初步分析……' })
  assert.equal(res.status, 200)
  assert.equal(res.body.task.conclusion, '收入增长与现金消耗基本自洽')
  assert.equal(res.body.task.aiDraft, 'AI 初步分析……')

  res = await patchTask({ redFlagLevel: 'HIGH' })
  assert.equal(res.body.task.redFlagLevel, 'HIGH')
  assert.equal((await patchTask({ redFlagLevel: 'BAD' })).status, 400)

  res = await patchTask({ ownerId: financeId })
  assert.equal(res.body.task.owner.id, financeId)
  assert.equal(res.body.task.owner.name, '财务专家')
  // 清空负责人
  res = await patchTask({ ownerId: null })
  assert.equal(res.body.task.ownerId, null)
  // 不存在的负责人
  assert.equal((await patchTask({ ownerId: 'nonexistent' })).status, 400)
})

// ── 状态机 ──

test('状态机：PENDING→IN_PROGRESS→IN_REVIEW→DONE 合法；PENDING→DONE 非法；DONE 重开回 IN_PROGRESS', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })

  // 先补齐 DONE 条件（结论 + 确认证据）
  await patchTask({ conclusion: '结论齐备' })
  const ev = await addEvidence()
  await prisma.dDEvidence.update({
    where: { id: ev.id },
    data: { status: 'CONFIRMED', confirmedById: managerId, confirmedAt: new Date() },
  })

  assert.equal((await patchTask({ status: 'IN_PROGRESS' })).status, 200)
  assert.equal((await patchTask({ status: 'IN_REVIEW' })).status, 200)
  assert.equal((await patchTask({ status: 'DONE' })).status, 200)

  // 重开：DONE → IN_PROGRESS 合法
  assert.equal((await patchTask({ status: 'IN_PROGRESS' })).status, 200)

  // 重新走到 IN_PROGRESS 后，PENDING 直接 DONE 非法（重新置 PENDING 再试）
  await prisma.dDTask.update({ where: { id: taskId }, data: { status: 'PENDING' } })
  const jump = await patchTask({ status: 'DONE' })
  assert.equal(jump.status, 400)
  assert.match(jump.body.error, /不允许/)
})

test('BLOCKED 可从分析中进入并回退；非法状态值 400', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  assert.equal((await patchTask({ status: 'IN_PROGRESS' })).status, 200)
  assert.equal((await patchTask({ status: 'BLOCKED' })).status, 200)
  assert.equal((await patchTask({ status: 'IN_PROGRESS' })).status, 200)
  assert.equal((await patchTask({ status: 'CANCELLED' })).status, 400)
})

// ── DONE 证据链校验 ──

test('DONE 校验：无结论 400', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  await patchTask({ status: 'IN_PROGRESS' })
  const ev = await addEvidence()
  await prisma.dDEvidence.update({
    where: { id: ev.id },
    data: { status: 'CONFIRMED', confirmedById: managerId, confirmedAt: new Date() },
  })
  const noConclusion = await patchTask({ status: 'DONE' })
  assert.equal(noConclusion.status, 400)
  assert.match(noConclusion.body.error, /人工结论/)
})

test('DONE 校验：无证据 / 仅待确认证据 / 仅 D 级证据 均 400；确认的 B 级证据可完成', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  await patchTask({ conclusion: '有结论', status: 'IN_PROGRESS' })

  // 无证据
  let res = await patchTask({ status: 'DONE' })
  assert.equal(res.status, 400)
  assert.match(res.body.error, /证据/)

  // 仅待确认（PENDING）证据
  await addEvidence()
  res = await patchTask({ status: 'DONE' })
  assert.equal(res.status, 400)

  // 仅 D 级已确认证据
  const dEv = await addEvidence({ grade: 'D', excerpt: '搜索摘要待核验' })
  await prisma.dDEvidence.update({
    where: { id: dEv.id },
    data: { status: 'CONFIRMED', confirmedById: managerId, confirmedAt: new Date() },
  })
  res = await patchTask({ status: 'DONE' })
  assert.equal(res.status, 400)

  // 补一条已确认 B 级证据 → 完成
  const bEv = await addEvidence({ excerpt: '审计报告摘录：营收 2000 万' })
  await prisma.dDEvidence.update({
    where: { id: bEv.id },
    data: { status: 'CONFIRMED', confirmedById: managerId, confirmedAt: new Date() },
  })
  res = await patchTask({ status: 'DONE' })
  assert.equal(res.status, 200)
  assert.equal(res.body.task.status, 'DONE')
})

// ── 冻结批次与权限 ──

test('冻结批次后任务只读 400；404；路人 403；合伙人可编辑', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  await patchTask({ conclusion: 'x' })

  // 路人无权
  asUser({ id: outsiderId, role: 'INVESTMENT_MANAGER' })
  assert.equal((await patchTask({ redFlagLevel: 'MEDIUM' })).status, 403)

  // 合伙人有权
  asUser({ id: partnerId, role: 'INVESTMENT_PARTNER' })
  assert.equal((await patchTask({ redFlagLevel: 'MEDIUM' })).status, 200)

  // 不存在
  assert.equal((await patchTask({ conclusion: 'y' }, 'nonexistent')).status, 404)

  // 冻结批次 → 只读
  await prisma.dDBatch.update({ where: { id: batchId }, data: { status: 'FROZEN' } })
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  const frozen = await patchTask({ conclusion: '冻结后修改' })
  assert.equal(frozen.status, 400)
  assert.match(frozen.body.error, /冻结/)
})
