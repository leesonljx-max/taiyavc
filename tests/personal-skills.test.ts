/**
 * P3.5 个人技能体系测试：功能页技能面板 + 个人化挂载
 *
 * lib（skill-registry / post-investment-tool）：
 *   - listMySkills/listColleagueSkills 可见性（我的 DRAFT+CONFIRMED；同事仅 CONFIRMED+启用）
 *   - generateUniqueKey 冲突自动后缀
 *   - forkSkill：复制为 DRAFT 副本 / 不能引用自己 / 非 CONFIRMED 不可引用
 *   - runDynamicSkill：DRAFT 仅本人可调试；工具按三勾选组装（联网/项目库/投后报告）
 *   - searchPostInvestmentInternal：LIKE 检索 + 每项目仅最近一期
 * 个人 API（/api/skills）：
 *   - GET 401 / 列表分桶；POST 创建默认 DRAFT；PATCH 他人 403 + 能力变更回 DRAFT；
 *     DELETE 他人 403；confirm 状态流转；fork 一键引用；run 调试权限
 * AI行研个人化挂载：
 *   - 本人 CONFIRMED 才挂载；他人 CONFIRMED 不挂载到我的会话
 */

import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { resetMocks, mockState, chatCompletions } from './helpers/setup'
import {
  listMySkills, listColleagueSkills, generateUniqueKey, forkSkill, runDynamicSkill,
} from '@/lib/skill-registry'
import { searchPostInvestmentInternal, formatPostInvestHits } from '@/lib/dd-harness/post-investment-tool'
import { runAIResearchChat } from '@/lib/ai-research-runner'

import { GET as MY_GET, POST as MY_POST, PATCH as MY_PATCH, DELETE as MY_DELETE } from '@/app/api/skills/route'
import { POST as CONFIRM_POST } from '@/app/api/skills/confirm/route'
import { POST as FORK_POST } from '@/app/api/skills/fork/route'
import { POST as RUN_POST } from '@/app/api/skills/run/route'

const SUFFIX = String(Date.now()).slice(-6)
const ALICE_EMAIL = `ps-alice-${SUFFIX}@test.com`
const BOB_EMAIL = `ps-bob-${SUFFIX}@test.com`

let aliceId = ''
let bobId = ''

const CONTENT = '你是一级市场资深投资人，专注融资窗口评估。基于输入分析行业融资热度与窗口剩余时长，输出结论。'

beforeEach(async () => {
  resetMocks()
  await prisma.aIChatMessage.deleteMany({})
  await prisma.aIChatSession.deleteMany({})
  await prisma.agentSkill.deleteMany({})
  await prisma.postInvestAnalysis.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'P35测试' } } })
  await prisma.user.deleteMany({ where: { email: { in: [ALICE_EMAIL, BOB_EMAIL] } } })

  aliceId = (await prisma.user.create({
    data: { email: ALICE_EMAIL, name: '技能作者', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
  bobId = (await prisma.user.create({
    data: { email: BOB_EMAIL, name: '引用同事', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
})

after(async () => {
  await prisma.aIChatMessage.deleteMany({})
  await prisma.aIChatSession.deleteMany({})
  await prisma.agentSkill.deleteMany({})
  await prisma.postInvestAnalysis.deleteMany({})
  await prisma.project.deleteMany({ where: { name: { startsWith: 'P35测试' } } })
  await prisma.user.deleteMany({ where: { email: { in: [ALICE_EMAIL, BOB_EMAIL] } } })
  await prisma.$disconnect()
})

function asUser(id: string, role: string) {
  mockState.session = { user: { id, name: null, email: 'x@t.com', role } }
}
const asAlice = () => asUser(aliceId, 'INVESTMENT_MANAGER')
const asBob = () => asUser(bobId, 'INVESTMENT_MANAGER')

async function seedSkill(overrides: Record<string, unknown> = {}) {
  return prisma.agentSkill.create({
    data: {
      key: 'alice-skill', name: '融资窗口评估', description: '评估融资时间窗口',
      category: 'analysis', content: CONTENT,
      useSearch: false, useProjectLibrary: false, usePostInvestment: false,
      type: 'DYNAMIC', status: 'CONFIRMED', createdById: aliceId,
      ...overrides,
    },
  })
}

const apiUrl = 'http://t/api/skills'
const json = (payload: unknown) => JSON.stringify(payload)
const req = (method: string, url: string, payload?: unknown) =>
  new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : json(payload) })

// ── lib：可见性 ──

test('lib：listMySkills——本人 DRAFT+CONFIRMED 都可见；listColleagueSkills——他人仅 CONFIRMED+启用可见', async () => {
  await seedSkill() // alice CONFIRMED
  await seedSkill({ key: 'alice-draft', status: 'DRAFT' })
  await seedSkill({ key: 'alice-paused', status: 'CONFIRMED', isActive: false })

  const mine = await listMySkills(aliceId)
  assert.equal(mine.length, 3)
  assert.ok(mine.some(s => s.status === 'DRAFT' && s.key === 'alice-draft'))

  const forBob = await listColleagueSkills(bobId)
  assert.equal(forBob.length, 1)
  assert.equal(forBob[0].key, 'alice-skill')
  assert.equal(forBob[0].creatorName, '技能作者')

  // 本人视角看不到自己出现在"同事技能"里
  const forAlice = await listColleagueSkills(aliceId)
  assert.equal(forAlice.length, 0)
})

test('lib：generateUniqueKey——冲突自动后缀 key-2', async () => {
  await seedSkill()
  assert.equal(await generateUniqueKey('fresh-key'), 'fresh-key')
  assert.equal(await generateUniqueKey('alice-skill'), 'alice-skill-2')
})

test('lib：forkSkill——复制为本人 DRAFT 副本并记录溯源；不能引用自己；非 CONFIRMED 不可引用', async () => {
  await seedSkill()
  const forked = await forkSkill('alice-skill', bobId)
  assert.equal(forked.key, 'alice-skill-2')
  assert.equal(forked.status, 'DRAFT')
  assert.equal(forked.createdById === bobId, true)
  assert.equal(forked.forkedFromKey, 'alice-skill')
  assert.equal(forked.content, CONTENT)

  await assert.rejects(() => forkSkill('alice-skill', aliceId), /不能引用自己/)

  await seedSkill({ key: 'alice-draft2', status: 'DRAFT' })
  await assert.rejects(() => forkSkill('alice-draft2', bobId), /不可引用/)
})

// ── lib：执行权限与工具组装 ──

test('lib：runDynamicSkill——DRAFT 仅本人可调试（同事执行报"尚在调试中"）', async () => {
  await seedSkill({ key: 'draft-skill', status: 'DRAFT' })
  mockState.fetchHandler = () => chatCompletions('调试输出')

  // 本人可调试
  const result = await runDynamicSkill('draft-skill', '测试输入', aliceId)
  assert.match(result.content, /调试输出/)

  // 同事（未传 userId）不可
  await assert.rejects(() => runDynamicSkill('draft-skill', '测试输入'), /尚在调试中/)
  // 其他账号不可
  await assert.rejects(() => runDynamicSkill('draft-skill', '测试输入', bobId), /尚在调试中/)
})

test('lib：runDynamicSkill——三勾选工具组装（项目库/投后报告/联网）', async () => {
  await seedSkill({ key: 'cap-skill', useSearch: true, useProjectLibrary: true, usePostInvestment: true })
  let agentTools: string[] = []
  mockState.fetchHandler = (_url, body) => {
    if (Array.isArray(body.tools)) {
      agentTools = (body.tools as Array<{ function: { name: string } }>).map(t => t.function.name)
    }
    return chatCompletions('组合分析结论')
  }
  const result = await runDynamicSkill('cap-skill', '分析光枢科技', aliceId)
  assert.match(result.content, /组合分析结论/)
  assert.deepEqual(agentTools.sort(), ['search_post_investment', 'search_projects', 'web_search'])
})

test('lib：runDynamicSkill——仅勾选项目库时只挂 search_projects', async () => {
  await seedSkill({ key: 'proj-skill', useProjectLibrary: true })
  let agentTools: string[] = []
  mockState.fetchHandler = (_url, body) => {
    if (Array.isArray(body.tools)) {
      agentTools = (body.tools as Array<{ function: { name: string } }>).map(t => t.function.name)
    }
    return chatCompletions('项目库结论')
  }
  await runDynamicSkill('proj-skill', '查项目', aliceId)
  assert.deepEqual(agentTools, ['search_projects'])
})

// ── lib：投后分析检索工具 ──

test('lib：searchPostInvestmentInternal——LIKE 检索 + 每项目仅最近一期 + 格式化', async () => {
  const proj = await prisma.project.create({
    data: { name: 'P35测试项目光枢', totalAmount: '500万', targetDate: new Date(), followStage: 'POST_INVESTMENT', createdById: aliceId, industry: '具身智能' },
  })
  const summary = {
    executive_summary: '收入增长明显但现金流为负',
    cashflow_analysis: { cash_balance: '11700 万元', runway_months: 13.2, assessment: '现金可覆盖约13个月' },
    anomalies: [{ level: 'medium', title: '收入与现金流背离', detail: '收入+52%，现金流-2666万元' }],
    risk_alerts: [{ type: '现金流', level: 'medium', description: '经营现金流为负' }],
  }
  await prisma.postInvestAnalysis.create({ data: { projectId: proj.id, period: '2026Q2', summaryJson: JSON.stringify(summary) } })
  await prisma.postInvestAnalysis.create({ data: { projectId: proj.id, period: '2026Q3', summaryJson: JSON.stringify({ executive_summary: 'Q3 最新结论' }) } })

  // 按项目名检索 → 只返回最新一期（Q3）
  const hits = await searchPostInvestmentInternal(['光枢'], 5)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].period, '2026Q3')
  assert.equal(hits[0].executiveSummary, 'Q3 最新结论')

  // 按行业检索也能命中
  const byIndustry = await searchPostInvestmentInternal(['具身智能'], 5)
  assert.equal(byIndustry.length, 1)

  // 无关词不命中
  assert.equal((await searchPostInvestmentInternal(['可控核聚变'])).length, 0)

  // 格式化包含关键字段
  const text = formatPostInvestHits(hits)
  assert.match(text, /P35测试项目光枢/)
  assert.match(text, /2026Q3/)
  assert.match(text, /Q3 最新结论/)
})

// ── 个人 API ──

test('API：GET /api/skills——401 未登录；返回我的+同事两桶', async () => {
  mockState.session = null
  let res = await MY_GET()
  assert.equal(res.status, 401)

  asBob()
  await seedSkill() // alice 的 CONFIRMED
  await seedSkill({ key: 'bob-skill', status: 'CONFIRMED', createdById: bobId })

  res = await MY_GET()
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.mySkills.length, 1)
  assert.equal(body.mySkills[0].key, 'bob-skill')
  assert.equal(body.colleagueSkills.length, 1)
  assert.equal(body.colleagueSkills[0].key, 'alice-skill')
})

test('API：POST /api/skills——创建默认 DRAFT；校验沿用注册表口径', async () => {
  asAlice()
  let res = await MY_POST(req('POST', apiUrl, { key: 'bad_key!', name: 'x', description: 'd', content: CONTENT }))
  assert.equal(res.status, 400)

  res = await MY_POST(req('POST', apiUrl, {
    key: 'my-new-skill', name: '我的技能', description: '说明何时该用',
    content: CONTENT, useProjectLibrary: true,
  }))
  assert.equal(res.status, 201)
  const row = await prisma.agentSkill.findUnique({ where: { key: 'my-new-skill' } })
  assert.equal(row!.status, 'DRAFT')
  assert.equal(row!.useProjectLibrary, true)
  assert.equal(row!.createdById, aliceId)
})

test('API：PATCH——他人技能 403；能力变更 CONFIRMED→DRAFT；仅改名称不重置', async () => {
  asBob()
  await seedSkill() // alice CONFIRMED
  let res = await MY_PATCH(req('PATCH', apiUrl, { key: 'alice-skill', name: '改名' }))
  assert.equal(res.status, 403)

  asAlice()
  // 仅改名：状态保持 CONFIRMED
  res = await MY_PATCH(req('PATCH', apiUrl, { key: 'alice-skill', name: '融资窗口评估 v2' }))
  assert.equal(res.status, 200)
  let row = await prisma.agentSkill.findUnique({ where: { key: 'alice-skill' } })
  assert.equal(row!.name, '融资窗口评估 v2')
  assert.equal(row!.status, 'CONFIRMED')

  // 改提示词：回到 DRAFT
  res = await MY_PATCH(req('PATCH', apiUrl, { key: 'alice-skill', content: CONTENT + '\n补充：关注政策变化。' }))
  assert.equal(res.status, 200)
  row = await prisma.agentSkill.findUnique({ where: { key: 'alice-skill' } })
  assert.equal(row!.status, 'DRAFT')
})

test('API：DELETE——他人技能 403；本人技能删除成功', async () => {
  asBob()
  await seedSkill()
  let res = await MY_DELETE(new Request(`${apiUrl}?key=alice-skill`, { method: 'DELETE' }))
  assert.equal(res.status, 403)

  asAlice()
  res = await MY_DELETE(new Request(`${apiUrl}?key=alice-skill`, { method: 'DELETE' }))
  assert.equal(res.status, 200)
  assert.equal(await prisma.agentSkill.count({ where: { key: 'alice-skill' } }), 0)
})

test('API：confirm——本人 DRAFT→CONFIRMED；他人 403；重复确认 400；短内容 400', async () => {
  await seedSkill({ key: 'to-confirm', status: 'DRAFT', createdById: aliceId })
  await seedSkill({ key: 'short-draft', status: 'DRAFT', createdById: aliceId, content: '太短' })

  asBob()
  let res = await CONFIRM_POST(req('POST', `${apiUrl}/confirm`, { key: 'to-confirm' }))
  assert.equal(res.status, 403)

  asAlice()
  res = await CONFIRM_POST(req('POST', `${apiUrl}/confirm`, { key: 'short-draft' }))
  assert.equal(res.status, 400)

  res = await CONFIRM_POST(req('POST', `${apiUrl}/confirm`, { key: 'to-confirm' }))
  assert.equal(res.status, 200)
  let row = await prisma.agentSkill.findUnique({ where: { key: 'to-confirm' } })
  assert.equal(row!.status, 'CONFIRMED')

  // 重复确认
  res = await CONFIRM_POST(req('POST', `${apiUrl}/confirm`, { key: 'to-confirm' }))
  assert.equal(res.status, 400)
})

test('API：fork——一键引用同事 CONFIRMED 技能为 DRAFT 副本', async () => {
  asBob()
  let res = await FORK_POST(req('POST', `${apiUrl}/fork`, { key: 'not-exist' }))
  assert.equal(res.status, 400)

  await seedSkill() // alice CONFIRMED
  res = await FORK_POST(req('POST', `${apiUrl}/fork`, { key: 'alice-skill' }))
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.skill.key, 'alice-skill-2')
  assert.equal(body.skill.status, 'DRAFT')

  // fork 后出现在 bob 的"我的技能"里
  const mine = await listMySkills(bobId)
  assert.equal(mine.length, 1)
  assert.equal(mine[0].forkedFromKey, 'alice-skill')
})

test('API：run——本人 DRAFT 可调试；他人 DRAFT 400；CONFIRMED 同事可执行', async () => {
  mockState.fetchHandler = () => chatCompletions('运行结果')
  await seedSkill({ key: 'alice-draft', status: 'DRAFT' })

  asAlice()
  let res = await RUN_POST(req('POST', `${apiUrl}/run`, { key: 'alice-draft', input: '调试输入' }))
  assert.equal(res.status, 200)
  assert.match((await res.json()).content, /运行结果/)

  asBob()
  res = await RUN_POST(req('POST', `${apiUrl}/run`, { key: 'alice-draft', input: '调试输入' }))
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /尚在调试中/)

  // CONFIRMED 技能同事（挂载场景）可执行
  await seedSkill({ key: 'alice-confirmed' })
  res = await RUN_POST(req('POST', `${apiUrl}/run`, { key: 'alice-confirmed', input: '分析输入' }))
  assert.equal(res.status, 200)
})

// ── AI行研个人化挂载 ──

test('AI行研：只挂载本人 CONFIRMED 技能——他人技能不出现在我的 run_skill 列表', async () => {
  await seedSkill() // alice 的 CONFIRMED（非 bob）
  const bobSession = await prisma.aIChatSession.create({ data: { userId: bobId } })

  let systemPrompt = ''
  mockState.fetchHandler = (_url, body) => {
    if (Array.isArray(body.tools)) {
      systemPrompt = String((body.messages as Array<{ role: string; content: string | null }>)[0]?.content || '')
    }
    return chatCompletions('普通回答')
  }
  await runAIResearchChat('普通问题', { sessionId: bobSession.id, userId: bobId, recentMessages: [] })
  // bob 无本人技能 → 不注入技能块
  assert.ok(!systemPrompt.includes('可用专业分析技能'))

  // bob fork + 确认后挂载
  await forkSkill('alice-skill', bobId)
  await prisma.agentSkill.update({ where: { key: 'alice-skill-2' }, data: { status: 'CONFIRMED' } })

  let agentTools: string[] = []
  mockState.fetchHandler = (_url, body) => {
    if (Array.isArray(body.tools)) {
      agentTools = (body.tools as Array<{ function: { name: string } }>).map(t => t.function.name)
      systemPrompt = String((body.messages as Array<{ role: string; content: string | null }>)[0]?.content || '')
    }
    return chatCompletions('回答')
  }
  await runAIResearchChat('再次提问', { sessionId: bobSession.id, userId: bobId, recentMessages: [] })
  assert.ok(agentTools.includes('run_skill'))
  assert.match(systemPrompt, /alice-skill-2/)
})
