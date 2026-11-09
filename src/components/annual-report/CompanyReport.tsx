import type { AnnualReportData, MaintainerStat, ReportStage } from '@/lib/annual-report/types'
import { REPORT_STAGES } from '@/lib/annual-report/types'
import {
  ActivityStats,
  CoverPage,
  FinancingGrid,
  FocusGrid,
  FunnelBlock,
  HeatmapBlock,
  IndustryBlock,
  InsightColumns,
  KpiGrid,
  MilestoneList,
  MonthlyBlock,
  PageShell,
  ProjectGrid,
  QualityNote,
} from './ReportChrome'

function MainTable({ maintainers }: { maintainers: MaintainerStat[] }) {
  if (maintainers.length === 0) {
    return <div className="ar-empty">本年度还没有可归属到项目维护人的阶段进展。</div>
  }
  const rows = maintainers.slice(0, 10)
  const max = Math.max(1, ...rows.map(item => item.total))
  const totals = REPORT_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = maintainers.reduce((sum, item) => sum + item.counts[stage], 0)
      return acc
    },
    {} as Record<ReportStage, number>
  )
  const totalAll = maintainers.reduce((sum, item) => sum + item.total, 0)

  return (
    <table className="ar-table">
      <thead>
        <tr>
          <th>项目维护人</th>
          <th>初聊</th>
          <th>PreDD</th>
          <th>立项</th>
          <th>尽调</th>
          <th>协议</th>
          <th>交割</th>
          <th>阶段进展合计</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(item => (
          <tr key={item.userId}>
            <td>
              <div className="ar-person">
                <span className="ar-avatar">{item.name.slice(0, 1)}</span>
                <span>{item.name}</span>
              </div>
            </td>
            {REPORT_STAGES.map(stage => (
              <td key={stage}>{item.counts[stage] || '—'}</td>
            ))}
            <td>
              <span className="ar-bar-mini" style={{ width: `${Math.max(3, (item.total / max) * 46)}px` }} />
              {item.total}
            </td>
          </tr>
        ))}
        <tr>
          <td className="ar-total">合计</td>
          {REPORT_STAGES.map(stage => (
            <td key={stage} className="ar-total">{totals[stage]}</td>
          ))}
          <td className="ar-total">{totalAll}</td>
        </tr>
      </tbody>
    </table>
  )
}

function ComparisonCards({ data }: { data: AnnualReportData }) {
  const comparison = data.comparison
  if (!comparison) return null
  const currentActive = data.kpis.find(item => item.key === 'activeProjects')?.value ?? 0
  const currentNew = data.kpis.find(item => item.key === 'newProjects')?.value ?? 0
  const diff = (current: number, previous: number): string => {
    if (previous === 0) return current === 0 ? '持平' : '新增'
    const pct = Math.round(((current - previous) / previous) * 100)
    return `${pct > 0 ? '+' : ''}${pct}%`
  }

  const items = [
    { label: '新初聊项目', current: currentNew, previous: comparison.newProjects },
    { label: '年度活跃项目', current: currentActive, previous: comparison.activeProjects },
    { label: '覆盖行业赛道', current: data.industries.length, previous: comparison.industries },
    { label: '完成交割', current: data.funnel.find(item => item.stage === 'CLOSING')?.entered ?? 0, previous: comparison.entered.CLOSING },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '11px' }}>
      {items.map(item => (
        <div key={item.label} className="ar-side-card">
          <div className="ar-kpi-label">{item.label}</div>
          <div className="ar-side-value" style={{ marginTop: '6px' }}>
            {item.current}
            <span style={{ fontSize: '11px', color: 'var(--ar-muted)', marginLeft: '5px' }}>
              去年 {item.previous}
            </span>
          </div>
          <div className="ar-side-label">{comparison.year} 年同比 {diff(item.current, item.previous)}</div>
        </div>
      ))}
    </div>
  )
}

export default function CompanyReport({ data }: { data: AnnualReportData }) {
  const closing = data.funnel.find(item => item.stage === 'CLOSING')?.entered ?? 0
  const initiation = data.funnel.find(item => item.stage === 'PROJECT_INITIATION')?.entered ?? 0
  const dueDiligence = data.funnel.find(item => item.stage === 'DUE_DILIGENCE')?.entered ?? 0
  const newProjects = data.kpis.find(item => item.key === 'newProjects')?.value ?? 0
  const bestMonth = data.monthly.reduce((top, item) => (item.totalEntries > top.totalEntries ? item : top), data.monthly[0])
  const activeMonths = data.monthly.filter(item => item.totalEntries > 0).length
  const totalEntries = data.monthly.reduce((sum, item) => sum + item.totalEntries, 0)
  const newIndustries = data.industries.filter(item => item.isNew).slice(0, 5)
  const topFocusMonths = [...data.monthlyFocus]
    .filter(item => item.industries.length > 0)
    .sort((a, b) => b.industries.length - a.industries.length)
    .slice(0, 4)

  return (
    <div className="ar-root">
      <CoverPage data={data} />

      <PageShell
        data={data}
        pageNo={2}
        kicker="PART 01 · COMPANY OVERVIEW"
        title="全年总览"
        subtitle="全公司一年做了什么：初聊、推进、交割，以及同比变化。"
      >
        <KpiGrid kpis={data.kpis} />
        <div className="ar-section">
          <div className="ar-section-head">
            <div className="ar-section-title">年度总览</div>
            <div className="ar-section-note">DATA AS OF DEC 31</div>
          </div>
          <div className="ar-quote">
            <span className="ar-quote-mark">“</span>
            {data.insights.overview}
          </div>
        </div>
        <div className="ar-section">
          <div className="ar-section-head">
            <div className="ar-section-title">同比对照</div>
            <div className="ar-section-note">VS {data.comparison?.year ?? data.meta.year - 1}</div>
          </div>
          <ComparisonCards data={data} />
        </div>
        <div className="ar-section">
          <div className="ar-section-head">
            <div className="ar-section-title">线索与储备</div>
            <div className="ar-section-note">AI 线索 / 全年新增</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '11px' }}>
            <div className="ar-side-card">
              <div className="ar-side-value">{data.leads.total}</div>
              <div className="ar-side-label">全年新增项目线索</div>
            </div>
            <div className="ar-side-card">
              <div className="ar-side-value">{data.leads.ai}</div>
              <div className="ar-side-label">其中 AI 渠道线索</div>
            </div>
            <div className="ar-side-card">
              <div className="ar-side-value">{data.leads.converted}</div>
              <div className="ar-side-label">已转化为项目</div>
            </div>
          </div>
        </div>
      </PageShell>

      <PageShell
        data={data}
        pageNo={3}
        kicker="PART 02 · PIPELINE"
        title="阶段漏斗"
        subtitle="全公司项目在初聊、PreDD、立项、尽调、协议、交割各环节的进入与留存。"
      >
        <FunnelBlock funnel={data.funnel} />
        <div className="ar-section">
          <div className="ar-section-head">
            <div className="ar-section-title">关键转化</div>
            <div className="ar-section-note">COMPANY FUNNEL CONVERSION</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '13px' }}>
            <div className="ar-kpi">
              <div className="ar-kpi-label">初聊 → 立项</div>
              <div className="ar-kpi-value">{newProjects > 0 ? `${Math.round((initiation / newProjects) * 1000) / 10}%` : '—'}</div>
              <div className="ar-kpi-foot"><span>{initiation} / {newProjects} 个项目</span></div>
            </div>
            <div className="ar-kpi">
              <div className="ar-kpi-label">立项 → 尽调</div>
              <div className="ar-kpi-value">
                {initiation > 0 ? `${Math.round((dueDiligence / initiation) * 1000) / 10}%` : '—'}
              </div>
              <div className="ar-kpi-foot"><span>{dueDiligence} 个项目进入尽调</span></div>
            </div>
            <div className="ar-kpi">
              <div className="ar-kpi-label">尽调 → 交割</div>
              <div className="ar-kpi-value">
                {dueDiligence > 0 ? `${Math.round((closing / dueDiligence) * 1000) / 10}%` : '—'}
              </div>
              <div className="ar-kpi-foot"><span>{closing} 个项目完成交割</span></div>
            </div>
          </div>
        </div>
        <div className="ar-section">
          <div className="ar-prose">
            公司级漏斗反映的是组织的前端广度与后端转化能力：初聊量大说明市场覆盖充分，但若 PreDD 到立项承接偏低，
            通常意味着初筛标准或项目质量存在问题；尽调到交割的缺口，则更多与投决节奏、条款谈判和资金安排相关。
            与去年同阶段对比，可以判断是团队能力变化，还是市场环境影响。
          </div>
        </div>
      </PageShell>

      <PageShell
        data={data}
        pageNo={4}
        kicker="PART 03 · MONTHLY RHYTHM"
        title="月度节奏"
        subtitle="全公司每个月的阶段进展堆叠，观察组织的工作密度与出手节奏。"
      >
        <MonthlyBlock monthly={data.monthly} />
        <div className="ar-section">
          <div className="ar-section-head">
            <div className="ar-section-title">节奏解读</div>
            <div className="ar-section-note">12 MONTHS</div>
          </div>
          <div className="ar-prose">
            {bestMonth.totalEntries > 0
              ? `${bestMonth.label}是全年最活跃的月份，共发生 ${bestMonth.totalEntries} 次阶段进展；`
              : '本年度没有记录到阶段进展；'}
            全年共记录 {totalEntries} 次阶段进入，{activeMonths} 个月有实际推进、{12 - activeMonths} 个月处于空档。
            若初聊集中在上半年、交割集中在下半年，说明项目储备与投决周期匹配良好；
            若下半年初聊明显减少，则需要在下一年度提前补充前端项目源。
          </div>
        </div>
      </PageShell>

      <PageShell
        data={data}
        pageNo={5}
        kicker="PART 04 · SECTOR MAP"
        title="行业版图"
        subtitle="全公司项目覆盖的行业赛道，以及今年首次出现的新方向。"
      >
        <IndustryBlock industries={data.industries} />
        <div className="ar-section">
          <div className="ar-section-head">
            <div className="ar-section-title">新赛道</div>
            <div className="ar-section-note">首次出现在本年度项目中的行业</div>
          </div>
          {newIndustries.length > 0 ? (
            <div className="ar-chips">
              {newIndustries.map(item => (
                <span key={item.name} className="ar-chip">{item.name} · {item.count}</span>
              ))}
            </div>
          ) : (
            <div className="ar-prose">本年度没有新增行业赛道，项目集中在既有方向。</div>
          )}
        </div>
      </PageShell>

      <PageShell
        data={data}
        pageNo={6}
        kicker="PART 05 · MONTHLY SECTORS"
        title="月度赛道"
        subtitle="各月份活跃赛道的热力分布，以及单月重点关注的赛道。"
      >
        <HeatmapBlock data={data.monthlyIndustry} />
        <div className="ar-section">
          <div className="ar-section-head">
            <div className="ar-section-title">各月重点赛道</div>
            <div className="ar-section-note">TOP 2 SECTORS PER MONTH</div>
          </div>
          <FocusGrid data={data} />
        </div>
        {topFocusMonths.length > 0 && (
          <div className="ar-section">
            <div className="ar-conc-note">
              全年赛道关注呈现明显的月度轮动：{topFocusMonths.map(item => `${item.label}以${item.industries[0]}为主`).join('，')}。
              赛道集中度高的月份通常对应重点项目的集中推进期，可作为下一年度排期与资源投入的参考。
            </div>
          </div>
        )}
      </PageShell>

      <PageShell
        data={data}
        pageNo={7}
        kicker="PART 06 · TEAM CONTRIBUTION"
        title="团队贡献"
        subtitle="各项目维护人在初聊、PreDD、立项、尽调、协议、交割上的年度工作分布。"
      >
        <MainTable maintainers={data.maintainers} />
        <div className="ar-section">
          <div className="ar-prose">
            表中为各维护人作为项目主维护人、在本年度首次进入相应阶段的项目数（同一项目在同一阶段不重复计数）。
            阶段进展合计反映工作量，交割数反映结果；两者需要结合看，避免只以交割数量评价前端工作。
            若某位维护人初聊多但立项少，建议复盘其初筛标准；若立项多但交割少，则更多是投决与执行节奏问题。
          </div>
        </div>
      </PageShell>

      <PageShell
        data={data}
        pageNo={8}
        kicker="PART 07 · MILESTONES"
        title="年度里程碑"
        subtitle="完成交割、年度最高估值与重点项目的关键节点。"
      >
        <MilestoneList items={data.milestones} />
        <div className="ar-section">
          <div className="ar-section-head">
            <div className="ar-section-title">年度重点项目</div>
            <div className="ar-section-note">按当前阶段排序</div>
          </div>
          <ProjectGrid projects={data.highlights} />
        </div>
      </PageShell>

      <PageShell
        data={data}
        pageNo={9}
        kicker="PART 08 · FINANCING TRACKER"
        title="融资追踪"
        subtitle="对本年度进入 PreDD / 立项 / 尽调 的项目，检索公开融资进展。"
      >
        <FinancingGrid items={data.financing} />
        <div className="ar-section">
          <div className="ar-quality" style={{ marginTop: 0 }}>
            <b>检索说明：</b>
            融资进展来自公开信息检索，仅采纳有明确来源的条目；未检索到不代表项目没有融资，可能只是未公开。
            本报告不对融资金额、估值做推断，也不将公开信息直接等同于交易事实。
          </div>
        </div>
      </PageShell>

      <PageShell
        data={data}
        pageNo={10}
        kicker="PART 09 · YEAR IN REVIEW"
        title="年度展望"
        subtitle="全公司的工作沉淀、年度判断与下一年度方向。"
      >
        <ActivityStats activity={data.activity} />
        <div className="ar-section">
          <div className="ar-section-head">
            <div className="ar-section-title">工作沉淀</div>
            <div className="ar-section-note">全公司本年度新增</div>
          </div>
          <div className="ar-prose">
            全年新增项目资料 {data.activity.documents} 份、跟进记录 {data.activity.notes} 条、合伙人点评 {data.activity.reviews} 条，
            完成尽调报告 {data.activity.ddProjects} 份、投后分析 {data.activity.postInvestProjects} 份。
            资料沉淀是机构记忆的基础，也是下一年度判断项目质量与团队产出的依据。
          </div>
        </div>
        <div className="ar-section">
          <InsightColumns insights={data.insights} />
        </div>
        <div style={{ marginTop: 'auto' }}>
          <QualityNote quality={data.quality} />
          <div className="ar-signature">
            <div className="ar-signature-text">{data.insights.theme}</div>
            <div className="ar-signature-date">泰亚投资 · {data.meta.year} ANNUAL REPORT</div>
          </div>
        </div>
      </PageShell>
    </div>
  )
}
