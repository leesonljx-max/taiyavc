/**
 * V2.2.1 测试：项目尽调列表
 * - 已完成尽调项目：进入过尽调阶段 + 九大模块报告齐全（含已变更到协议/已否等阶段的项目）
 * - 主列表卡片字段：各模块资料完善进度（resourceCompleteCount / resourceProgressPct / reportReady）+ 估值
 */

import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { resetMocks, mockState } from './helpers/setup'
import { DD_TEMPLATE_MODULES } from '@/lib/dd-workbench/template'

import { GET as RESEARCH_LIST } from '@/app/api/research/route'

const SUFFIX = String(Date.now()).slice(-6)
const MANAGER_EMAIL = `d7-mgr-${SUFFIX}@test.com`
const OUTSIDER_EMAIL = `d7-out-${SUFFIX}@test.com`

let managerId = ''
let outsiderId = ''

beforeEach(async () => {
  resetMocks()
  await prisma.dDModuleResource.deleteMany({ where: { project: { name: { startsWith: 'D7测试项目' } } } })
  await prisma.project.deleteMany({ where: { name: { startsWith: 'D7测试项目' } } })
  await prisma.user.deleteMany({ where: { email: { in: [MANAGER_EMAIL, OUTSIDER_EMAIL] } } })

  managerId = (await prisma.user.create({
    data: { email: MANAGER_EMAIL, name: '维护经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
  outsiderId = (await prisma.user.create({
    data: { email: OUTSIDER_EMAIL, name: '路人经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
})

after(async () => {
  await prisma.dDModuleResource.deleteMany({ where: { project: { name: { startsWith: 'D7测试项目' } } } })
  await prisma.project.deleteMany({ where: { name: { startsWith: 'D7测试项目' } } })
  await prisma.user.deleteMany({ where: { email: { in: [MANAGER_EMAIL, OUTSIDER_EMAIL] } } })
  await prisma.$disconnect()
})

function asUser(id: string, role: string) {
  mockState.session = { user: { id, name: null, email: 'x@t.com', role } }
}
const asManager = () => asUser(managerId, 'INVESTMENT_MANAGER')

/** 直接入库模块资料行 */
async function seedModule(pid: string, key: string, opts: { text?: boolean; docs?: boolean; report?: boolean }) {
  await prisma.dDModuleResource.create({
    data: {
      projectId: pid,
      moduleKey: key,
      documents: opts.docs
        ? JSON.stringify([{ id: 'd1', fileName: '资料.pdf', fileUrl: '/api/uploads/research-docs/x.pdf', fileType: 'application/pdf', fileSize: 1024, text: '文档内容', uploadedAt: new Date().toISOString() }])
        : '[]',
      textBlocks: opts.text
        ? JSON.stringify([{ id: 't1', content: '维护人填写的模块资料内容。', createdAt: new Date().toISOString() }])
        : '[]',
      screenshots: '[]',
      reportJson: opts.report
        ? JSON.stringify({ summary: '模块分析。', opportunities: ['机会'], risks: ['风险'], generatedAt: new Date().toISOString() })
        : null,
    },
  })
}

test('已完成尽调项目：九模块报告齐全才计入；变更到协议阶段后仍在已完成列表（不在主列表）；资料完善进度字段正确', async () => {
  asManager()

  // 项目A：尽调阶段，九大模块全部有资料 + 报告
  const projectA = await prisma.project.create({
    data: {
      name: `D7测试项目A${SUFFIX}`,
      totalAmount: '2500万',
      investmentValuation: 2.5,
      targetDate: new Date(),
      followStage: 'DUE_DILIGENCE',
      createdById: managerId,
    },
  })
  for (const m of DD_TEMPLATE_MODULES) {
    await seedModule(projectA.id, m.key, { text: true, report: true })
  }

  // 项目B：尽调阶段，仅 5 个模块有报告 → 不算已完成
  const projectB = await prisma.project.create({
    data: {
      name: `D7测试项目B${SUFFIX}`,
      totalAmount: '1000万',
      targetDate: new Date(),
      followStage: 'DUE_DILIGENCE',
      createdById: managerId,
    },
  })
  for (const m of DD_TEMPLATE_MODULES.slice(0, 5)) {
    await seedModule(projectB.id, m.key, { text: true, docs: m.key === 'PROJECT_ENTITY', report: true })
  }

  let res: Response = await RESEARCH_LIST()
  assert.equal(res.status, 200)
  let body = await res.json()

  // 主列表：A/B 都在（尽调阶段）
  const aInList = body.projects.find((p: { id: string }) => p.id === projectA.id)
  const bInList = body.projects.find((p: { id: string }) => p.id === projectB.id)
  assert.ok(aInList && bInList)

  // 资料完善进度：A = 9 模块完整（仅文本 → 每模块 50 分 → 平均 50%）
  assert.equal(aInList.resourceCompleteCount, 9)
  assert.equal(aInList.resourceProgressPct, 50)
  assert.equal(aInList.reportReady, true)
  assert.equal(aInList.investmentValuation, 2.5)

  // B：5 个模块（首个含文档 → 100 分，其余 50 分 → (100+4×50)/9 ≈ 33）
  assert.equal(bInList.resourceCompleteCount, 5)
  assert.equal(bInList.resourceProgressPct, 33)
  assert.equal(bInList.reportReady, false)

  // 已完成尽调项目：仅 A
  assert.equal(body.completedProjects.length, 1)
  assert.equal(body.completedProjects[0].id, projectA.id)
  assert.equal(body.completedProjects[0].investmentValuation, 2.5)
  assert.equal(body.stats.completedDdProjects, 1)

  // 项目A 变更到协议阶段（passedStages 含 DUE_DILIGENCE）→ 主列表移除，已完成列表保留
  await prisma.project.update({
    where: { id: projectA.id },
    data: { followStage: 'AGREEMENT', passedStages: JSON.stringify(['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'AGREEMENT']) },
  })
  res = await RESEARCH_LIST()
  body = await res.json()

  assert.ok(!body.projects.some((p: { id: string }) => p.id === projectA.id), '协议阶段项目不应在主列表')
  assert.equal(body.projects.length, 1, '主列表只剩项目B')
  const aCompleted = body.completedProjects.find((p: { id: string }) => p.id === projectA.id)
  assert.ok(aCompleted, '已变更到协议阶段的项目应保留在已完成尽调列表')
  assert.equal(aCompleted.followStage, 'AGREEMENT')
  assert.equal(aCompleted.totalAmount, '2500万')
  assert.equal(body.stats.completedDdProjects, 1)

  // 路人（非维护人）两个列表都看不到
  asUser(outsiderId, 'INVESTMENT_MANAGER')
  res = await RESEARCH_LIST()
  body = await res.json()
  assert.equal(body.projects.length, 0)
  assert.equal(body.completedProjects.length, 0)

  // 未登录 401
  mockState.session = null
  res = await RESEARCH_LIST()
  assert.equal(res.status, 401)
})
