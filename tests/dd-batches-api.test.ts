/**
 * M2 测试：尽调批次 API
 * POST /api/dd/batches（发起批次：自动生成九大任务 + 权限 + 单活跃批次）
 * GET  /api/dd/batches?projectId=（列表 + 进度/红旗/证据/冻结报告统计）
 * GET/PATCH /api/dd/batches/[id]（详情 / 状态流转与字段更新）
 */

import './helpers/setup'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { GET as LIST_GET, POST as BATCH_POST } from '@/app/api/dd/batches/route'
import { GET as DETAIL_GET, PATCH as BATCH_PATCH } from '@/app/api/dd/batches/[id]/route'
import { DD_TEMPLATE_MODULES } from '@/lib/dd-workbench/template'
import { resetMocks, mockState } from './helpers/setup'

const ADMIN_EMAIL = 'dd-admin@test.com'
const MANAGER_EMAIL = 'dd-manager@test.com'
const PARTNER_EMAIL = 'dd-partner@test.com'
const OUTSIDER_EMAIL = 'dd-outsider@test.com'

let adminId: string
let managerId: string
let partnerId: string
let outsiderId: string
let projectId: string

beforeEach(async () => {
  resetMocks()
  // 清理测试数据（按依赖顺序）
  await prisma.dDEvidence.deleteMany({})
  await prisma.dDTask.deleteMany({})
  await prisma.dDReportVersion.deleteMany({})
  await prisma.dDBatch.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'DD测试项目' } } })
  await prisma.user.deleteMany({
    where: { email: { in: [ADMIN_EMAIL, MANAGER_EMAIL, PARTNER_EMAIL, OUTSIDER_EMAIL] } },
  })

  const mk = (email: string, role: string, name: string) =>
    prisma.user.create({ data: { email, name, passwordHash: 'x', role, status: 'ACTIVE' } })
  adminId = (await mk(ADMIN_EMAIL, 'ADMIN', '管理员')).id
  managerId = (await mk(MANAGER_EMAIL, 'INVESTMENT_MANAGER', '投资经理')).id
  partnerId = (await mk(PARTNER_EMAIL, 'INVESTMENT_PARTNER', '合伙人')).id
  outsiderId = (await mk(OUTSIDER_EMAIL, 'INVESTMENT_MANAGER', '路人经理')).id

  const project = await prisma.project.create({
    data: {
      name: 'DD测试项目一',
      totalAmount: '500万',
      targetDate: new Date(),
      followStage: 'DUE_DILIGENCE',
      createdById: managerId,
    },
  })
  projectId = project.id
})

function asUser(user: { id: string; role: string }) {
  mockState.session = {
    user: { id: user.id, name: null, email: 'x@t.com', role: user.role },
  }
}

function postUrl(): string {
  return 'http://t/api/dd/batches'
}
function listUrl(pid: string): string {
  return `http://t/api/dd/batches?projectId=${pid}`
}

async function createBatch(body: Record<string, unknown>) {
  const res = await BATCH_POST(
    new Request(postUrl(), { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
  )
  return { status: res.status, body: await res.json() }
}

// ── POST：发起批次 ──

test('POST：维护人发起批次 → 201，自动生成九大模块任务（模板顺序）', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  const { status, body } = await createBatch({ projectId, round: 'A轮' })
  assert.equal(status, 201)
  const batch = body.batch
  assert.equal(batch.status, 'IN_PROGRESS')
  assert.equal(batch.templateVersion, 'v1')
  assert.equal(batch.round, 'A轮')
  assert.equal(batch.initiatedBy.id, managerId)
  assert.equal(batch.tasks.length, 9)
  // 任务与模板一一对应，状态 PENDING、无红旗、按 sortKey 升序
  assert.deepEqual(
    batch.tasks.map((t: { moduleKey: string }) => t.moduleKey),
    DD_TEMPLATE_MODULES.map(m => m.key)
  )
  for (const t of batch.tasks) {
    assert.equal(t.status, 'PENDING')
    assert.equal(t.redFlagLevel, 'NONE')
    assert.ok(t.id)
  }
})

test('POST：截止日接受完整 ISO-8601；非法格式 400', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  const ok = await createBatch({ projectId, dueDate: '2026-10-01T00:00:00.000Z' })
  assert.equal(ok.status, 201)
  assert.equal(ok.body.batch.dueDate, '2026-10-01T00:00:00.000Z')

  // 项目已有一个活跃批次 → 需先冻结才能再建；换项目测非法日期
  const p2 = await prisma.project.create({
    data: { name: 'DD测试项目二', totalAmount: '300万', targetDate: new Date(), followStage: 'DUE_DILIGENCE', createdById: managerId },
  })
  const bad = await createBatch({ projectId: p2.id, dueDate: 'not-a-date' })
  assert.equal(bad.status, 400)
})

test('POST：未登录 401；缺 projectId 400；项目不存在 404', async () => {
  mockState.session = null
  const noAuth = await createBatch({ projectId })
  assert.equal(noAuth.status, 401)
  assert.equal(noAuth.body.error, '登录已过期，请退出后重新登录')

  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  const noId = await createBatch({})
  assert.equal(noId.status, 400)
  const notFound = await createBatch({ projectId: 'nonexistent' })
  assert.equal(notFound.status, 404)
})

test('POST：权限——ADMIN/合伙人可发起；非维护人 403', async () => {
  asUser({ id: adminId, role: 'ADMIN' })
  assert.equal((await createBatch({ projectId })).status, 201)

  // 已有活跃批次会挡住第二批：改用合伙人先测 403 场景之外的路人
  asUser({ id: outsiderId, role: 'INVESTMENT_MANAGER' })
  const forbidden = await createBatch({ projectId })
  assert.equal(forbidden.status, 403)

  // 合伙人在另一项目验证可发起
  const p2 = await prisma.project.create({
    data: { name: 'DD测试项目二', totalAmount: '300万', targetDate: new Date(), followStage: 'DUE_DILIGENCE', createdById: managerId },
  })
  asUser({ id: partnerId, role: 'INVESTMENT_PARTNER' })
  assert.equal((await createBatch({ projectId: p2.id })).status, 201)
})

test('POST：单活跃批次——已有进行中批次时再发起 400', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  assert.equal((await createBatch({ projectId })).status, 201)
  const dup = await createBatch({ projectId })
  assert.equal(dup.status, 400)
  assert.match(dup.body.error, /进行中的尽调批次/)
})

// ── GET：列表统计 ──

test('GET 列表：返回批次统计（任务状态分布/红旗/证据数）；非维护人无权 403', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  const created = await createBatch({ projectId, round: 'Pre-A' })
  const batchId = created.body.batch.id as string

  // 推进两个任务：一个 DONE，一个 IN_REVIEW + HIGH 红旗，一个 BLOCKED + MEDIUM 红旗
  const tasks = created.body.batch.tasks as Array<{ id: string; moduleKey: string }>
  await prisma.dDTask.update({ where: { id: tasks[0].id }, data: { status: 'DONE', conclusion: '主体与轮次一致' } })
  await prisma.dDTask.update({ where: { id: tasks[1].id }, data: { status: 'IN_REVIEW', redFlagLevel: 'HIGH' } })
  await prisma.dDTask.update({ where: { id: tasks[2].id }, data: { status: 'BLOCKED', redFlagLevel: 'MEDIUM' } })
  // 两条证据
  await prisma.dDEvidence.createMany({
    data: [
      { batchId, taskId: tasks[0].id, sourceType: 'MANUAL', excerpt: '创始人访谈要点', grade: 'B', createdById: managerId },
      { batchId, taskId: tasks[1].id, sourceType: 'WEB', sourceUrl: 'https://example.com', excerpt: '媒体报道', grade: 'C', createdById: managerId },
    ],
  })

  const res = await LIST_GET(new Request(listUrl(projectId)))
  assert.equal(res.status, 200)
  const { batches } = await res.json()
  assert.equal(batches.length, 1)
  const stats = batches[0].stats
  assert.equal(stats.total, 9)
  assert.equal(stats.done, 1)
  assert.equal(stats.inReview, 1)
  assert.equal(stats.blocked, 1)
  assert.equal(stats.pending, 6)
  assert.equal(stats.redFlagHigh, 1)
  assert.equal(stats.redFlagMedium, 1)
  assert.equal(stats.evidenceCount, 2)
  assert.equal(stats.frozenReportCount, 0)
  assert.equal(stats.latestFrozenReport, null)

  // 路人无权
  asUser({ id: outsiderId, role: 'INVESTMENT_MANAGER' })
  const forbidden = await LIST_GET(new Request(listUrl(projectId)))
  assert.equal(forbidden.status, 403)
  // 合伙人可见
  asUser({ id: partnerId, role: 'INVESTMENT_PARTNER' })
  assert.equal((await LIST_GET(new Request(listUrl(projectId)))).status, 200)
})

// ── GET/PATCH：详情与状态流转 ──

test('GET 详情：任务按模板排序并带负责人/证据状态计数；批次不存在 404', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  const created = await createBatch({ projectId })
  const batchId = created.body.batch.id as string
  const firstTaskId = created.body.batch.tasks[0].id as string

  // 三条证据：已确认 A / 冲突 B / 待确认 D —— 验证状态计数聚合
  await prisma.dDEvidence.createMany({
    data: [
      { batchId, taskId: firstTaskId, sourceType: 'MANUAL', excerpt: 'e1', grade: 'A', status: 'CONFIRMED', createdById: managerId },
      { batchId, taskId: firstTaskId, sourceType: 'WEB', sourceUrl: 'https://x.com', excerpt: 'e2', grade: 'B', status: 'CONFLICT', createdById: managerId },
      { batchId, taskId: firstTaskId, sourceType: 'WEB', sourceUrl: 'https://y.com', excerpt: 'e3', grade: 'D', status: 'PENDING', createdById: managerId },
    ],
  })

  const res = await DETAIL_GET(new Request(`http://t/api/dd/batches/${batchId}`), {
    params: { id: batchId },
  })
  assert.equal(res.status, 200)
  const { batch } = await res.json()
  assert.equal(batch.project.id, projectId)
  assert.equal(batch.tasks.length, 9)
  assert.equal(batch.tasks[0].moduleKey, 'PROJECT_ENTITY')
  assert.equal(batch.tasks[0].evidenceCount, 3)
  assert.equal(batch.tasks[0].confirmedEvidenceCount, 1)
  assert.equal(batch.tasks[0].conflictEvidenceCount, 1)
  assert.equal(batch.tasks[0].pendingEvidenceCount, 1)
  assert.equal(batch.reportVersions.length, 0)

  const notFound = await DETAIL_GET(new Request('http://t/api/dd/batches/nope'), {
    params: { id: 'nope' },
  })
  assert.equal(notFound.status, 404)
})

test('PATCH：IN_PROGRESS → IN_REVIEW → 打回 IN_PROGRESS；round/dueDate 可更新', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  const created = await createBatch({ projectId })
  const batchId = created.body.batch.id as string

  const patch = (data: Record<string, unknown>) =>
    BATCH_PATCH(new Request(`http://t/api/dd/batches/${batchId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    }), { params: { id: batchId } })

  // 状态流转
  let res = await patch({ status: 'IN_REVIEW' })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).batch.status, 'IN_REVIEW')

  res = await patch({ status: 'IN_PROGRESS' })
  assert.equal((await res.json()).batch.status, 'IN_PROGRESS')

  // 字段更新
  res = await patch({ round: 'A+轮', dueDate: '2026-12-01T00:00:00.000Z' })
  const body = await res.json()
  assert.equal(body.batch.round, 'A+轮')
  assert.equal(body.batch.dueDate, '2026-12-01T00:00:00.000Z')

  // 非法状态/直接冻结/空更新
  assert.equal((await patch({ status: 'FROZEN' })).status, 400)
  assert.equal((await patch({ status: 'BAD' })).status, 400)
  assert.equal((await patch({})).status, 400)

  // 路人不可改
  asUser({ id: outsiderId, role: 'INVESTMENT_MANAGER' })
  assert.equal((await patch({ round: 'X' })).status, 403)
})
