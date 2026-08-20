'use client'

/**
 * 可视化报告：右侧问答面板
 *
 * - 展示全项目提问（按模块分组），含框选原文引用
 * - 待回答/已回答状态区分
 * - 项目维护人/辅助维护人/ADMIN 可回答（回复）
 */

import { useState } from 'react'
import { MODULE_TYPE_LABELS, type ResearchModuleType } from '@/lib/research-permissions'

export interface PanelQuestion {
  id: string
  content: string
  quoteText: string | null
  quoteField: string | null
  moduleType: string
  createdAt: string
  user: { id: string; name: string | null; email: string }
  replies: Array<{
    id: string
    content: string
    createdAt: string
    user: { id: string; name: string | null; email: string }
  }>
}

interface QuestionPanelProps {
  questions: PanelQuestion[]
  /** 当前用户是否可回答（维护人/辅助维护人/ADMIN） */
  canAnswer: boolean
  /** 提交回答 */
  onReply: (questionId: string, content: string) => Promise<void>
  /** 点击问题 → 联动定位到对应模块 */
  onLocate?: (moduleType: string) => void
  /** 高亮的问题 id（从字段标志点击过来时） */
  highlightId?: string | null
}

export default function QuestionPanel({
  questions,
  canAnswer,
  onReply,
  onLocate,
  highlightId,
}: QuestionPanelProps) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [filter, setFilter] = useState<'all' | 'open' | 'answered'>('all')

  const answered = (q: PanelQuestion) => q.replies.length > 0
  const filtered = questions.filter(q =>
    filter === 'all' ? true : filter === 'open' ? !answered(q) : answered(q)
  )
  const openCount = questions.filter(q => !answered(q)).length

  // 按模块分组（保持模块顺序）
  const groupOrder: string[] = []
  const groupMap = new Map<string, PanelQuestion[]>()
  for (const q of filtered) {
    if (!groupMap.has(q.moduleType)) {
      groupMap.set(q.moduleType, [])
      groupOrder.push(q.moduleType)
    }
    groupMap.get(q.moduleType)!.push(q)
  }

  const handleSubmitReply = async (questionId: string) => {
    const content = replyContent.trim()
    if (!content) return
    setSubmitting(true)
    try {
      await onReply(questionId, content)
      setReplyContent('')
      setReplyingTo(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-primary-100 bg-gradient-to-r from-primary-50/60 to-transparent flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-bold text-gray-900">提问与回答</span>
            {openCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600 text-xs font-bold">
                {openCount} 待回答
              </span>
            )}
          </div>
        </div>
        {/* 筛选 */}
        <div className="flex gap-1 mt-2">
          {([
            ['all', `全部 ${questions.length}`],
            ['open', `待回答 ${openCount}`],
            ['answered', `已回答 ${questions.length - openCount}`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                filter === key
                  ? 'bg-primary-500 text-white'
                  : 'bg-white text-gray-500 border border-gray-200 hover:border-primary-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 问题列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {filtered.length === 0 && (
          <div className="py-10 text-center">
            <svg className="w-10 h-10 mx-auto text-gray-200 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <p className="text-xs text-gray-400">
              {filter === 'open' ? '没有待回答的问题' : '暂无提问'}
            </p>
            <p className="text-xs text-gray-300 mt-1">投资合伙人可在左侧框选内容发起提问</p>
          </div>
        )}

        {groupOrder.map(moduleType => (
          <div key={moduleType}>
            <button
              onClick={() => onLocate?.(moduleType)}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-primary-600 transition-colors mb-2"
            >
              <span className="w-3 h-px bg-gray-300" />
              {MODULE_TYPE_LABELS[moduleType as ResearchModuleType] || moduleType}
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>

            <div className="space-y-3">
              {groupMap.get(moduleType)!.map(q => (
                <div
                  key={q.id}
                  className={`rounded-xl border p-3 transition-all ${
                    highlightId === q.id
                      ? 'border-primary-400 ring-2 ring-primary-100 bg-primary-50/40'
                      : answered(q)
                        ? 'border-emerald-100 bg-emerald-50/30'
                        : 'border-amber-100 bg-amber-50/30'
                  }`}
                >
                  {/* 提问人 + 状态 */}
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-[10px] text-white font-bold flex-shrink-0">
                        {(q.user.name || q.user.email || '?').charAt(0)}
                      </div>
                      <span className="text-xs font-medium text-gray-700 truncate">{q.user.name || q.user.email}</span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">
                        {new Date(q.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                      answered(q) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {answered(q) ? '已回答' : '待回答'}
                    </span>
                  </div>

                  {/* 框选原文引用 */}
                  {q.quoteText && (
                    <div className="mb-1.5 pl-2 border-l-2 border-primary-300 bg-white/60 rounded-r px-2 py-1">
                      <p className="text-xs text-gray-500 italic leading-relaxed line-clamp-2">“{q.quoteText}”</p>
                    </div>
                  )}

                  {/* 问题内容 */}
                  <p className="text-sm text-gray-800 font-medium leading-relaxed whitespace-pre-wrap">{q.content}</p>

                  {/* 回答列表 */}
                  {q.replies.map(r => (
                    <div key={r.id} className="mt-2 pl-3 border-l-2 border-emerald-200 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                          {r.user.name || r.user.email} · 回答
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{r.content}</p>
                    </div>
                  ))}

                  {/* 回答输入 */}
                  {canAnswer && (
                    replyingTo === q.id ? (
                      <div className="mt-2 space-y-2">
                        <textarea
                          value={replyContent}
                          onChange={e => setReplyContent(e.target.value)}
                          placeholder="输入回答..."
                          rows={2}
                          autoFocus
                          className="w-full px-2.5 py-2 text-sm border border-primary-200 rounded-lg focus:ring-2 focus:ring-primary-300 focus:border-primary-400 resize-none bg-white"
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => { setReplyingTo(null); setReplyContent('') }}
                            className="px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded-lg"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => handleSubmitReply(q.id)}
                            disabled={submitting || !replyContent.trim()}
                            className="px-3 py-1 text-xs font-medium bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
                          >
                            {submitting ? '提交中...' : '提交回答'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setReplyingTo(q.id)}
                        className="mt-2 text-xs text-primary-600 hover:text-primary-800 font-medium inline-flex items-center gap-1"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                        回答
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
