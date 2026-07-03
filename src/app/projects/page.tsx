'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/DashboardLayout'
import { followStageLabels, followStageColors, type FollowStage } from './types'

interface Project {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  companyPosition: string | null
  financingRound: string | null
  financingPlan: string | null
  followStage: FollowStage
  status: string
  totalAmount: number
  raisedAmount: number
  targetDate: string
  investorCount: number
  investmentCount: number
  createdAt: string
  createdBy: { id: string; name: string | null } | null
}

interface ProjectLead {
  id: string
  name: string
  industry: string | null
  companyPosition: string | null
  mainProducts: string | null
  financingHistory: string | null
  contactInfo: string | null
  description: string | null
  status: string
  createdAt: string
  createdBy: { id: string; name: string | null } | null
}

interface LeadFormData {
  name: string
  industry: string
  companyPosition: string
  mainProducts: string
  financingHistory: string
  contactInfo: string
  description: string
}

const emptyLeadForm: LeadFormData = {
  name: '',
  industry: '',
  companyPosition: '',
  mainProducts: '',
  financingHistory: '',
  contactInfo: '',
  description: '',
}

// 各阶段对应的图标
const stageIcons: Record<FollowStage | 'all', JSX.Element> = {
  all: (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  INITIAL_TALK: (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  PRE_DD: (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  PROJECT_INITIATION: (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  DUE_DILIGENCE: (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
  CLOSING: (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  POST_INVESTMENT: (
    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
}

const stageCardStyles: Record<FollowStage | 'all', string> = {
  all: 'from-primary-500 to-primary-700',
  INITIAL_TALK: 'from-gray-400 to-gray-500',
  PRE_DD: 'from-blue-400 to-blue-500',
  PROJECT_INITIATION: 'from-purple-400 to-purple-500',
  DUE_DILIGENCE: 'from-amber-400 to-amber-500',
  CLOSING: 'from-emerald-400 to-emerald-500',
  POST_INVESTMENT: 'from-indigo-400 to-indigo-500',
}

type TabKey = 'library' | 'mine' | 'leads'

export default function ProjectListPage() {
  const { data: session } = useSession()
  const userRole = session?.user?.role as string | undefined
  // 投资经理默认进入"我的项目"，其他角色默认"项目库"
  const isManagerOnly = userRole === 'INVESTMENT_MANAGER'

  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedStage, setSelectedStage] = useState<FollowStage | 'all'>('all')
  const [selectedIndustry, setSelectedIndustry] = useState<string>('all')
  const [scope, setScope] = useState<'all' | 'mine'>(isManagerOnly ? 'mine' : 'all')

  // Tab 切换：项目库 / 我的项目 / 项目线索
  const [tab, setTab] = useState<TabKey>(isManagerOnly ? 'mine' : 'library')

  // 项目线索相关状态
  const [leads, setLeads] = useState<ProjectLead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [leadSearchTerm, setLeadSearchTerm] = useState('')
  const [showLeadModal, setShowLeadModal] = useState(false)
  const [editingLead, setEditingLead] = useState<ProjectLead | null>(null)
  const [viewingLead, setViewingLead] = useState<ProjectLead | null>(null)
  const [leadForm, setLeadForm] = useState<LeadFormData>(emptyLeadForm)
  const [leadSaving, setLeadSaving] = useState(false)
  const [leadError, setLeadError] = useState('')

  // 当用户 session 加载完成后，如果是投资经理且当前 scope 未初始化，切换到 mine
  useEffect(() => {
    if (userRole === 'INVESTMENT_MANAGER' && scope === 'all') {
      setScope('mine')
    }
  }, [userRole])

  // Tab 切换时同步 scope
  useEffect(() => {
    if (tab === 'library') setScope('all')
    else if (tab === 'mine') setScope('mine')
  }, [tab])

  useEffect(() => {
    if (tab !== 'leads') fetchProjects()
  }, [scope, tab])

  useEffect(() => {
    if (tab === 'leads') fetchLeads()
  }, [tab])

  const fetchProjects = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/projects?scope=${scope}`)
      const data = await response.json()
      setProjects(data.projects || [])
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    }
    setLoading(false)
  }

  const fetchLeads = async () => {
    setLeadsLoading(true)
    try {
      const leadScope = userRole === 'INVESTMENT_MANAGER' ? 'mine' : 'all'
      const response = await fetch(`/api/project-leads?scope=${leadScope}`)
      const data = await response.json()
      setLeads(data.leads || [])
    } catch (error) {
      console.error('Failed to fetch leads:', error)
    }
    setLeadsLoading(false)
  }

  const openCreateLead = () => {
    setEditingLead(null)
    setLeadForm(emptyLeadForm)
    setLeadError('')
    setShowLeadModal(true)
  }

  const openEditLead = (lead: ProjectLead) => {
    setEditingLead(lead)
    setLeadForm({
      name: lead.name,
      industry: lead.industry || '',
      companyPosition: lead.companyPosition || '',
      mainProducts: lead.mainProducts || '',
      financingHistory: lead.financingHistory || '',
      contactInfo: lead.contactInfo || '',
      description: lead.description || '',
    })
    setLeadError('')
    setViewingLead(null)
    setShowLeadModal(true)
  }

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLeadError('')
    if (!leadForm.name.trim()) {
      setLeadError('项目线索名称是必填项')
      return
    }
    setLeadSaving(true)
    try {
      if (editingLead) {
        const response = await fetch(`/api/project-leads/${editingLead.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(leadForm),
        })
        if (!response.ok) {
          const result = await response.json()
          throw new Error(result.error || '更新失败')
        }
      } else {
        const response = await fetch('/api/project-leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(leadForm),
        })
        if (!response.ok) {
          const result = await response.json()
          throw new Error(result.error || '创建失败')
        }
      }
      setShowLeadModal(false)
      fetchLeads()
    } catch (error) {
      setLeadError(error instanceof Error ? error.message : '操作失败')
    }
    setLeadSaving(false)
  }

  const handleDeleteLead = async (lead: ProjectLead) => {
    if (!confirm(`确定要删除项目线索「${lead.name}」吗？`)) return
    try {
      const response = await fetch(`/api/project-leads/${lead.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const result = await response.json()
        alert(result.error || '删除失败')
        return
      }
      setViewingLead(null)
      fetchLeads()
    } catch (error) {
      alert('删除失败')
    }
  }

  // 从项目列表中提取不重复的行业
  const industries = Array.from(
    new Set(projects.map(p => p.industry).filter((i): i is string => !!i))
  ).sort()

  const filteredProjects = projects.filter(project => {
    const matchesSearch = searchTerm === '' ||
      project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.companyFullName?.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesStage = selectedStage === 'all' || project.followStage === selectedStage

    const matchesIndustry = selectedIndustry === 'all' || project.industry === selectedIndustry

    return matchesSearch && matchesStage && matchesIndustry
  })

  const stageCount = (stage: FollowStage) =>
    projects.filter(p => p.followStage === stage).length

  // 过滤项目线索
  const filteredLeads = leads.filter(lead => {
    if (!leadSearchTerm) return true
    const term = leadSearchTerm.toLowerCase()
    return (
      lead.name.toLowerCase().includes(term) ||
      lead.industry?.toLowerCase().includes(term) ||
      lead.companyPosition?.toLowerCase().includes(term) ||
      lead.mainProducts?.toLowerCase().includes(term)
    )
  })

  return (
    <DashboardLayout
      title="项目管理"
      subtitle="管理和追踪您的投资项目"
      actions={
        tab === 'leads' ? (
          <button
            onClick={openCreateLead}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 transition-all-smooth shadow-md shadow-primary-500/30 font-medium text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新增线索
          </button>
        ) : (
          <Link
            href="/projects/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 transition-all-smooth shadow-md shadow-primary-500/30 font-medium text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新建项目
          </Link>
        )
      }
    >
      {/* Tab 切换：项目库 / 我的项目 / 项目线索 */}
      <div className="bg-gradient-card rounded-2xl shadow-sm p-1.5 mb-6 border border-primary-100 inline-flex">
        <button
          onClick={() => setTab('library')}
          className={`px-5 py-2 rounded-xl text-sm font-medium transition-all-smooth ${
            tab === 'library'
              ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md shadow-primary-500/30'
              : 'text-gray-600 hover:bg-primary-50 hover:text-primary-700'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            项目库
          </span>
        </button>
        <button
          onClick={() => setTab('mine')}
          className={`px-5 py-2 rounded-xl text-sm font-medium transition-all-smooth ${
            tab === 'mine'
              ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md shadow-primary-500/30'
              : 'text-gray-600 hover:bg-primary-50 hover:text-primary-700'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            我的项目
          </span>
        </button>
        <button
          onClick={() => setTab('leads')}
          className={`px-5 py-2 rounded-xl text-sm font-medium transition-all-smooth ${
            tab === 'leads'
              ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md shadow-primary-500/30'
              : 'text-gray-600 hover:bg-primary-50 hover:text-primary-700'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            项目线索
          </span>
        </button>
      </div>

      {/* ════════════ 项目线索视图 ════════════ */}
      {tab === 'leads' && (
        <>
          {/* 项目线索说明 + 搜索 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-4 mb-6 border border-primary-100">
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <svg className="w-5 h-5 text-primary-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>项目线索用于记录潜在项目信息，新建项目时若名称高度重合将自动合并并删除线索</span>
              </div>
              <div className="flex-1 md:max-w-xs relative w-full">
                <svg className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="搜索项目线索..."
                  value={leadSearchTerm}
                  onChange={(e) => setLeadSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth placeholder-gray-400"
                />
              </div>
            </div>
          </div>

          {/* 项目线索列表 */}
          {leadsLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="bg-gradient-card rounded-2xl shadow-sm p-16 text-center border border-primary-100">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary-50 flex items-center justify-center">
                <svg className="w-8 h-8 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">暂无项目线索</h3>
              <p className="text-gray-500">点击右上角按钮新增项目线索</p>
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
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <h3 className="text-base font-semibold text-gray-900 group-hover:text-primary-700 transition-colors truncate">
                        {lead.name}
                      </h3>
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        {lead.createdBy?.name || '未分配'}
                      </span>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      {lead.industry && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-400 text-xs flex-shrink-0">行业/赛道</span>
                          <span className="text-gray-900 truncate text-right">{lead.industry}</span>
                        </div>
                      )}
                      {lead.companyPosition && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-400 text-xs flex-shrink-0">公司定位</span>
                          <span className="text-gray-900 truncate text-right">{lead.companyPosition}</span>
                        </div>
                      )}
                      {lead.mainProducts && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-400 text-xs flex-shrink-0">主要产品</span>
                          <span className="text-gray-900 truncate text-right">{lead.mainProducts}</span>
                        </div>
                      )}
                      {lead.financingHistory && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-400 text-xs flex-shrink-0">融资经历</span>
                          <span className="text-gray-900 truncate text-right">{lead.financingHistory}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ════════════ 项目视图（项目库 / 我的项目）════════════ */}
      {tab !== 'leads' && (
        <>
          {/* 统计卡片区域 - 项目库 + 6个阶段 */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
            {/* 项目库卡片 */}
            <button
              onClick={() => setSelectedStage('all')}
              className={`bg-gradient-card rounded-2xl p-5 shadow-sm border transition-all-smooth text-left ${
                selectedStage === 'all' ? 'border-primary-400 ring-2 ring-primary-200' : 'border-primary-100 hover:border-primary-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${stageCardStyles.all} flex items-center justify-center shadow-md shadow-primary-500/30 flex-shrink-0`}>
                  {stageIcons.all}
                </div>
                <div className="min-w-0">
                  <div className="text-2xl font-bold text-gray-900">{projects.length}</div>
                  <div className="text-xs text-gray-500">项目库</div>
                </div>
              </div>
            </button>

            {/* 6个阶段卡片 */}
            {(Object.keys(followStageLabels) as FollowStage[]).map(stage => (
              <button
                key={stage}
                onClick={() => setSelectedStage(selectedStage === stage ? 'all' : stage)}
                className={`bg-gradient-card rounded-2xl p-5 shadow-sm border transition-all-smooth text-left ${
                  selectedStage === stage ? 'border-primary-400 ring-2 ring-primary-200' : 'border-primary-100 hover:border-primary-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${stageCardStyles[stage]} flex items-center justify-center shadow-sm flex-shrink-0`}>
                    {stageIcons[stage]}
                  </div>
                  <div className="min-w-0">
                    <div className="text-2xl font-bold text-gray-900">{stageCount(stage)}</div>
                    <div className="text-xs text-gray-500 truncate">{followStageLabels[stage]}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* 搜索和行业筛选 */}
          <div className="bg-gradient-card rounded-2xl shadow-sm p-4 mb-6 border border-primary-100">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <svg className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="搜索项目名称或公司全称..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth placeholder-gray-400"
                />
              </div>
              <select
                value={selectedIndustry}
                onChange={(e) => setSelectedIndustry(e.target.value)}
                className="px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth text-gray-700 min-w-[140px]"
              >
                <option value="all">所有行业/赛道</option>
                {industries.map(industry => (
                  <option key={industry} value={industry}>{industry}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 项目卡片列表 */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="bg-gradient-card rounded-2xl shadow-sm p-16 text-center border border-primary-100">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary-50 flex items-center justify-center">
                <svg className="w-8 h-8 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">暂无项目</h3>
              <p className="text-gray-500">点击右上角按钮创建第一个投资项目</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredProjects.map(project => {
                return (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="block bg-gradient-card rounded-2xl shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all-smooth border border-primary-100 overflow-hidden group"
                  >
                    <div className="p-5">
                      {/* 第一行：项目名称 + 维护人 + 阶段 + 公司定位（小号字体） */}
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <h3 className="text-base font-semibold text-gray-900 group-hover:text-primary-700 transition-colors truncate">
                          {project.name}
                        </h3>
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          {project.createdBy?.name || '未分配'}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${followStageColors[project.followStage]}`}>
                          {followStageLabels[project.followStage]}
                        </span>
                        {project.companyPosition && (
                          <span className="text-xs text-gray-500 truncate flex-1 min-w-0">
                            {project.companyPosition}
                          </span>
                        )}
                      </div>

                      {/* 第二行：5项关键信息 */}
                      <div className="space-y-1.5 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-400 text-xs flex-shrink-0">公司全称</span>
                          <span className="text-gray-900 truncate text-right">{project.companyFullName || '-'}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-400 text-xs flex-shrink-0">行业/赛道</span>
                          <span className="text-gray-900 truncate text-right">{project.industry || '-'}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-400 text-xs flex-shrink-0">融资轮次</span>
                          <span className="text-gray-900 truncate text-right">{project.financingRound || '-'}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-400 text-xs flex-shrink-0">融资金额</span>
                          <span className="text-primary-700 font-medium text-right">
                            {project.totalAmount > 0 ? `¥${project.totalAmount.toLocaleString()}万` : '-'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-400 text-xs flex-shrink-0">历史累计融资</span>
                          <span className="text-gray-900 text-right">
                            {project.raisedAmount > 0 ? `¥${project.raisedAmount.toLocaleString()}万` : '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ════════════ 项目线索 新增/编辑 弹窗 ════════════ */}
      {showLeadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-primary-100">
              <h2 className="text-lg font-bold text-gray-900">
                {editingLead ? '编辑项目线索' : '新增项目线索'}
              </h2>
              <button
                onClick={() => setShowLeadModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleLeadSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
              {leadError && (
                <div className="flex items-center gap-3 px-4 py-3 bg-danger-50 border border-danger-200 rounded-xl">
                  <span className="text-sm text-danger-700">{leadError}</span>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  项目名称 <span className="text-danger-500">*</span>
                </label>
                <input
                  type="text"
                  value={leadForm.name}
                  onChange={(e) => setLeadForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth placeholder-gray-400"
                  placeholder="请输入项目名称"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">行业/赛道</label>
                  <input
                    type="text"
                    value={leadForm.industry}
                    onChange={(e) => setLeadForm(prev => ({ ...prev, industry: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth placeholder-gray-400"
                    placeholder="如 AI/Agent、半导体"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">公司定位</label>
                  <input
                    type="text"
                    value={leadForm.companyPosition}
                    onChange={(e) => setLeadForm(prev => ({ ...prev, companyPosition: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth placeholder-gray-400"
                    placeholder="请输入公司定位"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">主要产品</label>
                <textarea
                  value={leadForm.mainProducts}
                  onChange={(e) => setLeadForm(prev => ({ ...prev, mainProducts: e.target.value }))}
                  rows={2}
                  className="w-full px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth placeholder-gray-400 resize-none"
                  placeholder="请输入主要产品"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">融资经历</label>
                <textarea
                  value={leadForm.financingHistory}
                  onChange={(e) => setLeadForm(prev => ({ ...prev, financingHistory: e.target.value }))}
                  rows={2}
                  className="w-full px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth placeholder-gray-400 resize-none"
                  placeholder="如 2024年A轮5000万、2025年B轮1亿"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">联系方式</label>
                <input
                  type="text"
                  value={leadForm.contactInfo}
                  onChange={(e) => setLeadForm(prev => ({ ...prev, contactInfo: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth placeholder-gray-400"
                  placeholder="联系人/电话/邮箱"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
                <textarea
                  value={leadForm.description}
                  onChange={(e) => setLeadForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={2}
                  className="w-full px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth placeholder-gray-400 resize-none"
                  placeholder="其他备注信息"
                />
              </div>
            </form>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-primary-100">
              <button
                onClick={() => setShowLeadModal(false)}
                className="px-5 py-2.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-all-smooth text-sm font-medium"
              >
                取消
              </button>
              <button
                onClick={handleLeadSubmit}
                disabled={leadSaving}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 transition-all-smooth disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-primary-500/30 text-sm font-medium"
              >
                {leadSaving ? '保存中...' : (editingLead ? '保存修改' : '创建线索')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════ 项目线索 详情弹窗 ════════════ */}
      {viewingLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-primary-100">
              <h2 className="text-lg font-bold text-gray-900 truncate">{viewingLead.name}</h2>
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
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span>维护人：{viewingLead.createdBy?.name || '未分配'}</span>
                <span>·</span>
                <span>创建于 {new Date(viewingLead.createdAt).toLocaleDateString('zh-CN')}</span>
              </div>

              {[
                { label: '行业/赛道', value: viewingLead.industry },
                { label: '公司定位', value: viewingLead.companyPosition },
                { label: '主要产品', value: viewingLead.mainProducts },
                { label: '融资经历', value: viewingLead.financingHistory },
                { label: '联系方式', value: viewingLead.contactInfo },
                { label: '备注', value: viewingLead.description },
              ].map(item => (
                <div key={item.label} className="border-b border-primary-50 pb-3">
                  <div className="text-xs text-gray-400 mb-1">{item.label}</div>
                  <div className="text-sm text-gray-900 whitespace-pre-wrap">
                    {item.value || <span className="text-gray-300">未填写</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-primary-100">
              <button
                onClick={() => handleDeleteLead(viewingLead)}
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
                <button
                  onClick={() => openEditLead(viewingLead)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 transition-all-smooth shadow-md shadow-primary-500/30 text-sm font-medium"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  编辑
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
