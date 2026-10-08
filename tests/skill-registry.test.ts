/**
 * P3 技能层测试：AgentSkill 注册表 + 管理接口 + AI行研 run_skill 集成
 *
 * lib（skill-registry）：
 *   - listSkills：内置目录（未运行时零统计）+ 动态技能合并
 *   - recordSkillRun：内置技能惰性建行 + runCount 递增
 *   - runDynamicSkill：提示词作为 system prompt 执行（单次调用 / 联网 Agent 两路）；停用/内置/空内容报错
 * 管理 API（/api/admin/skills）：
 *   - GET 401/403/200；POST 校验（key 格式/占用内置/重复/短内容）与创建；
 *     PATCH 内置不可编辑 + 动态更新/启停；DELETE 内置不可删 + 动态删除；run 试运行
 * AI行研集成：
 *   - 存在激活动态技能时注入 run_skill 工具与技能列表；Agent 调用 run_skill → 技能执行 → 统计递增
 */

import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { resetMocks, mockState, chatCompletions } from './helpers/setup'
import {
  BUILTIN_SKILLS,
  listSkills,
  recordSkillRun,
  runDynamicSkill,
  listActiveDynamicSkills,
} from '@/lib/skill-registry'
import { runAIResearchChat } from '@/lib/ai-research-runner'

import { GET as SKILLS_GET, POST as SKILLS_POST, PATCH as SKILLS_PATCH, DELETE as SKILLS_DELETE } from '@/app/api/admin/skills/route'
import { POST as SKILL_RUN } from '@/app/api/admin/skills/run/route'

const SUFFIX = String(Date.now()).slice(-6)
const ADMIN_EMAIL = `sk-admin-${SUFFIX}@test.com`
const MANAGER_EMAIL = `sk-mgr-${SUFFIX}@test.com`

let adminId = ''
let managerId = ''

const TEST_SKILL = {
  key: 'fin-window-check',
  name: '融资时间窗口评估',
  description: '评估某行业/项目的融资时间窗口剩余时长与进入时点建议',
  category: 'analysis',
  content: '你是一级市场资深投资人，专注融资时间窗口评估。基于输入分析：\n1. 行业融资热度\n2. 窗口剩余时长\n输出结论。',
  useSearch: false,
}

beforeEach(async () => {
  resetMocks()
  await prisma.agentSkill.deleteMany({})
  await prisma.aIChatMessage.deleteMany({})
  await prisma.aIChatSession.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, MANAGER_EMAIL] } } })

  adminId = (await prisma.user.create({
    data: { email: ADMIN_EMAIL, name: '管理员', passwordHash: 'x', role: 'ADMIN', status: 'ACTIVE' },
  })).id
  managerId = (await prisma.user.create({
    data: { email: MANAGER_EMAIL, name: '经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
})

after(async () => {
  await prisma.agentSkill.deleteMany({})
  await prisma.aIChatMessage.deleteMany({})
  await prisma.aIChatSession.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, MANAGER_EMAIL] } } })
  await prisma.$disconnect()
})

function asUser(id: string, role: string) {
  mockState.session = { user: { id, name: null, email: 'x@t.com', role } }
}
const asAdmin = () => asUser(adminId, 'ADMIN')
const asManager = () => asUser(managerId, 'INVESTMENT_MANAGER')

async function seedSkill(overrides: Record<string, unknown> = {}) {
  // P3.5 起 DYNAMIC 技能默认 DRAFT；旧用例语义为"可直接执行"→ 默认 CONFIRMED
  return prisma.agentSkill.create({ data: { ...TEST_SKILL, type: 'DYNAMIC', status: 'CONFIRMED', createdById: adminId, ...overrides } })
}

// ── lib ──

test('lib：listSkills——内置目录全量可见（零统计）+ 动态技能合并', async () => {
  await seedSkill()
  const skills = await listSkills()
  const builtin = skills.filter(s => s.type === 'BUILTIN')
  const dynamic = skills.filter(s => s.type === 'DYNAMIC')
  assert.equal(builtin.length, BUILTIN_SKILLS.length)
  assert.ok(builtin.every(s => s.runCount === 0 && s.isActive === true && s.id === null))
  assert.equal(dynamic.length, 1)
  assert.equal(dynamic[0].key, TEST_SKILL.key)
  assert.equal(dynamic[0].content, TEST_SKILL.content)
})

test('lib：recordSkillRun——内置技能惰性建行并递增；listSkills 合并统计', async () => {
  await recordSkillRun('claim-verifier')
  await recordSkillRun('claim-verifier')
  const row = await prisma.agentSkill.findUnique({ where: { key: 'claim-verifier' } })
  assert.equal(row!.type, 'BUILTIN')
  assert.equal(row!.runCount, 2)
  assert.ok(row!.lastRunAt)

  const skills = await listSkills()
  const cv = skills.find(s => s.key === 'claim-verifier')!
  assert.equal(cv.type, 'BUILTIN')
  assert.equal(cv.runCount, 2)
  assert.ok(cv.id) // 统计行已并入视图
})

test('lib：runDynamicSkill——无联网走单次调用，技能内容作为 system prompt', async () => {
  await seedSkill()
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    assert.equal(system, TEST_SKILL.content)
    return chatCompletions('窗口剩余约18个月')
  }
  const result = await runDynamicSkill(TEST_SKILL.key, '评估具身智能行业')
  assert.match(result.content, /18个月/)

  const row = await prisma.agentSkill.findUnique({ where: { key: TEST_SKILL.key } })
  assert.equal(row!.runCount, 1)
})

test('lib：runDynamicSkill——联网技能走 Harness Agent（带 web_search 工具）', async () => {
  await seedSkill({ key: 'web-skill', useSearch: true })
  let agentTools: string[] = []
  mockState.fetchHandler = (url, body) => {
    if (Array.isArray(body.tools)) {
      agentTools = (body.tools as Array<{ function: { name: string } }>).map(t => t.function.name)
    }
    return chatCompletions('联网分析结论')
  }
  const result = await runDynamicSkill('web-skill', '检索最新行业数据')
  assert.match(result.content, /联网分析结论/)
  assert.ok(agentTools.includes('web_search'))
})

test('lib：runDynamicSkill——停用/内置/不存在/空内容/空输入报错', async () => {
  await seedSkill()
  await seedSkill({ key: 'paused-skill', isActive: false })
  await seedSkill({ key: 'empty-skill', content: '太短' })
  await prisma.agentSkill.create({
    data: { key: 'claim-verifier', name: '声明校验', description: 'd', type: 'BUILTIN', category: 'verification' },
  })

  await assert.rejects(() => runDynamicSkill('paused-skill', 'x'), /已停用/)
  await assert.rejects(() => runDynamicSkill('claim-verifier', 'x'), /内置技能/)
  await assert.rejects(() => runDynamicSkill('not-exist', 'x'), /不存在/)
  await assert.rejects(() => runDynamicSkill('empty-skill', 'x'), /提示词内容为空/)
  await assert.rejects(() => runDynamicSkill(TEST_SKILL.key, '  '), /输入不能为空/)
})

// ── 管理 API ──

const skillsUrl = 'http://t/api/admin/skills'

test('API：GET 401 未登录 / 403 非管理员 / 200 管理员返回清单', async () => {
  mockState.session = null
  let res = await SKILLS_GET()
  assert.equal(res.status, 401)

  asManager()
  res = await SKILLS_GET()
  assert.equal(res.status, 403)

  asAdmin()
  res = await SKILLS_GET()
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.skills.filter((s: { type: string }) => s.type === 'BUILTIN').length, BUILTIN_SKILLS.length)
})

test('API：POST——key 格式/占用内置/重复/短内容 400；合法创建 201', async () => {
  asAdmin()
  const post = (payload: Record<string, unknown>) =>
    SKILLS_POST(new Request(skillsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), )

  let res = await post({ key: 'Bad_Key!', name: 'x', description: 'd', content: 'c'.repeat(30) })
  assert.equal(res.status, 400)

  res = await post({ key: 'claim-verifier', name: 'x', description: 'd', content: 'c'.repeat(30) })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /内置技能/)

  await seedSkill()
  res = await post({ key: TEST_SKILL.key, name: 'x', description: 'd', content: 'c'.repeat(30) })
  assert.equal(res.status, 400)

  res = await post({ key: 'short-content', name: 'x', description: 'd', content: '短' })
  assert.equal(res.status, 400)

  res = await post({ key: 'valid-skill', name: '有效技能', description: '测试技能能力说明', content: '这是一个用于测试的技能提示词，长度满足要求。' })
  assert.equal(res.status, 201)
  const row = await prisma.agentSkill.findUnique({ where: { key: 'valid-skill' } })
  assert.equal(row!.type, 'DYNAMIC')
  assert.equal(row!.createdById, adminId)
})

test('API：PATCH——内置 400；动态更新与启停生效；DELETE 内置 400、动态成功', async () => {
  asAdmin()
  await recordSkillRun('claim-verifier') // 惰性创建内置统计行
  await seedSkill()

  const patch = (payload: Record<string, unknown>) =>
    SKILLS_PATCH(new Request(skillsUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))

  let res = await patch({ key: 'claim-verifier', name: '改名' })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /内置技能不可编辑/)

  res = await patch({ key: TEST_SKILL.key, name: '融资窗口评估（v2）', useSearch: true })
  assert.equal(res.status, 200)
  let row = await prisma.agentSkill.findUnique({ where: { key: TEST_SKILL.key } })
  assert.equal(row!.name, '融资窗口评估（v2）')
  assert.equal(row!.useSearch, true)

  res = await patch({ key: TEST_SKILL.key, isActive: false })
  assert.equal(res.status, 200)
  row = await prisma.agentSkill.findUnique({ where: { key: TEST_SKILL.key } })
  assert.equal(row!.isActive, false)
  assert.equal((await listActiveDynamicSkills()).length, 0)

  res = await SKILLS_DELETE(new Request(`${skillsUrl}?key=claim-verifier`, { method: 'DELETE' }))
  assert.equal(res.status, 400)

  res = await SKILLS_DELETE(new Request(`${skillsUrl}?key=${TEST_SKILL.key}`, { method: 'DELETE' }))
  assert.equal(res.status, 200)
  assert.equal(await prisma.agentSkill.count({ where: { key: TEST_SKILL.key } }), 0)
})

test('API：run 试运行——执行动态技能并计入统计；非管理员 403', async () => {
  asManager()
  let res = await SKILL_RUN(new Request('http://t/api/admin/skills/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: TEST_SKILL.key, input: 'x' }),
  }))
  assert.equal(res.status, 403)

  asAdmin()
  await seedSkill()
  mockState.fetchHandler = () => chatCompletions('技能分析结果：窗口充足')
  res = await SKILL_RUN(new Request('http://t/api/admin/skills/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: TEST_SKILL.key, input: '评估具身智能' }),
  }))
  assert.equal(res.status, 200)
  assert.match((await res.json()).content, /窗口充足/)
  const row = await prisma.agentSkill.findUnique({ where: { key: TEST_SKILL.key } })
  assert.equal(row!.runCount, 1)
})

// ── AI行研 run_skill 集成 ──

test('AI行研：本人 CONFIRMED 技能注入 run_skill 工具；Agent 调用技能并统计', async () => {
  await seedSkill({ createdById: managerId })
  const session = await prisma.aIChatSession.create({ data: { userId: managerId } })

  // 三段分发：① Agent 首轮（带 run_skill 工具）返回 tool_calls → ② 技能执行（runSingleCall）→ ③ Agent 次轮输出最终回答
  let firstAgentCall: Record<string, unknown> | null = null
  mockState.fetchHandler = (url, body) => {
    const messages = body.messages as Array<{ role: string; content: string | null }>
    const system = String(messages[0]?.content || '')
    const hasTools = Array.isArray(body.tools)
    if (hasTools && !firstAgentCall) {
      firstAgentCall = body
      return {
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: { name: 'run_skill', arguments: JSON.stringify({ skill_key: TEST_SKILL.key, input: '评估具身智能行业' }) },
            }],
          },
        }],
      }
    }
    if (system === TEST_SKILL.content) {
      return chatCompletions('【技能分析】具身智能融资窗口剩余约18个月，建议加快尽调。')
    }
    return chatCompletions('根据专业技能分析：融资窗口剩余约18个月。')
  }

  const result = await runAIResearchChat('帮我评估具身智能的融资窗口', { sessionId: session.id, userId: managerId, recentMessages: [] })

  // system prompt 注入了技能列表
  const agentTools = (firstAgentCall!.tools as Array<{ function: { name: string } }>).map(t => t.function.name)
  assert.ok(agentTools.includes('run_skill'))
  const systemPrompt = String((firstAgentCall!.messages as Array<{ role: string; content: string | null }>)[0]?.content || '')
  assert.match(systemPrompt, /可用专业分析技能/)
  assert.match(systemPrompt, new RegExp(TEST_SKILL.key))

  // Agent 最终回答融合了技能结果
  assert.match(result.content, /18个月/)

  // 技能使用统计递增
  const row = await prisma.agentSkill.findUnique({ where: { key: TEST_SKILL.key } })
  assert.equal(row!.runCount, 1)
})

test('AI行研：无激活动态技能时不注入 run_skill 工具', async () => {
  const session = await prisma.aIChatSession.create({ data: { userId: managerId } })
  let tools: string[] = []
  mockState.fetchHandler = (url, body) => {
    if (Array.isArray(body.tools)) tools = (body.tools as Array<{ function: { name: string } }>).map(t => t.function.name)
    return chatCompletions('普通回答')
  }
  await runAIResearchChat('普通问题', { sessionId: session.id, userId: managerId, recentMessages: [] })
  assert.ok(!tools.includes('run_skill'))
  assert.ok(tools.includes('web_search'))
})
