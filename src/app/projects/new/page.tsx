'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/DashboardLayout'
import RichTextEditor from '@/components/RichTextEditor'
import { followStageLabels, type FollowStage } from '../types'

// 行业预设选项（支持下拉选择 + 自定义输入）
const INDUSTRY_OPTIONS = [
  'AI应用',
  'AI硬件',
  'AI基础设施',
  '具身智能',
  '商业航天',
  '量子计算',
  '脑机接口',
  '可控核聚变',
  '半导体设备',
  '半导体芯片',
  '光学',
  '新材料',
]

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
  description: string
  totalAmount: string
  raisedAmount: string
  investmentValuation: string
  targetDate: string
}

interface DuplicateWarning {
  id: string
  name: string
  companyFullName: string | null
  createdById: string
  createdByName: string
  createdAt: string
  protectionExpiresAt: string | null
  isProtected: boolean // true = 3个月保护期内，需审批；false = 已过期，可直接接手
}

interface LeadMatch {
  id: string
  name: string
  industry: string | null
  companyPosition: string | null
  mainProducts: string | null
  financingHistory: string | null
  description: string | null
  similarity: number
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
    coreAdvantage: '',
    coreTeam: '',
    competitors: '',
    financialData: '',
    orderProgress: '',
    financingPlan: '',
    financingRound: '',
    followStage: 'INITIAL_TALK',
    description: '',
    totalAmount: '',
    raisedAmount: '',
    investmentValuation: '',
    targetDate: '',
  })
  const [weeklyReport, setWeeklyReport] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateWarning | null>(null)
  const [confirmedDuplicate, setConfirmedDuplicate] = useState(false)
  const [leadMatch, setLeadMatch] = useState<LeadMatch | null>(null)
  // 接手相关状态
  const [takeoverLoading, setTakeoverLoading] = useState(false)
  const [takeoverComment, setTakeoverComment] = useState('')
  const [takeoverResult, setTakeoverResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    setFormData(prev => ({ ...prev, targetDate: today }))
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated') {
      window.location.href = '/auth/login?callbackUrl=/projects/new'
    }
  }, [status])

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

    // 融资轮次（自然语言）
    if (!parsedData.financingRound) {
      const roundMatch = trimmed.match(/(天使轮|Pre-A轮|Pre-A|A\+轮|A轮|A1轮|B轮|C轮|D轮|E轮|Pre-IPO|战略融资)/)
      if (roundMatch) {
        let round = roundMatch[1]
        // 规范化格式
        if (round === 'Pre-A') round = 'Pre-A轮'
        parsedData.financingRound = round
      }
    }

    // 目标金额（优先从融资计划中提取，避免"订单XXX万"被误匹配）
    // 保留用户原始单位（万/亿），不做转换
    if (!parsedData.totalAmount) {
      const planSource = parsedData.financingPlan || ''
      if (planSource) {
        const wanMatch = planSource.match(/(\d+(?:\.\d+)?)\s*万/)
        if (wanMatch) {
          parsedData.totalAmount = `${wanMatch[1]}万`
        }
        if (!parsedData.totalAmount) {
          const yiMatch = planSource.match(/(\d+(?:\.\d+)?)\s*亿/)
          if (yiMatch) {
            parsedData.totalAmount = `${yiMatch[1]}亿`
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
            parsedData.totalAmount = `${wanMatch[1]}万`
          }
        }

        if (!parsedData.totalAmount) {
          const yiMatch = trimmed.match(/(?:融资|融|金额|投资|估值|拟融|计划融|希望融|寻求融)?(\d+(?:\.\d+)?)\s*亿/)
          if (yiMatch) {
            parsedData.totalAmount = `${yiMatch[1]}亿`
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

  const checkLeadMatch = async (name: string) => {
    if (!name.trim()) {
      setLeadMatch(null)
      return
    }
    try {
      const response = await fetch(`/api/project-leads/match?name=${encodeURIComponent(name)}`)
      const data = await response.json()
      if (data.matches && data.matches.length > 0) {
        const best = data.matches[0]
        setLeadMatch({
          id: best.lead.id,
          name: best.lead.name,
          industry: best.lead.industry,
          companyPosition: best.lead.companyPosition,
          mainProducts: best.lead.mainProducts,
          financingHistory: best.lead.financingHistory,
          description: best.lead.description,
          similarity: best.similarity,
        })
      } else {
        setLeadMatch(null)
      }
    } catch (error) {
      console.error('Failed to check lead match:', error)
      setLeadMatch(null)
    }
  }

  useEffect(() => {
    if (formData.name) {
      const timer = setTimeout(() => {
        checkDuplicate()
        checkLeadMatch(formData.name)
      }, 500)
      return () => clearTimeout(timer)
    } else {
      setDuplicateWarning(null)
      setLeadMatch(null)
    }
  }, [formData.name])

  if (status === 'loading' || status === 'unauthenticated') {
    return (
      <DashboardLayout title="新建项目">
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // 必填项校验：项目名称、融资金额、所处行业、公司定位、投资估值
    if (!formData.name || !formData.totalAmount) {
      setError('项目名称和融资金额是必填项')
      return
    }
    if (!formData.industry.trim()) {
      setError('所处行业是必填项')
      return
    }
    if (!formData.companyPosition.trim()) {
      setError('公司定位是必填项')
      return
    }
    if (!formData.investmentValuation || isNaN(parseFloat(formData.investmentValuation))) {
      setError('投资估值是必填项，请输入有效数字')
      return
    }

    // 如果检测到同名项目，禁止创建（必须接手或改名）
    if (duplicateWarning) {
      setError('项目名称已存在，不允许重复创建。请修改名称，或点击下方"接手项目"按钮申请接手。')
      return
    }

    setLoading(true)

    try {
      // financialData 现在是 HTML 字符串（来自 RichTextEditor），直接传递
      // 兼容旧数据：如果内容不是 HTML 且能解析为 JSON，则保持字符串形式
      const data = {
        ...formData,
        totalAmount: formData.totalAmount.trim(),
        raisedAmount: formData.raisedAmount.trim(),  // 字符串，用户自填单位
        investmentValuation: parseFloat(formData.investmentValuation),
        financialData: formData.financialData || null,  // HTML 字符串
        targetDate: formData.targetDate ? new Date(formData.targetDate).toISOString() : undefined,
      }

      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      // 安全解析 JSON：防止 API 返回 HTML（如 dev server 编译错误页面）导致 JSON 解析失败
      const contentType = response.headers.get('content-type') || ''
      let result: any = null
      if (contentType.includes('application/json')) {
        try {
          result = await response.json()
        } catch {
          setError('服务器返回了无效的响应，请刷新页面后重试')
          setLoading(false)
          return
        }
      } else {
        // API 返回了非 JSON 响应（如 HTML 错误页面），通常是 dev server 编译错误或缓存问题
        setError('服务器返回了非预期的响应，请重启开发服务器后重试')
        setLoading(false)
        return
      }

      if (!response.ok) {
        if (response.status === 409) {
          setDuplicateWarning(result.existingProject)
          setConfirmedDuplicate(false)
          setError('项目名称已存在，不允许重复创建。请修改名称，或点击下方"接手项目"按钮申请接手。')
        } else {
          setError(result.detail || result.error || '创建项目失败')
        }
        setLoading(false)
        return
      }

      if (result.mergedLead) {
        alert(`已自动合并项目线索「${result.mergedLead.name}」的信息，该线索已删除。`)
      }
      router.push(`/projects/${result.project.id}`)
    } catch (error) {
      console.error('Create project error:', error)
      setError(error instanceof Error ? error.message : '创建项目失败，请检查网络连接')
      setLoading(false)
    }
  }

  // 处理接手项目
  const handleTakeover = async () => {
    if (!duplicateWarning) return
    setTakeoverLoading(true)
    setTakeoverResult(null)
    try {
      const response = await fetch(`/api/projects/${duplicateWarning.id}/takeover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: takeoverComment }),
      })
      const result = await response.json()
      if (!response.ok) {
        setTakeoverResult({ success: false, message: result.error || '接手失败' })
      } else {
        setTakeoverResult({ success: true, message: result.message })
        // 接手成功后跳转到项目详情页
        if (result.needApproval === false) {
          // 保护期外，直接接手成功，跳转到项目详情
          setTimeout(() => router.push(`/projects/${duplicateWarning.id}`), 1500)
        }
      }
    } catch (error) {
      setTakeoverResult({
        success: false,
        message: error instanceof Error ? error.message : '接手失败，请检查网络连接',
      })
    }
    setTakeoverLoading(false)
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

        {/* 重复检测提示 + 接手项目 */}
        {duplicateWarning && (
          <div className="rounded-2xl p-5 border bg-warning-50 border-warning-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-warning-100">
                <svg className="w-5 h-5 text-warning-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-gray-900">项目名称已存在，不允许重复创建</h3>
                <p className="text-sm text-gray-600 mt-1">
                  数据库中已存在名为「{duplicateWarning.name}」的项目
                  {duplicateWarning.companyFullName && `（${duplicateWarning.companyFullName}）`}
                </p>

                {/* 已有项目信息 */}
                <div className="mt-3 p-3 bg-white/60 rounded-lg border border-warning-200">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">当前维护人：</span>
                      <span className="font-medium text-gray-900">{duplicateWarning.createdByName}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">创建时间：</span>
                      <span className="font-medium text-gray-900">
                        {new Date(duplicateWarning.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-gray-500">保护期状态：</span>
                      {duplicateWarning.isProtected ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-warning-100 text-warning-700 text-xs font-medium">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          保护期内（需原维护人审批）
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success-100 text-success-700 text-xs font-medium">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          保护期已过期（可直接接手）
                        </span>
                      )}
                      {duplicateWarning.protectionExpiresAt && (
                        <span className="text-gray-500 text-xs ml-2">
                          到期时间：{new Date(duplicateWarning.protectionExpiresAt).toLocaleDateString('zh-CN')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 接手留言输入 */}
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {duplicateWarning.isProtected ? '接手申请留言（可选）' : '接手说明（可选）'}
                  </label>
                  <textarea
                    value={takeoverComment}
                    onChange={e => setTakeoverComment(e.target.value)}
                    placeholder={duplicateWarning.isProtected ? '请简要说明您希望接手该项目的原因...' : '请简要说明接手原因...'}
                    className="w-full px-3 py-2 bg-white/80 border border-warning-200 rounded-lg text-sm focus:ring-2 focus:ring-warning-400 focus:border-warning-400 transition-all-smooth"
                    rows={2}
                    disabled={takeoverLoading || !!takeoverResult?.success}
                  />
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-3 mt-3">
                  <button
                    onClick={handleTakeover}
                    disabled={takeoverLoading || !!takeoverResult?.success}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-lg text-sm font-medium hover:from-primary-600 hover:to-primary-700 transition-all-smooth shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {takeoverLoading ? (
                      <>
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        处理中...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                        {duplicateWarning.isProtected ? '申请接手项目' : '直接接手项目'}
                      </>
                    )}
                  </button>
                  <Link
                    href={`/projects/${duplicateWarning.id}`}
                    className="text-primary-600 hover:text-primary-700 text-sm font-medium"
                  >
                    查看已有项目
                  </Link>
                </div>

                {/* 接手结果提示 */}
                {takeoverResult && (
                  <div className={`mt-3 p-3 rounded-lg text-sm ${
                    takeoverResult.success
                      ? 'bg-success-50 text-success-700 border border-success-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    <div className="flex items-start gap-2">
                      {takeoverResult.success ? (
                        <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      )}
                      <span>{takeoverResult.message}</span>
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-500 mt-3">
                  说明：项目名称相同的项目不允许重复创建。您可以选择修改项目名称，或通过"接手项目"功能成为该项目的新维护人。
                  {duplicateWarning.isProtected
                    ? '当前项目处于3个月保护期内，接手需经原维护人审批同意。'
                    : '当前项目已过保护期，可直接接手，无需审批。'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 项目线索重合提示 */}
        {leadMatch && !duplicateWarning && (
          <div className="rounded-2xl p-5 border bg-primary-50 border-primary-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary-100">
                <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-gray-900">匹配到项目线索</h3>
                <p className="text-sm text-gray-600 mt-1">
                  项目名称与线索「<span className="font-medium text-primary-700">{leadMatch.name}</span>」高度重合（相似度 {Math.round(leadMatch.similarity * 100)}%）。提交后将自动合并线索信息到本项目，并删除该线索。
                </p>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  {leadMatch.industry && (
                    <div className="bg-white/60 rounded-lg px-3 py-1.5">
                      <span className="text-gray-400 text-xs">行业：</span>
                      <span className="text-gray-900">{leadMatch.industry}</span>
                    </div>
                  )}
                  {leadMatch.companyPosition && (
                    <div className="bg-white/60 rounded-lg px-3 py-1.5">
                      <span className="text-gray-400 text-xs">定位：</span>
                      <span className="text-gray-900">{leadMatch.companyPosition}</span>
                    </div>
                  )}
                  {leadMatch.mainProducts && (
                    <div className="bg-white/60 rounded-lg px-3 py-1.5">
                      <span className="text-gray-400 text-xs">主要产品：</span>
                      <span className="text-gray-900 truncate">{leadMatch.mainProducts}</span>
                    </div>
                  )}
                  {leadMatch.financingHistory && (
                    <div className="bg-white/60 rounded-lg px-3 py-1.5">
                      <span className="text-gray-400 text-xs">融资经历：</span>
                      <span className="text-gray-900 truncate">{leadMatch.financingHistory}</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  提示：仅合并你未填写的字段，已填写内容不会被覆盖。
                </p>
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
                  所处行业 <span className="text-danger-500">*</span>
                </label>
                <input
                  id="industry"
                  type="text"
                  list="industry-options"
                  value={formData.industry}
                  onChange={(e) => setFormData(prev => ({ ...prev, industry: e.target.value }))}
                  className={inputClass}
                  placeholder="请选择或输入行业"
                />
                <datalist id="industry-options">
                  {INDUSTRY_OPTIONS.map(opt => (
                    <option key={opt} value={opt} />
                  ))}
                </datalist>
              </div>

              <div>
                <label htmlFor="companyPosition" className={labelClass}>
                  公司定位 <span className="text-danger-500">*</span>
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
                  融资金额 <span className="text-danger-500">*</span>
                </label>
                <input
                  id="totalAmount"
                  type="text"
                  value={formData.totalAmount}
                  onChange={(e) => setFormData(prev => ({ ...prev, totalAmount: e.target.value }))}
                  className={inputClass}
                  placeholder="如 500万 / 2亿"
                />
              </div>

              <div>
                <label htmlFor="investmentValuation" className={labelClass}>
                  投资估值（亿元） <span className="text-danger-500">*</span>
                </label>
                <input
                  id="investmentValuation"
                  type="number"
                  step="0.01"
                  value={formData.investmentValuation}
                  onChange={(e) => setFormData(prev => ({ ...prev, investmentValuation: e.target.value }))}
                  className={inputClass}
                  placeholder="请输入投资估值（亿元）"
                  required
                />
              </div>

              <div>
                <label htmlFor="raisedAmount" className={labelClass}>
                  历史累计融资金额
                </label>
                <input
                  id="raisedAmount"
                  type="text"
                  value={formData.raisedAmount}
                  onChange={(e) => setFormData(prev => ({ ...prev, raisedAmount: e.target.value }))}
                  className={inputClass}
                  placeholder="如 500万 / 2亿（请输入单位）"
                />
              </div>

              <div>
                <label htmlFor="targetDate" className={labelClass}>
                  初聊日期
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
                <RichTextEditor
                  value={formData.mainProducts}
                  onChange={(html) => setFormData(prev => ({ ...prev, mainProducts: html }))}
                  placeholder="请输入主要产品，可粘贴截图"
                  rows={3}
                />
              </div>

              <div>
                <label htmlFor="coreAdvantage" className={labelClass}>
                  核心优势
                </label>
                <RichTextEditor
                  value={formData.coreAdvantage}
                  onChange={(html) => setFormData(prev => ({ ...prev, coreAdvantage: html }))}
                  placeholder="请输入核心优势（技术壁垒、团队背景、资源优势等），可粘贴截图"
                  rows={3}
                />
              </div>

              <div>
                <label htmlFor="coreTeam" className={labelClass}>
                  核心团队
                </label>
                <RichTextEditor
                  value={formData.coreTeam}
                  onChange={(html) => setFormData(prev => ({ ...prev, coreTeam: html }))}
                  placeholder="请输入核心团队成员介绍（创始人、高管等背景信息），可粘贴截图"
                  rows={3}
                />
              </div>

              <div>
                <label htmlFor="financialData" className={labelClass}>
                  财务数据
                </label>
                <RichTextEditor
                  value={formData.financialData}
                  onChange={(html) => setFormData(prev => ({ ...prev, financialData: html }))}
                  placeholder="请输入财务数据，可粘贴截图"
                  rows={3}
                />
              </div>

              <div>
                <label htmlFor="orderProgress" className={labelClass}>
                  订单进展
                </label>
                <RichTextEditor
                  value={formData.orderProgress}
                  onChange={(html) => setFormData(prev => ({ ...prev, orderProgress: html }))}
                  placeholder="请输入订单进展，可粘贴截图"
                  rows={3}
                />
              </div>

              <div>
                <label htmlFor="competitors" className={labelClass}>
                  竞争对手
                </label>
                <RichTextEditor
                  value={formData.competitors}
                  onChange={(html) => setFormData(prev => ({ ...prev, competitors: html }))}
                  placeholder="请输入主要竞争对手（可一行一个，便于 AI 检索分析），可粘贴截图"
                  rows={3}
                />
              </div>

              <div>
                <label htmlFor="financingPlan" className={labelClass}>
                  融资规划
                </label>
                <RichTextEditor
                  value={formData.financingPlan}
                  onChange={(html) => setFormData(prev => ({ ...prev, financingPlan: html }))}
                  placeholder="请输入融资规划，可粘贴截图"
                  rows={3}
                />
              </div>

              <div>
                <label htmlFor="description" className={labelClass}>
                  项目描述
                </label>
                <RichTextEditor
                  value={formData.description}
                  onChange={(html) => setFormData(prev => ({ ...prev, description: html }))}
                  placeholder="请输入项目描述，可粘贴截图"
                  rows={3}
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
              disabled={loading || !!duplicateWarning}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 transition-all-smooth disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-primary-500/30 text-sm font-medium"
              title={duplicateWarning ? '项目名称已存在，请修改名称或接手已有项目' : ''}
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  创建中...
                </>
              ) : duplicateWarning ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  名称已存在，无法创建
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
