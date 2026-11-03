/**
 * 投后管理：统一指标字典（MVP 范围）
 * 所有从经营报告/财务报表中提取的指标必须匹配字典 key，保证时序库口径一致
 *
 * 固定框架：核心 12 项指标在所有项目、所有报告期按同一顺序展示（缺失项显示「—」），
 * 补充指标（毛利/净利率/订单）仅在提取到时追加在核心指标之后。
 */

export interface MetricDef {
  key: string
  name: string
  unit: string
  category: 'financial' | 'business'
  /** 提取提示（口径说明，写入 AI 提取 prompt） */
  hint: string
}

/** 核心指标固定顺序（前端表格、AI 输入、指标提取 prompt 共用） */
export const CORE_METRIC_KEYS = [
  'revenue',
  'net_profit',
  'operating_cash_flow',
  'cash_balance',
  'total_assets',
  'total_liabilities',
  'net_assets',
  'short_term_debt',
  'accounts_receivable',
  'accounts_payable',
  'inventory',
  'financing_amount',
] as const

export const POST_INVEST_METRICS: MetricDef[] = [
  // ── 核心 12 项（顺序与 CORE_METRIC_KEYS 一致） ──
  { key: 'revenue', name: '营业收入', unit: '万元', category: 'financial', hint: '当期实现的营业收入/销售收入（含同比则提取当期值）' },
  { key: 'net_profit', name: '净利润', unit: '万元', category: 'financial', hint: '当期净利润（亏损为负数）' },
  { key: 'operating_cash_flow', name: '经营现金流', unit: '万元', category: 'financial', hint: '当期经营活动产生的现金流量净额（负数为净流出）' },
  { key: 'cash_balance', name: '现金余额', unit: '万元', category: 'financial', hint: '报告期末现金及等价物余额（含理财如有说明）' },
  { key: 'total_assets', name: '总资产', unit: '万元', category: 'financial', hint: '报告期末总资产' },
  { key: 'total_liabilities', name: '总负债', unit: '万元', category: 'financial', hint: '报告期末总负债（资产负债表的负债合计）' },
  { key: 'net_assets', name: '净资产', unit: '万元', category: 'financial', hint: '报告期末净资产/所有者权益合计' },
  { key: 'short_term_debt', name: '短期负债', unit: '万元', category: 'financial', hint: '报告期末短期借款/一年内到期的非流动负债等短期有息负债' },
  { key: 'accounts_receivable', name: '应收账款', unit: '万元', category: 'financial', hint: '报告期末应收账款余额' },
  { key: 'accounts_payable', name: '应付账款', unit: '万元', category: 'financial', hint: '报告期末应付账款余额' },
  { key: 'inventory', name: '存货', unit: '万元', category: 'financial', hint: '报告期末存货余额' },
  { key: 'financing_amount', name: '融资额', unit: '万元', category: 'business', hint: '当期完成的股权/债权融资总额' },

  // ── 补充指标（提取到才展示，追加在核心指标之后） ──
  { key: 'gross_profit', name: '毛利润', unit: '万元', category: 'financial', hint: '当期毛利润' },
  { key: 'gross_margin', name: '毛利率', unit: '%', category: 'financial', hint: '当期毛利率（百分数值，如 38 表示 38%）' },
  { key: 'net_margin', name: '净利率', unit: '%', category: 'financial', hint: '当期净利率（百分数值，亏损为负）' },
  { key: 'new_orders', name: '新签订单', unit: '万元', category: 'business', hint: '当期新签订单金额' },
  { key: 'backlog_orders', name: '在手订单', unit: '万元', category: 'business', hint: '报告期末在手未交付订单金额' },
  { key: 'delivered_orders', name: '交付订单', unit: '万元', category: 'business', hint: '当期交付/验收订单金额' },
]

export const METRIC_BY_KEY = new Map(POST_INVEST_METRICS.map(m => [m.key, m]))

/** 指标字典文本（写入 AI 提取 prompt；核心项在前） */
export function metricDictionaryText(): string {
  const coreText = CORE_METRIC_KEYS.map(k => {
    const m = METRIC_BY_KEY.get(k)!
    return `- ${m.key}（${m.name}，单位：${m.unit}，核心）：${m.hint}`
  })
  const extraText = POST_INVEST_METRICS.filter(m => !(CORE_METRIC_KEYS as readonly string[]).includes(m.key))
    .map(m => `- ${m.key}（${m.name}，单位：${m.unit}）：${m.hint}`)
  return [...coreText, ...extraText].join('\n')
}

/** 按固定框架排序：核心 12 项按既定顺序，其余按字典顺序追加 */
export function sortMetricsByFramework<T extends { metricKey: string }>(metrics: T[]): T[] {
  const rank = new Map(POST_INVEST_METRICS.map((m, i) => [m.key, i]))
  return [...metrics].sort(
    (a, b) => (rank.get(a.metricKey) ?? POST_INVEST_METRICS.length) - (rank.get(b.metricKey) ?? POST_INVEST_METRICS.length)
  )
}

/**
 * 金额统一换算为万元（所有金额类指标固定口径）
 * 1亿元=10000万元；1百万元=100万元；1千元=0.1万元；1元=0.0001万元
 */
export function amountToWan(value: number, unit?: string | null): number {
  const u = String(unit || '').replace(/\s/g, '')
  let converted = value
  if (/亿元|亿/.test(u)) converted = value * 10000
  else if (/百万元|百万/.test(u)) converted = value * 100
  else if (/万元|万/.test(u)) converted = value
  else if (/千元|千/.test(u)) converted = value * 0.1
  else if (/元/.test(u)) converted = value * 0.0001
  return Math.round(converted * 100) / 100
}
