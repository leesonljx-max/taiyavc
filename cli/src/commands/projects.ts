/**
 * projects 命令 —— 项目列表（文本表格输出）
 *
 * investrask projects            项目库（全部）
 * investrask projects --mine     我的项目
 * investrask projects 关键词     按名称/行业/定位过滤
 */

import { fetchProjects } from '../api/index.js'
import { c, padEnd, truncate, stageLabel, formatDate, amount, STAGE_ORDER } from '../format.js'
import { handleError } from './stats.js'
import type { ProjectListItem, FollowStage } from '../types.js'

export async function runProjects(args: string[]): Promise<void> {
  const mine = args.includes('--mine') || args.includes('-m')
  const keyword = args.filter(a => !a.startsWith('-')).join(' ').trim().toLowerCase()

  let projects: ProjectListItem[]
  try {
    projects = (await fetchProjects(mine ? 'mine' : 'all')).projects
  } catch (err) {
    handleError(err)
  }

  // 本地过滤（与网页端一致：前端过滤）
  let filtered = projects
  if (keyword) {
    filtered = projects.filter(p =>
      [p.name, p.companyFullName, p.industry, p.companyPosition, p.financingRound]
        .some(f => (f ?? '').toLowerCase().includes(keyword))
    )
  }

  // 按阶段排序（越靠后越前）+ 创建时间倒序
  filtered = [...filtered].sort((a, b) => {
    const sa = STAGE_ORDER.indexOf(a.followStage as FollowStage)
    const sb = STAGE_ORDER.indexOf(b.followStage as FollowStage)
    if (sa !== sb) return sb - sa
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  const scopeLabel = mine ? '我的项目' : '项目库'
  const filterLabel = keyword ? c.dim(` · 筛选「${keyword}」`) : ''
  console.log(c.bold(`📁 ${scopeLabel}（${filtered.length}）`) + filterLabel)

  if (filtered.length === 0) {
    console.log(c.dim('  （无项目）'))
    return
  }

  // 表格列宽
  const W = { stage: 8, name: 24, industry: 12, amount: 12, date: 12 }

  // 表头
  const header =
    '  ' +
    padEnd('阶段', W.stage) +
    padEnd('项目名称', W.name) +
    padEnd('行业', W.industry) +
    padEnd('融资金额', W.amount) +
    '初聊日期'
  console.log(c.dim(header))
  console.log(c.dim('  ' + '─'.repeat(60)))

  for (const p of filtered) {
    const stage = padEnd(STAGE_LABEL_PLAIN(p.followStage), W.stage)
    const name = padEnd(truncate(p.name, W.name - 2), W.name)
    const industry = padEnd(truncate(p.industry ?? '-', W.industry - 2), W.industry)
    const amt = padEnd(truncate(amount(p.totalAmount), W.amount - 2), W.amount)
    const date = formatDate(p.targetDate)
    console.log(
      '  ' +
        stageColor(p.followStage, stage) +
        c.bold(name) +
        c.dim(industry) +
        amountColor(p.totalAmount) +
        c.dim(date)
    )
  }

  console.log()
  console.log(c.dim('提示：investrask project <名称> 查看详情；investrask（无参数）进入交互界面'))
}

function STAGE_LABEL_PLAIN(stage: string): string {
  const labels: Record<string, string> = {
    INITIAL_TALK: '初聊',
    PRE_DD: 'PreDD',
    PROJECT_INITIATION: '立项',
    DUE_DILIGENCE: '尽调',
    AGREEMENT: '协议',
    CLOSING: '交割',
    POST_INVESTMENT: '投后',
  }
  return labels[stage] ?? stage
}

function stageColor(stage: string, label: string): string {
  return stageLabel(stage).replace(STAGE_LABEL_PLAIN(stage), label)
}

function amountColor(text: string | number | null | undefined): string {
  const s = text === null || text === undefined ? '' : String(text)
  if (s.trim() === '' || s === '-') return padEnd('-', 12)
  return padEnd(s, 12)
}
