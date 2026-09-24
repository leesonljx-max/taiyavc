/**
 * P2/P3 测试：项目解读引擎四阶段 API
 * POST /api/project-interpretation/[id]/interpret   解读项目（七维 + 融资案例搜索）
 * POST /api/project-interpretation/[id]/questions   生成问题清单（与解读解耦：可直接生成）
 * POST /api/project-interpretation/[id]/verify      批量访谈校验（一次上传 → 全部结果 → 自动结论）
 * POST /api/project-interpretation/[id]/conclusion  综合结论（≥3 题被访谈覆盖）
 */

import './helpers/setup'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { POST as INTERPRET } from '@/app/api/project-interpretation/[id]/interpret/route'
import { POST as QUESTIONS } from '@/app/api/project-interpretation/[id]/questions/route'
import { POST as VERIFY } from '@/app/api/project-interpretation/[id]/verify/route'
import { POST as CONCLUSION } from '@/app/api/project-interpretation/[id]/conclusion/route'
import { resetMocks, mockState, chatCompletions } from './helpers/setup'

const USER_EMAIL = 'pi2-user@test.com'

let userId: string
let recordId: string

const DOC_TEXT = '光子计算芯片项目。核心团队来自清华，产品为硅光计算加速芯片，已获云厂商POC订单，拟融资2亿元。'

beforeEach(async () => {
  resetMocks()
  await prisma.interpretationQuestion.deleteMany({})
  await prisma.projectInterpretation.deleteMany({})
  await prisma.user.deleteMany({ where: { email: USER_EMAIL } })
  userId = (await prisma.user.create({
    data: { email: USER_EMAIL, name: '引擎用户', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id

  const record = await prisma.projectInterpretation.create({
    data: {
      userId,
      projectName: '光子芯片',
      fileName: 'bp.txt',
      fileUrl: '/api/uploads/interpretation-docs/x.txt',
      fileType: 'text/plain',
      fileSize: 100,
      documentText: DOC_TEXT,
    },
  })
  recordId = record.id

  // DeepSeek mock：按系统提示词内容分发不同阶段的响应
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    const interpretJson = JSON.stringify({
      projectName: '光子芯片',
      industry: '半导体芯片',
      marketPosition: '硅光计算细分赛道早期卡位，尚未形成规模收入',
      techLeadership: '技术路线为硅光混合计算，有流片经验，第三方验证不足',
      teamStanding: '清华系团队，行业知名度中等',
      competitionAnalysis: '与 Lightmatter 等相比起步晚，差异化在互联架构',
      startupWindow: '光子计算商用窗口预计 2-3 年内开启，时间敏感',
      marketEstimate: 'POC 订单为主，客户 logo 含两家云厂商，验证程度早期',
    })
    if (system.includes('结构化 JSON 解读')) return chatCompletions(interpretJson)
    // 智能搜索关键词生成（项目定位/产品/技术驱动，中英文各组检索国内外案例）
    if (system.includes('搜索关键词')) {
      return chatCompletions(
        JSON.stringify({
          queries: [
            { text: '硅光计算芯片 创业公司 融资', lang: 'zh' },
            { text: '光子计算 赛道 投资轮次', lang: 'zh' },
            { text: 'silicon photonics compute startup funding', lang: 'en' },
            { text: 'photonic computing venture round', lang: 'en' },
          ],
        })
      )
    }
    if (system.includes('融资案例')) {
      return chatCompletions(
        JSON.stringify({
          cases: [
            { company: '光擎科技', round: 'A轮', amount: '2亿元', date: '2025-06', investors: '红杉', brief: '光互连芯片 来源:https://x.com/1', relevance: '同为硅光计算路线，均瞄准云厂商AI算力' },
            { company: 'Lightmatter', round: 'Series D', amount: '$400M', date: '2025-03', investors: 'GV', brief: '美国光子计算芯片商 来源:https://x.com/2', relevance: '国外对标：同为光子计算加速芯片，产品形态高度重合' },
          ],
        })
      )
    }
    if (system.includes('访谈必问问题')) {
      // 16 问：11 技术 + 5 其他
      const qs = [
        ...Array.from({ length: 11 }, (_, i) => ({ category: 'TECH', question: `技术问题${i + 1}：芯片具体指标？`, idealAnswer: `理想答案：给出量化指标${i + 1}` })),
        { category: 'MARKET', question: '市场问题1', idealAnswer: '理想：市场规模' },
        { category: 'TEAM', question: '团队问题1', idealAnswer: '理想：团队背景' },
        { category: 'BUSINESS', question: '业务问题1', idealAnswer: '理想：订单' },
        { category: 'BUSINESS', question: '业务问题2', idealAnswer: '理想：复购' },
        { category: 'FINANCE', question: '财务问题1', idealAnswer: '理想：现金流' },
      ]
      return chatCompletions(JSON.stringify({ questions: qs }))
    }
    if (system.includes('闭环校验')) {
      // 批量校验：对全部问题返回按 index 对齐的结果（题1 GAP / 题2 HIGH / 题3 UNCOVERED / 其余 PARTIAL）
      return chatCompletions(
        JSON.stringify({
          results: [
            { index: 1, matchLevel: 'GAP', answerSummary: '对方回答含糊', gapAnalysis: '未给出量化指标，回避了工艺良率问题', conclusion: '对方技术壁垒表述与理想答案差距较大，技术壁垒不高' },
            { index: 2, matchLevel: 'HIGH', answerSummary: '给出完整指标', gapAnalysis: '回答覆盖理想答案核心要点', conclusion: '回答与理想答案吻合，指标可信' },
            { index: 3, matchLevel: 'UNCOVERED', answerSummary: '', gapAnalysis: '访谈纪要未涉及该问题', conclusion: '访谈未覆盖此问题，建议下次访谈补充提问' },
            { index: 4, matchLevel: 'PARTIAL', answerSummary: '部分回答', gapAnalysis: '关键细节缺失', conclusion: '回答部分覆盖，需追问' },
          ],
        })
      )
    }
    if (system.includes('综合分析结论')) {
      return chatCompletions(
        JSON.stringify({
          summary: '整体回答质量偏低，多处回避量化细节',
          dimensions: [{ aspect: '技术壁垒', gapLevel: 'GAP', conclusion: '技术壁垒不高' }],
          advice: '建议补充第三方技术尽调',
        })
      )
    }
    return chatCompletions('{}')
  }

  // 搜索 mock：两条行业融资新闻
  mockState.searchDefault = [
    { title: '光计算赛道融资盘点', url: 'https://x.com/1', content: '光擎科技完成2亿元A轮融资' },
    { title: '光子计算投资升温', url: 'https://x.com/2', content: '曦智科技完成5亿元B轮融资' },
  ]
})

function asUser() {
  mockState.session = { user: { id: userId, name: null, email: 'x@t.com', role: 'INVESTMENT_MANAGER' } }
}

async function callPost(url: string, init?: RequestInit, params?: { id: string }) {
  const res = await fetch(url, { method: 'POST', ...init }) // 仅占位说明：实际走路由直调
  return res
}
void callPost

const post = (url: string, init?: RequestInit) => new Request(url, { method: 'POST', ...init })

// ── 解读项目 ──

test('interpret：七维解读 + 智能融资案例搜索 → INTERPRETED', async () => {
  asUser()
  const res = await INTERPRET(post(`http://t/api/project-interpretation/${recordId}/interpret`), { params: { id: recordId } })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.interpretation.industry, '半导体芯片')
  assert.equal(body.interpretation.financingCases.length, 2)
  assert.equal(body.interpretation.financingCases[0].company, '光擎科技')
  // 重合度说明（relevance）保留：智能匹配的核心输出
  assert.ok(body.interpretation.financingCases[1].relevance.includes('国外对标'))

  const record = await prisma.projectInterpretation.findUnique({ where: { id: recordId } })
  assert.equal(record!.status, 'INTERPRETED')
  const stored = JSON.parse(record!.interpretationJson!)
  assert.ok(stored.marketPosition.includes('硅光'))
  assert.ok(stored.marketEstimate.includes('客户'))

  // 智能搜索：模型基于项目画像生成的中英文关键词被用于双源搜索（英文组覆盖国外案例）
  const queries = mockState.searchCalls.map(c => c.query)
  assert.ok(queries.includes('硅光计算芯片 创业公司 融资'))
  assert.ok(queries.includes('silicon photonics compute startup funding'))
  assert.equal(mockState.searchCalls.length, 4)
  // 不再用大行业名泛搜
  assert.ok(queries.every(q => !q.startsWith('半导体芯片 融资')))
})

test('interpret：AI 结果不完整 → 502 且状态 FAILED；重复执行可恢复', async () => {
  asUser()
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('结构化 JSON 解读')) return chatCompletions(JSON.stringify({ industry: '只有行业' }))
    return chatCompletions('{}')
  }
  const fail = await INTERPRET(post(`http://t/api/project-interpretation/${recordId}/interpret`), { params: { id: recordId } })
  assert.equal(fail.status, 502)
  const record = await prisma.projectInterpretation.findUnique({ where: { id: recordId } })
  assert.equal(record!.status, 'FAILED')
  assert.ok(record!.error)

  // 恢复默认 handler 后重试成功
  beforeEach // no-op 提示：直接改回完整 handler
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('结构化 JSON 解读'))
      return chatCompletions(JSON.stringify({ projectName: '光子芯片', industry: '半导体芯片', marketPosition: 'ok', techLeadership: 'ok', teamStanding: 'ok', competitionAnalysis: 'ok', startupWindow: 'ok', marketEstimate: 'ok' }))
    return chatCompletions('[]')
  }
  const retry = await INTERPRET(post(`http://t/api/project-interpretation/${recordId}/interpret`), { params: { id: recordId } })
  assert.equal(retry.status, 200)
  assert.equal((await prisma.projectInterpretation.findUnique({ where: { id: recordId } }))!.status, 'INTERPRETED')
})

// ── 问题清单 ──

async function seedInterpreted() {
  await prisma.projectInterpretation.update({
    where: { id: recordId },
    data: {
      status: 'INTERPRETED',
      interpretationJson: JSON.stringify({
        projectName: '光子芯片', industry: '半导体芯片', marketPosition: 'x', techLeadership: 'x',
        teamStanding: 'x', competitionAnalysis: 'x', startupWindow: 'x', marketEstimate: 'x', financingCases: [],
      }),
    },
  })
}

test('questions：与解读解耦——未解读可直接生成；生成后 READY（16 问、TECH 11、覆盖旧清单并重置校验态）', async () => {
  asUser()
  // 不 seedInterpreted：直接从 UPLOADED 生成问题清单（解耦验证）
  const before = await QUESTIONS(post(`http://t/api/project-interpretation/${recordId}/questions`), { params: { id: recordId } })
  assert.equal(before.status, 200)
  assert.equal((await before.json()).questions.length, 16)

  // 造一条旧问题 + 旧校验状态，验证重新生成时全部重置
  await prisma.interpretationQuestion.create({
    data: { interpretationId: recordId, order: 99, category: 'TECH', question: '旧问题', idealAnswer: '旧答案', verifyStatus: 'VERIFIED', verifyResultJson: '{}' },
  })
  await prisma.projectInterpretation.update({
    where: { id: recordId },
    data: { verifyStatus: 'DONE', interviewFileName: '旧访谈.txt', interviewText: '旧内容' },
  })

  const res = await QUESTIONS(post(`http://t/api/project-interpretation/${recordId}/questions`), { params: { id: recordId } })
  assert.equal(res.status, 200)
  const { questions } = await res.json()
  assert.equal(questions.length, 16)
  assert.equal(questions.filter((q: { category: string }) => q.category === 'TECH').length, 11)
  assert.equal(questions[0].order, 1)
  assert.equal(questions[0].idealAnswer.length > 0, true)

  // 旧问题清除、校验状态/结论重置；访谈纪要保留（原始材料不随清单重建失效）
  const record = await prisma.projectInterpretation.findUnique({
    where: { id: recordId },
    include: { questions: true },
  })
  assert.equal(record!.questionsStatus, 'READY')
  assert.ok(!record!.questions.some(q => q.question === '旧问题'))
  assert.equal(record!.conclusionJson, null)
  assert.equal(record!.verifyStatus, 'PENDING')
  assert.equal(record!.interviewFileName, '旧访谈.txt')
  assert.equal(record!.interviewText, '旧内容')

  // 解读之后再生成：补充上下文路径同样可用（interpretation 可选增强）
  await seedInterpreted()
  const again = await QUESTIONS(post(`http://t/api/project-interpretation/${recordId}/questions`), { params: { id: recordId } })
  assert.equal(again.status, 200)
})

test('questions：数量不足 / 技术问题不足 → 502 + FAILED', async () => {
  asUser()
  await seedInterpreted()

  // 数量不足（12 问）
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('访谈必问问题')) {
      return chatCompletions(JSON.stringify({
        questions: Array.from({ length: 12 }, (_, i) => ({ category: 'TECH', question: `Q${i}`, idealAnswer: `A${i}` })),
      }))
    }
    return chatCompletions('{}')
  }
  let res = await QUESTIONS(post(`http://t/api/project-interpretation/${recordId}/questions`), { params: { id: recordId } })
  assert.equal(res.status, 502)
  assert.match((await res.json()).error, /问题数量不足/)

  // 技术问题不足（15 问但 TECH 仅 5）
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('访谈必问问题')) {
      const qs = [
        ...Array.from({ length: 5 }, (_, i) => ({ category: 'TECH', question: `TQ${i}`, idealAnswer: `A${i}` })),
        ...Array.from({ length: 10 }, (_, i) => ({ category: 'MARKET', question: `MQ${i}`, idealAnswer: `A${i}` })),
      ]
      return chatCompletions(JSON.stringify({ questions: qs }))
    }
    return chatCompletions('{}')
  }
  res = await QUESTIONS(post(`http://t/api/project-interpretation/${recordId}/questions`), { params: { id: recordId } })
  assert.equal(res.status, 502)
  assert.match((await res.json()).error, /技术问题不足/)
  assert.equal((await prisma.projectInterpretation.findUnique({ where: { id: recordId } }))!.questionsStatus, 'FAILED')
})

// ── 批量访谈校验（一次上传 → 全部结果 → 自动结论） ──

async function seedQuestions() {
  await seedInterpreted()
  await prisma.projectInterpretation.update({ where: { id: recordId }, data: { questionsStatus: 'READY' } })
  // 4 个问题（order 1-4）：批量校验 mock 对 1/2/3/4 分别返回 GAP/HIGH/UNCOVERED/PARTIAL
  await prisma.interpretationQuestion.createMany({
    data: [
      { interpretationId: recordId, order: 1, category: 'TECH', question: '芯片的性能指标和良率数据是什么？', idealAnswer: '应给出算力密度、功耗比与良率百分比，有第三方验证' },
      { interpretationId: recordId, order: 2, category: 'TECH', question: '技术路线的第三方验证情况？', idealAnswer: '应有权威机构测试报告' },
      { interpretationId: recordId, order: 3, category: 'MARKET', question: '目标市场规模测算依据？', idealAnswer: '应给出可信数据来源的测算' },
      { interpretationId: recordId, order: 4, category: 'BUSINESS', question: '在手订单的交付节奏？', idealAnswer: '应给出订单金额与交付时间表' },
    ],
  })
  return prisma.interpretationQuestion.findMany({ where: { interpretationId: recordId }, orderBy: { order: 'asc' } })
}

test('verify：一次上传访谈纪要 → 全部问题自动校验 + 自动生成综合结论', async () => {
  asUser()
  await seedQuestions()

  const res = await VERIFY(
    post(`http://t/api/project-interpretation/${recordId}/verify`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '访谈纪要：我们技术很先进，指标不方便透露，良率还在爬坡。技术路线有内部测试验证。订单节奏还在谈，不方便说具体金额。' }),
    }),
    { params: { id: recordId } }
  )
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.verifiedCount, 4)
  assert.equal(body.coveredCount, 3) // 题3 UNCOVERED
  assert.equal(body.uncoveredCount, 1)
  assert.equal(body.conclusionGenerated, true) // 覆盖 ≥3 → 自动结论

  // 逐题结果落库：按 order 对齐
  const questions = await prisma.interpretationQuestion.findMany({
    where: { interpretationId: recordId },
    orderBy: { order: 'asc' },
  })
  assert.equal(questions.every(q => q.verifyStatus === 'VERIFIED'), true)
  const r1 = JSON.parse(questions[0].verifyResultJson!)
  assert.equal(r1.matchLevel, 'GAP')
  assert.ok(r1.conclusion.includes('技术壁垒'))
  const r3 = JSON.parse(questions[2].verifyResultJson!)
  assert.equal(r3.matchLevel, 'UNCOVERED')

  // 记录状态：DONE + 访谈全文 + 自动生成的结论
  const record = await prisma.projectInterpretation.findUnique({ where: { id: recordId } })
  assert.equal(record!.verifyStatus, 'DONE')
  assert.ok(record!.interviewText!.includes('不方便透露'))
  assert.ok(record!.conclusionJson!.includes('技术壁垒'))
})

test('verify：文档（txt）自动提取批量校验；音频无转写 400 且留档；问题清单未就绪 400；缺内容 400', async () => {
  asUser()

  // 问题清单未就绪 → 400
  let res = await VERIFY(
    post(`http://t/api/project-interpretation/${recordId}/verify`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(60) }),
    }),
    { params: { id: recordId } }
  )
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /先生成问题清单/)

  await seedQuestions()

  // txt 文档（multipart）→ 自动提取并批量校验
  const fd = new FormData()
  fd.append('file', new File(['访谈纪要：算力密度 10 TOPS/W，良率 85%，有第三方测试报告。订单 3000 万，明年 Q2 交付。'], '访谈纪要.txt', { type: 'text/plain' }))
  res = await VERIFY(post(`http://t/api/project-interpretation/${recordId}/verify`, { body: fd }), { params: { id: recordId } })
  assert.equal(res.status, 200)
  let record = await prisma.projectInterpretation.findUnique({ where: { id: recordId } })
  assert.equal(record!.interviewFileName, '访谈纪要.txt')
  assert.equal(record!.verifyStatus, 'DONE')

  // 音频无转写 → 400 + 留档
  const fdAudio = new FormData()
  fdAudio.append('file', new File([new Uint8Array([1, 2, 3])], '访谈录音.mp3', { type: 'audio/mpeg' }))
  res = await VERIFY(post(`http://t/api/project-interpretation/${recordId}/verify`, { body: fdAudio }), { params: { id: recordId } })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).needTranscript, true)
  record = await prisma.projectInterpretation.findUnique({ where: { id: recordId } })
  assert.equal(record!.interviewFileName, '访谈录音.mp3')

  // 缺内容 → 400
  res = await VERIFY(
    post(`http://t/api/project-interpretation/${recordId}/verify`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '太短' }),
    }),
    { params: { id: recordId } }
  )
  assert.equal(res.status, 400)
})

test('verify：无请求内容时回退上传时已存访谈全文（自动链路：BP+纪要一起上传）', async () => {
  asUser()
  await seedQuestions()
  // 模拟上传阶段一并存入的访谈全文与留档文件（BP+访谈纪要一起上传场景）
  await prisma.projectInterpretation.update({
    where: { id: recordId },
    data: {
      interviewFileName: '纪要.txt',
      interviewFileUrl: '/api/uploads/interpretation-docs/iv-test.txt',
      interviewText: '访谈纪要：我们技术业内领先，指标不方便透露，良率还在爬坡。技术路线有内部测试报告。订单节奏保密，不方便说具体金额。',
    },
  })

  // 无 body POST（前端自动链路的调用方式）→ 回退使用已存全文校验 + 自动结论
  const res = await VERIFY(post(`http://t/api/project-interpretation/${recordId}/verify`), { params: { id: recordId } })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.verifiedCount, 4)
  assert.equal(body.conclusionGenerated, true)

  const record = await prisma.projectInterpretation.findUnique({ where: { id: recordId } })
  assert.equal(record!.verifyStatus, 'DONE')
  assert.equal(record!.interviewFileName, '纪要.txt')
  assert.ok(record!.conclusionJson!.includes('技术壁垒'))

  // 逐题状态：按 order 对齐落库
  const questions = await prisma.interpretationQuestion.findMany({ where: { interpretationId: recordId }, orderBy: { order: 'asc' } })
  assert.equal(questions.every(q => q.verifyStatus === 'VERIFIED'), true)
  assert.equal(JSON.parse(questions[0].verifyResultJson!).matchLevel, 'GAP')
})

test('自动链路完整回归：上传存访谈全文 → questions 重建不清访谈 → verify 回退成功（修复回归）', async () => {
  asUser()
  // 场景：BP+访谈纪要一起上传（interviewText 已存），自动链路 interpret → questions → verify
  // 此前 bug：questions 重建时清空 interviewText，导致 verify 回退时报"缺少访谈内容"
  await prisma.projectInterpretation.update({
    where: { id: recordId },
    data: {
      status: 'INTERPRETED',
      interpretationJson: JSON.stringify({
        projectName: '光子芯片', industry: '半导体芯片', marketPosition: 'x', techLeadership: 'x',
        teamStanding: 'x', competitionAnalysis: 'x', startupWindow: 'x', marketEstimate: 'x', financingCases: [],
      }),
      interviewFileName: '纪要.txt',
      interviewText: '访谈纪要：算力密度 10 TOPS/W，良率 85%，有第三方测试报告验证。订单 3000 万，明年 Q2 交付。现金流健康。',
    },
  })

  // 1. 生成问题清单（走真实路由，重建问题）
  const qres = await QUESTIONS(post(`http://t/api/project-interpretation/${recordId}/questions`), { params: { id: recordId } })
  assert.equal(qres.status, 200)
  assert.equal((await qres.json()).questions.length, 16)

  // 关键断言：问题清单重建后访谈纪要仍保留
  let record = await prisma.projectInterpretation.findUnique({ where: { id: recordId } })
  assert.equal(record!.interviewFileName, '纪要.txt')
  assert.ok(record!.interviewText!.includes('算力密度'))

  // 2. verify 无 body 回退已存全文 → 校验成功（16 问：mock 覆盖 index 1-4，其余 UNCOVERED 兜底）
  const vres = await VERIFY(post(`http://t/api/project-interpretation/${recordId}/verify`), { params: { id: recordId } })
  assert.equal(vres.status, 200)
  const body = await vres.json()
  assert.equal(body.verifiedCount, 16)
  assert.equal(body.conclusionGenerated, true)

  record = await prisma.projectInterpretation.findUnique({ where: { id: recordId } })
  assert.equal(record!.verifyStatus, 'DONE')
  assert.ok(record!.conclusionJson!)
})

// ── 综合结论 ──

test('conclusion：不足 3 题校验拒绝；≥3 题生成综合结论（UNCOVERED 不计入）', async () => {
  asUser()
  const qs = await seedQuestions()

  // 0 题校验 → 400
  let res = await CONCLUSION(post(`http://t/api/project-interpretation/${recordId}/conclusion`), { params: { id: recordId } })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /至少需要 3 个/)

  // 4 题直接标记校验结果：3 题覆盖（GAP/PARTIAL/PARTIAL）+ 1 题 UNCOVERED（不计入）
  const markResults = [
    { matchLevel: 'GAP', conclusion: '技术壁垒不高' },
    { matchLevel: 'PARTIAL', conclusion: '结论2' },
    { matchLevel: 'UNCOVERED', conclusion: '访谈未覆盖' },
    { matchLevel: 'PARTIAL', conclusion: '结论4' },
  ]
  await Promise.all(
    qs.map((q, i) =>
      prisma.interpretationQuestion.update({
        where: { id: q.id },
        data: {
          verifyStatus: 'VERIFIED',
          verifyResultJson: JSON.stringify({ matchLevel: markResults[i].matchLevel, answerSummary: 'a', gapAnalysis: 'g', conclusion: markResults[i].conclusion }),
        },
      })
    )
  )

  res = await CONCLUSION(post(`http://t/api/project-interpretation/${recordId}/conclusion`), { params: { id: recordId } })
  assert.equal(res.status, 200)
  const { conclusion } = await res.json()
  assert.ok(conclusion.summary.includes('质量'))
  assert.equal(conclusion.dimensions[0].aspect, '技术壁垒')

  const stored = await prisma.projectInterpretation.findUnique({ where: { id: recordId } })
  assert.ok(stored!.conclusionJson!.includes('技术壁垒'))
})
