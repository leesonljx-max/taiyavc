/**
 * P1 测试：项目解读上传/列表/详情/删除 API
 * POST   /api/project-interpretation/upload（txt 直读提取 + 格式/大小/空文本校验）
 * GET    /api/project-interpretation（我的列表 + 进度统计）
 * GET/DELETE /api/project-interpretation/[id]（详情 / 删除，仅本人）
 */

import './helpers/setup'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '@/lib/prisma'
import { POST as UPLOAD } from '@/app/api/project-interpretation/upload/route'
import { GET as LIST } from '@/app/api/project-interpretation/route'
import { GET as DETAIL, DELETE } from '@/app/api/project-interpretation/[id]/route'
import { resetMocks, mockState } from './helpers/setup'

const USER_EMAIL = 'pi-user@test.com'
const OTHER_EMAIL = 'pi-other@test.com'

let userId: string
let otherId: string

beforeEach(async () => {
  resetMocks()
  await prisma.interpretationQuestion.deleteMany({})
  await prisma.projectInterpretation.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: [USER_EMAIL, OTHER_EMAIL] } } })

  userId = (await prisma.user.create({
    data: { email: USER_EMAIL, name: '解读用户', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
  otherId = (await prisma.user.create({
    data: { email: OTHER_EMAIL, name: '其他用户', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
})

function asUser(id: string, role = 'INVESTMENT_MANAGER') {
  mockState.session = { user: { id, name: null, email: 'x@t.com', role } }
}

function uploadRequest(fileName: string, content: string, projectName?: string): Request {
  const fd = new FormData()
  fd.append('file', new File([content], fileName, { type: 'text/plain' }))
  if (projectName) fd.append('projectName', projectName)
  return new Request('http://t/api/project-interpretation/upload', { method: 'POST', body: fd })
}

const DOC_TEXT = '光子计算芯片创业项目。公司成立于2023年，核心团队来自清华大学电子工程系，拥有光互连芯片设计经验。主要产品为硅光计算加速芯片，已获得某头部互联网公司POC订单，客户包括三家云厂商。本轮拟融资2亿元，用于芯片流片与量产。'

test('POST 上传：txt 提取文本并创建记录（项目名缺省取文件名）', async () => {
  asUser(userId)
  const res = await UPLOAD(uploadRequest('光子芯片BP.txt', DOC_TEXT))
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.interpretation.projectName, '光子芯片BP')
  assert.equal(body.interpretation.status, 'UPLOADED')
  assert.equal(body.interpretation.questionsStatus, 'PENDING')
  assert.match(body.interpretation.fileUrl, /^\/api\/uploads\/interpretation-docs\//)

  // 落库校验：documentText 已提取
  const record = await prisma.projectInterpretation.findUnique({ where: { id: body.interpretation.id } })
  assert.ok(record)
  assert.ok(record!.documentText!.includes('光子计算芯片'))
})

test('POST 上传：自定义项目名生效；未登录 401；无文件 400', async () => {
  asUser(userId)
  const ok = await UPLOAD(uploadRequest('bp.txt', DOC_TEXT, '自定义项目名'))
  assert.equal((await ok.json()).interpretation.projectName, '自定义项目名')

  mockState.session = null
  const noAuth = await UPLOAD(uploadRequest('bp.txt', DOC_TEXT))
  assert.equal(noAuth.status, 401)

  asUser(userId)
  const noFile = await UPLOAD(new Request('http://t/api/project-interpretation/upload', { method: 'POST', body: new FormData() }))
  assert.equal(noFile.status, 400)
})

test('POST 上传：不支持格式 400；空文本/内容过少 400', async () => {
  asUser(userId)
  const badExt = await UPLOAD(uploadRequest('virus.exe', DOC_TEXT))
  assert.equal(badExt.status, 400)
  assert.match((await badExt.json()).error, /不支持的文件类型/)

  const empty = await UPLOAD(uploadRequest('empty.txt', '太短'))
  assert.equal(empty.status, 400)
  assert.match((await empty.json()).error, /无法从文档提取/)
})

test('POST 粘贴文本通道：无文件时用 text 创建记录；过短 400', async () => {
  asUser(userId)
  const fd = new FormData()
  fd.append('text', DOC_TEXT.repeat(2))
  fd.append('projectName', '粘贴项目')
  const res = await UPLOAD(new Request('http://t/api/project-interpretation/upload', { method: 'POST', body: fd }))
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.interpretation.projectName, '粘贴项目')
  assert.equal(body.interpretation.fileName, '粘贴文本.txt')

  const record = await prisma.projectInterpretation.findUnique({ where: { id: body.interpretation.id } })
  assert.ok(record!.documentText!.length > 100)

  // 过短文本 → 400
  const fdShort = new FormData()
  fdShort.append('text', '太短')
  const short = await UPLOAD(new Request('http://t/api/project-interpretation/upload', { method: 'POST', body: fdShort }))
  assert.equal(short.status, 400)
})

test('POST BP+访谈纪要一起上传：访谈全文存入记录，hasInterview=true', async () => {
  asUser(userId)
  const fd = new FormData()
  fd.append('file', new File([DOC_TEXT], 'bp.txt', { type: 'text/plain' }))
  fd.append('projectName', '一起上传项目')
  fd.append('interviewText', '访谈纪要：我们技术业内领先，指标不方便透露，良率在爬坡，订单节奏保密。')
  const res = await UPLOAD(new Request('http://t/api/project-interpretation/upload', { method: 'POST', body: fd }))
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.interpretation.hasInterview, true)

  const record = await prisma.projectInterpretation.findUnique({ where: { id: body.interpretation.id } })
  assert.ok(record!.interviewText!.includes('不方便透露'))
  assert.equal(record!.interviewFileName, null) // 纯粘贴无文件

  // 访谈纪要文件（txt）一起上传：留档 + 提取
  const fd2 = new FormData()
  fd2.append('file', new File([DOC_TEXT], 'bp2.txt', { type: 'text/plain' }))
  fd2.append('interviewFile', new File(['访谈：算力密度 10 TOPS/W，良率 85%。'], '纪要.txt', { type: 'text/plain' }))
  const res2 = await UPLOAD(new Request('http://t/api/project-interpretation/upload', { method: 'POST', body: fd2 }))
  assert.equal(res2.status, 201)
  const record2 = await prisma.projectInterpretation.findUnique({ where: { id: (await res2.json()).interpretation.id } })
  assert.equal(record2!.interviewFileName, '纪要.txt')
  assert.ok(record2!.interviewText!.includes('算力密度'))
  assert.ok(record2!.interviewFileUrl!.includes('interpretation-docs'))

  // 仅上传 BP（无访谈）→ hasInterview=false
  const fd3 = new FormData()
  fd3.append('file', new File([DOC_TEXT], 'bp3.txt', { type: 'text/plain' }))
  const res3 = await UPLOAD(new Request('http://t/api/project-interpretation/upload', { method: 'POST', body: fd3 }))
  assert.equal((await res3.json()).interpretation.hasInterview, false)
})

test('GET 列表：仅本人记录 + 进度统计；详情含问题；他人不可见', async () => {
  asUser(userId)
  const created = await (await UPLOAD(uploadRequest('bp.txt', DOC_TEXT))).json()
  const id = created.interpretation.id as string

  // 造 2 个问题（1 个已校验）验证统计
  await prisma.interpretationQuestion.createMany({
    data: [
      { interpretationId: id, order: 1, category: 'TECH', question: 'Q1', idealAnswer: 'A1' },
      { interpretationId: id, order: 2, category: 'MARKET', question: 'Q2', idealAnswer: 'A2', verifyStatus: 'VERIFIED' },
    ],
  })

  const listRes = await LIST()
  assert.equal(listRes.status, 200)
  const { interpretations } = await listRes.json()
  assert.equal(interpretations.length, 1)
  assert.equal(interpretations[0].questionCount, 2)
  assert.equal(interpretations[0].verifiedCount, 1)

  // 详情：含问题（按 order 排序）
  const detailRes = await DETAIL(new Request(`http://t/api/project-interpretation/${id}`), { params: { id } })
  assert.equal(detailRes.status, 200)
  const detail = (await detailRes.json()).interpretation
  assert.equal(detail.questions.length, 2)
  assert.equal(detail.questions[0].question, 'Q1')
  assert.equal(detail.questions[1].verifyStatus, 'VERIFIED')

  // 他人：列表看不到、详情 404、删除 404
  asUser(otherId)
  const otherList = await LIST()
  assert.equal(((await otherList.json()).interpretations).length, 0)
  assert.equal((await DETAIL(new Request(`http://t/api/project-interpretation/${id}`), { params: { id } })).status, 404)
  assert.equal((await DELETE(new Request(`http://t/api/project-interpretation/${id}`, { method: 'DELETE' }), { params: { id } })).status, 404)
})

test('DELETE：本人删除记录与问题', async () => {
  asUser(userId)
  const created = await (await UPLOAD(uploadRequest('bp.txt', DOC_TEXT))).json()
  const id = created.interpretation.id as string
  await prisma.interpretationQuestion.create({
    data: { interpretationId: id, order: 1, category: 'TECH', question: 'Q', idealAnswer: 'A' },
  })

  const res = await DELETE(new Request(`http://t/api/project-interpretation/${id}`, { method: 'DELETE' }), { params: { id } })
  assert.equal(res.status, 200)
  assert.equal(await prisma.projectInterpretation.count({ where: { id } }), 0)
  assert.equal(await prisma.interpretationQuestion.count({ where: { interpretationId: id } }), 0)

  // 不存在
  assert.equal((await DELETE(new Request('http://t/api/project-interpretation/nope', { method: 'DELETE' }), { params: { id: 'nope' } })).status, 404)
})
