/**
 * P2.2/P2.3 测试：互联网知识补足与交叉校验（项目解读 + AI行研 + 知识沉淀库）
 *
 * knowledge-base lib：
 *   - saveVerifiedClaims：❓未证实不入库；✅/⚠️/❌ 入库；重复核验 hitCount+1
 *   - recallKnowledge：关键词召回；formatKnowledgeForPrompt 注入块
 * PI verify-claims API（P2.2）：
 *   - 401 / 404 非本人 / 400 未解读 / 200 核验落库 + 知识沉淀（SECTOR=行业）
 * PI 问题清单联动（P2.2）：
 *   - 夸大/矛盾声明注入生成 prompt；claimFlag 问题落库
 * AI行研 verify API + KB 召回（P2.3）：
 *   - 401 / 404 / 400 用户消息 / 200 核验落库 + 知识沉淀（ENTITY=公司主体）
 *   - runAIResearchChat：知识库召回注入 system prompt
 */

import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { resetMocks, mockState, chatCompletions, searchResult } from './helpers/setup'
import {
  saveVerifiedClaims,
  recallKnowledge,
  formatKnowledgeForPrompt,
} from '@/lib/knowledge-base'
import type { VerifiedClaim } from '@/lib/dd-workbench/claim-verifier'

import { POST as PI_VERIFY } from '@/app/api/project-interpretation/[id]/verify-claims/route'
import { POST as PI_QUESTIONS } from '@/app/api/project-interpretation/[id]/questions/route'
import { GET as PI_DETAIL } from '@/app/api/project-interpretation/[id]/route'
import { POST as AI_VERIFY } from '@/app/api/ai-research/messages/verify/route'
import { runAIResearchChat } from '@/lib/ai-research-runner'

const SUFFIX = String(Date.now()).slice(-6)
const USER_EMAIL = `iv-user-${SUFFIX}@test.com`
const OTHER_EMAIL = `iv-other-${SUFFIX}@test.com`

let userId = ''
let otherId = ''

beforeEach(async () => {
  resetMocks()
  await prisma.agentSkill.deleteMany({})
  await prisma.knowledgeEntry.deleteMany({})
  await prisma.aIChatMessage.deleteMany({})
  await prisma.aIChatSession.deleteMany({})
  await prisma.interpretationQuestion.deleteMany({})
  await prisma.projectInterpretation.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: [USER_EMAIL, OTHER_EMAIL] } } })

  userId = (await prisma.user.create({
    data: { email: USER_EMAIL, name: '校验用户', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
  otherId = (await prisma.user.create({
    data: { email: OTHER_EMAIL, name: '其他用户', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
})

after(async () => {
  await prisma.knowledgeEntry.deleteMany({})
  await prisma.aIChatMessage.deleteMany({})
  await prisma.aIChatSession.deleteMany({})
  await prisma.interpretationQuestion.deleteMany({})
  await prisma.projectInterpretation.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: [USER_EMAIL, OTHER_EMAIL] } } })
  await prisma.$disconnect()
})

function asUser(id: string, role = 'INVESTMENT_MANAGER') {
  mockState.session = { user: { id, name: null, email: 'x@t.com', role } }
}

/** 构造已核验声明（lib 单测用） */
function makeClaim(overrides: Partial<VerifiedClaim> & { claim: string }): VerifiedClaim {
  return {
    verdict: 'SUPPORTED',
    note: '证据支持',
    evidence: [{ title: '来源', url: 'https://x.example.com/a', snippet: '内容' }],
    entity: undefined,
    field: 'general',
    ...overrides,
  }
}

/** mock 声明提取 + 裁决两级 DeepSeek（通用 verifyTextClaims 分发） */
function mockVerifierAI(claims: Array<{ claim: string; queries: string[]; entity?: string; field?: string }>, verdicts: unknown[]) {
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('核验的事实性声明')) {
      return chatCompletions(JSON.stringify({ claims }))
    }
    if (system.includes('交叉比对')) {
      return chatCompletions(JSON.stringify({ verdicts }))
    }
    return chatCompletions('{}')
  }
}

// ── knowledge-base lib ──

test('lib：saveVerifiedClaims——未证实不入库，其余入库；重复核验 hitCount 递增', async () => {
  const claims = [
    makeClaim({ claim: '2024年人形机器人市场规模约27.6亿元', verdict: 'SUPPORTED', field: 'market' }),
    makeClaim({ claim: '声称良率95%但行业为85%', verdict: 'EXAGGERATED', field: 'technology' }),
    makeClaim({ claim: '未公开的营收数据', verdict: 'UNVERIFIED' }),
  ]
  const saved = await saveVerifiedClaims({
    claims,
    industry: '具身智能',
    sourceFeature: 'dd-claim-verify',
    sourceProjectName: '测试项目',
  })
  assert.equal(saved, 2) // UNVERIFIED 跳过

  const entries = await prisma.knowledgeEntry.findMany({ orderBy: { content: 'asc' } })
  assert.equal(entries.length, 2)
  assert.ok(entries.every(e => e.scope === 'SECTOR' && e.subject === '具身智能'))
  assert.ok(entries.some(e => e.verdict === 'EXAGGERATED'))
  assert.equal(entries.find(e => e.verdict === 'SUPPORTED')!.hitCount, 0)

  // 重复核验同一事实 → hitCount +1（幂等 upsert）
  await saveVerifiedClaims({ claims, industry: '具身智能', sourceFeature: 'dd-claim-verify' })
  const after = await prisma.knowledgeEntry.findMany({ where: { verdict: 'SUPPORTED' } })
  assert.equal(after[0].hitCount, 1)
})

test('lib：无行业时回落声明自身主体（ENTITY scope）；完全无主体跳过', async () => {
  const saved = await saveVerifiedClaims({
    claims: [
      makeClaim({ claim: '宇树科技C轮融资金额为数亿元', entity: '宇树科技', verdict: 'SUPPORTED' }),
      makeClaim({ claim: '某公司 undisclosed', verdict: 'SUPPORTED' }),
    ],
    industry: null,
    sourceFeature: 'ai-research',
  })
  assert.equal(saved, 1)
  const entry = await prisma.knowledgeEntry.findFirst()
  assert.equal(entry!.scope, 'ENTITY')
  assert.equal(entry!.subject, '宇树科技')
})

test('lib：recallKnowledge 关键词召回 + 注入块格式', async () => {
  await saveVerifiedClaims({
    claims: [makeClaim({ claim: '宇树科技2025年C轮融资约7亿元', entity: '宇树科技', verdict: 'SUPPORTED', field: 'finance' })],
    industry: null,
    sourceFeature: 'ai-research',
  })
  const recalled = await recallKnowledge('宇树科技 C轮融资多少')
  assert.equal(recalled.length, 1)
  assert.equal(recalled[0].subject, '宇树科技')

  const block = formatKnowledgeForPrompt(recalled)
  assert.match(block, /已核验知识库/)
  assert.match(block, /宇树科技2025年C轮融资约7亿元/)
})

// ── PI verify-claims API（P2.2） ──

/** 创建带解读结果的 PI 记录 */
async function seedInterpreted(status = 'INTERPRETED') {
  return prisma.projectInterpretation.create({
    data: {
      userId,
      projectName: '具身智能测试项目',
      fileName: 'bp.txt',
      fileUrl: '/api/uploads/interpretation-docs/x.txt',
      fileType: 'text/plain',
      fileSize: 100,
      documentText: '公司专注人形机器人，与华为签订战略合作，2025年营收1.2亿元，量产良率95%。',
      status,
      interpretationJson: JSON.stringify({
        projectName: '具身智能测试项目',
        industry: '具身智能',
        marketPosition: '细分赛道头部',
        techLeadership: '技术路线接近头部厂商',
        teamStanding: '团队来自清华',
        competitionAnalysis: '对标宇树科技',
        startupWindow: '窗口期约2年',
        marketEstimate: '商业化验证中',
        financingCases: [],
      }),
    },
  })
}

test('PI verify-claims：未登录 401；非本人 404；未解读 400', async () => {
  const record = await seedInterpreted()
  const url = `http://t/api/project-interpretation/${record.id}/verify-claims`

  mockState.session = null
  let res = await PI_VERIFY(new Request(url, { method: 'POST' }), { params: { id: record.id } })
  assert.equal(res.status, 401)

  asUser(otherId)
  res = await PI_VERIFY(new Request(url, { method: 'POST' }), { params: { id: record.id } })
  assert.equal(res.status, 404)

  // 无解读结果 → 400
  const bare = await prisma.projectInterpretation.create({
    data: {
      userId, projectName: 'x', fileName: 'x.txt', fileUrl: '/x', fileType: 'text/plain', fileSize: 1,
    },
  })
  asUser(userId)
  res = await PI_VERIFY(new Request(`http://t/api/project-interpretation/${bare.id}/verify-claims`, { method: 'POST' }), { params: { id: bare.id } })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /请先完成/)
})

test('PI verify-claims：200——核验落库 verificationJson + 知识沉淀（SECTOR=行业）', async () => {
  const record = await seedInterpreted()
  asUser(userId)
  mockVerifierAI(
    [
      { claim: '2025年营收1.2亿元', queries: ['公司 营收'], entity: '具身智能', field: 'business' },
      { claim: '量产良率95%', queries: ['行业 良率'], entity: '具身智能', field: 'technology' },
    ],
    [
      { claimIdx: 0, verdict: 'UNVERIFIED', note: '无公开数据', evidenceIdx: [] },
      { claimIdx: 1, verdict: 'EXAGGERATED', note: '行业平均85%', evidenceIdx: [1] },
    ]
  )
  mockState.searchResponses.set('公司 营收', [searchResult('营收报道', 'https://n.example.com/r', '营收数据')])
  mockState.searchResponses.set('行业 良率', [searchResult('良率分析', 'https://n.example.com/y', '行业平均良率85%')])

  const res = await PI_VERIFY(
    new Request(`http://t/api/project-interpretation/${record.id}/verify-claims`, { method: 'POST' }),
    { params: { id: record.id } }
  )
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.verification.claims.length, 2)
  assert.equal(body.verification.claims[1].verdict, 'EXAGGERATED')
  assert.ok(body.kbSaved >= 1)

  // 落库 + GET 详情返回
  const saved = await prisma.projectInterpretation.findUnique({ where: { id: record.id } })
  assert.ok(saved!.verificationJson!.includes('EXAGGERATED'))
  const detailRes = await PI_DETAIL(new Request(`http://t/api/project-interpretation/${record.id}`), { params: { id: record.id } })
  const detail = (await detailRes.json()).interpretation
  assert.ok(detail.verificationJson.includes('27.6') || detail.verificationJson.includes('EXAGGERATED'))

  // 知识沉淀：EXAGGERATED 入库（SECTOR=具身智能）；UNVERIFIED 不入库
  const kb = await prisma.knowledgeEntry.findMany()
  assert.equal(kb.length, 1)
  assert.equal(kb[0].scope, 'SECTOR')
  assert.equal(kb[0].subject, '具身智能')
  assert.equal(kb[0].verdict, 'EXAGGERATED')
  assert.equal(kb[0].sourceFeature, 'project-interpretation')
})

// ── PI 问题清单联动（P2.2） ──

test('PI questions：夸大声明注入生成 prompt；claimFlag 问题落库并排在最前', async () => {
  const record = await seedInterpreted()
  // 预置校验结果（1 条夸大）
  await prisma.projectInterpretation.update({
    where: { id: record.id },
    data: {
      verificationJson: JSON.stringify({
        claims: [
          { claim: '量产良率达95%', verdict: 'EXAGGERATED', note: '行业平均85%', evidence: [] },
          { claim: '营收数据', verdict: 'SUPPORTED', note: '一致', evidence: [] },
        ],
        summary: '共 2 条声明 · ⚠️ 夸大 1 · ✅ 一致 1',
        verifiedAt: new Date().toISOString(),
      }),
    },
  })

  asUser(userId)
  let questionsPrompt = ''
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('访谈必问问题')) {
      questionsPrompt = String((body.messages as Array<{ content: string }>)[1]?.content || '')
      const qs = [
        { category: 'TECH', question: 'Q良率：BP 称 95% 但行业 85%，请解释差异？', idealAnswer: '给出可验证的良率证明', isSectorInsight: false, claimFlag: true },
        { category: 'TECH', question: 'Q1', idealAnswer: 'A1', isSectorInsight: false, claimFlag: false },
      ]
      // 补足 15 问（技术 ≥10）
      for (let i = 2; i < 15; i++) {
        qs.push({ category: i < 12 ? 'TECH' : 'MARKET', question: `Q${i}`, idealAnswer: `A${i}`, isSectorInsight: false, claimFlag: false })
      }
      return chatCompletions(JSON.stringify({ questions: qs }))
    }
    return chatCompletions('{}')
  }

  const res = await PI_QUESTIONS(
    new Request(`http://t/api/project-interpretation/${record.id}/questions`, { method: 'POST' }),
    { params: { id: record.id } }
  )
  assert.equal(res.status, 200)

  // prompt 注入了夸大声明
  assert.match(questionsPrompt, /量产良率达95%/)
  assert.match(questionsPrompt, /优先质询/)

  // 落库：claimFlag 问题排最前
  const saved = await prisma.interpretationQuestion.findMany({
    where: { interpretationId: record.id },
    orderBy: { order: 'asc' },
  })
  assert.equal(saved.length, 15)
  assert.equal(saved[0].claimFlag, true)
  assert.match(saved[0].question, /良率/)
  assert.equal(saved.filter(q => q.claimFlag).length, 1)
})

// ── AI行研 verify API + KB 召回（P2.3） ──

/** 创建会话与一条 AI 回答 */
async function seedChatMessage() {
  const session = await prisma.aIChatSession.create({ data: { userId } })
  const userMsg = await prisma.aIChatMessage.create({ data: { sessionId: session.id, role: 'user', content: '宇树科技融资情况？' } })
  const aiMsg = await prisma.aIChatMessage.create({
    data: { sessionId: session.id, role: 'assistant', content: '宇树科技2025年完成【C轮10亿元】融资，估值【超百亿】。' },
  })
  return { session, userMsg, aiMsg }
}

test('AI verify：未登录 401；非本人 404；用户消息 400', async () => {
  const { session, userMsg, aiMsg } = await seedChatMessage()

  mockState.session = null
  let res = await AI_VERIFY(new Request('http://t/api/ai-research/messages/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: aiMsg.id }),
  }))
  assert.equal(res.status, 401)

  asUser(otherId)
  res = await AI_VERIFY(new Request('http://t/api/ai-research/messages/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: aiMsg.id }),
  }))
  assert.equal(res.status, 404)

  asUser(userId)
  res = await AI_VERIFY(new Request('http://t/api/ai-research/messages/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: userMsg.id }),
  }))
  assert.equal(res.status, 400)
  void session
})

test('AI verify：200——核验落库 + 知识沉淀（ENTITY=声明主体）', async () => {
  const { aiMsg } = await seedChatMessage()
  asUser(userId)
  mockVerifierAI(
    [{ claim: '宇树科技C轮10亿元融资', queries: ['宇树科技 C轮融资'], entity: '宇树科技', field: 'finance' }],
    [{ claimIdx: 0, verdict: 'EXAGGERATED', note: '实际约7亿元', evidenceIdx: [0] }]
  )
  mockState.searchResponses.set('宇树科技 C轮融资', [searchResult('宇树C轮', 'https://36.example.com/y', '宇树科技完成近7亿元C轮融资')])

  const res = await AI_VERIFY(new Request('http://t/api/ai-research/messages/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: aiMsg.id }),
  }))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.verification.claims[0].verdict, 'EXAGGERATED')
  assert.equal(body.kbSaved, 1)

  const saved = await prisma.aIChatMessage.findUnique({ where: { id: aiMsg.id } })
  assert.ok(saved!.verificationJson!.includes('EXAGGERATED'))

  const kb = await prisma.knowledgeEntry.findMany()
  assert.equal(kb.length, 1)
  assert.equal(kb[0].scope, 'ENTITY')
  assert.equal(kb[0].subject, '宇树科技')
  assert.equal(kb[0].sourceFeature, 'ai-research')
})

test('AI行研 runner：知识库召回注入 system prompt（已核验事实优先于一般联网信息）', async () => {
  // 预置知识库条目（内容含"宇树科技"，可被关键词召回）
  await saveVerifiedClaims({
    claims: [makeClaim({ claim: '宇树科技2025年C轮融资实际约7亿元（非10亿）', entity: '宇树科技', verdict: 'SUPPORTED', field: 'finance' })],
    industry: null,
    sourceFeature: 'ai-research',
  })

  const session = await prisma.aIChatSession.create({ data: { userId } })
  mockState.fetchHandler = () => chatCompletions('宇树科技C轮约7亿元，估值超百亿。')

  await runAIResearchChat('宇树科技 C轮融资多少', { sessionId: session.id, recentMessages: [] })

  // 首次 DeepSeek 调用的 system prompt 含知识库注入块
  const call = mockState.fetchCalls.find(c => c.url.includes('chat/completions'))
  assert.ok(call)
  const systemPrompt = String((call!.body.messages as Array<{ role: string; content: string }>)[0]?.content || '')
  assert.match(systemPrompt, /已核验知识库/)
  assert.match(systemPrompt, /宇树科技2025年C轮融资实际约7亿元/)
})
