/**
 * 尽调 Harness 类型定义
 *
 * 架构：Agent = Model + Harness
 * - Model：DeepSeek V4-Flash（工具调用 + JSON 输出）
 * - Harness：本库实现的工具注册表 / Agent 循环 / 会话日志 / 并行调度
 */

// ── 工具定义（一切皆插件：工具可替换实现，接口不变） ──

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export interface HarnessTool {
  definition: ToolDefinition
  execute: (args: Record<string, unknown>, sessionLog: SessionLog) => Promise<string>
}

// ── Agent 消息（DeepSeek ChatCompletions 格式） ──

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

// ── 会话日志（append-only，溯源用） ──

export interface SessionLogEntry {
  type: 'tool_call' | 'tool_result' | 'assistant'
  name?: string
  args?: Record<string, unknown>
  /** web_search 工具实际返回的 URL 列表（引用交叉验证用） */
  urls?: string[]
  content?: string
  at: string
}

export class SessionLog {
  entries: SessionLogEntry[] = []

  append(entry: Omit<SessionLogEntry, 'at'>) {
    this.entries.push({ ...entry, at: new Date().toISOString() })
  }

  /** 所有 web_search 实际返回过的 URL（用于过滤模型编造的引用） */
  searchedUrls(): string[] {
    const urls: string[] = []
    for (const e of this.entries) {
      if (e.type === 'tool_result' && e.name === 'web_search' && e.urls) {
        urls.push(...e.urls)
      }
    }
    return urls
  }
}

// ── Agent 运行结果 ──

export interface AgentResult {
  content: string
  sessionLog: SessionLog
}

// ── 尽调框架 ──

export interface FrameworkModule {
  key: string
  name: string
  required: boolean
  /** 关注点（AI 生成或默认） */
  focus: string
  /** 关联的 Project 字段名（custom 模块为 null） */
  projectField: string | null
  /** 关联的投研分析模块类型（读其内容与文档） */
  researchModuleTypes: string[]
}

export interface DDFramework {
  modules: FrameworkModule[]
  generatedAt: string
}

// ── 模块分析输出（子Agent最终JSON） ──

export interface ModuleAnalysisOutput {
  status: 'COMPLETED' | 'INSUFFICIENT_DATA'
  conclusion: string
  citations: Array<{ label: string; url: string }>
  missing?: string
}

// ── 框架生成输出 ──

export interface FrameworkGenOutput {
  customModules: Array<{ key: string; name: string; focus: string }>
  focusNotes: Record<string, string>
}

// ── 缺口 ──

export interface DDGap {
  moduleKey: string
  moduleName: string
  missing: string
}
