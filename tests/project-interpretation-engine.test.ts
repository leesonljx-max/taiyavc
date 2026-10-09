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
import { POST as CREATE_PROJECT } from '@/app/api/project-interpretation/[id]/create-project/route'
import { POST as CREATE_DRAFT } from '@/app/api/project-interpretation/[id]/create-project/draft/route'
import { enforceLineBreaks } from '@/lib/project-interpretation/runner'
import { resetMocks, mockState, chatCompletions } from './helpers/setup'

const USER_EMAIL = 'pi2-user@test.com'

let userId: string
let recordId: string

const DOC_TEXT = '光子计算芯片项目。核心团队来自清华，产品为硅光计算加速芯片，已获云厂商POC订单，拟融资2亿元。'

// ── 分点排版后处理（AI 挤一行 → 强制每点独立成行；小数防误拆） ──

test('enforceLineBreaks：行内编号分点拆为独立行；小数/年份不误拆；已分点内容不动', () => {
  // 挤在一行的分点 → 拆为每点一行
  assert.equal(
    enforceLineBreaks('1. 产品A 2. 产品B 3. 产品C'),
    '1. 产品A\n2. 产品B\n3. 产品C'
  )
  // 标点分隔的挤行分点 → 拆分
  assert.equal(
    enforceLineBreaks('1. 营收1200万；2. 毛利45%；3. 净利300万'),
    '1. 营收1200万\n2. 毛利45%\n3. 净利300万'
  )
  // 小数与年份不拆（编号后紧跟数字 = 小数；单处编号不动）
  assert.equal(enforceLineBreaks('2025年营收 1.5亿元'), '2025年营收 1.5亿元')
  assert.equal(enforceLineBreaks('增长率约3.14%'), '增长率约3.14%')
  // 已正确分点（多行）→ 原样保留
  const already = '1. 第一点\n2. 第二点\n3. 第三点'
  assert.equal(enforceLineBreaks(already), already)
})

beforeEach(async () => {
  resetMocks()
  await prisma.sectorInsight.deleteMany({})
  await prisma.interpretationQuestion.deleteMany({})
  await prisma.projectInterpretation.deleteMany({})
  await prisma.project.deleteMany({})
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

// ── 赛道知识库：高质量问题沉淀与二次校验 ──

test('verify：HIGH 高质量问题自动沉淀到赛道知识库；二次校验题更新结论与命中数', async () => {
  asUser()
  const qs = await seedQuestions()

  // 预插一条同赛道同题的沉淀（模拟历史二次校验题）：verify 后应更新结论 + hitCount
  await prisma.sectorInsight.create({
    data: {
      sector: '半导体芯片',
      question: '芯片的性能指标和良率数据是什么？', // 与题 1 同文本，mock 结果为 GAP
      idealAnswer: '应给出算力密度、功耗比与良率百分比，有第三方验证',
      conclusion: '旧结论',
      matchLevel: 'HIGH',
      sourceProjectName: '历史项目',
      sourceUserId: userId,
    },
  })
  // 题 1 标记为赛道沉淀二次校验题（生成时来自知识库的场景）
  await prisma.interpretationQuestion.updateMany({
    where: { interpretationId: recordId, order: 1 },
    data: { sectorInsight: true },
  })

  const res = await VERIFY(
    post(`http://t/api/project-interpretation/${recordId}/verify`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '访谈纪要：我们技术业内领先，指标不方便透露，良率还在爬坡。技术路线有第三方测试报告。订单节奏还在谈。' }),
    }),
    { params: { id: recordId } }
  )
  assert.equal(res.status, 200)

  // 沉淀断言：题 2（HIGH）新建沉淀；题 1（GAP，但命中预插的二次校验题）更新结论 + hitCount
  const insights = await prisma.sectorInsight.findMany()
  assert.equal(insights.length, 2)
  const high = insights.find(i => i.question === '技术路线的第三方验证情况？')
  assert.ok(high, 'HIGH 问题应沉淀')
  assert.equal(high!.sector, '半导体芯片')
  assert.equal(high!.matchLevel, 'HIGH')
  assert.ok(high!.conclusion.includes('可信'))
  assert.equal(high!.hitCount, 1)
  assert.equal(high!.sourceProjectName, '光子芯片')

  const updated = insights.find(i => i.question === '芯片的性能指标和良率数据是什么？')
  assert.ok(updated, '预插二次校验题应被更新')
  assert.ok(updated!.conclusion.includes('技术壁垒')) // 新结论覆盖旧结论
  assert.equal(updated!.hitCount, 2) // 命中数 +1
  assert.equal(updated!.matchLevel, 'GAP')
  void qs
})

test('questions：同赛道沉淀注入生成二次校验问题（isSectorInsight 标记落库 + prompt 注入）', async () => {
  asUser()
  await seedInterpreted()
  await prisma.sectorInsight.create({
    data: {
      sector: '半导体芯片',
      question: '芯片的流片良率和量产爬坡计划？',
      idealAnswer: '应给出良率百分比与量产时间表',
      conclusion: '良率数据是硬指标，回避即存疑',
      matchLevel: 'HIGH',
      sourceProjectName: '历史项目',
      sourceUserId: userId,
    },
  })

  // mock：问题清单返回含 isSectorInsight 的题
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('访谈必问问题')) {
      const qs = [
        { category: 'TECH', question: '芯片的流片良率和量产爬坡计划？', idealAnswer: '应给出良率百分比与量产时间表', isSectorInsight: true },
        ...Array.from({ length: 10 }, (_, i) => ({ category: 'TECH', question: `技术问题${i + 1}`, idealAnswer: `理想${i + 1}`, isSectorInsight: false })),
        ...Array.from({ length: 5 }, (_, i) => ({ category: 'MARKET', question: `市场问题${i + 1}`, idealAnswer: `理想${i + 1}` })),
      ]
      return chatCompletions(JSON.stringify({ questions: qs }))
    }
    return chatCompletions('{}')
  }

  const res = await QUESTIONS(post(`http://t/api/project-interpretation/${recordId}/questions`), { params: { id: recordId } })
  assert.equal(res.status, 200)

  // isSectorInsight 标记落库
  const saved = await prisma.interpretationQuestion.findMany({
    where: { interpretationId: recordId },
    orderBy: { order: 'asc' },
  })
  const marked = saved.filter(q => q.sectorInsight)
  assert.equal(marked.length, 1)
  assert.equal(marked[0].question, '芯片的流片良率和量产爬坡计划？')
  assert.equal(marked[0].order, 1) // 排前部

  // prompt 注入：问题生成调用的 user prompt 含沉淀问题与历史结论
  const qCall = mockState.fetchCalls.find(
    c => String((c.body as { messages?: Array<{ content: string }> }).messages?.[0]?.content || '').includes('访谈必问问题')
  )
  const userPrompt = String((qCall!.body as { messages: Array<{ content: string }> }).messages[1].content)
  assert.ok(userPrompt.includes('同赛道历史沉淀的高质量问题'))
  assert.ok(userPrompt.includes('芯片的流片良率和量产爬坡计划？'))
  assert.ok(userPrompt.includes('良率数据是硬指标'))
})

// ── 闭环创建到项目库 ──

async function seedVerified() {
  await seedQuestions()
  await prisma.projectInterpretation.update({
    where: { id: recordId },
    data: {
      verifyStatus: 'DONE',
      conclusionJson: JSON.stringify({
        summary: '整体回答质量中等',
        dimensions: [{ aspect: '技术壁垒', gapLevel: 'GAP', conclusion: '技术壁垒不高' }],
        advice: '建议补充尽调',
      }),
    },
  })
}

test('create-project：AI 按项目库模板提取并创建（主要产品/核心优势/核心团队截取 BP）；重名 409；重复创建 400', async () => {
  asUser()
  await seedVerified()

  // mock 项目库模板提取（P5：排版化——序号分点 + 重点加粗；含新四字段与 keyPages）
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('项目库创建模板')) {
      return chatCompletions(
        JSON.stringify({
          name: '光子芯片',
          companyFullName: '光子芯片科技（北京）有限公司',
          industry: '半导体芯片',
          companyPosition: '硅光计算加速芯片',
          mainProducts: '1. **硅光计算加速芯片**——BP 原文：产品为硅光计算加速芯片\n2. 已获**云厂商 POC 订单**',
          coreAdvantage: '1. **硅光混合计算路线**，有流片经验（BP 原文截取）\n2. 差异化在互联架构',
          coreTeam: '1. 张三——创始人/CEO，清华博士（BP 原文）\n2. 访谈补充：团队在清华实验室共事多年',
          financialData: '1. 2025 年营收 **1200 万元**（BP 原文）\n2. 访谈补充：经营现金流为负',
          orderProgress: '1. 已获**云厂商 POC 订单** 3 个\n2. 在谈合同金额约 **5000 万**',
          competitors: '1. **曦智科技**——同为光计算路线，已 B 轮\n2. 差异化在互联架构',
          financingPlan: '1. 本轮 **2 亿元**用于流片\n2. 里程碑：18 个月内完成工程样片',
          description: '1. 硅光计算芯片项目\n2. 已获**云厂商 POC 订单**',
          financingRound: 'A轮',
          totalAmount: '2亿',
          investmentValuation: 8,
          keyPages: { mainProducts: [3], coreAdvantage: [5] },
        })
      )
    }
    return chatCompletions('{}')
  }

  // 未完成校验的记录 → 400（另建一条新记录验证）
  const fresh = await prisma.projectInterpretation.create({
    data: { userId, projectName: '未校验', fileName: 'a.txt', fileUrl: '', fileType: 'text/plain', fileSize: 1, documentText: DOC_TEXT },
  })
  let res: Response = await CREATE_DRAFT(post(`http://t/api/project-interpretation/${fresh.id}/create-project/draft`), { params: { id: fresh.id } })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /先完成访谈校验/)

  // ── 第一步：draft 预取（不创建项目） ──
  res = await CREATE_DRAFT(post(`http://t/api/project-interpretation/${recordId}/create-project/draft`), { params: { id: recordId } })
  assert.equal(res.status, 200)
  const draftBody = await res.json()
  assert.equal(draftBody.draft.name, '光子芯片')
  // 排版化产物：分点 + 加粗
  assert.match(draftBody.draft.mainProducts, /1\. \*\*硅光计算加速芯片\*\*/)
  assert.match(draftBody.draft.coreTeam, /1\. 张三/)
  // 新四字段（BP + 访谈纪要结合提取）
  assert.match(draftBody.draft.financialData, /1200 万元/)
  assert.match(draftBody.draft.orderProgress, /POC 订单/)
  assert.match(draftBody.draft.competitors, /曦智科技/)
  assert.match(draftBody.draft.financingPlan, /流片/)
  // keyPages 透传（BP 页码标注；txt 无分页图片场景 bpImages 为空对象）
  assert.deepEqual(draftBody.draft.keyPages, { mainProducts: [3], coreAdvantage: [5] })
  assert.deepEqual(draftBody.bpImages, {})
  assert.ok(draftBody.defaultTargetDate)
  // 未创建项目（draft 阶段无落库）
  assert.equal(await prisma.project.count({ where: { name: '光子芯片' } }), 0)

  // ── 第二步：create-project 必填校验（缺 body → 400 列出必填项） ──
  res = await CREATE_PROJECT(post(`http://t/api/project-interpretation/${recordId}/create-project`), { params: { id: recordId } })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /必填项/)

  // ── 第二步：补全表单后创建 → 项目落库（markdown 转 HTML：分点 <p> + <strong> 加粗 + BP 配图 <img>） ──
  const formPayload = {
    name: '光子芯片',
    companyFullName: '光子芯片科技（北京）有限公司',
    industry: '半导体芯片',
    companyPosition: '硅光计算加速芯片',
    mainProducts: draftBody.draft.mainProducts,
    coreAdvantage: draftBody.draft.coreAdvantage,
    coreTeam: draftBody.draft.coreTeam,
    financialData: draftBody.draft.financialData,
    orderProgress: draftBody.draft.orderProgress,
    competitors: draftBody.draft.competitors,
    financingPlan: draftBody.draft.financingPlan,
    description: draftBody.draft.description,
    financingRound: 'A轮',
    totalAmount: '2亿',
    investmentValuation: 8,
    targetDate: '2026-10-01',
    // BP 关键页配图（模拟 draft 返回的截图；创建时按字段嵌入 HTML）
    bpImages: {
      mainProducts: [{ page: 3, url: '/api/uploads/interpretation-images/test-p3.png' }],
    },
  }
  res = await CREATE_PROJECT(
    post(`http://t/api/project-interpretation/${recordId}/create-project`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formPayload),
    }),
    { params: { id: recordId } }
  )
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(body.projectId)

  const project = await prisma.project.findUnique({ where: { id: body.projectId } })
  assert.ok(project)
  assert.equal(project!.name, '光子芯片')
  assert.equal(project!.industry, '半导体芯片')
  // 富文本字段已转 HTML：每点独立 <p>（分点分段）+ <strong>（加粗）+ BP 配图 <img>
  assert.ok(project!.mainProducts!.includes('<strong>硅光计算加速芯片</strong>'))
  assert.ok(project!.mainProducts!.includes('<img src="/api/uploads/interpretation-images/test-p3.png"'))
  assert.ok((project!.mainProducts!.match(/<p>/g) || []).length >= 2, '分点应各自独立成段')
  assert.ok(project!.coreAdvantage!.includes('流片'))
  assert.ok(project!.coreTeam!.includes('张三'))
  // 新四字段落库（HTML）
  assert.ok(project!.financialData!.includes('<strong>1200 万元</strong>'))
  assert.ok(project!.orderProgress!.includes('POC 订单'))
  assert.ok(project!.competitors!.includes('曦智科技'))
  assert.ok(project!.financingPlan!.includes('流片'))
  assert.equal(project!.followStage, 'INITIAL_TALK')
  assert.equal(project!.totalAmount, '2亿')
  assert.equal(project!.investmentValuation, 8)
  assert.equal(project!.createdById, userId)
  assert.ok(project!.passedStages!.includes('INITIAL_TALK'))

  // linkedProjectId 回写
  const record = await prisma.projectInterpretation.findUnique({ where: { id: recordId } })
  assert.equal(record!.linkedProjectId, body.projectId)

  // 重复创建 → 400
  res = await CREATE_PROJECT(
    post(`http://t/api/project-interpretation/${recordId}/create-project`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formPayload),
    }),
    { params: { id: recordId } }
  )
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /已创建/)

  // 重名 → 409（新记录提交同名表单）
  const other = await prisma.projectInterpretation.create({
    data: { userId, projectName: '光子芯片2', fileName: 'b.txt', fileUrl: '', fileType: 'text/plain', fileSize: 1, documentText: DOC_TEXT, verifyStatus: 'DONE', conclusionJson: '{}' },
  })
  res = await CREATE_PROJECT(
    post(`http://t/api/project-interpretation/${other.id}/create-project`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...formPayload, companyPosition: '硅光计算芯片' }),
    }),
    { params: { id: other.id } }
  )
  assert.equal(res.status, 409)
  const dup = await res.json()
  assert.match(dup.error, /已存在同名项目/)
  assert.equal(dup.existingProjectId, body.projectId)
})

test('create-project：BP 原文自动转存到项目文档（ProjectDocument + 文件复制到 project-docs）', async () => {
  asUser()
  await seedVerified()

  // 造真实 BP 文件（interpretation-docs 下），fileUrl 指向它
  const { writeFile, mkdir, unlink } = await import('fs/promises')
  const { join } = await import('path')
  const dir = join(process.cwd(), 'public', 'interpretation-docs')
  await mkdir(dir, { recursive: true })
  const uniqueName = `test-bp-${Date.now()}.txt`
  await writeFile(join(dir, uniqueName), DOC_TEXT, 'utf8')

  await prisma.projectInterpretation.update({
    where: { id: recordId },
    data: {
      fileName: '光子芯片BP.txt',
      fileUrl: `/api/uploads/interpretation-docs/${uniqueName}`,
      fileType: 'text/plain',
      fileSize: DOC_TEXT.length,
    },
  })

  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('项目库创建模板')) {
      return chatCompletions(
        JSON.stringify({
          name: '光子芯片',
          companyFullName: '光子芯片科技有限公司',
          industry: '半导体芯片',
          companyPosition: '硅光计算芯片',
          mainProducts: '硅光计算加速芯片',
          coreAdvantage: '硅光路线',
          coreTeam: '清华团队',
          description: '硅光计算芯片项目',
          financingRound: 'A轮',
          totalAmount: '2亿',
          investmentValuation: null,
        })
      )
    }
    return chatCompletions('{}')
  }

  const res = await CREATE_PROJECT(
    post(`http://t/api/project-interpretation/${recordId}/create-project`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '光子芯片',
        companyFullName: '光子芯片科技有限公司',
        industry: '半导体芯片',
        companyPosition: '硅光计算芯片',
        mainProducts: '硅光计算加速芯片',
        coreAdvantage: '硅光路线',
        coreTeam: '清华团队',
        description: '硅光计算芯片项目',
        financingRound: 'A轮',
        totalAmount: '2亿',
        investmentValuation: 8,
        targetDate: '2026-10-01',
      }),
    }),
    { params: { id: recordId } }
  )
  assert.equal(res.status, 200)
  const body = await res.json()

  // ProjectDocument 转存断言
  const doc = await prisma.projectDocument.findFirst({ where: { projectId: body.projectId } })
  assert.ok(doc, 'BP 应转存为项目文档')
  assert.equal(doc!.fileName, '光子芯片BP.txt')
  assert.ok(doc!.fileUrl.includes('/project-docs/'))
  assert.equal(doc!.fileType, 'text/plain')

  // 转存文件真实存在（project-docs 下）并清理
  const { readFile } = await import('fs/promises')
  const copiedName = doc!.fileUrl.replace(/^\/project-docs\//, '')
  const copied = await readFile(join(process.cwd(), 'public', 'project-docs', copiedName), 'utf8')
  assert.ok(copied.includes('光子计算芯片'))
  await unlink(join(process.cwd(), 'public', 'project-docs', copiedName))
  await unlink(join(dir, uniqueName))
})
