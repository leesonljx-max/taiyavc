/**
 * 模块研究覆盖度
 *
 * 覆盖度不是「资料完整度」，只衡量公开信息是否足以支撑该模块的初步判断。
 * 资料完整度由缺口引擎单独计算。
 */

import { moduleStatusFromCoverage, type DDModuleCoverageStatus } from './constants'
import type { ExtractedFact } from './extract'
import type { ResearchSourceDraft } from './search'

export interface ModuleCoverage {
  moduleKey: string
  coverage: number
  status: DDModuleCoverageStatus
  coreFacts: number
  factCount: number
  sourceCount: number
  hasOfficial: boolean
}

export function computeModuleCoverage(
  moduleKey: string,
  facts: Array<{ importance: string; confidence: number; status: string }>,
  sources: Array<Pick<ResearchSourceDraft, 'grade'>>
): ModuleCoverage {
  const validFacts = facts.filter(f => f.status !== 'CONFLICT' || f.confidence >= 0.5)
  const coreFacts = validFacts.filter(f => f.importance === 'CORE' && f.confidence >= 0.5).length
  const sourceCount = sources.length
  const hasOfficial = sources.some(s => s.grade === 'A')

  const raw = Math.min(1, coreFacts / 3) * 0.6
    + Math.min(1, sourceCount / 5) * 0.2
    + (hasOfficial ? 0.2 : 0)

  const coverage = Math.round(Math.min(1, raw) * 100) / 100

  return {
    moduleKey,
    coverage,
    status: moduleStatusFromCoverage(coverage),
    coreFacts,
    factCount: facts.length,
    sourceCount,
    hasOfficial,
  }
}
