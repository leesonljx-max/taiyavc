/**
 * /api/projects GET 服务端分页契约测试
 *
 * 覆盖：401、兼容全量模式、分页与 total、超界页、keyword 大小写不敏感、
 * stage 累计筛选、industry/year/managerId 下推、facets 结构与联动、
 * pageSize 上限、受限角色可见性回归。
 */
import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mockState, resetMocks } from './helpers/setup'

import { GET } from '@/app/api/projects/route'
import prisma from '@/lib/prisma'

const SUFFIX = String(Date.now()).slice(-6)
const ADMIN_EMAIL = `proj-admin-${SUFFIX}@test.local`
const VISITOR_EMAIL = `proj-visitor-${SUFFIX}@test.local`

let adminId = ''
let visitorId = ''

function asAdmin() {
  mockState.session = { user: { id: adminId, email: ADMIN_EMAIL, role: 'ADMIN', name: '管理员' } }
}
function asVisitor() {
  mockState.session = { user: { id: visitorId, email: VISITOR_EMAIL, role: 'TEMP_VISITOR', name: '访客' } }
}

function getUrl(params: Record<string, string | number> = {}): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v))
  return `http://t/api/projects${qs.toString() ? `?${qs}` : ''}`
}

async function fetchJson(params: Record<string, string | number> = {}): Promise<{
  status: number
  body: {
    projects: Array<{ id: string; name: string; industry: string | null; followStage: string; passedStages: string | null; memberIds: string[]; createdById: string }>
    total: number
    page: number
    pageSize: number
    scope: string
    facets: {
      industries: string[]
      years: number[]
      totalCount: number
      stageCounts: Record<string, number>
      currentStageCounts?: Record<string, number>
    }
  }
}> {
  const res = await GET(new Request(getUrl(params)))
  return { status: res.status, body: await res.json() }
}

const year = new Date().getFullYear()

beforeEach(async () => {
  resetMocks()
  await prisma.project.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VISITOR_EMAIL] } } })

  const admin = await prisma.user.create({ data: { email: ADMIN_EMAIL, name: '管理员', passwordHash: 'x', role: 'ADMIN' } })
  adminId = admin.id
  const visitor = await prisma.user.create({ data: { email: VISITOR_EMAIL, name: '访客', passwordHash: 'x', role: 'TEMP_VISITOR' } })
  visitorId = visitor.id

  const mk = (name: string, opts: {
    industry?: string
    targetYear?: number
    followStage?: string
    passedStages?: string[]
    createdById?: string
    memberIds?: string[]
  } = {}) =>
    prisma.project.create({
      data: {
        name,
        companyFullName: `${name}有限公司`,
        industry: opts.industry ?? 'AI应用',
        followStage: (opts.followStage ?? 'INITIAL_TALK') as string,
        passedStages: JSON.stringify(opts.passedStages ?? ['INITIAL_TALK']),
        totalAmount: '100万',
        targetDate: new Date(opts.targetYear ?? year, 5, 1),
        createdById: opts.createdById ?? adminId,
        members: opts.memberIds ? { create: opts.memberIds.map(userId => ({ userId })) } : undefined,
      },
    })

  // 6 个项目：3 个 AI应用（当年），2 个 半导体芯片（当年），1 个去年
  await mk(`项目甲${SUFFIX}`, { followStage: 'INITIAL_TALK' })
  await mk(`项目乙${SUFFIX}`, {
    industry: '半导体芯片',
    followStage: 'PRE_DD',
    passedStages: ['INITIAL_TALK', 'PRE_DD'],
  })
  // 已到交割但"经过"PRE_DD（累计口径命中）
  await mk(`项目丙${SUFFIX}`, {
    followStage: 'CLOSING',
    passedStages: ['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'AGREEMENT', 'CLOSING'],
  })
  await mk(`项目丁${SUFFIX}`, { industry: '半导体芯片', targetYear: year - 1 })
  await mk(`Alpha Case ${SUFFIX}`, { followStage: 'INITIAL_TALK' }) // 大写名，测大小写不敏感
  // 访客创建的项目（scope=mine 用）
  await mk(`访客项目${SUFFIX}`, {
    followStage: 'INITIAL_TALK',
    createdById: visitorId,
  })
})

after(async () => {
  await prisma.project.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VISITOR_EMAIL] } } })
  await prisma.$disconnect()
})

test('未登录返回 401', async () => {
  const res = await GET(new Request(getUrl()))
  assert.equal(res.status, 401)
})

test('兼容全量模式（不传 page）：返回全部 + total + facets', async () => {
  asAdmin()
  const { status, body } = await fetchJson()
  assert.equal(status, 200)
  assert.equal(body.projects.length, 6)
  assert.equal(body.total, 6)
  assert.equal(body.page, 1)
  assert.ok(Array.isArray(body.facets.industries))
})

test('分页：page=1/pageSize=2 返回 2 条、total=6、两页不重叠', async () => {
  asAdmin()
  const p1 = await fetchJson({ page: 1, pageSize: 2 })
  assert.equal(p1.body.projects.length, 2)
  assert.equal(p1.body.total, 6)
  assert.equal(p1.body.pageSize, 2)

  const p2 = await fetchJson({ page: 2, pageSize: 2 })
  const ids1 = new Set(p1.body.projects.map(p => p.id))
  for (const p of p2.body.projects) assert.ok(!ids1.has(p.id), '不同页不应出现重复项目')
})

test('超界页：返回空数组但 total 正确', async () => {
  asAdmin()
  const { body } = await fetchJson({ page: 99, pageSize: 10 })
  assert.equal(body.projects.length, 0)
  assert.equal(body.total, 6)
})

test('pageSize 上限 100（传 1000 被钳制）', async () => {
  asAdmin()
  const { body } = await fetchJson({ page: 1, pageSize: 1000 })
  assert.equal(body.pageSize, 100)
})

test('keyword 大小写不敏感：搜 alpha 命中 Alpha Case', async () => {
  asAdmin()
  const { body } = await fetchJson({ page: 1, pageSize: 50, keyword: `alpha case ${SUFFIX}`.toUpperCase() })
  assert.equal(body.total, 1)
  assert.ok(body.projects[0].name.startsWith('Alpha Case'))
})

test('stage 累计筛选：PRE_DD 命中 2 个（含已到 CLOSING 的）', async () => {
  asAdmin()
  const { body } = await fetchJson({ page: 1, pageSize: 50, stage: 'PRE_DD' })
  assert.equal(body.total, 2)
  const names = body.projects.map(p => p.name).sort()
  assert.ok(names.every(n => n.includes('项目乙') || n.includes('项目丙')))
})

test('industry 筛选 + year 筛选下推', async () => {
  asAdmin()
  const semi = await fetchJson({ page: 1, pageSize: 50, industry: '半导体芯片' })
  assert.equal(semi.body.total, 2)

  const semiThisYear = await fetchJson({ page: 1, pageSize: 50, industry: '半导体芯片', year })
  assert.equal(semiThisYear.body.total, 1)

  const lastYear = await fetchJson({ page: 1, pageSize: 50, year: year - 1 })
  assert.equal(lastYear.body.total, 1)
  assert.ok(lastYear.body.projects[0].name.includes('项目丁'))
})

test('managerId 下推：创建者或成员的项目', async () => {
  asAdmin()
  // visitor 创建的项目应命中
  const { body } = await fetchJson({ page: 1, pageSize: 50, managerId: visitorId })
  assert.equal(body.total, 1)
  assert.ok(body.projects[0].name.includes('访客项目'))
})

test('facets：industries/years 完整；stageCounts 随 industry 联动', async () => {
  asAdmin()
  const all = await fetchJson({ page: 1, pageSize: 1 })
  assert.deepEqual(all.body.facets.industries, ['AI应用', '半导体芯片'])
  assert.deepEqual(all.body.facets.years, [year, year - 1])

  // 不筛选：PRE_DD 累计 = 2
  assert.equal(all.body.facets.stageCounts['PRE_DD'], 2)

  // 半导体芯片行业：只有项目乙经过 PRE_DD → 1
  const semi = await fetchJson({ page: 1, pageSize: 1, industry: '半导体芯片' })
  assert.equal(semi.body.facets.stageCounts['PRE_DD'], 1)
})

test('facets.totalCount：项目总数不随分页截断，随 industry/year 联动、不随 keyword/stage 联动', async () => {
  asAdmin()
  // 分页 pageSize=1 时 totalCount 仍为全集 6（不随分页截断）
  const paged = await fetchJson({ page: 1, pageSize: 1 })
  assert.equal(paged.body.projects.length, 1)
  assert.equal(paged.body.facets.totalCount, 6)

  // 随 industry 联动：半导体芯片 = 2
  const semi = await fetchJson({ page: 1, pageSize: 1, industry: '半导体芯片' })
  assert.equal(semi.body.facets.totalCount, 2)

  // 随 year 联动：去年 = 1
  const lastYear = await fetchJson({ page: 1, pageSize: 1, year: year - 1 })
  assert.equal(lastYear.body.facets.totalCount, 1)

  // 不随 keyword 联动：搜索无结果时 totalCount 仍为 6
  const kw = await fetchJson({ page: 1, pageSize: 1, keyword: '不存在的关键词' })
  assert.equal(kw.body.total, 0)
  assert.equal(kw.body.facets.totalCount, 6)

  // 不随 stage 联动
  const stage = await fetchJson({ page: 1, pageSize: 1, stage: 'PRE_DD' })
  assert.equal(stage.body.total, 2)
  assert.equal(stage.body.facets.totalCount, 6)
})

test('facets=current：currentStageCounts 按 followStage 当前口径 + managerId 联动', async () => {
  asAdmin()
  const { body } = await fetchJson({ page: 1, pageSize: 1, facets: 'current' })
  assert.equal(body.facets.currentStageCounts?.['INITIAL_TALK'], 4)
  assert.equal(body.facets.currentStageCounts?.['PRE_DD'], 1)
  assert.equal(body.facets.currentStageCounts?.['CLOSING'], 1)

  // managerId=visitor 只统计访客的 1 个 INITIAL_TALK
  const mine = await fetchJson({ page: 1, pageSize: 1, facets: 'current', managerId: visitorId })
  assert.equal(mine.body.facets.currentStageCounts?.['INITIAL_TALK'], 1)
  assert.equal(mine.body.facets.currentStageCounts?.['CLOSING'], undefined)
})

test('scope=mine：仅返回自己维护的项目', async () => {
  asVisitor()
  const { body } = await fetchJson({ scope: 'mine' })
  assert.equal(body.total, 1)
  assert.ok(body.projects[0].name.includes('访客项目'))
})

test('受限角色回归：TEMP_VISITOR 全量模式看不到他人未公开项目，但能看到 INITIAL_TALK', async () => {
  asVisitor()
  const { body } = await fetchJson()
  const names = body.projects.map(p => p.name)
  // 访客可见：自己的 + 3 个他人公开 INITIAL_TALK（项目甲/项目丁/Alpha）= 4
  assert.equal(body.total, 4)
  assert.ok(!names.some(n => n.includes('项目乙')), '他人 PRE_DD 非成员不可见')
  assert.ok(!names.some(n => n.includes('项目丙')), '他人 CLOSING 非成员不可见')
  assert.ok(names.some(n => n.includes('项目甲')), '他人 INITIAL_TALK 可见')
})
