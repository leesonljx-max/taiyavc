/**
 * Agent 技能注册表（四层架构·第二层，P3）
 *
 * 两类技能：
 * - BUILTIN 内置技能：代码中注册的能力目录（名称/说明/分类），随既有功能路径执行
 *   （如尽调报告生成走 module-report.ts）；DB 行惰性创建，仅做使用统计（recordSkillRun）
 * - DYNAMIC 动态技能：管理员创建的 MD 提示词技能（content 即 system prompt），
 *   可选联网搜索（useSearch=true 走 Harness Agent + web_search）；
 *   供 AI行研 run_skill 工具调用与管理后台在线试运行
 */

import prisma from '@/lib/prisma'
import { runAgent, runSingleCall } from '@/lib/dd-harness/agent'
import { webSearchTool } from '@/lib/dd-harness/tools'
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
  isActive: boolean
  runCount: number
  lastRunAt: Date | null
  feature?: string // 内置技能的功能入口
  createdAt: Date | null
}

/** 全量技能清单：内置目录（合并 DB 统计行）+ 动态技能 */
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
      isActive: row.isActive,
      runCount: row.runCount,
      lastRunAt: row.lastRunAt,
      createdAt: row.createdAt,
    })
  }
  return views
}

/** 激活中的动态技能（run_skill 工具与试运行用） */
export async function listActiveDynamicSkills(): Promise<Array<{ key: string; name: string; description: string; useSearch: boolean }>> {
  const rows = await prisma.agentSkill.findMany({
    where: { type: 'DYNAMIC', isActive: true },
    select: { key: true, name: true, description: true, useSearch: true },
    orderBy: [{ runCount: 'desc' }, { updatedAt: 'desc' }],
  })
  return rows
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
 * - useSearch=false：单次调用（runSingleCall，90s 超时）
 * - useSearch=true：Harness Agent 循环（maxTurns=3，带 web_search 工具，可联网补充）
 * 执行成功后记录使用统计
 */
export async function runDynamicSkill(key: string, input: string): Promise<{ content: string }> {
  const skill = await prisma.agentSkill.findUnique({ where: { key } })
  if (!skill || skill.type !== 'DYNAMIC') {
    throw new Error(`技能「${key}」不存在或不可执行（内置技能请到对应功能入口使用）`)
  }
  if (!skill.isActive) {
    throw new Error(`技能「${skill.name}」已停用`)
  }
  const content = (skill.content || '').trim()
  if (content.length < 10) {
    throw new Error(`技能「${skill.name}」提示词内容为空，请先在管理后台完善`)
  }
  const userPrompt = String(input || '').slice(0, 4000)
  if (!userPrompt.trim()) {
    throw new Error('技能输入不能为空')
  }

  let result: string
  if (skill.useSearch) {
    const agentResult = await runAgent({
      systemPrompt: content,
      userPrompt,
      tools: [webSearchTool],
      maxTurns: 3,
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

/** 构造 run_skill 工具（AI行研 Harness 挂载；仅在存在激活动态技能时注入） */
export function buildRunSkillTool(): HarnessTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'run_skill',
        description:
          '调用已注册的专业分析技能（管理员配置的能力，如融资窗口评估/团队背景核查/赛道格局分析）。传入技能标识与分析输入，返回技能的专业分析结果。',
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
        const result = await runDynamicSkill(key, input)
        return result.content.substring(0, 6000)
      } catch (e) {
        return `技能执行失败: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  }
}
