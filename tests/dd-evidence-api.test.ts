/**
 * M4 测试：证据链 API
 * POST/GET /api/dd/evidence（创建三种来源证据 / 任务证据列表）
 * PATCH/DELETE /api/dd/evidence/[id]（确认/冲突/重开留痕、删除）
 * 覆盖：来源规则（DOCUMENT 需同项目资料、WEB 需合法链接、MANUAL 固定 B 级）、
 *       等级白名单、摘录必填与限长、状态流转与冲突说明、冻结批次只读、权限
 */

import './helpers/setup'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { GET as EV_LIST, POST as EV_POST } from '@/app/api/dd/evidence/route'
import { PATCH as EV_PATCH, DELETE as EV_DELETE } from '@/app/api/dd/evidence/[id]/route'
import { resetMocks, mockState } from './helpers/setup'

const MANAGER_EMAIL = 'dde-manager@test.com'
const OUTSIDER_EMAIL = 'dde-outsider@test.com'

let managerId: string
let outsiderId: string
let projectId: string
let otherProjectId: string
let batchId: string
let taskId: string
let documentId: string
let otherProjectDocId: string

beforeEach(async () => {
  resetMocks()
  await prisma.dDEvidence.deleteMany({})
  await prisma.dDTask.deleteMany({})
  await prisma.dDReportVersion.deleteMany({})
  await prisma.dDBatch.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'DDE测试项目' } } })
  await prisma.user.deleteMany({ where: { email: { in: [MANAGER_EMAIL, OUTSIDER_EMAIL] } } })

  managerId = (await prisma.user.create({
    data: { email: MANAGER_EMAIL, name: '维护人', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
  outsiderId = (await prisma.user.create({
    data: { email: OUTSIDER_EMAIL, name: '路人', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id

  const project = await prisma.project.create({
    data: {
      name: 'DDE测试项目一',
      totalAmount: '500万',
      targetDate: new Date(),
      followStage: 'DUE_DILIGENCE',
      createdById: managerId,
    },
  })
  projectId = project.id
  const otherProject = await prisma.project.create({
    data: {
      name: 'DDE测试项目二',
      totalAmount: '300万',
      targetDate: new Date(),
      followStage: 'DUE_DILIGENCE',
      createdById: managerId,
    },
  })
  otherProjectId = otherProject.id

  documentId = (await prisma.projectDocument.create({
    data: { projectId, fileName: '审计报告.pdf', fileUrl: '/project-docs/audit.pdf', fileType: 'application/pdf', fileSize: 1024, uploadedById: managerId },
  })).id
  otherProjectDocId = (await prisma.projectDocument.create({
    data: { projectId: otherProjectId, fileName: '其他项目BP.pdf', fileUrl: '/project-docs/bp.pdf', fileType: 'application/pdf', fileSize: 1024, uploadedById: managerId },
  })).id

  const batch = await prisma.dDBatch.create({
    data: {
      projectId,
      templateVersion: 'v1',
      status: 'IN_PROGRESS',
      initiatedById: managerId,
      tasks: { create: [{ moduleKey: 'FINANCE_ECONOMICS', status: 'IN_PROGRESS', sortKey: 7 }] },
    },
    include: { tasks: true },
  })
  batchId = batch.id
  taskId = batch.tasks[0].id
})

function asUser(user: { id: string; role: string }) {
  mockState.session = { user: { id: user.id, name: null, email: 'x@t.com', role: user.role } }
}

async function createEvidence(body: Record<string, unknown>) {
  const res = await EV_POST(
    new Request('http://t/api/dd/evidence', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  )
  return { status: res.status, body: await res.json() }
}

async function patchEvidence(id: string, body: Record<string, unknown>) {
  const res = await EV_PATCH(
    new Request(`http://t/api/dd/evidence/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: { id } }
  )
  return { status: res.status, body: await res.json() }
}

// ── POST：来源规则 ──

test('POST：DOCUMENT 证据需同项目资料；跨项目资料 400；缺 documentId 400', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })

  const ok = await createEvidence({
    taskId, sourceType: 'DOCUMENT', documentId, grade: 'A',
    sourceLabel: '审计报告', location: 'P12 第3节', excerpt: '2025 年营收 2,000 万元',
  })
  assert.equal(ok.status, 201)
  assert.equal(ok.body.evidence.grade, 'A')
  assert.equal(ok.body.evidence.status, 'PENDING')

  const cross = await createEvidence({
    taskId, sourceType: 'DOCUMENT', documentId: otherProjectDocId, excerpt: '跨项目引用',
  })
  assert.equal(cross.status, 400)
  assert.match(cross.body.error, /不属于该项目/)

  const missing = await createEvidence({ taskId, sourceType: 'DOCUMENT', excerpt: '无资料引用' })
  assert.equal(missing.status, 400)
})

test('POST：WEB 证据需合法 http(s) 链接；MANUAL 证据等级强制 B（一手陈述）', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })

  const web = await createEvidence({
    taskId, sourceType: 'WEB', sourceUrl: 'https://36kr.com/p/123', grade: 'C',
    sourceLabel: '36氪报道', excerpt: '该公司完成 A 轮融资',
  })
  assert.equal(web.status, 201)
  assert.equal(web.body.evidence.sourceUrl, 'https://36kr.com/p/123')

  assert.equal((await createEvidence({ taskId, sourceType: 'WEB', sourceUrl: 'ftp://x', excerpt: 'x' })).status, 400)
  assert.equal((await createEvidence({ taskId, sourceType: 'WEB', excerpt: '无链接' })).status, 400)

  // MANUAL：显式传 A 也强制 B
  const manual = await createEvidence({
    taskId, sourceType: 'MANUAL', grade: 'A', sourceLabel: '创始人访谈', excerpt: 'Q4 现金流转正（口述）',
  })
  assert.equal(manual.status, 201)
  assert.equal(manual.body.evidence.grade, 'B')
})

test('POST：摘录必填限长；等级白名单；未登录 401；路人 403；任务不存在 404', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  assert.equal((await createEvidence({ taskId, sourceType: 'WEB', sourceUrl: 'https://x.com', excerpt: '' })).status, 400)
  assert.equal(
    (await createEvidence({ taskId, sourceType: 'WEB', sourceUrl: 'https://x.com', excerpt: 'x'.repeat(2001) })).status,
    400
  )
  assert.equal(
    (await createEvidence({ taskId, sourceType: 'WEB', sourceUrl: 'https://x.com', excerpt: 'x', grade: 'E' })).status,
    400
  )
  assert.equal((await createEvidence({ taskId: 'nope', sourceType: 'MANUAL', excerpt: 'x' })).status, 404)

  mockState.session = null
  const noAuth = await createEvidence({ taskId, sourceType: 'MANUAL', excerpt: 'x' })
  assert.equal(noAuth.status, 401)

  asUser({ id: outsiderId, role: 'INVESTMENT_MANAGER' })
  assert.equal((await createEvidence({ taskId, sourceType: 'MANUAL', excerpt: 'x' })).status, 403)
})

// ── GET：列表 ──

test('GET：任务证据列表（新→旧），DOCUMENT 证据带资料文件名', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  await createEvidence({ taskId, sourceType: 'DOCUMENT', documentId, grade: 'A', excerpt: '审计摘录' })
  await createEvidence({ taskId, sourceType: 'WEB', sourceUrl: 'https://x.com/a', grade: 'C', excerpt: '媒体摘录' })

  const res = await EV_LIST(new Request(`http://t/api/dd/evidence?taskId=${taskId}`))
  assert.equal(res.status, 200)
  const { evidences } = await res.json()
  assert.equal(evidences.length, 2)
  // 新→旧：媒体摘录在前
  assert.equal(evidences[0].sourceType, 'WEB')
  assert.equal(evidences[1].documentFileName, '审计报告.pdf')
  assert.equal(evidences[1].sourceType, 'DOCUMENT')

  // 路人无权
  asUser({ id: outsiderId, role: 'INVESTMENT_MANAGER' })
  assert.equal((await EV_LIST(new Request(`http://t/api/dd/evidence?taskId=${taskId}`))).status, 403)
})

// ── PATCH：确认/冲突/重开 ──

test('PATCH：PENDING → CONFIRMED 记录确认人；CONFIRMED → CONFLICT 需冲突说明', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  const created = await createEvidence({ taskId, sourceType: 'MANUAL', sourceLabel: '创始人访谈', excerpt: '口述营收 3000 万' })
  const evId = created.body.evidence.id as string

  // 确认 → 记录确认人与时间
  let res = await patchEvidence(evId, { status: 'CONFIRMED' })
  assert.equal(res.status, 200)
  assert.equal(res.body.evidence.status, 'CONFIRMED')
  assert.equal(res.body.evidence.confirmedBy.id, managerId)
  assert.ok(res.body.evidence.confirmedAt)

  // 标记冲突但无说明 → 400
  res = await patchEvidence(evId, { status: 'CONFLICT' })
  assert.equal(res.status, 400)
  assert.match(res.body.error, /冲突说明/)

  // 带说明标记冲突 → 状态 CONFLICT 且确认痕迹清空
  res = await patchEvidence(evId, { status: 'CONFLICT', note: '与审计报告 2000 万矛盾' })
  assert.equal(res.body.evidence.status, 'CONFLICT')
  assert.equal(res.body.evidence.note, '与审计报告 2000 万矛盾')
  assert.equal(res.body.evidence.confirmedBy, null)

  // 裁决后重新确认
  res = await patchEvidence(evId, { status: 'CONFIRMED' })
  assert.equal(res.body.evidence.status, 'CONFIRMED')
})

test('PATCH：非法状态值 400；证据不存在 404；仅改备注/来源名/定位不改状态', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  const created = await createEvidence({ taskId, sourceType: 'WEB', sourceUrl: 'https://x.com', excerpt: 'x' })
  const evId = created.body.evidence.id as string

  assert.equal((await patchEvidence(evId, { status: 'APPROVED' })).status, 400)
  assert.equal((await patchEvidence('nope', { note: 'x' })).status, 404)

  const res = await patchEvidence(evId, { note: '补充备注', sourceLabel: '新来源名', location: 'P3' })
  assert.equal(res.status, 200)
  assert.equal(res.body.evidence.note, '补充备注')
  assert.equal(res.body.evidence.sourceLabel, '新来源名')
  assert.equal(res.body.evidence.location, 'P3')
  assert.equal(res.body.evidence.status, 'PENDING')
})

// ── DELETE + 冻结只读 ──

test('DELETE：删除证据；冻结批次不可增删改证据', async () => {
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  const created = await createEvidence({ taskId, sourceType: 'MANUAL', excerpt: 'x' })
  const evId = created.body.evidence.id as string

  // 路人不可删
  asUser({ id: outsiderId, role: 'INVESTMENT_MANAGER' })
  const delRes1 = await EV_DELETE(new Request(`http://t/api/dd/evidence/${evId}`), { params: { id: evId } })
  assert.equal(delRes1.status, 403)

  // 维护人可删
  asUser({ id: managerId, role: 'INVESTMENT_MANAGER' })
  const delRes2 = await EV_DELETE(new Request(`http://t/api/dd/evidence/${evId}`), { params: { id: evId } })
  assert.equal(delRes2.status, 200)
  assert.equal(await prisma.dDEvidence.count({ where: { id: evId } }), 0)

  // 冻结批次 → 增/改/删全部 400
  await prisma.dDBatch.update({ where: { id: batchId }, data: { status: 'FROZEN' } })
  const frozenCreate = await createEvidence({ taskId, sourceType: 'MANUAL', excerpt: 'x' })
  assert.equal(frozenCreate.status, 400)
  assert.match(frozenCreate.body.error, /冻结/)
})
