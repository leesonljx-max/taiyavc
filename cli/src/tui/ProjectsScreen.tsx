/**
 * 项目库屏 —— 全部/我的 切换 + 搜索 + 键盘导航列表
 *
 * 键位：[tab] 全部/我的切换 [/] 进入搜索 [esc] 退出搜索
 *       [j/k 或 ↑↓] 上下移动 [回车] 打开详情
 */

import React, { useEffect, useState, useCallback, useContext } from 'react'
import { Box, Text, useInput } from 'ink'
import { fetchProjects } from '../api/index.js'
import { formatDate } from '../format.js'
import { StageBadge } from './DashboardScreen.js'
import { InputMode } from './App.js'
import type { ProjectListItem, FollowStage } from '../types.js'

const STAGE_ORDER: FollowStage[] = [
  'INITIAL_TALK',
  'PRE_DD',
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'AGREEMENT',
  'CLOSING',
  'POST_INVESTMENT',
]

interface Props {
  onOpenDetail: (project: ProjectListItem) => void
}

export default function ProjectsScreen({ onOpenDetail }: Props) {
  const { searching, setSearchMode } = useContext(InputMode)
  const [scope, setScope] = useState<'all' | 'mine'>('all')
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [viewOffset, setViewOffset] = useState(0)

  // 加载数据（scope 变化时重新拉取）
  useEffect(() => {
    setProjects(null)
    setError('')
    fetchProjects(scope)
      .then(d => {
        setProjects(d.projects)
        setSelected(0)
        setViewOffset(0)
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [scope])

  // 本地过滤
  const filtered = (projects ?? []).filter(p => {
    if (!keyword.trim()) return true
    const kw = keyword.trim().toLowerCase()
    return [p.name, p.companyFullName, p.industry, p.companyPosition, p.financingRound].some(f =>
      (f ?? '').toLowerCase().includes(kw)
    )
  })

  // 按阶段倒序 + 创建时间倒序
  const sorted = [...filtered].sort((a, b) => {
    const sa = STAGE_ORDER.indexOf(a.followStage)
    const sb = STAGE_ORDER.indexOf(b.followStage)
    if (sa !== sb) return sb - sa
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  const moveTo = useCallback(
    (delta: number) => {
      if (sorted.length === 0) return
      setSelected(prev => {
        const next = Math.max(0, Math.min(sorted.length - 1, prev + delta))
        // 视口滚动（每屏最多显示 12 条）
        const viewHeight = 12
        if (next < viewOffset) setViewOffset(next)
        else if (next >= viewOffset + viewHeight) setViewOffset(next - viewHeight + 1)
        return next
      })
    },
    [sorted.length, viewOffset]
  )

  useInput((input, key) => {
    if (searching) {
      // 搜索模式：esc 退出，字符追加，退格删除
      if (key.escape) {
        setSearchMode(false)
        setKeyword('')
      } else if (key.return) {
        setSearchMode(false)
      } else if (key.backspace || key.delete) {
        setKeyword(k => Array.from(k).slice(0, -1).join(''))
      } else if (input && !key.ctrl && !key.meta) {
        setKeyword(k => k + input)
      }
      return
    }
    if (input === '/') {
      setSearchMode(true)
    } else if (key.tab) {
      setScope(s => (s === 'all' ? 'mine' : 'all'))
    } else if (key.upArrow || input === 'k') {
      moveTo(-1)
    } else if (key.downArrow || input === 'j') {
      moveTo(1)
    } else if (key.return) {
      const p = sorted[selected]
      if (p) onOpenDetail(p)
    }
  })

  return (
    <Box flexDirection="column" padding={1}>
      {/* 范围切换 + 搜索框 */}
      <Box flexDirection="row" gap={1} marginBottom={1}>
        <Text
          bold={scope === 'all'}
          color={scope === 'all' ? 'cyan' : 'gray'}
          inverse={scope === 'all'}
        >
          {' '}项目库{' '}
        </Text>
        <Text
          bold={scope === 'mine'}
          color={scope === 'mine' ? 'cyan' : 'gray'}
          inverse={scope === 'mine'}
        >
          {' '}我的项目{' '}
        </Text>
        <Text dimColor>{sorted.length} 个</Text>
        <Box flexGrow={1} />
        {searching ? (
          <Text color="yellow">搜索: {keyword}█</Text>
        ) : (
          <Text dimColor>[/] 搜索</Text>
        )}
      </Box>

      {error && <Text color="red">✗ {error}</Text>}
      {!error && !projects && <Text dimColor>加载中…</Text>}
      {!error && projects && sorted.length === 0 && <Text dimColor>（无项目）</Text>}

      {/* 项目列表 */}
      {sorted.slice(viewOffset, viewOffset + 12).map((p, i) => {
        const idx = viewOffset + i
        const isSelected = idx === selected
        return (
          <Box key={p.id}>
            <Text backgroundColor={isSelected ? 'cyan' : undefined} color={isSelected ? 'black' : undefined}>
              {isSelected ? '▶' : ' '} {padName(p.name)}
            </Text>
            <Text backgroundColor={isSelected ? 'cyan' : undefined} color={isSelected ? 'black' : undefined}>
              {' '}
            </Text>
            <StageBadge stage={p.followStage} />
            <Text dimColor>
              {' '}
              {p.industry ?? '-'} · {p.totalAmount || '-'} · {formatDate(p.targetDate)}
            </Text>
          </Box>
        )
      })}

      {sorted.length > 12 && (
        <Text dimColor>
          {viewOffset > 0 ? '↑更多 ' : ''}
          共 {sorted.length} 条 {viewOffset + 12 < sorted.length ? '↓更多' : ''}
        </Text>
      )}
    </Box>
  )
}

/** 项目名固定宽度（中英文混合，截断到 20 显示宽） */
function padName(name: string): string {
  let width = 0
  let result = ''
  for (const ch of name) {
    const w = (ch.codePointAt(0) ?? 0) >= 0x4e00 ? 2 : 1
    if (width + w > 18) break
    result += ch
    width += w
  }
  // 补齐到 20
  while (width < 20) {
    result += ' '
    width += 1
  }
  return result
}
