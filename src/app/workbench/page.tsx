'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { followStageLabels, followStageColors, type FollowStage } from '../projects/types'

interface Project {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  companyPosition: string | null
  financingRound: string | null
  followStage: FollowStage
  status: string
  totalAmount: number
  raisedAmount: string
  investmentValuation: number | null
  targetDate: string
  createdAt: string
  createdBy: { id: string; name: string | null } | null
}

interface StageChangeRequest {
  id: string
  fromStage: string
  toStage: string
  status: string
  comment: string | null
  createdAt: string
  project: {
    id: string
    name: string
    companyPosition: string | null
    industry: string | null
    financingRound: string | null
    totalAmount: number
    investmentValuation: number | null
    followStage: string
    createdBy: { id: string; name: string | null } | null
  }
  requester: { id: string; name: string | null }
}

// 阶段顺序
const STAGE_ORDER: FollowStage[] = [
  'INITIAL_TALK',
  'PRE_DD',
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'AGREEMENT',
  'CLOSING',
  'POST_INVESTMENT',
  'REJECTED',
]

// 投资合伙人可见的阶段（只看立项及之后）
const PARTNER_VISIBLE_STAGES: FollowStage[] = [
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'AGREEMENT',
  'CLOSING',
  'POST_INVESTMENT',
  'REJECTED',
]

// 各阶段配色
const stageGradients: Record<FollowStage, string> = {
  INITIAL_TALK: 'from-gray-400 to-gray-500',
  PRE_DD: 'from-blue-400 to-blue-500',
  PROJECT_INITIATION: 'from-purple-400 to-purple-500',
  DUE_DILIGENCE: 'from-amber-400 to-amber-500',
  AGREEMENT: 'from-teal-400 to-teal-500',
  CLOSING: 'from-emerald-400 to-emerald-500',
  POST_INVESTMENT: 'from-indigo-400 to-indigo-500',
  REJECTED: 'from-red-400 to-red-500',
}

const stageBorderLeft: Record<FollowStage, string> = {
  INITIAL_TALK: 'border-l-gray-400',
  PRE_DD: 'border-l-blue-400',
  PROJECT_INITIATION: 'border-l-purple-400',
  DUE_DILIGENCE: 'border-l-amber-400',
  AGREEMENT: 'border-l-teal-400',
  CLOSING: 'border-l-emerald-400',
  POST_INVESTMENT: 'border-l-indigo-400',
  REJECTED: 'border-l-red-400',
}

// 各阶段图标
const stageIcons: Record<FollowStage, JSX.Element> = {
  INITIAL_TALK: (
    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  PRE_DD: (
    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  PROJECT_INITIATION: (
    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  DUE_DILIGENCE: (
    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
  AGREEMENT: (
    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  CLOSING: (
    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  POST_INVESTMENT: (
    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  REJECTED: (
    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14L21 3m0 0v6m0-6h-6M19 13a8 8 0 11-2.343 5.657" />
    </svg>
  ),
}

export default function WorkbenchPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [stageRequests, setStageRequests] = useState<StageChangeRequest[]>([])
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  // 当前选中的阶段卡片（点击卡片筛选对应阶段项目）
  const [selectedStage, setSelectedStage] = useState<FollowStage>('INITIAL_TALK')

  // 投资合伙人筛选投资经理
  const [managers, setManagers] = useState<{ id: string; name: string | null; username: string | null; email: string | null }[]>([])
  const [selectedManagerId, setSelectedManagerId] = useState<string>('')  // 空 = 全部

  const userRole = session?.user?.role as string | undefined
  const isPartner = userRole === 'INVESTMENT_PARTNER' || userRole === 'ADMIN'

  // 未登录跳转登录
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login?callbackUrl=/workbench')
    }
  }, [status, router])

  useEffect(() => {
    if (status === 'authenticated') {
      fetchProjects()
      if (isPartner) {
        fetchStageRequests()
        fetchManagers()
      }
    }
  }, [status, isPartner])

  const fetchManagers = async () => {
    try {
      const response = await fetch('/api/users/managers')
      if (response.ok) {
        const data = await response.json()
        setManagers(data.managers || [])
      }
    } catch (error) {
      console.error('Failed to fetch managers:', error)
    }
  }

  const fetchProjects = async () => {
    setLoading(true)
    try {
      // 投资合伙人/管理员看所有项目；其他角色看个人维护的项目
      const scope = isPartner ? 'all' : 'mine'
      const response = await fetch(`/api/projects?scope=${scope}`)
      const data = await response.json()
      setProjects(data.projects || [])
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    }
    setLoading(false)
  }

  const fetchStageRequests = async () => {
    setRequestsLoading(true)
    try {
      const response = await fetch('/api/stage-change-requests?status=PENDING')
      const data = await response.json()
      setStageRequests(data.requests || [])
    } catch (error) {
      console.error('Failed to fetch stage requests:', error)
    }
    setRequestsLoading(false)
  }

  const handleAction = async (requestId: string, action: 'approve' | 'reject') => {
    setActionLoading(requestId)
    try {
      const response = await fetch(`/api/stage-change-requests/${requestId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (response.ok) {
        // 刷新待办列表和项目列表
        fetchStageRequests()
        fetchProjects()
      } else {
        const data = await response.json()
        alert(data.error || '操作失败')
      }
    } catch (error) {
      alert('操作失败')
    }
    setActionLoading(null)
  }

  // 投资合伙人只看立项及之后阶段
  const visibleStages = isPartner ? PARTNER_VISIBLE_STAGES : STAGE_ORDER

  // 合伙人默认选中 'PROJECT_INITIATION'（初聊不在合伙人可见范围内）
  useEffect(() => {
    if (status === 'authenticated' && isPartner && !PARTNER_VISIBLE_STAGES.includes(selectedStage)) {
      setSelectedStage('PROJECT_INITIATION')
    }
  }, [status, isPartner, selectedStage])

  // 应用筛选：投资合伙人可按投资经理筛选项目（按创建人）
  const filteredProjects = isPartner && selectedManagerId
    ? projects.filter(p => p.createdBy?.id === selectedManagerId)
    : projects

  // 按当前阶段分组（仅当前处于该阶段的项目计入）
  const projectsByStage = visibleStages.map(stage => ({
    stage,
    label: followStageLabels[stage],
    projects: filteredProjects.filter(p => p.followStage === stage),
  }))

  const totalProjects = filteredProjects.filter(p => visibleStages.includes(p.followStage)).length

  return (
    <DashboardLayout
      title="工作台"
      subtitle={
        isPartner
          ? `投资合伙人视图 · 立项及之后阶段项目 · 共 ${totalProjects} 个`
          : `个人跟进项目管理 · 共 ${totalProjects} 个项目`
      }
    >
      {/* 说明条 */}
      <div className="bg-gradient-to-r from-primary-50 to-blue-50 rounded-2xl p-4 mb-6 border border-primary-100 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-md shadow-primary-500/30 flex-shrink-0">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div className="text-sm text-gray-600 flex-1">
          {isPartner ? (
            <>
              <span className="font-medium text-gray-900">投资合伙人工作台</span>：查看立项及之后阶段的项目，审批项目阶段变更请求。
            </>
          ) : (
            <>
              <span className="font-medium text-gray-900">工作台</span>仅展示您维护的项目（作为创建者或项目成员），按跟进阶段分组排列。
            </>
          )}
        </div>
        {/* 投资合伙人筛选投资经理 */}
        {isPartner && managers.length > 0 && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <label className="text-xs text-gray-500 whitespace-nowrap">按投资经理筛选</label>
            <select
              value={selectedManagerId}
              onChange={(e) => setSelectedManagerId(e.target.value)}
              className="px-3 py-1.5 bg-white border border-primary-200 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-primary-400 focus:border-primary-400 max-w-[180px]"
            >
              <option value="">全部投资经理</option>
              {managers.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name || m.username || m.email}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 阶段卡片栏：所有阶段（含已否）在同一行，点击筛选对应阶段项目 */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {projectsByStage.map(({ stage, label, projects: stageProjects }) => {
          const isSelected = selectedStage === stage
          const isRejectedStage = stage === 'REJECTED'
          return (
            <button
              key={stage}
              type="button"
              onClick={() => setSelectedStage(stage)}
              className={`flex-1 min-w-[110px] rounded-xl p-3 shadow-sm border transition-all flex flex-col items-center gap-1.5 cursor-pointer
                ${isSelected
                  ? 'border-primary-500 ring-2 ring-primary-400 bg-white'
                  : isRejectedStage
                    ? 'border-red-100 bg-red-50/30 hover:border-red-300'
                    : 'border-primary-100 bg-gradient-card hover:border-primary-300'
                }`}
            >
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${stageGradients[stage]} flex items-center justify-center shadow-md flex-shrink-0`}>
                {stageIcons[stage]}
              </div>
              <div className={`text-lg font-bold leading-tight ${isRejectedStage ? 'text-red-600' : 'text-gray-900'}`}>{stageProjects.length}</div>
              <div className={`text-xs truncate text-center w-full ${isRejectedStage ? 'text-red-500' : 'text-gray-500'}`}>{label}</div>
            </button>
          )
        })}
      </div>

      {/* 待办请求区块（仅投资合伙人/管理员可见） */}
      {isPartner && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              待办请求
              {stageRequests.length > 0 && (
                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                  {stageRequests.length}
                </span>
              )}
            </h3>
          </div>

          {requestsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : stageRequests.length === 0 ? (
            <div className="bg-gradient-card rounded-2xl shadow-sm p-8 text-center border border-primary-100">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gray-50 flex items-center justify-center">
                <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm text-gray-500">暂无待审批的阶段变更请求</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {stageRequests.map(req => (
                <div
                  key={req.id}
                  className="bg-white rounded-2xl shadow-sm border border-amber-100 p-5 hover:shadow-md transition-shadow"
                >
                  {/* 顶部：项目名称 + 维护人 */}
                  <div className="flex items-center justify-between mb-3">
                    <Link
                      href={`/projects/${req.project.id}`}
                      className="font-semibold text-gray-900 text-sm hover:text-primary-700 transition-colors"
                    >
                      {req.project.name}
                    </Link>
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      {req.project.createdBy?.name || req.requester.name || '未分配'}
                    </span>
                  </div>

                  {/* 阶段变更信息 */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${followStageColors[req.fromStage as FollowStage] || 'bg-gray-100 text-gray-700'}`}>
                      {followStageLabels[req.fromStage as FollowStage] || req.fromStage}
                    </span>
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${followStageColors[req.toStage as FollowStage] || 'bg-gray-100 text-gray-700'}`}>
                      {followStageLabels[req.toStage as FollowStage] || req.toStage}
                    </span>
                  </div>

                  {/* 项目详情 */}
                  <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
                    {req.project.companyPosition && (
                      <div>
                        <span className="text-gray-400">公司定位：</span>
                        <span className="text-gray-700">{req.project.companyPosition}</span>
                      </div>
                    )}
                    {req.project.financingRound && (
                      <div>
                        <span className="text-gray-400">融资轮次：</span>
                        <span className="text-gray-700">{req.project.financingRound}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-400">融资金额：</span>
                      <span className="text-gray-700">{req.project.totalAmount}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">投资估值：</span>
                      <span className="text-gray-700">{req.project.investmentValuation ? `¥${req.project.investmentValuation.toLocaleString()}亿` : '-'}</span>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => handleAction(req.id, 'approve')}
                      disabled={actionLoading === req.id}
                      className="flex-1 px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors text-sm font-medium disabled:opacity-50"
                    >
                      同意
                    </button>
                    <button
                      onClick={() => handleAction(req.id, 'reject')}
                      disabled={actionLoading === req.id}
                      className="flex-1 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-50"
                    >
                      拒绝
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 当前选中阶段的项目列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      ) : totalProjects === 0 ? (
        <div className="bg-gradient-card rounded-2xl shadow-sm p-16 text-center border border-primary-100">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {isPartner ? '暂无立项及之后阶段的项目' : '暂无您维护的项目'}
          </h3>
          <p className="text-gray-500 mb-4">
            {isPartner ? '当前没有立项、尽调、交割或投后阶段的项目' : '您还不是任何项目的维护人，可前往项目库创建或被分配项目'}
          </p>
          {!isPartner && (
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-colors text-sm font-medium"
            >
              浏览项目库
            </Link>
          )}
        </div>
      ) : (
        (() => {
          const stageInfo = projectsByStage.find(s => s.stage === selectedStage)
          const stageProjects = stageInfo?.projects || []
          const stageLabel = stageInfo?.label || ''
          const stageKey = selectedStage

          return (
            <div className="bg-gradient-card rounded-2xl shadow-sm border border-primary-100 overflow-hidden">
              {/* 阶段头部 */}
              <div className={`flex items-center justify-between px-5 py-3 bg-gradient-to-r ${stageGradients[stageKey]} from-opacity-10`}>
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold text-sm">{stageLabel}</span>
                  <span className="px-2 py-0.5 bg-white/20 rounded-full text-white text-xs font-medium">
                    {stageProjects.length}
                  </span>
                </div>
              </div>

              {/* 项目卡片 */}
              {stageProjects.length === 0 ? (
                <div className="px-5 py-6 text-center text-sm text-gray-400">
                  暂无{stageLabel}阶段项目
                </div>
              ) : (
                <div className="divide-y divide-primary-50">
                  {stageProjects.map(project => (
                    <div
                      key={project.id}
                      className={`block px-5 py-3 hover:bg-primary-50/50 transition-colors border-l-4 ${stageBorderLeft[stageKey]}`}
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <Link href={`/projects/${project.id}`} className="flex items-center gap-2 min-w-0 flex-1 hover:text-primary-700 transition-colors">
                          <h4 className="font-semibold text-gray-900 text-sm truncate hover:text-primary-700 transition-colors">
                            {project.name}
                          </h4>
                          {/* 项目维护人（投资合伙人视图显示在名称右边） */}
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            {project.createdBy?.name || '未分配'}
                          </span>
                          {project.companyPosition && (
                            <span className="text-xs text-gray-500 truncate">
                              · {project.companyPosition}
                            </span>
                          )}
                        </Link>
                        <div className="flex items-center gap-3 text-xs text-gray-500 whitespace-nowrap">
                          {project.financingRound && (
                            <span>{project.financingRound}</span>
                          )}
                          {project.industry && (
                            <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">{project.industry}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()
      )}
    </DashboardLayout>
  )
}
