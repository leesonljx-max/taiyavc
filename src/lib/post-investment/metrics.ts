/**
 * 投后管理：统一指标字典（MVP 范围）
 * 所有从经营报告/财务报表中提取的指标必须匹配字典 key，保证时序库口径一致
 */

export interface MetricDef {
  key: string
  name: string
  unit: string
  category: 'financial' | 'business'
  /** 提取提示（口径说明，写入 AI 提取 prompt） */
  hint: string
}

export const POST_INVEST_METRICS: MetricDef[] = [
  { key: 'revenue', name: '营业收入', unit: '万元', category: 'financial', hint: '当期实现的营业收入/销售收入（含同比则提取当期值）' },
  { key: 'gross_profit', name: '毛利润', unit: '万元', category: 'financial', hint: '当期毛利润' },
  { key: 'gross_margin', name: '毛利率', unit: '%', category: 'financial', hint: '当期毛利率（百分数值，如 38 表示 38%）' },
  { key: 'net_profit', name: '净利润', unit: '万元', category: 'financial', hint: '当期净利润（亏损为负数）' },
  { key: 'net_margin', name: '净利率', unit: '%', category: 'financial', hint: '当期净利率（百分数值，亏损为负）' },
  { key: 'operating_cash_flow', name: '经营现金流', unit: '万元', category: 'financial', hint: '当期经营活动产生的现金流量净额（负数为净流出）' },
  { key: 'cash_balance', name: '现金余额', unit: '万元', category: 'financial', hint: '报告期末现金及等价物余额（含理财如有说明）' },
  { key: 'total_assets', name: '总资产', unit: '万元', category: 'financial', hint: '报告期末总资产' },
  { key: 'total_liabilities', name: '总负债', unit: '万元', category: 'financial', hint: '报告期末总负债' },
  { key: 'net_assets', name: '净资产', unit: '万元', category: 'financial', hint: '报告期末净资产/所有者权益' },
  { key: 'accounts_receivable', name: '应收账款', unit: '万元', category: 'financial', hint: '报告期末应收账款余额' },
  { key: 'inventory', name: '存货', unit: '万元', category: 'financial', hint: '报告期末存货余额' },
  { key: 'new_orders', name: '新签订单', unit: '万元', category: 'business', hint: '当期新签订单金额' },
  { key: 'backlog_orders', name: '在手订单', unit: '万元', category: 'business', hint: '报告期末在手未交付订单金额' },
  { key: 'delivered_orders', name: '交付订单', unit: '万元', category: 'business', hint: '当期交付/验收订单金额' },
  { key: 'financing_amount', name: '融资额', unit: '万元', category: 'business', hint: '当期完成的股权/债权融资总额' },
]

export const METRIC_BY_KEY = new Map(POST_INVEST_METRICS.map(m => [m.key, m]))

/** 指标字典文本（写入 AI 提取 prompt） */
export function metricDictionaryText(): string {
  return POST_INVEST_METRICS.map(m => `- ${m.key}（${m.name}，单位：${m.unit}）：${m.hint}`).join('\n')
}
