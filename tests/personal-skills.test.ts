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
  buildUserSkillPromptBlock, listActiveDynamicSkills,
} from '@/lib/skill-registry'
import { searchPostInvestmentInternal, formatPostInvestHits } from '@/lib/dd-harness/post-investment-tool'
import { runAIResearchChat } from '@/lib/ai-research-runner'

import { GET as MY_GET, POST as MY_POST, PATCH as MY_PATCH, DELETE as MY_DELETE } from '@/app/api/skills/route'
import { POST as CONFIRM_POST } from '@/app/api/skills/confirm/route'
import { POST as FORK_POST } from '@/app/api/skills/fork/route'
import { POST as RUN_POST } from '@/app/api/skills/run/route'
import { POST as PI_INTERPRET } from '@/app/api/project-interpretation/[id]/interpret/route'
import { POST as PI_QUESTIONS } from '@/app/api/project-interpretation/[id]/questions/route'

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
  await prisma.interpretationQuestion.deleteMany({})
  await prisma.projectInterpretation.deleteMany({})
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
  await prisma.interpretationQuestion.deleteMany({})
  await prisma.projectInterpretation.deleteMany({})
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
  // 显式错开 createdAt（同一毫秒创建会让「最近一期」排序不稳定）
  await prisma.postInvestAnalysis.create({ data: { projectId: proj.id, period: '2026Q2', summaryJson: JSON.stringify(summary), createdAt: new Date(Date.now() - 60_000) } })
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

test('API：GET /api/skills——401 未登录；返回我的+同事两桶（无 scene 兼容全量视图）', async () => {
  mockState.session = null
  let res = await MY_GET(new Request('http://t/api/skills'))
  assert.equal(res.status, 401)

  asBob()
  await seedSkill() // alice 的 CONFIRMED
  await seedSkill({ key: 'bob-skill', status: 'CONFIRMED', createdById: bobId })

  res = await MY_GET(new Request('http://t/api/skills'))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.mySkills.length, 1)
  assert.equal(body.mySkills[0].key, 'bob-skill')
  assert.equal(body.colleagueSkills.length, 1)
  assert.equal(body.colleagueSkills[0].key, 'alice-skill')
  assert.equal(body.librarySkills.length, 0) // 无 scene 时不分桶（兼容视图）
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

// ── P3.6：页面 AI 功能挂载（技能为所在页面的 AI 功能服务） ──

test('P3.6：buildUserSkillPromptBlock——无 userId/无技能返回空串；CONFIRMED 注入且含冲突声明与格式护栏；DRAFT/停用不注入', async () => {
  // 无 userId（cron 等无用户场景）→ 空串，完全走固定框架
  assert.equal(await buildUserSkillPromptBlock(undefined), '')

  // 用户无技能 → 空串
  assert.equal(await buildUserSkillPromptBlock(aliceId), '')

  await seedSkill() // alice CONFIRMED
  await seedSkill({ key: 'alice-draft', status: 'DRAFT' }) // DRAFT 不注入
  await seedSkill({ key: 'alice-paused', status: 'CONFIRMED', isActive: false }) // 停用不注入

  const block = await buildUserSkillPromptBlock(aliceId)
  assert.ok(block.length > 0)
  assert.match(block, /用户自定义分析技能/)
  assert.match(block, /融入该模块/) // 模块化路由：相似技能融入固定框架模块
  assert.match(block, /单独产出一个分析模块/) // 模块化路由：独立领域技能单列
  assert.match(block, /以用户技能为准/) // 冲突优先级声明
  assert.match(block, /输出格式必须严格遵守/) // 格式护栏
  assert.match(block, /融资窗口评估/) // 技能名
  assert.match(block, /窗口剩余时长/) // 技能内容
  assert.ok(!block.includes('alice-draft'))

  // 他人技能不注入（bob 视角为空）
  assert.equal(await buildUserSkillPromptBlock(bobId), '')
})

test('P3.6：项目解读——挂载技能后解读 system prompt 注入技能块；无技能时为纯固定框架', async () => {
  const record = await prisma.projectInterpretation.create({
    data: {
      userId: aliceId,
      projectName: 'P35测试项目解读',
      fileName: 'bp.txt',
      fileUrl: '/api/uploads/interpretation-docs/x.txt',
      fileType: 'text/plain',
      fileSize: 100,
      documentText: '硅光计算芯片项目，核心团队来自清华，已获云厂商POC订单，拟融资2亿元。',
    },
  })
  const interpretJson = JSON.stringify({
    projectName: 'P35测试项目解读', industry: '半导体芯片',
    marketPosition: '早期卡位', techLeadership: '硅光路线', teamStanding: '清华系',
    competitionAnalysis: '起步晚', startupWindow: '窗口2-3年', marketEstimate: 'POC为主',
  })

  let interpretSystem = ''
  mockState.fetchHandler = (_url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('结构化 JSON 解读')) {
      interpretSystem = system
      return chatCompletions(interpretJson)
    }
    if (system.includes('搜索关键词')) {
      return chatCompletions(JSON.stringify({ queries: [{ text: '硅光计算 融资', lang: 'zh' }] }))
    }
    if (system.includes('融资案例')) {
      return chatCompletions(JSON.stringify({ cases: [] }))
    }
    return chatCompletions('{}')
  }

  // 1) 无技能：system prompt 为纯固定框架（不含技能块）；skillModules 清洗为空数组
  asAlice()
  let res = await PI_INTERPRET(new Request(`http://t/api/project-interpretation/${record.id}/interpret`, { method: 'POST' }), { params: { id: record.id } })
  assert.equal(res.status, 200)
  assert.ok(interpretSystem.includes('结构化 JSON 解读'))
  assert.ok(!interpretSystem.includes('用户自定义分析技能'))
  const saved1 = await prisma.projectInterpretation.findUnique({ where: { id: record.id } })
  const interp1 = JSON.parse(saved1!.interpretationJson!) as { appliedSkills?: string[]; skillModules?: unknown[] }
  assert.deepEqual(interp1.appliedSkills, [])
  assert.deepEqual(interp1.skillModules, [])

  // 2) 挂载 CONFIRMED 技能：解读 system prompt 注入技能块（模块化路由 + 冲突时以用户技能为准）
  await seedSkill()
  const record2 = await prisma.projectInterpretation.create({
    data: {
      userId: aliceId,
      projectName: 'P35测试项目解读2',
      fileName: 'bp.txt',
      fileUrl: '/api/uploads/interpretation-docs/y.txt',
      fileType: 'text/plain',
      fileSize: 100,
      documentText: '光互连芯片项目，A轮，订单增长中。',
    },
  })
  // 挂载技能后的解读响应：含技能独立模块（视角超出七维框架时单列）
  const interpretJsonWithSkills = JSON.stringify({
    projectName: 'P35测试项目解读2', industry: '半导体芯片',
    marketPosition: '早期卡位', techLeadership: '硅光路线', teamStanding: '清华系',
    competitionAnalysis: '起步晚', startupWindow: '窗口2-3年', marketEstimate: 'POC为主',
    skillModules: [
      { skillName: '融资窗口评估', title: '光互连赛道融资窗口', content: '1. 当前窗口剩余约 **12 个月**\n2. 头部机构已密集布局' },
    ],
  })
  mockState.fetchHandler = (_url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('结构化 JSON 解读')) {
      interpretSystem = system
      return chatCompletions(interpretJsonWithSkills)
    }
    if (system.includes('搜索关键词')) {
      return chatCompletions(JSON.stringify({ queries: [{ text: '光互连 融资', lang: 'zh' }] }))
    }
    if (system.includes('融资案例')) {
      return chatCompletions(JSON.stringify({ cases: [] }))
    }
    return chatCompletions('{}')
  }
  res = await PI_INTERPRET(new Request(`http://t/api/project-interpretation/${record2.id}/interpret`, { method: 'POST' }), { params: { id: record2.id } })
  assert.equal(res.status, 200)
  assert.ok(interpretSystem.includes('结构化 JSON 解读'))
  assert.ok(interpretSystem.includes('用户自定义分析技能'))
  assert.match(interpretSystem, /单独产出一个分析模块/) // 模块化路由规则注入
  assert.match(interpretSystem, /skillModules/) // 输出结构含技能独立模块字段
  assert.match(interpretSystem, /以用户技能为准/)
  assert.match(interpretSystem, /融资窗口评估/)

  // 3) appliedSkills 可见性 + skillModules 独立模块持久化（随 interpretationJson 落库）
  const saved2 = await prisma.projectInterpretation.findUnique({ where: { id: record2.id } })
  const interp2 = JSON.parse(saved2!.interpretationJson!) as {
    appliedSkills?: string[]
    skillModules?: Array<{ skillName: string; title: string; content: string }>
  }
  assert.deepEqual(interp2.appliedSkills, ['融资窗口评估'])
  assert.equal(interp2.skillModules!.length, 1)
  assert.equal(interp2.skillModules![0].skillName, '融资窗口评估')
  assert.ok(interp2.skillModules![0].content.includes('**12 个月**'))
})

test('P3.6 可见性：问题清单生成注入本人技能并返回 appliedSkills；无技能时为空数组', async () => {
  // 16 问（11 技术 + 5 其他）mock
  const questionsJson = JSON.stringify({
    questions: [
      ...Array.from({ length: 11 }, (_, i) => ({ category: 'TECH', question: `技术问题${i + 1}`, idealAnswer: `理想答案${i + 1}`, isSectorInsight: false, claimFlag: false })),
      { category: 'MARKET', question: '市场问题1', idealAnswer: '理想：市场规模', isSectorInsight: false, claimFlag: false },
      { category: 'TEAM', question: '团队问题1', idealAnswer: '理想：团队背景', isSectorInsight: false, claimFlag: false },
      { category: 'BUSINESS', question: '业务问题1', idealAnswer: '理想：订单', isSectorInsight: false, claimFlag: false },
      { category: 'BUSINESS', question: '业务问题2', idealAnswer: '理想：复购', isSectorInsight: false, claimFlag: false },
      { category: 'FINANCE', question: '财务问题1', idealAnswer: '理想：现金流', isSectorInsight: false, claimFlag: false },
    ],
  })

  let questionsSystem = ''
  mockState.fetchHandler = (_url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('访谈必问问题清单')) {
      questionsSystem = system
      return chatCompletions(questionsJson)
    }
    return chatCompletions('{}')
  }

  const record = await prisma.projectInterpretation.create({
    data: {
      userId: aliceId,
      projectName: 'P35测试问题清单',
      fileName: 'bp.txt',
      fileUrl: '/api/uploads/interpretation-docs/z.txt',
      fileType: 'text/plain',
      fileSize: 100,
      documentText: '硅光计算芯片项目，核心团队来自清华。',
      verifyStatus: 'DONE', conclusionJson: '{}',
    },
  })

  // 1) 无技能：不注入，appliedSkills 为空数组
  asAlice()
  let res = await PI_QUESTIONS(new Request(`http://t/api/project-interpretation/${record.id}/questions`, { method: 'POST' }), { params: { id: record.id } })
  assert.equal(res.status, 200)
  let body = await res.json()
  assert.deepEqual(body.appliedSkills, [])
  assert.ok(questionsSystem.includes('访谈必问问题清单'))
  assert.ok(!questionsSystem.includes('用户自定义分析技能'))

  // 2) 挂载技能：system prompt 注入 + 返回应用技能名
  await seedSkill()
  res = await PI_QUESTIONS(new Request(`http://t/api/project-interpretation/${record.id}/questions`, { method: 'POST' }), { params: { id: record.id } })
  assert.equal(res.status, 200)
  body = await res.json()
  assert.deepEqual(body.appliedSkills, ['融资窗口评估'])
  assert.ok(questionsSystem.includes('用户自定义分析技能'))
  assert.match(questionsSystem, /以用户技能为准/)
})

// ── 场景化技能体系（每页一套独立技能设定） ──

test('场景化：buildUserSkillPromptBlock/listActiveDynamicSkills 按场景过滤——他场景技能不注入；scenes 空=存量全场景兼容', async () => {
  await seedSkill() // scenes=[]（存量）→ 全场景兼容
  await seedSkill({ key: 'ai-only', name: '行研专属技能', scenes: ['ai-research'] })
  await seedSkill({ key: 'pi-only', name: '解读专属技能', scenes: ['project-interpretation'] })

  // 项目解读场景：存量（全场景）+ 解读专属注入；行研专属不注入
  const piBlock = await buildUserSkillPromptBlock(aliceId, 'project-interpretation')
  assert.match(piBlock, /融资窗口评估/) // 存量空 scenes → 全场景
  assert.match(piBlock, /解读专属技能/)
  assert.ok(!piBlock.includes('行研专属技能'))

  // AI行研场景：存量 + 行研专属注入；解读专属不注入
  const aiBlock = await buildUserSkillPromptBlock(aliceId, 'ai-research')
  assert.match(aiBlock, /融资窗口评估/)
  assert.match(aiBlock, /行研专属技能/)
  assert.ok(!aiBlock.includes('解读专属技能'))

  // 无场景维度（全量）：全部注入
  const allBlock = await buildUserSkillPromptBlock(aliceId)
  assert.match(allBlock, /行研专属技能/)
  assert.match(allBlock, /解读专属技能/)

  // listActiveDynamicSkills 同口径场景过滤（run_skill 挂载用）
  const aiSkills = await listActiveDynamicSkills(aliceId, 'ai-research')
  assert.ok(aiSkills.some(s => s.name === '行研专属技能'))
  assert.ok(!aiSkills.some(s => s.name === '解读专属技能'))
})

test('场景化：API GET ?scene= 三桶分桶 + POST scenes 数组 + PATCH scenes 更新不重置状态 + fork 场景', async () => {
  await seedSkill() // scenes=[] 存量（全场景）→ 任何场景都在 mySkills 桶
  await seedSkill({ key: 'dd-only', name: '尽调专属技能', scenes: ['dd-workbench'] })
  await seedSkill({ key: 'alice-draft', status: 'DRAFT', scenes: ['dd-workbench'] }) // DRAFT 不进同事桶

  asAlice()
  // GET 三桶（dd-workbench 场景）：mySkills=存量+尽调专属+DRAFT；library=无（都在本场景）；colleagues=[]
  let res = await MY_GET(new Request('http://t/api/skills?scene=dd-workbench'))
  assert.equal(res.status, 200)
  let body = await res.json()
  assert.equal(body.mySkills.length, 3) // 存量（全场景）+ dd-only + alice-draft
  assert.ok(body.mySkills.some((s: { key: string }) => s.key === 'alice-skill'))
  assert.equal(body.librarySkills.length, 0)
  assert.equal(body.colleagueSkills.length, 0)

  // GET 三桶（ai-research 场景）：library 含尽调专属（可跨场景启用）
  res = await MY_GET(new Request('http://t/api/skills?scene=ai-research'))
  body = await res.json()
  assert.ok(body.mySkills.some((s: { key: string }) => s.key === 'alice-skill')) // 存量全场景
  assert.ok(!body.mySkills.some((s: { key: string }) => s.key === 'dd-only'))
  assert.ok(body.librarySkills.some((s: { key: string }) => s.key === 'dd-only'))
  assert.ok(!body.librarySkills.some((s: { key: string }) => s.key === 'alice-skill')) // 存量不进 library

  // POST scenes 数组：创建时多场景适用
  res = await MY_POST(req('POST', 'http://t/api/skills', {
    key: 'multi-scene', name: '跨场景技能', description: '多场景适用', category: 'analysis',
    content: '跨场景技能的提示词内容，超过二十个字以通过校验。',
    useSearch: false, useProjectLibrary: false, usePostInvestment: false,
    scenes: ['ai-research', 'post-investment'],
  }))
  assert.equal(res.status, 201)
  assert.deepEqual((await res.json()).skill.scenes, ['ai-research', 'post-investment'])

  // POST 非法场景：被白名单过滤为空数组（全场景兼容），不报错
  res = await MY_POST(req('POST', 'http://t/api/skills', {
    key: 'bad-scene', name: '坏场景', description: 'x'.repeat(30), category: 'general',
    content: '这是一个内容长度超过二十个字的提示词内容，用于通过校验。',
    scenes: ['not-a-scene'],
  }))
  assert.equal(res.status, 201)
  assert.deepEqual((await res.json()).skill.scenes, [])

  // PATCH scenes 更新：跨场景启用（scenes 追加）且 CONFIRMED 不回 DRAFT
  await prisma.agentSkill.update({ where: { key: 'dd-only' }, data: { status: 'CONFIRMED' } })
  res = await MY_PATCH(req('PATCH', 'http://t/api/skills', { key: 'dd-only', scenes: ['dd-workbench', 'ai-research'] }))
  assert.equal(res.status, 200)
  const patched = (await res.json()).skill as { scenes: string[]; status: string }
  assert.deepEqual(patched.scenes, ['dd-workbench', 'ai-research'])
  assert.equal(patched.status, 'CONFIRMED') // 场景调整不重置状态

  // 同事视角（bob）：ai-research 场景下可见 alice 挂载的 CONFIRMED 技能（存量 + dd-only 跨场景启用后）
  asBob()
  res = await MY_GET(new Request('http://t/api/skills?scene=ai-research'))
  body = await res.json()
  const colleagueKeys = (body.colleagueSkills as Array<{ key: string }>).map(s => s.key)
  assert.ok(colleagueKeys.includes('alice-skill')) // 存量全场景
  assert.ok(colleagueKeys.includes('dd-only')) // 启用 ai-research 后同事在本场景可见
  assert.ok(!colleagueKeys.includes('alice-draft')) // DRAFT 不进同事桶

  // fork 传场景：副本挂载该场景
  res = await FORK_POST(req('POST', 'http://t/api/skills/fork', { key: 'dd-only', scene: 'ai-research' }))
  assert.equal(res.status, 201)
  assert.deepEqual((await res.json()).skill.scenes, ['ai-research'])
})

test('场景化：项目解读只注入「项目解读」场景技能（挂载点场景隔离）', async () => {
  // 行研专属技能（CONFIRMED）不应影响项目解读
  await seedSkill({ key: 'ai-only-2', name: '行研专属技能2', scenes: ['ai-research'] })
  const record = await prisma.projectInterpretation.create({
    data: {
      userId: aliceId,
      projectName: 'P35场景隔离解读',
      fileName: 'bp.txt',
      fileUrl: '/api/uploads/interpretation-docs/s.txt',
      fileType: 'text/plain',
      fileSize: 100,
      documentText: '某项目BP内容。',
    },
  })

  let interpretSystem = ''
  mockState.fetchHandler = (_url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('结构化 JSON 解读')) {
      interpretSystem = system
      return chatCompletions(JSON.stringify({
        projectName: 'P35场景隔离解读', industry: 'AI应用',
        marketPosition: 'x', techLeadership: 'x', teamStanding: 'x',
        competitionAnalysis: 'x', startupWindow: 'x', marketEstimate: 'x',
      }))
    }
    return chatCompletions('{}')
  }

  asAlice()
  const res = await PI_INTERPRET(new Request(`http://t/api/project-interpretation/${record.id}/interpret`, { method: 'POST' }), { params: { id: record.id } })
  assert.equal(res.status, 200)
  // 行研专属技能不注入项目解读
  assert.ok(!interpretSystem.includes('行研专属技能2'))
  assert.ok(!interpretSystem.includes('用户自定义分析技能'))
  // appliedSkills 亦为空
  const saved = await prisma.projectInterpretation.findUnique({ where: { id: record.id } })
  const interp = JSON.parse(saved!.interpretationJson!) as { appliedSkills?: string[] }
  assert.deepEqual(interp.appliedSkills, [])
})
