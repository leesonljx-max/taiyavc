/**
 * 行业动态 Runner 测试（V1.5.1 Tavily 调用优化）
 *
 * 核心验证目标：
 * - 搜索阶段：每行业固定 1 次 searchWebDual（原版由子 Agent 自主搜索，一轮可并行多次）
 * - 提取阶段：全部行业分组批量提取（每 5 行业 1 次 DeepSeek）
 * - 10 行业全量：10 次搜索 + 2 次 DeepSeek（原版约 30-50 次搜索 + 10 次 DeepSeek）
 * - 同日缓存复用：已分析行业不重复消耗调用
 * - 指定行业（气泡即时分析）：1 次搜索 + 1 次 DeepSeek
 * - 数据规范化：脏事件清洗 / citations 交叉验证 / 失败行业占位
 */
import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mockState, resetMocks, chatCompletions, searchResult } from './helpers/setup'

// 被测模块：setup.ts 已在 require.cache 注入依赖 mock，此处静态引入即可命中
import { runIndustryNews, getTopIndustries, todayKey } from '@/lib/industry-news-runner'
import prisma from '@/lib/prisma'

const SUFFIX = String(Date.now()).slice(-6)

function industryName(i: number): string {
  return `测试行业${i}号-${SUFFIX}`
}

/** 行业的固定搜索 query（与 searchIndustry 实现一致） */
function searchQueryOf(industry: string): string {
  return `${industry} 融资 产品发布 人事变动 最新动态`
}

/** 从 DeepSeek 提取调用的 body 中解析行业列表 */
function parseIndustriesFromPrompt(body: Record<string, unknown>): string[] {
  const messages = body.messages as Array<{ role: string; content: string }>
  const userContent = messages?.find(m => m.role === 'user')?.content || ''
  return Array.from(userContent.matchAll(/【([^】]+)】/g)).map(m => m[1])
}

beforeEach(async () => {
  resetMocks()
  await prisma.aICache.deleteMany({})
  await prisma.project.deleteMany({})
})

after(async () => {
  await prisma.aICache.deleteMany({})
  await prisma.project.deleteMany({})
  await prisma.$disconnect()
})

// ── 基础工具 ──

test('todayKey 输出本地时区 YYYY-MM-DD 格式', () => {
  assert.match(todayKey(), /^\d{4}-\d{2}-\d{2}$/)
  // 指定日期不受时区影响（本地时间构造）
  assert.equal(todayKey(new Date(2026, 0, 9)), '2026-01-09')
})

// ── 前十行业计算 ──

test('getTopIndustries：按当年项目数降序取前 N，忽略去年与空行业', async () => {
  const year = new Date().getFullYear()
  const userId = await ensureUser()
  const mk = (name: string, industry: string | null, targetYear: number) =>
    prisma.project.create({
      data: {
        name,
        industry,
        totalAmount: '100万',
        targetDate: new Date(targetYear, 5, 1),
        createdById: userId,
      },
    })

  // 当年：A 行业 3 个项目、B 行业 2 个、C 行业 1 个
  await mk(`proj-a1-${SUFFIX}`, `行业A-${SUFFIX}`, year)
  await mk(`proj-a2-${SUFFIX}`, `行业A-${SUFFIX}`, year)
  await mk(`proj-a3-${SUFFIX}`, `行业A-${SUFFIX}`, year)
  await mk(`proj-b1-${SUFFIX}`, `行业B-${SUFFIX}`, year)
  await mk(`proj-b2-${SUFFIX}`, `行业B-${SUFFIX}`, year)
  await mk(`proj-c1-${SUFFIX}`, `行业C-${SUFFIX}`, year)
  // 去年项目不计入（行业 D 有 10 个去年项目，排名应靠后/不出现）
  for (let i = 0; i < 10; i++) {
    await mk(`proj-old-${i}-${SUFFIX}`, `行业D-${SUFFIX}`, year - 1)
  }
  // 空行业不计入
  await mk(`proj-null-${SUFFIX}`, null, year)
  await mk(`proj-blank-${SUFFIX}`, '  ', year)

  const top3 = await getTopIndustries(3)
  assert.equal(top3[0], `行业A-${SUFFIX}`)
  assert.equal(top3[1], `行业B-${SUFFIX}`)
  assert.equal(top3[2], `行业C-${SUFFIX}`)
  assert.ok(!top3.includes(`行业D-${SUFFIX}`), '去年的行业不应进入前十')
})

// ── 核心：10 行业全量分析的调用量 ──

test('10 行业全量：恰好 10 次搜索 + 2 次批量 DeepSeek（原版 30-50 次搜索 + 10 次）', async () => {
  const industries = Array.from({ length: 10 }, (_, i) => industryName(i))

  // 每行业 1 条搜索结果
  for (let i = 0; i < industries.length; i++) {
    mockState.searchResponses.set(searchQueryOf(industries[i]), [
      searchResult(`${industries[i]}融资新闻`, `https://example.com/news/${i}`),
    ])
  }

  // DeepSeek 批量提取：按 prompt 中的行业列表返回每行业 1 条事件
  const urlByIndustry = new Map(industries.map((ind, i) => [ind, `https://example.com/news/${i}`]))
  mockState.fetchHandler = (url, body) => {
    assert.ok(url.includes('api.deepseek.com'), `DeepSeek 调用应指向官方 API，实际 ${url}`)
    const inds = parseIndustriesFromPrompt(body)
    return chatCompletions(
      JSON.stringify({
        industries: inds.map(ind => ({
          industry: ind,
          events: [
            {
              type: '融资',
              company: `${ind}公司`,
              title: `${ind}完成A轮融资`,
              detail: `${ind}领域公司完成新一轮融资。`,
              date: todayKey(),
            },
          ],
          citations: [{ label: '来源', url: urlByIndustry.get(ind) }],
        })),
      })
    )
  }

  const outcome = await runIndustryNews({ industries })

  // ── 核心断言：调用量 ──
  assert.equal(mockState.searchCalls.length, 10, '每行业恰好 1 次搜索')
  assert.equal(
    mockState.fetchCalls.filter(c => c.url.includes('api.deepseek.com')).length,
    2,
    '10 个行业按 5 个一组批量提取，恰好 2 次 DeepSeek'
  )

  // 搜索参数：collect 模式（不做双源归纳，控制成本）
  for (const call of mockState.searchCalls) {
    assert.equal(call.options.mode, 'collect')
    assert.equal(call.options.topic, 'news')
    assert.equal(call.options.maxResults, 5)
    assert.equal(call.options.days, 3)
    assert.equal(call.options.module, 'industry-news')
  }

  // DeepSeek 批量参数
  const deepseekCalls = mockState.fetchCalls.filter(c => c.url.includes('api.deepseek.com'))
  for (const call of deepseekCalls) {
    assert.equal((call.body as { model: string }).model, 'deepseek-v4-flash')
    // 每组恰好 5 个行业的搜索结果
    const inds = parseIndustriesFromPrompt(call.body)
    assert.equal(inds.length, 5, '每次批量提取恰好覆盖 5 个行业')
  }

  // 结果完整性
  assert.equal(outcome.analyzed.length, 10)
  assert.equal(outcome.cards.length, 10)
  for (const card of outcome.cards) {
    assert.equal(card.events.length, 1)
    assert.equal(card.citations.length, 1)
    assert.ok(card.citations[0].url.startsWith('https://example.com/news/'))
  }
})

test('同日缓存复用：第二次全量跑（未指定行业）0 次搜索 0 次提取', async () => {
  const industries = Array.from({ length: 3 }, (_, i) => industryName(100 + i))
  const year = new Date().getFullYear()
  const userId = await ensureUser()
  for (const ind of industries) {
    await prisma.project.create({
      data: {
        name: `cache-${ind}`,
        industry: ind,
        totalAmount: '100万',
        targetDate: new Date(year, 5, 1),
        createdById: userId,
      },
    })
    mockState.searchResponses.set(searchQueryOf(ind), [searchResult(`${ind}新闻`, `https://example.com/c/${ind}`)])
  }
  mockState.fetchHandler = (url, body) =>
    chatCompletions(
      JSON.stringify({
        industries: parseIndustriesFromPrompt(body).map(ind => ({
          industry: ind,
          events: [],
          citations: [],
          note: '当日无重要动态',
        })),
      })
    )

  // 第一次：3 个行业全部分析
  const first = await runIndustryNews({ industries })
  assert.equal(first.analyzed.length, 3)
  assert.equal(mockState.searchCalls.length, 3)

  // 重置计数（缓存数据保留）
  resetMocks()

  // 第二次：不指定行业 → getTopIndustries 返回同样 3 个行业 → 全部命中缓存
  const second = await runIndustryNews({})
  assert.equal(second.analyzed.length, 0, '已缓存行业不应重复分析')
  assert.equal(mockState.searchCalls.length, 0, '缓存命中时 0 次搜索')
  assert.equal(mockState.fetchCalls.length, 0, '缓存命中时 0 次 DeepSeek')
  assert.equal(second.cards.length, 3, '仍返回缓存中的全部卡片')
})

test('force=true：强制重新分析已缓存行业', async () => {
  const ind = industryName(200)
  mockState.searchResponses.set(searchQueryOf(ind), [searchResult(`${ind}新闻`, `https://example.com/f/${ind}`)])
  mockState.fetchHandler = (_url, body) =>
    chatCompletions(
      JSON.stringify({
        industries: parseIndustriesFromPrompt(body).map(i => ({
          industry: i,
          events: [],
          citations: [],
          note: '无动态',
        })),
      })
    )

  await runIndustryNews({ industries: [ind] })
  assert.equal(mockState.searchCalls.length, 1)

  resetMocks()
  mockState.searchResponses.set(searchQueryOf(ind), [searchResult(`${ind}新闻`, `https://example.com/f/${ind}`)])
  mockState.fetchHandler = (_url, body) =>
    chatCompletions(
      JSON.stringify({
        industries: parseIndustriesFromPrompt(body).map(i => ({
          industry: i,
          events: [],
          citations: [],
          note: '无动态',
        })),
      })
    )

  const forced = await runIndustryNews({ industries: [ind], force: true })
  assert.equal(forced.analyzed.length, 1, 'force 应强制重新分析')
  assert.equal(mockState.searchCalls.length, 1)
})

test('气泡即时分析（单行业）：1 次搜索 + 1 次 DeepSeek', async () => {
  const ind = industryName(300)
  mockState.searchResponses.set(searchQueryOf(ind), [searchResult(`${ind}新闻`, `https://example.com/s/${ind}`)])
  mockState.fetchHandler = (url, body) => {
    assert.ok(url.includes('api.deepseek.com'))
    return chatCompletions(
      JSON.stringify({
        industries: [
          {
            industry: ind,
            events: [
              { type: '人事变动', company: `${ind}科技公司`, title: 'CTO 变更', detail: '详情', date: todayKey() },
            ],
            citations: [{ label: '来源', url: `https://example.com/s/${ind}` }],
          },
        ],
      })
    )
  }

  const outcome = await runIndustryNews({ industries: [ind] })
  assert.equal(mockState.searchCalls.length, 1, '单行业即时分析恰好 1 次搜索')
  assert.equal(mockState.fetchCalls.length, 1, '单行业即时分析恰好 1 次提取')
  assert.equal(outcome.cards.length, 1)
  assert.equal(outcome.cards[0].events[0].type, '人事变动')
})

// ── 数据规范化与容错 ──

test('事件规范化：缺字段丢弃、非法日期回退、超限截断、字段截长', async () => {
  const ind = industryName(400)
  const realUrl = `https://example.com/real/${ind}`
  mockState.searchResponses.set(searchQueryOf(ind), [searchResult('新闻标题', realUrl)])

  mockState.fetchHandler = () =>
    chatCompletions(
      JSON.stringify({
        industries: [
          {
            industry: ind,
            events: [
              // 1. 完整事件 → 保留
              { type: '融资', company: '甲公司', title: '甲公司融资', detail: '详情', date: todayKey() },
              // 2. 缺 company → 丢弃
              { type: '融资', title: '无公司事件', detail: 'x', date: todayKey() },
              // 3. 缺 title → 丢弃
              { type: '融资', company: '乙公司', detail: 'x', date: todayKey() },
              // 4. 非法日期 → 回退 today
              { company: '丙公司', title: '丙公司发布', detail: 'x', date: '9999-99-99' },
              // 5. type 缺省 → '其他'
              { company: '丁公司', title: '丁公司动态', detail: 'x', date: todayKey() },
              // 6. title 超长 → 截断 100
              { company: '戊公司', title: '长'.repeat(150), detail: 'x', date: todayKey() },
              // 7-9. 完整事件若干（触发上限 5 截断）
              { company: '己公司', title: '己公司合作', detail: 'x', date: todayKey() },
              { company: '庚公司', title: '庚公司突破', detail: 'x', date: todayKey() },
              { company: '辛公司', title: '辛公司签约', detail: 'x', date: todayKey() },
            ],
            citations: [
              { label: '真实来源', url: realUrl },
              { label: '编造来源', url: 'https://fabricated.example.com/fake' },
              { label: '重复来源', url: realUrl },
              { label: '非http', url: 'ftp://example.com/x' },
            ],
          },
        ],
      })
    )

  const outcome = await runIndustryNews({ industries: [ind] })
  const card = outcome.cards.find(c => c.industry === ind)
  assert.ok(card)

  // 上限 5 条；无 company/title 的被丢弃
  assert.equal(card.events.length, 5)
  assert.ok(card.events.every(e => e.title && e.company))

  // 非法日期回退当天
  const third = card.events.find(e => e.title === '丙公司发布')
  assert.ok(third)
  assert.equal(third.date, todayKey())

  // type 缺省回退
  const fourth = card.events.find(e => e.title === '丁公司动态')
  assert.ok(fourth)
  assert.equal(fourth.type, '其他')

  // title 截断至 100
  const fifth = card.events.find(e => e.title.startsWith('长'))
  assert.ok(fifth)
  assert.equal(fifth.title.length, 100)

  // citations：仅保留真实搜索 URL，去重
  assert.equal(card.citations.length, 1)
  assert.equal(card.citations[0].url, realUrl)
})

test('搜索无结果的行业：产出占位卡片（note），不阻断整体', async () => {
  const good = industryName(500)
  const empty = industryName(501)
  mockState.searchResponses.set(searchQueryOf(good), [searchResult('新闻', `https://example.com/g/${good}`)])
  // empty 未配置 → 返回 searchDefault（[]）

  mockState.fetchHandler = (_url, body) =>
    chatCompletions(
      JSON.stringify({
        industries: parseIndustriesFromPrompt(body).map(i => ({
          industry: i,
          events:
            i === good
              ? [{ company: '公司', title: '事件', detail: 'x', date: todayKey() }]
              : [],
          citations: [],
          note: i === empty ? '该行业暂无相关动态' : undefined,
        })),
      })
    )

  const outcome = await runIndustryNews({ industries: [good, empty] })
  assert.equal(outcome.cards.length, 2)

  const emptyCard = outcome.cards.find(c => c.industry === empty)
  assert.ok(emptyCard)
  assert.equal(emptyCard.events.length, 0)
  assert.equal(emptyCard.note, '该行业暂无相关动态')

  const goodCard = outcome.cards.find(c => c.industry === good)
  assert.ok(goodCard)
  assert.equal(goodCard.events.length, 1)
  assert.ok(!goodCard.note, '有事件的卡片不应有 note')
})

// ── 测试用户（Project.createdById 外键） ──

let cachedUserId: string | null = null
async function ensureUser(): Promise<string> {
  if (cachedUserId) return cachedUserId
  const email = `industry-test-${SUFFIX}@test.local`
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    cachedUserId = existing.id
    return existing.id
  }
  const user = await prisma.user.create({
    data: { email, name: '行业动态测试用户', passwordHash: 'test-hash', role: 'ADMIN' },
  })
  cachedUserId = user.id
  return user.id
}
