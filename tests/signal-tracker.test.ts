/**
 * 自定义跟踪信号执行引擎测试
 *
 * 验证目标：
 * - 调用量控制：每信号每次执行 = 关键词数（≤3）次搜索 + 1 次 DeepSeek 提取
 * - 频率时间窗口：DAILY 看近 2 天、WEEKLY 看近 8 天
 * - 搜索结果按 URL 去重合并
 * - 线索存储：signalId/signalName 标记、source='AI'、同信号同 URL 去重跳过
 * - 关键词非法 JSON 兜底、无关键词/API Key 缺失的错误处理
 * - runDueSignals 调度：周一跑 WEEKLY、每天跑 DAILY、20 小时/6 天窗口防重
 */
import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mockState, resetMocks, chatCompletions, searchResult } from './helpers/setup'

import { runSignalTracking, runDueSignals } from '@/lib/signal-tracker'
import prisma from '@/lib/prisma'

const SUFFIX = String(Date.now()).slice(-6)
const TEST_EMAIL = `signal-test-${SUFFIX}@test.local`

beforeEach(async () => {
  resetMocks()
  await prisma.projectLead.deleteMany({})
  await prisma.trackingSignal.deleteMany({})
})

after(async () => {
  await prisma.projectLead.deleteMany({})
  await prisma.trackingSignal.deleteMany({})
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } })
  await prisma.$disconnect()
})

let cachedUserId: string | null = null
async function ensureUser(): Promise<string> {
  if (cachedUserId) return cachedUserId
  const user = await prisma.user.create({
    data: { email: TEST_EMAIL, name: '信号测试用户', passwordHash: 'test-hash', role: 'ADMIN' },
  })
  cachedUserId = user.id
  return user.id
}

async function createSignal(overrides: Record<string, unknown> = {}) {
  return prisma.trackingSignal.create({
    data: {
      name: '大厂核心成员离职跟踪',
      description: '跟踪大厂或明星项目核心成员离职、创业的信号',
      signalType: 'PERSONNEL_CHANGE',
      keywords: JSON.stringify(['字节跳动 高管 离职 创业', '腾讯 AI 研究员 离职', '明星项目 联创 离职']),
      watchTargets: JSON.stringify(['字节跳动', '腾讯']),
      frequency: 'WEEKLY',
      createdById: await ensureUser(),
      ...overrides,
    } as never,
  })
}

// ── 执行链路 ──

test('WEEKLY 信号：3 组关键词恰好 3 次搜索（days=8）+ 1 次 DeepSeek，线索落库并带信号标记', async () => {
  const signal = await createSignal()

  // 3 组关键词的搜索结果：kw2/kw3 返回相同 URL（验证去重合并）
  mockState.searchResponses.set('字节跳动 高管 离职 创业', [
    searchResult('字节高管离职', 'https://example.com/bytedance-cto', '张三离开字节跳动'),
  ])
  mockState.searchResponses.set('腾讯 AI 研究员 离职', [
    searchResult('腾讯研究员离职', 'https://example.com/tencent-researcher', '李四离开腾讯'),
  ])
  mockState.searchResponses.set('明星项目 联创 离职', [
    searchResult('腾讯研究员离职（重复源）', 'https://example.com/tencent-researcher', '同一事件的另一来源'),
    searchResult('明星项目联创离职', 'https://example.com/star-cofounder', '王五离开明星项目'),
  ])

  mockState.fetchHandler = (url, body) => {
    assert.ok(url.includes('api.deepseek.com'))
    // 提取 prompt 应包含信号描述与监控对象提示
    const system = (body.messages as Array<{ role: string; content: string }>)[0].content
    assert.ok(system.includes('大厂核心成员离职跟踪'))
    assert.ok(system.includes('字节跳动、腾讯'), 'prompt 应包含重点关注对象提示')
    return chatCompletions(
      JSON.stringify({
        leads: [
          {
            eventName: '张三离开字节跳动创业',
            person: '张三',
            company: '字节跳动',
            formerRole: 'AI Lab 负责人',
            newVenture: '三体智能',
            industry: 'AI应用',
            summary: '字节 AI Lab 负责人离职创立三体智能',
            date: '2026-09-08',
            sourceIndex: 0,
          },
          {
            eventName: '李四离开腾讯',
            person: '李四',
            company: '腾讯',
            formerRole: 'AI 研究员',
            newVenture: '',
            industry: '',
            summary: '',
            date: '',
            sourceIndex: 1,
          },
        ],
      })
    )
  }

  const result = await runSignalTracking(signal)

  // 调用量：3 次搜索 + 1 次提取
  assert.equal(mockState.searchCalls.length, 3)
  assert.equal(mockState.fetchCalls.length, 1)

  // WEEKLY 时间窗口
  for (const call of mockState.searchCalls) {
    assert.equal(call.options.days, 8)
    assert.equal(call.options.mode, 'collect')
    assert.equal(call.options.module, 'ai-leads')
    assert.equal(call.options.topic, 'news')
  }

  // 搜索结果 URL 去重：3 组结果共 4 条，唯一 URL 3 条
  assert.equal(result.foundCount, 3)
  assert.equal(result.savedCount, 2)
  assert.equal(result.skippedCount, 0)
  assert.ok(!result.error)

  // 线索落库断言
  const leads = await prisma.projectLead.findMany({ where: { signalId: signal.id } })
  assert.equal(leads.length, 2)

  const lead1 = leads.find(l => l.name === '三体智能')
  assert.ok(lead1, '名称应优先取新动向（newVenture）')
  assert.equal(lead1.source, 'AI')
  assert.equal(lead1.signalId, signal.id)
  assert.equal(lead1.signalName, '大厂核心成员离职跟踪')
  assert.equal(lead1.sourceUrl, 'https://example.com/bytedance-cto')
  assert.equal(lead1.industry, 'AI应用')
  assert.ok(lead1.description?.includes('原AI Lab 负责人'), '描述应拼接原职务')
  assert.equal(lead1.releasedAt, null, '信号线索先归属创建者，不立即释放')

  const lead2 = leads.find(l => l.name === '腾讯')
  assert.ok(lead2, '无新动向时名称回退取公司名')
  assert.equal(lead2.industry, null, 'lead 未填行业时回退信号行业（信号行业为空 → null）')

  // 信号执行状态更新
  const updated = await prisma.trackingSignal.findUnique({ where: { id: signal.id } })
  assert.ok(updated)
  assert.equal(updated.lastRunCount, 2)
  assert.ok(updated.lastRunAt)
})

test('DAILY 信号：搜索时间窗口为近 2 天', async () => {
  const signal = await createSignal({ frequency: 'DAILY' })
  mockState.fetchHandler = () => chatCompletions('{"leads":[]}')

  await runSignalTracking(signal)

  assert.equal(mockState.searchCalls.length, 3)
  for (const call of mockState.searchCalls) {
    assert.equal(call.options.days, 2)
  }
})

test('同信号同来源 URL 已存在：跳过不重复入库', async () => {
  const signal = await createSignal({
    keywords: JSON.stringify(['大厂 高管 离职']),
  })
  const url = 'https://example.com/existing-lead'
  mockState.searchResponses.set('大厂 高管 离职', [searchResult('已有来源', url)])
  mockState.fetchHandler = () =>
    chatCompletions(
      JSON.stringify({
        leads: [
          {
            eventName: '赵六离开大厂创业',
            person: '赵六',
            company: '某大厂',
            newVenture: '新月科技',
            sourceIndex: 0,
          },
        ],
      })
    )

  // 预插一条同信号同 URL 的已有线索（名称不同，验证 URL 条件命中）
  await prisma.projectLead.create({
    data: {
      name: '已有线索（旧名称）',
      source: 'AI',
      sourceUrl: url,
      signalId: signal.id,
      signalName: signal.name,
      createdById: signal.createdById,
    },
  })

  const result = await runSignalTracking(signal)
  assert.equal(result.savedCount, 0)
  assert.equal(result.skippedCount, 1, '同信号同 URL 应跳过')

  const count = await prisma.projectLead.count({ where: { signalId: signal.id } })
  assert.equal(count, 1, '不产生重复记录')
})

test('keywords 存非法 JSON：兜底按整串当一组关键词', async () => {
  const signal = await createSignal({ keywords: '字节跳动 离职 创业' })
  mockState.fetchHandler = () => chatCompletions('{"leads":[]}')

  const result = await runSignalTracking(signal)
  assert.ok(!result.error)
  assert.equal(mockState.searchCalls.length, 1)
  assert.equal(mockState.searchCalls[0].query, '字节跳动 离职 创业')
})

test('无有效关键词：返回错误且零调用', async () => {
  const signal = await createSignal({ keywords: '   ' })
  const result = await runSignalTracking(signal)
  assert.ok(result.error?.includes('关键词'))
  assert.equal(mockState.searchCalls.length, 0)
  assert.equal(mockState.fetchCalls.length, 0)
})

test('DEEPSEEK_API_KEY 缺失：返回错误且零调用', async () => {
  const signal = await createSignal()
  const savedKey = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try {
    const result = await runSignalTracking(signal)
    assert.ok(result.error?.includes('DeepSeek API Key'))
    assert.equal(mockState.searchCalls.length, 0)
  } finally {
    if (savedKey) process.env.DEEPSEEK_API_KEY = savedKey
  }
})

test('DeepSeek 未提取到符合事件：0 保存，lastRunCount 更新为 0', async () => {
  const signal = await createSignal()
  mockState.fetchHandler = () => chatCompletions('{"leads":[]}')

  const result = await runSignalTracking(signal)
  assert.equal(result.savedCount, 0)
  assert.ok(!result.error)

  const updated = await prisma.trackingSignal.findUnique({ where: { id: signal.id } })
  assert.ok(updated)
  assert.equal(updated.lastRunCount, 0)
  assert.ok(updated.lastRunAt)
})

test('搜索全部失败：foundCount=0，不调用 DeepSeek', async () => {
  const signal = await createSignal()
  // 未配置 searchResponses 且 searchDefault 为空 → 所有搜索返回 []

  const result = await runSignalTracking(signal)
  assert.equal(mockState.searchCalls.length, 3)
  assert.equal(result.foundCount, 0)
  assert.equal(mockState.fetchCalls.length, 0, '无搜索结果不应调用 DeepSeek 提取')
})

// ── 调度（cron）──

test('runDueSignals：周一执行到期 WEEKLY；20 小时/6 天窗口防重；非周一仅 DAILY', async () => {
  const userId = await ensureUser()
  const now = Date.now()

  const mkSignal = (frequency: 'DAILY' | 'WEEKLY', lastRunAt: Date | null) =>
    prisma.trackingSignal.create({
      data: {
        name: `调度信号-${frequency}-${Math.random().toString(36).slice(2, 6)}`,
        description: '调度测试信号',
        keywords: JSON.stringify(['测试关键词 离职']),
        frequency,
        lastRunAt,
        createdById: userId,
      },
    })

  // s1: DAILY，从未执行 → 周一应执行
  const s1 = await mkSignal('DAILY', null)
  // s2: DAILY，1 小时前刚执行 → 不执行（< 20h）
  const s2 = await mkSignal('DAILY', new Date(now - 1 * 3600_000))
  // s3: WEEKLY，从未执行 → 周一应执行
  const s3 = await mkSignal('WEEKLY', null)
  // s4: WEEKLY，1 天前执行 → 周一不执行（< 6 天）
  const s4 = await mkSignal('WEEKLY', new Date(now - 1 * 86_400_000))

  // 全局默认搜索结果 + 空提取
  mockState.searchDefault = [searchResult('默认新闻', 'https://example.com/due-signal')]
  mockState.fetchHandler = () => chatCompletions('{"leads":[]}')

  // 周一（dayOfWeek=1）
  await runDueSignals(1)

  const afterMonday = await prisma.trackingSignal.findMany({
    where: { id: { in: [s1.id, s2.id, s3.id, s4.id] } },
  })
  const byId = new Map(afterMonday.map(s => [s.id, s]))
  assert.ok(byId.get(s1.id)?.lastRunAt, '周一：从未执行的 DAILY 应执行')
  assert.equal(byId.get(s2.id)?.lastRunAt?.getTime(), s2.lastRunAt?.getTime(), '20 小时内已执行的不重复')
  assert.ok(byId.get(s3.id)?.lastRunAt, '周一：从未执行的 WEEKLY 应执行')
  assert.equal(byId.get(s4.id)?.lastRunAt?.getTime(), s4.lastRunAt?.getTime(), '6 天内已执行的 WEEKLY 不重复')

  // 周三（dayOfWeek=3）：WEEKLY 不执行
  const s5 = await mkSignal('WEEKLY', null) // 新的从未执行的 WEEKLY
  const s6 = await mkSignal('DAILY', new Date(now - 25 * 3600_000)) // 25 小时前执行 → 应执行
  resetMocks()
  mockState.searchDefault = [searchResult('默认新闻', 'https://example.com/due-signal')]
  mockState.fetchHandler = () => chatCompletions('{"leads":[]}')

  await runDueSignals(3)

  const afterWednesday = await prisma.trackingSignal.findMany({
    where: { id: { in: [s5.id, s6.id] } },
  })
  const byId2 = new Map(afterWednesday.map(s => [s.id, s]))
  assert.ok(!byId2.get(s5.id)?.lastRunAt, '非周一：WEEKLY 不执行')
  assert.ok(byId2.get(s6.id)?.lastRunAt, '超过 20 小时的 DAILY 应执行')
})
