/**
 * 插件中心 · 运行时（服务端）
 *
 * 职责：
 * - 安装/卸载/升级/启停插件（受控目录，不下载任意代码）
 * - 项目级启用覆盖（ProjectPlugin）
 * - 执行检索渠道插件（复用 Tavily/DeepSeek 双源检索，collect 模式控成本）
 * - 产出尽调来源草稿 / 项目解读资料块 / AI行研 run_plugin 工具
 */

import prisma from '@/lib/prisma'
import { searchWebDual, type SearchResult } from '@/lib/tavily-search'
import { callDeepSeekJson } from '@/lib/dd-research/llm'
import { normalizeUrl, hashSource, type ResearchSourceDraft } from '@/lib/dd-research/search'
import { DD_SEARCH_BUDGET, domainOf, gradeSource, sourceTypeOf } from '@/lib/dd-research/constants'
import {
  PLUGIN_CATALOG,
  buildPluginQueries,
  getPluginManifest,
  isPluginInScene,
  pluginModuleLabel,
  sanitizePluginModules,
  sanitizePluginScenes,
  type PluginSubject,
} from './plugin-registry'
import type { HarnessTool } from '@/lib/dd-harness/types'

const PLUGIN_SEARCH_MODULE = 'dd-research' as const
const MAX_RESULTS_PER_QUERY = 5
const MAX_SOURCES_PER_RUN = 8
const MAX_PLUGIN_SOURCES_PER_MODULE = 6

export interface ProjectLike {
  name: string
  companyFullName?: string | null
  industry?: string | null
  mainProducts?: string | null
}

export interface PluginRunSource {
  title: string
  url: string
  snippet: string
}

export interface PluginRunResult {
  key: string
  name: string
  kind: string
  version: string
  ok: boolean
  queries: string[]
  summary: string
  sources: PluginRunSource[]
}

export interface PluginView {
  key: string
  name: string
  description: string
  category: string
  kind: string
  version: string
  latestVersion: string
  capabilities: string[]
  scenes: string[]
  modules: string[]
  installed: boolean
  installedVersion: string | null
  isActive: boolean
  builtin: boolean
  runCount: number
  successCount: number
  lastRunAt: Date | null
  projectEnabled: boolean
  projectOverride: boolean | null
  updatable: boolean
  content: string | null
}

// ── 查询 ──

interface PluginRowLike {
  key: string
  name: string
  description: string
  category: string
  kind: string
  version: string
  capabilities: string[]
  scenes: string[]
  modules: string[]
  content: string | null
  isActive: boolean
  runCount: number
  successCount: number
  lastRunAt: Date | null
}

/** 全量插件视图：内置目录 + 已安装行（含项目级启用状态） */
export async function listPluginViews(projectId?: string): Promise<PluginView[]> {
  const [rows, overrides] = await Promise.all([
    prisma.agentPlugin.findMany({ orderBy: [{ updatedAt: 'desc' }] }),
    projectId
      ? prisma.projectPlugin.findMany({ where: { projectId } })
      : Promise.resolve([] as Array<{ pluginKey: string; enabled: boolean }>),
  ])
  const rowByKey = new Map(rows.map(r => [r.key, r]))
  const overrideByKey = new Map(overrides.map(o => [o.pluginKey, o]))
  const views: PluginView[] = []

  for (const manifest of PLUGIN_CATALOG) {
    const row = rowByKey.get(manifest.key)
    const override = overrideByKey.get(manifest.key)
    views.push({
      key: manifest.key,
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      kind: manifest.kind,
      version: row?.version || manifest.version,
      latestVersion: manifest.version,
      capabilities: manifest.capabilities,
      scenes: manifest.scenes,
      modules: manifest.modules,
      installed: !!row,
      installedVersion: row?.version || null,
      isActive: row?.isActive ?? false,
      builtin: true,
      runCount: row?.runCount ?? 0,
      successCount: row?.successCount ?? 0,
      lastRunAt: row?.lastRunAt ?? null,
      projectEnabled: override ? override.enabled : !!(row && row.isActive),
      projectOverride: override ? override.enabled : null,
      updatable: !!(row && row.version !== manifest.version),
      content: row?.content ?? null,
    })
  }

  for (const row of rows) {
    if (getPluginManifest(row.key)) continue
    const override = overrideByKey.get(row.key)
    views.push({
      key: row.key,
      name: row.name,
      description: row.description,
      category: row.category,
      kind: row.kind,
      version: row.version,
      latestVersion: row.version,
      capabilities: row.capabilities,
      scenes: row.scenes,
      modules: row.modules,
      installed: true,
      installedVersion: row.version,
      isActive: row.isActive,
      builtin: false,
      runCount: row.runCount,
      successCount: row.successCount,
      lastRunAt: row.lastRunAt,
      projectEnabled: override ? override.enabled : row.isActive,
      projectOverride: override ? override.enabled : null,
      updatable: false,
      content: row.content,
    })
  }

  return views.sort((a, b) => Number(b.installed) - Number(a.installed))
}

/** 已安装 + 启用 + 场景匹配的插件行 */
export async function listEnabledPluginRows(scene?: string, projectId?: string): Promise<PluginRowLike[]> {
  const rows = await prisma.agentPlugin.findMany({
    where: { isActive: true },
    orderBy: [{ runCount: 'desc' }, { updatedAt: 'desc' }],
  })
  let disabled = new Set<string>()
  if (projectId) {
    const overrides = await prisma.projectPlugin.findMany({
      where: { projectId, enabled: false },
      select: { pluginKey: true },
    })
    disabled = new Set(overrides.map(o => o.pluginKey))
  }
  return rows.filter(r => !disabled.has(r.key) && isPluginInScene(r.scenes, scene))
}

/** 已安装插件（AI行研提示词清单用） */
export async function listEnabledPluginBriefs(scene: string): Promise<Array<{ key: string; name: string; description: string; kind: string }>> {
  const rows = await listEnabledPluginRows(scene)
  return rows.map(r => ({ key: r.key, name: r.name, description: r.description, kind: r.kind }))
}

// ── 安装 / 升级 / 启停 ──

export async function installPlugin(key: string, userId?: string): Promise<void> {
  const manifest = getPluginManifest(key)
  if (!manifest) throw new Error('插件不存在或不在受控目录中')
  await prisma.agentPlugin.upsert({
    where: { key },
    update: {
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      kind: manifest.kind,
      version: manifest.version,
      capabilities: manifest.capabilities,
      scenes: manifest.scenes,
      modules: manifest.modules,
      isActive: true,
      installedById: userId || null,
    },
    create: {
      key,
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      kind: manifest.kind,
      version: manifest.version,
      capabilities: manifest.capabilities,
      scenes: manifest.scenes,
      modules: manifest.modules,
      isActive: true,
      installedById: userId || null,
    },
  })
}

export async function uninstallPlugin(key: string): Promise<void> {
  await prisma.agentPlugin.deleteMany({ where: { key } })
  await prisma.projectPlugin.deleteMany({ where: { pluginKey: key } })
}

export async function upgradePlugin(key: string): Promise<void> {
  const manifest = getPluginManifest(key)
  if (!manifest) throw new Error('插件不存在或不在受控目录中')
  const row = await prisma.agentPlugin.findUnique({ where: { key } })
  if (!row) throw new Error('插件尚未安装')
  await prisma.agentPlugin.update({
    where: { key },
    data: {
      version: manifest.version,
      description: manifest.description,
      capabilities: manifest.capabilities,
      scenes: manifest.scenes,
      modules: manifest.modules,
    },
  })
}

export async function togglePlugin(key: string, isActive: boolean): Promise<void> {
  const row = await prisma.agentPlugin.findUnique({ where: { key } })
  if (!row) throw new Error('插件尚未安装')
  await prisma.agentPlugin.update({ where: { key }, data: { isActive } })
}

export async function setProjectPluginEnabled(projectId: string, pluginKey: string, enabled: boolean): Promise<void> {
  await prisma.projectPlugin.upsert({
    where: { projectId_pluginKey: { projectId, pluginKey } },
    update: { enabled },
    create: { projectId, pluginKey, enabled },
  })
}

export async function createPromptPlugin(input: {
  key: string
  name: string
  description: string
  content: string
  scenes?: unknown
  modules?: unknown
  userId?: string
}): Promise<void> {
  const key = input.key.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(key)) {
    throw new Error('插件标识格式不合法（2-40 位小写字母/数字/连字符，字母开头）')
  }
  if (getPluginManifest(key)) throw new Error(`「${key}」为内置插件标识，不可占用`)
  if (await prisma.agentPlugin.findUnique({ where: { key } })) throw new Error(`插件标识「${key}」已存在`)
  const content = input.content.trim()
  if (content.length < 20) throw new Error('提示词内容过短（至少 20 字）')
  const scenes = sanitizePluginScenes(input.scenes)
  const modules = sanitizePluginModules(input.modules)
  await prisma.agentPlugin.create({
    data: {
      key,
      name: input.name.trim().slice(0, 50),
      description: input.description.trim().slice(0, 200),
      category: 'analysis',
      kind: 'PROMPT',
      version: '1.0.0',
      capabilities: [],
      scenes: scenes.length > 0 ? scenes : ['project-interpretation', 'ai-research'],
      modules,
      content,
      isActive: true,
      installedById: input.userId || null,
    },
  })
}

// ── 执行 ──

function subjectOf(project?: ProjectLike | null): PluginSubject {
  if (!project) return { name: '' }
  return {
    name: project.name,
    fullName: project.companyFullName,
    industry: project.industry,
    products: project.mainProducts,
  }
}

async function recordRun(key: string, ok: boolean): Promise<void> {
  await prisma.agentPlugin.update({
    where: { key },
    data: {
      runCount: { increment: 1 },
      ...(ok ? { successCount: { increment: 1 } } : {}),
      lastRunAt: new Date(),
    },
  }).catch(() => {})
}

function dedupeSources(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  const out: SearchResult[] = []
  for (const r of results) {
    if (!r.url) continue
    const url = normalizeUrl(r.url)
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ ...r, url })
    if (out.length >= MAX_SOURCES_PER_RUN) break
  }
  return out
}

function formatRunSummary(pluginName: string, queries: string[], sources: PluginRunSource[]): string {
  if (sources.length === 0) return `「${pluginName}」未检索到可用公开来源（查询：${queries.join('；')}）`
  const lines = sources.map((s, i) => `[${i + 1}] ${s.title}（${s.url}）：${s.snippet}`)
  return `「${pluginName}」检索到 ${sources.length} 条来源：\n${lines.join('\n')}`
}

/**
 * 执行单个插件。
 * - SEARCH_CHANNEL：按主体生成查询 → 双源 collect 检索 → 去重 → 来源清单
 * - PROMPT：提示词作为 system prompt，检索/输入材料作为 user，输出 { summary }
 */
export async function runPlugin(
  key: string,
  input: string,
  opts?: { projectId?: string; project?: ProjectLike; scene?: string }
): Promise<PluginRunResult> {
  const row = await prisma.agentPlugin.findUnique({ where: { key } })
  if (!row) throw new Error('插件尚未安装')
  if (!row.isActive) throw new Error(`插件「${row.name}」已停用`)
  if (opts?.scene && !isPluginInScene(row.scenes, opts.scene)) {
    throw new Error(`插件「${row.name}」未挂载在场景 ${opts.scene}`)
  }

  let project = opts?.project || null
  if (!project && opts?.projectId) {
    const found = await prisma.project.findUnique({
      where: { id: opts.projectId },
      select: { name: true, companyFullName: true, industry: true, mainProducts: true },
    })
    project = found
  }
  const subject = subjectOf(project)
  if (!subject.name && input.trim()) subject.name = input.trim().slice(0, 120)

  const version = row.version

  if (row.kind === 'PROMPT') {
    const content = (row.content || '').trim()
    if (content.length < 10) throw new Error(`插件「${row.name}」提示词内容为空`)
    const parsed = await callDeepSeekJson<{ summary?: string }>({
      system: content,
      user: `分析对象：${subject.name || input}\n${subject.industry ? `行业：${subject.industry}\n` : ''}${input ? `补充材料/要求：\n${input.slice(0, 4000)}` : ''}`,
      module: 'dd-research',
      maxTokens: 3000,
    })
    const summary = (parsed?.summary || '').trim()
    await recordRun(key, !!summary)
    return {
      key,
      name: row.name,
      kind: row.kind,
      version,
      ok: !!summary,
      queries: [],
      summary: summary || '提示词插件未返回有效内容',
      sources: [],
    }
  }

  const manifest = getPluginManifest(key)
  const queries = manifest ? buildPluginQueries(manifest, subject) : []
  if (queries.length === 0) throw new Error('缺少检索主体（项目名称/公司名称）')

  const results = await Promise.all(
    queries.map(q =>
      searchWebDual(q, {
        maxResults: MAX_RESULTS_PER_QUERY,
        mode: 'collect',
        module: PLUGIN_SEARCH_MODULE,
        cacheTtlHours: 12,
      }).catch(() => [] as SearchResult[])
    )
  )
  const sources = dedupeSources(results.flat()).map(r => ({
    title: (r.title || r.url).slice(0, 200),
    url: r.url,
    snippet: (r.content || '').replace(/\s+/g, ' ').slice(0, 320),
  }))
  const ok = sources.length > 0
  await recordRun(key, ok)
  return {
    key,
    name: row.name,
    kind: row.kind,
    version,
    ok,
    queries,
    summary: formatRunSummary(row.name, queries, sources),
    sources,
  }
}

// ── 尽调来源汇总 ──

function toSourceDraft(moduleKey: string, source: PluginRunSource): ResearchSourceDraft {
  const content = source.snippet.slice(0, DD_SEARCH_BUDGET.contentMaxChars)
  const grade = gradeSource(source.url)
  return {
    moduleKey,
    url: source.url,
    title: source.title,
    domain: domainOf(source.url),
    snippet: content.slice(0, 240),
    content,
    sourceType: sourceTypeOf(grade),
    grade,
    contentHash: hashSource(source.url, content),
  }
}

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}

export interface PluginSourceRun {
  key: string
  name: string
  moduleKey: string
  sourceCount: number
}

/**
 * 项目尽调：执行项目启用的检索渠道插件，按模块归集来源。
 * 与常规检索共用 seenUrls 去重；每模块插件来源上限 6 条。
 */
export async function collectPluginResearchSources(
  project: ProjectLike & { id: string },
  options?: { seenUrls?: Set<string>; scene?: string }
): Promise<{ sourcesByModule: Record<string, ResearchSourceDraft[]>; pluginRuns: PluginSourceRun[] }> {
  const scene = options?.scene || 'dd-workbench'
  const seenUrls = options?.seenUrls || new Set<string>()
  const rows = (await listEnabledPluginRows(scene, project.id)).filter(r => r.kind === 'SEARCH_CHANNEL' && getPluginManifest(r.key))
  if (rows.length === 0) return { sourcesByModule: {}, pluginRuns: [] }

  const runs = await runWithConcurrency(rows, 2, async row => {
    const manifest = getPluginManifest(row.key)!
    const moduleKey = row.modules[0] || manifest.modules[0] || 'PROJECT_ENTITY'
    try {
      const result = await runPlugin(row.key, '', { project, scene })
      return {
        key: row.key,
        name: row.name,
        moduleKey,
        sources: result.sources,
      }
    } catch {
      return { key: row.key, name: row.name, moduleKey, sources: [] as PluginRunSource[] }
    }
  })

  const sourcesByModule: Record<string, ResearchSourceDraft[]> = {}
  const pluginRuns: PluginSourceRun[] = []
  for (const run of runs) {
    const accepted: ResearchSourceDraft[] = []
    for (const source of run.sources) {
      if (seenUrls.has(source.url)) continue
      seenUrls.add(source.url)
      accepted.push(toSourceDraft(run.moduleKey, source))
      if (accepted.length >= MAX_PLUGIN_SOURCES_PER_MODULE) break
    }
    if (accepted.length > 0) {
      sourcesByModule[run.moduleKey] = [...(sourcesByModule[run.moduleKey] || []), ...accepted]
    }
    pluginRuns.push({ key: run.key, name: run.name, moduleKey: run.moduleKey, sourceCount: accepted.length })
  }
  return { sourcesByModule, pluginRuns }
}

// ── 项目解读 / AI行研 资料块 ──

function formatPluginSourcesBlock(result: PluginRunResult, moduleKey: string): string {
  const lines = result.sources.slice(0, 5).map((s, i) =>
    `[${i + 1}] ${s.title}\n来源：${s.url}\n摘要：${s.snippet}`
  )
  return `### 插件：${result.name}（归属模块：${pluginModuleLabel(moduleKey)}）\n${lines.join('\n')}`
}

/**
 * 项目解读：运行场景内已启用插件，产出可拼接到 system prompt 的资料块。
 * 无插件/无结果返回空串，完全不影响原流程。
 */
export async function buildPluginContextBlock(
  project: ProjectLike,
  options?: { scene?: string; maxPlugins?: number }
): Promise<{ block: string; applied: string[] }> {
  const scene = options?.scene || 'project-interpretation'
  const rows = (await listEnabledPluginRows(scene)).filter(r => r.kind === 'SEARCH_CHANNEL' && getPluginManifest(r.key))
  if (rows.length === 0) return { block: '', applied: [] }
  const selected = rows.slice(0, options?.maxPlugins ?? 4)
  const results = await runWithConcurrency(selected, 2, async row => {
    try {
      return await runPlugin(row.key, '', { project, scene })
    } catch {
      return null
    }
  })
  const blocks: string[] = []
  const applied: string[] = []
  for (const result of results) {
    if (!result || result.sources.length === 0) continue
    const manifest = getPluginManifest(result.key)
    blocks.push(formatPluginSourcesBlock(result, manifest?.modules[0] || 'PROJECT_ENTITY'))
    applied.push(result.name)
  }
  if (blocks.length === 0) return { block: '', applied: [] }
  return {
    block: [
      '\n## 插件补充资料（外部渠道检索，逐条附来源；引用时保留 URL，不得编造）',
      '以下资料来自已启用的检索插件，用于补足文档未覆盖的公开信息；与文档冲突时标注差异并以可核验来源为准。',
      '',
      blocks.join('\n\n'),
    ].join('\n'),
    applied,
  }
}

/** AI行研 run_plugin 工具（插件执行结果直接进入 Agent 上下文） */
export function buildRunPluginTool(projectId?: string, scene = 'ai-research'): HarnessTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'run_plugin',
        description:
          '调用插件中心已启用插件（官网深读/专利检索/招投标检索/新闻舆情/财务工商/自定义分析插件）。传入插件标识与检索主体，返回带 URL 的来源清单与结论。',
        parameters: {
          type: 'object',
          properties: {
            plugin_key: { type: 'string', description: '插件标识（从可用插件清单中选择）' },
            input: { type: 'string', description: '检索主体或分析输入（公司名/行业/问题，500字内）' },
          },
          required: ['plugin_key', 'input'],
        },
      },
    },
    execute: async args => {
      const key = String(args.plugin_key || '').trim()
      const input = String(args.input || '').trim()
      if (!key) return '错误：缺少 plugin_key 参数'
      try {
        const result = await runPlugin(key, input, { projectId, scene })
        return result.summary.substring(0, 6000)
      } catch (e) {
        return `插件执行失败: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  }
}
