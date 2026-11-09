/**
 * 报告质检
 *
 * 校验版式 + 证据引用 + 风险/机会完整性；
 * 可自动修复的（超长、非法引用、缺引用）直接收敛，剩余问题阻断写库。
 */

import type { DeckContext } from './context'
import { coerceDeckSpec, validateDeckSpec, type DeckSpec } from './spec'

export interface CritiqueResult {
  ok: boolean
  issues: string[]
  spec: DeckSpec
}

function validRefs(context: DeckContext): Set<string> {
  const set = new Set<string>()
  for (const f of context.facts) set.add(f.ref)
  for (const s of context.sources) set.add(s.ref)
  return set
}

export function critiqueDeck(spec: DeckSpec, context: DeckContext): CritiqueResult {
  const issues: string[] = []
  let revised = coerceDeckSpec(spec)
  const refs = validRefs(context)
  const factRefsByModule = new Map(
    context.modules.map(m => [m.moduleName, m.facts.slice(0, 4).map(f => f.ref)])
  )

  // 剔除不存在的引用；模块页无引用时自动补该模块事实编号
  revised = {
    ...revised,
    slides: revised.slides.map(slide => {
      const evidenceRefs = (slide.evidenceRefs || []).filter(ref => refs.has(ref))
      let bullets = (slide.bullets || []).map(b =>
        b.replace(/\[([EF]\d+)\]/g, (match, ref) => (refs.has(ref) ? match : ''))
      )

      if (slide.layout === 'module' && evidenceRefs.length === 0) {
        const moduleFacts = factRefsByModule.get(slide.kicker || '') || []
        evidenceRefs.push(...moduleFacts)
      }

      // 删除引用后可能出现连续空格
      bullets = bullets.map(b => b.replace(/\s{2,}/g, ' ').trim())
      return { ...slide, evidenceRefs, bullets }
    }),
  }

  const validation = validateDeckSpec(revised, { type: revised.type })
  issues.push(...validation.issues)

  if (revised.type === 'FINAL') {
    const riskSlide = revised.slides.find(s => s.layout === 'risk')
    const compareSlide = revised.slides.find(s => s.layout === 'compare')
    const opportunitySlide = revised.slides.find(s => s.layout === 'matrix')
    if (!riskSlide) issues.push('缺少风险矩阵页')
    if (!compareSlide) issues.push('缺少多空对照页')
    if (!opportunitySlide) issues.push('缺少机会矩阵页')
    if ((riskSlide?.columns?.[0]?.items.length || 0) < 2) issues.push('风险少于 2 条，需补充')
    if ((opportunitySlide?.columns?.[0]?.items.length || 0) < 2) issues.push('机会少于 2 条，需补充')
  }

  return { ok: issues.length === 0, issues, spec: revised }
}
