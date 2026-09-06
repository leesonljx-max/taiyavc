/**
 * project 命令 —— 项目详情（按名称模糊搜索）
 *
 * investrask project 某公司名
 */

import { findProjectByName, fetchProjectDetail } from '../api/index.js'
import { c, stageLabel, formatDate, amount, roleLabel } from '../format.js'
import { handleError } from './stats.js'
import type { AiHighlights, ProjectDetail } from '../types.js'

export async function runProject(args: string[]): Promise<void> {
  const keyword = args.filter(a => !a.startsWith('-')).join(' ').trim()
  if (!keyword) {
    console.error(c.red('用法：investrask project <项目名称>'))
    process.exit(1)
  }

  let matched
  try {
    matched = await findProjectByName(keyword)
  } catch (err) {
    handleError(err)
  }

  if (!matched) {
    console.error(c.red(`✗ 未找到匹配「${keyword}」的项目`))
    console.error(c.dim('  提示：investrask projects 查看全部项目'))
    process.exit(1)
  }

  let detail: ProjectDetail
  try {
    detail = (await fetchProjectDetail(matched.id)).project
  } catch (err) {
    handleError(err)
  }

  renderDetail(detail)
}

function renderDetail(p: ProjectDetail): void {
  const line = '─'.repeat(56)

  console.log()
  console.log(c.bold(`◆ ${p.name}`) + '  ' + stageLabel(p.followStage))
  if (p.companyFullName) console.log(c.dim(`  ${p.companyFullName}`))
  console.log(c.dim('  ' + line))

  // 基本信息
  const info: Array<[string, string]> = [
    ['所处行业', p.industry ?? '-'],
    ['公司定位', p.companyPosition ?? '-'],
    ['融资金额', amount(p.totalAmount)],
    ['累计融资', amount(p.raisedAmount)],
    ['投资估值', amount(p.investmentValuation)],
    ['融资轮次', p.financingRound ?? '-'],
    ['初聊日期', formatDate(p.targetDate)],
    ['创建时间', formatDate(p.createdAt)],
  ]
  for (const [k, v] of info) {
    console.log(`  ${c.dim(padEndLabel(k))} ${v}`)
  }

  // 维护人
  const creator = p.createdBy?.name ?? '-'
  const members = (p.members ?? [])
    .map(m => m.user?.name ?? m.user?.email ?? m.userId ?? '')
    .filter(Boolean)
    .join('、')
  console.log(`  ${c.dim(padEndLabel('维护人'))} ${creator}`)
  if (members && members !== creator) {
    console.log(`  ${c.dim(padEndLabel('辅助维护'))} ${members}`)
  }

  // 投资亮点（手动 + AI）
  console.log()
  console.log(c.bold('✨ 投资亮点'))
  if (p.manualHighlights) {
    console.log(c.dim('  [维护人填写]'))
    for (const l of p.manualHighlights.split('\n')) {
      if (l.trim()) console.log(`  ${l}`)
    }
  }
  if (p.aiHighlightsJson) {
    try {
      const ai = JSON.parse(p.aiHighlightsJson) as AiHighlights
      console.log(c.dim(`  [AI 总结 · ${formatDate(ai.analyzedAt)}]`))
      ai.highlights.forEach((h, i) => {
        console.log(`  ${c.cyan(`${i + 1}.`)} ${h}`)
      })
    } catch {
      // AI 亮点解析失败则跳过
    }
  }
  if (!p.manualHighlights && !p.aiHighlightsJson) {
    console.log(c.dim('  （暂无）'))
  }

  // 项目描述
  if (p.description) {
    console.log()
    console.log(c.bold('📝 项目描述'))
    console.log(wrapText(p.description, 52, '  '))
  }

  // 文档列表
  if (p.documents && p.documents.length > 0) {
    console.log()
    console.log(c.bold(`📄 项目文档（${p.documents.length}）`))
    for (const d of p.documents) {
      console.log(`  • ${d.fileName}  ${c.dim(formatDate(d.createdAt))}`)
    }
  }

  console.log()
  console.log(c.dim('提示：investrask project <名称> 查看其他项目'))
}

function padEndLabel(label: string): string {
  // 中文标签 4 字宽对齐（显示宽度 12）
  let result = label
  while (displayWidthOf(result) < 10) result += ' '
  return result + ' '
}

function displayWidthOf(text: string): number {
  let width = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    width += code >= 0x4e00 && code <= 0x9fff ? 2 : 1
  }
  return width
}

/** 按显示宽度换行（中文占 2 列） */
function wrapText(text: string, maxWidth: number, indent: string): string {
  const lines: string[] = []
  let current = ''
  let width = 0
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(indent + current)
      current = ''
      width = 0
      continue
    }
    const w = ch.codePointAt(0) !== undefined && (ch.codePointAt(0) as number) >= 0x4e00 && (ch.codePointAt(0) as number) <= 0x9fff ? 2 : 1
    if (width + w > maxWidth) {
      lines.push(indent + current)
      current = ch
      width = w
    } else {
      current += ch
      width += w
    }
  }
  if (current) lines.push(indent + current)
  return lines.join('\n')
}
