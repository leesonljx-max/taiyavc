/**
 * v2.4.1 测试：项目解读多文件/网页链接/音频自动转写/创建项目联动
 * - web-content：URL 解析（分隔/去重/上限）+ 网页抓取正文提取（去 script/nav/footer）
 * - upload：多文件 files[] 合并；BP+链接合并分析 + linksJson 落库；仅链接可创建；链接全失败 400
 * - ASR：音频自动转写为访谈纪要（未配置时降级提示需粘贴文本）
 * - draft/create-project：keyPages 重复页去重；初聊日期默认创建当天；webLinks 复制到项目库
 */

import './helpers/setup'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { POST as UPLOAD } from '@/app/api/project-interpretation/upload/route'
import { POST as VERIFY } from '@/app/api/project-interpretation/[id]/verify/route'
import { POST as CREATE_PROJECT } from '@/app/api/project-interpretation/[id]/create-project/route'
import { POST as CREATE_DRAFT } from '@/app/api/project-interpretation/[id]/create-project/draft/route'
import { parseUrlsFromText, fetchWebLinkContent, fetchWebLinks } from '@/lib/project-interpretation/web-content'
import { transcribeAudio, isAsrConfigured } from '@/lib/project-interpretation/speech-to-text'
import { resetMocks, mockState, chatCompletions } from './helpers/setup'

const USER_EMAIL = 'pi3-user@test.com'

let userId: string

const DOC_TEXT = '光子计算芯片创业项目。公司成立于2023年，核心团队来自清华大学电子工程系，拥有光互连芯片设计经验。主要产品为硅光计算加速芯片，已获得某头部互联网公司POC订单，客户包括三家云厂商。本轮拟融资2亿元，用于芯片流片与量产。'
const SUPPLEMENT_TEXT = '补充资料：光子芯片行业市场规模测算——2026年全球硅光计算市场预计达到120亿元，年复合增长率45%，主要驱动力为AI训练算力需求爆发与云厂商自研芯片趋势。'

/** mock 网页（标题 + 导航/脚本噪声 + 正文 + 页脚） */
const WEB_HTML = `<html><head><title>光子芯片获亿元融资 - 科技媒体</title></head><body><nav>首页 登录 注册</nav><script>tracking();</script><main><p>光子芯片公司今日宣布完成亿元A轮融资，由红杉资本领投。公司主营硅光计算加速芯片，已与三家云厂商达成POC合作，订单金额持续攀升，预计明年进入量产阶段。</p></main><footer>版权所有</footer></body></html>`

/** mock 网页 fetch handler：webmock.test 域名返回 HTML；可选分支返回 PDF/404 */
function webFetchHandler(url: string): unknown {
  const u = String(url)
  if (u.includes('/pdf-page')) return new Response('binary', { headers: { 'content-type': 'application/pdf' } })
  if (u.includes('/notfound')) return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } })
  if (u.includes('webmock.test')) return new Response(WEB_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  return chatCompletions('{}')
}

beforeEach(async () => {
  resetMocks()
  // ASR 环境变量清空（测试内按需注入；避免开发者 .env 里的真实 key 影响断言）
  delete process.env.ASR_API_KEY
  delete process.env.ASR_BASE_URL
  delete process.env.ASR_MODEL

  await prisma.interpretationQuestion.deleteMany({})
  await prisma.projectInterpretation.deleteMany({})
  await prisma.project.deleteMany({})
  await prisma.user.deleteMany({ where: { email: USER_EMAIL } })
  userId = (await prisma.user.create({
    data: { email: USER_EMAIL, name: '网页转写用户', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
})

function asUser() {
  mockState.session = { user: { id: userId, name: null, email: 'x@t.com', role: 'INVESTMENT_MANAGER' } }
}

const post = (url: string, init?: RequestInit) => new Request(url, { method: 'POST', ...init })

// ── web-content：URL 解析 ──

test('parseUrlsFromText：换行/空格/逗号分隔；去重；上限 5；自动补 https', () => {
  // 换行 + 空格 + 中英文逗号混合分隔
  assert.deepEqual(
    parseUrlsFromText('http://a.com/1 https://b.com/2，http://c.com/3\nd.com/4；http://e.com/5'),
    ['http://a.com/1', 'https://b.com/2', 'http://c.com/3', 'https://d.com/4', 'http://e.com/5']
  )
  // 完全相同的重复链接去重（http/https 视为不同 URL）
  assert.deepEqual(
    parseUrlsFromText('http://a.com/1 http://a.com/1 http://a.com/1'),
    ['http://a.com/1']
  )
  // 超过 5 个截断
  const six = parseUrlsFromText('a1.com a2.com a3.com a4.com a5.com a6.com')
  assert.equal(six.length, 5)
  // 非 URL（无点号主机名）与垃圾文本跳过
  assert.deepEqual(parseUrlsFromText('不是链接 localhost 这也 不算'), [])
  assert.deepEqual(parseUrlsFromText(''), [])
})

// ── web-content：网页抓取 ──

test('fetchWebLinkContent：提取标题与正文（去 script/nav/footer）；非 HTML 与 404 返回 null；批量只留成功', async () => {
  mockState.fetchHandler = url => webFetchHandler(url)

  const good = await fetchWebLinkContent('http://webmock.test/article')
  assert.ok(good, '有效 HTML 应返回内容')
  assert.equal(good!.title, '光子芯片获亿元融资 - 科技媒体')
  assert.ok(good!.content.includes('硅光计算加速芯片'))
  assert.ok(!good!.content.includes('tracking'), 'script 内容应剔除')
  assert.ok(!good!.content.includes('版权所有'), 'footer 应剔除')
  assert.ok(!good!.content.includes('登录'), 'nav 应剔除')

  // 非 HTML（PDF）→ null；404 → null
  assert.equal(await fetchWebLinkContent('http://webmock.test/pdf-page'), null)
  assert.equal(await fetchWebLinkContent('http://webmock.test/notfound'), null)

  // 批量：好坏混合只保留成功
  const list = await fetchWebLinks(['http://webmock.test/article', 'http://webmock.test/notfound'])
  assert.equal(list.length, 1)
  assert.equal(list[0].title, '光子芯片获亿元融资 - 科技媒体')
  assert.deepEqual(await fetchWebLinks([]), [])
})

// ── upload：多文件 / 网页链接 ──

test('POST 上传：多文件 files[]（BP + 补充资料）→ 合并【文档：】块 + 首份留档 + 文件名标签', async () => {
  asUser()
  const fd = new FormData()
  fd.append('files', new File([DOC_TEXT], '光子芯片BP.txt', { type: 'text/plain' }))
  fd.append('files', new File([SUPPLEMENT_TEXT], '行业测算.txt', { type: 'text/plain' }))
  const res = await UPLOAD(new Request('http://t/api/project-interpretation/upload', { method: 'POST', body: fd }))
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.interpretation.fileName, '光子芯片BP.txt 等 2 份')
  assert.equal(body.interpretation.webLinkCount, 0)

  const record = await prisma.projectInterpretation.findUnique({ where: { id: body.interpretation.id } })
  assert.ok(record)
  assert.ok(record!.documentText!.includes('【文档：光子芯片BP.txt】'))
  assert.ok(record!.documentText!.includes('【文档：行业测算.txt】'))
  assert.match(record!.fileUrl!, /interpretation-docs\//) // 首份（BP）留档
})

test('POST 上传：BP + 网页链接 → 网页内容合并进分析文本 + linksJson 落库', async () => {
  asUser()
  mockState.fetchHandler = url => webFetchHandler(url)
  const fd = new FormData()
  fd.append('files', new File([DOC_TEXT], 'bp.txt', { type: 'text/plain' }))
  fd.append('links', 'http://webmock.test/article')
  const res = await UPLOAD(new Request('http://t/api/project-interpretation/upload', { method: 'POST', body: fd }))
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.interpretation.webLinkCount, 1)
  assert.deepEqual(body.interpretation.failedLinks, [])

  const record = await prisma.projectInterpretation.findUnique({ where: { id: body.interpretation.id } })
  assert.ok(record)
  assert.ok(record!.documentText!.includes('【网页：光子芯片获亿元融资 - 科技媒体】'))
  assert.ok(record!.documentText!.includes('来源：http://webmock.test/article'))
  assert.ok(record!.documentText!.includes('硅光计算加速芯片')) // 网页正文已并入
  // linksJson 落库（创建项目时复制到 Project.webLinksJson）
  const links = JSON.parse(record!.linksJson!) as Array<{ url: string; title: string; content: string }>
  assert.equal(links.length, 1)
  assert.equal(links[0].url, 'http://webmock.test/article')
  assert.equal(links[0].title, '光子芯片获亿元融资 - 科技媒体')
})

test('POST 上传：仅网页链接（无 BP）→ 可创建解读记录，项目名缺省取网页标题', async () => {
  asUser()
  mockState.fetchHandler = url => webFetchHandler(url)
  const fd = new FormData()
  fd.append('links', 'http://webmock.test/article')
  const res = await UPLOAD(new Request('http://t/api/project-interpretation/upload', { method: 'POST', body: fd }))
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.interpretation.projectName, '光子芯片获亿元融资 - 科技媒体')
  assert.equal(body.interpretation.fileName, '1 个网页链接')
  assert.equal(body.interpretation.webLinkCount, 1)
  assert.equal(body.interpretation.hasInterview, false)

  const record = await prisma.projectInterpretation.findUnique({ where: { id: body.interpretation.id } })
  assert.ok(record!.documentText!.includes('来源：http://webmock.test/article'))
})

test('POST 上传：仅链接且抓取全部失败 → 400 提示检查链接', async () => {
  asUser()
  // fetchHandler 未设置网页分支 → mock 响应无 headers → fetchWebLinkContent 返回 null
  mockState.fetchHandler = () => chatCompletions('{}')
  const fd = new FormData()
  fd.append('links', 'http://webmock.test/dead')
  const res = await UPLOAD(new Request('http://t/api/project-interpretation/upload', { method: 'POST', body: fd }))
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /网页链接抓取失败/)
})

// ── ASR：音频自动转写 ──

test('transcribeAudio：未配置返回 null；配置后经 OpenAI 兼容接口返回转写文本', async () => {
  assert.equal(isAsrConfigured(), false)
  assert.equal(await transcribeAudio(Buffer.from('fake-mp3-bytes'), 'a.mp3'), null)

  process.env.ASR_API_KEY = 'test-asr-key'
  process.env.ASR_BASE_URL = 'http://asrmock.test/v1'
  process.env.ASR_MODEL = 'test-asr-model'
  mockState.fetchHandler = url =>
    String(url).includes('/audio/transcriptions') ? { text: '  转写结果：算力密度 10 TOPS/W  ' } : chatCompletions('{}')

  assert.equal(isAsrConfigured(), true)
  assert.equal(await transcribeAudio(Buffer.from('fake-mp3-bytes'), 'a.mp3'), '转写结果：算力密度 10 TOPS/W')
  // multipart 请求已发出到 ASR 接口
  assert.ok(mockState.fetchCalls.some(c => String(c.url).includes('/audio/transcriptions')))
})

test('POST 上传：访谈音频自动转写 → 转写文本作为纪要（autoTranscribed=true），无需手动填写', async () => {
  asUser()
  process.env.ASR_API_KEY = 'test-asr-key'
  process.env.ASR_BASE_URL = 'http://asrmock.test/v1'
  mockState.fetchHandler = url =>
    String(url).includes('/audio/transcriptions')
      ? { text: '访谈转写全文：我们算力密度 10 TOPS/W，良率 85%，订单排期已经到明年下半年。' }
      : chatCompletions('{}')

  const fd = new FormData()
  fd.append('files', new File([DOC_TEXT], 'bp.txt', { type: 'text/plain' }))
  fd.append('interviewFile', new File([new Uint8Array([1, 2, 3, 4, 5])], 'meeting.mp3', { type: 'audio/mpeg' }))
  const res = await UPLOAD(new Request('http://t/api/project-interpretation/upload', { method: 'POST', body: fd }))
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.interpretation.hasInterview, true)
  assert.equal(body.interpretation.autoTranscribed, true)

  const record = await prisma.projectInterpretation.findUnique({ where: { id: body.interpretation.id } })
  assert.ok(record)
  assert.equal(record!.interviewFileName, 'meeting.mp3')
  assert.ok(record!.interviewFileUrl!.includes('interpretation-docs'))
  assert.ok(record!.interviewText!.includes('算力密度 10 TOPS/W')) // 转写文本直接作为纪要
})

test('POST 上传：音频无 ASR 配置/转写失败 → 400 提示需粘贴文本（旧行为保留）', async () => {
  asUser()
  // ASR 未配置（beforeEach 已删除）
  const fd = new FormData()
  fd.append('files', new File([DOC_TEXT], 'bp.txt', { type: 'text/plain' }))
  fd.append('interviewFile', new File([new Uint8Array([1, 2, 3])], 'meeting.m4a', { type: 'audio/mp4' }))
  const res = await UPLOAD(new Request('http://t/api/project-interpretation/upload', { method: 'POST', body: fd }))
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /音频文件需要配合粘贴访谈纪要文本/)
})

test('POST verify（详情页批量校验）：仅上传音频 → 自动转写后批量校验，无需粘贴文字', async () => {
  asUser()
  // 造 READY 问题清单记录
  const rec = await prisma.projectInterpretation.create({
    data: {
      userId,
      projectName: '音频校验项目',
      fileName: 'bp.txt',
      fileUrl: '',
      fileType: 'text/plain',
      fileSize: 1,
      documentText: DOC_TEXT,
      questionsStatus: 'READY',
    },
  })
  await prisma.interpretationQuestion.createMany({
    data: [
      { interpretationId: rec.id, order: 1, category: 'TECH', question: 'Q1 芯片指标？', idealAnswer: 'A1 量化指标' },
      { interpretationId: rec.id, order: 2, category: 'TECH', question: 'Q2 良率？', idealAnswer: 'A2 良率数据' },
      { interpretationId: rec.id, order: 3, category: 'MARKET', question: 'Q3 订单？', idealAnswer: 'A3 订单情况' },
    ],
  })

  // ASR mock + 批量校验 mock（覆盖 2 题 < 3 → 不触发综合结论）
  process.env.ASR_API_KEY = 'test-asr-key'
  process.env.ASR_BASE_URL = 'http://asrmock.test/v1'
  mockState.fetchHandler = (url, body) => {
    if (String(url).includes('/audio/transcriptions')) {
      return { text: '转写内容：我们的技术指标是 10 TOPS/W，相比上一代提升约三倍，目前良率还在爬坡阶段，产能规划已经和代工厂谈定，市场侧订单不方便透露具体金额，但节奏是逐季度放量的，团队核心成员都有十年以上行业经验。' }
    }
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('闭环校验')) {
      return chatCompletions(
        JSON.stringify({
          results: [
            { index: 1, matchLevel: 'HIGH', answerSummary: '给出指标', gapAnalysis: '吻合', conclusion: '指标可信' },
            { index: 2, matchLevel: 'PARTIAL', answerSummary: '部分回答', gapAnalysis: '细节缺失', conclusion: '需追问' },
            { index: 3, matchLevel: 'UNCOVERED', answerSummary: '', gapAnalysis: '未涉及', conclusion: '建议下次访谈补充' },
          ],
        })
      )
    }
    return chatCompletions('{}')
  }

  const fd = new FormData()
  fd.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'meeting.mp3', { type: 'audio/mpeg' }))
  const res = await VERIFY(
    new Request(`http://t/api/project-interpretation/${rec.id}/verify`, { method: 'POST', body: fd }),
    { params: { id: rec.id } }
  )
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.autoTranscribed, true)
  assert.ok(body.transcribedLength > 0)
  assert.equal(body.coveredCount, 2)
  assert.equal(body.conclusionGenerated, false)

  // 转写文本已作为访谈全文存入记录
  const record = await prisma.projectInterpretation.findUnique({ where: { id: rec.id } })
  assert.ok(record)
  assert.equal(record!.interviewFileName, 'meeting.mp3')
  assert.ok(record!.interviewText!.includes('10 TOPS/W'))
  assert.equal(record!.verifyStatus, 'DONE')
})

// ── draft / create-project：去重 + 默认日期 + webLinks 复制 ──

test('draft/create-project：keyPages 重复页去重；初聊日期默认创建当天；webLinks 复制到项目库', async () => {
  asUser()
  const linksJson = JSON.stringify([
    { url: 'http://webmock.test/article', title: '光子芯片获亿元融资 - 科技媒体', content: '光子芯片公司完成亿元A轮融资，主营硅光计算加速芯片。' },
  ])
  const rec = await prisma.projectInterpretation.create({
    data: {
      userId,
      projectName: '光子芯片',
      fileName: 'bp.txt',
      fileUrl: '',
      fileType: 'text/plain',
      fileSize: 100,
      documentText: DOC_TEXT,
      verifyStatus: 'DONE',
      conclusionJson: JSON.stringify({ summary: '整体可信', dimensions: [{ aspect: '技术', gapLevel: 'PARTIAL', conclusion: '部分吻合' }] }),
      linksJson,
    },
  })

  // mock 项目库模板提取：keyPages 含重复页 [3,3,5]
  mockState.fetchHandler = (url, body) => {
    const system = String((body.messages as Array<{ content: string }>)[0]?.content || '')
    if (system.includes('项目库创建模板')) {
      return chatCompletions(
        JSON.stringify({
          name: '光子芯片',
          companyFullName: '光子芯片科技（北京）有限公司',
          industry: '半导体芯片',
          companyPosition: '硅光计算加速芯片',
          mainProducts: '1. **硅光计算加速芯片**——BP 原文截取',
          coreAdvantage: '1. **流片经验**',
          coreTeam: '1. 张三——创始人',
          financialData: '1. 营收 **1200 万元**',
          orderProgress: '1. POC 订单 3 个',
          competitors: '1. 曦智科技',
          financingPlan: '1. 2 亿元用于流片',
          description: '1. 硅光计算芯片项目',
          financingRound: 'A轮',
          totalAmount: '2亿',
          investmentValuation: 8,
          keyPages: { mainProducts: [3, 3, 5], coreAdvantage: [5] },
        })
      )
    }
    return chatCompletions('{}')
  }

  // draft：重复页去重 + 初聊日期默认创建当天
  const draftRes = await CREATE_DRAFT(post(`http://t/api/project-interpretation/${rec.id}/create-project/draft`), { params: { id: rec.id } })
  assert.equal(draftRes.status, 200)
  const draftBody = await draftRes.json()
  assert.deepEqual(draftBody.draft.keyPages, { mainProducts: [3, 5], coreAdvantage: [5] }) // [3,3,5] → [3,5]
  assert.equal(draftBody.defaultTargetDate, new Date().toISOString().split('T')[0])

  // create：表单确认创建 → webLinksJson 复制到项目库
  const createRes = await CREATE_PROJECT(
    post(`http://t/api/project-interpretation/${rec.id}/create-project`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
        targetDate: draftBody.defaultTargetDate,
      }),
    }),
    { params: { id: rec.id } }
  )
  assert.equal(createRes.status, 200)
  const { projectId } = await createRes.json()
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  assert.ok(project)
  assert.equal(project!.webLinksJson, linksJson) // 解读网页资料带入项目库
})
