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
  const { status } = useSession()

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

  useEffect(() => {
    if (status === 'unauthenticated') {
      window.location.href = '/auth/login?callbackUrl=/projects/new'
    }
  }, [status])

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <DashboardLayout title="新建项目">
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  const parseWeeklyReport = () => {
    if (!weeklyReport) return

    const parsedData: Partial<FormData> = {}
    const trimmed = weeklyReport.trim()

    // ========== 1. 标签格式解析（优先匹配）==========

    const nameMatch = trimmed.match(/项目名称[：:]\s*(.+)/)
    if (nameMatch) parsedData.name = nameMatch[1].trim()

    const companyMatch = trimmed.match(/公司全称[：:]\s*(.+)/)
    if (companyMatch) parsedData.companyFullName = companyMatch[1].trim()

    const industryMatch = trimmed.match(/行业[：:]\s*(.+)/)
    if (industryMatch) parsedData.industry = industryMatch[1].trim()

    const positionMatch = trimmed.match(/定位[：:]\s*(.+)/)
    if (positionMatch) parsedData.companyPosition = positionMatch[1].trim()

    const productMatch = trimmed.match(/(?:主要)?产品[：:]\s*(.+)/)
    if (productMatch) parsedData.mainProducts = productMatch[1].trim()

    const financeMatch = trimmed.match(/财务[：:]\s*([\s\S]*?)(?=\n|$)/)
    if (financeMatch) parsedData.financialData = financeMatch[1].trim()

    const orderMatch = trimmed.match(/订单[：:]\s*(.+)/)
    if (orderMatch) parsedData.orderProgress = orderMatch[1].trim()

    const planMatch = trimmed.match(/融资(?:计划)?[：:]\s*(.+)/)
    if (planMatch) parsedData.financingPlan = planMatch[1].trim()

    // ========== 2. 自然语言格式解析（当标签格式未匹配时）==========

    // 项目名称（自然语言）
    if (!parsedData.name) {
      // 模式1: "公司名=定位描述"（用等号分隔，常见于周报简写）
      const equalMatch = trimmed.match(/^([^=，,。：:\n]+)=([^，,。]+)/)
      if (equalMatch) {
        parsedData.name = equalMatch[1].trim()
        if (!parsedData.companyPosition) {
          parsedData.companyPosition = equalMatch[2].trim()
        }
      }

      // 模式2: "XXX是一家..." / "XXX主营..." - 提取主语作为公司名
      if (!parsedData.name) {
        const subjMatch = trimmed.match(/^([^\s，,。：:=\n]+?)(?:是|主营|专注|致力|打造|推出)/)
        if (subjMatch) {
          parsedData.name = subjMatch[1].trim()
        }
      }

      // 模式3: 以"XXX公司"/"XXX科技"/"XXX智能"等后缀结尾的名称
      if (!parsedData.name) {
        const suffixMatch = trimmed.match(/^([^\s，,。：:=\n]+?(?:公司|科技|集团|实验室|研究院|智能|技术|网络|生物|医疗|能源|半导体|机器人))(?:[，,。是]|$)/)
        if (suffixMatch) {
          parsedData.name = suffixMatch[1].trim()
        }
      }
    }

    // 公司定位（自然语言）
    if (!parsedData.companyPosition) {
      // "专注于XXX" / "专注XXX"
      const focusMatch = trimmed.match(/专注(?:于)?([^，,。]+)/)
      if (focusMatch) {
        parsedData.companyPosition = focusMatch[1].trim()
      }

      // "是一家XXX" / "是XXX"
      if (!parsedData.companyPosition) {
        const isMatch = trimmed.match(/(?:^|[，,。])\s*(?:是|主打|提供)\s*(?:一家|一个)?([^，,。]{4,})/)
        if (isMatch) {
          parsedData.companyPosition = isMatch[1].trim()
        }
      }
    }

    // 主要产品（自然语言）
    if (!parsedData.mainProducts) {
      // "打造的XXX机/系统/平台/模型/火箭" 等
      const productMatch2 = trimmed.match(/打造(?:的)?([^，,。]+?(?:机|系统|平台|模型|软件|硬件|产品|工具|应用|引擎|终端|设备|芯片|火箭|汽车|机器人|解决方案|服务))/)
      if (productMatch2) {
        parsedData.mainProducts = productMatch2[1].trim()
      }

      // "推出XXX"
      if (!parsedData.mainProducts) {
        const launchMatch = trimmed.match(/推出(?:了)?([^，,。]+?(?:机|系统|平台|模型|软件|硬件|产品|工具|应用|引擎|终端|设备|芯片|火箭|汽车|机器人|解决方案|服务))/)
        if (launchMatch) {
          parsedData.mainProducts = launchMatch[1].trim()
        }
      }
    }

    // 融资计划（自然语言）
    if (!parsedData.financingPlan) {
      const financeMatch2 = trimmed.match(/((?:本轮融资|本轮|融资|拟融资|计划融资|希望融资|寻求融资)[^，,。\n]*?(?:万|亿)[^，,。\n]*)/)
      if (financeMatch2) {
        parsedData.financingPlan = financeMatch2[1].trim()
      }
    }

    // 目标金额（优先从融资计划中提取，避免"订单XXX万"被误匹配）
    if (!parsedData.totalAmount) {
      const planSource = parsedData.financingPlan || ''
      if (planSource) {
        const wanMatch = planSource.match(/(\d+(?:\.\d+)?)\s*万/)
        if (wanMatch) {
          parsedData.totalAmount = wanMatch[1]
        }
        if (!parsedData.totalAmount) {
          const yiMatch = planSource.match(/(\d+(?:\.\d+)?)\s*亿/)
          if (yiMatch) {
            parsedData.totalAmount = (parseFloat(yiMatch[1]) * 10000).toString()
          }
        }
      }

      // 融资计划里没有，再从全文匹配（排除"订单"、"销售"等上下文）
      if (!parsedData.totalAmount) {
        const wanMatch = trimmed.match(/(?:融资|融|金额|投资|拟融|计划融|希望融|寻求融)?(\d+(?:\.\d+)?)\s*万/)
        if (wanMatch) {
          const matchIndex = trimmed.indexOf(wanMatch[0])
          const prefix = trimmed.substring(Math.max(0, matchIndex - 4), matchIndex)
          if (!/订单|销售|收入|营收/.test(prefix)) {
            parsedData.totalAmount = wanMatch[1]
          }
        }

        if (!parsedData.totalAmount) {
          const yiMatch = trimmed.match(/(?:融资|融|金额|投资|估值|拟融|计划融|希望融|寻求融)?(\d+(?:\.\d+)?)\s*亿/)
          if (yiMatch) {
            parsedData.totalAmount = (parseFloat(yiMatch[1]) * 10000).toString()
          }
        }
      }
    }

    // 财务数据（估值信息）
    if (!parsedData.financialData) {
      const valueMatch = trimmed.match(/估值(\d+(?:\.\d+)?)\s*([亿万])/)
      if (valueMatch) {
        parsedData.financialData = `估值${valueMatch[1]}${valueMatch[2]}`
      }

      // 创始人信息
      const founderMatch = trimmed.match(/创始人[^，,。]*/)
      if (founderMatch) {
        parsedData.financialData = (parsedData.financialData ? parsedData.financialData + '；' : '') + founderMatch[0].trim()
      }
    }

    // 行业（从关键词推断）
    if (!parsedData.industry) {
      const industryKeywords: Array<[string, string]> = [
        ['Agent', 'AI/Agent'],
        ['大模型', 'AI/大模型'],
        ['人工智能', 'AI/人工智能'],
        ['AI', 'AI/人工智能'],
        ['半导体', '半导体'],
        ['芯片', '半导体/芯片'],
        ['医疗', '医疗健康'],
        ['新能源', '新能源'],
        ['SaaS', '企业服务/SaaS'],
        ['金融科技', '金融科技'],
        ['教育', '教育'],
        ['机器人', '机器人'],
        ['记忆体', 'AI/Agent'],
      ]
      for (const [keyword, industry] of industryKeywords) {
        if (trimmed.includes(keyword)) {
          parsedData.industry = industry
          break
        }
      }
    }

    // 描述（整段文本作为描述）
    if (!parsedData.description) {
      if (trimmed.length > 50) {
        parsedData.description = trimmed
      }
    }

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
        financialData: parsedFinancialData,
        targetDate: formData.targetDate ? new Date(formData.targetDate).toISOString() : undefined,
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
          setError(result.detail || result.error || '创建项目失败')
        }
        setLoading(false)
        return
      }

      const result = await response.json()
      router.push(`/projects/${result.project.id}`)
    } catch (error) {
      console.error('Create project error:', error)
      setError(error instanceof Error ? error.message : '创建项目失败，请检查网络连接')
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
