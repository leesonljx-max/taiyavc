'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { followStageLabels, type FollowStage } from '../../types'

interface FormData {
  name: string
  companyFullName: string
  industry: string
  companyPosition: string
  mainProducts: string
  coreAdvantage: string
  coreTeam: string
  competitors: string
  financialData: string
  orderProgress: string
  financingPlan: string
  financingRound: string
  followStage: FollowStage
  status: string
  description: string
  totalAmount: string
  raisedAmount: string
  targetDate: string
}

interface Project {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  companyPosition: string | null
  mainProducts: string | null
  coreAdvantage: string | null
  coreTeam: string | null
  competitors: string | null
  financialData: Record<string, any> | null | string
  orderProgress: string | null
  financingPlan: string | null
  financingRound: string | null
  followStage: FollowStage
  status: string
  description: string | null
  totalAmount: number
  raisedAmount: number
  targetDate: string
  canEdit: boolean
}

const inputClass = "w-full px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth placeholder-gray-400"
const labelClass = "block text-sm font-medium text-gray-700 mb-2"

export default function EditProjectPage() {
  const params = useParams()
  const router = useRouter()
  const [formData, setFormData] = useState<FormData>({
    name: '',
    companyFullName: '',
    industry: '',
    companyPosition: '',
    mainProducts: '',
    coreAdvantage: '',
    coreTeam: '',
    competitors: '',
    financialData: '',
    orderProgress: '',
    financingPlan: '',
    financingRound: '',
    followStage: 'INITIAL_TALK',
    status: 'PENDING',
    description: '',
    totalAmount: '',
    raisedAmount: '',
    targetDate: '',
  })
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    fetchProject()
  }, [params.id])

  const fetchProject = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/projects/${params.id}`)
      if (!response.ok) {
        throw new Error('Project not found')
      }
      const data = await response.json()
      const projectData = data.project as Project
      setProject(projectData)
      
      if (projectData.canEdit) {
        setFormData({
          name: projectData.name,
          companyFullName: projectData.companyFullName || '',
          industry: projectData.industry || '',
          companyPosition: projectData.companyPosition || '',
          mainProducts: projectData.mainProducts || '',
          coreAdvantage: projectData.coreAdvantage || '',
          coreTeam: projectData.coreTeam || '',
          competitors: projectData.competitors || '',
          financialData: projectData.financialData ? JSON.stringify(projectData.financialData, null, 2) : '',
          orderProgress: projectData.orderProgress || '',
          financingPlan: projectData.financingPlan || '',
          financingRound: projectData.financingRound || '',
          followStage: projectData.followStage,
          status: projectData.status,
          description: projectData.description || '',
          totalAmount: projectData.totalAmount.toString(),
          raisedAmount: projectData.raisedAmount.toString(),
          targetDate: new Date(projectData.targetDate).toISOString().split('T')[0],
        })
      }
    } catch (error) {
      console.error('Failed to fetch project:', error)
    }
    setLoading(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!formData.name || !formData.totalAmount) {
      setError('项目名称和融资金额是必填项')
      return
    }

    setIsSubmitting(true)

    try {
      let parsedFinancialData = null
      if (formData.financialData?.trim()) {
        try {
          parsedFinancialData = JSON.parse(formData.financialData)
        } catch {
          parsedFinancialData = formData.financialData
        }
      }

      const data = {
        ...formData,
        totalAmount: parseFloat(formData.totalAmount),
        raisedAmount: parseFloat(formData.raisedAmount) || 0,
        financialData: parsedFinancialData,
        targetDate: formData.targetDate ? new Date(formData.targetDate).toISOString() : undefined,
      }

      const response = await fetch(`/api/projects/${params.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const result = await response.json()
        setError(result.error || '更新项目失败')
        setIsSubmitting(false)
        return
      }

      router.push(`/projects/${params.id}`)
    } catch (error) {
      setError('更新项目失败')
      setIsSubmitting(false)
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  if (!project || !project.canEdit) {
    return (
      <DashboardLayout title="编辑项目">
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-danger-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-danger-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">无权编辑该项目</h3>
            <Link href={`/projects/${params.id}`} className="text-primary-600 hover:text-primary-700 mt-2 inline-block">
              返回项目详情
            </Link>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout
      title="编辑项目"
      subtitle={project.name}
      actions={
        <Link
          href={`/projects/${params.id}`}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-primary-200 text-gray-700 rounded-xl hover:bg-primary-50 hover:border-primary-300 transition-all-smooth text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          返回详情
        </Link>
      }
    >
      <div className="max-w-4xl mx-auto">
        <form onSubmit={handleSubmit} className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100 space-y-6">
          {error && (
            <div className="flex items-center gap-3 px-4 py-3 bg-danger-50 border border-danger-200 rounded-xl">
              <svg className="w-5 h-5 text-danger-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-sm text-danger-700">{error}</span>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-1 h-4 bg-gradient-to-b from-primary-400 to-primary-600 rounded-full"></span>
              基本信息
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="name" className={labelClass}>
                  项目名称 <span className="text-danger-500">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className={inputClass}
                  placeholder="请输入项目名称"
                />
              </div>

              <div>
                <label htmlFor="companyFullName" className={labelClass}>
                  公司全称
                </label>
                <input
                  id="companyFullName"
                  type="text"
                  value={formData.companyFullName}
                  onChange={(e) => setFormData(prev => ({ ...prev, companyFullName: e.target.value }))}
                  className={inputClass}
                  placeholder="请输入公司全称"
                />
              </div>

              <div>
                <label htmlFor="industry" className={labelClass}>
                  所处行业
                </label>
                <input
                  id="industry"
                  type="text"
                  value={formData.industry}
                  onChange={(e) => setFormData(prev => ({ ...prev, industry: e.target.value }))}
                  className={inputClass}
                  placeholder="请输入行业"
                />
              </div>

              <div>
                <label htmlFor="companyPosition" className={labelClass}>
                  公司定位
                </label>
                <input
                  id="companyPosition"
                  type="text"
                  value={formData.companyPosition}
                  onChange={(e) => setFormData(prev => ({ ...prev, companyPosition: e.target.value }))}
                  className={inputClass}
                  placeholder="请输入公司定位"
                />
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-1 h-4 bg-gradient-to-b from-primary-400 to-primary-600 rounded-full"></span>
              融资信息
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="financingRound" className={labelClass}>
                  融资轮次
                </label>
                <select
                  id="financingRound"
                  value={formData.financingRound}
                  onChange={(e) => setFormData(prev => ({ ...prev, financingRound: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">请选择融资轮次</option>
                  <option value="天使轮">天使轮</option>
                  <option value="Pre-A轮">Pre-A轮</option>
                  <option value="A轮">A轮</option>
                  <option value="A+轮">A+轮</option>
                  <option value="B轮">B轮</option>
                  <option value="C轮">C轮</option>
                  <option value="D轮">D轮</option>
                  <option value="E轮">E轮</option>
                  <option value="Pre-IPO">Pre-IPO</option>
                  <option value="战略融资">战略融资</option>
                  <option value="其他">其他</option>
                </select>
              </div>

              <div>
                <label htmlFor="totalAmount" className={labelClass}>
                  融资金额（万元） <span className="text-danger-500">*</span>
                </label>
                <input
                  id="totalAmount"
                  type="number"
                  value={formData.totalAmount}
                  onChange={(e) => setFormData(prev => ({ ...prev, totalAmount: e.target.value }))}
                  className={inputClass}
                  placeholder="本轮融资金额"
                />
              </div>

              <div>
                <label htmlFor="raisedAmount" className={labelClass}>
                  历史累计融资金额（万元）
                </label>
                <input
                  id="raisedAmount"
                  type="number"
                  value={formData.raisedAmount}
                  onChange={(e) => setFormData(prev => ({ ...prev, raisedAmount: e.target.value }))}
                  className={inputClass}
                  placeholder="历史累计融资金额"
                />
              </div>

              <div>
                <label htmlFor="targetDate" className={labelClass}>
                  目标日期
                </label>
                <input
                  id="targetDate"
                  type="date"
                  value={formData.targetDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, targetDate: e.target.value }))}
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="followStage" className={labelClass}>
                  跟进阶段
                </label>
                <select
                  id="followStage"
                  value={formData.followStage}
                  onChange={(e) => setFormData(prev => ({ ...prev, followStage: e.target.value as FollowStage }))}
                  className={inputClass}
                >
                  {Object.entries(followStageLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="status" className={labelClass}>
                  状态
                </label>
                <select
                  id="status"
                  value={formData.status}
                  onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value }))}
                  className={inputClass}
                >
                  <option value="PENDING">待审核</option>
                  <option value="ACTIVE">进行中</option>
                  <option value="COMPLETED">已完成</option>
                  <option value="CANCELLED">已取消</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-1 h-4 bg-gradient-to-b from-primary-400 to-primary-600 rounded-full"></span>
              详细信息
            </h3>
            <div className="space-y-6">
              <div>
                <label htmlFor="mainProducts" className={labelClass}>
                  主要产品
                </label>
                <textarea
                  id="mainProducts"
                  value={formData.mainProducts}
                  onChange={(e) => setFormData(prev => ({ ...prev, mainProducts: e.target.value }))}
                  className={`${inputClass} resize-none`}
                  rows={3}
                  placeholder="请输入主要产品"
                />
              </div>

              <div>
                <label htmlFor="coreAdvantage" className={labelClass}>
                  核心优势
                </label>
                <textarea
                  id="coreAdvantage"
                  value={formData.coreAdvantage}
                  onChange={(e) => setFormData(prev => ({ ...prev, coreAdvantage: e.target.value }))}
                  className={`${inputClass} resize-none`}
                  rows={3}
                  placeholder="请输入核心优势（技术壁垒、团队背景、资源优势等）"
                />
              </div>

              <div>
                <label htmlFor="financialData" className={labelClass}>
                  财务数据（JSON格式）
                </label>
                <textarea
                  id="financialData"
                  value={formData.financialData}
                  onChange={(e) => setFormData(prev => ({ ...prev, financialData: e.target.value }))}
                  className={`${inputClass} resize-none font-mono text-sm`}
                  rows={3}
                  placeholder='{"营收": "1000万", "净利润": "200万"}'
                />
              </div>

              <div>
                <label htmlFor="orderProgress" className={labelClass}>
                  订单进展
                </label>
                <textarea
                  id="orderProgress"
                  value={formData.orderProgress}
                  onChange={(e) => setFormData(prev => ({ ...prev, orderProgress: e.target.value }))}
                  className={`${inputClass} resize-none`}
                  rows={3}
                  placeholder="请输入订单进展"
                />
              </div>

              <div>
                <label htmlFor="coreTeam" className={labelClass}>
                  核心团队
                </label>
                <textarea
                  id="coreTeam"
                  value={formData.coreTeam}
                  onChange={(e) => setFormData(prev => ({ ...prev, coreTeam: e.target.value }))}
                  className={`${inputClass} resize-none`}
                  rows={3}
                  placeholder="请输入核心团队成员介绍（创始人、高管等背景信息）"
                />
              </div>

              <div>
                <label htmlFor="competitors" className={labelClass}>
                  竞争对手
                </label>
                <textarea
                  id="competitors"
                  value={formData.competitors}
                  onChange={(e) => setFormData(prev => ({ ...prev, competitors: e.target.value }))}
                  className={`${inputClass} resize-none`}
                  rows={3}
                  placeholder="请输入主要竞争对手（可一行一个，便于 AI 检索分析）"
                />
              </div>

              <div>
                <label htmlFor="financingPlan" className={labelClass}>
                  融资规划
                </label>
                <textarea
                  id="financingPlan"
                  value={formData.financingPlan}
                  onChange={(e) => setFormData(prev => ({ ...prev, financingPlan: e.target.value }))}
                  className={`${inputClass} resize-none`}
                  rows={3}
                  placeholder="请输入融资规划"
                />
              </div>

              <div>
                <label htmlFor="description" className={labelClass}>
                  项目描述
                </label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className={`${inputClass} resize-none`}
                  rows={3}
                  placeholder="请输入项目描述"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-primary-100">
            <Link
              href={`/projects/${params.id}`}
              className="px-5 py-2.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-all-smooth text-sm font-medium"
            >
              取消
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 transition-all-smooth disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-primary-500/30 text-sm font-medium"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  保存中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  保存修改
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  )
}
