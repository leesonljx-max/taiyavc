/**
 * v2.4.8 同名项目多版本契约测试
 *
 * 覆盖：
 * 1. 同名项目允许重复创建（项目库创建不再返回 409）
 * 2. checkDuplicate 仅作提示（200 + exists，不阻断）
 * 3. 项目详情返回全库同名版本（versions：维护人 + 创建时间，按创建时间升序）
 * 4. 本周新增项目按维护人分组，同名各版本分别展示（id 不同，点击进入自己的版本）
 */
import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mockState, resetMocks } from './helpers/setup'
import prisma from '@/lib/prisma'

import { POST as CREATE_PROJECT, GET as LIST_PROJECTS } from '@/app/api/projects/route'
import { GET as PROJECT_DETAIL } from '@/app/api/projects/[id]/route'
import { GET as DASHBOARD } from '@/app/api/dashboard/route'

const SUFFIX = String(Date.now()).slice(-6)
const ADMIN_EMAIL = `pv-admin-${SUFFIX}@test.local`
const M1_EMAIL = `pv-m1-${SUFFIX}@test.local`
const M2_EMAIL = `pv-m2-${SUFFIX}@test.local`
const BASE_NAME = `万象智维${SUFFIX}`

let adminId = ''
let m1Id = ''
let m2Id = ''

function asAdmin() {
  mockState.session = { user: { id: adminId, email: ADMIN_EMAIL, role: 'ADMIN', name: '管理员' } }
}
function asM1() {
  mockState.session = { user: { id: m1Id, email: M1_EMAIL, role: 'INVESTMENT_MANAGER', name: '维护人甲' } }
}
function asM2() {
  mockState.session = { user: { id: m2Id, email: M2_EMAIL, role: 'INVESTMENT_MANAGER', name: '维护人乙' } }
}

function createBody(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    industry: 'AI应用',
    companyPosition: 'AI 推理引擎与本地算力调度',
    investmentValuation: 7.5,
    totalAmount: '5000万',
    followStage: 'INITIAL_TALK',
    ...extra,
  }
}

async function createProjectApi(name: string, extra: Record<string, unknown> = {}) {
  return CREATE_PROJECT(
    new Request('http://t/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody(name, extra)),
    })
  )
}

async function detail(id: string) {
  const res = await PROJECT_DETAIL(new Request(`http://t/api/projects/${id}`), { params: { id } })
  return { status: res.status, body: await res.json() }
}

beforeEach(async () => {
  resetMocks()
  await prisma.project.deleteMany({ where: { name: { startsWith: '万象智维' } } })
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, M1_EMAIL, M2_EMAIL] } } })

  adminId = (await prisma.user.create({
    data: { email: ADMIN_EMAIL, name: '管理员', passwordHash: 'x', role: 'ADMIN' },
  })).id
  m1Id = (await prisma.user.create({
    data: { email: M1_EMAIL, name: '维护人甲', passwordHash: 'x', role: 'INVESTMENT_MANAGER' },
  })).id
  m2Id = (await prisma.user.create({
    data: { email: M2_EMAIL, name: '维护人乙', passwordHash: 'x', role: 'INVESTMENT_MANAGER' },
  })).id
})

after(async () => {
  await prisma.project.deleteMany({ where: { name: { startsWith: '万象智维' } } })
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, M1_EMAIL, M2_EMAIL] } } })
})

test('同名项目：两个维护人均可创建成功，生成两条独立记录', async () => {
  asM1()
  let res = await createProjectApi(BASE_NAME)
  assert.equal(res.status, 201)
  const first = await res.json()

  asM2()
  res = await createProjectApi(BASE_NAME, { companyPosition: '硅光计算芯片' })
  assert.equal(res.status, 201)
  const second = await res.json()

  assert.notEqual(first.project.id, second.project.id)
  assert.equal(await prisma.project.count({ where: { name: BASE_NAME } }), 2)

  // 项目库列表同时能看到两条同名项目
  asAdmin()
  const list = await (await LIST_PROJECTS(new Request('http://t/api/projects?keyword=万象智维'))).json()
  const sameName = list.projects.filter((p: { name: string }) => p.name === BASE_NAME)
  assert.equal(sameName.length, 2)
})

test('checkDuplicate：同名仅提示（200 + exists），不再返回 409', async () => {
  asM1()
  assert.equal((await createProjectApi(BASE_NAME)).status, 201)

  asM2()
  const res = await createProjectApi(BASE_NAME, { checkDuplicate: true })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.exists, true)
  assert.equal(body.existingProject.name, BASE_NAME)
  assert.equal(body.existingProject.createdByName, '维护人甲')

  // 提示后仍可继续创建（同一请求继续提交不带 checkDuplicate）
  assert.equal((await createProjectApi(BASE_NAME)).status, 201)
})

test('项目详情：versions 返回全库同名版本（维护人 + 创建时间，升序）', async () => {
  const first = await prisma.project.create({
    data: {
      name: BASE_NAME,
      industry: 'AI应用',
      companyPosition: 'AI 推理引擎',
      totalAmount: '5000万',
      targetDate: new Date(),
      followStage: 'INITIAL_TALK',
      passedStages: JSON.stringify(['INITIAL_TALK']),
      createdById: m1Id,
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    },
  })
  const second = await prisma.project.create({
    data: {
      name: BASE_NAME,
      industry: 'AI应用',
      companyPosition: '硅光计算芯片',
      totalAmount: '8000万',
      targetDate: new Date(),
      followStage: 'INITIAL_TALK',
      passedStages: JSON.stringify(['INITIAL_TALK']),
      createdById: m2Id,
    },
  })

  // 管理员视角：两个版本都能被检索到，且 version 条放在响应顶层（修复前误嵌在 project 内）
  asAdmin()
  const res = await detail(second.id)
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.versions), 'versions 应为顶层数组')
  assert.equal(res.body.versions.length, 2)

  const [v1, v2] = res.body.versions
  assert.equal(v1.id, first.id)
  assert.equal(v2.id, second.id)
  assert.equal(v1.createdBy.name, '维护人甲')
  assert.equal(v2.createdBy.name, '维护人乙')
  assert.ok(v1.createdAt && v2.createdAt)
  assert.ok(new Date(v1.createdAt).getTime() <= new Date(v2.createdAt).getTime())

  // 从任一维护人的版本详情都能看到两条
  const res2 = await detail(first.id)
  assert.equal(res2.body.versions.length, 2)
})

test('本周新增项目：同名各版本按维护人分组展示，卡片 id 分别指向各自版本', async () => {
  const first = await prisma.project.create({
    data: {
      name: BASE_NAME,
      industry: 'AI应用',
      companyPosition: 'AI 推理引擎',
      totalAmount: '5000万',
      targetDate: new Date(),
      followStage: 'INITIAL_TALK',
      passedStages: JSON.stringify(['INITIAL_TALK']),
      createdById: m1Id,
    },
  })
  const second = await prisma.project.create({
    data: {
      name: BASE_NAME,
      industry: 'AI应用',
      companyPosition: '硅光计算芯片',
      totalAmount: '8000万',
      targetDate: new Date(),
      followStage: 'INITIAL_TALK',
      passedStages: JSON.stringify(['INITIAL_TALK']),
      createdById: m2Id,
    },
  })

  asAdmin()
  const body = await (await DASHBOARD()).json()
  const cards = body.maintainerStats.flatMap((m: { projects: Array<{ id: string; name: string }> }) => m.projects)
  const sameNameCards = cards.filter((c: { name: string }) => c.name === BASE_NAME)

  assert.equal(sameNameCards.length, 2)
  assert.deepEqual(
    new Set(sameNameCards.map((c: { id: string }) => c.id)),
    new Set([first.id, second.id])
  )

  // 卡片归属各自的维护人分组
  const groupOf = (id: string) =>
    body.maintainerStats.find((m: { projects: Array<{ id: string }> }) => m.projects.some((p: { id: string }) => p.id === id))
  assert.equal(groupOf(first.id).userName, '维护人甲')
  assert.equal(groupOf(second.id).userName, '维护人乙')
})
