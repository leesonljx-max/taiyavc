'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/DashboardLayout'

interface PostInvestProject {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  totalAmount: string
  investment: { fund: string | null; amount: number | null; date: string | null } | null
  docCount: number
  latestPeriod: string | null
  latestSummary: string | null
  riskLevel: 'high' | 'medium' | 'low' | null
  submittedThisQuarter: boolean
  updatedAt: string
}

interface ListData {
  projects: PostInvestProject[]
  stats: { total: number; quarter: string; submitted: number; pending: number; riskCount: number }
  funds: string[]
}

/** 投资日期 YYYY-MM → 「2024年12月」 */
function fmtInvestDate(ym: string | null): string {
  if (!ym) return '—'
  const m = ym.match(/^(\d{4})-(\d{2})$/)
  return m ? `${m[1]}年${m[2]}月` : ym
}

export default function PostInvestmentPage() {
  const router = useRouter()
  const { data: session, status } = useSession()

  const [data, setData] = useState<ListData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 基金筛选
  const [fundFilter, setFundFilter] = useState('')

  useEffect(() => {
    if (status === 'loading' || !session) return
    let cancelled = false
    const fetchList = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch('/api/post-investment')
        const json = await res.json()
        if (!cancelled) {
          if (!res.ok) setError(json.error || '加载失败')
          else setData(json)
        }
      } catch {
        if (!cancelled) setError('网络错误')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchList()
    return () => { cancelled = true }
  }, [session, status])

  const stats = data?.stats
  // 按投资基金筛选（空 = 全部）
  const filteredProjects = (data?.projects || []).filter(p => !fundFilter || p.investment?.fund === fundFilter)

  return (
    <DashboardLayout title="投后管理" subtitle="投后项目的季度经营报告与 AI 经营分析">
      {/* ── 四概览卡 ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[11px] text-gray-400 font-medium">投后项目</p>
          <p className="mt-1">
            <span className="text-2xl font-bold text-gray-900">{stats?.total ?? '—'}</span>
            <span className="text-xs text-gray-400 ml-1">交割后持续跟踪</span>
          </p>
          <p className="mt-1.5 text-[10px] text-gray-400">权限：合伙人可见全部，其他角色见自己维护项目</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
          <p className="text-[11px] text-gray-400 font-medium">{stats?.quarter || '本期'} 已提交</p>
          <p className="mt-1">
            <span className="text-2xl font-bold text-emerald-600">{stats?.submitted ?? '—'}</span>
            <span className="text-xs text-gray-400 ml-1">个项目</span>
          </p>
          <p className="mt-1.5 text-[10px] text-gray-400">经营报告 / 财务报表（任一项即可）</p>
        </div>
        <div className={`rounded-xl border p-4 ${(stats?.pending ?? 0) > 0 ? 'border-amber-200 bg-amber-50/50' : 'border-gray-100 bg-white'}`}>
          <p className="text-[11px] text-gray-400 font-medium">{stats?.quarter || '本期'} 待提交</p>
          <p className="mt-1">
            <span className={`text-2xl font-bold ${(stats?.pending ?? 0) > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{stats?.pending ?? '—'}</span>
            <span className="text-xs text-gray-400 ml-1">个项目</span>
          </p>
          <p className="mt-1.5 text-[10px] text-gray-400">点击项目卡进入上传季度资料</p>
        </div>
        <div className={`rounded-xl border p-4 ${(stats?.riskCount ?? 0) > 0 ? 'border-red-100 bg-red-50/40' : 'border-gray-100 bg-white'}`}>
          <p className="text-[11px] text-gray-400 font-medium">风险项目</p>
          <p className="mt-1">
            <span className={`text-2xl font-bold ${(stats?.riskCount ?? 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{stats?.riskCount ?? '—'}</span>
            <span className="text-xs text-gray-400 ml-1">高/中风险</span>
          </p>
          <p className="mt-1.5 text-[10px] text-gray-400">AI 分析识别的风险提示项目</p>
        </div>
      </div>

      {/* ── 项目列表 ── */}
      <div className="flex items-center justify-between mb-3 px-1 gap-3 flex-wrap">
        <h2 className="text-base font-bold text-gray-900">
          投后项目
          <span className="text-sm font-normal text-gray-400 ml-2">{filteredProjects.length || 0} 个</span>
        </h2>
        <div className="flex items-center gap-3">
          <select
            value={fundFilter}
            onChange={e => setFundFilter(e.target.value)}
            className="px-3 py-1.5 text-xs border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-200"
          >
            <option value="">全部基金</option>
            {(data?.funds || []).map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <span className="text-xs text-gray-400 hidden lg:inline">点击卡片进入投后档案（上传 / AI 分析 / 指标趋势）</span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#8d84e0]"></div>
        </div>
      ) : error ? (
        <div className="bg-red-50 rounded-2xl p-8 text-center border border-red-100">
          <p className="text-red-600 mb-2">{error}</p>
          <p className="text-sm text-gray-500">请刷新页面或重新登录后重试</p>
        </div>
      ) : !data || data.projects.length === 0 ? (
        <div className="dd-card rounded-2xl shadow-sm p-16 text-center border">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#efedfb] flex items-center justify-center">
            <svg className="w-8 h-8 text-[#8d84e0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">暂无投后阶段项目</h3>
          <p className="text-gray-500">项目进入投后阶段（交割完成）后将自动显示在此列表</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredProjects.map(p => (
            <button
              key={p.id}
              onClick={() => router.push(`/post-investment/${p.id}`)}
              className="w-full text-left dd-card rounded-xl shadow-sm hover:shadow-md transition-all border border-gray-100 px-4 py-3.5 group hover:border-blue-200"
            >
              {/* 第一行：项目名 + 行业/赛道 + 投资基金/金额/日期 | 提交状态 */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${p.submittedThisQuarter ? 'bg-emerald-500' : 'bg-amber-500'}`} title={p.submittedThisQuarter ? `${stats?.quarter} 已提交` : `${stats?.quarter} 待提交`} />
                <h3 className="text-sm font-bold text-gray-900 group-hover:text-blue-600 transition-colors flex-shrink-0">{p.name}</h3>
                {p.industry && (
                  <span className="px-1.5 py-0.5 bg-slate-50 text-gray-500 text-[10px] rounded whitespace-nowrap flex-shrink-0">{p.industry}</span>
                )}
                {p.investment ? (
                  <>
                    <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded whitespace-nowrap flex-shrink-0">{p.investment.fund}</span>
                    <span className="text-sm font-bold text-blue-600 whitespace-nowrap flex-shrink-0">{p.investment.amount?.toLocaleString()}<span className="text-[10px] font-normal text-gray-400"> 万元</span></span>
                    <span className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">{fmtInvestDate(p.investment.date)}</span>
                  </>
                ) : (
                  <span className="text-[10px] text-gray-300 whitespace-nowrap flex-shrink-0">投资信息未填写</span>
                )}
                <div className="flex-1"></div>
                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full whitespace-nowrap flex-shrink-0 ${p.submittedThisQuarter ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                  {p.submittedThisQuarter ? `${stats?.quarter} 已提交` : `${stats?.quarter} 待提交`}
                </span>
              </div>
              {/* 第二行：最新期 + 文档数 + AI 结论摘要 */}
              <div className="mt-2 flex items-center gap-3">
                <span className="text-[10px] text-gray-400 whitespace-nowrap flex-shrink-0">{p.latestPeriod || '—'} · 📄 {p.docCount}</span>
                <p className="text-xs text-gray-500 truncate flex-1">{p.latestSummary || '上传季度资料后触发 AI 经营分析'}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </DashboardLayout>
  )
}
