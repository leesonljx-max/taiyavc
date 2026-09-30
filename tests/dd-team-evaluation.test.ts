/**
 * V2.1.0 测试：团队评价体系（尽调·团队与治理模块）
 *
 * GET/PUT  /api/dd/team-evaluation/[projectId]       获取 / 保存
 * POST     .../generate                              AI 从模块资料识别成员生成打分表
 * POST     .../confirm                               确认评分（计算最终 10 分制得分）
 * 报告门槛：团队评价存在但为草稿 → 团队与治理模块不完整
 */

import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { resetMocks, mockState, chatCompletions } from './helpers/setup'
import {
  CEO_TEMPLATE, TECH_TEMPLATE, OPS_TEMPLATE, TEAM_TEMPLATE,
  computeEvaluation, validateEvaluation, scoreColor,
  type TeamMember, type TeamEvaluationData,
} from '@/lib/dd-workbench/team-evaluation'
import { DD_TEMPLATE_MODULES } from '@/lib/dd-workbench/template'

import { GET as RES_GET } from '@/app/api/dd/resources/[projectId]/route'
import { POST as REPORT_POST } from '@/app/api/dd/resources/[projectId]/report/route'
import { PUT as TEXT_PUT } from '@/app/api/dd/resources/[projectId]/[moduleKey]/route'
import { GET as EVAL_GET, PUT as EVAL_PUT } from '@/app/api/dd/team-evaluation/[projectId]/route'
import { POST as EVAL_GENERATE } from '@/app/api/dd/team-evaluation/[projectId]/generate/route'
import { POST as EVAL_CONFIRM } from '@/app/api/dd/team-evaluation/[projectId]/confirm/route'
import { POST as REVIEW_POST } from '@/app/api/dd/team-evaluation/[projectId]/review/route'

const SUFFIX = String(Date.now()).slice(-6)
const MANAGER_EMAIL = `d4-mgr-${SUFFIX}@test.com`
const PARTNER_EMAIL = `d4-p1-${SUFFIX}@test.com`

let managerId = ''
let partnerId = ''
let projectId = ''

beforeEach(async () => {
  resetMocks()
  await prisma.dDTeamEvaluation.deleteMany({})
  await prisma.dDModuleResource.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'D4测试项目' } } })
  await prisma.user.deleteMany({ where: { email: { in: [MANAGER_EMAIL, PARTNER_EMAIL] } } })

  managerId = (await prisma.user.create({
    data: { email: MANAGER_EMAIL, name: '维护经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
  partnerId = (await prisma.user.create({
    data: { email: PARTNER_EMAIL, name: '合伙人', passwordHash: 'x', role: 'INVESTMENT_PARTNER', status: 'ACTIVE' },
  })).id

  projectId = (await prisma.project.create({
    data: {
      name: `D4测试项目${SUFFIX}`,
      totalAmount: '500万',
      targetDate: new Date(),
      followStage: 'DUE_DILIGENCE',
      createdById: managerId,
    },
  })).id
})

after(async () => {
  await prisma.dDTeamEvaluation.deleteMany({})
  await prisma.dDModuleResource.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'D4测试项目' } } })
  await prisma.user.deleteMany({ where: { email: { in: [MANAGER_EMAIL, PARTNER_EMAIL, `d4-out-${SUFFIX}@test.com`] } } })
  await prisma.$disconnect()
})

function asUser(id: string, role: string) {
  mockState.session = { user: { id, name: null, email: 'x@t.com', role } }
}
const asManager = () => asUser(managerId, 'INVESTMENT_MANAGER')

const evalUrl = () => `http://t/api/dd/team-evaluation/${projectId}`
const modUrl = (moduleKey: string) => `http://t/api/dd/resources/${projectId}/${moduleKey}`

/** 构造带评分的成员（对照 Excel 示例数据） */
function buildScoredData(): TeamEvaluationData {
  const ceoScores = [10, 10, 8, 8, 8, 8, 8, 8, 9, 7, 7, 8, 8] // CEO 13 维 → 合计 50.1
  const ctoScores = [8, 8, 7, 8, 8, 8, 8, 8, 7, 8]            // TECH 10 维 → 合计 15.5
  const teamScores = [8, 9, 7, 8]                               // TEAM 4 维 → 合计 15.4
  const mk = (tpl: typeof CEO_TEMPLATE, scores: number[], extra: Partial<TeamMember> = {}): TeamMember => ({
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    name: '张三',
    roleLabel: '实控人/CEO',
    profileType: 'CEO',
    ...extra,
    dimensions: tpl.map((d, i) => ({ ...d, score: scores[i] })),
  })
  return {
    members: [
      mk(CEO_TEMPLATE, ceoScores),
      mk(TECH_TEMPLATE, ctoScores, { id: 'm-cto', name: '李四', roleLabel: '联合创始人/CTO', profileType: 'TECH' }),
    ],
    team: TEAM_TEMPLATE.map((d, i) => ({ ...d, score: teamScores[i] })),
  }
}

/** mock 成员识别 AI */
function mockExtractionAI() {
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('识别核心团队成员')) {
      return chatCompletions(JSON.stringify({
        members: [
          { name: '张三', roleLabel: '实控人/CEO', profileType: 'CEO' },
          { name: '李四', roleLabel: '联合创始人/CTO', profileType: 'TECH' },
          { name: '王五', roleLabel: '联合创始人/CMO', profileType: 'OPS' },
          // 重复 CEO → 系统应降级为 OPS
          { name: '赵六', roleLabel: '董事', profileType: 'CEO' },
        ],
      }))
    }
    return chatCompletions('{}')
  }
}

/** 保存评价到 DB（直接 prisma，绕过 API） */
async function seedEvaluation(data: TeamEvaluationData, status: 'DRAFT' | 'CONFIRMED' = 'DRAFT') {
  await prisma.dDTeamEvaluation.upsert({
    where: { projectId },
    create: {
      projectId,
      membersJson: JSON.stringify(data.members),
      teamJson: JSON.stringify(data.team),
      status,
      ...(status === 'CONFIRMED' ? { finalScore: computeEvaluation(data).finalScore, confirmedAt: new Date() } : {}),
    },
    update: { status },
  })
}

// ── 模板与计算引擎（纯函数） ──

test('评价模板：四套模板二级权重合计均为 100%', () => {
  const sum = (tpl: typeof CEO_TEMPLATE) => tpl.reduce((a, d) => a + d.weight, 0)
  assert.ok(Math.abs(sum(CEO_TEMPLATE) - 1) < 1e-9)
  assert.ok(Math.abs(sum(TECH_TEMPLATE) - 1) < 1e-9)
  assert.ok(Math.abs(sum(OPS_TEMPLATE) - 1) < 1e-9)
  assert.ok(Math.abs(sum(TEAM_TEMPLATE) - 1) < 1e-9)
  assert.equal(CEO_TEMPLATE.length, 13)
  assert.equal(TECH_TEMPLATE.length, 10)
  assert.equal(OPS_TEMPLATE.length, 11)
  assert.equal(TEAM_TEMPLATE.length, 4)
})

test('计算引擎：对照 Excel 示例（CEO 50.1 + 高管 15.5 + 团队 15.4 → 最终 8.1）', () => {
  const data = buildScoredData()
  const result = computeEvaluation(data)
  assert.equal(result.ceoScore, 50.1)
  assert.equal(result.execScores[0].score, 15.5)
  assert.equal(result.execAvg, 15.5)
  assert.equal(result.teamScore, 15.4)
  assert.equal(result.finalScore, 8.1)
  assert.equal(result.allScored, true)
  // 颜色分级：>8 绿 / 7.5-8 黄 / 7-7.5 橙 / ≤7 红
  assert.equal(scoreColor(8.1), 'green')
  assert.equal(scoreColor(7.8), 'yellow')
  assert.equal(scoreColor(7.2), 'orange')
  assert.equal(scoreColor(6.9), 'red')
  // 校验：合法数据通过；权重不合计/越界/缺 CEO 报错
  assert.equal(validateEvaluation(data, true).ok, true)
  const badWeight = JSON.parse(JSON.stringify(data)) as TeamEvaluationData
  badWeight.members[0].dimensions[0].weight = 0.5
  assert.equal(validateEvaluation(badWeight, false).ok, false)
  const badScore = JSON.parse(JSON.stringify(data)) as TeamEvaluationData
  badScore.team[0].score = 11
  assert.equal(validateEvaluation(badScore, false).ok, false)
  const noCeo = JSON.parse(JSON.stringify(data)) as TeamEvaluationData
  noCeo.members[0].profileType = 'OPS'
  assert.equal(validateEvaluation(noCeo, false).ok, false)
})

// ── generate / 保存 / 确认（API） ──

test('生成评价表：无资料 400；有资料 + mock AI → 唯一 CEO 保证；已确认 409', async () => {
  asManager()

  // 模块无资料 → 400
  let res: Response = await EVAL_GENERATE(new Request(`${evalUrl()}/generate`, { method: 'POST' }), {
    params: { projectId },
  })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /团队与治理/)

  // 上传简历文本 → mock AI → 生成成功
  res = await TEXT_PUT(
    new Request(modUrl('TEAM_GOVERNANCE'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textBlocks: [{ content: '张三：实控人/CEO，曾任华为海思首席架构师。李四：联合创始人/CTO。王五：联合创始人/CMO。' }] }),
    }),
    { params: { projectId, moduleKey: 'TEAM_GOVERNANCE' } }
  )
  assert.equal(res.status, 200)

  mockExtractionAI()
  res = await EVAL_GENERATE(new Request(`${evalUrl()}/generate`, { method: 'POST' }), {
    params: { projectId },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.members.length, 4)
  assert.equal(body.members.filter((m: TeamMember) => m.profileType === 'CEO').length, 1)
  // 赵六（重复 CEO）被降级为 OPS
  const zhao = body.members.find((m: TeamMember) => m.name === '赵六')
  assert.equal(zhao.profileType, 'OPS')
  assert.equal(body.members[0].dimensions.length, 13)
  assert.equal(body.team.length, 4)
  // 生成的维度全部未评分
  assert.ok(body.members.every((m: TeamMember) => m.dimensions.every(d => d.score === null)))

  // GET 回显 DRAFT
  const got = await (await EVAL_GET(new Request(evalUrl()), { params: { projectId } })).json()
  assert.equal(got.evaluation.status, 'DRAFT')
  assert.equal(got.evaluation.members.length, 4)

  // 未登录 401 / 路人 403
  mockState.session = null
  res = await EVAL_GENERATE(new Request(`${evalUrl()}/generate`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 401)
})

test('保存与确认：权重校验 400；合法保存 200；确认计算最终分；重开编辑', async () => {
  asManager()
  const data = buildScoredData()

  // 权重合计 ≠ 100% → 400
  const bad = JSON.parse(JSON.stringify(data)) as TeamEvaluationData
  bad.members[0].dimensions[0].weight = 0.5
  let res: Response = await EVAL_PUT(
    new Request(evalUrl(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bad) }),
    { params: { projectId } }
  )
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /100%/)

  // 合法保存 → 200
  res = await EVAL_PUT(
    new Request(evalUrl(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    { params: { projectId } }
  )
  assert.equal(res.status, 200)

  // 确认（全部已评分）→ finalScore = 8.1
  res = await EVAL_CONFIRM(new Request(`${evalUrl()}/confirm`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 200)
  let body = await res.json()
  assert.equal(body.finalScore, 8.1)
  assert.equal(body.color, 'green')

  // 已确认状态：PUT 409、generate 409
  res = await EVAL_PUT(
    new Request(evalUrl(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    { params: { projectId } }
  )
  assert.equal(res.status, 409)
  res = await EVAL_GENERATE(new Request(`${evalUrl()}/generate`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 409)

  // 重开 → DRAFT
  res = await EVAL_CONFIRM(new Request(`${evalUrl()}/confirm`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).reopened, true)
  const got = await (await EVAL_GET(new Request(evalUrl()), { params: { projectId } })).json()
  assert.equal(got.evaluation.status, 'DRAFT')

  // 未评完（一个维度置空）→ 确认 400
  const partial = JSON.parse(JSON.stringify(data)) as TeamEvaluationData
  partial.team[0].score = null
  await EVAL_PUT(
    new Request(evalUrl(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(partial) }),
    { params: { projectId } }
  )
  res = await EVAL_CONFIRM(new Request(`${evalUrl()}/confirm`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /评分/)

  // 路人经理（非维护人/非合伙人）→ 403；合伙人可编辑（canEditResearchProject）
  const outsider = await prisma.user.create({
    data: { email: `d4-out-${SUFFIX}@test.com`, name: '路人经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })
  asUser(outsider.id, 'INVESTMENT_MANAGER')
  const otherProject = await prisma.project.create({
    data: { name: `D4测试项目B${SUFFIX}`, totalAmount: '300万', targetDate: new Date(), followStage: 'DUE_DILIGENCE', createdById: managerId },
  })
  res = await EVAL_PUT(
    new Request(`http://t/api/dd/team-evaluation/${otherProject.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    { params: { projectId: otherProject.id } }
  )
  assert.equal(res.status, 403)
  await prisma.project.delete({ where: { id: otherProject.id } })
})

// ── 报告门槛（V2.3.0：必须已生成并确认团队评价表才可生成尽调报告） ──

test('报告门槛：未生成评价/草稿 → 团队模块不完整（missing 提示）；确认后恢复', async () => {
  asManager()
  const data = buildScoredData()

  // 九模块全部填资料（含团队与治理）
  for (const m of DD_TEMPLATE_MODULES) {
    const res = await TEXT_PUT(
      new Request(modUrl(m.key), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textBlocks: [{ content: `${m.name}的资料内容。` }] }),
      }),
      { params: { projectId, moduleKey: m.key } }
    )
    assert.equal(res.status, 200)
  }

  // 无评价记录 → 同样阻塞（需生成并确认团队评价表）
  let body = await (await RES_GET(new Request(`http://t/api/dd/resources/${projectId}`), { params: { projectId } })).json()
  assert.equal(body.allComplete, false)
  let res: Response = await REPORT_POST(new Request(`http://t/api/dd/resources/${projectId}/report`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 400)
  body = await res.json()
  assert.ok(body.missing.some((n: string) => n.includes('团队与治理') && n.includes('团队评价表')), '未生成评价应提示需生成并确认团队评价表')

  // 生成评价（DRAFT）→ 团队与治理不完整
  await seedEvaluation(data, 'DRAFT')
  body = await (await RES_GET(new Request(`http://t/api/dd/resources/${projectId}`), { params: { projectId } })).json()
  assert.equal(body.allComplete, false)
  const teamMod = body.resources.find((r: { moduleKey: string }) => r.moduleKey === 'TEAM_GOVERNANCE')
  assert.equal(teamMod.teamEvaluationConfirmed, false)

  // 生成报告 → 400 + missing 提示"需确认团队评价表"
  res = await REPORT_POST(new Request(`http://t/api/dd/resources/${projectId}/report`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 400)
  body = await res.json()
  assert.ok(body.missing.some((n: string) => n.includes('团队与治理') && n.includes('团队评价表')))

  // 确认评价 → 恢复完整
  await prisma.dDTeamEvaluation.update({ where: { projectId }, data: { status: 'CONFIRMED', finalScore: 8.1, confirmedAt: new Date() } })
  body = await (await RES_GET(new Request(`http://t/api/dd/resources/${projectId}`), { params: { projectId } })).json()
  assert.equal(body.allComplete, true)
})

// ── AI 审评分（V2.3.0：确认后 Agent 校验打分与简历一致性） ──

/** mock 审评 AI */
function mockReviewAI(rating: number) {
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('团队评分复核')) {
      return chatCompletions(JSON.stringify({
        rating,
        analysis: '打分与简历描述基本一致，个别维度依据不足。',
        issues: ['张三·投入资金：简历未披露出资情况，打分依据不足'],
      }))
    }
    return chatCompletions('{}')
  }
}

test('AI 审评分：确认后自动复核入库（GET 返回）；重开清空；review 路由可重评；未确认 400', async () => {
  asManager()
  const data = buildScoredData()
  await seedEvaluation(data, 'DRAFT')
  mockReviewAI(8.5)

  // 确认 → 自动触发 AI 审评分
  let res: Response = await EVAL_CONFIRM(new Request(`${evalUrl()}/confirm`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 200)
  let body = await res.json()
  assert.equal(body.finalScore, 8.1)
  assert.ok(body.review, '确认响应应包含 AI 审评分')
  assert.equal(body.review.rating, 8.5)
  assert.ok(body.review.analysis.includes('一致'))

  // 落库 + GET 返回
  let record = await prisma.dDTeamEvaluation.findUnique({ where: { projectId } })
  assert.ok(record!.aiReviewJson!.includes('8.5'))
  let got = await (await EVAL_GET(new Request(evalUrl()), { params: { projectId } })).json()
  assert.equal(got.evaluation.aiReview.rating, 8.5)
  assert.equal(got.evaluation.aiReview.issues.length, 1)

  // review 路由重评（rating 更新）
  mockReviewAI(9.2)
  res = await REVIEW_POST(new Request(`${evalUrl()}/review`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).review.rating, 9.2)

  // 重开 → 审评清空 + review 400
  res = await EVAL_CONFIRM(new Request(`${evalUrl()}/confirm`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 200)
  record = await prisma.dDTeamEvaluation.findUnique({ where: { projectId } })
  assert.equal(record!.aiReviewJson, null, '重开应清空 AI 审评分')
  res = await REVIEW_POST(new Request(`${evalUrl()}/review`, { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 400)
})
