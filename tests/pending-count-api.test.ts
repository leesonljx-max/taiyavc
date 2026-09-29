/**
 * /api/pending-count 待办徽标 API 测试
 * 侧边栏"工作台"微信式数字徽标的数据源（与工作台"待办请求"区块同口径）
 */
import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mockState, resetMocks } from './helpers/setup'

import { GET } from '@/app/api/pending-count/route'
import prisma from '@/lib/prisma'

const SUFFIX = String(Date.now()).slice(-6)
const PARTNER_EMAIL = `pd-partner-${SUFFIX}@test.local`
const MANAGER_EMAIL = `pd-manager-${SUFFIX}@test.local`

let partnerId = ''
let managerId = ''

beforeEach(async () => {
  resetMocks()
  await prisma.stageChangeRequest.deleteMany({})
  await prisma.project.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: [PARTNER_EMAIL, MANAGER_EMAIL] } } })

  const partner = await prisma.user.create({ data: { email: PARTNER_EMAIL, name: '合伙人', passwordHash: 'x', role: 'INVESTMENT_PARTNER' } })
  partnerId = partner.id
  const manager = await prisma.user.create({ data: { email: MANAGER_EMAIL, name: '经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER' } })
  managerId = manager.id
})

after(async () => {
  await prisma.stageChangeRequest.deleteMany({})
  await prisma.project.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: [PARTNER_EMAIL, MANAGER_EMAIL] } } })
  await prisma.$disconnect()
})

function asUser(id: string, role: string) {
  mockState.session = { user: { id, email: 'x@t.com', role, name: '用户' } }
}

test('未登录 401', async () => {
  const res = await GET()
  assert.equal(res.status, 401)
})

test('投资合伙人：待办数 = PENDING 阶段变更请求数；已处理的和已审批的不计', async () => {
  const p1 = await prisma.project.create({
    data: { name: `项目一${SUFFIX}`, totalAmount: '100万', targetDate: new Date(), createdById: managerId },
  })
  const p2 = await prisma.project.create({
    data: { name: `项目二${SUFFIX}`, totalAmount: '100万', targetDate: new Date(), createdById: managerId },
  })
  await prisma.stageChangeRequest.createMany({
    data: [
      { projectId: p1.id, requesterId: managerId, fromStage: 'INITIAL_TALK', toStage: 'PRE_DD', status: 'PENDING' },
      { projectId: p2.id, requesterId: managerId, fromStage: 'PRE_DD', toStage: 'PROJECT_INITIATION', status: 'PENDING' },
      { projectId: p1.id, requesterId: managerId, fromStage: 'PRE_DD', toStage: 'PROJECT_INITIATION', status: 'APPROVED', reviewerId: partnerId },
      { projectId: p2.id, requesterId: managerId, fromStage: 'INITIAL_TALK', toStage: 'PRE_DD', status: 'REJECTED', reviewerId: partnerId },
    ],
  })

  asUser(partnerId, 'INVESTMENT_PARTNER')
  const res = await GET()
  assert.equal(res.status, 200)
  assert.equal((await res.json()).count, 2)
})

test('无待办时返回 0；管理员同样可见', async () => {
  asUser(partnerId, 'INVESTMENT_PARTNER')
  let res = await GET()
  assert.equal((await res.json()).count, 0)

  // 造 1 条待办 → 管理员也能看到
  const p = await prisma.project.create({
    data: { name: `项目三${SUFFIX}`, totalAmount: '100万', targetDate: new Date(), createdById: managerId },
  })
  await prisma.stageChangeRequest.create({
    data: { projectId: p.id, requesterId: managerId, fromStage: 'INITIAL_TALK', toStage: 'PRE_DD', status: 'PENDING' },
  })
  asUser(managerId, 'ADMIN')
  res = await GET()
  assert.equal((await res.json()).count, 1)
})

test('非合伙人/管理员角色：一律返回 0（不暴露数据）', async () => {
  const p = await prisma.project.create({
    data: { name: `项目四${SUFFIX}`, totalAmount: '100万', targetDate: new Date(), createdById: managerId },
  })
  await prisma.stageChangeRequest.create({
    data: { projectId: p.id, requesterId: managerId, fromStage: 'INITIAL_TALK', toStage: 'PRE_DD', status: 'PENDING' },
  })
  asUser(managerId, 'INVESTMENT_MANAGER')
  const res = await GET()
  assert.equal(res.status, 200)
  assert.equal((await res.json()).count, 0)
})
