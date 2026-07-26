'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'

/**
 * AI 线索 Tab
 *
 * 功能：
 * - 展示 AI 自动检索的项目线索（按权限过滤）
 * - 触发 AI 检索任务（仅 ADMIN / INVESTMENT_PARTNER）
 * - 查看线索详情
 * - 将线索转化为项目
 * - 删除线索
 * - 显示释放状态（未释放=仅维护人可见；已释放=全员可见）
 */

interface AILead {
  id: string
  name: string
  industry: string | null
  companyPosition: string | null
  mainProducts: string | null
  financingHistory: string | null
  contactInfo: string | null
  description: string | null
  status: string // PENDING / CONVERTED / ARCHIVED
  createdAt: string
  createdById: string
  createdBy: { id: string; name: string | null } | null
  // AI 扩展字段
  source: string
  fundingRound: string | null
  fundingAmount: string | null
  valuation: string | null
  investors: string | null
  financialAdvisors: string | null
  coreAdvantage: string | null
  sourceUrl: string | null
  sourceTitle: string | null
  matchedProjectId: string | null
  matchedConfidence: number | null
  releasedAt: string | null
  aiSummary: string | null
}

interface ConvertForm {
  totalAmount: string
  investmentValuation: string
  targetDate: string
  industry: string
  companyPosition: string
  mainProducts: string
  description: string
  companyFullName: string
  financingRound: string
}

export default function AILeadsTab() {
  const { data: session } = useSession()
  const userRole = session?.user?.role as string | undefined
  const canTrigger = userRole === 'ADMIN' || userRole === 'INVESTMENT_PARTNER'

  const [leads, setLeads] = useState<AILead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [filter, setFilter] = useState<'all' | 'released' | 'locked' | 'converted'>('all')

  // 检索状态
  const [retrieving, setRetrieving] = useState(false)
  const [retrievalResult, setRetrievalResult] = useState<{
    totalFound: number
    totalSaved: number
    keywords: string[]
    errors: string[]
  } | null>(null)

  // 详情弹窗
  const [viewingLead, setViewingLead] = useState<AILead | null>(null)

  // 转化弹窗
  const [convertingLead, setConvertingLead] = useState<AILead | null>(null)
  const [convertForm, setConvertForm] = useState<ConvertForm>({
    totalAmount: '',
    investmentValuation: '',
    targetDate: '',
    industry: '',
    companyPosition: '',
    mainProducts: '',
    description: '',
    companyFullName: '',
    financingRound: '',
  })
  const [convertSaving, setConvertSaving] = useState(false)
  const [convertError, setConvertError] = useState('')

  // AbortController
  const fetchAbort = useRef<AbortController | null>(null)

  const fetchLeads = useCallback(async () => {
    if (fetchAbort.current) fetchAbort.current.abort()
    const controller = new AbortController()
    fetchAbort.current = controller

    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/ai-leads?scope=all', {
        signal: controller.signal,
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '获取失败')
      }
      const data = await response.json()
      setLeads(data.leads || [])
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : '获取 AI 线索失败')
    }
    if (fetchAbort.current === controller) setLoading(false)
  }, [])

  useEffect(() => {
    fetchLeads()
  }, [fetchLeads])

  const handleRetrieve = async () => {
    if (!confirm('确定要触发 AI 检索任务吗？该任务会调用 DeepSeek 和 Bing 搜索，可能需要 30 秒以上。')) return
    setRetrieving(true)
    setRetrievalResult(null)
    setError('')
    try {
      const response = await fetch('/api/ai-leads', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || '检索失败')
      }
      setRetrievalResult(data.result)
      fetchLeads()
    } catch (e) {
      setError(e instanceof Error ? e.message : '检索失败')
    }
    setRetrieving(false)
  }

  const handleDelete = async (lead: AILead) => {
    if (!confirm(`确定要删除 AI 线索「${lead.name}」吗？`)) return
    try {
      const response = await fetch(`/api/ai-leads/${lead.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json()
        alert(data.error || '删除失败')
        return
      }
      setViewingLead(null)
      fetchLeads()
    } catch {
      alert('删除失败')
    }
  }

  const openConvert = (lead: AILead) => {
    setConvertingLead(lead)
    setConvertForm({
      totalAmount: '',
      investmentValuation: '',
      targetDate: new Date().toISOString().slice(0, 10),
      industry: lead.industry || '',
      companyPosition: lead.companyPosition || '',
      mainProducts: lead.mainProducts || '',
      description: lead.aiSummary || lead.description || '',
      companyFullName: '',
      financingRound: lead.fundingRound || '',
    })
    setConvertError('')
    setViewingLead(null)
  }

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!convertingLead) return
    setConvertError('')
    if (!convertForm.totalAmount.trim()) {
      setConvertError('融资金额是必填项')
      return
    }
    if (!convertForm.investmentValuation.trim()) {
      setConvertError('投资估值是必填项')
      return
    }
    const v = Number(convertForm.investmentValuation)
    if (isNaN(v)) {
      setConvertError('投资估值必须是数字')
      return
    }
    if (!convertForm.industry.trim()) {
      setConvertError('所处行业是必填项')
      return
    }
    if (!convertForm.companyPosition.trim()) {
      setConvertError('公司定位是必填项')
      return
    }
    setConvertSaving(true)
    try {
      const response = await fetch(`/api/ai-leads/${convertingLead.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(convertForm),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || '转化失败')
      }
      alert(`已成功转化为项目「${data.project.name}」`)
      setConvertingLead(null)
      fetchLeads()
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : '转化失败')
    }
    setConvertSaving(false)
  }

  // 解析 JSON 数组字符串
  const parseArray = (s: string | null): string[] => {
    if (!s) return []
    try {
      const arr = JSON.parse(s)
      return Array.isArray(arr) ? arr.filter(x => typeof x === 'string' && x) : []
    } catch {
      return []
    }
  }

  // 过滤
  const filteredLeads = leads.filter(lead => {
    // 搜索过滤
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      const matched =
        lead.name.toLowerCase().includes(term) ||
        lead.industry?.toLowerCase().includes(term) ||
        lead.companyPosition?.toLowerCase().includes(term) ||
        lead.mainProducts?.toLowerCase().includes(term) ||
        lead.fundingRound?.toLowerCase().includes(term) ||
        lead.coreAdvantage?.toLowerCase().includes(term)
      if (!matched) return false
    }
    // 状态过滤
    if (filter === 'released') return !!lead.releasedAt && lead.status !== 'CONVERTED'
    if (filter === 'locked') return !lead.releasedAt && lead.status !== 'CONVERTED'
    if (filter === 'converted') return lead.status === 'CONVERTED'
    return true
  })

  // 统计
  const stats = {
    total: leads.length,
    released: leads.filter(l => !!l.releasedAt && l.status !== 'CONVERTED').length,
    locked: leads.filter(l => !l.releasedAt && l.status !== 'CONVERTED').length,
    converted: leads.filter(l => l.status === 'CONVERTED').length,
  }

  return (
    <>
      {/* 说明 + 搜索 + 检索按钮 */}
      <div className="bg-gradient-card rounded-2xl shadow-sm p-4 mb-6 border border-primary-100">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <svg className="w-5 h-5 text-primary-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span>AI 每日根据近 3 个月初聊项目标签自动检索融资 PR 新闻；两周未转化将释放给全员查看</span>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <div className="flex-1 md:max-w-xs relative">
              <svg className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="搜索 AI 线索..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth placeholder-gray-400"
              />
            </div>
            {canTrigger && (
              <button
                onClick={handleRetrieve}
                disabled={retrieving}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl hover:from-purple-600 hover:to-indigo-700 transition-all-smooth shadow-md shadow-purple-500/30 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <svg className={`w-4 h-4 ${retrieving ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {retrieving ? '检索中...' : 'AI 检索'}
              </button>
            )}
          </div>
        </div>

        {/* 检索结果摘要 */}
        {retrievalResult && (
          <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded-xl text-sm">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1 text-purple-900">
                <div>
                  检索完成：发现 <b>{retrievalResult.totalFound}</b> 条新闻，已保存 <b>{retrievalResult.totalSaved}</b> 条线索
                </div>
                {retrievalResult.keywords.length > 0 && (
                  <div className="mt-1 text-xs text-purple-700">
                    关键词：{retrievalResult.keywords.join('、')}
                  </div>
                )}
                {retrievalResult.errors.length > 0 && (
                  <div className="mt-1 text-xs text-red-600">
                    错误：{retrievalResult.errors.join('；')}
                  </div>
                )}
              </div>
              <button
                onClick={() => setRetrievalResult(null)}
                className="text-purple-400 hover:text-purple-600 flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { key: 'all', label: '全部', value: stats.total, color: 'from-primary-500 to-primary-700' },
          { key: 'locked', label: '保护中', value: stats.locked, color: 'from-amber-400 to-amber-500' },
          { key: 'released', label: '已释放', value: stats.released, color: 'from-emerald-400 to-emerald-500' },
          { key: 'converted', label: '已转化', value: stats.converted, color: 'from-indigo-400 to-indigo-500' },
        ].map(s => (
          <button
            key={s.key}
            onClick={() => setFilter(s.key as typeof filter)}
            className={`bg-gradient-card rounded-2xl p-4 shadow-sm border transition-all-smooth text-left ${
              filter === s.key ? 'border-primary-400 ring-2 ring-primary-200' : 'border-primary-100 hover:border-primary-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-white font-bold`}>
                {s.value}
              </div>
              <div className="text-sm text-gray-600">{s.label}</div>
            </div>
          </button>
        ))}
      </div>

      {/* AI 线索列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="bg-gradient-card rounded-2xl shadow-sm p-16 text-center border border-primary-100">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-purple-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">暂无 AI 线索</h3>
          <p className="text-gray-500">
            {canTrigger ? '点击右上角"AI 检索"按钮触发检索任务' : '请等待管理员触发 AI 检索任务'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredLeads.map(lead => (
            <button
              key={lead.id}
              onClick={() => setViewingLead(lead)}
              className="text-left bg-gradient-card rounded-2xl shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all-smooth border border-primary-100 overflow-hidden group"
            >
              <div className="p-5">
                {/* 标题 + 状态徽章 */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <h3 className="text-base font-semibold text-gray-900 group-hover:text-primary-700 transition-colors truncate flex-1">
                    {lead.name}
                  </h3>
                  {lead.status === 'CONVERTED' ? (
                    <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full">
                      已转化
                    </span>
                  ) : lead.releasedAt ? (
                    <span className="px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full">
                      已释放
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
                      保护中
                    </span>
                  )}
                </div>

                {/* 融资信息 */}
                {(lead.fundingRound || lead.fundingAmount) && (
                  <div className="mb-2 inline-flex items-center gap-2 px-2 py-1 bg-purple-50 rounded-lg text-xs">
                    {lead.fundingRound && (
                      <span className="font-medium text-purple-700">{lead.fundingRound}</span>
                    )}
                    {lead.fundingAmount && (
                      <span className="text-purple-600">{lead.fundingAmount}</span>
                    )}
                    {lead.valuation && (
                      <span className="text-purple-500">估值 {lead.valuation}</span>
                    )}
                  </div>
                )}

                {/* 详情 */}
                <div className="space-y-1.5 text-sm">
                  {lead.industry && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-400 text-xs flex-shrink-0">行业</span>
                      <span className="text-gray-900 truncate text-right">{lead.industry}</span>
                    </div>
                  )}
                  {lead.companyPosition && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-400 text-xs flex-shrink-0">定位</span>
                      <span className="text-gray-900 truncate text-right">{lead.companyPosition}</span>
                    </div>
                  )}
                  {lead.fundingRound && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-400 text-xs flex-shrink-0">轮次</span>
                      <span className="text-gray-900 truncate text-right">{lead.fundingRound}</span>
                    </div>
                  )}
                </div>

                {/* 匹配信息 */}
                {lead.matchedProjectId && (
                  <div className="mt-3 pt-3 border-t border-primary-50 flex items-center gap-2 text-xs">
                    <svg className="w-3.5 h-3.5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <span className="text-primary-600">
                      已匹配初聊项目（置信度 {Math.round((lead.matchedConfidence || 0) * 100)}%）
                    </span>
                  </div>
                )}

                {/* 维护人 */}
                <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    {lead.createdBy?.name || '未分配'}
                  </span>
                  <span>{new Date(lead.createdAt).toLocaleDateString('zh-CN')}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ════════════ 详情弹窗 ════════════ */}
      {viewingLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-primary-100">
              <div className="flex items-center gap-2 truncate">
                <h2 className="text-lg font-bold text-gray-900 truncate">{viewingLead.name}</h2>
                {viewingLead.status === 'CONVERTED' ? (
                  <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full">已转化</span>
                ) : viewingLead.releasedAt ? (
                  <span className="px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full">已释放</span>
                ) : (
                  <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">保护中</span>
                )}
              </div>
              <button
                onClick={() => setViewingLead(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 ml-2"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* 基础信息 */}
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span>维护人：{viewingLead.createdBy?.name || '未分配'}</span>
                <span>·</span>
                <span>检索于 {new Date(viewingLead.createdAt).toLocaleDateString('zh-CN')}</span>
              </div>

              {/* 匹配信息 */}
              {viewingLead.matchedProjectId && (
                <div className="p-3 bg-primary-50 border border-primary-200 rounded-xl text-sm flex items-center gap-2">
                  <svg className="w-4 h-4 text-primary-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <span className="text-primary-800">
                    匹配初聊项目（置信度 {Math.round((viewingLead.matchedConfidence || 0) * 100)}%）
                  </span>
                </div>
              )}

              {/* 字段列表 */}
              {[
                { label: '行业/赛道', value: viewingLead.industry },
                { label: '公司定位', value: viewingLead.companyPosition },
                { label: '主要产品', value: viewingLead.mainProducts },
                { label: '融资轮次', value: viewingLead.fundingRound },
                { label: '融资金额', value: viewingLead.fundingAmount },
                { label: '估值', value: viewingLead.valuation },
                {
                  label: '投资机构',
                  value: parseArray(viewingLead.investors).length > 0
                    ? parseArray(viewingLead.investors).join('、')
                    : null,
                },
                {
                  label: '财务顾问',
                  value: parseArray(viewingLead.financialAdvisors).length > 0
                    ? parseArray(viewingLead.financialAdvisors).join('、')
                    : null,
                },
                { label: '核心优势', value: viewingLead.coreAdvantage },
                { label: 'AI 摘要', value: viewingLead.aiSummary || viewingLead.description },
              ].map(item => (
                <div key={item.label} className="border-b border-primary-50 pb-3">
                  <div className="text-xs text-gray-400 mb-1">{item.label}</div>
                  <div className="text-sm text-gray-900 whitespace-pre-wrap">
                    {item.value || <span className="text-gray-300">未填写</span>}
                  </div>
                </div>
              ))}

              {/* 原文链接 */}
              {viewingLead.sourceUrl && (
                <div className="border-b border-primary-50 pb-3">
                  <div className="text-xs text-gray-400 mb-1">原文链接</div>
                  <a
                    href={viewingLead.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary-600 hover:text-primary-800 hover:underline inline-flex items-center gap-1 break-all"
                  >
                    {viewingLead.sourceTitle || viewingLead.sourceUrl}
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-primary-100">
              <button
                onClick={() => handleDelete(viewingLead)}
                className="px-4 py-2 text-danger-600 hover:bg-danger-50 rounded-xl transition-all-smooth text-sm font-medium"
              >
                删除线索
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setViewingLead(null)}
                  className="px-5 py-2.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-all-smooth text-sm font-medium"
                >
                  关闭
                </button>
                {viewingLead.status !== 'CONVERTED' && (
                  <button
                    onClick={() => openConvert(viewingLead)}
                    className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl hover:from-emerald-600 hover:to-emerald-700 transition-all-smooth shadow-md shadow-emerald-500/30 text-sm font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    转化为项目
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════ 转化为项目弹窗 ════════════ */}
      {convertingLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-primary-100">
              <h2 className="text-lg font-bold text-gray-900 truncate">
                转化为项目：{convertingLead.name}
              </h2>
              <button
                onClick={() => setConvertingLead(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 ml-2"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleConvert} className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
                线索信息将自动填充到项目卡片，您可以在下方修改或补充必要信息。
              </div>

              {/* 必填字段 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    融资金额 <span className="text-danger-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={convertForm.totalAmount}
                    onChange={(e) => setConvertForm({ ...convertForm, totalAmount: e.target.value })}
                    placeholder="如 500万、2亿"
                    className="w-full px-3 py-2 bg-white border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    投资估值（亿元） <span className="text-danger-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={convertForm.investmentValuation}
                    onChange={(e) => setConvertForm({ ...convertForm, investmentValuation: e.target.value })}
                    placeholder="如 5.5"
                    className="w-full px-3 py-2 bg-white border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    所处行业 <span className="text-danger-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={convertForm.industry}
                    onChange={(e) => setConvertForm({ ...convertForm, industry: e.target.value })}
                    placeholder="如 AI应用、商业航天"
                    className="w-full px-3 py-2 bg-white border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    公司定位 <span className="text-danger-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={convertForm.companyPosition}
                    onChange={(e) => setConvertForm({ ...convertForm, companyPosition: e.target.value })}
                    placeholder="一句话描述"
                    className="w-full px-3 py-2 bg-white border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">初聊日期</label>
                  <input
                    type="date"
                    value={convertForm.targetDate}
                    onChange={(e) => setConvertForm({ ...convertForm, targetDate: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">融资轮次</label>
                  <input
                    type="text"
                    value={convertForm.financingRound}
                    onChange={(e) => setConvertForm({ ...convertForm, financingRound: e.target.value })}
                    placeholder="如 A轮、B轮"
                    className="w-full px-3 py-2 bg-white border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">公司全称</label>
                <input
                  type="text"
                  value={convertForm.companyFullName}
                  onChange={(e) => setConvertForm({ ...convertForm, companyFullName: e.target.value })}
                  placeholder="选填"
                  className="w-full px-3 py-2 bg-white border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">主要产品</label>
                <textarea
                  value={convertForm.mainProducts}
                  onChange={(e) => setConvertForm({ ...convertForm, mainProducts: e.target.value })}
                  rows={2}
                  placeholder="选填"
                  className="w-full px-3 py-2 bg-white border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">项目描述</label>
                <textarea
                  value={convertForm.description}
                  onChange={(e) => setConvertForm({ ...convertForm, description: e.target.value })}
                  rows={3}
                  placeholder="选填"
                  className="w-full px-3 py-2 bg-white border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth"
                />
              </div>

              {convertError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  {convertError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setConvertingLead(null)}
                  className="px-5 py-2.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-all-smooth text-sm font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={convertSaving}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl hover:from-emerald-600 hover:to-emerald-700 transition-all-smooth shadow-md shadow-emerald-500/30 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {convertSaving ? '转化中...' : '确认转化'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
