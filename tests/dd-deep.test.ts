/**
 * 深度尽调报告（DEEP）纯函数测试
 *
 * 覆盖：页面组装/装页/目录页码、规格清洗、图表统计、LLM 失败兜底。
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
import { fallbackModuleContent } from '@/lib/dd-deep/writer'
import DeepReportDocument from '@/components/dd-workbench/DeepReportDocument'
import { renderToStaticMarkup } from 'react-dom/server'
import { DD_TEMPLATE_MODULES } from '@/lib/dd-workbench/template'

function moduleContent(moduleKey: string, index: number): DeepModuleContent {
  const argumentItems = Array.from({ length: 3 }).map((_, argumentIndex) => ({
    title: `模块 ${index + 1} 论点 ${argumentIndex + 1}`,
    content: `内容 ${argumentIndex + 1}：资料显示业务已进入交付阶段。[资料1]`,
    analysis: `分析 ${argumentIndex + 1}：需求增长与交付能力共同驱动，需关注订单持续性。`,
    evidence: [
      { text: `公开事实 ${argumentIndex + 1}`, ref: 'F1' },
      { text: '资料中心原文', ref: '资料1', quote: '公司主营工业软件平台。' },
    ],
    view: `观点 ${argumentIndex + 1}：可进入下一阶段验证。`,
    ...(argumentIndex === 0 ? { imageId: '图1' } : {}),
  }))

  return {
    moduleKey,
    headline: `模块 ${index + 1} 结论`,
    coreAnswer: `模块 ${index + 1} 的核心判断：具备进入下一阶段验证的基础。`,
    arguments: argumentItems,
    conclusion: `第 ${index + 1} 模块结论：可进入下一阶段验证。`,
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
    executive: {
      headline: '示例科技具备进入下一轮验证的基础',
      paragraphs: ['执行摘要第一段。'.repeat(120), '执行摘要第二段。'.repeat(20)],
      bullets: ['理由一 [F1]', '理由二 [F2]', '理由三', '理由四'],
      conclusion: '建议进入正式尽调，并设置资料补齐条件。',
    },
    outlook: {
      industry: {
        headline: '行业处于早期放量阶段',
        paragraphs: ['行业分析段落。'.repeat(20)],
        bullets: ['规模增长', '政策支持', '竞争分散'],
      },
      timing: {
        headline: '窗口期取决于客户验证',
        paragraphs: ['时机分析段落。'],
        bullets: ['订单验证', '竞品进度', '融资节奏'],
      },
      risks: [
        { title: '客户集中', detail: '前五大客户占比高。', mitigation: '补充客户合同与回款记录。' },
        { title: '技术替代', detail: '新技术路线可能替代。', mitigation: '跟踪专利与产品路线。' },
        { title: '资料不足', detail: '财务资料缺失。', mitigation: '交割前补充审计。' },
      ],
      valuation: {
        headline: '估值需结合订单验证',
        bullets: ['以收入与订单为基础', '参考可比融资', '设置业绩承诺'],
        metrics: [{ label: '投前估值', value: '3 亿元', hint: '项目录入' }],
      },
      conclusion: {
        headline: '建议有条件推进',
        conditions: ['完成客户访谈', '完成财务复核', '完成法务核查', '谈定条款'],
        nextSteps: ['补充报表', '补充合同', '补充专利清单', '安排访谈'],
      },
    },
    modules: DD_TEMPLATE_MODULES.map((template, index) => ({
      moduleKey: template.key,
      moduleName: template.name,
      coreQuestion: template.coreQuestion,
      content: moduleContent(template.key, index),
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
    },
    stats: { sourceCount: 20, factCount: 40, docCount: 9, imageCount: 1 },
  }
}

test('assembleDeepDocSpec：九大模块齐全、页码连续、目录页码准确、页数动态', () => {
  const spec = assembleDeepDocSpec(buildInput())

  assert.equal(spec.kind, 'DOCUMENT')
  assert.equal(spec.type, 'DEEP')
  assert.ok(spec.pageCount >= 25, `页数应不少于 25，实际 ${spec.pageCount}`)
  assert.equal(estimatePageCount(spec), spec.pageCount)
  assert.ok(spec.toc.length >= 14, `目录应覆盖 14 个章节，实际 ${spec.toc.length}`)

  spec.pages.forEach((page, index) => {
    assert.equal(page.pageNo, index + 1, '页码必须连续')
  })

  const sectionTitles = spec.pages.filter(page => page.kind === 'section').map(page => page.sectionTitle)
  for (const template of DD_TEMPLATE_MODULES) {
    assert.ok(sectionTitles.includes(template.name), `缺少模块章节：${template.name}`)
  }

  for (const item of spec.toc) {
    const page = spec.pages.find(p => p.kind === 'section' && p.sectionNo === item.no)
    assert.ok(page, `目录项 ${item.no} 未找到章节页`)
    assert.equal(item.page, page?.pageNo)
  }

  assert.equal(spec.pages[0].kind, 'cover')
  assert.equal(spec.pages[1].kind, 'toc')
})

test('装页：超长段落拆块、标题不落单、每页块不为空', () => {
  const input = buildInput()
  input.executive.paragraphs = ['超长段落。'.repeat(300)]
  const spec = assembleDeepDocSpec(input)

  const paragraphBlocks = spec.pages.flatMap(page => page.blocks).filter(block => block.type === 'paragraph')
  assert.ok(paragraphBlocks.length >= 3, '超长段落应拆成多块')
  for (const block of paragraphBlocks) {
    if (block.type === 'paragraph') {
      assert.ok(block.text.length <= 700, `段落块过长：${block.text.length}`)
    }
  }

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
        sectionTitle: '执行摘要',
        blocks: [],
      },
      {
        pageNo: 4,
        kind: 'content',
        sectionNo: '01',
        sectionTitle: '执行摘要',
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
      { pageNo: 5, kind: 'content', sectionNo: '01', sectionTitle: '执行摘要', blocks: [] },
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

test('fallbackModuleContent：论点不少于 3 个、四段完整、资料原文逐字引用', () => {
  const module = {
    moduleKey: 'PROJECT_ENTITY',
    moduleName: '项目主体',
    coreQuestion: '主体是否真实、股权是否清晰？',
    coverage: 0.5,
    facts: [
      { ref: 'F1', moduleKey: 'PROJECT_ENTITY', fact: '公司成立于 2020 年', grade: 'A' },
      { ref: 'F2', moduleKey: 'PROJECT_ENTITY', fact: '完成 A 轮融资', value: '5000', unit: '万元', grade: 'B' },
    ],
    sources: [],
    documents: [
      { id: 'd1', fileName: '商业计划书.pdf', fileUrl: '/research-docs/bp.pdf', text: '公司主营工业软件平台。', textLength: 12 },
    ],
    textBlocks: [],
    screenshots: [],
    humanConclusion: '主体真实，股权结构清晰。',
    report: null,
    verificationSummary: null,
    analysisFacts: [],
    gaps: [{ label: '缺少验资报告', severity: 'RECOMMENDED', status: 'OPEN' }],
    truncatedDocs: 0,
  } as unknown as DeepModuleContext

  const content = fallbackModuleContent(module)
  assert.ok(content.arguments && content.arguments.length >= 3, '应至少生成 3 个论点')
  assert.ok(content.conclusion.length > 0)
  for (const argument of content.arguments || []) {
    assert.ok(argument.title && argument.content && argument.analysis && argument.view, '论点四段不得为空')
    assert.ok(argument.evidence.length > 0, '每个论点必须有论据')
    for (const item of argument.evidence) {
      if (item.ref) assert.match(item.ref, /^(F\d+|资料\d+|E\d+)$/)
    }
  }
  const quote = (content.arguments || [])
    .flatMap(argument => argument.evidence)
    .find(item => item.ref === '资料1' && item.quote)
  assert.equal(quote?.quote, '公司主营工业软件平台。', '资料原文摘录必须与原文逐字一致')
})

test('16:9 文档渲染：封面、目录、论点独立成页、图表、资料图片与页码', () => {
  const spec = assembleDeepDocSpec(buildInput())
  const html = renderToStaticMarkup(DeepReportDocument({ spec }))

  const pageCount = (html.match(/class="deep-page/g) || []).length
  assert.equal(pageCount, spec.pageCount, '渲染页数应等于规格页数')
  assert.ok(html.includes('width: 1280px'), '页面应为 16:9（1280×720）')
  assert.ok(html.includes('height: 720px'))
  assert.ok(html.includes('尽职调查报告'))
  assert.ok(html.includes('目录'))
  assert.ok(html.includes('<svg'), '应包含内联图表')
  assert.ok(html.includes('技术架构图'), '应包含资料中心图片')
  assert.ok(html.includes('deep-argument-image'), '图片应绑定到论点页')
  assert.ok(html.includes('论点 1 / 3'), '论点页应显示论点序号')
  assert.ok(html.includes('内容') && html.includes('分析') && html.includes('论据') && html.includes('观点'), '论点四段标签应完整')
  assert.ok(html.includes('deep-section-stat'), '章节页应展示资料/证据统计')
  assert.ok(html.includes('机密 · 仅供投资决策使用'))

  const argumentPages = spec.pages.filter(
    page => page.kind === 'content' && page.blocks.some(block => block.type === 'argument')
  )
  assert.equal(argumentPages.length, 27, '九大模块 × 3 个论点应各自独立成页')
  for (const page of argumentPages) {
    assert.equal(page.blocks.length, 1, '论点页不得混入其他内容块')
  }

  const text = html.replace(/<!--.*?-->/g, '')
  assert.ok(text.includes(`${spec.pageCount} / ${spec.pageCount}`), '最后一页页码应正确')
})
