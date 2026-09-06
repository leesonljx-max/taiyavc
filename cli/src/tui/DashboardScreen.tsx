/**
 * 工作台屏 —— 周统计四卡 + 本周新增项目 + 维护人进展
 */

import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { fetchDashboard } from '../api/index.js'
import { formatDate } from '../format.js'
import type { DashboardData, ProjectListItem } from '../types.js'

/** 阶段徽章颜色（Ink 颜色名，与网页端语义一致） */
const STAGE_COLOR: Record<string, string> = {
  INITIAL_TALK: 'gray',
  PRE_DD: 'cyan',
  PROJECT_INITIATION: 'blue',
  DUE_DILIGENCE: 'magenta',
  AGREEMENT: 'yellow',
  CLOSING: 'green',
  POST_INVESTMENT: 'white',
}

const STAGE_TEXT: Record<string, string> = {
  INITIAL_TALK: '初聊',
  PRE_DD: 'PreDD',
  PROJECT_INITIATION: '立项',
  DUE_DILIGENCE: '尽调',
  AGREEMENT: '协议',
  CLOSING: '交割',
  POST_INVESTMENT: '投后',
}

export function StageBadge({ stage }: { stage: string }) {
  return (
    <Text color={STAGE_COLOR[stage] ?? 'white'}>[{STAGE_TEXT[stage] ?? stage}]</Text>
  )
}

interface Props {
  onOpenProjects: () => void
  onOpenDetail: (project: ProjectListItem) => void
}

export default function DashboardScreen({ onOpenProjects, onOpenDetail }: Props) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchDashboard()
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  if (error) {
    return (
      <Box padding={1}>
        <Text color="red">✗ {error}</Text>
      </Box>
    )
  }

  if (!data) {
    return (
      <Box padding={1}>
        <Text dimColor>加载中…</Text>
      </Box>
    )
  }

  const { stats, weekStart, weeklyProjects, maintainerStats } = data

  return (
    <Box flexDirection="column" padding={1}>
      <Text dimColor>本周起始：{formatDate(weekStart)}</Text>
      <Box flexDirection="row" gap={1} marginY={1}>
        <StatCard label="本周新增" value={stats.weeklyNew} color="blue" />
        <StatCard label="PreDD" value={stats.preDD} color="cyan" />
        <StatCard label="立项" value={stats.initiated} color="yellow" />
        <StatCard label="尽调" value={stats.dueDiligence} color="magenta" />
      </Box>

      <Box flexDirection="column">
        <Text bold>📋 本周新增项目（{weeklyProjects.length}）</Text>
        {weeklyProjects.length === 0 ? (
          <Text dimColor>  （本周暂无新增）</Text>
        ) : (
          weeklyProjects.map(p => (
            <Box key={p.id} marginLeft={1}>
              <Text color="cyan">•</Text>
              <Text bold color="white">
                {' '}
                {p.name}{' '}
              </Text>
              <StageBadge stage={p.followStage} />
              <Text dimColor> @{p.maintainerName}</Text>
            </Box>
          ))
        )}
      </Box>

      {maintainerStats.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>👥 维护人本周进展</Text>
          {maintainerStats.map(m => {
            const stages = Object.entries(m.stageCounts)
              .filter(([, n]) => n > 0)
              .map(([s, n]) => `${STAGE_TEXT[s] ?? s}×${n}`)
              .join('  ')
            return (
              <Box key={m.userId} marginLeft={1} flexDirection="row">
                <Text bold> {m.userName} </Text>
                <Text dimColor>{stages || '无阶段变更'} · 共 {m.projects.length} 个项目</Text>
              </Box>
            )
          })}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>按 [2] 打开项目库 · 按 [q] 退出</Text>
      </Box>
    </Box>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Box borderStyle="round" borderColor={color} flexDirection="column" paddingX={2}>
      <Text color={color} bold>
        {String(value)}
      </Text>
      <Text dimColor>{label}</Text>
    </Box>
  )
}
