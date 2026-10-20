'use client'

/**
 * 个人技能面板（P3.5 + 场景化）：功能页右上角「我的技能」入口，每页一套独立技能设定
 *
 * - scene 属性：当前功能场景（project-interpretation/dd-workbench/post-investment/ai-research/industry-news）
 * - 我的技能 tab：本场景技能（新建/编辑/删除/调试/确认）+ 我的技能库（其他场景技能，可跨场景启用到本页）
 * - 同事技能 tab：同事挂载在本场景的 CONFIRMED 技能，一键引用（fork 副本挂载本场景）
 * - 能力勾选：🌐联网搜索 / 📁查询项目库 / 📊查询投后分析报告
 * - 生命周期：创建（DRAFT 调试中，仅本人可见）→ 调试 → 确认使用（挂载所选场景 + 同事可见）
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** 场景清单（与 skill-registry SKILL_SCENES 对齐；组件内自带避免服务端 import） */
const SCENE_OPTIONS = [
  { key: 'project-interpretation', label: '项目解读' },
  { key: 'dd-workbench', label: '项目尽调' },
  { key: 'post-investment', label: '投后管理' },
  { key: 'ai-research', label: 'AI行研' },
  { key: 'industry-news', label: '行业动态' },
] as const

function sceneLabel(scene: string): string {
  return SCENE_OPTIONS.find(s => s.key === scene)?.label || scene
}

function sceneLabels(scenes: string[]): string {
  if (!scenes || scenes.length === 0) return '全场景'
  return scenes.filter(s => SCENE_OPTIONS.some(o => o.key === s)).map(sceneLabel).join('、')
}

interface PersonalSkill {
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
  scenes: string[]
  isActive: boolean
  runCount: number
  lastRunAt: string | null
  creatorName: string | null
  forkedFromKey: string | null
}

interface EditorState {
  mode: 'create' | 'edit'
  key: string
  originalKey?: string
  name: string
  description: string
  category: string
  content: string
  useSearch: boolean
  useProjectLibrary: boolean
  usePostInvestment: boolean
  /** 适用场景（创建时默认当前场景；可多选实现跨场景适用） */
  scenes: string[]
}

/** 能力徽章 */
function CapabilityBadges({ s }: { s: PersonalSkill }) {
  const badges = []
  if (s.useSearch) badges.push(<span key="web" className="pill bg-primary-50 text-primary-700">🌐 联网</span>)
  if (s.useProjectLibrary) badges.push(<span key="proj" className="pill bg-gray-100 text-ink-muted">📁 项目库</span>)
  if (s.usePostInvestment) badges.push(<span key="pi" className="pill bg-emerald-50 text-emerald-700">📊 投后报告</span>)
  if (badges.length === 0) badges.push(<span key="none" className="pill bg-gray-100 text-ink-faint">纯提示词</span>)
  return <div className="flex flex-wrap gap-1">{badges}</div>
}

/** 技能面板主体（侧滑；scene = 当前功能场景，缺省为全场景视图） */
export function SkillPanel({ open, onClose, scene }: { open: boolean; onClose: () => void; scene?: string }) {
  const [tab, setTab] = useState<'mine' | 'colleague'>('mine')
  const [mySkills, setMySkills] = useState<PersonalSkill[]>([])
  const [librarySkills, setLibrarySkills] = useState<PersonalSkill[]>([])
  const [colleagueSkills, setColleagueSkills] = useState<PersonalSkill[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [editor, setEditor] = useState<EditorState | null>(null)
  const [saving, setSaving] = useState(false)
  const [editorError, setEditorError] = useState('')

  const [debugSkill, setDebugSkill] = useState<PersonalSkill | null>(null)
  const [debugInput, setDebugInput] = useState('')
  const [debugOutput, setDebugOutput] = useState('')
  const [debugRunning, setDebugRunning] = useState(false)
  const [debugError, setDebugError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(scene ? `/api/skills?scene=${encodeURIComponent(scene)}` : '/api/skills')
      if (!res.ok) throw new Error('加载失败')
      // 空 body（服务器重启/连接中断）时兜底，避免抛 "Unexpected end of JSON input"
      const data = await res.json().catch(
        () => ({}) as { mySkills?: PersonalSkill[]; librarySkills?: PersonalSkill[]; colleagueSkills?: PersonalSkill[] }
      )
      setMySkills(data.mySkills || [])
      setLibrarySkills(data.librarySkills || [])
      setColleagueSkills(data.colleagueSkills || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载技能列表失败')
    } finally {
      setLoading(false)
    }
  }, [scene])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  // 编辑器/调试器展开时自动滚动到可见区域（防止按钮落在视口外）
  const expandRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if ((editor || debugSkill) && expandRef.current) {
      expandRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [editor, debugSkill])

  async function saveEditor() {
    if (!editor) return
    if (editor.scenes.length === 0) {
      setEditorError('请至少勾选一个适用场景')
      return
    }
    setSaving(true)
    setEditorError('')
    try {
      const payload = {
        key: editor.key,
        name: editor.name,
        description: editor.description,
        category: editor.category,
        content: editor.content,
        useSearch: editor.useSearch,
        useProjectLibrary: editor.useProjectLibrary,
        usePostInvestment: editor.usePostInvestment,
        scenes: editor.scenes, // 适用场景（创建/编辑统一走 scenes 数组）
      }
      const res = editor.mode === 'create'
        ? await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/skills', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, key: editor.originalKey }) })
      // 空 body 兜底（服务器重启/连接中断），给出可操作的提示而非原始 JS 异常
      const data = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) {
        throw new Error(data.error || (res.status === 500 ? '服务器处理异常（可能正在重启），请稍后重试' : '保存失败'))
      }
      setEditor(null)
      await load()
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  /** 技能库技能启用到本场景（跨场景复用：scenes 追加当前场景） */
  async function enableInScene(s: PersonalSkill) {
    if (!scene) return
    const res = await fetch('/api/skills', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: s.key, scenes: Array.from(new Set([...s.scenes, scene])) }),
    })
    const data = await res.json().catch(() => ({} as { error?: string }))
    if (res.ok) {
      await load()
    } else {
      alert(data.error || '启用失败')
    }
  }

  /** 从本场景移出（scenes 移除当前场景；至少保留一个场景） */
  async function removeFromScene(s: PersonalSkill) {
    if (!scene) return
    if (s.scenes.length <= 1) {
      alert('该技能仅挂载本场景，不能移出（可编辑改为其他场景，或直接删除）')
      return
    }
    const res = await fetch('/api/skills', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: s.key, scenes: s.scenes.filter(x => x !== scene) }),
    })
    const data = await res.json().catch(() => ({} as { error?: string }))
    if (res.ok) {
      await load()
    } else {
      alert(data.error || '移出失败')
    }
  }

  async function removeSkill(key: string) {
    if (!confirm(`确定删除技能「${key}」？删除后不可恢复。`)) return
    const res = await fetch(`/api/skills?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
    if (res.ok) {
      if (debugSkill?.key === key) setDebugSkill(null)
      await load()
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.error || '删除失败')
    }
  }

  async function confirmSkill(key: string) {
    const res = await fetch('/api/skills/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
    })
    if (res.ok) {
      await load()
      if (debugSkill?.key === key) setDebugSkill(null)
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.error || '确认使用失败')
    }
  }

  async function forkColleague(key: string) {
    const res = await fetch('/api/skills/fork', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scene ? { key, scene } : { key }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setTab('mine')
      await load()
    } else {
      alert(data.error || '一键引用失败')
    }
  }

  async function runDebug() {
    if (!debugSkill || !debugInput.trim()) return
    setDebugRunning(true)
    setDebugError('')
    setDebugOutput('')
    try {
      const res = await fetch('/api/skills/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: debugSkill.key, input: debugInput }),
      })
      const data = await res.json().catch(() => ({} as { error?: string; content?: string }))
      if (!res.ok) {
        throw new Error(data.error || (res.status === 500 ? '服务器处理异常（可能正在重启），请稍后重试' : '运行失败'))
      }
      setDebugOutput(data.content || '')
      await load() // 刷新运行次数
      // 输出后滚动到调试器底部，露出「确认使用」按钮
      setTimeout(() => expandRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50)
    } catch (e) {
      setDebugError(e instanceof Error ? e.message : '运行失败')
    } finally {
      setDebugRunning(false)
    }
  }

  // Portal 挂载到 body：脱离 header（glass backdrop-filter 会劫持 fixed 定位的包含块）
  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <>
      {/* 遮罩（z-[60] 覆盖侧边栏/头部/主区所有层叠上下文） */}
      <div className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-[1px]" onClick={onClose} />
      {/* 侧滑面板（z-[70] 确保最高层） */}
      <div className="fixed right-0 top-0 z-[70] h-full w-full max-w-[520px] bg-surface shadow-soft-lg border-l border-hairline flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <div>
            <h2 className="text-lg font-bold text-ink">⚙️ 我的技能{scene ? ` · ${sceneLabel(scene)}` : ''}</h2>
            <p className="text-[11px] text-ink-faint mt-0.5">
              {scene ? `「${sceneLabel(scene)}」独立技能设定：本页创建/启用的技能只在本页 AI 功能生效` : '创建个人 AI 分析技能，调试满意后确认使用'}
            </p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-gray-50 text-ink-faint hover:text-ink text-xl leading-none transition-colors">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3">
          <button
            onClick={() => setTab('mine')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${tab === 'mine' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-ink-muted hover:bg-gray-200'}`}
          >
            我的技能（{mySkills.length}）
          </button>
          <button
            onClick={() => setTab('colleague')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${tab === 'colleague' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-ink-muted hover:bg-gray-200'}`}
          >
            同事技能（{colleagueSkills.length}）
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && <div className="text-xs text-danger-700 bg-danger-50 rounded-xl p-3">{error}</div>}

          {/* ── 编辑器（内嵌） ── */}
          {editor && (
            <div ref={expandRef} className="rounded-2xl bg-primary-50/40 p-4 space-y-3">
              <p className="text-xs font-bold text-primary-700">{editor.mode === 'create' ? '＋ 新建技能' : `✏️ 编辑：${editor.originalKey}`}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-ink-muted font-medium">技能名称 *</label>
                  <input value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })} placeholder="如：融资窗口评估"
                    className="input-field mt-1" />
                </div>
                <div>
                  <label className="text-[11px] text-ink-muted font-medium">技能标识 *{editor.mode === 'edit' ? '（不可改）' : ''}</label>
                  <input value={editor.key} onChange={e => setEditor({ ...editor, key: e.target.value })} placeholder="如 fin-window-check" disabled={editor.mode === 'edit'}
                    className="input-field mt-1 disabled:bg-gray-100 disabled:text-ink-faint" />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-ink-muted font-medium">能力说明 *（≤200 字，说明何时该用）</label>
                <input value={editor.description} onChange={e => setEditor({ ...editor, description: e.target.value })} placeholder="如：评估某赛道未来12个月的融资窗口是否开启"
                  className="input-field mt-1" />
              </div>
              <div>
                <label className="text-[11px] text-ink-muted font-medium">提示词内容 *（≥20 字，作为技能的 system prompt）</label>
                <textarea value={editor.content} onChange={e => setEditor({ ...editor, content: e.target.value })} rows={7}
                  placeholder={'# 角色\n你是一位资深一级市场投资人…\n\n# 任务\n…'}
                  className="input-field mt-1 font-mono leading-relaxed" />
              </div>
              <div>
                <label className="text-[11px] text-ink-muted font-medium">适用场景 *（确认使用后挂载到勾选的页面；可多选实现跨场景适用）</label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {SCENE_OPTIONS.map(o => (
                    <label key={o.key} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border cursor-pointer text-xs transition-colors ${
                      editor.scenes.includes(o.key)
                        ? 'bg-primary-50 border-primary-200 text-primary-700 font-bold'
                        : 'bg-surface border-hairline text-ink-muted hover:border-gray-300'
                    }`}>
                      <input type="checkbox" className="hidden" checked={editor.scenes.includes(o.key)}
                        onChange={e => setEditor({
                          ...editor,
                          scenes: e.target.checked
                            ? [...editor.scenes, o.key]
                            : editor.scenes.filter(s => s !== o.key),
                        })} />
                      {o.label}{o.key === scene ? '（本页）' : ''}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] text-ink-muted font-medium">执行能力（勾选后技能可调用对应工具）</label>
                <div className="mt-1.5 space-y-1.5">
                  {([
                    ['useSearch', '🌐 联网搜索', '执行时可联网检索最新信息（web_search）'],
                    ['useProjectLibrary', '📁 查询项目库', '执行时可检索内部项目库及尽调结论（search_projects）'],
                    ['usePostInvestment', '📊 查询投后分析报告', '执行时可检索已投项目的经营分析报告（search_post_investment）'],
                  ] as const).map(([field, label, hint]) => (
                    <label key={field} className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" checked={editor[field]} onChange={e => setEditor({ ...editor, [field]: e.target.checked })}
                        className="mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-400" />
                      <span>
                        <span className="text-xs font-bold text-ink">{label}</span>
                        <span className="block text-[10px] text-ink-faint">{hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              {editorError && <p className="text-[11px] text-danger-600">{editorError}</p>}
              <div className="flex gap-2">
                <button onClick={saveEditor} disabled={saving}
                  className="btn-primary">
                  {saving ? '保存中…' : '保存'}
                </button>
                <button onClick={() => { setEditor(null); setEditorError('') }}
                  className="btn-secondary">取消</button>
                {editor.mode === 'edit' && (
                  <span className="text-[10px] text-amber-600 self-center">提示词/能力变更保存后将回到「调试中」，需重新确认使用</span>
                )}
              </div>
            </div>
          )}

          {/* ── 调试器（内嵌） ── */}
          {debugSkill && (
            <div ref={expandRef} className="rounded-2xl bg-amber-50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-amber-700">🧪 调试：{debugSkill.name} <span className="font-mono text-[10px] text-ink-faint">({debugSkill.key})</span></p>
                <button onClick={() => { setDebugSkill(null); setDebugOutput(''); setDebugError('') }}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-ink-faint hover:bg-gray-50 hover:text-ink text-sm transition-colors">✕</button>
              </div>
              <textarea value={debugInput} onChange={e => setDebugInput(e.target.value)} rows={3}
                placeholder="输入调试内容（分析对象/问题，如：宇树科技 人形机器人 融资）"
                className="input-field" />
              <button onClick={runDebug} disabled={debugRunning || !debugInput.trim()}
                className="px-3.5 py-1.5 rounded-full bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-50">
                {debugRunning ? '运行中（可能需要联网检索，请稍候）…' : '▶ 运行'}
              </button>
              {debugError && <p className="text-[11px] text-danger-700 bg-danger-50 rounded-xl p-2.5">{debugError}</p>}
              {debugOutput && (
                <div className="rounded-2xl bg-surface border border-hairline p-3 max-h-64 overflow-y-auto">
                  <pre className="text-[11px] text-ink whitespace-pre-wrap font-sans">{debugOutput}</pre>
                </div>
              )}
              {debugSkill.status === 'DRAFT' && (
                <div className="flex items-center gap-2 pt-1 border-t border-hairline">
                  <span className="text-[11px] text-ink-muted">调试效果满意？</span>
                  <button onClick={() => confirmSkill(debugSkill.key)}
                    className="px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700">
                    ✓ 确认使用
                  </button>
                  <span className="text-[10px] text-ink-faint">确认后挂载到你的 AI行研，同事可见可引用</span>
                </div>
              )}
            </div>
          )}

          {loading && mySkills.length === 0 && colleagueSkills.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8">
              <div className="w-6 h-6 rounded-full border-2 border-gray-100 border-b-2 border-b-primary-600 animate-spin" />
              <span className="text-xs text-ink-faint">加载中…</span>
            </div>
          ) : tab === 'mine' ? (
            <>
              <button onClick={() => setEditor({
                mode: 'create', key: '', name: '', description: '', category: 'general', content: '',
                useSearch: false, useProjectLibrary: false, usePostInvestment: false,
                scenes: scene ? [scene] : [], // 新建默认挂载当前场景
              })}
                className="w-full rounded-2xl border-2 border-dashed border-gray-200 py-3 text-xs font-bold text-primary-600 hover:bg-primary-50 transition-colors">
                ＋ 新建技能{scene ? `（${sceneLabel(scene)}）` : ''}
              </button>
              {mySkills.length === 0 && !editor && (
                <div className="py-6 text-center">
                  <div className="w-14 h-14 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  </div>
                  <p className="text-xs text-ink-faint">
                    {scene ? `「${sceneLabel(scene)}」还没有挂载你的技能，点击上方创建或从下方技能库启用` : '还没有自己的技能，点击上方「新建技能」创建'}
                  </p>
                </div>
              )}
              {mySkills.map(s => (
                <div key={s.id} className={`rounded-2xl p-3.5 border ${s.status === 'CONFIRMED' ? 'border-emerald-100 bg-emerald-50/40' : 'border-amber-100 bg-amber-50/40'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-ink">{s.name}</span>
                        <span className={`pill ${s.status === 'CONFIRMED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {s.status === 'CONFIRMED' ? '🟢 已确认使用' : '🟡 调试中'}
                        </span>
                        <span className="pill bg-primary-50 text-primary-700">📍 {sceneLabels(s.scenes)}</span>
                        {s.forkedFromKey && <span className="pill bg-gray-100 text-ink-faint">↩ 引用自 {s.forkedFromKey}</span>}
                      </div>
                      <p className="mt-1 text-[11px] text-ink-muted line-clamp-2">{s.description}</p>
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <CapabilityBadges s={s} />
                        <span className="text-[10px] text-ink-faint">已运行 {s.runCount} 次</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 flex gap-1.5 flex-wrap">
                    <button onClick={() => { setDebugSkill(s); setDebugInput(''); setDebugOutput(''); setDebugError(''); setEditor(null) }}
                      className="px-2.5 py-1 rounded-full bg-amber-500 text-white text-[11px] font-semibold hover:bg-amber-600">🧪 调试</button>
                    {s.status === 'DRAFT' && (
                      <button onClick={() => confirmSkill(s.key)}
                        className="px-2.5 py-1 rounded-full bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700">✓ 确认使用</button>
                    )}
                    <button onClick={() => setEditor({
                      mode: 'edit', originalKey: s.key, key: s.key, name: s.name, description: s.description,
                      category: s.category, content: s.content || '', useSearch: s.useSearch,
                      useProjectLibrary: s.useProjectLibrary, usePostInvestment: s.usePostInvestment,
                      scenes: s.scenes,
                    })}
                      className="px-2.5 py-1 rounded-full bg-gray-100 text-ink-muted text-[11px] hover:bg-gray-200">编辑</button>
                    {scene && s.scenes.length > 1 && (
                      <button onClick={() => removeFromScene(s)}
                        className="px-2.5 py-1 rounded-full bg-primary-50 text-primary-700 text-[11px] hover:bg-primary-100">移出本页</button>
                    )}
                    <button onClick={() => removeSkill(s.key)}
                      className="px-2.5 py-1 rounded-full bg-danger-50 text-danger-700 text-[11px] hover:bg-danger-100">删除</button>
                  </div>
                </div>
              ))}

              {/* 我的技能库（其他场景的技能，可跨场景启用到本页） */}
              {scene && librarySkills.length > 0 && (
                <div className="pt-2 space-y-2">
                  <p className="eyebrow border-t border-hairline pt-3">
                    📚 我的技能库 · 其他场景（可跨场景启用到本页）
                  </p>
                  {librarySkills.map(s => (
                    <div key={s.id} className="rounded-2xl bg-gray-50 border border-hairline p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-ink">{s.name}</span>
                        <span className={`pill ${s.status === 'CONFIRMED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {s.status === 'CONFIRMED' ? '🟢 已确认' : '🟡 调试中'}
                        </span>
                        <span className="pill bg-primary-50 text-primary-700">📍 {sceneLabels(s.scenes)}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-ink-muted line-clamp-2">{s.description}</p>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <button onClick={() => enableInScene(s)}
                          className="px-2.5 py-1 rounded-full bg-primary-600 text-white text-[11px] font-semibold hover:bg-primary-700">
                          ＋ 启用到{sceneLabel(scene)}
                        </button>
                        <span className="text-[10px] text-ink-faint">启用后即可在本页 AI 功能中应用（跨场景复用）</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-ink-faint pt-1">
                {scene
                  ? `已确认使用的技能挂载到其适用场景（含${sceneLabel(scene)}）的 AI 功能；同事在${sceneLabel(scene)}页可一键引用。`
                  : '已确认使用的技能将挂载到所选场景的 AI 功能，同事在对应场景页可见、可一键引用。'}
              </p>
            </>
          ) : (
            <>
              {colleagueSkills.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="w-14 h-14 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <p className="text-xs text-ink-faint">
                    {scene ? `暂无同事挂载在「${sceneLabel(scene)}」的技能（同事确认使用且适用本页的技能会出现在这里）` : '暂无同事分享的技能（同事确认使用后的技能会出现在这里）'}
                  </p>
                </div>
              ) : colleagueSkills.map(s => (
                <div key={s.id} className="rounded-2xl bg-surface border border-hairline p-3.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-ink">{s.name}</span>
                    <span className="pill bg-emerald-50 text-emerald-700">🟢 已确认</span>
                    <span className="pill bg-primary-50 text-primary-700">📍 {sceneLabels(s.scenes)}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-primary-600 font-medium">by {s.creatorName || '同事'}</p>
                  <p className="mt-1 text-[11px] text-ink-muted line-clamp-2">{s.description}</p>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <CapabilityBadges s={s} />
                    <span className="text-[10px] text-ink-faint">已运行 {s.runCount} 次</span>
                  </div>
                  <button onClick={() => forkColleague(s.key)}
                    className="mt-2.5 px-3 py-1.5 rounded-full bg-primary-600 text-white text-[11px] font-semibold hover:bg-primary-700">
                    ⧉ 一键引用
                  </button>
                  <span className="ml-2 text-[10px] text-ink-faint">复制为自己的副本{scene ? `（挂载到${sceneLabel(scene)}）` : ''}，可修改调试</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}

/** 功能页入口按钮（放 DashboardLayout actions；scene = 当前功能场景，技能按场景独立设定） */
export function SkillPanelLauncher({ scene }: { scene?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={scene ? `管理「${sceneLabel(scene)}」的 AI 技能` : '管理我的 AI 技能'}
        className="btn-secondary"
      >
        ⚙️ 我的技能
      </button>
      <SkillPanel open={open} onClose={() => setOpen(false)} scene={scene} />
    </>
  )
}
