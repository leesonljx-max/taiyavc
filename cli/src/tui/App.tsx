/**
 * TUI 主框架 —— 屏幕切换与全局快捷键
 *
 * 全局键：[1]工作台 [2]项目库 [q]退出
 * 搜索输入状态下全局键失效（避免与输入字符冲突）
 */

import React, { useState, useCallback } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { readConfig } from '../config.js'
import DashboardScreen from './DashboardScreen.js'
import ProjectsScreen from './ProjectsScreen.js'
import ProjectDetailScreen from './ProjectDetailScreen.js'
import type { ProjectListItem } from '../types.js'

export type Screen =
  | { name: 'dashboard' }
  | { name: 'projects' }
  | { name: 'detail'; projectId: string; projectName: string }

/** 输入状态上下文（搜索中时禁用全局快捷键） */
export const InputMode = React.createContext<{ searching: boolean; setSearchMode: (v: boolean) => void }>({
  searching: false,
  setSearchMode: () => undefined,
})

export default function App() {
  const { exit } = useApp()
  const cfg = readConfig()
  const [screen, setScreen] = useState<Screen>({ name: 'dashboard' })
  const [searching, setSearchMode] = useState(false)

  const goDashboard = useCallback(() => setScreen({ name: 'dashboard' }), [])
  const goProjects = useCallback(() => setScreen({ name: 'projects' }), [])
  const goDetail = useCallback(
    (project: ProjectListItem) => setScreen({ name: 'detail', projectId: project.id, projectName: project.name }),
    []
  )

  useInput((input, key) => {
    // 搜索输入中：全局快捷键失效（由 ProjectsScreen 自行处理）
    if (searching) return
    if (input === '1') goDashboard()
    else if (input === '2') goProjects()
    else if (input === 'q' && !key.ctrl) exit()
  })

  if (!cfg?.sessionToken) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">未登录或会话已过期</Text>
        <Text>
          请先运行：<Text bold>investrask login</Text>
        </Text>
      </Box>
    )
  }

  return (
    <InputMode.Provider value={{ searching, setSearchMode }}>
      <Box flexDirection="column">
        {/* 顶栏 */}
        <Box justifyContent="space-between" paddingX={1} borderStyle="round" borderColor="cyan">
          <Text bold color="cyan">
            ◆ 泰亚投资
          </Text>
          <Text dimColor>
            {cfg.user?.name ?? cfg.user?.email ?? ''} · {screenTitle(screen)}
          </Text>
        </Box>

        {/* 内容区 */}
        {screen.name === 'dashboard' && <DashboardScreen onOpenProjects={goProjects} onOpenDetail={goDetail} />}
        {screen.name === 'projects' && <ProjectsScreen onOpenDetail={goDetail} />}
        {screen.name === 'detail' && (
          <ProjectDetailScreen projectId={screen.projectId} projectName={screen.projectName} onBack={goProjects} />
        )}

        {/* 底栏快捷键提示 */}
        <Box paddingX={1}>
          <Text dimColor>
            {searching
              ? '[esc]取消搜索 [回车]确认'
              : `[1]工作台 [2]项目库 [q]退出${screen.name === 'projects' ? '  [/]搜索 [j/k↑↓]选择 [回车]详情' : ''}${screen.name === 'detail' ? '  [esc/b]返回列表' : ''}`}
          </Text>
        </Box>
      </Box>
    </InputMode.Provider>
  )
}

function screenTitle(screen: Screen): string {
  switch (screen.name) {
    case 'dashboard':
      return '工作台'
    case 'projects':
      return '项目库'
    case 'detail':
      return screen.projectName
  }
}
