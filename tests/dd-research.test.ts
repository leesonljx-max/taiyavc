/**
 * 尽调研究层纯函数单元测试
 *
 * 覆盖：查询规划 / 来源分级 / 覆盖度 / 事实抽取 / 幻灯片规格校验
 *      / 缺口关键词判定 / 非分类资料校验 / 缺口统计
 */

import './helpers/setup'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { resetMocks, mockState, chatCompletions } from './helpers/setup'

import {
  DD_MODULE_KEYS,
  DD_SEARCH_BUDGET,
  gradeSource,
  sourceTypeOf,
  moduleStatusFromCoverage,
  domainOf,
} from '@/lib/dd-research/constants'
import { buildQueryPlan, type ResearchProjectInput } from '@/lib/dd-research/planner'
import { computeModuleCoverage } from '@/lib/dd-research/coverage'
import { extractModuleFacts } from '@/lib/dd-research/extract'
import { evaluateRequirementCoverage, gapStatsByModule } from '@/lib/dd-research/gap'
import type { ResearchSourceDraft } from '@/lib/dd-research/search'
import {
  validateDeckSpec,
  coerceDeckSpec,
  type DeckSpec,
  type SlideSpec,
  type SlideLayout,
} from '@/lib/dd-deck/spec'
import { validateAsset } from '@/lib/dd-ingest/unclassified'

beforeEach(() => {
  resetMocks()
})

const PROJECT: ResearchProjectInput = {
  name: '星辰科技',
  companyFullName: '星辰科技有限公司',
  industry: '半导体',
  financingRound: 'A轮',
  competitors: '华光科技',
}

// ── 查询规划 ──

test('buildQueryPlan：九大模块、每模块 4–6 条、总量不超过预算、含公司名与行业词', () => {
  const plan = buildQueryPlan(PROJECT)

  assert.equal(plan.length, 9)
  assert.deepEqual(plan.map(p => p.moduleKey), [...DD_MODULE_KEYS])

  for (const item of plan) {
    assert.ok(item.queries.length >= 4, `${item.moduleKey} 查询过少`)
    assert.ok(item.queries.length <= 6, `${item.moduleKey} 查询过多`)
    assert.ok(item.moduleName.length > 0)
    assert.ok(item.coreQuestion.length > 0)
  }

  const total = plan.reduce((sum, p) => sum + p.queries.length, 0)
  assert.ok(total <= DD_SEARCH_BUDGET.maxSearches, `总查询 ${total} 超过预算 ${DD_SEARCH_BUDGET.maxSearches}`)

  const allQueries = plan.flatMap(p => p.queries).join('\n')
  assert.ok(allQueries.includes('星辰科技有限公司') || allQueries.includes('星辰科技'), '查询应包含公司名')
  assert.ok(allQueries.includes('半导体'), '查询应包含行业关键词')

  // 每个模块的查询串不为空
  for (const item of plan) {
    for (const q of item.queries) assert.ok(q.trim().length > 0)
  }
})

test('buildQueryPlan：指定模块只返回该模块；重复调用结果稳定', () => {
  const single = buildQueryPlan(PROJECT, ['PRODUCT_TECHNOLOGY'])
  assert.equal(single.length, 1)
  assert.equal(single[0].moduleKey, 'PRODUCT_TECHNOLOGY')
  assert.ok(single[0].queries.length >= 4 && single[0].queries.length <= 6)

  const a = buildQueryPlan(PROJECT, undefined, { year: 2025 })
  const b = buildQueryPlan(PROJECT, undefined, { year: 2025 })
  assert.deepEqual(a, b, '同一输入重复调用结果应一致，不得含随机因素')

  // 非法模块被过滤
  assert.equal(buildQueryPlan(PROJECT, ['NOT_A_MODULE']).length, 0)
})

// ── 来源分级 ──

test('gradeSource：政府/公共机构 A、主流财经媒体 B、未知站点 C、社交与论坛 D', () => {
  assert.equal(gradeSource('https://www.gov.cn/zhengce/content/2024.htm'), 'A')
  assert.equal(gradeSource('https://www.stats.gov.cn/sj/zxfb/'), 'A')
  assert.equal(gradeSource('https://www.sse.com.cn/disclosure/'), 'A')
  assert.equal(gradeSource('https://www.cnipa.gov.cn/col/col1/index.html'), 'A')
  // 事业单位 / 高校 / 科研机构官网同样视为官方来源
  assert.equal(gradeSource('https://www.cas.cn/zkyw/202401/t20240101.shtml'), 'A')
  assert.equal(gradeSource('https://www.tsinghua.edu.cn/info/1234.htm'), 'A')

  assert.equal(gradeSource('https://36kr.com/p/123456'), 'B')
  assert.equal(gradeSource('https://www.caixin.com/2024-01-01/101.htm'), 'B')
  assert.equal(gradeSource('https://www.iresearch.com.cn/report.shtml'), 'B')

  assert.equal(gradeSource('https://news.example-aggregator.cn/article/1'), 'C')

  assert.equal(gradeSource('https://weibo.com/u/123'), 'D')
  assert.equal(gradeSource('https://www.zhihu.com/question/1'), 'D')
  assert.equal(gradeSource('https://someblog.example.com/post'), 'D')
  assert.equal(gradeSource('https://forum.example.com/thread'), 'D')
  // 无法解析的 URL → D
  assert.equal(gradeSource('not-a-url'), 'D')
  assert.equal(gradeSource(''), 'D')
})

test('sourceTypeOf：A→OFFICIAL、B→REPORT、C→MEDIA、D→WEB', () => {
  assert.equal(sourceTypeOf('A'), 'OFFICIAL')
  assert.equal(sourceTypeOf('B'), 'REPORT')
  assert.equal(sourceTypeOf('C'), 'MEDIA')
  assert.equal(sourceTypeOf('D'), 'WEB')
})

// ── 模块覆盖度状态 ──

test('moduleStatusFromCoverage：0.75 READY / 0.35 PARTIAL 边界', () => {
  assert.equal(moduleStatusFromCoverage(1), 'READY')
  assert.equal(moduleStatusFromCoverage(0.75), 'READY')
  assert.equal(moduleStatusFromCoverage(0.7499), 'PARTIAL')
  assert.equal(moduleStatusFromCoverage(0.35), 'PARTIAL')
  assert.equal(moduleStatusFromCoverage(0.3499), 'INSUFFICIENT')
  assert.equal(moduleStatusFromCoverage(0), 'INSUFFICIENT')
})

// ── 覆盖度计算 ──

test('computeModuleCoverage：空输入为 0；3 条 CORE + 5 来源 + 1 条 A 级为 1', () => {
  const empty = computeModuleCoverage('PRODUCT_TECHNOLOGY', [], [])
  assert.equal(empty.coverage, 0)
  assert.equal(empty.status, 'INSUFFICIENT')
  assert.equal(empty.coreFacts, 0)
  assert.equal(empty.hasOfficial, false)

  const facts = Array.from({ length: 3 }, () => ({ importance: 'CORE', confidence: 0.5, status: 'PENDING' }))
  const sources = [
    { grade: 'A' as const },
    { grade: 'B' as const },
    { grade: 'C' as const },
    { grade: 'C' as const },
    { grade: 'D' as const },
  ]
  const full = computeModuleCoverage('PRODUCT_TECHNOLOGY', facts, sources)
  assert.equal(full.coreFacts, 3)
  assert.equal(full.sourceCount, 5)
  assert.equal(full.hasOfficial, true)
  assert.equal(full.coverage, 1)
  assert.equal(full.status, 'READY')
})

test('computeModuleCoverage：CORE 置信度 0.4 不计入；CONFLICT 且置信度 <0.5 被过滤', () => {
  const lowConfidence = computeModuleCoverage(
    'PRODUCT_TECHNOLOGY',
    Array.from({ length: 3 }, () => ({ importance: 'CORE', confidence: 0.4, status: 'PENDING' })),
    Array.from({ length: 5 }, () => ({ grade: 'C' as const }))
  )
  assert.equal(lowConfidence.coreFacts, 0)
  assert.equal(lowConfidence.coverage, 0.2) // 仅来源分 0.2

  const conflictFiltered = computeModuleCoverage(
    'PRODUCT_TECHNOLOGY',
    [{ importance: 'CORE', confidence: 0.4, status: 'CONFLICT' }],
    []
  )
  assert.equal(conflictFiltered.coreFacts, 0)
  assert.equal(conflictFiltered.coverage, 0)
  // factCount 仍记录原始事实数
  assert.equal(conflictFiltered.factCount, 1)

  const conflictKept = computeModuleCoverage(
    'PRODUCT_TECHNOLOGY',
    [{ importance: 'CORE', confidence: 0.9, status: 'CONFLICT' }],
    []
  )
  assert.equal(conflictKept.coreFacts, 1)
  assert.equal(conflictKept.coverage, 0.2)
})

// ── 事实抽取 ──

function draft(url: string, grade: 'A' | 'B' | 'C' | 'D', content = '来源正文内容，用于抽取事实。'): ResearchSourceDraft {
  return {
    moduleKey: 'PRODUCT_TECHNOLOGY',
    url,
    title: url,
    domain: domainOf(url),
    snippet: content.slice(0, 240),
    content,
    sourceType: sourceTypeOf(grade),
    grade,
    contentHash: `h-${url}`,
  }
}

function mockExtraction(payload: unknown) {
  mockState.fetchHandler = () => chatCompletions(JSON.stringify(payload))
}

test('extractModuleFacts：丢弃越界/空引用/重复，置信度截断，结果不超过 14 条', async () => {
  const sources = [draft('https://www.gov.cn/a', 'A'), draft('https://36kr.com/b', 'B')]
  mockExtraction({
    facts: [
      {
        fact: '公司注册资本为1000万元',
        value: '1000',
        unit: '万元',
        period: '2024',
        quote: '公司注册资本为1000万元人民币',
        sourceIdx: 0,
        confidence: 1.7,
        importance: 'CORE',
      },
      { fact: '越界来源事实', quote: '越界来源的原文摘录内容', sourceIdx: 9, confidence: 0.8 },
      { fact: '引用过短事实', quote: '短', sourceIdx: 0, confidence: 0.8 },
      { fact: '引用为空事实', quote: '', sourceIdx: 0, confidence: 0.8 },
      { fact: '置信度为负的事实', quote: '该来源明确写出的事实内容', sourceIdx: 1, confidence: -5 },
      ...Array.from({ length: 14 }, (_, i) => ({
        fact: `扩展事实编号${i}的描述内容`,
        quote: `扩展事实编号${i}的原文摘录内容片段`,
        sourceIdx: 0,
        confidence: 0.6,
      })),
    ],
  })

  const result = await extractModuleFacts('PRODUCT_TECHNOLOGY', '产品与技术', '技术是否可验证？', sources)
  assert.equal(result.error, undefined)
  assert.ok(result.facts.length <= 14, `事实数 ${result.facts.length} 超过上限 14`)

  const texts = result.facts.map(f => f.fact)
  assert.ok(!texts.includes('越界来源事实'), '越界 sourceIdx 应被丢弃')
  assert.ok(!texts.includes('引用过短事实'), 'quote 过短应被丢弃')
  assert.ok(!texts.includes('引用为空事实'), 'quote 为空应被丢弃')

  const clampedHigh = result.facts.find(f => f.fact.includes('注册资本'))
  assert.ok(clampedHigh, '合法事实应保留')
  assert.equal(clampedHigh?.confidence, 0.99)

  const clampedLow = result.facts.find(f => f.fact.includes('置信度为负'))
  assert.ok(clampedLow)
  assert.equal(clampedLow?.confidence, 0.05)

  // 每条事实都绑定合法来源与等级
  const validIdxs = new Set(sources.map((_, i) => i))
  for (const f of result.facts) {
    assert.ok(validIdxs.has(f.sourceIdx))
    assert.equal(f.grade, sources[f.sourceIdx].grade)
    assert.ok(f.confidence >= 0.05 && f.confidence <= 0.99)
  }
})

test('extractModuleFacts：同一指标差异超过 20% 时标记 CONFLICT', async () => {
  const sources = [draft('https://www.gov.cn/a', 'A'), draft('https://36kr.com/b', 'B')]
  mockExtraction({
    facts: [
      {
        fact: '公司2024年度营业收入合计金额约为100万元',
        value: '100',
        unit: '万元',
        period: '2024',
        quote: '公司2024年度营业收入合计金额约为100万元',
        sourceIdx: 0,
        confidence: 0.8,
        importance: 'CORE',
      },
      {
        fact: '公司2024年度营业收入合计金额约为150万元',
        value: '150',
        unit: '万元',
        period: '2024',
        quote: '公司2024年度营业收入合计金额约为150万元',
        sourceIdx: 1,
        confidence: 0.8,
        importance: 'CORE',
      },
    ],
  })

  const result = await extractModuleFacts('FINANCE_ECONOMICS', '财务与单位经济', '增长是否自洽？', sources)
  assert.equal(result.facts.length, 2)
  assert.ok(result.conflicts.length >= 1, '应识别出数值冲突')
  assert.ok(result.facts.some(f => f.status === 'CONFLICT'), '差异 >20% 的事实至少一条应标记 CONFLICT')
})

// ── 幻灯片规格 ──

function mkSlide(slideNo: number, layout: SlideLayout, extra: Partial<SlideSpec> = {}): SlideSpec {
  return { slideNo, layout, title: `第${slideNo}页标题`, bullets: ['要点一', '要点二'], ...extra }
}

function mkDeck(type: DeckSpec['type'], slides: SlideSpec[]): DeckSpec {
  return {
    type,
    title: '测试报告',
    projectName: '星辰科技',
    generatedAt: new Date('2026-01-01').toISOString(),
    theme: 'navy-gold',
    slides,
  }
}

test('validateDeckSpec：BRIEF 11 页不通过（页数不足）', () => {
  const slides: SlideSpec[] = [
    mkSlide(1, 'cover', { subtitle: '副标题' }),
    mkSlide(2, 'section', { sectionNo: '01' }),
    ...Array.from({ length: 9 }, (_, i) => mkSlide(i + 3, 'summary')),
  ]
  assert.equal(slides.length, 11)
  const result = validateDeckSpec(mkDeck('BRIEF', slides), { type: 'BRIEF' })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(i => i.includes('页数')), `应提示页数问题：${result.issues.join('；')}`)
})

test('validateDeckSpec：BRIEF 14 页且各 layout 必填齐全时通过', () => {
  const slides: SlideSpec[] = [
    mkSlide(1, 'cover', { subtitle: '副标题' }),
    mkSlide(2, 'section', { sectionNo: '01' }),
    ...Array.from({ length: 10 }, (_, i) => mkSlide(i + 3, 'summary')),
    mkSlide(13, 'gap', {
      columns: [
        { title: '阻塞缺口', items: ['缺少工商登记'] },
        { title: '建议补充', items: ['补充股权结构'] },
      ],
    }),
    mkSlide(14, 'appendix', { bullets: ['附：信息来源说明'] }),
  ]
  assert.equal(slides.length, 14)
  const result = validateDeckSpec(mkDeck('BRIEF', slides), { type: 'BRIEF' })
  assert.equal(result.ok, true, `应通过，问题：${result.issues.join('；')}`)
})

test('validateDeckSpec：FINAL 模块页无证据引用且未声明公开信息不足时不通过', () => {
  const slides: SlideSpec[] = [
    mkSlide(1, 'cover', { subtitle: '副标题' }),
    mkSlide(2, 'section', { sectionNo: '01' }),
    ...Array.from({ length: 19 }, (_, i) => mkSlide(i + 3, 'summary')),
    mkSlide(22, 'module', { bullets: ['要点一', '要点二'] }),
  ]
  assert.equal(slides.length, 22)
  const result = validateDeckSpec(mkDeck('FINAL', slides), { type: 'FINAL' })
  assert.equal(result.ok, false)
  assert.ok(
    result.issues.some(i => i.includes('模块页缺少证据引用')),
    `应提示模块页缺少证据：${result.issues.join('；')}`
  )

  // 补上证据引用后应通过
  const fixed = slides.map(s =>
    s.layout === 'module' ? { ...s, evidenceRefs: ['E1'] } : s
  )
  assert.equal(validateDeckSpec(mkDeck('FINAL', fixed), { type: 'FINAL' }).ok, true)
})

test('coerceDeckSpec：截断超长标题/要点并剔除非法证据引用', () => {
  const spec = mkDeck('BRIEF', [
    mkSlide(1, 'cover', {
      title: 'A'.repeat(50),
      subtitle: '副标题',
      bullets: ['B'.repeat(100), 'C'.repeat(100)],
      evidenceRefs: ['E1', 'X1', 'F22', 'bad'],
    }),
  ])

  const coerced = coerceDeckSpec(spec)
  const slide = coerced.slides[0]
  assert.equal(slide.title.length, 42)
  assert.equal(slide.bullets?.[0].length, 92)
  assert.deepEqual(slide.evidenceRefs, ['E1', 'F22'])

  // 原对象不被修改
  assert.equal(spec.slides[0].title.length, 50)
})

// ── 缺口关键词判定与统计 ──

test('evaluateRequirementCoverage：关键词大小写不敏感，事实或文档任一命中即覆盖，空输入为 false', () => {
  const requirement = { keywords: ['工商', 'Cap Table'] }

  assert.equal(evaluateRequirementCoverage(requirement, ['公司工商登记信息'], []), true)
  assert.equal(evaluateRequirementCoverage(requirement, [], ['附件含 cap table 明细']), true)
  assert.equal(evaluateRequirementCoverage(requirement, ['CAP TABLE 已整理'], []), true)
  assert.equal(evaluateRequirementCoverage(requirement, ['无关内容'], ['另一个文档']), false)
  assert.equal(evaluateRequirementCoverage(requirement, [], []), false)
})

test('gapStatsByModule：只统计 OPEN，区分 blocking/open', () => {
  const stats = gapStatsByModule([
    { moduleKey: 'PROJECT_ENTITY', status: 'OPEN', severity: 'BLOCKING' },
    { moduleKey: 'PROJECT_ENTITY', status: 'OPEN', severity: 'RECOMMENDED' },
    { moduleKey: 'PROJECT_ENTITY', status: 'RESOLVED', severity: 'BLOCKING' },
    { moduleKey: 'PROJECT_ENTITY', status: 'WAIVED', severity: 'BLOCKING' },
    { moduleKey: 'PRODUCT_TECHNOLOGY', status: 'OPEN', severity: 'BLOCKING' },
  ])

  assert.deepEqual(stats.get('PROJECT_ENTITY'), { open: 2, blocking: 1 })
  assert.deepEqual(stats.get('PRODUCT_TECHNOLOGY'), { open: 1, blocking: 1 })
  assert.equal(stats.has('NOT_EXIST'), false)
})

// ── 非分类资料校验 ──

test('validateAsset：允许 pdf/docx/png，拒绝 exe 与超过 50MB', () => {
  assert.equal(validateAsset('a.pdf', 1024).valid, true)
  assert.equal(validateAsset('b.docx', 1024).valid, true)
  assert.equal(validateAsset('c.png', 1024).valid, true)
  assert.equal(validateAsset('d.txt', 1024).valid, true)

  const exe = validateAsset('e.exe', 1024)
  assert.equal(exe.valid, false)
  assert.ok(exe.error?.includes('.exe'))

  const tooLarge = validateAsset('f.pdf', 50 * 1024 * 1024 + 1)
  assert.equal(tooLarge.valid, false)
  assert.ok(tooLarge.error?.includes('50MB'))

  // 恰好 50MB 允许
  assert.equal(validateAsset('g.pdf', 50 * 1024 * 1024).valid, true)
})
