/**
 * 深度报告生成流水线
 *
 * 上下文 → 图片 → 九模块串行写作（心跳）→ 综述 → 组装 → 写库。
 * 不生成 PPTX，不写 DDSlide；页数记录在 slideCount。
 */

import prisma from '@/lib/prisma'
import { buildDeepCharts, buildDeepContext } from './context'
import { collectDeepImages } from './images'
import { assembleDeepDocSpec, coerceDeepDocSpec, type DeepModuleContent } from './spec'
import {
  fallbackModuleContent,
  generateExecutiveSummary,
  generateModuleContent,
  generateOutlookAndRisks,
} from './writer'

const MODULE_NAME_MAX = 6

function clean(text: string, max: number): string {
  const value = (text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

export async function generateDeepDeck(deckId: string): Promise<void> {
  const deck = await prisma.dDSlideDeck.findUnique({ where: { id: deckId } })
  if (!deck) throw new Error('报告不存在')

  const context = await buildDeepContext(deck.projectId)
  const charts = buildDeepCharts(context)
  const imageResult = await collectDeepImages(context)

  const contents: DeepModuleContent[] = []
  for (const module of context.modules) {
    let content: DeepModuleContent
    try {
      content = await generateModuleContent(context, module)
    } catch (error) {
      console.error(`[dd-deep] 模块生成失败 ${module.moduleKey}:`, error)
      content = fallbackModuleContent(module)
    }
    contents.push(content)

    // 心跳：避免 20 分钟恢复逻辑误判为超时
    await prisma.dDSlideDeck.update({
      where: { id: deckId },
      data: { status: 'GENERATING' },
    }).catch(() => undefined)
  }

  const executive = await generateExecutiveSummary(context, contents)
  const outlook = await generateOutlookAndRisks(context, contents)

  const limitedModules = contents
    .map((content, index) => (content.dataLimited ? context.modules[index]?.moduleName || content.moduleKey : null))
    .filter((name): name is string => Boolean(name))

  const limitations = [
    ...context.limitations,
    ...imageResult.notes,
    ...(limitedModules.length > 0 ? [`以下模块资料有限，结论仅为初步判断：${limitedModules.join('、')}。`] : []),
  ].slice(0, 24)

  const moduleNameByKey = new Map(context.modules.map(module => [module.moduleKey, module.moduleName]))

  const spec = assembleDeepDocSpec({
    project: context.base.project,
    generatedAt: new Date().toISOString(),
    executive,
    outlook,
    modules: context.modules.map((module, index) => ({
      moduleKey: module.moduleKey,
      moduleName: module.moduleName,
      coreQuestion: module.coreQuestion,
      content: contents[index],
    })),
    charts,
    images: imageResult.images,
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
    },
    stats: {
      sourceCount: context.base.research.sourceCount,
      factCount: context.base.research.factCount,
      docCount: context.modules.reduce((sum, module) => sum + module.documents.length, 0),
      imageCount: imageResult.images.length,
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
