/**
 * 投研分析模块的 DeepSeek prompt 配置
 *
 * 每个模块定义：
 * - searchQueries: Tavily 搜索关键词构建函数
 * - systemPrompt: DeepSeek system 角色 prompt
 * - userPromptBuilder: DeepSeek user prompt 构建函数
 * - responseFormat: 期望的 JSON 返回结构描述
 */

import type { ResearchModuleType } from './research-permissions'

interface ProjectInfo {
  name: string
  companyFullName?: string | null
  industry?: string | null
  companyPosition?: string | null
  mainProducts?: string | null
  coreAdvantage?: string | null
  coreTeam?: string | null
  competitors?: string | null
  description?: string | null
  totalAmount: string
  raisedAmount?: string | null
}

interface ModulePromptConfig {
  /** Tavily 搜索关键词构建（返回空数组表示不需要 Tavily） */
  searchQueries: (project: ProjectInfo) => string[]
  /** DeepSeek system prompt */
  systemPrompt: string
  /** DeepSeek user prompt 构建函数 */
  userPromptBuilder: (
    project: ProjectInfo,
    externalInfo: string,
    documentText: string,
    manualContent: string
  ) => string
}

export const MODULE_PROMPTS: Record<ResearchModuleType, ModulePromptConfig> = {
  // ── 1. 行业分析 ──
  INDUSTRY: {
    searchQueries: (p) => [
      `${p.industry || p.name} 行业 发展阶段 市场规模`,
      `${p.industry || p.name} 技术成熟度 TRL`,
      `${p.industry || p.name} 行业趋势 2026`,
    ],
    systemPrompt: '你是一位资深投资分析师，擅长行业研究和技术成熟度评估。请基于公开信息分析，无法确定的信息请标注"未公开"。',
    userPromptBuilder: (p, externalInfo, documentText, manualContent) => `请根据以下信息，分析"${p.industry || p.name}"行业的现状和发展趋势。

项目名称：${p.name}
所处行业：${p.industry || '未填写'}

外网搜索结果（Tavily 检索）：
${externalInfo || '未找到相关外网信息'}

${documentText ? `上传文档内容：\n${documentText}\n\n` : ''}${manualContent ? `用户补充信息：\n${manualContent}\n\n` : ''}请从以下维度分析，严格按 JSON 格式输出：
{
  "developmentStage": "行业发展阶段（萌芽期/成长期/成熟期/衰退期）",
  "marketSize": "市场规模（如'约500亿元'）",
  "growthRate": "年增长率（如'15%'）",
  "trlLevel": 7,
  "trlDescription": "TRL技术成熟度等级描述（1-9级，9为最成熟）",
  "keyTrends": ["趋势1", "趋势2", "趋势3"],
  "challenges": ["挑战1", "挑战2"],
  "summary": "行业分析一句话总结（不超过100字）"
}`,
  },

  // ── 2. 产品和技术 ──
  PRODUCT_TECH: {
    searchQueries: (p) => [
      `${p.name} 产品 技术`,
      `${p.mainProducts || p.name} 技术路线`,
      `${p.name} ${p.industry || ''} 技术优势`,
    ],
    systemPrompt: '你是一位资深投资分析师，擅长产品和技术分析。请基于公开信息分析，无法确定的信息请标注"未公开"。',
    userPromptBuilder: (p, externalInfo, documentText, manualContent) => `请根据以下信息，分析"${p.name}"的产品和技术。

项目名称：${p.name}
主要产品：${p.mainProducts || '未填写'}
公司定位：${p.companyPosition || '未填写'}
核心优势：${p.coreAdvantage || '未填写'}

外网搜索结果（Tavily 检索）：
${externalInfo || '未找到相关外网信息'}

${documentText ? `上传文档内容：\n${documentText}\n\n` : ''}${manualContent ? `用户补充信息：\n${manualContent}\n\n` : ''}请从以下维度分析，严格按 JSON 格式输出：
{
  "productPositioning": "产品定位描述",
  "targetMarket": "目标市场",
  "techRoute": "核心技术路线",
  "techAdvantages": ["技术优势1", "技术优势2"],
  "differentiation": "差异化竞争力",
  "techBarriers": ["技术壁垒1", "技术壁垒2"],
  "maturity": "产品成熟度（概念/研发/测试/量产）",
  "summary": "产品和技术一句话总结（不超过100字）"
}`,
  },

  // ── 3. 竞争分析 ──
  COMPETITION: {
    searchQueries: (p) => [
      `${p.name} 竞品 竞争对手`,
      `${p.mainProducts || p.name} 同行 竞品`,
      `${p.name} 竞品 融资`,
    ],
    systemPrompt: '你是一位资深投资分析师，擅长竞争格局与市场竞品研究。请基于公开信息分析，无法确定的信息请标注"未公开"。',
    userPromptBuilder: (p, externalInfo, documentText, manualContent) => `请根据以下信息，分析"${p.name}"的竞争格局。

项目名称：${p.name}
主要产品：${p.mainProducts || '未填写'}
已知竞争对手：${p.competitors || '未填写'}

外网搜索结果（Tavily 检索）：
${externalInfo || '未找到相关外网信息'}

${documentText ? `上传文档内容：\n${documentText}\n\n` : ''}${manualContent ? `用户补充信息：\n${manualContent}\n\n` : ''}请整理 3-8 个主要竞争对手，从产品定位、市场策略、业务进展、团队背景等维度分析，严格按 JSON 格式输出：
{
  "competitors": [
    {
      "projectName": "竞争对手名称",
      "productPositioning": "产品定位",
      "marketStrategy": "市场策略",
      "businessProgress": "业务进展",
      "teamBackground": "团队背景",
      "latestRound": "最近融资轮次",
      "amount": "融资金额"
    }
  ],
  "competitiveLandscape": "竞争格局总结（不超过100字）"
}`,
  },

  // ── 4. 业务尽调 ──
  BUSINESS_DD: {
    searchQueries: (p) => [
      `${p.name} 客户 订单`,
      `${p.name} 合作伙伴 业务`,
    ],
    systemPrompt: '你是一位资深投资分析师，擅长业务尽调分析。请基于上传文档和公开信息提取关键业务数据，无法确定的信息请标注"未公开"。',
    userPromptBuilder: (p, externalInfo, documentText, manualContent) => `请根据以下信息，分析"${p.name}"的业务情况。

项目名称：${p.name}
主要产品：${p.mainProducts || '未填写'}
订单进展：${p.orderProgress || '未填写'}

${documentText ? `上传文档内容（业务尽调材料）：\n${documentText}\n\n` : '【未上传文档】'}${externalInfo ? `外网搜索结果：\n${externalInfo}\n\n` : ''}${manualContent ? `用户补充信息：\n${manualContent}\n\n` : ''}请从上传文档中提取以下业务尽调信息，严格按 JSON 格式输出：
{
  "topCustomers": [
    {"name": "客户名称", "revenue": "营收占比", "cooperationDate": "合作时间", "status": "合作状态"}
  ],
  "signedOrders": [
    {"customer": "客户", "amount": "订单金额", "date": "签约时间", "product": "产品"}
  ],
  "intentOrders": [
    {"customer": "客户", "estimatedAmount": "预计金额", "probability": "达成概率", "stage": "进展阶段"}
  ],
  "customerReviews": [
    {"customer": "客户", "rating": "评价", "feedback": "反馈内容"}
  ],
  "summary": "业务尽调一句话总结（不超过100字）"
}`,
  },

  // ── 5. 财务尽调 ──
  FINANCIAL_DD: {
    searchQueries: (p) => [],
    systemPrompt: '你是一位资深投资分析师，擅长财务尽调分析。请基于上传文档提取关键财务数据，无法确定的信息请标注"未公开"。',
    userPromptBuilder: (p, externalInfo, documentText, manualContent) => `请根据以下上传文档，分析"${p.name}"的财务情况。

项目名称：${p.name}
融资金额：${p.totalAmount}
已筹金额：${p.raisedAmount || '未填写'}

${documentText ? `上传文档内容（财务尽调材料）：\n${documentText}\n\n` : '【未上传文档】'}${manualContent ? `用户补充信息：\n${manualContent}\n\n` : ''}请从上传文档中提取以下财务数据，严格按 JSON 格式输出：
{
  "revenue": {"latestYear": "最近年度营收", "previousYear": "上年度营收", "growth": "增长率"},
  "profit": {"latestYear": "最近年度利润", "previousYear": "上年度利润"},
  "cashFlow": {"operating": "经营性现金流", "investing": "投资性现金流", "financing": "融资性现金流"},
  "balanceSheet": {"totalAssets": "总资产", "totalLiabilities": "总负债", "netAssets": "净资产"},
  "keyMetrics": {"grossMargin": "毛利率", "netMargin": "净利率", "burnRate": "月烧钱率"},
  "risks": ["财务风险1", "财务风险2"],
  "summary": "财务尽调一句话总结（不超过100字）"
}`,
  },

  // ── 6. 核心团队 ──
  TEAM: {
    searchQueries: (p) => [
      `${p.name} 创始人 团队`,
      `${p.companyFullName || p.name} CEO 背景`,
    ],
    systemPrompt: '你是一位资深投资分析师，擅长团队背景分析。请基于上传文档和公开信息分析，无法确定的信息请标注"未公开"。',
    userPromptBuilder: (p, externalInfo, documentText, manualContent) => `请根据以下信息，分析"${p.name}"的核心团队。

项目名称：${p.name}
公司全称：${p.companyFullName || '未填写'}
核心团队：${p.coreTeam || '未填写'}

${documentText ? `上传文档内容（团队简介材料）：\n${documentText}\n\n` : '【未上传文档】'}${externalInfo ? `外网搜索结果：\n${externalInfo}\n\n` : ''}${manualContent ? `用户补充信息：\n${manualContent}\n\n` : ''}请分析核心团队，严格按 JSON 格式输出：
{
  "founder": {
    "name": "创始人姓名",
    "background": "教育背景",
    "experience": "工作经历",
    "achievements": "主要成就"
  },
  "coreMembers": [
    {"name": "姓名", "title": "职位", "background": "背景", "experience": "经历"}
  ],
  "teamStrength": "团队整体优势",
  "teamGaps": ["团队不足1", "团队不足2"],
  "summary": "核心团队一句话总结（不超过100字）"
}`,
  },

  // ── 7. 公司概况 ──
  COMPANY: {
    searchQueries: (p) => [
      `${p.companyFullName || p.name} 公司介绍`,
      `${p.name} 公司 股权 结构`,
    ],
    systemPrompt: '你是一位资深投资分析师，擅长公司基本面分析。请基于上传文档和公开信息分析，无法确定的信息请标注"未公开"。',
    userPromptBuilder: (p, externalInfo, documentText, manualContent) => `请根据以下信息，分析"${p.name}"的公司概况。

项目名称：${p.name}
公司全称：${p.companyFullName || '未填写'}
所处行业：${p.industry || '未填写'}
公司定位：${p.companyPosition || '未填写'}
项目描述：${p.description || '未填写'}

${documentText ? `上传文档内容（公司简介材料）：\n${documentText}\n\n` : '【未上传文档】'}${externalInfo ? `外网搜索结果：\n${externalInfo}\n\n` : ''}${manualContent ? `用户补充信息：\n${manualContent}\n\n` : ''}请分析公司概况，严格按 JSON 格式输出：
{
  "basicInfo": {
    "foundedDate": "成立时间",
    "registeredCapital": "注册资本",
    "location": "注册地",
    "legalRepresentative": "法定代表人"
  },
  "shareholderStructure": [
    {"name": "股东名称", "percentage": "持股比例", "type": "股东类型"}
  ],
  "developmentHistory": [
    {"date": "时间", "event": "事件"}
  ],
  "businessScope": "经营范围",
  "summary": "公司概况一句话总结（不超过100字）"
}`,
  },

  // ── 8. 融资规划（纯手动，无 AI） ──
  FINANCING: {
    searchQueries: () => [],
    systemPrompt: '',
    userPromptBuilder: () => '',
  },

  // ── 9. 投资建议（纯手动，无 AI） ──
  RECOMMENDATION: {
    searchQueries: () => [],
    systemPrompt: '',
    userPromptBuilder: () => '',
  },
}
