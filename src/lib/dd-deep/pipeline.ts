/**
 * 深度报告生成流水线（固定框架版）
 *
 * 上下文 → 图片 → 按固定八章逐章写作（心跳）→ 推荐理由 → 组装 → 写库。
 * 每章合并其绑定的九大模块资料，按 framework.ts 规定的小节逐页输出。
 * 不生成 PPTX，不写 DDSlide；页数记录在 slideCount。
 */

import prisma from '@/lib/prisma'
import { buildDeepCharts, buildDeepContext, type DeepContext, type DeepModuleContext } from './context'
import { collectDeepImages } from './images'
import { DEEP_CHAPTERS, type DeepChapterSpec } from './framework'
import {
  assembleDeepDocSpec,
  coerceDeepDocSpec,
  type DeepChapterInput,
  type DeepImage,
  type DeepModuleContent,
} from './spec'
import { fallbackChapterContent, generateChapterContent, generateRecommendation } from './writer'

const MODULE_NAME_MAX = 6
const MAX_DOC_ROWS = 80

function clean(text: string, max: number): string {
  const value = (text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** 把章节绑定的多个模块合并为一个写作上下文 */
function mergeChapterModules(context: DeepContext, chapter: DeepChapterSpec): DeepModuleContext {
  const selected = chapter.moduleKeys
    .map(key => context.modules.find(module => module.moduleKey === key))
    .filter((module): module is DeepModuleContext => Boolean(module))

  const seenDocs = new Set<string>()
  const documents = selected.flatMap(module => module.documents).filter(doc => {
    const key = doc.id || doc.fileUrl || doc.fileName
    if (seenDocs.has(key)) return false
    seenDocs.add(key)
    return true
  })

  const seenFacts = new Set<string>()
  const facts = selected.flatMap(module => module.facts).filter(fact => {
    const key = fact.ref || factKey(fact)
    if (seenFacts.has(key)) return false
    seenFacts.add(key)
    return true
  })

  const seenSources = new Set<string>()
  const sources = selected.flatMap(module => module.sources).filter(source => {
    const key = source.ref || source.url
    if (!key || seenSources.has(key)) return false
    seenSources.add(key)
    return true
  })

  const seenGaps = new Set<string>()
  const gaps = selected.flatMap(module => module.gaps).filter(gap => {
    if (seenGaps.has(gap.label)) return false
    seenGaps.add(gap.label)
    return true
  })

  const humanConclusions = selected
    .map(module => module.humanConclusion)
    .filter((value): value is string => Boolean(value))
  const verificationSummaries = selected
    .map(module => module.verificationSummary)
    .filter((value): value is string => Boolean(value))

  return {
    moduleKey: chapter.key,
    moduleName: chapter.title,
    coreQuestion: chapter.kicker,
    coverage: selected.length > 0
      ? selected.reduce((sum, module) => sum + module.coverage, 0) / selected.length
      : 0,
    facts,
    sources,
    documents,
    textBlocks: selected.flatMap(module => module.textBlocks),
    screenshots: selected.flatMap(module => module.screenshots),
    humanConclusion: humanConclusions.length > 0 ? humanConclusions.join('；') : null,
    report: selected.find(module => module.report)?.report || null,
    verificationSummary: verificationSummaries.length > 0 ? verificationSummaries.join('；') : null,
    analysisFacts: selected.flatMap(module => module.analysisFacts),
    gaps,
    truncatedDocs: selected.reduce((sum, module) => sum + module.truncatedDocs, 0),
  }
}

/** 公开事实没有编号时的兜底去重键 */
function factKey(fact: { moduleKey: string; fact: string }): string {
  return `${fact.moduleKey}:${fact.fact}`
}

export async function generateDeepDeck(deckId: string): Promise<void> {
  const deck = await prisma.dDSlideDeck.findUnique({ where: { id: deckId } })
  if (!deck) throw new Error('报告不存在')

  const context = await buildDeepContext(deck.projectId)
  const imageResult = await collectDeepImages(context)

  // 图表沿用模块统计；图片按章节分配，避免同一张图跨章重复
  const imageCounts: Record<string, number> = {}
  for (const module of context.modules) {
    imageCounts[module.moduleKey] = imageResult.images.filter(image => image.moduleKey === module.moduleKey).length
  }
  const charts = buildDeepCharts(context, imageCounts)

  const usedImageUrls = new Set<string>()
  const usedImages: DeepImage[] = []
  const chapterInputs: DeepChapterInput[] = []
  const chapterContents: Array<{ chapter: DeepChapterSpec; content: DeepModuleContent }> = []

  for (const chapter of DEEP_CHAPTERS) {
    const merged = mergeChapterModules(context, chapter)
    // 图片按章节实际需要分配：每个小节最多 1 张，另留 2 张给概览页，不设固定张数上限
    const chapterImageBudget = chapter.sections.length + 2
    const chapterImages: DeepImage[] = []
    for (const image of imageResult.images) {
      if (chapterImages.length >= chapterImageBudget) break
      if (!chapter.moduleKeys.includes(image.moduleKey)) continue
      if (usedImageUrls.has(image.url)) continue
      usedImageUrls.add(image.url)
      chapterImages.push({ ...image, id: `图${chapterImages.length + 1}` })
    }

    let content: DeepModuleContent
    try {
      content = await generateChapterContent(context, chapter, merged, chapterImages)
    } catch (error) {
      console.error(`[dd-deep] 章节生成失败 ${chapter.key}:`, error)
      content = fallbackChapterContent(chapter, merged)
    }

    chapterContents.push({ chapter, content })
    usedImages.push(...chapterImages)
    chapterInputs.push({
      chapter,
      content,
      stats: [
        { label: '资料', value: `${merged.documents.length} 份` },
        { label: '证据', value: `${merged.facts.length + merged.sources.length} 条` },
        { label: '关键图', value: `${chapterImages.length} 张` },
      ],
    })

    // 心跳：避免 20 分钟恢复逻辑误判为超时
    await prisma.dDSlideDeck.update({
      where: { id: deckId },
      data: { status: 'GENERATING' },
    }).catch(() => undefined)
  }

  const recommendation = await generateRecommendation(context, chapterContents)

  const limitedChapters = chapterInputs
    .filter(item => item.content.dataLimited)
    .map(item => item.chapter.title)

  const limitations = [
    ...context.limitations,
    ...imageResult.notes,
    ...(limitedChapters.length > 0
      ? [`以下章节资料有限，结论仅为初步判断：${limitedChapters.join('、')}。`]
      : []),
  ].slice(0, 24)

  const moduleNameByKey = new Map(context.modules.map(module => [module.moduleKey, module.moduleName]))
  const seenDocRefs = new Set<string>()
  const documentRows = context.modules
    .flatMap(module =>
      module.documents.map(doc => ({
        ref: doc.ref || '',
        fileName: clean(doc.fileName, 56),
        moduleName: module.moduleName,
        textLength: doc.textLength,
      }))
    )
    .filter(row => {
      if (!row.ref || seenDocRefs.has(row.ref)) return false
      seenDocRefs.add(row.ref)
      return true
    })
    .slice(0, MAX_DOC_ROWS)

  const spec = assembleDeepDocSpec({
    project: context.base.project,
    generatedAt: new Date().toISOString(),
    recommendation,
    chapters: chapterInputs,
    charts,
    images: usedImages,
    limitations,
    appendix: {
      facts: context.base.facts.slice(0, 90).map(fact => ({
        ref: fact.ref,
        moduleName: clean(moduleNameByKey.get(fact.moduleKey) || fact.moduleKey, MODULE_NAME_MAX),
        fact: clean(fact.fact, 90),
        grade: fact.grade,
        source: fact.sourceRef ? `[${fact.sourceRef}]` : '公开来源',
      })),
      sources: context.base.sources.slice(0, 60).map(source => ({
        ref: source.ref,
        title: clean(source.title, 60),
        domain: source.domain,
        grade: source.grade,
        url: source.url,
      })),
      documents: documentRows,
    },
    stats: {
      sourceCount: context.base.research.sourceCount,
      factCount: context.base.research.factCount,
      docCount: context.modules.reduce((sum, module) => sum + module.documents.length, 0),
      imageCount: usedImages.length,
    },
  })

  const finalSpec = coerceDeepDocSpec(spec)

  await prisma.dDSlide.deleteMany({ where: { deckId } })
  await prisma.dDSlideDeck.update({
    where: { id: deckId },
    data: {
      status: 'READY',
      specJson: JSON.stringify(finalSpec),
      slideCount: finalSpec.pageCount,
      generatedAt: new Date(),
      pptxUrl: null,
      error: null,
    },
  })
}
