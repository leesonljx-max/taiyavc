/**
 * 年度报告时间口径
 *
 * 所有「年/月」按 Asia/Shanghai 解释；数据库存 UTC。
 * 中国无夏令时，固定 +08:00，用 UTC 偏移换算即可，不依赖服务器本地时区。
 */

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

export type GenerationWindowState = 'BEFORE_WINDOW' | 'OPEN' | 'CLOSED'

export interface GenerationWindow {
  year: number
  state: GenerationWindowState
  windowStart: string
  windowEnd: string
  canGenerate: boolean
  forced: boolean
  reason?: string
}

/** 年度区间 [year-01-01 00:00 +08, year+1-01-01 00:00 +08) */
export function yearRange(year: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, 0, 1) - SHANGHAI_OFFSET_MS),
    end: new Date(Date.UTC(year + 1, 0, 1) - SHANGHAI_OFFSET_MS),
  }
}

/** 月份区间（上海时区自然月） */
export function monthRange(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - SHANGHAI_OFFSET_MS),
    end: new Date(Date.UTC(year, month, 1) - SHANGHAI_OFFSET_MS),
  }
}

/** 上海时区的年 / 月 / 日 */
export function shanghaiParts(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

/** YYYY-MM（上海时区） */
export function monthKey(date: Date): string {
  const { year, month } = shanghaiParts(date)
  return `${year}-${String(month).padStart(2, '0')}`
}

export function monthLabel(month: number): string {
  return `${month}月`
}

/** 当前应生成的目标年份：默认上一年；ANNUAL_REPORT_FORCE_YEAR 可覆盖（验收/测试用） */
export function resolveReportYear(now = new Date()): number {
  const forced = Number.parseInt(process.env.ANNUAL_REPORT_FORCE_YEAR || '', 10)
  if (Number.isFinite(forced) && forced >= 2000 && forced <= 2100) return forced
  return shanghaiParts(now).year - 1
}

/**
 * 生成窗口：year+1-01-01 00:00 至 year+1-03-01 00:00（左闭右开）
 * 3 月 1 日 00:00 起关闭；闰年 2/29 仍可生成。
 */
export function generationWindow(year: number, now = new Date()): GenerationWindow {
  const start = new Date(Date.UTC(year + 1, 0, 1) - SHANGHAI_OFFSET_MS)
  const end = new Date(Date.UTC(year + 1, 2, 1) - SHANGHAI_OFFSET_MS)
  const forcedYear = Number.parseInt(process.env.ANNUAL_REPORT_FORCE_YEAR || '', 10)
  const forced = Number.isFinite(forcedYear) && forcedYear === year

  const state: GenerationWindowState =
    forced ? 'OPEN' : now >= end ? 'CLOSED' : now < start ? 'BEFORE_WINDOW' : 'OPEN'

  return {
    year,
    state,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    canGenerate: state === 'OPEN',
    forced,
    ...(state === 'BEFORE_WINDOW' && {
      reason: `${year + 1} 年 1 月 1 日 00:00 开放生成`,
    }),
    ...(state === 'CLOSED' && {
      reason: `${year} 年报生成窗口已于 ${year + 1} 年 3 月 1 日 00:00 关闭`,
    }),
  }
}

/** 上海时区展示：YYYY-MM-DD HH:mm */
export function formatShanghaiDateTime(date: Date): string {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  const hh = String(shifted.getUTCHours()).padStart(2, '0')
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
}

/** 上海时区展示：YYYY-MM-DD */
export function formatShanghaiDate(date: Date): string {
  const { year, month, day } = shanghaiParts(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
