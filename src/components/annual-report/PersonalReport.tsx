import type { AnnualReportData } from '@/lib/annual-report/types'
import {
  ActivityStats,
  CoverPage,
  FunnelBlock,
  IndustryBlock,
  InsightColumns,
  KpiGrid,
  MonthlyBlock,
  PageShell,
  ProjectGrid,
  QualityNote,
  FinancingGrid,
} from './ReportChrome'

function conversion(funnel: AnnualReportData['funnel'], stage: string): string {
  const item = funnel.find(entry => entry.stage === stage)
  return item?.conversion === null || item?.conversion === undefined ? '—' : `${item.conversion}%`
}

export default function PersonalReport({ data }: { data: AnnualReportData }) {
  const newProjects = data.kpis.find(item => item.key === 'newProjects')?.value ?? 0
  const initiation = data.funnel.find(item => item.stage === 'PROJECT_INITIATION')?.entered ?? 0
  const dueDiligence = data.funnel.find(item => item.stage === 'DUE_DILIGENCE')?.entered ?? 0
  const closing = data.funnel.find(item => item.stage === 'CLOSING')?.entered ?? 0
  const bestMonth = data.monthly.reduce((top, item) => (item.totalEntries > top.totalEntries ? item : top), data.monthly[0])
  const quietMonths = data.monthly.filter(item => item.totalEntries === 0).length
  const newIndustries = data.industries.filter(item => item.isNew).slice(0, 4)

  return (
    <div className="ar-root">
      <CoverPage data={data} />

      <PageShell
        data={data}
        pageNo={2}
        kicker="PART 01 · ANNUAL OVERVIEW"
        title="年度概览"
        subtitle="把一年的项目动作压缩成一页：新增、推进、交割与赛道覆盖。"
      >
        <KpiGrid kpis={data.kpis} />
        <div className="ar-section">
          <div className="ar-section-head">
            <div className="ar-section-title">年度总览</div>
            <div className="ar-section-note">DATA AS OF DEC 31</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 210px', gap: '20px', alignItems: 'start' }}>
            <div className="ar-quote">
              <span className="ar-quote-mark">“</span>
              {data.insights.overview}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="ar-side-card">
                <div className="ar-side-value">{data.collaborationCount ?? 0}</div>
                <div className="ar-side-label">协作项目（我是成员，非主维护人）</div>
              </div>
              <div className="ar-side-card">
                <div className="ar-side-value">{data.industries.length}</div>
                <div className="ar-side-label">覆盖行业赛道</div>
              </div>
              <div className="ar-side-card">
                <div className="ar-side-value">{closing}</div>
                <div className="ar-side-label">年度完成交割项目</div>
              </div>
            </div>
          </div>
        </div>
        <div className="ar-section">
          <div className="ar-section-head">
            <div className="ar-section-title">年度关键词</div>
          </div>
          <div className="ar-chips">
            {data.insights.keywords.map(keyword => (
              <span key={keyword} className="ar-chip">{keyword}</span>
            ))}
          </div>
        </div>
      </PageShell>

      <PageShell
        data={data}
        pageNo={3}
        kicker="PART 02 · PIPELINE"
        title="阶段漏斗"
        subtitle="从初聊到交割，项目在每一个阶段的进入与留存。"
      >
        <FunnelBlock funnel={data.funnel} />
        <div className="ar-section">
          <div className="ar-section-head">
            <div className="ar-section-title">关键转化</div>
            <div className="ar-section-note">YEARLY ENTRY CONVERSION</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '13px' }}>
            <div className="ar-kpi">
              <div className="ar-kpi-label">初聊 → 立项</div>
              <div className="ar-kpi-value">{newProjects > 0 ? `${Math.round((initiation / newProjects) * 1000) / 10}%` : '—'}</div>
              <div className="ar-kpi-foot"><span>{initiation} / {newProjects} 个项目</span></div>
            </div>
            <div className="ar-kpi">
              <div className="ar-kpi-label">立项 → 尽调</div>
              <div className="ar-kpi-value">{conversion(data.funnel, 'DUE_DILIGENCE')}</div>
              <div className="ar-kpi-foot"><span>{dueDiligence} 个项目进入尽调</span></div>
            </div>
            <div className="ar-kpi">
              <div className="ar-kpi-label">尽调 → 交割</div>
              <div className="ar-kpi-value">{conversion(data.funnel, 'CLOSING')}</div>
              <div className="ar-kpi-foot"><span>{closing} 个项目完成交割</span></div>
            </div>
          </div>
        </div>
        <div className="ar-section">
          <div className="ar-quote" style={{ fontSize: '14px' }}>
            漏斗不是越高越好，而是要看「卡在哪」。如果 PreDD 进入多、立项少，说明初筛消耗大；
            如果尽调进入多、交割少，说明投决或条款环节需要复盘。把今年的转化率和去年放在一起看，才能判断是个人节奏问题还是项目结构问题。
          </div>
        </div>
      </PageShell>

      <PageShell
        data={data}
        pageNo={4}
        kicker="PART 03 · MONTHLY RHYTHM"
        title="月度节奏"
        subtitle="每个月的阶段进展堆叠，观察一年的工作密度与节奏。"
      >
        <MonthlyBlock monthly={data.monthly} />
        <div className="ar-section">
          <div className="ar-section-head">
            <div className="ar-section-title">节奏解读</div>
          </div>
          <div className="ar-prose">
            {bestMonth.totalEntries > 0
              ? `${bestMonth.label}是全年最活跃的月份，共发生 ${bestMonth.totalEntries} 次阶段进展；`
              : '本年度没有记录到阶段进展；'}
            全年共记录 {data.monthly.reduce((sum, item) => sum + item.totalEntries, 0)} 次阶段进入，
            其中 {quietMonths} 个月没有新增初聊或阶段进展。
            月度假象需要结合项目实际推进时间看：初聊集中在某几个月，通常意味着前端获客节奏；
            尽调/交割集中在下半年，则更多是投决与条款周期的体现。
          </div>
        </div>
      </PageShell>

      <PageShell
        data={data}
        pageNo={5}
        kicker="PART 04 · SECTOR MAP"
        title="行业赛道"
        subtitle="项目集中在哪些方向，哪些赛道是今年新出现的。"
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
        kicker="PART 05 · KEY PROJECTS"
        title="重点项目"
        subtitle="按当前阶段与推进时间排序，选取本年度最值得复盘的项目。"
      >
        <ProjectGrid projects={data.highlights} />
        <div className="ar-section">
          <div className="ar-quote" style={{ fontSize: '13px' }}>
            重点项目不是「金额最大的项目」，而是当前阶段最靠前、最需要持续跟进的组合。
            建议在下一年度第一次周会上，逐个项目确认下一步动作与时间点。
          </div>
        </div>
      </PageShell>

      <PageShell
        data={data}
        pageNo={7}
        kicker="PART 06 · FINANCING TRACKER"
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
        pageNo={8}
        kicker="PART 07 · YEAR IN REVIEW"
        title="年度小结"
        subtitle="把数据还原成动作：做对了什么，哪里卡住，下一年怎么打。"
      >
        <ActivityStats activity={data.activity} />
        <div className="ar-section">
          <div className="ar-section-head">
            <div className="ar-section-title">工作沉淀</div>
            <div className="ar-section-note">系统内本年新增</div>
          </div>
          <div className="ar-prose">
            全年新增项目资料 {data.activity.documents} 份、跟进记录 {data.activity.notes} 条、合伙人点评 {data.activity.reviews} 条，
            完成尽调报告 {data.activity.ddProjects} 份、投后分析 {data.activity.postInvestProjects} 份。
            资料沉淀越完整，第二年复盘时的判断成本越低。
          </div>
        </div>
        <div className="ar-section">
          <InsightColumns insights={data.insights} />
        </div>
        <div style={{ marginTop: 'auto' }}>
          <QualityNote quality={data.quality} />
          <div className="ar-signature">
            <div className="ar-signature-text">{data.insights.theme}</div>
            <div className="ar-signature-date">{data.meta.ownerName} · {data.meta.year} ANNUAL REVIEW</div>
          </div>
        </div>
      </PageShell>
    </div>
  )
}
