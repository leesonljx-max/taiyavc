/**
 * 插件中心 · 受控插件目录（纯函数，无 IO）
 *
 * 插件是「受控能力包」：只能从代码内置目录安装，或在后台创建提示词插件，
 * 不做任意代码下载。首批 5 个检索渠道插件基于 Tavily/DeepSeek 搜索能力，
 * 无需新增密钥；项目尽调、项目解读、AI行研共用同一运行时。
 */

import { DD_MODULE_KEYS } from '@/lib/dd-research/constants'

export type PluginKind = 'SEARCH_CHANNEL' | 'PROMPT'

export const PLUGIN_SCENES = [
  { key: 'project-interpretation', label: '项目解读' },
  { key: 'dd-workbench', label: '项目尽调' },
  { key: 'ai-research', label: 'AI行研' },
] as const

export type PluginScene = (typeof PLUGIN_SCENES)[number]['key']

export const PLUGIN_CATEGORIES = [
  { key: 'research', label: '检索' },
  { key: 'data', label: '数据' },
  { key: 'monitor', label: '监控' },
  { key: 'analysis', label: '分析' },
] as const

export const PLUGIN_CAPABILITIES = [
  { key: 'OFFICIAL_SITE', label: '官网深读' },
  { key: 'PATENT', label: '专利' },
  { key: 'BIDDING', label: '招投标' },
  { key: 'NEWS', label: '新闻舆情' },
  { key: 'FINANCIAL', label: '财务工商' },
  { key: 'MARKET', label: '市场情报' },
] as const

/** 尽调模块中文名（插件归属展示用；与 DD 模板保持一致） */
export const PLUGIN_MODULE_LABELS: Record<string, string> = {
  PROJECT_ENTITY: '项目与主体',
  PRODUCT_TECHNOLOGY: '产品与技术',
  TEAM_GOVERNANCE: '团队与治理',
  MARKET_CUSTOMERS: '市场与客户',
  COMMERCIALIZATION: '商业化与订单',
  COMPETITION_MOATS: '竞争与壁垒',
  FINANCE_ECONOMICS: '财务与单位经济',
  LEGAL_COMPLIANCE: '法务合规与风险',
  VALUATION_DEAL: '估值与交易',
}

export interface PluginSubject {
  /** 项目短名（检索主词） */
  name: string
  /** 工商全称（缺省回退短名） */
  fullName?: string | null
  industry?: string | null
  products?: string | null
}

export interface PluginManifest {
  key: string
  name: string
  description: string
  category: (typeof PLUGIN_CATEGORIES)[number]['key']
  kind: PluginKind
  version: string
  capabilities: string[]
  scenes: PluginScene[]
  modules: string[]
  /** 按名称安装时可识别的别名（中文名/英文名/简称） */
  aliases?: string[]
  /** 按项目主体生成检索查询（2-3 条） */
  buildQueries: (subject: PluginSubject) => string[]
}

const DEFAULT_SCENES: PluginScene[] = ['project-interpretation', 'dd-workbench', 'ai-research']

function entityOf(subject: PluginSubject): string {
  return (subject.fullName || subject.name || '').trim()
}

function shortOf(subject: PluginSubject): string {
  return (subject.name || subject.fullName || '').trim()
}

export const PLUGIN_CATALOG: PluginManifest[] = [
  {
    key: 'official-site',
    name: '官网深读',
    description: '定向检索企业官网与官方公众号，提取产品矩阵、技术路线、客户案例与公司简介，作为主体与产品模块的一手来源。',
    category: 'research',
    kind: 'SEARCH_CHANNEL',
    version: '1.1.0',
    capabilities: ['OFFICIAL_SITE'],
    aliases: ['官网', '官网深读', 'official', 'official-site'],
    scenes: DEFAULT_SCENES,
    modules: ['PROJECT_ENTITY', 'PRODUCT_TECHNOLOGY'],
    buildQueries: ({ name, fullName }) => [
      `${shortOf({ name, fullName })} 官网 产品 技术 解决方案`,
      `${shortOf({ name, fullName })} 官网 客户案例 合作伙伴`,
      `${entityOf({ name, fullName })} 官方网站 公司简介 主营业务`,
    ],
  },
  {
    key: 'patent-search',
    name: '专利检索',
    description: '检索专利、商标与软著公开信息，核验技术壁垒与知识产权归属，服务产品技术与竞争壁垒模块。',
    category: 'data',
    kind: 'SEARCH_CHANNEL',
    version: '1.1.0',
    capabilities: ['PATENT'],
    aliases: ['专利', '专利检索', 'patent', 'patent-search'],
    scenes: DEFAULT_SCENES,
    modules: ['PRODUCT_TECHNOLOGY', 'COMPETITION_MOATS'],
    buildQueries: ({ name, fullName }) => [
      `${entityOf({ name, fullName })} 专利 发明专利 实用新型`,
      `${entityOf({ name, fullName })} 专利 知识产权 布局 申请`,
      `${shortOf({ name, fullName })} 商标 软著 知识产权`,
    ],
  },
  {
    key: 'bidding-search',
    name: '招投标检索',
    description: '检索政府采购、招投标与中标公告，验证订单真实性与客户结构，服务市场客户与商业化模块。',
    category: 'data',
    kind: 'SEARCH_CHANNEL',
    version: '1.1.0',
    capabilities: ['BIDDING'],
    aliases: ['招投标', '招投标检索', '中标', 'bidding', 'bidding-search'],
    scenes: DEFAULT_SCENES,
    modules: ['MARKET_CUSTOMERS', 'COMMERCIALIZATION'],
    buildQueries: ({ name, fullName }) => [
      `${entityOf({ name, fullName })} 中标 招标 采购 公告`,
      `${entityOf({ name, fullName })} 中标通知书 项目 金额`,
      `${shortOf({ name, fullName })} 政府采购 中标 成交`,
    ],
  },
  {
    key: 'news-monitor',
    name: '新闻舆情',
    description: '检索近一年新闻、融资动态与争议报道，捕捉融资节奏、合作发布与负面舆情，服务市场与财务模块。',
    category: 'monitor',
    kind: 'SEARCH_CHANNEL',
    version: '1.1.0',
    capabilities: ['NEWS'],
    aliases: ['新闻', '舆情', '新闻舆情', 'news', 'news-monitor'],
    scenes: DEFAULT_SCENES,
    modules: ['MARKET_CUSTOMERS', 'FINANCE_ECONOMICS'],
    buildQueries: ({ name, fullName }) => [
      `${shortOf({ name, fullName })} 最新 新闻 融资 动态`,
      `${shortOf({ name, fullName })} 融资 轮次 投资方 估值`,
      `${shortOf({ name, fullName })} 舆情 报道 争议 风险`,
    ],
  },
  {
    key: 'financial-data',
    name: '财务工商',
    description: '检索工商登记、年报与经营数据（营收/参保人数/股权变更），为财务单位经济与主体核验提供公开证据。',
    category: 'data',
    kind: 'SEARCH_CHANNEL',
    version: '1.1.0',
    capabilities: ['FINANCIAL'],
    aliases: ['财务', '工商', '财务工商', 'financial', 'financial-data'],
    scenes: DEFAULT_SCENES,
    modules: ['FINANCE_ECONOMICS', 'PROJECT_ENTITY'],
    buildQueries: ({ name, fullName }) => [
      `${entityOf({ name, fullName })} 营收 收入 利润 毛利率`,
      `${entityOf({ name, fullName })} 工商 年报 参保人数 股权`,
      `${shortOf({ name, fullName })} 融资 估值 轮次 财务`,
    ],
  },
  {
    key: 'market-intel',
    name: '市场情报',
    description: '检索行业规模、增速、政策监管与竞争格局，为市场客户与竞争壁垒模块补充行业侧公开情报。',
    category: 'research',
    kind: 'SEARCH_CHANNEL',
    version: '1.0.0',
    capabilities: ['MARKET'],
    // dshmarket 作为快捷安装名，便于按名称直接添加市场情报插件
    aliases: ['市场情报', '行业市场', '行业研究', 'dshmarket', 'dsh-market', 'market-intel'],
    scenes: DEFAULT_SCENES,
    modules: ['MARKET_CUSTOMERS', 'COMPETITION_MOATS'],
    buildQueries: ({ name, fullName }) => [
      `${entityOf({ name, fullName })} 行业 市场规模 增速`,
      `${entityOf({ name, fullName })} 行业 政策 监管 趋势`,
      `${shortOf({ name, fullName })} 市场份额 竞争格局`,
    ],
  },
]

export function getPluginManifest(key: string): PluginManifest | null {
  return PLUGIN_CATALOG.find(p => p.key === key) || null
}

/** 按名称/标识/别名解析受控目录插件（支持 dshmarket 这类快捷安装名） */
export function resolvePluginByName(input: string): PluginManifest | null {
  const query = input.trim().toLowerCase()
  if (!query) return null
  return (
    PLUGIN_CATALOG.find(
      p =>
        p.key.toLowerCase() === query ||
        p.name.toLowerCase() === query ||
        (p.aliases || []).some(a => a.toLowerCase() === query)
    ) || null
  )
}

export function isBuiltinPluginKey(key: string): boolean {
  return PLUGIN_CATALOG.some(p => p.key === key)
}

export function pluginSceneLabel(scene: string): string {
  return PLUGIN_SCENES.find(s => s.key === scene)?.label || scene
}

export function pluginCategoryLabel(category: string): string {
  return PLUGIN_CATEGORIES.find(c => c.key === category)?.label || category
}

export function pluginCapabilityLabel(capability: string): string {
  return PLUGIN_CAPABILITIES.find(c => c.key === capability)?.label || capability
}

export function pluginModuleLabel(moduleKey: string): string {
  return PLUGIN_MODULE_LABELS[moduleKey] || moduleKey
}

export function sanitizePluginScenes(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const allowed = new Set(PLUGIN_SCENES.map(s => s.key as string))
  return Array.from(new Set(input.map(v => String(v)).filter(v => allowed.has(v))))
}

export function sanitizePluginModules(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const allowed = new Set(DD_MODULE_KEYS.map(k => k as string))
  return Array.from(new Set(input.map(v => String(v)).filter(v => allowed.has(v))))
}

export function isPluginInScene(scenes: string[] | null | undefined, scene?: string): boolean {
  if (!scene) return true
  if (!scenes || scenes.length === 0) return true
  return scenes.includes(scene)
}

/** 按插件主体生成查询（空主体返回空数组，运行时跳过） */
export function buildPluginQueries(manifest: PluginManifest, subject: PluginSubject): string[] {
  const name = (subject.name || '').trim()
  const fullName = (subject.fullName || '').trim()
  if (!name && !fullName) return []
  return manifest
    .buildQueries({ ...subject, name: name || fullName, fullName })
    .map(q => q.replace(/\s+/g, ' ').trim())
    .filter(q => q.length > 1)
    .slice(0, 3)
}
