'use client'

/**
 * 插件中心 · 插件模块
 *
 * - 受控插件目录：只能从内置目录安装，不下载任意代码
 * - 插件类型：检索渠道插件（官网深读/专利/招投标/舆情/财务）+ 自定义提示词插件
 * - 项目级启用：安装后可按项目勾选是否参与该项目的研究与解读
 * - 二期能力：版本升级、提示词插件、调用统计
 */

import { useState, useEffect, useCallback } from 'react'

interface PluginView {
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
  lastRunAt: string | null
  projectEnabled: boolean
  projectOverride: boolean | null
  updatable: boolean
  content: string | null
}

interface ProjectOption { id: string; name: string }
interface Stats { installed: number; active: number; total: number; totalRuns: number }

const CATEGORY_LABELS: Record<string, string> = {
  research: '检索', data: '数据', monitor: '监控', analysis: '分析',
}
const SCENE_LABELS: Record<string, string> = {
  'project-interpretation': '项目解读', 'dd-workbench': '项目尽调', 'ai-research': 'AI行研',
}
const MODULE_LABELS: Record<string, string> = {
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
const CAPABILITY_LABELS: Record<string, string> = {
  OFFICIAL_SITE: '官网深读', PATENT: '专利', BIDDING: '招投标', NEWS: '新闻舆情', FINANCIAL: '财务工商',
}

const EMPTY_FORM = {
  key: '', name: '', description: '', content: '',
  scenes: ['project-interpretation', 'ai-research'] as string[],
}

export default function PluginManager({ isAdmin }: { isAdmin: boolean }) {
  const [plugins, setPlugins] = useState<PluginView[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [stats, setStats] = useState<Stats>({ installed: 0, active: 0, total: 0, totalRuns: 0 })
  const [projectId, setProjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')

  // 试运行
  const [runKey, setRunKey] = useState<string | null>(null)
  const [runInput, setRunInput] = useState('')
  const [runResult, setRunResult] = useState<{ summary: string; sources: Array<{ title: string; url: string; snippet: string }> } | null>(null)
  const [running, setRunning] = useState(false)

  // 提示词插件创建
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [formErr, setFormErr] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/plugins${projectId ? `?projectId=${projectId}` : ''}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error || '加载插件目录失败'); return }
      setPlugins(data.plugins || [])
      setProjects(data.projects || [])
      setStats(data.stats || { installed: 0, active: 0, total: 0, totalRuns: 0 })
      setError('')
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { refresh() }, [refresh])

  const act = async (body: Record<string, unknown>, successText: string) => {
    const tag = `${String(body.action)}:${String(body.key)}`
    if (busy) return
    setBusy(tag)
    try {
      const res = await fetch('/api/admin/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || '操作失败'); return }
      setMsg(successText)
      await refresh()
    } catch {
      setError('网络错误')
    } finally {
      setBusy('')
    }
  }

  const toggleProject = async (p: PluginView, enabled: boolean) => {
    if (!projectId) return
    await act(
      { action: 'project', projectId, key: p.key, enabled },
      `已在当前项目${enabled ? '启用' : '停用'}插件「${p.name}」`
    )
  }

  const submitRun = async () => {
    if (running || !runKey) return
    setRunning(true)
    setRunResult(null)
    try {
      const res = await fetch('/api/plugins/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: runKey, input: runInput, projectId: projectId || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setRunResult({ summary: `❌ ${data.error || '运行失败'}`, sources: [] })
      } else {
        setRunResult({ summary: data.result.summary, sources: data.result.sources || [] })
        await refresh()
      }
    } catch {
      setRunResult({ summary: '❌ 网络错误', sources: [] })
    } finally {
      setRunning(false)
    }
  }

  const submitCreate = async () => {
    if (saving) return
    setSaving(true)
    setFormErr('')
    try {
      const res = await fetch('/api/admin/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', ...form }),
      })
      const data = await res.json()
      if (!res.ok) { setFormErr(data.error || '创建失败'); return }
      setFormOpen(false)
      setForm({ ...EMPTY_FORM })
      setMsg(`提示词插件「${form.name}」已创建并安装`)
      await refresh()
    } catch {
      setFormErr('网络错误')
    } finally {
      setSaving(false)
    }
  }

  const toggleScene = (scene: string) => {
    setForm(f => ({
      ...f,
      scenes: f.scenes.includes(scene) ? f.scenes.filter(s => s !== scene) : [...f.scenes, scene],
    }))
  }

  if (loading) {
    return <div className="p-10 text-center text-xs text-ink-faint">加载插件目录...</div>
  }

  return (
    <div className="space-y-5">
      {msg && <div className="p-3 rounded-xl text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-between">
        <span>✓ {msg}</span>
        <button onClick={() => setMsg('')} className="text-emerald-500 hover:text-emerald-700">✕</button>
      </div>}
      {error && <div className="p-3 rounded-xl text-xs bg-danger-50 text-danger-700 border border-danger-200 flex items-center justify-between">
        <span>{error}</span>
        <button onClick={() => setError('')} className="text-danger-500 hover:text-danger-700">✕</button>
      </div>}

      {/* 统计 + 项目选择 */}
      <div className="bg-surface rounded-2xl shadow-soft p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-5 flex-wrap">
            <div>
              <p className="text-[10px] text-ink-faint">已安装</p>
              <p className="text-lg font-bold text-ink">{stats.installed}<span className="text-xs font-normal text-ink-faint"> / {stats.total}</span></p>
            </div>
            <div>
              <p className="text-[10px] text-ink-faint">启用中</p>
              <p className="text-lg font-bold text-emerald-600">{stats.active}</p>
            </div>
            <div>
              <p className="text-[10px] text-ink-faint">累计运行</p>
              <p className="text-lg font-bold text-ink">{stats.totalRuns}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-ink-muted font-bold">项目级启用</label>
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="input-field py-1.5 text-xs min-w-[200px]"
            >
              <option value="">全局（不按项目）</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <p className="text-[11px] text-ink-faint mt-3 leading-relaxed">
          受控插件目录：安装后自动挂载到项目尽调、项目解读与 AI行研。检索渠道插件复用 Tavily + DeepSeek 搜索能力，无需新增密钥；系统不下载或执行任意第三方代码。
        </p>
      </div>

      {/* 插件列表 */}
      <div className="bg-surface rounded-2xl shadow-soft p-5">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h3 className="text-lg font-bold text-ink">
            插件 <span className="font-normal text-ink-faint text-xs">（{stats.total} 个 · 安装/升级/启停/试运行）</span>
          </h3>
          {isAdmin && (
            <button onClick={() => { setFormOpen(v => !v); setFormErr('') }} className="btn-secondary text-xs">
              ＋ 新建提示词插件
            </button>
          )}
        </div>

        {formOpen && (
          <div className="mb-4 rounded-xl border border-hairline bg-gray-50 p-4 space-y-3">
            <p className="text-xs font-bold text-ink">新建提示词插件（二期）</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-ink-muted">插件标识（key）</label>
                <input
                  value={form.key}
                  onChange={e => setForm({ ...form, key: e.target.value })}
                  placeholder="如 merger-arbitrage-view"
                  className="input-field mt-1"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-ink-muted">插件名称</label>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="如：并购退出视角分析"
                  className="input-field mt-1"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink-muted">能力说明（AI 据此判断何时调用）</label>
              <input
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="如：从并购退出视角评估标的的接盘方与估值逻辑"
                className="input-field mt-1"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink-muted">适用场景</label>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {Object.entries(SCENE_LABELS).map(([k, v]) => (
                  <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={form.scenes.includes(k)} onChange={() => toggleScene(k)} className="w-3.5 h-3.5" />
                    <span className="text-[11px] text-ink-muted">{v}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-ink-muted">提示词（作为 system prompt 执行，输出 {"{summary}"} JSON）</label>
              <textarea
                value={form.content}
                onChange={e => setForm({ ...form, content: e.target.value })}
                rows={6}
                placeholder={'你是并购退出专家。基于输入的公司/行业信息，分析潜在接盘方、估值区间与退出路径……\n输出 JSON：{"summary": "分析结论"}'}
                className="input-field mt-1 font-mono leading-relaxed"
              />
            </div>
            {formErr && <p className="text-xs text-danger-700">{formErr}</p>}
            <div className="flex items-center gap-2">
              <button onClick={submitCreate} disabled={saving} className="btn-primary text-xs">
                {saving ? '创建中...' : '创建并安装'}
              </button>
              <button onClick={() => setFormOpen(false)} className="btn-secondary text-xs">取消</button>
            </div>
          </div>
        )}

        <div className="space-y-2.5">
          {plugins.map(p => (
            <div key={p.key} className={`rounded-xl border p-3.5 ${p.installed && p.isActive ? 'border-hairline bg-surface' : 'border-dashed border-hairline bg-gray-50/60'}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-[260px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-ink">{p.name}</span>
                    <code className="px-1.5 py-0.5 rounded bg-gray-100 text-ink-muted text-[10px]">{p.key}</code>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary-50 text-primary-700 border border-primary-100">
                      {p.kind === 'PROMPT' ? '提示词插件' : '检索渠道'}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-ink-muted border border-hairline">
                      {CATEGORY_LABELS[p.category] || p.category}
                    </span>
                    {p.capabilities.map(c => (
                      <span key={c} className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-100">
                        {CAPABILITY_LABELS[c] || c}
                      </span>
                    ))}
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-ink-muted">
                      v{p.installedVersion || p.latestVersion}
                    </span>
                    {p.updatable && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary-50 text-primary-700 border border-primary-100">
                        可升级 → v{p.latestVersion}
                      </span>
                    )}
                    {p.installed ? (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${p.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                        {p.isActive ? '● 已启用' : '○ 已停用'}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-200 text-gray-500">未安装</span>
                    )}
                    {projectId && p.installed && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${p.projectEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {p.projectEnabled ? '本项目：启用' : '本项目：未启用'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-muted mt-1 leading-relaxed">{p.description}</p>
                  <p className="text-[10px] text-ink-faint mt-1.5">
                    场景：{p.scenes.map(s => SCENE_LABELS[s] || s).join('、') || '全场景'}
                    {p.modules.length > 0 && ` · 归属模块：${p.modules.map(m => MODULE_LABELS[m] || m).join('、')}`}
                    {p.installed && ` · 运行 ${p.runCount} 次 / 成功 ${p.successCount} 次${p.lastRunAt ? ` · 最近 ${new Date(p.lastRunAt).toLocaleString('zh-CN')}` : ''}`}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap flex-shrink-0">
                  {p.installed && (
                    <button
                      onClick={() => { setRunKey(p.key); setRunInput(''); setRunResult(null) }}
                      className="text-[11px] px-2.5 py-1.5 bg-primary-50 text-primary-700 rounded-full font-bold hover:bg-primary-100 border border-primary-100"
                    >
                      ▶ 试运行
                    </button>
                  )}
                  {isAdmin && !p.installed && (
                    <button
                      onClick={() => act({ action: 'install', key: p.key }, `插件「${p.name}」已安装`)}
                      disabled={!!busy}
                      className="text-[11px] px-2.5 py-1.5 bg-primary-600 text-white rounded-full font-bold hover:bg-primary-700 disabled:opacity-50"
                    >
                      安装
                    </button>
                  )}
                  {isAdmin && p.updatable && (
                    <button
                      onClick={() => act({ action: 'upgrade', key: p.key }, `插件「${p.name}」已升级到 v${p.latestVersion}`)}
                      disabled={!!busy}
                      className="text-[11px] px-2.5 py-1.5 bg-primary-50 text-primary-700 rounded-full font-bold hover:bg-primary-100 border border-primary-100 disabled:opacity-50"
                    >
                      升级
                    </button>
                  )}
                  {isAdmin && p.installed && (
                    <>
                      <button
                        onClick={() => act({ action: 'toggle', key: p.key, isActive: !p.isActive }, `插件「${p.name}」已${p.isActive ? '停用' : '启用'}`)}
                        disabled={!!busy}
                        className="text-[11px] px-2.5 py-1.5 bg-gray-50 text-ink-muted rounded-full font-bold hover:bg-gray-100 border border-hairline disabled:opacity-50"
                      >
                        {p.isActive ? '停用' : '启用'}
                      </button>
                      <button
                        onClick={() => {
                          if (!window.confirm(`卸载插件「${p.name}」？项目级启用设置将一并清除。`)) return
                          act({ action: 'uninstall', key: p.key }, `插件「${p.name}」已卸载`)
                        }}
                        disabled={!!busy}
                        className="text-[11px] px-2.5 py-1.5 bg-danger-50 text-danger-700 rounded-full font-bold hover:bg-danger-100 border border-danger-200 disabled:opacity-50"
                      >
                        卸载
                      </button>
                    </>
                  )}
                  {isAdmin && projectId && p.installed && (
                    <label className="flex items-center gap-1.5 ml-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={p.projectEnabled}
                        onChange={e => toggleProject(p, e.target.checked)}
                        className="w-3.5 h-3.5"
                      />
                      <span className="text-[11px] text-ink-muted">本项目启用</span>
                    </label>
                  )}
                </div>
              </div>

              {runKey === p.key && (
                <div className="mt-3 pt-3 border-t border-hairline space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold text-primary-700">▶ 试运行：{p.name}</p>
                    <button onClick={() => { setRunKey(null); setRunResult(null) }} className="text-ink-faint hover:text-ink text-[11px]">✕ 关闭</button>
                  </div>
                  <p className="text-[10px] text-ink-faint">
                    {p.kind === 'PROMPT' ? '输入分析对象与材料，插件按提示词输出结论。' : projectId ? '已选择项目，将按该项目主体检索；也可在下方补充检索词。' : '输入公司名称/行业关键词作为检索主体。'}
                  </p>
                  <textarea
                    value={runInput}
                    onChange={e => setRunInput(e.target.value)}
                    rows={2}
                    placeholder={p.kind === 'PROMPT' ? '如：分析无涯智远在工业AI质检领域的并购退出路径' : '如：无涯智远（北京）科技有限公司'}
                    className="input-field text-xs"
                  />
                  <button onClick={submitRun} disabled={running} className="btn-primary text-xs">
                    {running ? '运行中（真实检索）...' : '运行插件'}
                  </button>
                  {runResult && (
                    <div className="rounded-xl border border-hairline bg-surface p-3.5 text-xs text-ink leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto">
                      {runResult.summary}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
