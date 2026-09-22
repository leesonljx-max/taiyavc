/**
 * /api/statistics/industry-map 时间维度（range）契约测试
 *
 * 覆盖：401、默认 year 兼容行为、month/quarter/half 滚动窗口过滤、
 * year+历史年份、windowStart/windowEnd 字段、years 列表不受窗口影响、
 * 受限角色可见性下推回归、空行业归"未分类"。
 */
import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mockState, resetMocks } from './helpers/setup'

import { GET } from '@/app/api/statistics/industry-map/route'
import prisma from '@/lib/prisma'

const SUFFIX = String(Date.now()).slice(-6)
const ADMIN_EMAIL = `indmap-admin-${SUFFIX}@test.local`
const VISITOR_EMAIL = `indmap-visitor-${SUFFIX}@test.local`
const OWNER_EMAIL = `indmap-owner-${SUFFIX}@test.local`

const DAY = 24 * 3600 * 1000

interface MapResponse {
  status: number
  body: {
    range?: string
    year?: number
    windowStart?: string
    windowEnd?: string
    years?: number[]
    totalProjects?: number
    totalIndustries?: number
    industries?: Array<{ industry: string; count: number; projects: Array<{ id: string }> }>
    error?: string
  }
}

function getUrl(params: Record<string, string | number> = {}): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v))
  return `http://t/api/statistics/industry-map${qs.toString() ? `?${qs}` : ''}`
}

async function fetchMap(params: Record<string, string | number> = {}): Promise<MapResponse> {
  const res = await GET(new Request(getUrl(params)))
  return { status: res.status, body: await res.json() }
}

let adminId = ''
let visitorId = ''
let ownerId = ''
let recentId = ''       // 5 天前（近1月内）
let midId = ''          // 40 天前（近季度内、近1月外）
let oldId = ''          // 200 天前（近半年外）
let lastYearId = ''     // 去年
let restrictedId = ''   // 他人 PRE_DD 非成员（受限角色不可见）

beforeEach(async () => {
  resetMocks()
  await prisma.project.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VISITOR_EMAIL, OWNER_EMAIL] } } })

  const admin = await prisma.user.create({ data: { email: ADMIN_EMAIL, name: '管理员', passwordHash: 'x', role: 'ADMIN' } })
  adminId = admin.id
  const visitor = await prisma.user.create({ data: { email: VISITOR_EMAIL, name: '访客', passwordHash: 'x', role: 'TEMP_VISITOR' } })
  visitorId = visitor.id
  const owner = await prisma.user.create({ data: { email: OWNER_EMAIL, name: '他人', passwordHash: 'x', role: 'TEMP_VISITOR' } })
  ownerId = owner.id

  const mk = (name: string, industry: string | null, targetDate: Date, extra: Record<string, unknown> = {}) =>
    prisma.project.create({
      data: {
        name,
        industry,
        followStage: 'INITIAL_TALK',
        totalAmount: '100万',
        targetDate,
        createdById: adminId,
        ...extra,
      },
    })

  const now = Date.now()
  const recent = await mk(`近1月项目${SUFFIX}`, 'AI应用', new Date(now - 5 * DAY))
  recentId = recent.id
  const mid = await mk(`近季度项目${SUFFIX}`, 'AI应用', new Date(now - 40 * DAY))
  midId = mid.id
  const old = await mk(`近半年外项目${SUFFIX}`, '半导体芯片', new Date(now - 200 * DAY))
  oldId = old.id
  const lastYear = await mk(`去年项目${SUFFIX}`, '光学', new Date(new Date().getFullYear() - 1, 5, 1))
  lastYearId = lastYear.id
  // 他人受限阶段项目（无成员）：受限角色不可见
  const restricted = await prisma.project.create({
    data: {
      name: `他人受限项目${SUFFIX}`,
      industry: 'AI硬件',
      followStage: 'PRE_DD',
      totalAmount: '100万',
      targetDate: new Date(now - 10 * DAY),
      createdById: ownerId,
    },
  })
  restrictedId = restricted.id

  mockState.session = { user: { id: adminId, email: ADMIN_EMAIL, role: 'ADMIN', name: '管理员' } }
})

after(async () => {
  await prisma.project.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VISITOR_EMAIL, OWNER_EMAIL] } } })
  await prisma.$disconnect()
})

function industryIdsOf(body: MapResponse['body']): Set<string> {
  return new Set((body.industries || []).flatMap(g => g.projects.map(p => p.id)))
}

test('未登录返回 401', async () => {
  mockState.session = null
  const { status } = await fetchMap()
  assert.equal(status, 401)
})

test('默认（不传 range）= year 模式，行为与旧版兼容', async () => {
  const year = new Date().getFullYear()
  const { status, body } = await fetchMap({ year })
  assert.equal(status, 200)
  assert.equal(body.range, 'year')
  assert.equal(body.year, year)

  const ids = industryIdsOf(body)
  // 当年项目：近1月/近季度/近半年外的三个（去年项目排除）
  assert.ok(ids.has(recentId))
  assert.ok(ids.has(midId))
  assert.ok(ids.has(oldId))
  assert.ok(!ids.has(lastYearId))
})

test('range=month：仅含最近 30 天初聊的项目', async () => {
  const { body } = await fetchMap({ range: 'month' })
  assert.equal(body.range, 'month')

  const ids = industryIdsOf(body)
  assert.ok(ids.has(recentId), '5 天前项目应命中')
  assert.ok(!ids.has(midId), '40 天前项目不应命中')
  assert.ok(!ids.has(oldId), '200 天前项目不应命中')
  assert.ok(!ids.has(lastYearId))
})

test('range=quarter：90 天窗口（5 天 + 40 天命中，200 天不命中）', async () => {
  const { body } = await fetchMap({ range: 'quarter' })
  const ids = industryIdsOf(body)
  assert.ok(ids.has(recentId))
  assert.ok(ids.has(midId), '40 天前项目应命中')
  assert.ok(!ids.has(oldId))
})

test('range=half：180 天窗口', async () => {
  const { body } = await fetchMap({ range: 'half' })
  const ids = industryIdsOf(body)
  assert.ok(ids.has(recentId))
  assert.ok(ids.has(midId))
  assert.ok(!ids.has(oldId), '200 天前项目不应命中')
})

test('windowStart/windowEnd 字段：year 为自然年边界，滚动窗口为实时区间', async () => {
  const year = new Date().getFullYear()
  const yearRes = await fetchMap({ range: 'year', year })
  assert.equal(new Date(yearRes.body.windowStart!).getTime(), new Date(year, 0, 1).getTime())
  assert.equal(new Date(yearRes.body.windowEnd!).getTime(), new Date(year + 1, 0, 1).getTime())

  const monthRes = await fetchMap({ range: 'month' })
  const start = new Date(monthRes.body.windowStart!).getTime()
  const end = new Date(monthRes.body.windowEnd!).getTime()
  const spanDays = (end - start) / DAY
  assert.ok(Math.abs(spanDays - 30) < 1, `月窗口跨度应约 30 天，实际 ${spanDays}`)
})

test('years 列表基于可见全集，不受时间窗口影响', async () => {
  const { body } = await fetchMap({ range: 'month' })
  const years = body.years || []
  assert.ok(years.includes(new Date().getFullYear()))
  assert.ok(years.includes(new Date().getFullYear() - 1), '去年项目也应出现在年份列表')
})

test('受限角色：他人受限阶段项目不可见（可见性下推回归）', async () => {
  mockState.session = { user: { id: visitorId, email: VISITOR_EMAIL, role: 'TEMP_VISITOR', name: '访客' } }
  const { body } = await fetchMap({ range: 'month' })
  const ids = industryIdsOf(body)
  assert.ok(!ids.has(restrictedId), '他人 PRE_DD 非成员项目不应可见')
  assert.ok(ids.has(recentId), '公开阶段项目应可见')
})

test('空行业归入"未分类"', async () => {
  const now = Date.now()
  await prisma.project.create({
    data: {
      name: `无行业项目${SUFFIX}`,
      industry: null,
      followStage: 'INITIAL_TALK',
      totalAmount: '100万',
      targetDate: new Date(now - 3 * DAY),
      createdById: adminId,
    },
  })
  const { body } = await fetchMap({ range: 'month' })
  const uncategorized = (body.industries || []).find(g => g.industry === '未分类')
  assert.ok(uncategorized, '空行业应归入未分类')
  assert.equal(uncategorized!.count, 1)
})
