/**
 * Agent 技能注册表（四层架构·第二层，P3 + P3.5 个人技能体系）
 *
 * 两类技能：
 * - BUILTIN 内置技能：代码中注册的能力目录（名称/说明/分类），随既有功能路径执行
 *   （如尽调报告生成走 module-report.ts）；DB 行惰性创建，仅做使用统计（recordSkillRun）
 * - DYNAMIC 动态技能：任何账号在功能页创建的 MD 提示词技能（content 即 system prompt），
 *   能力勾选：联网搜索 / 查询项目库 / 查询投后分析报告；
 *   生命周期：DRAFT 调试中（仅创建者可见可调试）→ CONFIRMED 已确认使用（挂载本人 AI行研 + 同事可见可引用）
 */

import prisma from '@/lib/prisma'
import { runAgent, runSingleCall } from '@/lib/dd-harness/agent'
import { webSearchTool } from '@/lib/dd-harness/tools'
import { searchProjectsTool } from '@/lib/dd-harness/projects-tool'
import { searchPostInvestmentTool } from '@/lib/dd-harness/post-investment-tool'
import type { HarnessTool } from '@/lib/dd-harness/types'

// ── 内置技能目录（代码为唯一来源；DB 行仅惰性记录使用统计） ──

export interface BuiltinSkillDef {
  key: string
  name: string
  description: string
  category: string
  /** 功能入口说明（管理后台展示用） */
  feature: string
}

export const BUILTIN_SKILLS: BuiltinSkillDef[] = [
  {
    key: 'claim-verifier',
    name: '声明校验（ClaimVerifier）',
    description: '提取分析结果中的关键声明（营收/订单/良率/融资/合作等），联网双源交叉核验，输出 ✅一致/⚠️夸大/❌矛盾/❓未证实 四级裁决与证据链。',
    category: 'verification',
    feature: '尽调模块报告 / 项目解读 / AI行研「核验数据」',
  },
  {
    key: 'competitor-analysis',
    name: '竞争态势分析',
    description: '基于项目资料与联网信息分析竞争对手的产品定位、市场策略、业务进展与团队背景。',
    category: 'analysis',
    feature: '项目详情 · 竞争态势分析',
  },
  {
    key: 'ai-card',
    name: 'AI 项目卡片',
    description: '从项目资料自动生成结构化项目卡片（定位/亮点/风险等）。',
    category: 'analysis',
    feature: '项目详情 · AI画板',
  },
  {
    key: 'industry-news',
    name: '行业动态分析',
    description: '按行业联网检索最新动态并结构化总结（融资/技术/政策/竞争事件）。',
    category: 'research',
    feature: 'AI 看板 · 行业动态',
  },
  {
    key: 'dd-module-report',
    name: '尽调模块报告',
    description: '按九大模块分别总结资料生成三段式尽调分析报告（关键事实→分析判断→核心结论，支持图片理解）。',
    category: 'report',
    feature: '尽调工作台 · 生成尽调报告',
  },
  {
    key: 'dd-fact-extraction',
    name: '事实卡提取',
    description: '从模块资料提取可核验事实卡（A/B/C/D 证据分级）与下一步行动。',
    category: 'analysis',
    feature: '尽调工作台 · 开始分析',
  },
  {
    key: 'team-scoring-review',
    name: '团队评分审评',
    description: '对已确认的团队评分表进行 AI 审评（0-10 分）：校验各维度打分与简历描述的一致性。',
    category: 'analysis',
    feature: '尽调 · 团队与治理 · AI 审评',
  },
  {
    key: 'ai-lead-retrieval',
    name: 'AI 线索检索',
    description: '按信号关键词联网检索融资 PR 新闻并结构化提取为项目线索。',
    category: 'research',
    feature: '项目库 · 项目线索（定时触发）',
  },
  {
    key: 'weekly-report-parse',
    name: '周报解析',
    description: '解析团队周报（标签/自然语言格式）并回填项目跟进进展。',
    category: 'report',
    feature: '工作台 · 周报',
  },
]

export const SKILL_CATEGORIES = ['verification', 'analysis', 'research', 'report', 'general'] as const

const CATEGORY_LABELS: Record<string, string> = {
  verification: '核验',
  analysis: '分析',
  research: '检索',
  report: '报告',
  general: '通用',
}

export function skillCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] || category
}

export function isBuiltinKey(key: string): boolean {
  return BUILTIN_SKILLS.some(s => s.key === key)
}

// ── 场景体系（每个功能页一套独立技能设定） ──

/** 技能可挂载的功能场景（skill-registry 单一来源；scenes 空数组 = 存量技能全场景兼容） */
export const SKILL_SCENES = [
  { key: 'project-interpretation', label: '项目解读' },
  { key: 'dd-workbench', label: '项目尽调' },
  { key: 'post-investment', label: '投后管理' },
  { key: 'ai-research', label: 'AI行研' },
  { key: 'industry-news', label: '行业动态' },
] as const

export type SkillScene = (typeof SKILL_SCENES)[number]['key']

const SCENE_KEYS = SKILL_SCENES.map(s => s.key) as string[]

export function isSkillScene(v: string): v is SkillScene {
  return SCENE_KEYS.includes(v)
}

export function skillSceneLabel(scene: string): string {
  return SKILL_SCENES.find(s => s.key === scene)?.label || scene
}

/** 场景标签列表（全场景/多场景摘要显示用） */
export function skillSceneLabels(scenes: string[]): string[] {
  if (!scenes || scenes.length === 0) return ['全场景']
  return scenes.filter(isSkillScene).map(skillSceneLabel)
}

/** 技能是否挂载在指定场景（scenes 空数组 = 存量技能，视为全场景兼容） */
export function isSkillInScene(scenes: string[] | null | undefined, scene?: string): boolean {
  if (!scene) return true // 无场景维度（全量视图）
  if (!scenes || scenes.length === 0) return true // 存量技能全场景
  return scenes.includes(scene)
}

/** 清洗 scenes 输入（白名单过滤；空数组合法=全场景兼容态） */
export function sanitizeScenes(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return Array.from(new Set(input.map(s => String(s)).filter(isSkillScene)))
}

// ── 查询 ──

/** 技能视图（内置目录 + DB 动态技能，含使用统计） */
export interface SkillView {
  id: string | null // 内置技能未运行过时无 DB 行
  key: string
  name: string
  description: string
  type: 'BUILTIN' | 'DYNAMIC'
  category: string
  content: string | null
  useSearch: boolean
  useProjectLibrary: boolean
  usePostInvestment: boolean
  status: 'DRAFT' | 'CONFIRMED'
  scenes: string[]
  isActive: boolean
  runCount: number
  lastRunAt: Date | null
  feature?: string // 内置技能的功能入口
  createdAt: Date | null
  createdById?: string | null
  forkedFromKey?: string | null
}

/** 全量技能清单：内置目录（合并 DB 统计行）+ 动态技能（管理后台用） */
export async function listSkills(): Promise<SkillView[]> {
  const rows = await prisma.agentSkill.findMany({ orderBy: [{ updatedAt: 'desc' }] })
  const byKey = new Map(rows.map(r => [r.key, r]))
  const views: SkillView[] = []

  for (const def of BUILTIN_SKILLS) {
    const row = byKey.get(def.key)
    views.push({
      id: row?.id || null,
      key: def.key,
      name: def.name,
      description: def.description,
      type: 'BUILTIN',
      category: def.category,
      content: null,
      useSearch: false,
      useProjectLibrary: false,
      usePostInvestment: false,
      status: 'CONFIRMED',
      scenes: [], // 内置技能随功能常驻，无场景挂载概念
      isActive: true, // 内置技能随功能常驻
      runCount: row?.runCount ?? 0,
      lastRunAt: row?.lastRunAt ?? null,
      feature: def.feature,
      createdAt: row?.createdAt ?? null,
    })
  }
  for (const row of rows) {
    if (row.type !== 'DYNAMIC') continue // 内置统计行已合并
    views.push({
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      type: 'DYNAMIC',
      category: row.category,
      content: row.content,
      useSearch: row.useSearch,
      useProjectLibrary: row.useProjectLibrary,
      usePostInvestment: row.usePostInvestment,
      status: (row.status === 'CONFIRMED' ? 'CONFIRMED' : 'DRAFT'),
      scenes: row.scenes,
      isActive: row.isActive,
      runCount: row.runCount,
      lastRunAt: row.lastRunAt,
      createdAt: row.createdAt,
      createdById: row.createdById,
      forkedFromKey: row.forkedFromKey,
    })
  }
  return views
}

/**
 * 本人已确认使用的动态技能（AI行研 run_skill 工具挂载用，P3.5 个人化）
 * 仅挂载：本人创建 + CONFIRMED + isActive +（scene 传入时）挂载在该场景
 * scenes 空数组 = 存量技能，视为全场景兼容
 */
export async function listActiveDynamicSkills(userId?: string, scene?: string): Promise<Array<{ key: string; name: string; description: string; useSearch: boolean; useProjectLibrary: boolean; usePostInvestment: boolean }>> {
  const rows = await prisma.agentSkill.findMany({
    where: {
      type: 'DYNAMIC',
      isActive: true,
      status: 'CONFIRMED',
      ...(userId ? { createdById: userId } : {}),
    },
    select: { key: true, name: true, description: true, useSearch: true, useProjectLibrary: true, usePostInvestment: true, scenes: true },
    orderBy: [{ runCount: 'desc' }, { updatedAt: 'desc' }],
  })
  return rows.filter(r => isSkillInScene(r.scenes, scene))
}

// ── 使用统计（内置技能惰性建行；动态技能直接递增） ──

export async function recordSkillRun(key: string): Promise<void> {
  const builtin = BUILTIN_SKILLS.find(s => s.key === key)
  const existing = await prisma.agentSkill.findUnique({ where: { key }, select: { id: true, type: true } })
  if (existing) {
    await prisma.agentSkill.update({
      where: { id: existing.id },
      data: { runCount: { increment: 1 }, lastRunAt: new Date() },
    })
    return
  }
  if (builtin) {
    // 内置技能首次运行：惰性创建统计行（type=BUILTIN，不可编辑）
    await prisma.agentSkill.create({
      data: {
        key: builtin.key,
        name: builtin.name,
        description: builtin.description,
        type: 'BUILTIN',
        category: builtin.category,
        runCount: 1,
        lastRunAt: new Date(),
      },
    })
  }
}

// ── 动态技能执行 ──

/**
 * 执行动态技能：content 作为 system prompt + 输入作为 user prompt
 * 工具按能力勾选组装（P3.5）：
 * - 三勾全否：单次调用（runSingleCall，90s 超时）
 * - 任一勾选：Harness Agent 循环（maxTurns=4，带对应工具）
 *   - useSearch → web_search（联网搜索）
 *   - useProjectLibrary → search_projects（查询项目库）
 *   - usePostInvestment → search_post_investment（查询投后分析报告）
 * 权限：CONFIRMED 技能本人或同事（挂载场景）可执行；DRAFT 仅创建者本人可调试
 */
export async function runDynamicSkill(key: string, input: string, runnerUserId?: string): Promise<{ content: string }> {
  const skill = await prisma.agentSkill.findUnique({ where: { key } })
  if (!skill || skill.type !== 'DYNAMIC') {
    throw new Error(`技能「${key}」不存在或不可执行（内置技能请到对应功能入口使用）`)
  }
  if (!skill.isActive) {
    throw new Error(`技能「${skill.name}」已停用`)
  }
  if (skill.status !== 'CONFIRMED') {
    // DRAFT 调试中：仅创建者本人可试运行
    if (!runnerUserId || skill.createdById !== runnerUserId) {
      throw new Error(`技能「${skill.name}」尚在调试中（未确认使用），仅创建者可调试`)
    }
  }
  const content = (skill.content || '').trim()
  if (content.length < 10) {
    throw new Error(`技能「${skill.name}」提示词内容为空，请先完善`)
  }
  const userPrompt = String(input || '').slice(0, 4000)
  if (!userPrompt.trim()) {
    throw new Error('技能输入不能为空')
  }

  const tools: HarnessTool[] = []
  if (skill.useSearch) tools.push(webSearchTool)
  if (skill.useProjectLibrary) tools.push(searchProjectsTool)
  if (skill.usePostInvestment) tools.push(searchPostInvestmentTool)

  let result: string
  if (tools.length > 0) {
    const agentResult = await runAgent({
      systemPrompt: content,
      userPrompt,
      tools,
      maxTurns: 4,
      temperature: 0.4,
    })
    result = agentResult.content
  } else {
    result = await runSingleCall(content, userPrompt, 90000)
  }

  await recordSkillRun(key).catch(() => {})
  return { content: result }
}

// ── AI行研 run_skill 工具（动态技能挂载为 Agent 可调用能力） ──

/** 构造 run_skill 工具（AI行研 Harness 挂载；仅挂载本人 CONFIRMED 技能） */
export function buildRunSkillTool(runnerUserId?: string): HarnessTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'run_skill',
        description:
          '调用已注册的专业分析技能（本人配置的能力，如融资窗口评估/团队背景核查/赛道格局分析）。传入技能标识与分析输入，返回技能的专业分析结果。',
        parameters: {
          type: 'object',
          properties: {
            skill_key: { type: 'string', description: '技能标识（从可用技能列表中选择）' },
            input: { type: 'string', description: '技能输入：分析对象/问题/相关材料（500字内）' },
          },
          required: ['skill_key', 'input'],
        },
      },
    },
    execute: async args => {
      const key = String(args.skill_key || '').trim()
      const input = String(args.input || '')
      if (!key) return '错误：缺少 skill_key 参数'
      try {
        const result = await runDynamicSkill(key, input, runnerUserId)
        return result.content.substring(0, 6000)
      } catch (e) {
        return `技能执行失败: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  }
}

// ── P3.5 个人技能体系（功能页 SkillPanel 用） ──

/** 个人技能视图（SkillPanel 卡片渲染用） */
export interface PersonalSkillView {
  id: string
  key: string
  name: string
  description: string
  category: string
  content: string | null
  useSearch: boolean
  useProjectLibrary: boolean
  usePostInvestment: boolean
  status: 'DRAFT' | 'CONFIRMED'
  /** 适用场景（空数组 = 存量技能全场景兼容） */
  scenes: string[]
  isActive: boolean
  runCount: number
  lastRunAt: Date | null
  createdAt: Date
  updatedAt: Date
  createdById: string | null
  creatorName: string | null // 同事技能显示创建者
  forkedFromKey: string | null
}

const SKILL_LIST_SELECT = {
  id: true, key: true, name: true, description: true, category: true, content: true,
  useSearch: true, useProjectLibrary: true, usePostInvestment: true,
  status: true, scenes: true, isActive: true, runCount: true, lastRunAt: true,
  createdAt: true, updatedAt: true, forkedFromKey: true, createdById: true,
  createdBy: { select: { name: true, email: true } },
} as const

type SkillRowWithCreator = {
  id: string; key: string; name: string; description: string; category: string; content: string | null
  useSearch: boolean; useProjectLibrary: boolean; usePostInvestment: boolean
  status: string; scenes: string[]; isActive: boolean; runCount: number; lastRunAt: Date | null
  createdAt: Date; updatedAt: Date; forkedFromKey: string | null; createdById: string | null
  createdBy: { name: string | null; email: string } | null
}

function toPersonalView(row: SkillRowWithCreator): PersonalSkillView {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    content: row.content,
    useSearch: row.useSearch,
    useProjectLibrary: row.useProjectLibrary,
    usePostInvestment: row.usePostInvestment,
    status: row.status === 'CONFIRMED' ? 'CONFIRMED' : 'DRAFT',
    scenes: row.scenes,
    isActive: row.isActive,
    runCount: row.runCount,
    lastRunAt: row.lastRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
    creatorName: row.createdBy ? (row.createdBy.name || row.createdBy.email) : null,
    forkedFromKey: row.forkedFromKey,
  }
}

/** 我的技能（本人全部动态技能：DRAFT + CONFIRMED，按更新时间倒序） */
export async function listMySkills(userId: string): Promise<PersonalSkillView[]> {
  const rows = await prisma.agentSkill.findMany({
    where: { type: 'DYNAMIC', createdById: userId },
    select: SKILL_LIST_SELECT,
    orderBy: [{ updatedAt: 'desc' }],
  })
  return rows.map(toPersonalView)
}

/** 同事技能（其他人 CONFIRMED + isActive，按使用次数倒序；SkillPanel 右侧 + 一键引用） */
export async function listColleagueSkills(userId: string): Promise<PersonalSkillView[]> {
  const rows = await prisma.agentSkill.findMany({
    where: { type: 'DYNAMIC', status: 'CONFIRMED', isActive: true, createdById: { not: userId } },
    select: SKILL_LIST_SELECT,
    orderBy: [{ runCount: 'desc' }, { updatedAt: 'desc' }],
  })
  return rows.map(toPersonalView)
}

/** 生成不冲突的技能 key：key / key-2 / key-3 ... */
export async function generateUniqueKey(base: string): Promise<string> {
  let candidate = base
  let i = 2
  // 上限试探 50 次
  while (i < 52) {
    const existing = await prisma.agentSkill.findUnique({ where: { key: candidate }, select: { id: true } })
    if (!existing) return candidate
    candidate = `${base}-${i}`
    i += 1
  }
  throw new Error('技能标识冲突次数过多，请更换标识')
}

/** 个人技能创建校验（个人 API 与管理 API 共用口径） */
export function validateSkillInput(input: {
  key?: unknown
  name?: unknown
  description?: unknown
  category?: unknown
  content?: unknown
}): { ok: true; value: { key: string; name: string; description: string; category: string; content: string } } | { ok: false; error: string } {
  const key = String(input.key || '').trim().toLowerCase()
  const name = String(input.name || '').trim()
  const description = String(input.description || '').trim()
  const category = String(input.category || 'general').trim()
  const content = String(input.content || '').trim()

  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(key)) {
    return { ok: false, error: '技能标识格式不合法（2-40 位小写字母/数字/连字符，字母开头）' }
  }
  if (isBuiltinKey(key)) {
    return { ok: false, error: `「${key}」为内置技能标识，不可占用` }
  }
  if (!name || name.length > 50) {
    return { ok: false, error: '技能名称必填（≤50 字）' }
  }
  if (!description || description.length > 200) {
    return { ok: false, error: '能力说明必填（≤200 字，说明何时该用）' }
  }
  if (content.length < 20) {
    return { ok: false, error: '提示词内容过短（至少 20 字）：内容将作为技能的 system prompt' }
  }
  if (!SKILL_CATEGORIES.includes(category as (typeof SKILL_CATEGORIES)[number])) {
    return { ok: false, error: '分类不合法' }
  }
  return { ok: true, value: { key, name, description, category, content } }
}

// ── 页面 AI 功能挂载（P3.6：技能为所在页面的 AI 功能服务） ──

/**
 * 构造"用户自定义分析技能"提示词块，拼接到各页面 AI 功能的 system prompt 末尾：
 * - 无 userId 或本人无 CONFIRMED 技能 → 返回空串（完全走固定框架，零改动）
 * - scene 传入时只挂载适用该场景的技能（每页一套独立技能设定；scenes 空数组=存量全场景）
 * - 有技能 → 模块化路由规则：与固定框架某模块相似的技能融入该模块分析；
 *   视角超出固定框架的独立技能单独成为一个分析模块（skillModules / 技能视角小节）；
 *   冲突时以用户技能为准；输出格式仍须遵守原要求（格式护栏防止技能覆盖 JSON 结构指令）
 * 每个技能内容截断 2000 字，最多取 5 个，控制上下文长度
 */
export async function buildUserSkillPromptBlock(userId?: string, scene?: string): Promise<string> {
  if (!userId) return ''
  const rows = await prisma.agentSkill.findMany({
    where: { type: 'DYNAMIC', status: 'CONFIRMED', isActive: true, createdById: userId },
    select: { name: true, description: true, content: true, scenes: true },
    orderBy: [{ runCount: 'desc' }, { updatedAt: 'desc' }],
    take: 20,
  }).catch(() => [] as Array<{ name: string; description: string; content: string | null; scenes: string[] }>)
  const skills = rows
    .filter(r => isSkillInScene(r.scenes, scene))
    .filter(r => (r.content || '').trim().length >= 10)
    .slice(0, 5)
  if (skills.length === 0) return ''

  const skillSections = skills.map(s => {
    const content = (s.content || '').trim().substring(0, 2000)
    return `### 技能：${s.name}\n${s.description}（${s.name}）\n\n${content}`
  }).join('\n\n')

  return [
    '\n## 用户自定义分析技能（本人创建并确认使用）',
    '以下技能代表本人的分析方法论偏好，执行本任务时按模块化规则应用：',
    '1. 技能的分析视角与固定框架中某一模块高度相似时：将该技能的分析框架与侧重融入该模块，在该模块的输出内容中体现（不单独成段）',
    '2. 技能的分析视角属于固定框架未覆盖的独立领域时：为该技能单独产出一个分析模块——按当前任务输出格式的扩展结构输出（如 JSON 的 skillModules 字段、报告文本的「技能视角」小节），内容中注明技能名',
    '3. 与当前任务明显无关的技能可忽略',
    '4. 若技能中的分析框架、视角或侧重与前面的固定框架冲突，以用户技能为准',
    '5. 无论技能内容如何要求，本任务的输出格式必须严格遵守前述格式要求（如 JSON 结构、字段名、段落结构）',
    '',
    skillSections,
  ].join('\n')
}

/**
 * 一键引用（fork）：复制同事 CONFIRMED 技能为自己的 DRAFT 副本
 * key 冲突自动后缀（key-2 / key-3）；forkedFromKey 记录溯源
 * scene 传入时副本只挂载该场景（引用自某场景的面板）；缺省继承源技能的 scenes
 */
export async function forkSkill(sourceKey: string, userId: string, scene?: string): Promise<PersonalSkillView> {
  const source = await prisma.agentSkill.findUnique({ where: { key: sourceKey } })
  if (!source || source.type !== 'DYNAMIC' || source.status !== 'CONFIRMED' || !source.isActive) {
    throw new Error('源技能不存在或不可引用（需为同事已确认使用的技能）')
  }
  if (source.createdById === userId) {
    throw new Error('不能引用自己的技能')
  }
  const key = await generateUniqueKey(source.key)
  const created = await prisma.agentSkill.create({
    data: {
      key,
      name: source.name,
      description: source.description,
      category: source.category,
      content: source.content,
      useSearch: source.useSearch,
      useProjectLibrary: source.useProjectLibrary,
      usePostInvestment: source.usePostInvestment,
      type: 'DYNAMIC',
      status: 'DRAFT',
      scenes: scene ? [scene] : source.scenes,
      createdById: userId,
      forkedFromKey: source.key,
    },
    select: SKILL_LIST_SELECT,
  })
  return toPersonalView(created)
}
