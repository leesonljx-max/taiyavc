/**
 * 项目详情屏 —— 基本信息 / 投资亮点（手动+AI）/ 描述 / 文档
 *
 * 键位：[esc 或 b] 返回列表 [j/k↑↓] 滚动
 */

import React, { useEffect, useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { fetchProjectDetail } from '../api/index.js'
import { formatDate } from '../format.js'
import { StageBadge } from './DashboardScreen.js'
import type { AiHighlights, ProjectDetail } from '../types.js'

interface Props {
  projectId: string
  projectName: string
  onBack: () => void
}

export default function ProjectDetailScreen({ projectId, projectName, onBack }: Props) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [error, setError] = useState('')
  const [scroll, setScroll] = useState(0)

  useEffect(() => {
    setDetail(null)
    setError('')
    setScroll(0)
    fetchProjectDetail(projectId)
      .then(d => setDetail(d.project))
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [projectId])

  const scrollBy = useCallback(
    (delta: number) => {
      setScroll(s => Math.max(0, s + delta))
    },
    []
  )

  useInput((input, key) => {
    if (key.escape || input === 'b') onBack()
    else if (key.upArrow || input === 'k') scrollBy(-3)
    else if (key.downArrow || input === 'j') scrollBy(3)
  })

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">✗ {error}</Text>
        <Text dimColor>按 [esc] 返回</Text>
      </Box>
    )
  }

  if (!detail) {
    return (
      <Box padding={1}>
        <Text dimColor>加载中…</Text>
      </Box>
    )
  }

  // 详情内容行（渲染后统一滚动裁剪）
  const lines: React.ReactNode[] = []

  const infoRows: Array<[string, string]> = [
    ['公司全称', detail.companyFullName ?? '-'],
    ['所处行业', detail.industry ?? '-'],
    ['公司定位', detail.companyPosition ?? '-'],
    ['融资金额', detail.totalAmount || '-'],
    ['累计融资', detail.raisedAmount || '-'],
    ['投资估值', detail.investmentValuation || '-'],
    ['融资轮次', detail.financingRound ?? '-'],
    ['初聊日期', formatDate(detail.targetDate)],
    ['创建时间', formatDate(detail.createdAt)],
    ['维护人', detail.createdBy?.name ?? '-'],
  ]

  lines.push(
    <Box key="title" flexDirection="row" gap={1}>
      <Text bold color="cyan">
        ◆ {detail.name}
      </Text>
      <StageBadge stage={detail.followStage} />
    </Box>
  )

  lines.push(
    <Box key="info" flexDirection="column" marginTop={1}>
      {infoRows.map(([k, v]) => (
        <Box key={k}>
          <Text dimColor>{` ${k.padEnd(8, '　')} `}</Text>
          <Text>{v}</Text>
        </Box>
      ))}
    </Box>
  )

  // 投资亮点
  const aiHighlights = parseAi(detail.aiHighlightsJson)
  if (detail.manualHighlights || aiHighlights) {
    const children: React.ReactNode[] = []
    children.push(
      <Text key="hl-title" bold color="yellow">
        ✨ 投资亮点
      </Text>
    )
    if (detail.manualHighlights) {
      children.push(
        <Text key="hl-manual" dimColor>
          [维护人填写]
        </Text>
      )
      for (const line of detail.manualHighlights.split('\n')) {
        if (line.trim()) children.push(<Text key={`m-${children.length}`}>{` ${line}`}</Text>)
      }
    }
    if (aiHighlights) {
      children.push(
        <Text key="hl-ai" dimColor>
          [AI 总结 · {formatDate(aiHighlights.analyzedAt)}]
        </Text>
      )
      aiHighlights.highlights.forEach((h, i) =>
        children.push(
          <Text key={`a-${i}`}>
            <Text color="cyan">{` ${i + 1}. `}</Text>
            {h}
          </Text>
        )
      )
    }
    lines.push(
      <Box key="highlights" flexDirection="column" marginTop={1}>
        {children}
      </Box>
    )
  }

  // 项目描述
  if (detail.description) {
    lines.push(
      <Box key="desc" flexDirection="column" marginTop={1}>
        <Text bold color="green">
          📝 项目描述
        </Text>
        {detail.description
          .split('\n')
          .filter(l => l.trim())
          .slice(0, 10)
          .map((l, i) => (
            <Text key={i}>{` ${l}`}</Text>
          ))}
      </Box>
    )
  }

  // 文档列表
  if (detail.documents && detail.documents.length > 0) {
    lines.push(
      <Box key="docs" flexDirection="column" marginTop={1}>
        <Text bold color="magenta">
          📄 项目文档（{detail.documents.length}）
        </Text>
        {detail.documents.map(d => (
          <Text key={d.id}>{` • ${d.fileName}`} <Text dimColor>{formatDate(d.createdAt)}</Text></Text>
        ))}
      </Box>
    )
  }

  // 滚动窗口（每屏 18 行）
  const visible = lines.slice(scroll, scroll + 18)

  return (
    <Box flexDirection="column" padding={1}>
      {visible}
      {lines.length > 18 && (
        <Text dimColor>
          [j/k] 滚动查看更多（{scroll}/{lines.length - 18}）
        </Text>
      )}
      <Text dimColor>[esc/b] 返回项目库</Text>
    </Box>
  )
}

function parseAi(json: string | null | undefined): AiHighlights | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as AiHighlights
    if (Array.isArray(parsed.highlights)) return parsed
    return null
  } catch {
    return null
  }
}
