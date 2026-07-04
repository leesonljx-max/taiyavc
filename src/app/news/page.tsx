'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/DashboardLayout'

interface NewsArticle {
  id: string
  title: string
  source: string
  sourceUrl: string | null
  industry: string
  summary: string
  author: string | null
  publishedAt: string
  weekStart: string
}

interface NewsDetail extends NewsArticle {
  content: string
}

export default function NewsPage() {
  const { status } = useSession()
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [industries, setIndustries] = useState<string[]>([])
  const [sources, setSources] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [searchMessage, setSearchMessage] = useState('')
  const [selectedIndustry, setSelectedIndustry] = useState<string>('all')
  const [selectedSource, setSelectedSource] = useState<string>('all')
  const [viewingArticle, setViewingArticle] = useState<NewsDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    if (status !== 'authenticated') return
    fetchNews()
  }, [status, selectedIndustry, selectedSource])

  const fetchNews = async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ week: 'current' })
      if (selectedIndustry !== 'all') params.set('industry', selectedIndustry)
      if (selectedSource !== 'all') params.set('source', selectedSource)
      const res = await fetch(`/api/news?${params}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '获取新闻失败')
        return
      }
      setArticles(data.articles || [])
      setIndustries(data.industries || [])
      setSources(data.sources || [])
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async () => {
    setSearching(true)
    setError('')
    setSearchMessage('')
    try {
      const currentYear = new Date().getFullYear()
      const res = await fetch('/api/news/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: currentYear }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '检索失败')
        return
      }
      setSearchMessage(data.message || '检索完成')
      await fetchNews()
    } catch {
      setError('网络错误')
    } finally {
      setSearching(false)
    }
  }

  const handleViewDetail = async (id: string) => {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/news/${id}`)
      const data = await res.json()
      if (res.ok && data.article) {
        setViewingArticle(data.article)
      }
    } catch {
      // 忽略
    } finally {
      setDetailLoading(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-primary flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (status !== 'authenticated') return null

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 + 检索按钮 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">新闻监控</h1>
            <p className="text-sm text-gray-500 mt-1">
              AI 检索各行业赛道融资新闻 · 重点关注 36氪/投资界/量子位等来源
            </p>
          </div>
          <button
            onClick={handleSearch}
            disabled={searching}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-500 text-white text-sm font-medium rounded-xl shadow-lg shadow-primary-500/30 hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {searching ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                AI 检索中...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                检索本周融资新闻
              </>
            )}
          </button>
        </div>

        {/* 提示消息 */}
        {searchMessage && (
          <div className="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
            {searchMessage}
          </div>
        )}

        {error && (
          <div className="px-4 py-3 bg-danger-50 border border-danger-200 rounded-xl text-sm text-danger-700">
            {error}
          </div>
        )}

        {/* 筛选器 */}
        {articles.length > 0 && (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">行业</span>
              <select
                value={selectedIndustry}
                onChange={(e) => setSelectedIndustry(e.target.value)}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-400"
              >
                <option value="all">全部行业</option>
                {industries.map(ind => (
                  <option key={ind} value={ind}>{ind}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">来源</span>
              <select
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-400"
              >
                <option value="all">全部来源</option>
                {sources.map(src => (
                  <option key={src} value={src}>{src}</option>
                ))}
              </select>
            </div>
            <span className="text-xs text-gray-400">共 {articles.length} 篇</span>
          </div>
        )}

        {/* 新闻卡片网格 */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <span className="ml-3 text-sm text-gray-500">加载中...</span>
          </div>
        ) : searching ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
            <span className="mt-3 text-sm text-gray-500">正在通过 AI 检索外网融资新闻...</span>
            <span className="mt-1 text-xs text-gray-400">这可能需要 15-30 秒</span>
          </div>
        ) : articles.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
              </svg>
            </div>
            <p className="text-sm text-gray-500 mb-1">本周暂无融资新闻</p>
            <p className="text-xs text-gray-400">点击上方"检索本周融资新闻"按钮，AI 将自动检索各行业融资新闻</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {articles.map(article => (
              <button
                key={article.id}
                onClick={() => handleViewDetail(article.id)}
                disabled={detailLoading}
                className="text-left bg-gradient-card rounded-2xl shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all-smooth border border-primary-100 overflow-hidden group"
              >
                <div className="p-5">
                  {/* 标题 + 来源 */}
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <h3 className="text-base font-semibold text-gray-900 group-hover:text-primary-700 transition-colors line-clamp-2">
                      {article.title}
                    </h3>
                  </div>
                  {/* 来源标签 + 行业 + 日期 */}
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="inline-flex items-center px-2 py-0.5 bg-primary-50 text-primary-700 text-xs rounded-md font-medium">
                      {article.source}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-md">
                      {article.industry}
                    </span>
                    <span className="text-xs text-gray-400 ml-auto">
                      {new Date(article.publishedAt).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                  {/* 摘要 */}
                  <p className="text-sm text-gray-600 line-clamp-3">
                    {article.summary}
                  </p>
                  {/* 作者 */}
                  {article.author && (
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-1 text-xs text-gray-400">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      {article.author}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ═══ 新闻详情弹窗 ═══ */}
      {viewingArticle && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setViewingArticle(null)}>
          <div
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="px-6 py-4 border-b border-gray-100">
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-xl font-bold text-gray-900 flex-1">
                  {viewingArticle.title}
                </h2>
                <button
                  onClick={() => setViewingArticle(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <span className="inline-flex items-center px-2.5 py-1 bg-primary-50 text-primary-700 text-xs rounded-md font-medium">
                  {viewingArticle.source}
                </span>
                <span className="inline-flex items-center px-2.5 py-1 bg-blue-50 text-blue-700 text-xs rounded-md">
                  {viewingArticle.industry}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(viewingArticle.publishedAt).toLocaleDateString('zh-CN')}
                </span>
                {viewingArticle.author && (
                  <span className="text-xs text-gray-400">作者：{viewingArticle.author}</span>
                )}
              </div>
            </div>

            {/* 内容 */}
            <div className="px-6 py-5">
              <div className="prose prose-sm max-w-none">
                <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {viewingArticle.content}
                </p>
              </div>
            </div>

            {/* 底部 */}
            {viewingArticle.sourceUrl && (
              <div className="px-6 py-4 border-t border-gray-100">
                <a
                  href={viewingArticle.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
                >
                  查看原文
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
