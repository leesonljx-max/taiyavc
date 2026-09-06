/**
 * 终端文本格式化工具
 *
 * - ANSI 颜色（零依赖，不引入 chalk）
 * - 中文宽度感知的表格对齐
 * - 阶段/角色中文标签映射（与网页端一致）
 */

import type { FollowStage, UserRole } from './types.js'

// ── ANSI 颜色 ──

const isTTY = process.stdout.isTTY

function color(code: string, text: string): string {
  return isTTY ? `\x1b[${code}m${text}\x1b[0m` : text
}

export const c = {
  bold: (t: string) => color('1', t),
  dim: (t: string) => color('2', t),
  red: (t: string) => color('31', t),
  green: (t: string) => color('32', t),
  yellow: (t: string) => color('33', t),
  blue: (t: string) => color('34', t),
  magenta: (t: string) => color('35', t),
  cyan: (t: string) => color('36', t),
  white: (t: string) => color('37', t),
  gray: (t: string) => color('90', t),
}

// ── 阶段与角色标签（与主项目一致） ──

export const STAGE_LABELS: Record<FollowStage, string> = {
  INITIAL_TALK: '初聊',
  PRE_DD: 'PreDD',
  PROJECT_INITIATION: '立项',
  DUE_DILIGENCE: '尽调',
  AGREEMENT: '协议',
  CLOSING: '交割',
  POST_INVESTMENT: '投后',
}

/** 阶段顺序（用于排序） */
export const STAGE_ORDER: FollowStage[] = [
  'INITIAL_TALK',
  'PRE_DD',
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'AGREEMENT',
  'CLOSING',
  'POST_INVESTMENT',
]

/** 阶段对应的终端颜色（语义与网页端一致：尽调=紫、交割=绿等） */
export function stageLabel(stage: string): string {
  const label = STAGE_LABELS[stage as FollowStage] ?? stage
  switch (stage) {
    case 'INITIAL_TALK':
      return c.gray(label)
    case 'PRE_DD':
      return c.cyan(label)
    case 'PROJECT_INITIATION':
      return c.blue(label)
    case 'DUE_DILIGENCE':
      return c.magenta(label)
    case 'AGREEMENT':
      return c.yellow(label)
    case 'CLOSING':
      return c.green(label)
    case 'POST_INVESTMENT':
      return c.bold(label)
    default:
      return label
  }
}

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: '管理员',
  INVESTMENT_MANAGER: '投资经理',
  INVESTMENT_PARTNER: '投资合伙人',
  POST_INVESTMENT_OFFICER: '投后专员',
  TEMP_VISITOR: '临时访客',
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as UserRole] ?? role
}

// ── 中文宽度对齐 ──

/** 计算字符串显示宽度（CJK 字符算 2 列） */
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    // CJK 统一表意文字、全角标点、CJK 标点
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      width += 2
    } else {
      width += 1
    }
  }
  return width
}

/** 按显示宽度右侧补空格 */
export function padEnd(text: string, width: number): string {
  const dw = displayWidth(text)
  return dw >= width ? text : text + ' '.repeat(width - dw)
}

/** 按显示宽度左侧补空格 */
export function padStart(text: string, width: number): string {
  const dw = displayWidth(text)
  return dw >= width ? text : ' '.repeat(width - dw) + text
}

/** 截断过长文本（按显示宽度） */
export function truncate(text: string, maxWidth: number): string {
  if (displayWidth(text) <= maxWidth) return text
  let width = 0
  let result = ''
  for (const ch of text) {
    const w = displayWidth(ch)
    if (width + w > maxWidth - 1) break
    result += ch
    width += w
  }
  return result + '…'
}

// ── 通用格式化 ──

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '-'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/** 金额显示（空值 → '-'；容错数字类型，详情 API 可能返回 number） */
export function amount(text: string | number | null | undefined): string {
  if (text === null || text === undefined) return '-'
  const s = String(text)
  if (s.trim() === '') return '-'
  return s
}
