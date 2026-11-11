/**
 * 深度尽调报告固定框架
 *
 * 依据《尽调报告的整体框架PPT》：固定「推荐理由 + 八章」，每章按规定的
 * 小节顺序展开，每个小节形成一页可判断的论点：归纳阐述 + 资料论据 + 按需判断。
 * 九大工作台模块仍是资料与研究的数据底座，本文件负责把模块数据映射到
 * 报告的固定章节结构，避免每次生成出现结构漂移。
 */

export interface DeepSectionSpec {
  /** 小节标识 */
  key: string
  /** 小节标题（报告页标题） */
  title: string
  /** 写作指令：该页必须回答/覆盖的内容 */
  instruction: string
  /** 建议配图，供选图与提示使用 */
  imageHint?: string
  /** 风险页 / 评分页 / 建议页 */
  emphasis?: 'risk' | 'score' | 'advice'
}

export interface DeepChapterSpec {
  /** 两位章节号，用于页面大号数字与目录 */
  no: string
  key: string
  title: string
  /** 章节标题页的副标题 */
  kicker: string
  /** 本章使用的九大模块（可多个，按顺序合并资料与事实） */
  moduleKeys: string[]
  /** 标题页 1–2 句总结的写作要求 */
  summaryInstruction: string
  sections: DeepSectionSpec[]
}

/** 报告四原则（原文要求，写入每次生成的系统提示） */
export const DEEP_REPORT_PRINCIPLES = [
  '固定框架：报告固定为「推荐理由 + 第一章至第八章」，章节与每章小节顺序不得增删、改名或调序；页数可按内容增减。',
  '资料不足处理：某些项目阶段可能没有财务尽调、业务进展等资料。缺少资料时，以公司官网、公众号、公开报道等网上宣传信息为主，并在对应页明确提示「资料不足，待补充验证」。',
  '表格优先：能用表格清晰表达的内容一律用表格呈现，文字只保留必要的解释与判断。',
  '图文结合：必须插入 BP、资料中心中与论点相符的图片或截图；图片中的文字不能压缩到看不清，排版要兼顾美观与阅读便利。',
].join('\n')

export const DEEP_RECOMMENDATION_DIMENSIONS = ['行业', '团队背景', '产品和业务进展', '竞争态势', '融资'] as const

export const DEEP_CHAPTERS: DeepChapterSpec[] = [
  {
    no: '01',
    key: 'INDUSTRY',
    title: '行业概述',
    kicker: '行业定义、空间、趋势与风险',
    moduleKeys: ['MARKET_CUSTOMERS', 'COMPETITION_MOATS'],
    summaryInstruction: '用 1–2 句话总结行业阶段、公司所处细分与最关键的行业变量。',
    sections: [
      {
        key: 'DEFINITION',
        title: '行业定义与边界',
        instruction: '先用通俗语言解释公司所在行业到底是什么（例如“什么是可信 AI”“什么是中性原子量子计算”），再说明产业链位置、上下游与公司所处细分环节，不能默认读者懂行业术语。',
        imageHint: '行业图谱、产业链图、技术概念示意图（优先 BP/资料中心）',
      },
      {
        key: 'STATUS',
        title: '行业现状与驱动因素',
        instruction: '说明行业当前所处阶段、市场规模与增速、渗透率、政策与需求驱动因素；给出数据口径与来源，区分事实与推测。',
        imageHint: '市场规模/增速图表、政策文件截图',
      },
      {
        key: 'CHALLENGE',
        title: '行业挑战与痛点',
        instruction: '说明客户当前做法、未被满足的需求，以及成本、效率、合规、安全等方面的痛点；用图表或对比表呈现，不用空泛描述。',
        imageHint: '痛点对比表、客户现状流程图',
      },
      {
        key: 'SOLUTIONS',
        title: '技术路线与解决方案',
        instruction: '列出当前行业存在的主要技术路线/解决方案，说明各自原理、适用场景与代表公司；用表格横向对比。',
        imageHint: '技术路线对比表、方案架构图',
      },
      {
        key: 'TREND',
        title: '技术趋势与路线优劣',
        instruction: '分析各技术路线的优势、局限性与演进趋势，指出公司路线在其中的位置；必须给出反证条件。',
        imageHint: '路线优劣矩阵、时间轴/趋势图',
      },
      {
        key: 'MARKET_SIZE',
        title: '市场空间测算',
        instruction: '给出 TAM/SAM/SOM 或多口径测算，明确假设、数据来源与敏感性；不得只给一个无依据的总数。',
        imageHint: '市场规模测算表、分拆图表',
      },
      {
        key: 'RISK',
        title: '市场风险分析',
        instruction: '总结需求、政策、周期、替代技术与竞争加剧等市场风险，给出触发条件与验证动作。',
        emphasis: 'risk',
      },
    ],
  },
  {
    no: '02',
    key: 'PRODUCT',
    title: '产品和技术分析',
    kicker: '产品矩阵、技术架构与壁垒',
    moduleKeys: ['PRODUCT_TECHNOLOGY'],
    summaryInstruction: '用 1–2 句话总结公司产品矩阵、核心技术路线与当前验证阶段。',
    sections: [
      {
        key: 'OVERVIEW',
        title: '产品全景与定位',
        instruction: '沿着 BP 逐个介绍每一条产品/产品线：解决什么问题、目标客户是谁、当前处于什么阶段（研发/试点/量产）。',
        imageHint: 'BP 产品页、产品矩阵图',
      },
      {
        key: 'ARCHITECTURE',
        title: '技术架构拆解',
        instruction: '结合 BP 架构图拆解系统模块、数据流、软硬件栈与关键依赖，说明公司自研边界。',
        imageHint: '技术拓扑图、架构图（优先 BP 原图）',
      },
      {
        key: 'CORE_TECH',
        title: '核心技术与技术优势',
        instruction: '说明关键技术、性能指标、专利与工程化能力，对比行业水平；区分公司自述与可验证证据。',
        imageHint: '关键指标表、专利清单、性能对比图',
      },
      {
        key: 'LIMITATION',
        title: '产品局限性与边界',
        instruction: '指出产品当前不适用场景、技术依赖、未验证项与交付限制；不得只写优势。',
      },
      {
        key: 'ROUTE_COMPARE',
        title: '技术路线对比',
        instruction: '与替代技术路线/竞品技术做优劣势对比，说明公司路线的稀缺性与可被替代的风险。',
        imageHint: '技术路线对比表',
      },
      {
        key: 'RISK',
        title: '产品与技术风险',
        instruction: '总结研发、量产、供应链、知识产权与技术迭代风险，并给出验证动作。',
        emphasis: 'risk',
      },
    ],
  },
  {
    no: '03',
    key: 'BUSINESS',
    title: '业务进展',
    kicker: '订单、收入、客户与交付',
    moduleKeys: ['COMMERCIALIZATION', 'MARKET_CUSTOMERS'],
    summaryInstruction: '用 1–2 句话总结业务所处阶段、订单/收入进展与最关键的验证结果。',
    sections: [
      {
        key: 'OVERVIEW',
        title: '业务进展总览',
        instruction: '按时间线或阶段总结业务里程碑：产品验证、首批客户、订单、收入、交付；资料不足时明确写“资料不足，以下以公开宣传信息为主”。',
        imageHint: '业务里程碑时间轴、订单台账截图',
      },
      {
        key: 'ORDER_REVENUE',
        title: '订单与收入进展',
        instruction: '用表格列出合同/订单金额、确认收入、客单价、复购与在手订单；所有数字必须来自资料或公开事实。',
        imageHint: '订单/收入表、收入拆分图',
      },
      {
        key: 'CUSTOMER_CHANNEL',
        title: '客户与渠道进展',
        instruction: '分析客户结构、集中度、获客方式、渠道与交付能力；指出大客户依赖与复制性。',
        imageHint: '客户结构图、渠道漏斗图',
      },
      {
        key: 'INTERVIEW',
        title: '客户访谈总结',
        instruction: '如资料中心有客户访谈记录，逐条总结访谈结论、正负面反馈与待验证问题；没有访谈资料时必须明确写“未提供客户访谈记录”，不得编造。',
        imageHint: '访谈纪要截图、客户反馈表',
      },
      {
        key: 'RISK',
        title: '业务进展风险',
        instruction: '总结订单真实性、收入确认、客户集中、交付与回款风险，并给出验证动作。',
        emphasis: 'risk',
      },
    ],
  },
  {
    no: '04',
    key: 'COMPETITION',
    title: '竞争分析',
    kicker: '竞品边界、团队与融资对比',
    moduleKeys: ['COMPETITION_MOATS'],
    summaryInstruction: '用 1–2 句话总结竞争格局、公司位置与最关键的竞争变量。',
    sections: [
      {
        key: 'LANDSCAPE',
        title: '竞争格局与主要玩家',
        instruction: '区分直接竞品、间接竞品与替代方案，列出主要玩家与各自定位；用表格呈现。',
        imageHint: '竞争格局图、竞品清单',
      },
      {
        key: 'PRODUCT_BOUNDARY',
        title: '产品与技术边界对比',
        instruction: '按「公司核心定位、核心目标、核心技术、核心客户、商业模式」五个维度做竞品对比表，说明边界与差异。',
        imageHint: '竞品对比表、技术边界图',
      },
      {
        key: 'TEAM_COMPARE',
        title: '团队背景匹配性对比',
        instruction: '对比竞品团队履历、学术/产业背景与创业方向匹配性，指出公司团队的相对优势与短板。',
        imageHint: '团队履历对比表',
      },
      {
        key: 'FINANCING_COMPARE',
        title: '融资进展对比',
        instruction: '对比竞品融资轮次、金额、估值与投资方，判断公司的融资节奏与估值位置；无公开数据时明确标注。',
        imageHint: '融资对比表、估值区间图',
      },
      {
        key: 'RISK',
        title: '竞争态势风险',
        instruction: '总结价格战、巨头进入、技术替代、渠道壁垒等竞争风险，并给出验证动作。',
        emphasis: 'risk',
      },
    ],
  },
  {
    no: '05',
    key: 'TEAM',
    title: '核心团队',
    kicker: '创始人、团队结构与匹配性',
    moduleKeys: ['TEAM_GOVERNANCE'],
    summaryInstruction: '用 1–2 句话总结创始人与核心团队背景、与创业方向的匹配度及主要短板。',
    sections: [
      {
        key: 'FOUNDER',
        title: '创始人背景与匹配性',
        instruction: '从学历、工作履历、学术研究、论文、谷歌学术引用、顶刊顶会发表等维度介绍创始人，分析其与创业方向的匹配性，并指出可能存在的短板。',
        imageHint: '创始人履历页、论文/引用截图',
      },
      {
        key: 'MEMBERS',
        title: '核心团队其他成员',
        instruction: '逐个介绍核心团队成员：学历、履历、学术成果、项目经验，分析与岗位/方向的匹配性和不足。',
        imageHint: '团队介绍页、核心成员履历表',
      },
      {
        key: 'STRUCTURE',
        title: '团队结构与短板',
        instruction: '分析团队是否覆盖学术人才、商业化、工程化、运营管理四类能力，指出缺位与补强计划。',
        imageHint: '组织架构图、能力矩阵',
      },
      {
        key: 'SCORE',
        title: '团队综合评分',
        instruction: '给出 10 分制团队评分，说明评分依据、扣分项与不同分数对应的投资含义；必须给出明确分数。',
        emphasis: 'score',
      },
    ],
  },
  {
    no: '06',
    key: 'COMPANY',
    title: '公司概况',
    kicker: '历史沿革、股权、组织与资质',
    moduleKeys: ['PROJECT_ENTITY', 'LEGAL_COMPLIANCE'],
    summaryInstruction: '用 1–2 句话总结公司成立时间、历次融资、股权结构完整性及合规概况。',
    sections: [
      {
        key: 'HISTORY',
        title: '公司历史与增资情况',
        instruction: '按时间线列出成立、历次增资/融资、估值变化与关键工商变更，用表格呈现。',
        imageHint: '工商信息截图、融资历史表',
      },
      {
        key: 'EQUITY',
        title: '股权结构与控制权',
        instruction: '说明股东构成、持股比例、期权池、特殊权利与创始人控制权；用股权结构图表呈现。',
        imageHint: '股权结构图、cap table',
      },
      {
        key: 'ORG',
        title: '组织架构',
        instruction: '说明部门设置、人员规模、关键岗位与汇报关系；用组织架构图呈现。',
        imageHint: '组织架构图',
      },
      {
        key: 'IP',
        title: '知识产权与资质',
        instruction: '列出专利、软著、资质认证、参与国家标准/行业标准情况；用表格呈现并注明来源。',
        imageHint: '专利清单、资质证书截图',
      },
      {
        key: 'COMPLIANCE_RISK',
        title: '主体与合规风险',
        instruction: '总结诉讼、关联交易、数据合规、资质缺失等主体与合规风险，并给出验证动作。',
        emphasis: 'risk',
      },
    ],
  },
  {
    no: '07',
    key: 'FINANCE',
    title: '财务尽调',
    kicker: '三表、合同、Pipeline 与回款',
    moduleKeys: ['FINANCE_ECONOMICS', 'COMMERCIALIZATION'],
    summaryInstruction: '用 1–2 句话总结收入规模、盈利/亏损、现金状况与财务规范性；无财务资料时明确提示资料不足。',
    sections: [
      {
        key: 'STATEMENTS',
        title: '三表核心指标',
        instruction: '按年度列出营收、毛利率、净利润、经营现金流、现金及负债等核心指标，并做同比分析；用图表+表格呈现。',
        imageHint: '财务报表截图、三表指标图',
      },
      {
        key: 'CONTRACTS',
        title: '合同签署与收入质量',
        instruction: '分析合同金额、收入确认节奏、应收账款与坏账风险，说明收入质量。',
        imageHint: '合同台账、收入确认表',
      },
      {
        key: 'PIPELINE',
        title: 'Pipeline 与收入可预见性',
        instruction: '按阶段列出 Pipeline 金额与转化率，分析未来 12 个月收入可预见性。',
        imageHint: 'Pipeline 漏斗图',
      },
      {
        key: 'COLLECTION',
        title: '回款与现金流',
        instruction: '分析回款率、账期、现金消耗与跑道，判断融资必要性与时点。',
        imageHint: '回款表、现金流曲线',
      },
      {
        key: 'RISK',
        title: '财务风险',
        instruction: '总结持续经营、融资缺口、单位经济、关联交易与财务规范性风险，并给出验证动作。',
        emphasis: 'risk',
      },
    ],
  },
  {
    no: '08',
    key: 'FINANCING',
    title: '融资规划',
    kicker: '融资方案、机构进展与投资建议',
    moduleKeys: ['VALUATION_DEAL', 'PROJECT_ENTITY'],
    summaryInstruction: '用 1–2 句话总结本轮融资方案、估值水平与投资建议。',
    sections: [
      {
        key: 'PLAN',
        title: '融资方案',
        instruction: '说明本轮轮次、金额、投前/投后估值、股权比例、资金用途与里程碑；用表格呈现。',
        imageHint: '融资方案表、资金用途图',
      },
      {
        key: 'INSTITUTIONS',
        title: '其他机构进展',
        instruction: '说明已沟通/已尽调/已确定领投或跟投的机构进展；没有资料时明确写“未提供其他机构进展”。',
      },
      {
        key: 'VALUATION',
        title: '估值与回报',
        instruction: '给出可比公司/可比融资、估值区间、稀释与回报敏感性分析，指出估值成立条件。',
        imageHint: '可比估值表、回报敏感性表',
      },
      {
        key: 'ADVICE',
        title: '投资建议',
        instruction: '给出明确投资建议（投/有条件投/不投），列出投放条件、交割前验证动作与主要风险。',
        emphasis: 'advice',
      },
    ],
  },
]

export function getDeepChapter(key: string): DeepChapterSpec | undefined {
  return DEEP_CHAPTERS.find(chapter => chapter.key === key)
}

/** 全部小节（按报告顺序），用于统计与提示词 */
export const DEEP_SECTIONS = DEEP_CHAPTERS.flatMap(chapter => chapter.sections)

/** 章节小节总数，用于统计与测试 */
export const DEEP_SECTION_COUNT = DEEP_SECTIONS.length
