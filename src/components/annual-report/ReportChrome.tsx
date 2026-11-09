import type { ReactNode } from 'react'
import type {
  AnnualReportData,
  AnnualReportInsights,
  ActivityStats as ActivityStatsType,
  FunnelStage,
  IndustryStat,
  KpiItem,
  MilestoneItem,
  MonthlyIndustry,
  MonthlyPoint,
  ProjectHighlight,
  QualityStats,
  ReportStage,
  FinancingItem,
} from '@/lib/annual-report/types'
import { REPORT_STAGES } from '@/lib/annual-report/types'

export const STAGE_COLORS: Record<ReportStage, string> = {
  INITIAL_TALK: '#C8A96B',
  PRE_DD: '#B7A17B',
  PROJECT_INITIATION: '#52739A',
  DUE_DILIGENCE: '#5E8F86',
  AGREEMENT: '#7D6B8F',
  CLOSING: '#B77A6B',
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function CoverPage({ data }: { data: AnnualReportData }) {
  const isPersonal = data.meta.type === 'PERSONAL'
  const closing = data.funnel.find(item => item.stage === 'CLOSING')?.entered ?? 0
  const newProjects = data.kpis.find(item => item.key === 'newProjects')?.value ?? 0
  const third = isPersonal ? data.industries.length : data.kpis.find(item => item.key === 'activeProjects')?.value ?? 0
  const thirdLabel = isPersonal ? '覆盖赛道' : '年度活跃项目'

  return (
    <section className="ar-cover" data-report-page="1">
      <div className="ar-cover-grid" />
      <div className="ar-cover-arc" />
      <div className="ar-cover-inner">
        <div className="ar-cover-top">
          <div className="ar-cover-brand">
            <div className="ar-cover-logo">泰</div>
            <div className="ar-cover-brand-text">泰亚投资 · TAIYA CAPITAL</div>
          </div>
          <div className="ar-cover-conf">CONFIDENTIAL · 内部资料</div>
        </div>

        <div className="ar-cover-main">
          <div className="ar-cover-kicker">{isPersonal ? 'MAINTAINER ANNUAL REVIEW' : 'ANNUAL INVESTMENT REPORT'}</div>
          <div className="ar-cover-year">
            {data.meta.year}
            <span>年</span>
          </div>
          <h1 className="ar-cover-title">{isPersonal ? '年度项目复盘' : '年度投资工作报告'}</h1>
          <div className="ar-cover-theme">{data.insights.theme || '年度复盘 · 赛道洞察 · 下一年度'}</div>
          <div className="ar-cover-owner">
            {isPersonal ? `${data.meta.ownerName} · 项目维护人` : '泰亚投资 · 公司年度复盘'}
          </div>
        </div>

        <div className="ar-cover-stats">
          <div className="ar-cover-stat">
            <div className="ar-cover-stat-value">{newProjects}</div>
            <div className="ar-cover-stat-label">新初聊项目 / NEW PROJECTS</div>
          </div>
          <div className="ar-cover-stat">
            <div className="ar-cover-stat-value">{closing}</div>
            <div className="ar-cover-stat-label">完成交割 / CLOSING</div>
          </div>
          <div className="ar-cover-stat">
            <div className="ar-cover-stat-value">{third}</div>
            <div className="ar-cover-stat-label">{thirdLabel} / {isPersonal ? 'SECTORS' : 'ACTIVE'}</div>
          </div>
        </div>

        <div className="ar-cover-footer">
          <span>数据截至 {data.meta.year} 年 12 月 31 日</span>
          <span>ASIA/SHANGHAI · {data.meta.pageCount} PAGES</span>
        </div>
      </div>
    </section>
  )
}

export function PageShell({
  data,
  pageNo,
  kicker,
  title,
  subtitle,
  children,
  footerNote,
}: {
  data: AnnualReportData
  pageNo: number
  kicker: string
  title: string
  subtitle?: string
  children: ReactNode
  footerNote?: string
}) {
  return (
    <section className="ar-page" data-report-page={String(pageNo)}>
      <div className="ar-page-inner">
        <header className="ar-header">
          <div>
            <div className="ar-kicker">{kicker}</div>
            <h2 className="ar-title">{title}</h2>
            {subtitle && <p className="ar-subtitle">{subtitle}</p>}
          </div>
          <div className="ar-header-mark">
            <div className="ar-mark-year">{data.meta.year}</div>
            <div className="ar-mark-label">{data.meta.type === 'PERSONAL' ? 'MAINTAINER EDITION' : 'COMPANY EDITION'}</div>
          </div>
        </header>
        <div className="ar-content">{children}</div>
        <footer className="ar-footer">
          <span>泰亚投资 · {data.meta.year} 年度报告</span>
          <span>{footerNote || '内部资料 · 请勿外传'}</span>
          <span className="ar-footer-pageno">
            {pad(pageNo)} / {pad(data.meta.pageCount)}
          </span>
        </footer>
      </div>
    </section>
  )
}

export function KpiGrid({ kpis }: { kpis: KpiItem[] }) {
  return (
    <div className="ar-kpi-grid">
      {kpis.map(kpi => {
        const yoyClass = kpi.yoy === null ? 'flat' : kpi.yoy > 0 ? 'up' : kpi.yoy < 0 ? 'down' : 'flat'
        return (
          <div key={kpi.key} className="ar-kpi">
            <div className="ar-kpi-label">{kpi.label}</div>
            <div className="ar-kpi-value">
              {kpi.value}
              {kpi.unit && <span className="ar-kpi-unit">{kpi.unit}</span>}
            </div>
            <div className="ar-kpi-foot">
              <span className={`ar-yoy ${yoyClass}`}>
                {kpi.yoy === null ? '同比 —' : `同比 ${kpi.yoy > 0 ? '+' : ''}${kpi.yoy}%`}
              </span>
              <span>{kpi.hint}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function FunnelBlock({ funnel }: { funnel: FunnelStage[] }) {
  const max = Math.max(1, ...funnel.map(item => item.entered))
  return (
    <div>
      <div className="ar-funnel">
        {funnel.map(item => (
          <div key={item.stage} className="ar-funnel-row">
            <div className="ar-funnel-stage">{item.label}</div>
            <div className="ar-funnel-track">
              <div
                className="ar-funnel-bar"
                style={{
                  width: `${Math.max(item.entered > 0 ? 2 : 0, (item.entered / max) * 100)}%`,
                  background: `linear-gradient(90deg, ${STAGE_COLORS[item.stage]} 0%, ${STAGE_COLORS[item.stage]}B8 100%)`,
                }}
              />
            </div>
            <div className="ar-funnel-count">{item.entered}</div>
            <div className="ar-funnel-meta">
              {item.conversion === null ? '起点' : `承接 ${item.conversion}%`}
            </div>
            <div className="ar-funnel-stock">
              <b>{item.stock}</b>年末存量
            </div>
          </div>
        ))}
      </div>
      <p className="ar-funnel-note">
        口径：阶段进入数 = 该年度内首次进入该阶段的项目数（同一项目不重复计数）；承接率 = 本阶段进入数 ÷ 上一阶段进入数；
        年末存量 = 截至 12 月 31 日停留在该阶段的项目数，投后项目计入交割存量。历史阶段日期缺失的项目只进入漏斗，不进入月度分布。
      </p>
    </div>
  )
}

export function MonthlyBlock({ monthly }: { monthly: MonthlyPoint[] }) {
  const max = Math.max(1, ...monthly.map(item => item.totalEntries))
  const best = monthly.reduce((top, item) => (item.totalEntries > top.totalEntries ? item : top), monthly[0])
  const total = monthly.reduce((sum, item) => sum + item.totalEntries, 0)
  const activeMonths = monthly.filter(item => item.totalEntries > 0).length
  const maxHeight = 300

  return (
    <div>
      <div className="ar-monthly-wrap">
        <div className="ar-monthly">
          {monthly.map(item => (
            <div key={item.month} className="ar-month-col">
              <div className="ar-month-total">{item.totalEntries || ''}</div>
              <div className="ar-month-stack" style={{ height: `${Math.max(item.totalEntries > 0 ? 4 : 1, (item.totalEntries / max) * maxHeight)}px` }}>
                {item.totalEntries === 0 ? (
                  <div className="ar-month-seg" style={{ height: '2px', background: 'rgba(30,42,58,0.12)' }} />
                ) : (
                  [...REPORT_STAGES].reverse().map(stage => {
                    const count = item.entries[stage]
                    if (count <= 0) return null
                    return (
                      <div
                        key={stage}
                        className="ar-month-seg"
                        style={{
                          height: `${(count / item.totalEntries) * 100}%`,
                          background: STAGE_COLORS[stage],
                        }}
                      />
                    )
                  })
                )}
              </div>
              <div className="ar-month-label">{item.month}月</div>
            </div>
          ))}
        </div>
        <div className="ar-side-stat">
          <div className="ar-side-card">
            <div className="ar-side-value">{best.totalEntries}</div>
            <div className="ar-side-label">最活跃月份 · {best.label}</div>
          </div>
          <div className="ar-side-card">
            <div className="ar-side-value">{total}</div>
            <div className="ar-side-label">全年阶段进展合计</div>
          </div>
          <div className="ar-side-card">
            <div className="ar-side-value">{activeMonths}</div>
            <div className="ar-side-label">有进展的月份数 / 12</div>
          </div>
        </div>
      </div>
      <div className="ar-legend">
        {REPORT_STAGES.map(stage => (
          <div key={stage} className="ar-legend-item">
            <span className="ar-legend-dot" style={{ background: STAGE_COLORS[stage] }} />
            {stage === 'INITIAL_TALK' ? '新初聊' : stage === 'PRE_DD' ? 'PreDD' : stage === 'PROJECT_INITIATION' ? '立项' : stage === 'DUE_DILIGENCE' ? '尽调' : stage === 'AGREEMENT' ? '协议' : '交割'}
          </div>
        ))}
      </div>
    </div>
  )
}

export function IndustryBlock({ industries }: { industries: IndustryStat[] }) {
  const top = industries.slice(0, 10)
  const max = Math.max(1, ...top.map(item => item.count))
  const top1 = industries[0]
  const top3Share = industries.slice(0, 3).reduce((sum, item) => sum + item.share, 0)
  return (
    <div>
      {top.length === 0 ? (
        <div className="ar-empty">本年度还没有可统计的行业数据。</div>
      ) : (
        <div className="ar-ind-list">
          {top.map((item, index) => (
            <div key={item.name} className="ar-ind-row">
              <div className="ar-ind-rank">{pad(index + 1)}</div>
              <div className="ar-ind-name">
                {item.name}
                {item.isNew && <span className="ar-ind-new">新</span>}
              </div>
              <div className="ar-ind-track">
                <div className="ar-ind-fill" style={{ width: `${Math.max(2, (item.count / max) * 100)}%` }} />
              </div>
              <div className="ar-ind-count">{item.count}</div>
              <div className="ar-ind-share">{item.share}%</div>
            </div>
          ))}
        </div>
      )}
      {top1 && (
        <div className="ar-conc-note">
          年度最集中的赛道是 <b>{top1.name}</b>（{top1.count} 个项目，占 {top1.share}%）；前三大赛道合计占 {Math.round(top3Share * 10) / 10}%。
          {top3Share > 65 ? '赛道集中度较高，需关注单一方向波动。' : '赛道分布相对分散，组合抗风险能力较好。'}
        </div>
      )}
    </div>
  )
}

export function HeatmapBlock({ data }: { data: MonthlyIndustry[] }) {
  // 取全年合计最高的 6 个行业做行
  const totals = new Map<string, number>()
  for (const month of data) {
    for (const item of month.industries) {
      totals.set(item.name, (totals.get(item.name) ?? 0) + item.count)
    }
  }
  const names = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name]) => name)
  const max = Math.max(
    1,
    ...data.flatMap(month => month.industries.map(item => (names.includes(item.name) ? item.count : 0)))
  )

  return (
    <div className="ar-heat-wrap">
      <div className="ar-heat">
        <div />
        {data.map(month => (
          <div key={`h-${month.month}`} className="ar-heat-head">
            {month.month}月
          </div>
        ))}
        {names.map(name => (
          <div key={name} className="ar-heat-row" style={{ display: 'contents' }}>
            <div className="ar-heat-name">{name}</div>
            {data.map(month => {
              const count = month.industries.find(item => item.name === name)?.count ?? 0
              const alpha = count === 0 ? 0 : 0.16 + 0.74 * (count / max)
              return (
                <div
                  key={`${name}-${month.month}`}
                  className={`ar-heat-cell${count === 0 ? ' empty' : ''}`}
                  style={count === 0 ? undefined : { background: `rgba(200, 169, 107, ${alpha})` }}
                >
                  {count || '·'}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className="ar-heat-legend">
        <span>低</span>
        <div className="ar-heat-scale">
          {[0.16, 0.34, 0.52, 0.7, 0.9].map(alpha => (
            <span key={alpha} style={{ background: `rgba(200, 169, 107, ${alpha})` }} />
          ))}
        </div>
        <span>高 · 单元格数字为该月该赛道活跃项目数</span>
      </div>
    </div>
  )
}

export function FocusGrid({ data }: { data: AnnualReportData }) {
  return (
    <div className="ar-focus-grid">
      {data.monthlyFocus.map(item => (
        <div key={item.month} className="ar-focus-card">
          <div className="ar-focus-month">{pad(item.month)} / {item.label}</div>
          <div className="ar-focus-name">{item.industries.join(' · ') || '暂无重点赛道'}</div>
          <div className="ar-focus-note">{item.note}</div>
        </div>
      ))}
    </div>
  )
}

export function ProjectGrid({ projects }: { projects: ProjectHighlight[] }) {
  if (projects.length === 0) {
    return <div className="ar-empty">本年度还没有可展示的重点项目。</div>
  }
  return (
    <div className="ar-project-grid">
      {projects.map(project => (
        <div key={project.id} className="ar-project-card">
          <div className="ar-project-top">
            <div>
              <div className="ar-project-name">{project.name}</div>
              <div className="ar-project-ind">{project.industry} · {project.month ? `${project.month}月初聊` : '年初已有'}</div>
            </div>
            <span className="ar-stage-badge">{project.stageLabel}</span>
          </div>
          <div className="ar-project-note">{project.note}</div>
          <div className="ar-project-foot">
            <span>融资金额 <b>{project.amount}</b></span>
            <span>{project.valuation ? `投后估值 ${project.valuation} 亿` : '估值未填'}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function progressMeta(item: FinancingItem): { label: string; className: string; body: string } {
  if (item.progressType === 'NEW_ROUND') {
    return {
      label: '新融资',
      className: 'new',
      body: [item.latestRound, item.amount, item.eventDate].filter(Boolean).join(' · ') || '检索到新的公开融资信息',
    }
  }
  if (item.progressType === 'ROUND_UP') {
    return {
      label: '同轮更新',
      className: 'new',
      body: [item.latestRound, item.amount, item.eventDate].filter(Boolean).join(' · ') || '同一轮融资出现金额/投资方更新',
    }
  }
  if (item.progressType === 'SAME_AS_DB') {
    return {
      label: '与库内一致',
      className: 'same',
      body: [item.latestRound, item.amount].filter(Boolean).join(' · ') || '公开信息与系统融资轮次一致',
    }
  }
  if (item.progressType === 'FAILED') {
    return { label: '检索失败', className: 'failed', body: '本次公开信息检索超时或失败，未纳入结论' }
  }
  return { label: '未检索到', className: 'none', body: '公开信息中未发现可核实的新融资进展' }
}

function hostOf(url: string | null): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 36)
  }
}

export function FinancingGrid({ items }: { items: FinancingItem[] }) {
  if (items.length === 0) {
    return (
      <div className="ar-empty">
        本年度进入 PreDD / 立项 / 尽调 的项目不足，或没有可核实的公开融资信息。<br />
        报告不对未检索到的信息做任何推断。
      </div>
    )
  }
  return (
    <div className="ar-fin-grid">
      {items.map(item => {
        const meta = progressMeta(item)
        return (
          <div key={item.projectId} className="ar-fin-card">
            <div className="ar-fin-top">
              <div>
                <div className="ar-fin-name">{item.projectName}</div>
                <div className="ar-fin-stage">当前阶段 · {item.stageLabel}</div>
              </div>
              <span className={`ar-fin-badge ${meta.className}`}>{meta.label}</span>
            </div>
            <div className="ar-fin-body">{meta.body}</div>
            {(item.investors.length > 0 || item.valuation) && (
              <div className="ar-fin-meta">
                {item.investors.length > 0 && <span>投资方：{item.investors.join('、')}</span>}
                {item.valuation && <span>估值：{item.valuation}</span>}
              </div>
            )}
            {item.sourceUrl && (
              <div className="ar-fin-source">
                来源：<a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceTitle || hostOf(item.sourceUrl)}</a>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function MilestoneList({ items }: { items: MilestoneItem[] }) {
  if (items.length === 0) {
    return <div className="ar-empty">本年度还没有可展示的里程碑事件。</div>
  }
  return (
    <div className="ar-milestone">
      {items.map(item => (
        <div key={`${item.kind}-${item.id}`} className="ar-milestone-item">
          <div className="ar-milestone-month">
            {item.month ? pad(item.month) : '—'}
            <span>{item.month ? 'MONTH' : 'DATE N/A'}</span>
          </div>
          <div>
            <div className="ar-milestone-name">{item.name}</div>
            <div className="ar-milestone-title">{item.title}</div>
            <div className="ar-milestone-detail">{item.detail}</div>
          </div>
          <div className="ar-milestone-kind">
            {item.kind}
            {item.amount && <div className="ar-milestone-amount">{item.amount}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

export function InsightColumns({ insights }: { insights: AnnualReportInsights }) {
  return (
    <div className="ar-insight-grid">
      <div className="ar-insight-col">
        <div className="ar-insight-label">年度亮点 / HIGHLIGHTS</div>
        {insights.highlights.map((item, index) => (
          <div key={`h-${index}`} className="ar-insight-item">{item}</div>
        ))}
      </div>
      <div className="ar-insight-col gaps">
        <div className="ar-insight-label">待解问题 / GAPS</div>
        {insights.gaps.map((item, index) => (
          <div key={`g-${index}`} className="ar-insight-item">{item}</div>
        ))}
      </div>
      <div className="ar-insight-col next">
        <div className="ar-insight-label">下一年度 / NEXT</div>
        {insights.nextYear.map((item, index) => (
          <div key={`n-${index}`} className="ar-insight-item">{item}</div>
        ))}
      </div>
    </div>
  )
}

export function ActivityStats({ activity }: { activity: ActivityStatsType }) {
  const items = [
    { label: '项目资料', value: activity.documents },
    { label: '跟进记录', value: activity.notes },
    { label: '合伙人点评', value: activity.reviews },
    { label: '尽调报告', value: activity.ddProjects },
    { label: '投后分析', value: activity.postInvestProjects },
  ]
  return (
    <div className="ar-activity">
      {items.map(item => (
        <div key={item.label} className="ar-activity-card">
          <div className="ar-activity-value">{item.value}</div>
          <div className="ar-activity-label">{item.label}</div>
        </div>
      ))}
    </div>
  )
}

export function QualityNote({ quality }: { quality: QualityStats }) {
  return (
    <div className="ar-quality">
      <b>数据口径说明：</b>
      本报告基于系统内项目阶段事件、初聊日期、行业标签与项目资料自动汇总。
      当前纳入统计项目 <b>{quality.totalProjects}</b> 个；阶段日期缺失 <b>{quality.missingStageDates}</b> 个，
      行业未分类 <b>{quality.unclassifiedIndustry}</b> 个，名称重复 <b>{quality.duplicateNames}</b> 组，
      公开融资检索失败 <b>{quality.researchFailed}</b> 个。
      历史阶段日期无法还原的项目只计入漏斗，不进入月度分布；金额沿用项目录入时的原始单位，未做跨项目加总。
    </div>
  )
}

export function EmptyBlock({ text }: { text: string }) {
  return <div className="ar-empty">{text}</div>
}
