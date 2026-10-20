'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/DashboardLayout'
import { SkillPanelLauncher } from '@/components/SkillPanel'

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
    <DashboardLayout title="投后管理" subtitle="投后项目的季度经营报告与 AI 经营分析" actions={<SkillPanelLauncher scene="post-investment" />}>
      {/* ── 四概览卡 ── */}
      <div className="stat-3d-row grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="bg-surface rounded-2xl shadow-soft p-4">
          <p className="eyebrow">投后项目</p>
          <p className="mt-2">
            <span className="text-4xl font-bold tracking-tight text-ink">{stats?.total ?? '—'}</span>
            <span className="text-xs text-ink-faint ml-1.5">交割后持续跟踪</span>
          </p>
          <p className="mt-2 text-[10px] text-ink-faint">权限：合伙人可见全部，其他角色见自己维护项目</p>
        </div>
        <div className="bg-surface rounded-2xl shadow-soft p-4">
          <p className="eyebrow">{stats?.quarter || '本期'} 已提交</p>
          <p className="mt-2">
            <span className="text-4xl font-bold tracking-tight text-emerald-600">{stats?.submitted ?? '—'}</span>
            <span className="text-xs text-ink-faint ml-1.5">个项目</span>
          </p>
          <p className="mt-2 text-[10px] text-ink-faint">经营报告 / 财务报表（任一项即可）</p>
        </div>
        <div className="bg-surface rounded-2xl shadow-soft p-4">
          <p className="eyebrow">{stats?.quarter || '本期'} 待提交</p>
          <p className="mt-2">
            <span className={`text-4xl font-bold tracking-tight ${(stats?.pending ?? 0) > 0 ? 'text-amber-600' : 'text-ink'}`}>{stats?.pending ?? '—'}</span>
            <span className="text-xs text-ink-faint ml-1.5">个项目</span>
          </p>
          <p className="mt-2 text-[10px] text-ink-faint">点击项目卡进入上传季度资料</p>
        </div>
        <div className="bg-surface rounded-2xl shadow-soft p-4">
          <p className="eyebrow">风险项目</p>
          <p className="mt-2">
            <span className={`text-4xl font-bold tracking-tight ${(stats?.riskCount ?? 0) > 0 ? 'text-danger-600' : 'text-emerald-600'}`}>{stats?.riskCount ?? '—'}</span>
            <span className="text-xs text-ink-faint ml-1.5">高/中风险</span>
          </p>
          <p className="mt-2 text-[10px] text-ink-faint">AI 分析识别的风险提示项目</p>
        </div>
      </div>

      {/* ── 项目列表 ── */}
      <div className="flex items-center justify-between mb-3 px-1 gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-ink">
          投后项目
          <span className="text-sm font-normal text-ink-faint ml-2">{filteredProjects.length || 0} 个</span>
        </h2>
        <div className="flex items-center gap-3">
          <select
            value={fundFilter}
            onChange={e => setFundFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-full border border-hairline bg-surface text-ink hover:bg-gray-50 focus:outline-none focus:border-primary-300 transition-colors"
          >
            <option value="">全部基金</option>
            {(data?.funds || []).map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <span className="text-xs text-ink-faint hidden lg:inline">点击卡片进入投后档案（上传 / AI 分析 / 指标趋势）</span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      ) : error ? (
        <div className="bg-surface rounded-2xl shadow-soft p-8 text-center">
          <p className="text-danger-600 mb-2">{error}</p>
          <p className="text-sm text-ink-muted">请刷新页面或重新登录后重试</p>
        </div>
      ) : !data || data.projects.length === 0 ? (
        <div className="bg-surface rounded-2xl shadow-soft p-16 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-gray-50 flex items-center justify-center">
            <svg className="w-6 h-6 text-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-ink mb-2">暂无投后阶段项目</h3>
          <p className="text-ink-muted">项目进入投后阶段（交割完成）后将自动显示在此列表</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredProjects.map(p => (
            <button
              key={p.id}
              onClick={() => router.push(`/post-investment/${p.id}`)}
              className="w-full text-left card card-hover px-4 py-3.5 group"
            >
              {/* 第一行：项目名 + 行业/赛道 + 投资基金/金额/日期 | 提交状态 */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${p.submittedThisQuarter ? 'bg-emerald-500' : 'bg-amber-500'}`} title={p.submittedThisQuarter ? `${stats?.quarter} 已提交` : `${stats?.quarter} 待提交`} />
                <h3 className="text-sm font-bold text-ink group-hover:text-primary-600 transition-colors flex-shrink-0">{p.name}</h3>
                {p.industry && (
                  <span className="pill bg-gray-50 text-ink-muted whitespace-nowrap flex-shrink-0">{p.industry}</span>
                )}
                {p.investment ? (
                  <>
                    <span className="pill bg-primary-50 text-primary-700 whitespace-nowrap flex-shrink-0">{p.investment.fund}</span>
                    <span className="text-sm font-bold text-primary-600 whitespace-nowrap flex-shrink-0">{p.investment.amount?.toLocaleString()}<span className="text-[10px] font-normal text-ink-faint"> 万元</span></span>
                    <span className="text-xs text-ink-muted whitespace-nowrap flex-shrink-0">{fmtInvestDate(p.investment.date)}</span>
                  </>
                ) : (
                  <span className="text-[10px] text-ink-faint whitespace-nowrap flex-shrink-0">投资信息未填写</span>
                )}
                <div className="flex-1"></div>
                <span className={`pill whitespace-nowrap flex-shrink-0 ${p.submittedThisQuarter ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                  {p.submittedThisQuarter ? `${stats?.quarter} 已提交` : `${stats?.quarter} 待提交`}
                </span>
              </div>
              {/* 第二行：最新期 + 文档数 + AI 结论摘要 */}
              <div className="mt-2 flex items-center gap-3">
                <span className="text-[10px] text-ink-faint whitespace-nowrap flex-shrink-0">{p.latestPeriod || '—'} · 📄 {p.docCount}</span>
                <p className="text-xs text-ink-muted truncate flex-1">{p.latestSummary || '上传季度资料后触发 AI 经营分析'}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </DashboardLayout>
  )
}
