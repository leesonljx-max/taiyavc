'use client'

/**
 * AI行研 ChatBot 页面（Harness 架构 + 分层记忆）
 *
 * - 左侧：会话列表（新建/切换/删除，自动生成标题）
 * - 右侧：聊天区（数据【】高亮、⚠️风险提示醒目、来源可点击、内部项目关联标签）
 * - 回答渲染：markdown 轻量解析（标题/列表/表格/加粗）+ 【数据】块高亮
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import DashboardLayout from '@/components/DashboardLayout'

interface ChatSession {
  id: string
  title: string
  messageCount?: number
  updatedAt: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources: Array<{ label: string; url: string }>
  projects: Array<{ projectId: string; projectName: string; followStage: string }>
  createdAt: string
}

const STAGE_LABELS: Record<string, string> = {
  INITIAL_TALK: '初聊', PRE_DD: 'PreDD', PROJECT_INITIATION: '立项',
  DUE_DILIGENCE: '尽调', AGREEMENT: '协议', CLOSING: '交割', POST_INVESTMENT: '投后',
}

export default function AIResearchPage() {
  const { status } = useSession()
  const router = useRouter()

  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login?callbackUrl=/ai-research')
    }
  }, [status, router])

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // 加载会话列表
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-research/sessions')
      const data = await res.json()
      if (res.ok) {
        setSessions(data.sessions || [])
        return data.sessions || []
      }
    } catch { /* ignore */ }
    return []
  }, [])

  useEffect(() => {
    if (status === 'authenticated') {
      setLoadingSessions(true)
      fetchSessions().finally(() => setLoadingSessions(false))
    }
  }, [status, fetchSessions])

  // 加载会话消息
  const fetchMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/ai-research/messages?sessionId=${sessionId}`)
      const data = await res.json()
      if (res.ok) {
        setMessages(data.messages || [])
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (activeSessionId) {
      fetchMessages(activeSessionId)
    } else {
      setMessages([])
    }
  }, [activeSessionId, fetchMessages])

  // 新建会话
  const handleNewSession = async () => {
    try {
      const res = await fetch('/api/ai-research/sessions', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        await fetchSessions()
        setActiveSessionId(data.session.id)
        setMessages([])
      }
    } catch { /* ignore */ }
  }

  // 删除会话
  const handleDeleteSession = async (id: string) => {
    if (!confirm('删除该会话及其全部消息？')) return
    try {
      const res = await fetch(`/api/ai-research/sessions?id=${id}`, { method: 'DELETE' })
      if (res.ok) {
        if (activeSessionId === id) {
          setActiveSessionId(null)
          setMessages([])
        }
        fetchSessions()
      }
    } catch { /* ignore */ }
  }

  // 发送提问
  const handleSend = async () => {
    const content = input.trim()
    if (!content || sending) return

    let sessionId = activeSessionId
    if (!sessionId) {
      // 无会话时自动创建
      try {
        const res = await fetch('/api/ai-research/sessions', { method: 'POST' })
        const data = await res.json()
        if (!res.ok) {
          setMessages(prev => [...prev, {
            id: `err-${Date.now()}`, role: 'assistant',
            content: `⚠️ 创建会话失败：${data.error || '请刷新页面重试'}`,
            sources: [], projects: [], createdAt: new Date().toISOString(),
          }])
          setSending(false)
          return
        }
        sessionId = data.session.id
        setActiveSessionId(sessionId)
        await fetchSessions()
      } catch {
        setMessages(prev => [...prev, {
          id: `err-${Date.now()}`, role: 'assistant',
          content: '⚠️ 网络错误，无法创建会话',
          sources: [], projects: [], createdAt: new Date().toISOString(),
        }])
        setSending(false)
        return
      }
    }

    // 乐观更新：先显示用户消息 + 加载占位
    const userMsg: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content,
      sources: [],
      projects: [],
      createdAt: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setSending(true)

    try {
      const res = await fetch('/api/ai-research/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, content }),
      })
      const data = await res.json()
      if (res.ok) {
        setMessages(prev => [...prev, data.message])
        // 刷新会话列表（标题可能已自动生成）
        fetchSessions()
      } else {
        setMessages(prev => [...prev, {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ 回答失败：${data.error || '未知错误'}`,
          sources: [], projects: [],
          createdAt: new Date().toISOString(),
        }])
      }
    } catch {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: '⚠️ 网络错误，请重试',
        sources: [], projects: [],
        createdAt: new Date().toISOString(),
      }])
    } finally {
      setSending(false)
    }
  }

  return (
    <DashboardLayout title="AI行研" subtitle="一级市场投资研究助手 · 项目库优先 · 分层记忆">
      <div className="flex gap-4" style={{ height: 'calc(100vh - 160px)' }}>
        {/* ── 左：会话列表 ── */}
        {sidebarOpen && (
          <div className="w-60 flex-shrink-0 bg-white rounded-2xl shadow-sm border border-primary-100 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-primary-100">
              <button
                onClick={handleNewSession}
                className="w-full px-3 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 transition-all text-sm font-medium flex items-center justify-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                新对话
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {loadingSessions ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500"></div>
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">暂无会话<br />点击"新对话"开始</p>
              ) : sessions.map(s => (
                <div
                  key={s.id}
                  className={`group flex items-center gap-1 rounded-lg transition-colors cursor-pointer ${
                    activeSessionId === s.id ? 'bg-primary-50 border border-primary-200' : 'hover:bg-gray-50 border border-transparent'
                  }`}
                  onClick={() => setActiveSessionId(s.id)}
                >
                  <div className="flex-1 min-w-0 px-2.5 py-2">
                    <p className="text-xs font-medium text-gray-800 truncate">{s.title}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {new Date(s.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                      {s.messageCount !== undefined && ` · ${s.messageCount}条`}
                    </p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteSession(s.id) }}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 pr-2 transition-opacity"
                    title="删除会话"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 右：聊天区 ── */}
        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-primary-100 flex flex-col overflow-hidden min-w-0">
          {/* 顶栏 */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-primary-100">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-gray-400 hover:text-primary-600 transition-colors"
              title="切换会话列表"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="text-xs text-gray-400">
              优先检索内部项目库 · 记忆自动沉淀 · 数据【高亮】
            </div>
          </div>

          {/* 消息流 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !sending ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center max-w-md">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/30">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">AI行研</h3>
                  <p className="text-sm text-gray-500 mb-4">
                    站在一级市场投资人视角的投研助手：优先检索内部项目库（含投后项目），
                    联网补充行业信息，自动评估融资时间窗口与竞争格局。
                  </p>
                  <div className="grid grid-cols-1 gap-2 text-left">
                    {[
                      '脑机接口行业现在还有投资窗口吗？',
                      '我们投后项目里有哪些和具身智能相关？',
                      '对比一下光枢科技和行业头部玩家的差异化',
                    ].map(q => (
                      <button
                        key={q}
                        onClick={() => { setInput(q) }}
                        className="px-3 py-2 bg-gray-50 hover:bg-primary-50 border border-gray-100 hover:border-primary-200 rounded-xl text-xs text-gray-600 hover:text-primary-700 transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map(m => <MessageBubble key={m.id} message={m} />)
            )}
            {sending && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">研</span>
                </div>
                <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-400">
                  <span className="inline-flex items-center gap-2">
                    <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary-500"></span>
                    检索项目库与联网信息中...
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区 */}
          <div className="p-3 border-t border-primary-100">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="输入投资研究问题（Enter 发送，Shift+Enter 换行）"
                rows={Math.min(4, Math.max(1, input.split('\n').length))}
                className="flex-1 px-3 py-2 border border-primary-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-primary-400 focus:border-primary-400 resize-none"
                disabled={sending}
              />
              <button
                onClick={handleSend}
                disabled={sending || !input.trim()}
                className="px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-medium flex-shrink-0"
              >
                {sending ? '分析中' : '发送'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

// ── 消息气泡 ──

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl rounded-tr-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center flex-shrink-0 shadow-sm">
        <span className="text-white text-xs font-bold">研</span>
      </div>
      <div className="max-w-[85%] min-w-0">
        <div className="bg-gray-50 border border-gray-100 rounded-xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 leading-relaxed">
          <RichContent content={message.content} />
        </div>
        {/* 内部项目关联 */}
        {message.projects && message.projects.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {message.projects.map(p => (
              <Link
                key={p.projectId}
                href={`/projects/${p.projectId}`}
                className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 border border-blue-100 rounded-lg text-[11px] text-blue-700 hover:bg-blue-100 transition-colors"
                title="查看内部项目详情"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                {p.projectName}
                <span className="text-blue-500">（{STAGE_LABELS[p.followStage] || p.followStage}）</span>
              </Link>
            ))}
          </div>
        )}
        {/* 联网来源 */}
        {message.sources && message.sources.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 px-1">
            <span className="text-[10px] text-gray-400">来源：</span>
            {message.sources.map((s, i) => (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-primary-600 hover:underline truncate max-w-[200px]"
              >
                [{i + 1}] {s.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 富文本渲染：markdown 轻量 + 【数据】高亮 + ⚠️ 风险块 ──

function RichContent({ content }: { content: string }) {
  const lines = content.split('\n')

  // 预处理：合并连续的表格行为块
  const blocks: Array<{ type: 'line'; text: string } | { type: 'table'; rows: string[][] }> = []
  let tableBuffer: string[][] = []

  const flushTable = () => {
    if (tableBuffer.length > 0) {
      blocks.push({ type: 'table', rows: tableBuffer })
      tableBuffer = []
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    // markdown 表格行：| a | b |
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.slice(1, -1).split('|').map(c => c.trim())
      // 分隔行（|---|---|）跳过
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue
      tableBuffer.push(cells)
    } else {
      flushTable()
      blocks.push({ type: 'line', text: line })
    }
  }
  flushTable()

  return (
    <div className="space-y-1.5">
      {blocks.map((block, i) => {
        if (block.type === 'table') {
          return <TableBlock key={i} rows={block.rows} />
        }
        return <LineBlock key={i} line={block.text} />
      })}
    </div>
  )
}

/** markdown 表格渲染 */
function TableBlock({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return null
  const [header, ...body] = rows
  return (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i} className="border border-gray-200 bg-gray-50 px-2 py-1.5 text-left font-semibold text-gray-700 whitespace-nowrap">
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 1 ? 'bg-gray-50/50' : ''}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-gray-200 px-2 py-1.5 text-gray-700">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 单行渲染（标题/列表/风险块/普通行） */
function LineBlock({ line }: { line: string }) {
  const trimmed = line.trim()
  // ⚠️ 风险提示（含列表项内的 ⚠️，如 "- ⚠️ 时间窗口风险：..."）→ 醒目块（优先于列表匹配）
  if (trimmed.includes('⚠️')) {
    const riskText = trimmed.replace(/^[-•*]\s*/, '') // 去掉可能的列表前缀
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700 font-medium text-xs my-2">
        {renderInline(riskText)}
      </div>
    )
  }
  // markdown 标题
  const heading = line.match(/^(#{1,4})\s+(.*)$/)
  if (heading) {
    const level = heading[1].length
    const sizeClass = level <= 2 ? 'text-base font-bold mt-3' : 'text-sm font-bold mt-2'
    return <p className={`${sizeClass} text-gray-900`}>{renderInline(heading[2])}</p>
  }
  // 空行
  if (!trimmed) return <div className="h-1.5" />
  // 列表
  const listMatch = line.match(/^\s*[-•*]\s+(.*)$/)
  if (listMatch) {
    return (
      <div className="flex items-start gap-1.5">
        <span className="w-1.5 h-1.5 bg-primary-400 rounded-full mt-1.5 flex-shrink-0"></span>
        <span className="flex-1">{renderInline(listMatch[1])}</span>
      </div>
    )
  }
  const numMatch = line.match(/^\s*(\d+)[.、]\s+(.*)$/)
  if (numMatch) {
    return (
      <div className="flex items-start gap-1.5">
        <span className="text-primary-600 font-medium text-xs mt-0.5 flex-shrink-0">{numMatch[1]}.</span>
        <span className="flex-1">{renderInline(numMatch[2])}</span>
      </div>
    )
  }
  // 普通行
  return <p>{renderInline(line)}</p>
}

/** 行内渲染：【数据】高亮 + **加粗** + 链接 */
function renderInline(text: string) {
  // 【...】数据块 → 琥珀色高亮
  const parts: React.ReactNode[] = []
  const regex = /【([^】]+)】|\*\*([^*]+)\*\*/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.substring(last, match.index))
    if (match[1] !== undefined) {
      // 【数据】高亮
      parts.push(
        <span key={`d-${key++}`} className="px-1.5 py-0.5 bg-amber-100 border border-amber-300 rounded font-bold text-amber-800 text-xs">
          {match[1]}
        </span>
      )
    } else if (match[2] !== undefined) {
      // **加粗**
      parts.push(<strong key={`b-${key++}`} className="font-semibold text-gray-900">{match[2]}</strong>)
    }
    last = regex.lastIndex
  }
  if (last < text.length) parts.push(text.substring(last))
  return parts
}
