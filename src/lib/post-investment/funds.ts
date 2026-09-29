/**
 * 投后管理：投资基金选项
 * 默认四只基金 + 用户在项目中录入过的自定义基金（"新增基金"），全项目共享下拉选项
 */

import prisma from '@/lib/prisma'

/** 系统预置基金（下拉前四项） */
export const DEFAULT_FUNDS = ['泰亚一期', '泰亚创新', '泰亚三期', '泰亚四期']

/** 可选基金列表 = 预置基金 + 已录入的自定义基金（按名称排序） */
export async function getAvailableFunds(): Promise<string[]> {
  const rows = await prisma.project.findMany({
    where: { postInvestFund: { not: null } },
    distinct: ['postInvestFund'],
    select: { postInvestFund: true },
  })
  const custom = rows
    .map(r => r.postInvestFund!)
    .filter(f => f.trim() && !DEFAULT_FUNDS.includes(f))
    .sort()
  return [...DEFAULT_FUNDS, ...custom]
}
