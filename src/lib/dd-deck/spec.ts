/**
 * 幻灯片规格（SlideSpec）
 *
 * AI 只生成内容，页面数量与 layout 由模板固定；
 * 写库前必须通过校验，避免版式溢出与无证据结论。
 */

export type DeckType = 'BRIEF' | 'FINAL' | 'DEEP'

export type SlideLayout =
  | 'cover'
  | 'summary'
  | 'section'
  | 'module'
  | 'gap'
  | 'matrix'
  | 'risk'
  | 'valuation'
  | 'appendix'
  | 'compare'

export interface SlideStat {
  label: string
  value: string
  hint?: string
}

export interface SlideColumn {
  title: string
  items: string[]
  tone?: 'positive' | 'negative' | 'neutral'
}

export interface SlideSpec {
  slideNo: number
  layout: SlideLayout
  kicker?: string
  title: string
  subtitle?: string
  bullets?: string[]
  callout?: string
  stats?: SlideStat[]
  columns?: SlideColumn[]
  evidenceRefs?: string[]
  sectionNo?: string
  footer?: string
}

export interface DeckSpec {
  type: DeckType
  title: string
  subtitle?: string
  projectName: string
  generatedAt: string
  theme: string
  slides: SlideSpec[]
}

export interface ValidationOptions {
  type: DeckType
}

export interface ValidationResult {
  ok: boolean
  issues: string[]
}

const EVIDENCE_RE = /^[EF]\d+$/

const TITLE_MAX = 42
const BULLET_MAX = 92
const MAX_BULLETS = 5

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export function validateDeckSpec(spec: DeckSpec, options: ValidationOptions): ValidationResult {
  const issues: string[] = []
  const min = options.type === 'BRIEF' ? 14 : 30
  const max = options.type === 'BRIEF' ? 20 : 42

  if (!spec || !Array.isArray(spec.slides)) {
    return { ok: false, issues: ['幻灯片数据缺失'] }
  }
  if (spec.type !== options.type) {
    issues.push(`deck type 不一致：${spec.type} vs ${options.type}`)
  }
  if (spec.slides.length < min || spec.slides.length > max) {
    issues.push(`页数 ${spec.slides.length} 不在 ${min}–${max} 页范围内`)
  }

  spec.slides.forEach((slide, index) => {
    const prefix = `第 ${index + 1} 页`
    if (slide.slideNo !== index + 1) issues.push(`${prefix} slideNo 不连续`)
    if (!isNonEmptyString(slide.title)) {
      issues.push(`${prefix} 缺少标题`)
    } else if (slide.title.length > TITLE_MAX) {
      issues.push(`${prefix} 标题超过 ${TITLE_MAX} 字`)
    }

    const bullets = slide.bullets || []
    if (bullets.length > MAX_BULLETS) issues.push(`${prefix} 要点超过 ${MAX_BULLETS} 条`)
    bullets.forEach((b, i) => {
      if (!isNonEmptyString(b)) issues.push(`${prefix} 第 ${i + 1} 条要点为空`)
      else if (b.length > BULLET_MAX) issues.push(`${prefix} 第 ${i + 1} 条要点超过 ${BULLET_MAX} 字`)
    })

    const refs = slide.evidenceRefs || []
    refs.forEach(ref => {
      if (!EVIDENCE_RE.test(ref)) issues.push(`${prefix} 证据引用格式错误：${ref}`)
    })

    switch (slide.layout) {
      case 'cover':
        if (!isNonEmptyString(slide.subtitle)) issues.push(`${prefix} 封面缺少副标题`)
        break
      case 'section':
        if (!isNonEmptyString(slide.sectionNo)) issues.push(`${prefix} 章节页缺少章节编号`)
        break
      case 'summary':
        if (bullets.length < 2) issues.push(`${prefix} 摘要页至少需要 2 条要点`)
        break
      case 'module':
        if (bullets.length < 2) issues.push(`${prefix} 模块页至少需要 2 条要点`)
        if (
          options.type === 'FINAL'
          && refs.length === 0
          && !bullets.some(b => /\[[EF]\d+\]/.test(b))
          && !bullets.some(b => b.includes('公开信息不足'))
        ) {
          issues.push(`${prefix} 模块页缺少证据引用`)
        }
        break
      case 'gap':
        if (!slide.columns || slide.columns.length < 2) issues.push(`${prefix} 缺口页需要两列（阻塞/建议）`)
        break
      case 'risk':
      case 'matrix':
      case 'compare':
        if (!slide.columns || slide.columns.length < 2) issues.push(`${prefix} 对照页至少需要两列`)
        break
      case 'valuation':
        if (!slide.stats || slide.stats.length < 2) issues.push(`${prefix} 估值页至少需要 2 个指标`)
        break
      case 'appendix':
        if (bullets.length < 1 && refs.length < 1 && (!slide.columns || slide.columns.length < 1)) {
          issues.push(`${prefix} 附录页缺少内容`)
        }
        break
    }
  })

  return { ok: issues.length === 0, issues }
}

/** 对可自动修复的问题做一次收敛：截断超长文本、剔除非法引用 */
export function coerceDeckSpec(spec: DeckSpec): DeckSpec {
  const slides = spec.slides.map(slide => ({
    ...slide,
    title: (slide.title || '').slice(0, TITLE_MAX),
    bullets: (slide.bullets || []).slice(0, MAX_BULLETS).map(b => b.slice(0, BULLET_MAX)),
    evidenceRefs: (slide.evidenceRefs || []).filter(ref => EVIDENCE_RE.test(ref)),
    columns: (slide.columns || []).map(c => ({
      ...c,
      items: (c.items || []).slice(0, 5).map(i => i.slice(0, 80)),
    })),
    stats: (slide.stats || []).slice(0, 4).map(s => ({
      ...s,
      value: s.value.slice(0, 16),
      label: s.label.slice(0, 16),
    })),
  }))
  return { ...spec, slides }
}
