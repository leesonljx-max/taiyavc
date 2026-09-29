/**
 * 投后管理：同比/环比计算引擎（程序计算，LLM 不算数）
 *
 * 报告期口径：
 * - Q：季度（2026Q1-Q4），环比 = 上一季度（Q1 的上期为上年 Q4）
 * - H：半年（2026H1/H2），环比 = 上一半年期；不与单季度互算
 * - FY：全年（2026FY），无环比
 * 同比 = 上年同期（Q vs Q / H vs H / FY vs FY）
 */

export type PeriodType = 'Q' | 'H' | 'FY'

export interface PeriodInfo {
  year: number
  /** Q: 1-4 / H: 1-2 / FY: 0 */
  seq: number
  type: PeriodType
}

/** 解析报告期字符串（2026Q1 / 2026H1 / 2026FY） */
export function parsePeriod(period: string): PeriodInfo | null {
  const m = /^(\d{4})(Q([1-4])|H([1-2])|FY)$/.exec(period.trim().toUpperCase())
  if (!m) return null
  if (m[3]) return { year: Number(m[1]), seq: Number(m[3]), type: 'Q' }
  if (m[4]) return { year: Number(m[1]), seq: Number(m[4]), type: 'H' }
  return { year: Number(m[1]), seq: 0, type: 'FY' }
}

export function isValidPeriod(period: string): boolean {
  return parsePeriod(period) !== null
}

/** 环比上期：Q→上一季（Q1 跨年到上年 Q4）；H→上一半年（H1 的上期为上年 H2）；FY→无 */
export function prevQoQPeriod(period: string): string | null {
  const p = parsePeriod(period)
  if (!p) return null
  if (p.type === 'Q') {
    if (p.seq > 1) return `${p.year}Q${p.seq - 1}`
    return `${p.year - 1}Q4`
  }
  if (p.type === 'H') {
    if (p.seq > 1) return `${p.year}H1`
    return `${p.year - 1}H2`
  }
  return null
}

/** 同比上期：上年同期 */
export function prevYoYPeriod(period: string): string | null {
  const p = parsePeriod(period)
  if (!p) return null
  if (p.type === 'Q') return `${p.year - 1}Q${p.seq}`
  if (p.type === 'H') return `${p.year - 1}H${p.seq}`
  return `${p.year - 1}FY`
}

export interface ChangeResult {
  /** 变化值（本期 - 上期） */
  diff: number
  /** 变化率（比例值，0.52 = +52%）；上期为 0 或缺失时为 null */
  pct: number | null
}

/** 计算变化：分母为 0 或上期缺失 → pct=null（前端显示 "-"） */
export function calcChange(current: number, previous: number | undefined | null): ChangeResult | null {
  if (previous === undefined || previous === null || Number.isNaN(previous)) return null
  const diff = Math.round((current - previous) * 100) / 100
  if (previous === 0) return { diff, pct: null }
  return { diff, pct: Math.round((diff / Math.abs(previous)) * 10000) / 10000 }
}

export interface MetricWithChange {
  metricKey: string
  metricName: string
  category: string
  unit: string
  value: number
  yoy: { period: string; diff: number; pct: number | null } | null
  qoq: { period: string; diff: number; pct: number | null } | null
  sourceText: string | null
}

/**
 * 批量计算某期全部指标的同比/环比
 * @param currentMetrics 本期指标 [{ metricKey, metricName, category, unit, value, sourceText }]
 * @param historyByPeriod 各期指标值映射 period → { metricKey → value }
 */
export function computeMetricsWithChange(
  period: string,
  currentMetrics: Array<{ metricKey: string; metricName: string; category: string; unit: string; value: number; sourceText: string | null }>,
  historyByPeriod: Map<string, Map<string, number>>
): MetricWithChange[] {
  const yoyPeriod = prevYoYPeriod(period)
  const qoqPeriod = prevQoQPeriod(period)
  const yoyMap = yoyPeriod ? historyByPeriod.get(yoyPeriod) : undefined
  const qoqMap = qoqPeriod ? historyByPeriod.get(qoqPeriod) : undefined

  return currentMetrics.map(m => {
    const yoy = yoyMap ? calcChange(m.value, yoyMap.get(m.metricKey)) : null
    const qoq = qoqMap ? calcChange(m.value, qoqMap.get(m.metricKey)) : null
    return {
      ...m,
      yoy: yoy ? { period: yoyPeriod!, ...yoy } : null,
      qoq: qoq ? { period: qoqPeriod!, ...qoq } : null,
    }
  })
}

/** 现金覆盖月数（Runway）：现金余额 / 月均现金净消耗（经营现金流为负时才有意义） */
export function calcRunwayMonths(cashBalance: number | undefined, operatingCashFlow: number | undefined, period: string): number | null {
  if (cashBalance === undefined || operatingCashFlow === undefined || cashBalance <= 0 || operatingCashFlow >= 0) return null
  const p = parsePeriod(period)
  if (!p) return null
  const months = p.type === 'Q' ? 3 : p.type === 'H' ? 6 : 12
  const monthlyBurn = Math.abs(operatingCashFlow) / months
  if (monthlyBurn <= 0) return null
  return Math.round((cashBalance / monthlyBurn) * 10) / 10
}
