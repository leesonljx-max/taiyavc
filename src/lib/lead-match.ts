/**
 * 项目线索名称重合检测工具
 *
 * "高度重合" 定义：
 * 1. 归一化后完全相同（去空格、转小写、去常见公司后缀）
 * 2. 一方包含另一方（且较短一方长度 >= 2）
 * 3. 基于编辑距离的相似度 >= 0.8
 */

/** 常见公司后缀（归一化时去除） */
const COMPANY_SUFFIXES = [
  '有限公司', '有限责任公司', '股份有限公司', '科技公司', '技术有限公司',
  '集团', '控股集团', '网络科技', '信息技术', '智能科技',
  'CoLtd', 'Ltd', 'Inc', 'Corp', 'LLC', 'Company', 'Limited',
]

/** 归一化名称：去空格、转小写、去标点、去公司后缀 */
export function normalizeName(name: string): string {
  let s = (name || '').trim().toLowerCase()
  // 去除所有空白
  s = s.replace(/\s+/g, '')
  // 去除常见标点
  s = s.replace(/[·,.\-_、（）()【】\[\]{}'"`]/g, '')
  // 去除公司后缀
  for (const suffix of COMPANY_SUFFIXES) {
    const lower = suffix.toLowerCase()
    if (s.endsWith(lower) && s.length > lower.length) {
      s = s.slice(0, s.length - lower.length)
      break
    }
  }
  return s
}

/** Levenshtein 编辑距离 */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }
  return dp[m][n]
}

/** 相似度比率 [0, 1]，1 表示完全相同 */
export function similarity(a: string, b: string): number {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na && !nb) return 1
  if (!na || !nb) return 0
  if (na === nb) return 1
  const dist = levenshtein(na, nb)
  const maxLen = Math.max(na.length, nb.length)
  return 1 - dist / maxLen
}

/**
 * 判断两个名称是否"高度重合"
 * - 归一化后完全相同
 * - 一方包含另一方（较短一方长度 >= 2）
 * - 相似度 >= 0.8
 */
export function isHighlyOverlapping(a: string, b: string): boolean {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return false

  // 1. 归一化后完全相同
  if (na === nb) return true

  // 2. 一方包含另一方（较短一方长度 >= 2，避免单字误匹配）
  const shorter = na.length <= nb.length ? na : nb
  const longer = na.length <= nb.length ? nb : na
  if (shorter.length >= 2 && longer.includes(shorter)) return true

  // 3. 相似度 >= 0.8
  return similarity(na, nb) >= 0.8
}

/** 重合检测阈值（用于排序/参考） */
export const HIGH_OVERLAP_THRESHOLD = 0.8
