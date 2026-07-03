'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/DashboardLayout'
import { followStageLabels, type FollowStage } from '../types'

interface FormData {
  name: string
  companyFullName: string
  industry: string
  companyPosition: string
  mainProducts: string
  financialData: string
  orderProgress: string
  financingPlan: string
  followStage: FollowStage
  status: string
  description: string
  totalAmount: string
  targetDate: string
}

interface DuplicateWarning {
  id: string
  name: string
  companyFullName: string | null
}

const inputClass = "w-full px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth placeholder-gray-400"
const labelClass = "block text-sm font-medium text-gray-700 mb-2"

export default function NewProjectPage() {
  const router = useRouter()
  const { data: session, status } = useSession()

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-primary flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!session) {
    router.push('/auth/login?callbackUrl=/projects/new')
    return null
  }

  const [formData, setFormData] = useState<FormData>({
    name: '',
    companyFullName: '',
    industry: '',
    companyPosition: '',
    mainProducts: '',
    financialData: '',
    orderProgress: '',
    financingPlan: '',
    followStage: 'INITIAL_TALK',
    status: 'PENDING',
    description: '',
    totalAmount: '',
    targetDate: '',
  })
  const [weeklyReport, setWeeklyReport] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateWarning | null>(null)
  const [confirmedDuplicate, setConfirmedDuplicate] = useState(false)

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    setFormData(prev => ({ ...prev, targetDate: today }))
  }, [])

  const parseWeeklyReport = () => {
    if (!weeklyReport) return

    const parsedData: Partial<FormData> = {}

    const nameMatch = weeklyReport.match(/项目名称[：:]\s*(.+)/)
    if (nameMatch) parsedData.name = nameMatch[1].trim()

    const companyMatch = weeklyReport.match(/公司全称[：:]\s*(.+)/)
    if (companyMatch) parsedData.companyFullName = companyMatch[1].trim()

    const industryMatch = weeklyReport.match(/行业[：:]\s*(.+)/)
    if (industryMatch) parsedData.industry = industryMatch[1].trim()

    const positionMatch = weeklyReport.match(/定位[：:]\s*(.+)/)
    if (positionMatch) parsedData.companyPosition = positionMatch[1].trim()

    const productMatch = weeklyReport.match(/产品[：:]\s*(.+)/)
    if (productMatch) parsedData.mainProducts = productMatch[1].trim()

    const financeMatch = weeklyReport.match(/财务[：:]\s*([\s\S]*?)(?=\n|$)/)
    if (financeMatch) parsedData.financialData = financeMatch[1].trim()

    const orderMatch = weeklyReport.match(/订单[：:]\s*(.+)/)
    if (orderMatch) parsedData.orderProgress = orderMatch[1].trim()

    const planMatch = weeklyReport.match(/融资[：:]\s*(.+)/)
    if (planMatch) parsedData.financingPlan = planMatch[1].trim()

    setFormData(prev => ({ ...prev, ...parsedData }))
    setWeeklyReport('')
  }

  const checkDuplicate = async () => {
    if (!formData.name) return

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formData.name, checkDuplicate: true }),
      })

      if (response.status === 409) {
        const data = await response.json()
        setDuplicateWarning(data.existingProject)
        setConfirmedDuplicate(false)
      } else {
        setDuplicateWarning(null)
      }
    } catch (error) {
      console.error('Failed to check duplicate:', error)
    }
  }

  useEffect(() => {
    if (formData.name) {
      const timer = setTimeout(checkDuplicate, 500)
      return () => clearTimeout(timer)
    } else {
      setDuplicateWarning(null)
    }
  }, [formData.name])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!formData.name || !formData.totalAmount) {
      setError('项目名称和目标金额是必填项')
      return
    }

    if (duplicateWarning && !confirmedDuplicate) {
      setError('检测到可能重复的项目，请确认后再提交')
      return
    }

    setLoading(true)

    try {
      const data = {
        ...formData,
        totalAmount: parseFloat(formData.totalAmount),
        financialData: formData.financialData ? JSON.parse(formData.financialData) : null,
      }

      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const result = await response.json()
        if (response.status === 409) {
          setDuplicateWarning(result.existingProject)
          setConfirmedDuplicate(false)
          setError('检测到重复项目')
        } else {
          setError(result.error || '创建项目失败')
        }
        setLoading(false)
        return
      }

      const result = await response.json()
      router.push(`/projects/${result.project.id}`)
    } catch (error) {
      setError('创建项目失败')
      setLoading(false)
    }
  }

  return (
    <DashboardLayout
      title="新建项目"
      subtitle="创建一个新的投资项目"
      actions={
        <Link
          href="/projects"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-primary-200 text-gray-700 rounded-xl hover:bg-primary-50 hover:border-primary-300 transition-all-smooth text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          返回列表
        </Link>
      }
    >
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 周报解析 */}
        <div className="bg-gradient-card rounded-2xl shadow-sm p-6 border border-primary-100">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            从周报读取项目信息
          </h2>
          <textarea
            placeholder="粘贴周报内容，系统将自动识别项目名称、公司全称、行业等信息..."
            value={weeklyReport}
            onChange={(e) => setWeeklyReport(e.target.value)}
            className="w-full px-4 py-3 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth resize-none placeholder-gray-400"
            rows={4}
          />
          <button
            onClick={parseWeeklyReport}
            disabled={!weeklyReport}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-primary-50 text-primary-700 rounded-xl hover:bg-primary-100 transition-all-smooth disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            解析周报
          </button>
        </div>

        {/* 重复检测提示 */}
        {duplicateWarning && (
          <div className={`rounded-2xl p-5 border ${confirmedDuplicate ? 'bg-success-50 border-success-200' : 'bg-warning-50 border-warning-200'}`}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${confirmedDuplicate ? 'bg-success-100' : 'bg-warning-100'}`}>
                <svg className={`w-5 h-5 ${confirmedDuplicate ? 'text-success-600' : 'text-warning-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-gray-900">检测到可能重复的项目</h3>
                <p className="text-sm text-gray-600 mt-1">
                  数据库中已存在名为「{duplicateWarning.name}」的项目
                  {duplicateWarning.companyFullName && `（${duplicateWarning.companyFullName}）`}
                </p>
                <div className="flex items-center gap-3 mt-3">
                  <button
                    onClick={() => setConfirmedDuplicate(!confirmedDuplicate)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all-smooth ${
                      confirmedDuplicate
                        ? 'bg-success-600 text-white'
                        : 'bg-warning-600 text-white hover:bg-warning-700'
                    }`}
                  >
                    {confirmedDuplicate ? '已确认创建重复项目' : '确认创建重复项目'}
                  </button>
                  <Link
                    href={`/projects/${duplicateWarning.id}`}
                    className="text-primary-600 hover:text-primary-700 text-sm font-medium"
                  >
                    查看已有项目
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 表单 */}
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
                <label htmlFor="totalAmount" className={labelClass}>
                  目标金额（万元） <span className="text-danger-500">*</span>
                </label>
                <input
                  id="totalAmount"
                  type="number"
                  value={formData.totalAmount}
                  onChange={(e) => setFormData(prev => ({ ...prev, totalAmount: e.target.value }))}
                  className={inputClass}
                  placeholder="请输入目标金额"
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
              href="/projects"
              className="px-5 py-2.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-all-smooth text-sm font-medium"
            >
              取消
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 transition-all-smooth disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-primary-500/30 text-sm font-medium"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  创建中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  创建项目
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  )
}
