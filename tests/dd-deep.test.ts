/**
 * 深度尽调报告（DEEP）纯函数测试
 *
 * 覆盖：固定框架组装、装页/目录页码、规格清洗、图表统计、章节兜底与 16:9 渲染。
 */

import './helpers/setup'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assembleDeepDocSpec,
  coerceDeepDocSpec,
  estimatePageCount,
  type DeepDocInput,
  type DeepDocSpec,
  type DeepModuleContent,
} from '@/lib/dd-deep/spec'
import { buildDeepCharts, type DeepContext, type DeepModuleContext } from '@/lib/dd-deep/context'
import { DEEP_CHAPTERS, DEEP_RECOMMENDATION_DIMENSIONS, DEEP_SECTION_COUNT, getDeepChapter } from '@/lib/dd-deep/framework'
import { fallbackChapterContent, fallbackSectionArgument } from '@/lib/dd-deep/writer'
import DeepReportDocument from '@/components/dd-workbench/DeepReportDocument'
import { renderToStaticMarkup } from 'react-dom/server'
import { DD_TEMPLATE_MODULES } from '@/lib/dd-workbench/template'

function chapterContent(chapter: (typeof DEEP_CHAPTERS)[number]): DeepModuleContent {
  const argumentItems = chapter.sections.map((section, argumentIndex) => ({
    title: section.title,
    narrative: [
      `${section.title}：资料显示业务已进入交付阶段，收入与客户结构开始成形。[资料1]`,
      `进一步看，需求增长与交付能力共同驱动，但订单持续性仍需后续材料验证。`,
    ],
    evidence: [
      { text: `公开事实 ${argumentIndex + 1}`, ref: 'F1' },
      { text: '资料中心原文', ref: '资料1', quote: '公司主营工业软件平台。' },
    ],
    takeaway: `${section.title}的判断：可进入下一阶段验证。`,
    ...(argumentIndex === 0 ? { imageId: '图1' } : {}),
  }))

  return {
    moduleKey: chapter.key,
    headline: `${chapter.title}结论`,
    summary: `${chapter.title}的 1–2 句总结。`,
    coreAnswer: `${chapter.title}的核心判断：具备进入下一阶段验证的基础。`,
    arguments: argumentItems,
    conclusion: `${chapter.title}结论：可进入下一阶段验证。`,
    metrics: [{ label: '覆盖率', value: '60%', hint: '公开信息' }],
    dataLimited: false,
  }
}

function buildInput(): DeepDocInput {
  return {
    project: {
      name: '示例科技',
      companyFullName: '示例科技（上海）有限公司',
      industry: '工业软件',
      companyPosition: '面向制造业的智能运维平台',
      financingRound: 'A 轮',
      totalAmount: '5000 万元',
    },
    generatedAt: '2026-11-10T08:00:00.000Z',
    recommendation: {
      headline: '示例科技具备进入下一轮验证的基础',
      items: DEEP_RECOMMENDATION_DIMENSIONS.map((dimension, index) => ({
        dimension,
        headline: `${dimension}维度的推荐理由`,
        points: [`${dimension}依据一 [F1]`, `${dimension}依据二`, `${dimension}依据三`],
      })),
      conclusion: '建议有条件推进，并设置资料补齐条件。',
    },
    chapters: DEEP_CHAPTERS.map(chapter => ({
      chapter,
      content: chapterContent(chapter),
      stats: [
        { label: '资料', value: '3 份' },
        { label: '证据', value: '5 条' },
        { label: '关键图', value: '1 张' },
      ],
    })),
    charts: {
      coverage: {
        type: 'chart',
        title: '覆盖度',
        unit: '%',
        chart: {
          kind: 'bar',
          series: DD_TEMPLATE_MODULES.map((template, index) => ({
            label: template.name,
            value: 40 + index,
          })),
        },
      },
      grades: {
        type: 'chart',
        title: '证据等级',
        chart: {
          kind: 'donut',
          series: [
            { label: 'A', value: 2 },
            { label: 'B', value: 3 },
          ],
        },
      },
      evidenceByModule: {
        type: 'table',
        title: '证据汇总',
        columns: ['模块', '事实', '来源', '资料'],
        rows: DD_TEMPLATE_MODULES.map(template => [template.name, '2', '3', '1']),
      },
      financeFacts: null,
    },
    images: [
      {
        moduleKey: 'PRODUCT_TECHNOLOGY',
        url: '/api/uploads/interpretation-images/demo.png',
        caption: '技术架构图',
        source: '资料中心',
        kind: 'doc',
      },
    ],
    limitations: ['财务资料未提供审计报告。', '客户访谈尚未完成。'],
    appendix: {
      facts: Array.from({ length: 40 }).map((_, index) => ({
        ref: `F${index + 1}`,
        moduleName: '项目主体',
        fact: `公开事实 ${index + 1}`,
        grade: 'B',
        source: 'E1',
      })),
      sources: Array.from({ length: 20 }).map((_, index) => ({
        ref: `E${index + 1}`,
        title: `来源 ${index + 1}`,
        domain: 'example.com',
        grade: 'B',
        url: 'https://example.com',
      })),
      documents: [
        { ref: '资料1', fileName: '商业计划书.pdf', moduleName: '产品与技术', textLength: 12000 },
      ],
    },
    stats: { sourceCount: 20, factCount: 40, docCount: 9, imageCount: 1 },
  }
}

test('固定框架：8 章 41 小节，章节与小节顺序稳定', () => {
  assert.equal(DEEP_CHAPTERS.length, 8)
  assert.equal(DEEP_SECTION_COUNT, 41)
  assert.deepEqual(DEEP_CHAPTERS.map(chapter => chapter.no), ['01', '02', '03', '04', '05', '06', '07', '08'])
  assert.deepEqual(DEEP_RECOMMENDATION_DIMENSIONS, ['行业', '团队背景', '产品和业务进展', '竞争态势', '融资'])
  assert.equal(getDeepChapter('INDUSTRY')?.sections[0].title, '行业定义与边界')
  assert.equal(getDeepChapter('FINANCE')?.sections.length, 5)
})

test('assembleDeepDocSpec：推荐理由 + 固定八章 + 附录、页码连续、目录准确', () => {
  const spec = assembleDeepDocSpec(buildInput())

  assert.equal(spec.kind, 'DOCUMENT')
  assert.equal(spec.type, 'DEEP')
  assert.equal(estimatePageCount(spec), spec.pageCount)
  assert.ok(spec.pageCount >= 63, `页数应不少于 63，实际 ${spec.pageCount}`)
  assert.equal(spec.toc.length, 11, '目录应覆盖 00、01–08、A、B')
  assert.deepEqual(spec.toc.map(item => item.no), ['00', '01', '02', '03', '04', '05', '06', '07', '08', 'A', 'B'])

  spec.pages.forEach((page, index) => {
    assert.equal(page.pageNo, index + 1, '页码必须连续')
  })

  const sectionTitles = spec.pages.filter(page => page.kind === 'section').map(page => page.sectionTitle)
  assert.equal(sectionTitles[0], '推荐理由')
  for (const chapter of DEEP_CHAPTERS) {
    assert.ok(sectionTitles.includes(chapter.title), `缺少固定章节：${chapter.title}`)
  }
  assert.ok(sectionTitles.includes('资料利用与局限'))
  assert.ok(sectionTitles.includes('附录'))

  for (const item of spec.toc) {
    const page = spec.pages.find(p => p.kind === 'section' && p.sectionNo === item.no)
    assert.ok(page, `目录项 ${item.no} 未找到章节页`)
    assert.equal(item.page, page?.pageNo)
  }

  assert.equal(spec.pages[0].kind, 'cover')
  assert.equal(spec.pages[1].kind, 'toc')

  const argumentPages = spec.pages.filter(
    page => page.kind === 'content' && page.blocks.some(block => block.type === 'argument')
  )
  assert.equal(argumentPages.length, 41, '固定框架 41 个小节应各自独立成页')
  for (const page of argumentPages) {
    assert.equal(page.blocks.length, 1, '论点页不得混入其他内容块')
  }
})

test('装页：每页块不为空、标题不落单、资料局限进入附录', () => {
  const input = buildInput()
  input.limitations = Array.from({ length: 30 }).map((_, index) => `资料局限 ${index + 1}：待补充审计报告与客户访谈。`)
  const spec = assembleDeepDocSpec(input)

  const appendixPages = spec.pages.filter(page => page.kind === 'content' && page.sectionNo === 'A')
  assert.ok(appendixPages.length > 0, '应输出资料利用与局限附录')
  const limitationBullets = appendixPages
    .flatMap(page => page.blocks)
    .filter(block => block.type === 'bullets')
  assert.ok(limitationBullets.length > 0, '资料局限应以列表呈现')

  for (const page of spec.pages.filter(p => p.kind === 'content')) {
    assert.ok(page.blocks.length > 0, '内容页不得为空')
    const last = page.blocks[page.blocks.length - 1]
    assert.notEqual(last.type, 'heading', '页尾不得只有标题')
  }
})

test('coerceDeepDocSpec：清空块、拦截非法图片、保留表格数据并重排页码', () => {
  const raw: DeepDocSpec = {
    kind: 'DOCUMENT',
    type: 'DEEP',
    title: '测试',
    subtitle: '副标题',
    projectName: '项目',
    generatedAt: '2026-11-10T00:00:00.000Z',
    theme: 'navy-gold',
    pageCount: 5,
    toc: [],
    stats: { sourceCount: 0, factCount: 0, docCount: 0, imageCount: 0 },
    pages: [
      { pageNo: 1, kind: 'cover', blocks: [] },
      { pageNo: 2, kind: 'toc', blocks: [] },
      {
        pageNo: 3,
        kind: 'section',
        sectionNo: '01',
        sectionTitle: '推荐理由',
        blocks: [],
      },
      {
        pageNo: 4,
        kind: 'content',
        sectionNo: '01',
        sectionTitle: '推荐理由',
        blocks: [
          { type: 'paragraph', text: '' },
          { type: 'image', url: 'javascript:alert(1)', caption: '非法图' },
          {
            type: 'table',
            columns: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
            rows: Array.from({ length: 12 }).map((_, row) => Array.from({ length: 7 }).map((__, col) => `${row}-${col}`)),
          },
          { type: 'bullets', items: [] },
        ],
      },
      { pageNo: 5, kind: 'content', sectionNo: '01', sectionTitle: '推荐理由', blocks: [] },
    ],
  }

  const spec = coerceDeepDocSpec(raw)
  assert.equal(spec.pageCount, 4, '空内容页应被移除')
  spec.pages.forEach((page, index) => assert.equal(page.pageNo, index + 1))

  const content = spec.pages.find(page => page.kind === 'content')
  assert.ok(content)
  assert.equal(content?.blocks.some(block => block.type === 'image'), false, '非法图片 URL 应被剔除')
  const table = content?.blocks.find(block => block.type === 'table')
  assert.ok(table && table.type === 'table')
  if (table && table.type === 'table') {
    assert.equal(table.columns.length, 6, '表格最多 6 列')
    assert.equal(table.rows.length, 12, '表格数据不得被静默截断')
  }
  assert.equal(spec.toc.length, 1)
  assert.equal(spec.toc[0].page, 3)
})

test('buildDeepCharts：覆盖度 9 项、等级合计等于事实数、无财务数值时不出表', () => {
  const facts = [
    { ref: 'F1', moduleKey: 'PROJECT_ENTITY', fact: '事实1', grade: 'A' },
    { ref: 'F2', moduleKey: 'PROJECT_ENTITY', fact: '事实2', grade: 'B' },
    { ref: 'F3', moduleKey: 'MARKET_CUSTOMERS', fact: '事实3', grade: 'C' },
    { ref: 'F4', moduleKey: 'PRODUCT_TECHNOLOGY', fact: '事实4', grade: 'D' },
  ]

  const modules: DeepModuleContext[] = DD_TEMPLATE_MODULES.map((template, index) => ({
    moduleKey: template.key,
    moduleName: template.name,
    coreQuestion: template.coreQuestion,
    coverage: index / 10,
    facts: [],
    sources: [],
    documents: [],
    textBlocks: [],
    screenshots: [],
    humanConclusion: null,
    report: null,
    verificationSummary: null,
    analysisFacts: [],
    gaps: [],
    truncatedDocs: 0,
  }))

  const context = {
    base: {
      project: {},
      modules: [],
      facts,
      sources: [],
      docs: [],
      gaps: { summary: {}, items: [] },
      research: {},
    },
    modules,
    limitations: [],
  } as unknown as DeepContext

  const charts = buildDeepCharts(context)
  assert.ok(charts.coverage && charts.coverage.type === 'chart')
  if (charts.coverage && charts.coverage.type === 'chart') {
    assert.equal(charts.coverage.chart.series.length, 9)
  }
  assert.ok(charts.grades && charts.grades.type === 'chart')
  if (charts.grades && charts.grades.type === 'chart' && charts.grades.chart.kind === 'donut') {
    const total = charts.grades.chart.series.reduce((sum, item) => sum + item.value, 0)
    assert.equal(total, facts.length)
  }
  assert.equal(charts.financeFacts, null)
  assert.ok(charts.docUsage && charts.docUsage.type === 'table', '应输出资料利用统计表')
  if (charts.docUsage && charts.docUsage.type === 'table') {
    assert.equal(charts.docUsage.rows.length, 9)
  }
})

test('fallbackChapterContent：按小节数量兜底、归纳阐述完整、评分页给出 10 分制分数', () => {
  const module = {
    moduleKey: 'TEAM',
    moduleName: '核心团队',
    coreQuestion: '创始人与团队是否匹配？',
    coverage: 0.5,
    facts: [
      { ref: 'F1', moduleKey: 'TEAM_GOVERNANCE', fact: '创始人毕业于清华大学', grade: 'A' },
      { ref: 'F2', moduleKey: 'TEAM_GOVERNANCE', fact: '完成 A 轮融资', value: '5000', unit: '万元', grade: 'B' },
    ],
    sources: [],
    documents: [
      { id: 'd1', ref: '资料1', fileName: '商业计划书.pdf', fileUrl: '/research-docs/bp.pdf', text: '公司主营工业软件平台。', textLength: 12 },
    ],
    textBlocks: [],
    screenshots: [],
    humanConclusion: '团队背景扎实，商业化经验待补强。',
    report: null,
    verificationSummary: null,
    analysisFacts: [],
    gaps: [{ label: '缺少核心成员履历', severity: 'RECOMMENDED', status: 'OPEN' }],
    truncatedDocs: 0,
  } as unknown as DeepModuleContext

  const chapter = getDeepChapter('TEAM')
  assert.ok(chapter)
  const content = fallbackChapterContent(chapter, module)
  assert.equal(content.arguments?.length, chapter.sections.length, '每个固定小节都必须有论点页')
  for (const argument of content.arguments || []) {
    assert.ok(argument.title && argument.narrative.length > 0, '论点标题与归纳阐述不得为空')
    assert.ok(argument.evidence.length > 0, '每个论点必须有论据')
    for (const item of argument.evidence) {
      if (item.ref) assert.match(item.ref, /^(F\d+|资料\d+|E\d+)$/)
    }
  }

  const score = content.arguments?.find(argument => argument.title === '团队综合评分')
  assert.ok(score)
  assert.match(score.takeaway || '', /\d+(\.\d+)?\/10/, '评分页必须给出 10 分制明确分数')

  const quote = (content.arguments || [])
    .flatMap(argument => argument.evidence)
    .find(item => item.ref === '资料1' && item.quote)
  assert.equal(quote?.quote, '公司主营工业软件平台。', '资料原文摘录必须与原文逐字一致')

  const section = chapter.sections[0]
  const single = fallbackSectionArgument(section, module)
  assert.equal(single.title, section.title)
  assert.ok(single.evidence.length > 0)
})

test('16:9 文档渲染：封面、目录、推荐理由、论点独立成页、图表、资料图片与页码', () => {
  const spec = assembleDeepDocSpec(buildInput())
  const html = renderToStaticMarkup(DeepReportDocument({ spec }))

  const pageCount = (html.match(/class="deep-page/g) || []).length
  assert.equal(pageCount, spec.pageCount, '渲染页数应等于规格页数')
  assert.ok(html.includes('width: 1280px'), '页面应为 16:9（1280×720）')
  assert.ok(html.includes('height: 720px'))
  assert.ok(html.includes('尽职调查报告'))
  assert.ok(html.includes('目录'))
  assert.ok(html.includes('推荐理由'), '固定第 1 页应为推荐理由')
  assert.ok(html.includes('行业概述') && html.includes('融资规划'), '八章标题应完整')
  assert.ok(html.includes('<svg'), '应包含内联图表')
  assert.ok(html.includes('技术架构图'), '应包含资料中心图片')
  assert.ok(html.includes('deep-argument-image'), '图片应绑定到论点页')
  assert.ok(html.includes('小节 1 / 7'), '第一章第一节应显示小节序号')
  assert.ok(html.includes('支撑论据'), '论点页应展示归纳后的论据')
  assert.ok(html.includes('判断'), '论点页应按需展示判断')
  assert.ok(!html.includes('<i>01</i>内容') && !html.includes('<i>02</i>分析'), '不应再固定输出内容/分析标签')
  assert.ok(html.includes('deep-section-stat'), '章节页应展示资料/证据统计')
  assert.ok(html.includes('机密 · 仅供投资决策使用'))

  const argumentPages = spec.pages.filter(
    page => page.kind === 'content' && page.blocks.some(block => block.type === 'argument')
  )
  assert.equal(argumentPages.length, 41, '八章 41 个小节应各自独立成页')
  for (const page of argumentPages) {
    assert.equal(page.blocks.length, 1, '论点页不得混入其他内容块')
  }

  const text = html.replace(/<!--.*?-->/g, '')
  assert.ok(text.includes(`${spec.pageCount} / ${spec.pageCount}`), '最后一页页码应正确')
})
