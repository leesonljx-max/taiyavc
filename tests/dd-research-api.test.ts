/**
 * 尽调研究层 API + 数据库集成测试
 *
 * 覆盖：鉴权 / 研究 Run 生命周期与 24h 幂等 / 事实确认 / 缺口清单与豁免
 *      / 非分类资料上传-归类-删除 / 报告生成门槛与 PPTX 下载拦截
 */

import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { unlink } from 'fs/promises'
import { join } from 'path'
import prisma from '@/lib/prisma'
import { resetMocks, mockState } from './helpers/setup'
import { ASSET_DIR } from '@/lib/dd-ingest/unclassified'

import { GET as STATUS_GET } from '@/app/api/dd/research/[projectId]/status/route'
import { POST as RUN_POST } from '@/app/api/dd/research/[projectId]/run/route'
import { PATCH as FACT_PATCH } from '@/app/api/dd/research/facts/[factId]/route'
import { GET as GAPS_GET } from '@/app/api/dd/gaps/[projectId]/route'
import { POST as WAIVE_POST } from '@/app/api/dd/gaps/[projectId]/[gapId]/waive/route'
import { POST as ASSET_POST } from '@/app/api/dd/unclassified/[projectId]/route'
import { PATCH as ASSET_PATCH, DELETE as ASSET_DELETE } from '@/app/api/dd/unclassified/[projectId]/[assetId]/route'
import { POST as DECK_POST } from '@/app/api/dd/decks/[projectId]/route'
import { GET as PPTX_GET } from '@/app/api/dd/deck/[deckId]/pptx/route'
import { computeDeckFingerprint, computeResearchFingerprint } from '@/lib/dd-research/fingerprint'
import { createDeck } from '@/lib/dd-deck/queue'

const SUFFIX = String(Date.now()).slice(-6)
const PREFIX = `D4测试项目${SUFFIX}`
const MANAGER_EMAIL = `d4-mgr-${SUFFIX}@test.com`
const OUTSIDER_EMAIL = `d4-out-${SUFFIX}@test.com`
const PARTNER_EMAIL = `d4-p-${SUFFIX}@test.com`
const ALL_EMAILS = [MANAGER_EMAIL, OUTSIDER_EMAIL, PARTNER_EMAIL]

let managerId = ''
let outsiderId = ''
let partnerId = ''
let projectId = ''

/** 按测试项目名/邮箱前缀清理（先子表后项目） */
async function cleanup() {
  const projects = await prisma.project.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  })
  const pids = projects.map(p => p.id)

  if (pids.length > 0) {
    const runs = await prisma.dDResearchRun.findMany({
      where: { projectId: { in: pids } },
      select: { id: true },
    })
    const runIds = runs.map(r => r.id)
    const decks = await prisma.dDSlideDeck.findMany({
      where: { projectId: { in: pids } },
      select: { id: true },
    })
    const deckIds = decks.map(d => d.id)
    const assets = await prisma.dDUnclassifiedAsset.findMany({
      where: { projectId: { in: pids } },
      select: { fileUrl: true },
    })

    if (deckIds.length > 0) {
      await prisma.dDSlide.deleteMany({ where: { deckId: { in: deckIds } } })
    }
    if (runIds.length > 0) {
      await prisma.dDResearchFact.deleteMany({ where: { runId: { in: runIds } } })
      await prisma.dDResearchSource.deleteMany({ where: { runId: { in: runIds } } })
      await prisma.dDModuleResearch.deleteMany({ where: { runId: { in: runIds } } })
    }
    await prisma.dDGap.deleteMany({ where: { projectId: { in: pids } } })
    await prisma.dDUnclassifiedAsset.deleteMany({ where: { projectId: { in: pids } } })
    await prisma.dDSlideDeck.deleteMany({ where: { projectId: { in: pids } } })
    await prisma.dDModuleResource.deleteMany({ where: { projectId: { in: pids } } })
    await prisma.project.deleteMany({ where: { id: { in: pids } } })

    // 清理 public/dd-unclassified 下测试文件
    for (const a of assets) {
      const fileName = a.fileUrl.split('/').pop()
      if (!fileName) continue
      await unlink(join(ASSET_DIR, fileName)).catch(() => undefined)
    }
  }

  await prisma.user.deleteMany({ where: { email: { in: ALL_EMAILS } } })
}

beforeEach(async () => {
  resetMocks()
  await cleanup()

  managerId = (await prisma.user.create({
    data: { email: MANAGER_EMAIL, name: '维护经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
  outsiderId = (await prisma.user.create({
    data: { email: OUTSIDER_EMAIL, name: '外部经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER', status: 'ACTIVE' },
  })).id
  partnerId = (await prisma.user.create({
    data: { email: PARTNER_EMAIL, name: '合伙人', passwordHash: 'x', role: 'INVESTMENT_PARTNER', status: 'ACTIVE' },
  })).id

  projectId = (await prisma.project.create({
    data: {
      name: PREFIX,
      companyFullName: '星辰科技有限公司',
      industry: '半导体',
      totalAmount: '500万',
      targetDate: new Date(),
      followStage: 'DUE_DILIGENCE',
      createdById: managerId,
    },
  })).id
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

function asUser(id: string, role: string) {
  mockState.session = { user: { id, name: null, email: 'x@test.com', role } }
}
const asManager = () => asUser(managerId, 'INVESTMENT_MANAGER')
const asPartner = () => asUser(partnerId, 'INVESTMENT_PARTNER')

const statusUrl = (pid = projectId) => `http://t/api/dd/research/${pid}/status`
const runUrl = (pid = projectId) => `http://t/api/dd/research/${pid}/run`
const gapsUrl = (pid = projectId) => `http://t/api/dd/gaps/${pid}`
const unclassifiedUrl = (pid = projectId) => `http://t/api/dd/unclassified/${pid}`
const assetUrl = (assetId: string, pid = projectId) => `${unclassifiedUrl(pid)}/${assetId}`
const decksUrl = (pid = projectId) => `http://t/api/dd/decks/${pid}`

async function seedDoneRun() {
  return prisma.dDResearchRun.create({
    data: {
      projectId,
      status: 'DONE',
      phase: 'GAP',
      progress: 100,
      statsJson: JSON.stringify({ sourceCount: 2, factCount: 3 }),
    },
  })
}

/** 轮询等待 Run 进入终态（最多 timeoutMs） */
async function waitForTerminal(runId: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const run = await prisma.dDResearchRun.findUnique({ where: { id: runId } })
    if (run && ['DONE', 'PARTIAL', 'FAILED'].includes(run.status)) return run
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return prisma.dDResearchRun.findUnique({ where: { id: runId } })
}

// ── 鉴权 ──

test('鉴权：无 session → 401；非项目成员的投资经理 → 403', async () => {
  mockState.session = null
  let res: Response = await STATUS_GET(new Request(statusUrl()), { params: { projectId } })
  assert.equal(res.status, 401)

  asUser(outsiderId, 'INVESTMENT_MANAGER')
  res = await STATUS_GET(new Request(statusUrl()), { params: { projectId } })
  assert.equal(res.status, 403)

  // 项目维护人可正常读取
  asManager()
  res = await STATUS_GET(new Request(statusUrl()), { params: { projectId } })
  assert.equal(res.status, 200)
})

// ── 研究 Run ──

test('GET status：返回最新 Run 状态与 stats', async () => {
  asManager()
  const run = await seedDoneRun()

  const res = await STATUS_GET(new Request(statusUrl()), { params: { projectId } })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.run.id, run.id)
  assert.equal(body.run.status, 'DONE')
  assert.equal(body.stats.sourceCount, 2)
  assert.equal(body.stats.factCount, 3)
  assert.equal(Array.isArray(body.modules), true)
})

test('POST run：无可用来源时后台队列将 Run 置为 FAILED', async () => {
  asManager()
  // mock 搜索默认返回空数组
  const res = await RUN_POST(
    new Request(runUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    { params: { projectId } }
  )
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(body.runId, '应返回 runId')
  assert.equal(body.existing, false)

  const finished = await waitForTerminal(body.runId)
  assert.ok(finished, 'Run 应存在')
  assert.equal(finished?.status, 'FAILED')
  assert.ok(finished?.finishedAt, '终态应写入 finishedAt')
  assert.ok(finished?.error?.includes('未检索到'), `失败原因应说明无来源：${finished?.error}`)
})

test('POST run：24h 内已有 DONE Run 时幂等返回 existing=true', async () => {
  asManager()
  const seeded = await seedDoneRun()

  const res = await RUN_POST(new Request(runUrl(), { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.existing, true)
  assert.equal(body.runId, seeded.id)
  assert.equal(body.status, 'DONE')

  // 不应产生新 Run
  const count = await prisma.dDResearchRun.count({ where: { projectId } })
  assert.equal(count, 1)
})

test('POST run：同指纹复用 Run；项目资料变化后生成新版本', async () => {
  asManager()
  const fingerprint = await computeResearchFingerprint(projectId)
  const seeded = await prisma.dDResearchRun.create({
    data: { projectId, status: 'DONE', phase: 'GAP', progress: 100, inputFingerprint: fingerprint },
  })

  let res = await RUN_POST(new Request(runUrl(), { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 200)
  let body = await res.json()
  assert.equal(body.existing, true)
  assert.equal(body.runId, seeded.id)

  // 项目核心字段变化 → 指纹变化 → 必须重新研究
  await prisma.project.update({ where: { id: projectId }, data: { mainProducts: '新一代AI芯片' } })
  res = await RUN_POST(new Request(runUrl(), { method: 'POST' }), { params: { projectId } })
  assert.equal(res.status, 200)
  body = await res.json()
  assert.equal(body.existing, false)
  assert.notEqual(body.runId, seeded.id)

  await waitForTerminal(body.runId)
})

// ── 事实确认 ──

test('PATCH 事实：CONFIRMED 落库；非法 status → 400', async () => {
  asManager()
  const run = await seedDoneRun()
  const source = await prisma.dDResearchSource.create({
    data: {
      runId: run.id,
      moduleKey: 'PRODUCT_TECHNOLOGY',
      url: 'https://www.gov.cn/fact-source',
      title: '官方来源',
      domain: 'gov.cn',
      grade: 'A',
      sourceType: 'OFFICIAL',
    },
  })
  const fact = await prisma.dDResearchFact.create({
    data: {
      runId: run.id,
      moduleKey: 'PRODUCT_TECHNOLOGY',
      fact: '公司已获得发明专利 12 项',
      quote: '公司已获得发明专利 12 项',
      sourceId: source.id,
      confidence: 0.9,
      grade: 'A',
      importance: 'CORE',
      status: 'PENDING',
    },
  })

  const patch = (body: unknown) =>
    FACT_PATCH(
      new Request(`http://t/api/dd/research/facts/${fact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: { factId: fact.id } }
    )

  let res: Response = await patch({ status: 'INVALID' })
  assert.equal(res.status, 400)

  res = await patch({ status: 'CONFIRMED' })
  assert.equal(res.status, 200)
  const updated = await prisma.dDResearchFact.findUnique({ where: { id: fact.id } })
  assert.equal(updated?.status, 'CONFIRMED')
})

// ── 缺口 ──

test('GET gaps：无 Run 时 total=0；有 BLOCKING OPEN 缺口时返回中文模块名', async () => {
  asManager()

  let res: Response = await GAPS_GET(new Request(gapsUrl()), { params: { projectId } })
  assert.equal(res.status, 200)
  let body = await res.json()
  assert.equal(body.summary.total, 0)
  assert.equal(body.gaps.length, 0)

  const gap = await prisma.dDGap.create({
    data: {
      projectId,
      moduleKey: 'PROJECT_ENTITY',
      gapKey: 'BUSINESS_REGISTRATION',
      label: '工商登记与主体信息',
      severity: 'BLOCKING',
      status: 'OPEN',
    },
  })

  body = await (await GAPS_GET(new Request(gapsUrl()), { params: { projectId } })).json()
  assert.equal(body.summary.total, 1)
  assert.equal(body.summary.blocking, 1)
  assert.equal(body.gaps[0].id, gap.id)
  assert.equal(body.gaps[0].moduleName, '项目与主体')
})

test('POST waive：维护人 403；合伙人理由 <4 字 400；合法理由置为 WAIVED', async () => {
  const gap = await prisma.dDGap.create({
    data: {
      projectId,
      moduleKey: 'FINANCE_ECONOMICS',
      gapKey: 'FINANCIAL_STATEMENTS',
      label: '三表与管理报表',
      severity: 'BLOCKING',
      status: 'OPEN',
    },
  })
  const waiveUrl = `http://t/api/dd/gaps/${projectId}/${gap.id}/waive`
  const waive = (reason: string) =>
    WAIVE_POST(
      new Request(waiveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }),
      { params: { projectId, gapId: gap.id } }
    )

  asManager()
  let res: Response = await waive('公开信息无法获取')
  assert.equal(res.status, 403)

  asPartner()
  res = await waive('无')
  assert.equal(res.status, 400)

  res = await waive('公开信息无法获取，已由公司书面确认')
  assert.equal(res.status, 200)
  const updated = await prisma.dDGap.findUnique({ where: { id: gap.id } })
  assert.equal(updated?.status, 'WAIVED')
  assert.equal(updated?.waivedBy, partnerId)
  assert.ok(updated?.waiveReason?.includes('公开信息无法获取'))
})

// ── 非分类资料 ──

test('非分类资料：上传 txt → READY；归类后写入模块 documents；删除后移除引用；无 session → 401', async () => {
  asManager()

  const fd = new FormData()
  const file = new File([Buffer.from('测试内容'.repeat(20))], 'note.txt', { type: 'text/plain' })
  fd.append('file', file)

  let res: Response = await ASSET_POST(new Request(unclassifiedUrl(), { method: 'POST', body: fd }), {
    params: { projectId },
  })
  assert.equal(res.status, 200)
  let body = await res.json()
  assert.equal(body.asset.ocrStatus, 'READY')
  assert.equal(body.asset.fileName, 'note.txt')
  const assetId: string = body.asset.id
  assert.ok(assetId)

  // 归类到产品与技术
  res = await ASSET_PATCH(
    new Request(assetUrl(assetId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moduleKey: 'PRODUCT_TECHNOLOGY' }),
    }),
    { params: { projectId, assetId } }
  )
  assert.equal(res.status, 200)

  const docId = `asset-${assetId}`
  const readDocIds = async () => {
    const record = await prisma.dDModuleResource.findUnique({
      where: { projectId_moduleKey: { projectId, moduleKey: 'PRODUCT_TECHNOLOGY' } },
    })
    if (!record?.documents) return [] as string[]
    const parsed = JSON.parse(record.documents) as Array<{ id: string }>
    return parsed.map(d => d.id)
  }
  assert.ok((await readDocIds()).includes(docId), '模块 documents 应包含 asset-<id>')

  // 删除前去掉 session → 401
  mockState.session = null
  res = await ASSET_DELETE(new Request(assetUrl(assetId), { method: 'DELETE' }), {
    params: { projectId, assetId },
  })
  assert.equal(res.status, 401)

  asManager()
  res = await ASSET_DELETE(new Request(assetUrl(assetId), { method: 'DELETE' }), {
    params: { projectId, assetId },
  })
  assert.equal(res.status, 200)
  assert.equal((await readDocIds()).includes(docId), false, '删除后模块 documents 不应再引用该资料')
  assert.equal(await prisma.dDUnclassifiedAsset.count({ where: { id: assetId } }), 0)
})

// ── 报告生成拦截 ──

test('POST decks：存在阻塞缺口时仍生成 FINAL 草稿并返回 gaps 提示', async () => {
  asManager()
  await seedDoneRun()
  const gap = await prisma.dDGap.create({
    data: {
      projectId,
      moduleKey: 'PROJECT_ENTITY',
      gapKey: 'CAP_TABLE',
      label: '股权结构与历史沿革',
      severity: 'BLOCKING',
      status: 'OPEN',
    },
  })

  const res = await DECK_POST(
    new Request(decksUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'FINAL' }),
    }),
    { params: { projectId } }
  )
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(Array.isArray(body.gaps))
  assert.equal(body.gaps[0].id, gap.id)
  assert.ok(body.warnings.some((w: string) => w.includes('待补充资料')))

  // 零补充资料也允许生成草稿版本
  const decks = await prisma.dDSlideDeck.findMany({ where: { projectId } })
  assert.equal(decks.length, 1)
  assert.equal(decks[0].type, 'FINAL')
})

test('createDeck：同指纹 READY 报告直接复用；force 生成新版本', async () => {
  asManager()
  const run = await seedDoneRun()
  const { fingerprint } = await computeDeckFingerprint(projectId, 'BRIEF')
  const ready = await prisma.dDSlideDeck.create({
    data: {
      projectId,
      type: 'BRIEF',
      status: 'READY',
      version: 1,
      templateVersion: 'v2.8',
      inputFingerprint: fingerprint,
      researchRunId: run.id,
      generatedBy: managerId,
    },
  })

  // 资料未变化：直接复用，不新建
  const reused = await createDeck(projectId, 'BRIEF', managerId)
  assert.equal(reused.existing, true)
  assert.equal(reused.deckId, ready.id)
  assert.equal(reused.version, 1)
  assert.equal(await prisma.dDSlideDeck.count({ where: { projectId, type: 'BRIEF' } }), 1)

  // force：生成新版本，版本号递增
  const forced = await createDeck(projectId, 'BRIEF', managerId, { force: true })
  assert.equal(forced.existing, false)
  assert.equal(forced.version, 2)
  const created = await prisma.dDSlideDeck.findUnique({ where: { id: forced.deckId } })
  assert.equal(created?.status, 'QUEUED')
  assert.equal(created?.version, 2)
  assert.equal(created?.researchRunId, run.id)
})

test('GET pptx：Deck 仍为 QUEUED 时返回 400', async () => {
  asManager()
  const deck = await prisma.dDSlideDeck.create({
    data: {
      projectId,
      type: 'BRIEF',
      status: 'QUEUED',
      generatedBy: managerId,
    },
  })

  const res = await PPTX_GET(new Request(`http://t/api/dd/deck/${deck.id}/pptx`), {
    params: { deckId: deck.id },
  })
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.ok(body.error.includes('尚未生成完成'))
})
