/**
 * stats 命令 —— 工作台周统计（文本输出）
 */

import { fetchDashboard } from '../api/index.js'
import { AuthError, ApiError } from '../api/client.js'
import { c, formatDate, stageLabel } from '../format.js'
import type { DashboardData, MaintainerStat } from '../types.js'

export async function runStats(): Promise<void> {
  let data: DashboardData
  try {
    data = await fetchDashboard()
  } catch (err) {
    handleError(err)
    return
  }

  const { stats, weekStart, weeklyProjects, maintainerStats } = data

  console.log(c.bold('📊 工作台周统计') + c.dim(`（本周起始：${formatDate(weekStart)}）`))
  console.log()

  // 四个统计卡
  const cards = [
    { label: '本周新增', value: stats.weeklyNew, color: c.blue },
    { label: 'PreDD', value: stats.preDD, color: c.cyan },
    { label: '立项', value: stats.initiated, color: c.yellow },
    { label: '尽调', value: stats.dueDiligence, color: c.magenta },
  ]
  const line = cards.map(k => `${k.color(k.label)} ${c.bold(String(k.value))}`).join('    ')
  console.log(`  ${line}`)
  console.log()

  // 本周新增项目
  if (weeklyProjects.length > 0) {
    console.log(c.bold(`本周新增项目（${weeklyProjects.length}）`))
    for (const p of weeklyProjects) {
      const maintainer = c.dim(`@${p.maintainerName}`)
      console.log(`  • ${c.bold(p.name)}  ${stageLabel(p.followStage)}  ${maintainer}`)
    }
    console.log()
  }

  // 维护人分组
  if (maintainerStats.length > 0) {
    console.log(c.bold('维护人本周进展'))
    for (const m of maintainerStats) {
      const stages = Object.entries(m.stageCounts)
        .filter(([, n]) => n > 0)
        .map(([s, n]) => `${stageLabel(s)}×${n}`)
        .join('  ')
      console.log(`  ${c.bold(m.userName)}  ${stages || c.dim('无阶段变更')}  ${c.dim(`共 ${m.projects.length} 个项目`)}`)
      for (const p of m.projects) {
        console.log(`    - ${p.name}  ${stageLabel(p.followStage)}  ${c.dim(p.totalAmount)}`)
      }
    }
  }
}

export function handleError(err: unknown): never {
  if (err instanceof AuthError) {
    console.error(c.red(`✗ ${err.message}`))
  } else if (err instanceof ApiError) {
    console.error(c.red(`✗ ${err.message}`))
  } else {
    console.error(c.red(`✗ ${err instanceof Error ? err.message : String(err)}`))
  }
  process.exit(1)
}
