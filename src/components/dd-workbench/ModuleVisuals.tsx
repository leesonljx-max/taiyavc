'use client'

/**
 * 九大尽调模块专属主视觉（SVG/CSS 示意图骨架 + 真实状态数据注入）
 *
 * 设计原则：不虚构业务数据——图形骨架体现各模块的分析框架特色，
 * 节点/分层的填充状态由真实的证据状态（已确认/待确认/冲突）与任务状态驱动。
 */

export interface VisualTaskStats {
  status: string
  conclusion: string | null
  redFlagLevel: string
  evidenceCount: number
  confirmedEvidenceCount: number
  conflictEvidenceCount: number
  pendingEvidenceCount: number
}

interface ModuleVisualProps {
  task: VisualTaskStats
  projectName: string
}

/** 证据状态 → 节点态（已核验/待确认/冲突） */
function nodeState(t: VisualTaskStats): 'confirmed' | 'pending' | 'conflict' {
  if (t.conflictEvidenceCount > 0) return 'conflict'
  if (t.confirmedEvidenceCount > 0) return 'confirmed'
  return 'pending'
}

const STATE_CHIP: Record<string, { label: string; cls: string; dot: string }> = {
  confirmed: { label: '已核验', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  pending: { label: '待确认', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400' },
  conflict: { label: '存在冲突', cls: 'bg-red-50 text-red-600 border-red-200', dot: 'bg-red-500' },
}

const BLUE = '#2563eb'
const GRAY_LINE = '#cbd5e1'

/** 通用小节点卡片 */
function VNode({
  title,
  sub,
  state,
  highlight,
}: {
  title: string
  sub?: string
  state?: 'confirmed' | 'pending' | 'conflict' | 'done'
  highlight?: boolean
}) {
  const chip =
    state === 'done'
      ? { label: '已冻结', cls: 'bg-indigo-50 text-indigo-600 border-indigo-200', dot: 'bg-indigo-500' }
      : state
        ? STATE_CHIP[state]
        : null
  return (
    <div
      className={`px-3 py-2 rounded-xl bg-white border shadow-sm text-center ${
        highlight ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200'
      }`}
    >
      <div className="text-xs font-bold text-gray-800 whitespace-nowrap">{title}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5 whitespace-nowrap">{sub}</div>}
      {chip && (
        <span className={`inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-full border text-[9px] font-bold ${chip.cls}`}>
          <span className={`w-1 h-1 rounded-full ${chip.dot}`} />
          {chip.label}
        </span>
      )}
    </div>
  )
}

/** 视觉容器（统一高度与背景网格） */
function VisualFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gradient-to-br from-slate-50 to-blue-50/40 p-4 overflow-x-auto">
      <p className="text-[11px] text-gray-400 mb-3 font-medium">{title}</p>
      <div className="min-w-[420px]">{children}</div>
    </div>
  )
}

// ── 01 项目与主体：交易结构辐射图 ──
function EntityStructure({ task, projectName }: ModuleVisualProps) {
  const st = nodeState(task)
  return (
    <VisualFrame title="交易结构 · 主体关联与交割路径">
      <div className="relative h-[210px]">
        <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 420 210">
          <line x1="210" y1="105" x2="80" y2="40" stroke={GRAY_LINE} strokeWidth="1.5" />
          <line x1="210" y1="105" x2="340" y2="40" stroke={GRAY_LINE} strokeWidth="1.5" />
          <line x1="210" y1="105" x2="70" y2="170" stroke={GRAY_LINE} strokeWidth="1.5" />
          <line x1="210" y1="105" x2="350" y2="170" stroke={GRAY_LINE} strokeWidth="1.5" />
        </svg>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="px-4 py-3 rounded-2xl bg-white border-2 border-blue-500 shadow-lg shadow-blue-100 text-center">
            <div className="text-xs font-bold text-blue-700">{projectName}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">项目主体 · 关键事实</div>
          </div>
        </div>
        <div className="absolute left-[8%] top-[6%]"><VNode title="经营主体" sub="工商与融资信息" state={st} /></div>
        <div className="absolute right-[8%] top-[6%]"><VNode title="历史股东" sub="股权与工商登记" state="pending" /></div>
        <div className="absolute left-[6%] bottom-[8%]"><VNode title="融资诉求" sub="轮次 · 金额 · 用途" state={st} /></div>
        <div className="absolute right-[6%] bottom-[8%]">
          <VNode title="投委会结论" sub="冻结后写入报告" state={task.status === 'DONE' ? 'done' : undefined} highlight={task.status === 'DONE'} />
        </div>
      </div>
    </VisualFrame>
  )
}

// ── 02 产品与技术：技术图谱（三层栈） ──
function TechMap({ task }: ModuleVisualProps) {
  const st = nodeState(task)
  const layers = [
    { name: '应用场景', desc: '客户与落地' },
    { name: '核心技术', desc: '路线与差异化' },
    { name: '基础支撑', desc: '算力与供应链' },
  ]
  return (
    <VisualFrame title="技术图谱 · 产品架构与技术路线">
      <div className="space-y-2">
        {layers.map((l, i) => (
          <div key={l.name} className="flex items-center gap-3">
            <div
              className="flex-1 rounded-xl border px-4 py-3 flex items-center justify-between"
              style={{
                borderColor: i === 1 ? BLUE : '#e2e8f0',
                background: i === 1 ? 'rgba(37,99,235,0.06)' : '#fff',
              }}
            >
              <div>
                <span className="text-xs font-bold text-gray-800">{l.name}</span>
                <span className="text-[10px] text-gray-400 ml-2">{l.desc}</span>
              </div>
              <div className="flex gap-1">
                {[0, 1, 2].map(d => (
                  <span
                    key={d}
                    className={`w-2 h-2 rounded-full ${d < task.confirmedEvidenceCount ? 'bg-emerald-500' : d < task.evidenceCount ? 'bg-amber-300' : 'bg-gray-200'}`}
                  />
                ))}
              </div>
            </div>
            {i === 1 && task.redFlagLevel !== 'NONE' && (
              <span className={`px-2 py-1 rounded-lg text-[10px] font-bold ${task.redFlagLevel === 'HIGH' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                ⚑ 技术红旗
              </span>
            )}
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10px] text-gray-400">性能对标与专利核验：</span>
          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATE_CHIP[st].cls}`}>
            {STATE_CHIP[st].label} · {task.evidenceCount} 条证据
          </span>
        </div>
      </div>
    </VisualFrame>
  )
}

// ── 03 团队与治理：治理结构树 ──
function GovernanceTree({ task }: ModuleVisualProps) {
  const st = nodeState(task)
  return (
    <VisualFrame title="团队治理 · 履历矩阵与股权安排">
      <div className="flex flex-col items-center">
        <VNode title="创始人 / CEO" sub="履历与胜任力" state={st} highlight />
        <svg width="14" height="18" className="my-0.5"><line x1="7" y1="0" x2="7" y2="18" stroke={GRAY_LINE} strokeWidth="1.5" /></svg>
        <div className="flex items-start gap-8">
          <svg width="240" height="14"><path d="M120 0 L4 14 M120 0 L120 14 M120 0 L236 14" stroke={GRAY_LINE} strokeWidth="1.5" fill="none" /></svg>
        </div>
        <div className="flex gap-3 mt-0.5">
          <VNode title="关键岗位" sub="技术 / 商务" state={st} />
          <VNode title="股权与激励" sub="cap table" state={st === 'confirmed' ? st : 'pending'} />
          <VNode title="关联交易" sub="利益冲突排查" state="pending" />
        </div>
        <div className="mt-3 w-full flex items-center gap-2">
          <span className="text-[10px] text-gray-400">治理核验：</span>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
            <div className="bg-emerald-500" style={{ width: `${task.confirmedEvidenceCount > 0 ? 60 : 0}%` }} />
            <div className="bg-amber-300" style={{ width: `${task.pendingEvidenceCount > 0 ? 25 : 0}%` }} />
          </div>
        </div>
      </div>
    </VisualFrame>
  )
}

// ── 04 市场与客户：市场漏斗（TAM/SAM/SOM） ──
function MarketFunnel({ task }: ModuleVisualProps) {
  const st = nodeState(task)
  const levelState = (lv: number) =>
    task.confirmedEvidenceCount >= lv + 1 ? 'confirmed' : task.evidenceCount > 0 ? 'pending' : 'pending'
  return (
    <VisualFrame title="市场空间 · TAM / SAM / SOM 假设">
      <div className="flex flex-col items-center gap-1.5 py-1">
        {[
          { label: 'TAM 总市场', w: 'w-[95%]', s: levelState(0) },
          { label: 'SAM 可服务', w: 'w-[70%]', s: levelState(1) },
          { label: 'SOM 可获取', w: 'w-[45%]', s: levelState(2) },
        ].map(lv => (
          <div
            key={lv.label}
            className={`${lv.w} py-2.5 rounded-lg text-center border-2 ${
              lv.s === 'confirmed'
                ? 'bg-blue-500/90 border-blue-400 text-white'
                : 'bg-white border-dashed border-blue-200 text-blue-500'
            }`}
          >
            <span className="text-xs font-bold">{lv.label}</span>
            <span className={`ml-2 text-[10px] ${lv.s === 'confirmed' ? 'text-blue-100' : 'text-amber-500'}`}>
              {lv.s === 'confirmed' ? '有证据支撑' : '待核验'}
            </span>
          </div>
        ))}
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-gray-400">客户画像与切入路径：</span>
          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATE_CHIP[st].cls}`}>
            {STATE_CHIP[st].label} · {task.evidenceCount} 条
          </span>
        </div>
      </div>
    </VisualFrame>
  )
}

// ── 05 商业化与订单：订单收入桥 ──
function RevenueBridge({ task }: ModuleVisualProps) {
  const stages = [
    { label: '客户意向', base: 30 },
    { label: '已签订单', base: 55 },
    { label: '确认收入', base: 80 },
  ]
  return (
    <VisualFrame title="订单收入桥 · 商业化推进与收入质量">
      <div className="flex items-end justify-around gap-2 h-[150px] px-2">
        {stages.map((s, i) => {
          const filled = task.confirmedEvidenceCount > i
          return (
            <div key={s.label} className="flex flex-col items-center gap-1.5 flex-1">
              <div
                className={`w-full rounded-t-lg transition-all ${filled ? 'bg-gradient-to-t from-blue-600 to-blue-400' : 'bg-gray-200 border border-dashed border-gray-300 border-b-0'}`}
                style={{ height: `${s.base + (filled ? 25 : 0)}px` }}
              />
              <span className="text-[10px] font-bold text-gray-600 whitespace-nowrap">{s.label}</span>
              <span className={`text-[9px] ${filled ? 'text-emerald-600' : 'text-amber-500'}`}>{filled ? '已核验' : '待核验'}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-gray-400">客户集中度与复购：</span>
        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${task.conflictEvidenceCount > 0 ? STATE_CHIP.conflict.cls : task.confirmedEvidenceCount > 0 ? STATE_CHIP.confirmed.cls : STATE_CHIP.pending.cls}`}>
          {task.conflictEvidenceCount > 0 ? '存在冲突' : task.confirmedEvidenceCount > 0 ? '已核验' : '待确认'}
        </span>
      </div>
    </VisualFrame>
  )
}

// ── 06 竞争与壁垒：竞争矩阵（四象限） ──
function CompetitionMatrix({ task }: ModuleVisualProps) {
  const st = nodeState(task)
  return (
    <VisualFrame title="竞争矩阵 · 技术领先 × 商业化进度">
      <div className="relative h-[170px] border-l-2 border-b-2 border-gray-200">
        {/* 象限分割线 */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-100" />
        <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-100" />
        {/* 轴标签 */}
        <span className="absolute -top-4 right-0 text-[9px] text-gray-400">技术领先 →</span>
        <span className="absolute -bottom-4 right-0 text-[9px] text-gray-400">商业化进度 →</span>
        {/* 本项目（高亮位置） */}
        <div className="absolute left-[68%] top-[22%] -translate-x-1/2 -translate-y-1/2 text-center">
          <div className={`w-4 h-4 rounded-full mx-auto border-2 ${st === 'confirmed' ? 'bg-blue-500 border-blue-300' : 'bg-white border-blue-400'}`} />
          <span className="text-[9px] font-bold text-blue-600">本项目</span>
        </div>
        {/* 竞品占位（证据状态驱动） */}
        {[
          { x: 30, y: 55, name: '竞品 A' },
          { x: 52, y: 32, name: '竞品 B' },
          { x: 22, y: 25, name: '替代方案' },
        ].map(c => (
          <div key={c.name} className="absolute -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${c.x}%`, top: `${c.y}%` }}>
            <div className={`w-3 h-3 rounded-full mx-auto ${task.evidenceCount > 1 ? 'bg-gray-400' : 'bg-gray-200'}`} />
            <span className="text-[8px] text-gray-400">{c.name}</span>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-2">
        <span className="text-[10px] text-gray-400">竞品与壁垒核验：</span>
        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATE_CHIP[st].cls}`}>
          {STATE_CHIP[st].label} · {task.evidenceCount} 条
        </span>
      </div>
    </VisualFrame>
  )
}

// ── 07 财务与单位经济：财务趋势 ──
function FinanceTrend({ task }: ModuleVisualProps) {
  const st = nodeState(task)
  // 趋势点位由证据状态驱动（示意：有确认证据=上行实线，否则虚线待核验）
  const confirmed = task.confirmedEvidenceCount > 0
  return (
    <VisualFrame title="财务趋势 · 增长 / 毛利 / 现金跑道">
      <svg viewBox="0 0 420 140" className="w-full h-[140px]">
        {/* 坐标轴 */}
        <line x1="30" y1="10" x2="30" y2="115" stroke={GRAY_LINE} strokeWidth="1.5" />
        <line x1="30" y1="115" x2="405" y2="115" stroke={GRAY_LINE} strokeWidth="1.5" />
        {/* 收入趋势 */}
        {confirmed ? (
          <path d="M50 105 L130 88 L210 70 L290 48 L370 30" stroke={BLUE} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        ) : (
          <path d="M50 105 L130 95 L210 82 L290 66 L370 55" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 4" fill="none" />
        )}
        {/* 毛利带 */}
        <path d="M50 110 L130 100 L210 90 L290 76 L370 62 L370 78 L290 90 L210 102 L130 110 L50 115 Z" fill="rgba(37,99,235,0.08)" />
        {[50, 130, 210, 290, 370].map((x, i) => (
          <circle key={x} cx={x} cy={confirmed ? [105, 88, 70, 48, 30][i] : [105, 95, 82, 66, 55][i]} r="3" fill={confirmed ? BLUE : '#94a3b8'} />
        ))}
        <text x="46" y="132" fontSize="9" fill="#94a3b8">期初</text>
        <text x="358" y="132" fontSize="9" fill="#94a3b8">本期</text>
      </svg>
      <div className="flex items-center gap-3 mt-1">
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATE_CHIP[st].cls}`}>
          {confirmed ? '三表与口径已核验' : '财务数据待核验'}
        </span>
        <span className="text-[10px] text-gray-400">现金跑道 / 情景敏感性见结论区</span>
      </div>
    </VisualFrame>
  )
}

// ── 08 法务合规与风险：风险热力图 ──
function RiskHeatmap({ task }: ModuleVisualProps) {
  const cells = [
    { label: '产权', key: 'IP' },
    { label: '诉讼', key: 'LIT' },
    { label: '数据', key: 'DAT' },
    { label: '监管', key: 'REG' },
    { label: '合同', key: 'CT' },
    { label: '关联', key: 'REL' },
  ]
  // 热度：红旗级别 × 冲突证据 → 高/中/低
  const level = (i: number): 'high' | 'mid' | 'low' | 'none' => {
    if (task.redFlagLevel === 'HIGH' && i < 2) return 'high'
    if (task.redFlagLevel !== 'NONE' && i < 3) return 'mid'
    if (i < task.confirmedEvidenceCount) return 'none'
    if (i < task.evidenceCount) return 'low'
    return 'none'
  }
  const heat = {
    high: 'bg-red-500/85 text-white',
    mid: 'bg-amber-400/85 text-amber-950',
    low: 'bg-amber-200/70 text-amber-800',
    none: 'bg-gray-100 text-gray-400',
  }
  return (
    <VisualFrame title="风险热力 · 产权 / 诉讼 / 数据 / 监管">
      <div className="grid grid-cols-3 gap-2">
        {cells.map((c, i) => {
          const lv = level(i)
          return (
            <div key={c.key} className={`rounded-xl px-3 py-3.5 text-center ${heat[lv]}`}>
              <div className="text-xs font-bold">{c.label}</div>
              <div className="text-[9px] mt-0.5 opacity-80">
                {lv === 'high' ? '高风险' : lv === 'mid' ? '关注' : lv === 'low' ? '待核验' : '无标记'}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-gray-400">合规核验表：</span>
        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${task.conflictEvidenceCount > 0 ? STATE_CHIP.conflict.cls : STATE_CHIP[nodeState(task)].cls}`}>
          {task.conflictEvidenceCount > 0 ? `${task.conflictEvidenceCount} 条冲突待裁决` : `${task.evidenceCount} 条证据`}
        </span>
      </div>
    </VisualFrame>
  )
}

// ── 09 估值与交易：估值条款树 ──
function ValuationTree({ task }: ModuleVisualProps) {
  const st = nodeState(task)
  const branches = [
    { label: '投前估值', desc: '可比融资法' },
    { label: '核心条款', desc: '清算优先 / 反稀释' },
    { label: '退出路径', desc: '回报敏感性' },
  ]
  return (
    <VisualFrame title="估值条款树 · 估值区间与交易结构">
      <div className="flex justify-center">
        <VNode title="投资估值" sub="区间与判断" state={st} highlight />
      </div>
      <svg width="100%" height="16" className="my-0.5">
        <path d="M210 0 L60 16 M210 0 L210 16 M210 0 L360 16" stroke={GRAY_LINE} strokeWidth="1.5" fill="none" />
      </svg>
      <div className="grid grid-cols-3 gap-2">
        {branches.map(b => (
          <VNode key={b.label} title={b.label} sub={b.desc} state={st} />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] text-gray-400">回报测算与决策建议：</span>
        <span
          className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${
            task.status === 'DONE' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : STATE_CHIP.pending.cls
          }`}
        >
          {task.status === 'DONE' ? '结论已冻结' : '待投委会决策'}
        </span>
      </div>
    </VisualFrame>
  )
}

/** 模块标识 → 专属主视觉组件 */
export function ModuleVisual({ moduleKey, task, projectName }: ModuleVisualProps & { moduleKey: string }) {
  switch (moduleKey) {
    case 'PROJECT_ENTITY':
      return <EntityStructure task={task} projectName={projectName} />
    case 'PRODUCT_TECHNOLOGY':
      return <TechMap task={task} projectName={projectName} />
    case 'TEAM_GOVERNANCE':
      return <GovernanceTree task={task} projectName={projectName} />
    case 'MARKET_CUSTOMERS':
      return <MarketFunnel task={task} projectName={projectName} />
    case 'COMMERCIALIZATION':
      return <RevenueBridge task={task} projectName={projectName} />
    case 'COMPETITION_MOATS':
      return <CompetitionMatrix task={task} projectName={projectName} />
    case 'FINANCE_ECONOMICS':
      return <FinanceTrend task={task} projectName={projectName} />
    case 'LEGAL_COMPLIANCE':
      return <RiskHeatmap task={task} projectName={projectName} />
    case 'VALUATION_DEAL':
      return <ValuationTree task={task} projectName={projectName} />
    default:
      return null
  }
}

/** 模块专属视觉名称（视图切换标签用） */
export const MODULE_VISUAL_LABELS: Record<string, string> = {
  PROJECT_ENTITY: '交易结构',
  PRODUCT_TECHNOLOGY: '技术图谱',
  TEAM_GOVERNANCE: '治理结构',
  MARKET_CUSTOMERS: '市场漏斗',
  COMMERCIALIZATION: '订单收入桥',
  COMPETITION_MOATS: '竞争矩阵',
  FINANCE_ECONOMICS: '财务趋势',
  LEGAL_COMPLIANCE: '风险热力',
  VALUATION_DEAL: '估值条款树',
}
