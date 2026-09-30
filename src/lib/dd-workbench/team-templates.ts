/**
 * 创业团队评价模板（纯数据，客户端/服务端共用；不含任何服务端依赖）
 *
 * 一级权重固定：实控人/CEO 独占 60 分；团队整体独占 20 分；联创&核心高管共享 20 分（取平均）
 * 联创&核心高管分两种画像：产品&技术（TECH）/ 运营&销售（OPS）
 */

export type ProfileType = 'CEO' | 'TECH' | 'OPS'

/** 维度定义（模板静态结构） */
export interface DimensionDef {
  key: string
  label: string
  hint: string
  group: string
  weight: number
}

/** 实控人/CEO 模板（13 维度，区间系数 6，满分 60） */
export const CEO_TEMPLATE: DimensionDef[] = [
  { key: 'education', label: '学历背景', hint: '是否与创业方向吻合', group: '创业素质', weight: 0.05 },
  { key: 'experience', label: '从业经验', hint: '是否与创业方向吻合', group: '创业素质', weight: 0.15 },
  { key: 'business_sense', label: '商业思维', hint: '利润追求/市场嗅觉/财务功底', group: '创业素质', weight: 0.15 },
  { key: 'financing', label: '融资能力', hint: '表达能力/形象/逻辑思路', group: '创业素质', weight: 0.10 },
  { key: 'system_building', label: '制度建设', hint: '内部管理/是否连续创业', group: '创业素质', weight: 0.10 },
  { key: 'strategy', label: '战略能力', hint: '短中长期是否清晰明了', group: '创业素质', weight: 0.05 },
  { key: 'rallying', label: '号召力', hint: '找人的能力/是否一呼百应', group: '创业素质', weight: 0.05 },
  { key: 'character', label: '人品性格', hint: '真诚度/品行修养/过往风评/背调', group: '创业素质', weight: 0.05 },
  { key: 'vision', label: '格局愿景', hint: '分享精神/对成功的渴望', group: '创业素质', weight: 0.05 },
  { key: 'capital_invested', label: '投入资金', hint: '投入与身家相关', group: '创业意愿', weight: 0.05 },
  { key: 'time_invested', label: '投入精力', hint: '上班时间/是否兼职/其他副业', group: '创业意愿', weight: 0.05 },
  { key: 'family_support', label: '家境支持', hint: '家境实力/家人是否支持创业', group: '创业意愿', weight: 0.05 },
  { key: 'salary', label: '薪酬', hint: '与发展阶段匹配', group: '创业意愿', weight: 0.10 },
]

/** 产品&技术画像模板（10 维度，区间系数 2，满分 20） */
export const TECH_TEMPLATE: DimensionDef[] = [
  { key: 'education', label: '学历背景', hint: '是否与创业方向吻合', group: '创业素质', weight: 0.10 },
  { key: 'experience', label: '从业经验', hint: '是否与创业方向吻合', group: '创业素质', weight: 0.15 },
  { key: 'role_involvement', label: '参与角色', hint: '全流程亲自下场干/把握大方向/问题专家/吉祥物', group: '创业素质', weight: 0.15 },
  { key: 'complementarity', label: '能力互补性', hint: '能力是否与CEO互补', group: '创业素质', weight: 0.10 },
  { key: 'character', label: '人品性格', hint: '真诚度/品行修养/背调', group: '创业素质', weight: 0.05 },
  { key: 'capital_invested', label: '投入资金', hint: '投入与身家相关', group: '创业意愿', weight: 0.10 },
  { key: 'time_invested', label: '投入精力', hint: '上班时间/是否兼职/其他副业', group: '创业意愿', weight: 0.05 },
  { key: 'salary', label: '薪酬', hint: '与发展阶段匹配', group: '创业意愿', weight: 0.15 },
  { key: 'equity', label: '持股情况', hint: '是否与能力匹配', group: '创业意愿', weight: 0.10 },
  { key: 'family_support', label: '家境支持', hint: '是否等米下锅/刚性支出情况', group: '创业意愿', weight: 0.05 },
]

/** 运营&销售画像模板（11 维度，区间系数 2，满分 20） */
export const OPS_TEMPLATE: DimensionDef[] = [
  { key: 'education', label: '学历背景', hint: '是否与创业方向吻合', group: '创业素质', weight: 0.10 },
  { key: 'experience', label: '从业经验', hint: '是否与创业方向吻合', group: '创业素质', weight: 0.15 },
  { key: 'role_involvement', label: '参与角色', hint: '全流程亲自下场干/把握大方向/问题专家/吉祥物', group: '创业素质', weight: 0.15 },
  { key: 'business_sense', label: '商业嗅觉', hint: '市场水温感知/客户需求把握', group: '创业素质', weight: 0.05 },
  { key: 'complementarity', label: '能力互补性', hint: '能力是否与CEO互补', group: '创业素质', weight: 0.05 },
  { key: 'character', label: '人品性格', hint: '真诚度/品行修养/背调', group: '创业素质', weight: 0.05 },
  { key: 'capital_invested', label: '投入资金', hint: '投入与身家相关', group: '创业意愿', weight: 0.05 },
  { key: 'time_invested', label: '投入精力', hint: '上班时间/是否兼职/其他副业', group: '创业意愿', weight: 0.10 },
  { key: 'salary', label: '薪酬', hint: '与发展阶段匹配', group: '创业意愿', weight: 0.15 },
  { key: 'equity', label: '持股情况', hint: '是否与能力匹配', group: '创业意愿', weight: 0.10 },
  { key: 'family_support', label: '家境支持', hint: '是否等米下锅/刚性支出情况', group: '创业意愿', weight: 0.05 },
]

/** 团队整体模板（4 维度，区间系数 2，满分 20） */
export const TEAM_TEMPLATE: DimensionDef[] = [
  { key: 'completeness', label: '完整性', hint: '目前是否有明显短板', group: '完整性', weight: 0.25 },
  { key: 'scalability', label: '可扩展性', hint: '未来引入核心人员的意愿和可行性', group: '完整性', weight: 0.10 },
  { key: 'past_connection', label: '过往连接', hint: '同事、同学等，看合作时间', group: '稳定性', weight: 0.40 },
  { key: 'interest_binding', label: '利益绑定', hint: '股权分布是否合理', group: '稳定性', weight: 0.25 },
]

export const PROFILE_TEMPLATES: Record<ProfileType, DimensionDef[]> = {
  CEO: CEO_TEMPLATE,
  TECH: TECH_TEMPLATE,
  OPS: OPS_TEMPLATE,
}

export const PROFILE_LABELS: Record<ProfileType, string> = {
  CEO: '实控人/CEO（60分）',
  TECH: '产品&技术画像（20分）',
  OPS: '运营&销售画像（20分）',
}

/** 身份下拉选项（手动校正成员身份用） */
export const PROFILE_OPTIONS: Array<{ value: ProfileType; label: string }> = [
  { value: 'CEO', label: '实控人/CEO' },
  { value: 'TECH', label: '联创·产品&技术' },
  { value: 'OPS', label: '联创·运营&销售' },
]
