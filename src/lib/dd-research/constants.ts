/**
 * 尽调工作台 · 全网研究常量
 *
 * 研究事实只描述「公开可核验信息」；缺口目录描述「公开信息通常拿不到、
 * 但投委会必须看到的证据」。两者分离，避免把检索不到误判成项目有问题。
 */

export type DDGapSeverity = 'BLOCKING' | 'RECOMMENDED'

export interface DDRequirement {
  moduleKey: string
  key: string
  label: string
  severity: DDGapSeverity
  /** 缺了会怎样（给项目维护人看） */
  reason: string
  /** 建议上传的资料类型 */
  suggestedTypes: string
  /** 覆盖判定关键词（大小写不敏感，任一命中即视为覆盖） */
  keywords: string[]
}

/** 研究与报告模板版本：任一变动都会使旧版本失效并触发重新生成 */
export const DD_RESEARCH_VERSION = 'v2.8'
export const DD_DECK_VERSION = 'v2.8'

export const DD_SEARCH_BUDGET = {
  /** 9 模块 × 8 条查询；预算内允许模块级补搜 */
  maxSearches: 72,
  maxResultsPerQuery: 5,
  /** 每模块保留来源上限（去重后） */
  maxSourcesPerModule: 12,
  /** 单来源正文保留上限 */
  contentMaxChars: 30_000,
} as const

export const DD_MODULE_KEYS = [
  'PROJECT_ENTITY',
  'PRODUCT_TECHNOLOGY',
  'TEAM_GOVERNANCE',
  'MARKET_CUSTOMERS',
  'COMMERCIALIZATION',
  'COMPETITION_MOATS',
  'FINANCE_ECONOMICS',
  'LEGAL_COMPLIANCE',
  'VALUATION_DEAL',
] as const

export type DDResearchModuleKey = (typeof DD_MODULE_KEYS)[number]

// ── 必备证据目录（缺口引擎唯一事实来源） ──

export const DD_REQUIREMENTS: DDRequirement[] = [
  // 1. 项目与主体
  {
    moduleKey: 'PROJECT_ENTITY',
    key: 'BUSINESS_REGISTRATION',
    label: '工商登记与主体信息',
    severity: 'BLOCKING',
    reason: '主体、成立时间、注册资本与股东信息是交易文件一致性的基线，公开检索常缺最新变更。',
    suggestedTypes: '营业执照、工商信息截图、企查查/天眼查报告',
    keywords: ['工商', '统一社会信用代码', '注册资本', '成立时间', '法定代表人', '股东信息', '登记机关'],
  },
  {
    moduleKey: 'PROJECT_ENTITY',
    key: 'CAP_TABLE',
    label: '股权结构与历史沿革',
    severity: 'BLOCKING',
    reason: '股权代持、历史增资与稀释直接影响本轮持股比例和退出分配，网络无法替代公司提供的 cap table。',
    suggestedTypes: '股权结构图、股东名册、历次增资/转让协议',
    keywords: ['股权结构', '持股比例', '股东名册', 'cap table', '股权代持', '增资', '股权转让'],
  },
  {
    moduleKey: 'PROJECT_ENTITY',
    key: 'DEAL_STRUCTURE',
    label: '本轮交易结构',
    severity: 'BLOCKING',
    reason: '投前/投后估值、老股比例、可转债或 SAFE 结构决定风险收益分配，必须由交易文件确认。',
    suggestedTypes: 'Term sheet、投资协议、增资协议、交易结构图',
    keywords: ['交易结构', '投前估值', '投后估值', '老股', '可转债', '增资', 'safe'],
  },
  {
    moduleKey: 'PROJECT_ENTITY',
    key: 'FINANCING_HISTORY',
    label: '历次融资与投资方',
    severity: 'RECOMMENDED',
    reason: '历史轮次、估值与投资方背景用于判断定价连续性和股东资源。',
    suggestedTypes: '历次融资协议、交割证明、融资 PR',
    keywords: ['融资', '天使轮', 'pre-a', 'a轮', 'b轮', '投资方', '估值'],
  },

  // 2. 产品与技术
  {
    moduleKey: 'PRODUCT_TECHNOLOGY',
    key: 'PRODUCT_SPECS',
    label: '产品参数与形态',
    severity: 'BLOCKING',
    reason: '没有规格书就无法判断产品成熟度、对标口径与客户适配性。',
    suggestedTypes: '产品手册、规格书、检测报告、演示视频',
    keywords: ['产品', '型号', '规格', '参数', '性能指标', '技术指标'],
  },
  {
    moduleKey: 'PRODUCT_TECHNOLOGY',
    key: 'MASS_PRODUCTION',
    label: '量产、良率与交付验证',
    severity: 'BLOCKING',
    reason: '从样机到量产是最常见的估值杀手，公开信息通常只有宣传口径。',
    suggestedTypes: '测试报告、量产计划、良率记录、客户验证报告',
    keywords: ['量产', '良率', '产能', '交付', '客户验证', '中试', '试产'],
  },
  {
    moduleKey: 'PRODUCT_TECHNOLOGY',
    key: 'PATENTS',
    label: '专利与知识产权',
    severity: 'RECOMMENDED',
    reason: '专利数量与归属影响技术壁垒和自由实施风险。',
    suggestedTypes: '专利证书、专利清单、软著证书',
    keywords: ['专利', '发明', '实用新型', '知识产权', '软著', 'pct'],
  },
  {
    moduleKey: 'PRODUCT_TECHNOLOGY',
    key: 'TECH_ROUTE',
    label: '技术路线与架构',
    severity: 'RECOMMENDED',
    reason: '技术路线决定成本曲线、可扩展性与被替代风险。',
    suggestedTypes: '技术白皮书、架构图、研发路线图',
    keywords: ['技术路线', '架构', '算法', '工艺', '原理', '研发'],
  },

  // 3. 团队与治理
  {
    moduleKey: 'TEAM_GOVERNANCE',
    key: 'FOUNDER_RESUME',
    label: '创始人履历与背景',
    severity: 'BLOCKING',
    reason: '创始人经历、连续创业与失败记录无法只靠公开报道验证，需要完整简历与背调。',
    suggestedTypes: '创始人简历、背景调查报告、离职证明',
    keywords: ['创始人', '履历', 'ceo', '董事长', '工作经历', '背景调查'],
  },
  {
    moduleKey: 'TEAM_GOVERNANCE',
    key: 'EQUITY_INCENTIVE',
    label: '股权激励与期权池',
    severity: 'BLOCKING',
    reason: '期权池比例、授予与回购安排影响团队稳定性和未来稀释。',
    suggestedTypes: '股权激励计划、期权协议、员工持股平台协议',
    keywords: ['股权激励', '期权池', 'esop', '激励计划', '持股平台'],
  },
  {
    moduleKey: 'TEAM_GOVERNANCE',
    key: 'TEAM_PROFILE',
    label: '核心团队完整履历',
    severity: 'RECOMMENDED',
    reason: '关键岗位是否补齐决定战略能否落地。',
    suggestedTypes: '团队名单、核心成员简历、组织架构图',
    keywords: ['团队', 'cto', 'cfo', 'coo', '核心成员', '组织架构'],
  },
  {
    moduleKey: 'TEAM_GOVERNANCE',
    key: 'RELATED_PARTY',
    label: '关联交易与关联公司',
    severity: 'RECOMMENDED',
    reason: '关联采购、资金占用与同业竞争是治理红旗。',
    suggestedTypes: '关联方清单、关联交易说明、审计附注',
    keywords: ['关联交易', '关联公司', '关联方', '同业竞争', '资金占用'],
  },

  // 4. 市场与客户
  {
    moduleKey: 'MARKET_CUSTOMERS',
    key: 'DEMAND_VALIDATION',
    label: '需求验证与付费意愿',
    severity: 'BLOCKING',
    reason: '市场规模可以引用报告，但客户是否真的付费必须靠访谈、POC 或订单验证。',
    suggestedTypes: '客户访谈纪要、POC 报告、意向订单、付费记录',
    keywords: ['需求验证', '付费', '意向订单', '访谈', 'poc', '试点', '续费'],
  },
  {
    moduleKey: 'MARKET_CUSTOMERS',
    key: 'MARKET_SIZE',
    label: '市场规模与测算口径',
    severity: 'RECOMMENDED',
    reason: 'TAM/SAM/SOM 的口径决定增长故事是否可信。',
    suggestedTypes: '行业报告、市场规模测算表',
    keywords: ['市场规模', 'tam', 'sam', 'som', '市场空间', '亿元'],
  },
  {
    moduleKey: 'MARKET_CUSTOMERS',
    key: 'POLICY',
    label: '政策与监管环境',
    severity: 'RECOMMENDED',
    reason: '补贴、准入与监管变化可能瞬间改变行业经济性。',
    suggestedTypes: '政策原文、监管问答、行业标准',
    keywords: ['政策', '规划', '监管', '补贴', '标准', '准入'],
  },
  {
    moduleKey: 'MARKET_CUSTOMERS',
    key: 'CUSTOMER_CASES',
    label: '标杆客户与落地案例',
    severity: 'RECOMMENDED',
    reason: '标杆客户和复购是最直接的需求证据。',
    suggestedTypes: '客户名单、案例集、复购记录',
    keywords: ['客户', '案例', '标杆', '落地', '复购', '续约'],
  },

  // 5. 商业化与订单
  {
    moduleKey: 'COMMERCIALIZATION',
    key: 'ORDER_LEDGER',
    label: '订单台账与合同',
    severity: 'BLOCKING',
    reason: '在手订单、框架协议与确认口径无法从公开信息完整还原，是收入预测的基础。',
    suggestedTypes: '订单明细、合同台账、中标通知书',
    keywords: ['订单', '合同', '在手订单', '中标', '采购', '框架协议'],
  },
  {
    moduleKey: 'COMMERCIALIZATION',
    key: 'REVENUE_BREAKDOWN',
    label: '收入拆分与回款',
    severity: 'BLOCKING',
    reason: '按客户/产品/区域拆分收入与回款节奏，才能判断增长质量。',
    suggestedTypes: '收入明细表、客户收入表、回款记录',
    keywords: ['收入', '营收', '回款', '确认收入', '毛利', '客单价'],
  },
  {
    moduleKey: 'COMMERCIALIZATION',
    key: 'CUSTOMER_CONCENTRATION',
    label: '客户集中度与复购',
    severity: 'RECOMMENDED',
    reason: '大客户依赖与复购率决定收入的可持续性。',
    suggestedTypes: '客户收入占比表、复购统计',
    keywords: ['客户集中度', '复购', '大客户', '留存', '流失'],
  },
  {
    moduleKey: 'COMMERCIALIZATION',
    key: 'CHANNEL',
    label: '渠道与合作伙伴',
    severity: 'RECOMMENDED',
    reason: '渠道结构影响获客成本与规模化速度。',
    suggestedTypes: '渠道协议、经销商名单、合作备忘录',
    keywords: ['渠道', '经销', '代理', '合作伙伴', '生态', '分销'],
  },

  // 6. 竞争与壁垒
  {
    moduleKey: 'COMPETITION_MOATS',
    key: 'COMPETITOR_MATRIX',
    label: '竞品矩阵与替代方案',
    severity: 'BLOCKING',
    reason: '公开信息能列出竞品，但同一口径的性能/价格对比需要公司提供。',
    suggestedTypes: '竞品分析、客户对比测试、报价单',
    keywords: ['竞品', '竞争对手', '对比', '替代方案', '对标'],
  },
  {
    moduleKey: 'COMPETITION_MOATS',
    key: 'SWITCHING_COST',
    label: '壁垒与客户切换成本',
    severity: 'BLOCKING',
    reason: '认证周期、生态绑定与迁移成本是壁垒的核心，公开报道往往夸大。',
    suggestedTypes: '客户访谈、认证周期说明、生态合作协议',
    keywords: ['壁垒', '切换成本', '认证周期', '迁移成本', '专利布局', '生态绑定'],
  },
  {
    moduleKey: 'COMPETITION_MOATS',
    key: 'MARKET_SHARE',
    label: '市场份额与价格带',
    severity: 'RECOMMENDED',
    reason: '份额与价格带决定竞争位置和毛利空间。',
    suggestedTypes: '行业份额报告、报价单',
    keywords: ['市场份额', '市占率', '价格', '报价', '份额'],
  },
  {
    moduleKey: 'COMPETITION_MOATS',
    key: 'TECH_ROUTE_COMPARISON',
    label: '技术路线对比',
    severity: 'RECOMMENDED',
    reason: '路线优劣决定长期成本与性能上限。',
    suggestedTypes: '技术对比表、第三方评测',
    keywords: ['技术路线', '性能对比', '参数对比', '评测'],
  },

  // 7. 财务与单位经济
  {
    moduleKey: 'FINANCE_ECONOMICS',
    key: 'FINANCIAL_STATEMENTS',
    label: '三表与管理报表',
    severity: 'BLOCKING',
    reason: '没有财务报表无法验证收入、成本、资产与负债，公开数据不足以支撑估值。',
    suggestedTypes: '审计报告、资产负债表、利润表、现金流量表、管理报表',
    keywords: ['资产负债表', '利润表', '现金流量表', '审计报告', '财务报表', '管理报表'],
  },
  {
    moduleKey: 'FINANCE_ECONOMICS',
    key: 'GROSS_MARGIN',
    label: '毛利与单位经济',
    severity: 'BLOCKING',
    reason: '毛利率、获客成本与履约成本决定规模是否创造价值。',
    suggestedTypes: '成本结构表、毛利测算、单位经济模型',
    keywords: ['毛利率', '单位经济', '成本结构', '获客成本', '履约成本'],
  },
  {
    moduleKey: 'FINANCE_ECONOMICS',
    key: 'CASH_RUNWAY',
    label: '现金与 runway',
    severity: 'BLOCKING',
    reason: '现金余额、月均消耗与融资到账时间决定公司能否活到下一里程碑。',
    suggestedTypes: '银行流水、资金计划、现金流预测',
    keywords: ['现金', 'runway', '资金', '烧钱', '现金流', '账期'],
  },
  {
    moduleKey: 'FINANCE_ECONOMICS',
    key: 'REVENUE_RECOGNITION',
    label: '收入确认政策',
    severity: 'RECOMMENDED',
    reason: '确认口径差异会显著改变收入与利润表现。',
    suggestedTypes: '会计政策说明、审计调整说明',
    keywords: ['收入确认', '会计准则', '确认政策', '审计调整'],
  },

  // 8. 法务合规与风险
  {
    moduleKey: 'LEGAL_COMPLIANCE',
    key: 'LITIGATION',
    label: '诉讼、仲裁与被执行',
    severity: 'RECOMMENDED',
    reason: '公开检索未发现诉讼不等于不存在，仍需法务核验与公司承诺。',
    suggestedTypes: '诉讼清单、法务尽调报告、无诉讼承诺函',
    keywords: ['诉讼', '仲裁', '判决', '被执行人', '失信', '开庭'],
  },
  {
    moduleKey: 'LEGAL_COMPLIANCE',
    key: 'IP_DISPUTE',
    label: '知识产权纠纷',
    severity: 'RECOMMENDED',
    reason: '专利无效、侵权与商标异议会直接冲击核心产品。',
    suggestedTypes: '知识产权尽调报告、纠纷清单',
    keywords: ['知识产权', '侵权', '专利无效', '商标异议', '无效宣告'],
  },
  {
    moduleKey: 'LEGAL_COMPLIANCE',
    key: 'DATA_COMPLIANCE',
    label: '数据合规与隐私',
    severity: 'RECOMMENDED',
    reason: '个人信息采集、跨境传输与等保要求可能带来整改成本。',
    suggestedTypes: '隐私政策、等保备案、数据合规评估',
    keywords: ['数据合规', '隐私', '个人信息', '网络安全', '等保', '跨境'],
  },
  {
    moduleKey: 'LEGAL_COMPLIANCE',
    key: 'LICENSE',
    label: '经营资质与许可',
    severity: 'RECOMMENDED',
    reason: '缺少必需资质会阻断业务开展或导致历史收入不合规。',
    suggestedTypes: '许可证、备案证明、资质证书',
    keywords: ['资质', '许可证', '备案', '牌照', '经营许可', '认证'],
  },

  // 9. 估值与交易
  {
    moduleKey: 'VALUATION_DEAL',
    key: 'COMPARABLE_FINANCING',
    label: '可比融资与估值区间',
    severity: 'BLOCKING',
    reason: '公开可比交易只能给出区间，具体轮次、条款与估值需要数据库导出或 FA 材料确认。',
    suggestedTypes: '可比交易清单、融资数据库导出、FA 估值材料',
    keywords: ['可比', '估值', '融资', 'ps', 'pe', '倍数', '区间'],
  },
  {
    moduleKey: 'VALUATION_DEAL',
    key: 'TERM_SHEET',
    label: '条款清单与优先权',
    severity: 'BLOCKING',
    reason: '清算优先、反稀释、对赌与回购条款决定下行保护，必须看原始条款。',
    suggestedTypes: 'Term sheet、投资协议、股东协议',
    keywords: ['term sheet', '条款', '优先清算', '反稀释', '对赌', '回购', '领售'],
  },
  {
    moduleKey: 'VALUATION_DEAL',
    key: 'RETURN_MODEL',
    label: '回报测算与退出路径',
    severity: 'RECOMMENDED',
    reason: 'IRR、MOIC 与退出情景是投委会决策的量化依据。',
    suggestedTypes: '回报测算表、退出路径分析',
    keywords: ['回报', 'irr', 'moic', '退出', 'ipo', '并购'],
  },
  {
    moduleKey: 'VALUATION_DEAL',
    key: 'PREFERENCE_RIGHTS',
    label: '治理与保护条款',
    severity: 'RECOMMENDED',
    reason: '董事会席位、一票否决与信息权影响投后管理能力。',
    suggestedTypes: '股东协议、公司章程',
    keywords: ['优先权', '一票否决', '董事会', '保护条款', '信息权'],
  },
]

export function requirementsForModule(moduleKey: string): DDRequirement[] {
  return DD_REQUIREMENTS.filter(r => r.moduleKey === moduleKey)
}

// ── 来源分级 ──

const A_DOMAINS = [
  'gov.cn', 'samr.gov.cn', 'gsxt.gov.cn', 'cnipa.gov.cn', 'stats.gov.cn',
  'sse.com.cn', 'szse.cn', 'bse.cn', 'csrc.gov.cn', 'court.gov.cn',
  'npc.gov.cn', 'ndrc.gov.cn', 'miit.gov.cn', 'sec.gov', 'hkexnews.hk',
  // 事业单位/高校/科研机构官网
  'edu.cn', 'ac.cn', 'cas.cn',
]

const B_DOMAINS = [
  '36kr.com', 'caixin.com', 'yicai.com', 'cls.cn', 'jiemian.com', 'stcn.com',
  'cs.com.cn', 'xinhuanet.com', 'people.com.cn', '21jingji.com', 'eeo.com.cn',
  'iresearch.com.cn', 'qianzhan.com', '199it.com', 'analysys.cn', 'iresearch.cn',
  'cnki.net', 'wanfangdata.com.cn', 'arxiv.org', 'nature.com', 'science.org',
  'ieee.org', 'acm.org', 'patsnap.com', 'incopat.com',
]

const C_DOMAINS = [
  'sohu.com', 'sina.com.cn', 'sina.cn', '163.com', 'qq.com', 'tencent.com',
  'ifeng.com', 'baijiahao.baidu.com', 'thepaper.cn', 'toutiao.com',
  'eastmoney.com', '10jqka.com.cn', 'cnstock.com', 'hexun.com',
]

const D_DOMAINS = [
  'weibo.com', 'zhihu.com', 'tieba.baidu.com', 'douban.com', 'xueqiu.com',
  'guba.eastmoney.com', 'mp.weixin.qq.com', 'douyin.com', 'xiaohongshu.com',
  'bilibili.com',
]

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function matchesDomain(domain: string, list: string[]): boolean {
  return list.some(d => domain === d || domain.endsWith(`.${d}`))
}

export function gradeSource(url: string): 'A' | 'B' | 'C' | 'D' {
  const domain = domainOf(url)
  if (!domain) return 'D'
  if (matchesDomain(domain, A_DOMAINS)) return 'A'
  if (matchesDomain(domain, B_DOMAINS)) return 'B'
  if (matchesDomain(domain, D_DOMAINS)) return 'D'
  if (matchesDomain(domain, C_DOMAINS)) return 'C'
  // 企业官网/未知站点按 C 处理；无署名聚合与论坛归 D
  return domain.includes('blog') || domain.includes('forum') ? 'D' : 'C'
}

export function sourceTypeOf(grade: 'A' | 'B' | 'C' | 'D'): 'OFFICIAL' | 'REPORT' | 'MEDIA' | 'WEB' {
  if (grade === 'A') return 'OFFICIAL'
  if (grade === 'B') return 'REPORT'
  if (grade === 'C') return 'MEDIA'
  return 'WEB'
}

// ── 覆盖度 ──

export type DDModuleCoverageStatus = 'READY' | 'PARTIAL' | 'INSUFFICIENT'

export function moduleStatusFromCoverage(coverage: number): DDModuleCoverageStatus {
  if (coverage >= 0.75) return 'READY'
  if (coverage >= 0.35) return 'PARTIAL'
  return 'INSUFFICIENT'
}

/** 幻灯片与模块页统一的展示顺序 */
export const DD_MODULE_ORDER = [...DD_MODULE_KEYS]
