'use client'

/**
 * 可视化报告渲染器
 *
 * 递归渲染 ResearchModule 的 aiJson / content（任意 JSON 结构）：
 * - 核心数据（金额/百分比/数量级）自动加粗 + 提亮高亮
 * - summary/conclusion 等结论性字段渲染为渐变高亮卡片
 * - 每个字段带 data-field 锚点 + 💬 提问标志，供框选提问定位
 */

import React from 'react'

// ── 常见字段中文标签（未命中则展示原 key） ──
const FIELD_LABELS: Record<string, string> = {
  summary: '核心结论',
  conclusion: '结论',
  overview: '概览',
  recommendation: '建议',
  industryStage: '行业阶段',
  trl: '技术成熟度 (TRL)',
  marketSize: '市场规模',
  growthRate: '增长率',
  productName: '产品名称',
  techRoute: '技术路线',
  differentiation: '差异化优势',
  competitors: '竞争对手',
  fundingRound: '融资轮次',
  fundingAmount: '融资金额',
  valuation: '估值',
  investors: '投资机构',
  revenue: '营收',
  profit: '利润',
  customers: '客户',
  orders: '订单',
  team: '团队',
  founder: '创始人',
  risk: '风险',
  opportunity: '机会',
  strengths: '优势',
  weaknesses: '劣势',
  financingAmount: '融资金额',
  preValuation: '投前估值',
  oldShareValuation: '老股估值',
  otherInstitutions: '其它机构进展',
  coreTerms: '核心条款',
  investmentRange: '投资金额区间',
  investmentType: '领投或跟投',
}

// ── 核心数据高亮：数字 + 单位（金额/百分比/倍数/年限等） ──
const CORE_DATA_REGEX = /(\d[\d,]*(?:\.\d+)?)\s*(亿|千万|百万|万|千|元|美元|人民币|%|‰|个百分点|个点|倍|轮|年|个月|季度|天|周|人|家|款|项|次|台|x|X)/g

/** 将文本中的核心数据渲染为高亮片段 */
function HighlightText({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let lastIdx = 0
  let match: RegExpExecArray | null
  const re = new RegExp(CORE_DATA_REGEX.source, 'g')
  let k = 0

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(<React.Fragment key={k++}>{text.slice(lastIdx, match.index)}</React.Fragment>)
    }
    parts.push(
      <mark
        key={k++}
        className="bg-gradient-to-r from-amber-100 to-amber-50 text-amber-900 font-bold px-1 py-0.5 rounded mx-0.5 border-b-2 border-amber-300 whitespace-nowrap"
      >
        {match[0]}
      </mark>
    )
    lastIdx = match.index + match[0].length
  }
  if (lastIdx < text.length) {
    parts.push(<React.Fragment key={k++}>{text.slice(lastIdx)}</React.Fragment>)
  }
  return <>{parts}</>
}

/** 字段标签展示（中文优先，fallback 原样） */
function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key]
  // camelCase / snake_case → 空格分词
  return key
    .replace(/[_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, c => c.toUpperCase())
}

/** 是否为结论性字段（渲染为高亮卡片） */
function isConclusionKey(key: string): boolean {
  return ['summary', 'conclusion', 'overview', 'recommendation', 'suggestion', 'advice'].includes(key)
}

// ── 组件 Props ──

export interface ReportViewProps {
  /** 字段标识前缀（moduleType） */
  moduleType: string
  /** 解析后的 JSON 数据 */
  data: Record<string, unknown> | null
  /** 各字段的提问数量：fieldKey → count */
  questionCounts?: Record<string, number>
  /** 点击字段提问标志回调 */
  onQuestionMarkerClick?: (fieldKey: string) => void
}

interface FieldProps extends ReportViewProps {
  fieldKey: string
  label: string
}

/** 字段提问标志 💬 */
function QuestionMarker({ fieldKey, count, onClick }: { fieldKey: string; count: number; onClick?: () => void }) {
  if (count <= 0) return null
  return (
    <button
      onClick={onClick}
      title={`该字段有 ${count} 个提问`}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors text-xs font-medium flex-shrink-0"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
      {count}
    </button>
  )
}

/** 标题行（含提问标志） */
function FieldHeader({ fieldKey, label, questionCounts, onQuestionMarkerClick, moduleType }: FieldProps) {
  const count = questionCounts?.[`${moduleType}.${fieldKey}`] ?? questionCounts?.[fieldKey] ?? 0
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      <QuestionMarker
        fieldKey={fieldKey}
        count={count}
        onClick={() => onQuestionMarkerClick?.(fieldKey)}
      />
    </div>
  )
}

/** 长文本段落（含核心数据高亮） */
function Paragraph({ text, className = '' }: { text: string; className?: string }) {
  const paragraphs = text.split(/\n+/).filter(Boolean)
  return (
    <div className={`space-y-1.5 ${className}`}>
      {paragraphs.map((p, i) => (
        <p key={i} className="text-sm text-gray-700 leading-relaxed">
          <HighlightText text={p} />
        </p>
      ))}
    </div>
  )
}

/** 单个字段值渲染 */
function ValueRenderer(props: FieldProps & { value: unknown }) {
  const { value, fieldKey, label, moduleType, questionCounts, onQuestionMarkerClick } = props

  // 结论性字段 → 渐变高亮卡片
  if (isConclusionKey(fieldKey) && typeof value === 'string') {
    return (
      <div
        data-field={fieldKey}
        className="relative rounded-xl bg-gradient-to-br from-primary-50 via-blue-50 to-indigo-50 border border-primary-200 p-4 select-text"
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
          <span className="text-xs font-bold text-primary-700 uppercase tracking-wider">{label}</span>
          <QuestionMarker fieldKey={fieldKey} count={questionCounts?.[`${moduleType}.${fieldKey}`] ?? questionCounts?.[fieldKey] ?? 0} onClick={() => onQuestionMarkerClick?.(fieldKey)} />
        </div>
        <div className="text-sm text-gray-800 font-medium leading-relaxed">
          <HighlightText text={value} />
        </div>
      </div>
    )
  }

  // 字符串
  if (typeof value === 'string') {
    // 纯短文本 → 行内展示
    if (value.length <= 30 && !value.includes('\n')) {
      return (
        <div data-field={fieldKey}>
          <FieldHeader {...props} />
          <p className="text-sm font-semibold text-gray-900 bg-gray-50 rounded-lg px-3 py-2 inline-block select-text">
            <HighlightText text={value} />
          </p>
        </div>
      )
    }
    return (
      <div data-field={fieldKey}>
        <FieldHeader {...props} />
        <div className="bg-white rounded-lg px-3 py-2 border border-gray-100 select-text">
          <Paragraph text={value} />
        </div>
      </div>
    )
  }

  // 数字
  if (typeof value === 'number') {
    return (
      <div data-field={fieldKey}>
        <FieldHeader {...props} />
        <p className="text-2xl font-extrabold text-primary-700 select-text">{value}</p>
      </div>
    )
  }

  // 布尔
  if (typeof value === 'boolean') {
    return (
      <div data-field={fieldKey}>
        <FieldHeader {...props} />
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${value ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          {value ? '是' : '否'}
        </span>
      </div>
    )
  }

  // 字符串数组 → 标签组
  if (Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string')) {
    return (
      <div data-field={fieldKey}>
        <FieldHeader {...props} />
        <div className="flex flex-wrap gap-1.5">
          {value.map((v, i) => (
            <span key={i} className="px-2.5 py-1 bg-gradient-to-r from-primary-50 to-blue-50 text-primary-800 text-xs font-medium rounded-full border border-primary-100 select-text">
              <HighlightText text={v} />
            </span>
          ))}
        </div>
      </div>
    )
  }

  // 对象数组 → 卡片列表
  if (Array.isArray(value) && value.length > 0) {
    return (
      <div data-field={fieldKey}>
        <FieldHeader {...props} />
        <div className="space-y-2">
          {value.map((item, i) => (
            <div key={i} className="rounded-xl border border-gray-100 bg-white p-3 hover:border-primary-200 transition-colors">
              {Object.entries(item as Record<string, unknown>).map(([k, v]) => {
                if (v === null || v === undefined) return null
                const text = typeof v === 'string' ? v : JSON.stringify(v)
                return (
                  <div key={k} className="flex items-start gap-2 py-1">
                    <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5 min-w-[72px]">{fieldLabel(k)}</span>
                    <span className="text-sm text-gray-800 font-medium select-text flex-1">
                      {typeof v === 'number'
                        ? <b className="text-primary-700 text-base">{v}</b>
                        : <HighlightText text={text} />}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // 嵌套对象 → 递归分组
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== null && v !== undefined && v !== ''
    )
    if (entries.length === 0) return null
    return (
      <div data-field={fieldKey} className="rounded-xl bg-gray-50/60 border border-gray-100 p-3 space-y-3">
        <FieldHeader {...props} />
        {entries.map(([k, v]) => (
          <ValueRenderer
            key={k}
            moduleType={moduleType}
            data={null}
            fieldKey={`${fieldKey}.${k}`}
            label={fieldLabel(k)}
            value={v}
            questionCounts={questionCounts}
            onQuestionMarkerClick={onQuestionMarkerClick}
          />
        ))}
      </div>
    )
  }

  return null
}

/** 报告主体 */
export default function ReportView({
  moduleType,
  data,
  questionCounts = {},
  onQuestionMarkerClick,
}: ReportViewProps) {
  if (!data || Object.keys(data).length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-400">
        暂无分析数据，请在编辑页触发 AI 分析或录入内容
      </div>
    )
  }

  const entries = Object.entries(data).filter(
    ([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
  )

  // 结论性字段置顶
  entries.sort((a, b) => {
    const aC = isConclusionKey(a[0]) ? 0 : 1
    const bC = isConclusionKey(b[0]) ? 0 : 1
    return aC - bC
  })

  return (
    <div className="space-y-4">
      {entries.map(([key, value]) => (
        <ValueRenderer
          key={key}
          moduleType={moduleType}
          data={null}
          fieldKey={key}
          label={fieldLabel(key)}
          value={value}
          questionCounts={questionCounts}
          onQuestionMarkerClick={onQuestionMarkerClick}
        />
      ))}
    </div>
  )
}
