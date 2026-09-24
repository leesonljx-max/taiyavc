/**
 * 尽调框架模板 v1：基础必做九大模块
 *
 * 依据：《项目尽调模块优化技术规划与执行方案》§3 尽调框架与投委会输出
 * 框架分三层：基础必做（本模板）+ 行业可插拔（后续版本扩展）+ 交易按需
 * 每个模块不得只输出摘要，必须有结论、证据、缺口、风险等级和下一步动作。
 *
 * 发起尽调批次时按本模板自动生成 9 个模块任务（templateVersion 记录在批次上）。
 */

/** 模板版本（批次创建时固化，用于后续模板升级时的兼容判断） */
export const DD_TEMPLATE_VERSION = 'v1'

export interface DDTemplateModule {
  /** 模块标识（存储于 DDTask.moduleKey，批次内唯一） */
  key: string
  /** 中文名称 */
  name: string
  /** 投委会核心问题（模块工作台的问题树根问题） */
  coreQuestion: string
  /** 主要输入与可视化输出（指导资料准备与报告排版） */
  inputs: string
  /** 建议责任角色（仅作分配建议，实际负责人存 ownerId） */
  ownerRole: string
  /** 展示顺序 */
  sortKey: number
}

/** 九大模块（顺序 = 文档 §3 表格顺序，即投委会阅读顺序） */
export const DD_TEMPLATE_MODULES: DDTemplateModule[] = [
  {
    key: 'PROJECT_ENTITY',
    name: '项目与主体',
    coreQuestion: '主体、轮次、融资诉求是否一致？',
    inputs: '工商与融资信息表；交易结构图；关键事实卡',
    ownerRole: '投资经理',
    sortKey: 1,
  },
  {
    key: 'PRODUCT_TECHNOLOGY',
    name: '产品与技术',
    coreQuestion: '技术是否可验证、可量产、可持续领先？',
    inputs: '产品架构；路线图；性能对标；专利与技术红旗',
    ownerRole: '行业研究员/专家',
    sortKey: 2,
  },
  {
    key: 'TEAM_GOVERNANCE',
    name: '团队与治理',
    coreQuestion: '创始人与关键岗位能否支撑阶段目标？',
    inputs: '团队履历矩阵；股权与激励表；关联交易图',
    ownerRole: '投资经理/法务',
    sortKey: 3,
  },
  {
    key: 'MARKET_CUSTOMERS',
    name: '市场与客户',
    coreQuestion: '市场空间、需求真实性与切入路径是否成立？',
    inputs: 'TAM SAM SOM 假设表；客户画像；行业演化图',
    ownerRole: '行业研究员',
    sortKey: 4,
  },
  {
    key: 'COMMERCIALIZATION',
    name: '商业化与订单',
    coreQuestion: '收入质量、订单真实性和复购逻辑如何？',
    inputs: '漏斗；订单台账；收入拆分；客户集中度图',
    ownerRole: '投资经理/财务',
    sortKey: 5,
  },
  {
    key: 'COMPETITION_MOATS',
    name: '竞争与壁垒',
    coreQuestion: '替代方案、竞品位置、窗口期与壁垒是什么？',
    inputs: '竞品矩阵；价值链图；技术与渠道对比',
    ownerRole: '行业研究员',
    sortKey: 6,
  },
  {
    key: 'FINANCE_ECONOMICS',
    name: '财务与单位经济',
    coreQuestion: '增长、毛利、现金消耗和融资需求是否自洽？',
    inputs: '三表摘要；收入桥；现金跑道；情景敏感性',
    ownerRole: '财务',
    sortKey: 7,
  },
  {
    key: 'LEGAL_COMPLIANCE',
    name: '法务合规与风险',
    coreQuestion: '产权、诉讼、数据、监管和交易风险可否接受？',
    inputs: '风险清单；主体关系图；合规核验表',
    ownerRole: '法务',
    sortKey: 8,
  },
  {
    key: 'VALUATION_DEAL',
    name: '估值与交易',
    coreQuestion: '估值、条款、退出和收益是否匹配风险？',
    inputs: '可比融资；估值区间；cap table；回报敏感性',
    ownerRole: '投资经理',
    sortKey: 9,
  },
]

/** 按模块标识取模板定义 */
export function getTemplateModule(key: string): DDTemplateModule | undefined {
  return DD_TEMPLATE_MODULES.find(m => m.key === key)
}

/** 模块标识 → 中文名（报告与前端渲染共用） */
export const DD_MODULE_NAME_LABELS: Record<string, string> = Object.fromEntries(
  DD_TEMPLATE_MODULES.map(m => [m.key, m.name])
)
