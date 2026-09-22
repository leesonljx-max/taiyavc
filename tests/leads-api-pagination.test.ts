/**
 * /api/project-leads 与 /api/ai-leads GET 服务端分页契约测试
 *
 * 覆盖：分页与 total、keyword 下推（大小写不敏感/字段范围）、权限矩阵、
 * ai-leads stats 四象限计数（released 排除 CONVERTED 的交叉口径）、status 筛选下推。
 */
import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mockState, resetMocks } from './helpers/setup'

import { GET as GET_LEADS } from '@/app/api/project-leads/route'
import { GET as GET_AI_LEADS } from '@/app/api/ai-leads/route'
import prisma from '@/lib/prisma'

const SUFFIX = String(Date.now()).slice(-6)
const ADMIN_EMAIL = `leads-admin-${SUFFIX}@test.local`
const VISITOR_EMAIL = `leads-visitor-${SUFFIX}@test.local`

let adminId = ''
let visitorId = ''

function asAdmin() {
  mockState.session = { user: { id: adminId, email: ADMIN_EMAIL, role: 'ADMIN', name: '管理员' } }
}
function asVisitor() {
  mockState.session = { user: { id: visitorId, email: VISITOR_EMAIL, role: 'TEMP_VISITOR', name: '访客' } }
}

function url(path: string, params: Record<string, string | number> = {}): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v))
  return `http://t${path}${qs.toString() ? `?${qs}` : ''}`
}

beforeEach(async () => {
  resetMocks()
  await prisma.projectLead.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VISITOR_EMAIL] } } })

  const admin = await prisma.user.create({ data: { email: ADMIN_EMAIL, name: '管理员', passwordHash: 'x', role: 'ADMIN' } })
  adminId = admin.id
  const visitor = await prisma.user.create({ data: { email: VISITOR_EMAIL, name: '访客', passwordHash: 'x', role: 'TEMP_VISITOR' } })
  visitorId = visitor.id

  // ── 项目线索（MANUAL）──
  for (let i = 0; i < 4; i++) {
    await prisma.projectLead.create({
      data: {
        name: `手动线索${i}${SUFFIX}`,
        industry: 'AI应用',
        mainProducts: i === 0 ? `Robot ${SUFFIX} 助手` : '产品',
        createdById: i === 3 ? visitorId : adminId,
      },
    })
  }

  // ── AI 线索（source=AI）──
  const mkAi = (name: string, opts: { releasedAt?: Date; status?: string; createdById?: string } = {}) =>
    prisma.projectLead.create({
      data: {
        name,
        source: 'AI',
        status: opts.status ?? 'PENDING',
        releasedAt: opts.releasedAt ?? null,
        createdById: opts.createdById ?? adminId,
      },
    })

  await mkAi(`AI已释放${SUFFIX}`, { releasedAt: new Date() })                                  // released
  await mkAi(`AI未释放${SUFFIX}`)                                                               // locked
  await mkAi(`AI已转化未释放${SUFFIX}`, { status: 'CONVERTED' })                                 // converted
  await mkAi(`AI已转化已释放${SUFFIX}`, { status: 'CONVERTED', releasedAt: new Date() })          // converted（不进 released）
  await mkAi(`访客AI线索${SUFFIX}`, { createdById: visitorId })                                  // 仅访客可见
})

after(async () => {
  await prisma.projectLead.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VISITOR_EMAIL] } } })
  await prisma.$disconnect()
})

// ── /api/project-leads ──

test('project-leads：未登录 401', async () => {
  const res = await GET_LEADS(new Request(url('/api/project-leads')))
  assert.equal(res.status, 401)
})

test('project-leads：兼容全量模式返回全部 + total', async () => {
  asAdmin()
  const res = await GET_LEADS(new Request(url('/api/project-leads', { scope: 'all' })))
  const body = await res.json()
  // 现状语义：project-leads 不按 source 过滤，含 AI 来源线索（4 手动 + 5 AI）
  assert.equal(body.leads.length, 9)
  assert.equal(body.total, 9)
})

test('project-leads：分页 page=1/pageSize=2 共 2 条、total=9', async () => {
  asAdmin()
  const res = await GET_LEADS(new Request(url('/api/project-leads', { page: 1, pageSize: 2 })))
  const body = await res.json()
  assert.equal(body.leads.length, 2)
  assert.equal(body.total, 9)
  assert.equal(body.pageSize, 2)
})

test('project-leads：keyword 大小写不敏感且覆盖 mainProducts 字段', async () => {
  asAdmin()
  const res = await GET_LEADS(new Request(url('/api/project-leads', { keyword: `robot ${SUFFIX}` })))
  const body = await res.json()
  assert.equal(body.total, 1)
  assert.ok(body.leads[0].name.includes('手动线索0'))
})

test('project-leads：TEMP_VISITOR 仅看自己创建的', async () => {
  asVisitor()
  const res = await GET_LEADS(new Request(url('/api/project-leads', { scope: 'all' })))
  const body = await res.json()
  // 访客创建的：手动线索3 + 访客AI线索 = 2 条
  assert.equal(body.total, 2)
  assert.ok(body.leads.every((l: { createdById: string }) => l.createdById === visitorId))
})

// ── /api/ai-leads ──

test('ai-leads：兼容全量模式返回全部 + total + stats 四计数', async () => {
  asAdmin()
  const res = await GET_AI_LEADS(new Request(url('/api/ai-leads', { scope: 'all' })))
  const body = await res.json()
  assert.equal(body.leads.length, 5)
  assert.equal(body.total, 5)
  // released 排除 CONVERTED：仅"AI已释放"1 条
  assert.equal(body.stats.total, 5)
  assert.equal(body.stats.released, 1)
  assert.equal(body.stats.locked, 2)      // AI未释放 + 访客AI线索
  assert.equal(body.stats.converted, 2)   // 已转化未释放 + 已转化已释放
})

test('ai-leads：分页 + status 下推（released/locked/converted 各自命中）', async () => {
  asAdmin()

  const released = await (await GET_AI_LEADS(new Request(url('/api/ai-leads', { page: 1, pageSize: 30, status: 'released' })))).json()
  assert.equal(released.total, 1)
  assert.ok(released.leads[0].name.includes('AI已释放'))

  const locked = await (await GET_AI_LEADS(new Request(url('/api/ai-leads', { page: 1, pageSize: 30, status: 'locked' })))).json()
  assert.equal(locked.total, 2)

  const converted = await (await GET_AI_LEADS(new Request(url('/api/ai-leads', { page: 1, pageSize: 30, status: 'converted' })))).json()
  assert.equal(converted.total, 2)
  assert.ok(converted.leads.every((l: { status: string }) => l.status === 'CONVERTED'))
})

test('ai-leads：TEMP_VISITOR 权限 = 已释放的 + 自己的（列表与 stats 一致）', async () => {
  asVisitor()
  const body = await (await GET_AI_LEADS(new Request(url('/api/ai-leads', { scope: 'all' })))).json()
  // 可见：AI已释放(released) + AI已转化已释放(released) + 访客AI线索(自己的)
  assert.equal(body.total, 3)
  assert.equal(body.stats.total, 3)
  assert.equal(body.stats.released, 1)
  assert.equal(body.stats.locked, 1)
  assert.equal(body.stats.converted, 1)
})

test('ai-leads：keyword 与权限 AND 组合（只在自己的可见范围内搜索）', async () => {
  asVisitor()
  const body = await (await GET_AI_LEADS(new Request(url('/api/ai-leads', {
    scope: 'all',
    page: 1,
    pageSize: 30,
    keyword: `访客AI线索${SUFFIX}`,
  })))).json()
  assert.equal(body.total, 1)
  assert.ok(body.leads[0].name.includes('访客AI线索'))
})
