'use client'

/**
 * 技能管理（管理员，P3 技能层）
 *
 * - 内置技能（BUILTIN）：代码注册的能力目录，只读展示 + 使用统计（随系统功能维护）
 * - 动态技能（DYNAMIC）：管理员创建的 MD 提示词技能，可编辑/启停/删除/在线试运行；
 *   激活动态技能自动挂载为 AI行研 run_skill 工具
 */

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'

interface SkillView {
  id: string | null
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
  /** 适用场景（动态技能；空数组 = 存量技能全场景兼容） */
  scenes?: string[]
  isActive: boolean
  runCount: number
  lastRunAt: string | null
  feature?: string
  createdAt: string | null
}

const CATEGORY_LABELS: Record<string, string> = {
  verification: '核验', analysis: '分析', research: '检索', report: '报告', general: '通用',
}
const CATEGORY_STYLES: Record<string, string> = {
  verification: 'bg-emerald-100 text-emerald-700',
  analysis: 'bg-primary-100 text-primary-700',
  research: 'bg-amber-100 text-amber-700',
  report: 'bg-danger-50 text-danger-700',
  general: 'bg-gray-100 text-gray-600',
}

const EMPTY_FORM = {
  key: '', name: '', description: '', category: 'general', content: '',
  useSearch: false, useProjectLibrary: false, usePostInvestment: false,
}

export default function AdminSkillsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [skills, setSkills] = useState<SkillView[]>([])
  const [builtinSkills, setBuiltinSkills] = useState<SkillView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  // 编辑/新建表单
  const [formOpen, setFormOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null) // null=新建
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState('')

  // 试运行
  const [runSkillKey, setRunSkillKey] = useState<string | null>(null)
  const [runInput, setRunInput] = useState('')
  const [runResult, setRunResult] = useState('')
  const [running, setRunning] = useState(false)

  const isAdmin = session?.user?.role === 'ADMIN'

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/login?callbackUrl=/admin/skills')
  }, [status, router])

  // 我的技能（所有登录账号）：个人技能接口，天然只返回本人创建的技能
  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills')
      const data = await res.json()
      if (res.ok) {
        const mine = (data.mySkills || []) as Array<Omit<SkillView, 'type' | 'feature'>>
        setSkills(mine.map(s => ({ ...s, type: 'DYNAMIC' as const })))
      } else setError(data.error || '加载失败')
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }, [])

  // 内置技能目录（仅管理员）：管理端接口，随系统功能维护、只读展示
  const fetchBuiltin = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/skills')
      const data = await res.json()
      if (res.ok) setBuiltinSkills((data.skills || []).filter((s: SkillView) => s.type === 'BUILTIN'))
      else setError(data.error || '加载内置技能失败')
    } catch {
      setError('网络错误')
    }
  }, [])

  useEffect(() => {
    if (status === 'authenticated') {
      fetchSkills()
      if (isAdmin) fetchBuiltin()
    } else if (status === 'unauthenticated') {
      setLoading(false)
    }
  }, [status, isAdmin, fetchSkills, fetchBuiltin])

  // ── 表单：新建 / 编辑 ──
  const openCreate = () => {
    setEditingKey(null)
    setForm({ ...EMPTY_FORM })
    setFormErr('')
    setFormOpen(true)
  }
  const openEdit = (s: SkillView) => {
    setEditingKey(s.key)
    setForm({
      key: s.key, name: s.name, description: s.description, category: s.category, content: s.content || '',
      useSearch: s.useSearch, useProjectLibrary: s.useProjectLibrary, usePostInvestment: s.usePostInvestment,
    })
    setFormErr('')
    setFormOpen(true)
  }
  const submitForm = async () => {
    if (saving) return
    setSaving(true)
    setFormErr('')
    try {
      const isCreate = editingKey === null
      const res = await fetch('/api/skills', {
        method: isCreate ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isCreate ? form : { ...form, key: editingKey }),
      })
      const data = await res.json()
      if (!res.ok) { setFormErr(data.error || '保存失败'); return }
      setFormOpen(false)
      setMsg(isCreate ? `技能「${form.name}」已创建，AI行研可自动调用` : `技能「${form.name}」已更新`)
      await fetchSkills()
    } catch {
      setFormErr('网络错误')
    } finally {
      setSaving(false)
    }
  }

  // ── 启停 / 删除 ──
  const toggleActive = async (s: SkillView) => {
    const res = await fetch('/api/skills', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: s.key, isActive: !s.isActive }),
    })
    if (res.ok) { setMsg(`技能「${s.name}」已${!s.isActive ? '启用' : '停用'}`); await fetchSkills() }
  }
  const removeSkill = async (s: SkillView) => {
    if (!window.confirm(`删除技能「${s.name}」？该操作不可恢复。`)) return
    const res = await fetch(`/api/skills?key=${s.key}`, { method: 'DELETE' })
    if (res.ok) { setMsg(`技能「${s.name}」已删除`); await fetchSkills() }
  }

  // ── 试运行 ──
  const submitRun = async () => {
    if (running || !runSkillKey) return
    setRunning(true)
    setRunResult('')
    try {
      const res = await fetch('/api/skills/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: runSkillKey, input: runInput }),
      })
      const data = await res.json()
      setRunResult(res.ok ? data.content : `❌ ${data.error || '运行失败'}`)
    } catch {
      setRunResult('❌ 网络错误')
    } finally {
      setRunning(false)
    }
  }

  if (status !== 'authenticated') {
    return (
      <DashboardLayout title="技能管理" subtitle="请先登录后管理你的 AI 分析技能">
        <div className="p-10 text-center text-ink-faint text-sm">{loading ? '加载中...' : '请先登录后管理你的技能'}</div>
      </DashboardLayout>
    )
  }

  const dynamic = skills.filter(s => s.type === 'DYNAMIC')
  const builtin = builtinSkills

  return (
    <DashboardLayout title="技能管理" subtitle="AI 能力注册表 · 动态技能自动挂载到 AI行研">
      <div className="max-w-5xl mx-auto space-y-5 pb-6">
        {msg && <div className="p-3 rounded-xl text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-between">
          <span>✓ {msg}</span>
          <button onClick={() => setMsg('')} className="text-emerald-500 hover:text-emerald-700">✕</button>
        </div>}
        {error && <div className="p-3 rounded-xl text-xs bg-danger-50 text-danger-700 border border-danger-200">{error}</div>}

        {/* 动态技能 */}
        <div className="bg-surface rounded-2xl shadow-soft p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-lg font-bold text-ink">动态技能 <span className="font-normal text-ink-faint text-xs">（{dynamic.length} 个 · MD 提示词技能，激活后 AI行研可调用）</span></h3>
            <button
              onClick={openCreate}
              className="btn-primary"
            >
              ＋ 新建技能
            </button>
          </div>
          <p className="text-[11px] text-ink-faint mb-3">技能内容（MD）作为 system prompt 执行；勾选联网后技能可调用 web_search 检索最新信息</p>

          {dynamic.length === 0 ? (
            <div className="py-8 text-center text-xs text-ink-faint bg-gray-50 rounded-xl">
              暂无动态技能。点击「新建技能」创建专业分析能力（如：融资窗口评估、团队背景核查、赛道格局分析）
            </div>
          ) : (
            <div className="space-y-2.5">
              {dynamic.map(s => (
                <div key={s.key} className={`rounded-xl border p-3.5 ${s.isActive ? 'border-hairline bg-surface' : 'border-hairline bg-gray-50 opacity-75'}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-[240px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-ink">{s.name}</span>
                        <code className="px-1.5 py-0.5 rounded bg-gray-100 text-ink-muted text-[10px]">{s.key}</code>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${CATEGORY_STYLES[s.category] || CATEGORY_STYLES.general}`}>
                          {CATEGORY_LABELS[s.category] || s.category}
                        </span>
                        {s.useSearch && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary-50 text-primary-700 border border-primary-100">🌐 可联网</span>}
                        {s.useProjectLibrary && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-ink-muted border border-hairline">📁 项目库</span>}
                        {s.usePostInvestment && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">📊 投后报告</span>}
                        {s.type === 'DYNAMIC' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-100">
                            📍 {s.scenes && s.scenes.length > 0 ? s.scenes.join('、') : '全场景'}
                          </span>
                        )}
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${s.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          {s.status === 'CONFIRMED' ? '🟢 已确认使用' : '🟡 调试中'}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${s.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                          {s.isActive ? '● 已激活' : '○ 已停用'}
                        </span>
                      </div>
                      <p className="text-xs text-ink-muted mt-1 leading-relaxed">{s.description}</p>
                      <p className="text-[10px] text-ink-faint mt-1">
                        运行 {s.runCount} 次{s.lastRunAt ? ` · 最近 ${new Date(s.lastRunAt).toLocaleString('zh-CN')}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => { setRunSkillKey(s.key); setRunInput(''); setRunResult('') }} className="text-[11px] px-2.5 py-1.5 bg-primary-50 text-primary-700 rounded-full font-bold hover:bg-primary-100 border border-primary-100">▶ 试运行</button>
                      <button onClick={() => openEdit(s)} className="text-[11px] px-2.5 py-1.5 bg-gray-50 text-ink-muted rounded-full font-bold hover:bg-gray-100 border border-hairline">编辑</button>
                      <button onClick={() => toggleActive(s)} className="text-[11px] px-2.5 py-1.5 bg-gray-50 text-ink-muted rounded-full font-bold hover:bg-gray-100 border border-hairline">{s.isActive ? '停用' : '启用'}</button>
                      <button onClick={() => removeSkill(s)} className="text-[11px] px-2.5 py-1.5 bg-danger-50 text-danger-700 rounded-full font-bold hover:bg-danger-100 border border-danger-200">删除</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 新建/编辑表单 */}
          {formOpen && (
            <div className="mt-4 pt-4 border-t border-hairline rounded-xl bg-gray-50 p-4 space-y-3">
              <p className="text-xs font-bold text-ink">{editingKey === null ? '新建动态技能' : `编辑技能：${editingKey}`}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-ink-muted">技能标识（key）</label>
                  <input
                    value={form.key}
                    onChange={e => setForm({ ...form, key: e.target.value })}
                    disabled={editingKey !== null}
                    placeholder="如 financing-window-check（小写字母/数字/连字符）"
                    className="input-field mt-1 disabled:bg-gray-100 disabled:text-ink-faint"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-ink-muted">技能名称</label>
                  <input
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="如：融资时间窗口评估"
                    className="input-field mt-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-ink-muted">能力说明（AI行研据此判断何时调用）</label>
                <input
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="如：评估某行业/项目的融资时间窗口剩余时长与进入时点建议"
                  className="input-field mt-1"
                />
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <label className="text-[11px] font-bold text-ink-muted">分类</label>
                  <select
                    value={form.category}
                    onChange={e => setForm({ ...form, category: e.target.value })}
                    className="input-field mt-1"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 mt-4 cursor-pointer">
                  <input type="checkbox" checked={form.useSearch} onChange={e => setForm({ ...form, useSearch: e.target.checked })} className="w-4 h-4" />
                  <span className="text-xs text-ink-muted">允许联网搜索（技能执行时可检索最新信息）</span>
                </label>
                <label className="flex items-center gap-2 mt-4 cursor-pointer">
                  <input type="checkbox" checked={form.useProjectLibrary} onChange={e => setForm({ ...form, useProjectLibrary: e.target.checked })} className="w-4 h-4" />
                  <span className="text-xs text-ink-muted">查询项目库（可检索内部项目及尽调结论）</span>
                </label>
                <label className="flex items-center gap-2 mt-4 cursor-pointer">
                  <input type="checkbox" checked={form.usePostInvestment} onChange={e => setForm({ ...form, usePostInvestment: e.target.checked })} className="w-4 h-4" />
                  <span className="text-xs text-ink-muted">查询投后分析报告（可检索已投项目经营分析）</span>
                </label>
              </div>
              <div>
                <label className="text-[11px] font-bold text-ink-muted">技能提示词（MD，作为 system prompt 执行）</label>
                <textarea
                  value={form.content}
                  onChange={e => setForm({ ...form, content: e.target.value })}
                  placeholder={'你是一级市场资深投资人，专注融资时间窗口评估……\n## 分析框架\n1. 行业融资热度（近12个月事件数量与金额）\n2. ……\n## 输出要求\n- 结论克制、数据可核验\n- ……'}
                  rows={8}
                  className="input-field mt-1 font-mono leading-relaxed"
                />
              </div>
              {formErr && <p className="text-xs text-danger-700">{formErr}</p>}
              <div className="flex items-center gap-2">
                <button
                  onClick={submitForm}
                  disabled={saving}
                  className="btn-primary"
                >
                  {saving ? '保存中...' : editingKey === null ? '创建技能' : '保存修改'}
                </button>
                <button onClick={() => setFormOpen(false)} className="btn-secondary">取消</button>
              </div>
            </div>
          )}

          {/* 试运行面板 */}
          {runSkillKey && (
            <div className="mt-4 pt-4 border-t border-hairline rounded-xl bg-gray-50 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-primary-700">▶ 试运行：{runSkillKey}</p>
                <button onClick={() => setRunSkillKey(null)} className="text-ink-faint hover:text-ink text-xs">✕ 关闭</button>
              </div>
              <textarea
                value={runInput}
                onChange={e => setRunInput(e.target.value)}
                placeholder="输入技能分析对象/问题（如：评估具身智能行业的融资时间窗口）"
                rows={3}
                className="input-field"
              />
              <button
                onClick={submitRun}
                disabled={running || !runInput.trim()}
                className="btn-primary"
              >
                {running ? '运行中（真实 AI 调用）...' : '运行技能'}
              </button>
              {runResult && (
                <div className="rounded-xl border border-hairline bg-surface p-3.5 text-xs text-ink leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {runResult}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 内置技能目录（仅管理员可见，随系统功能维护、只读） */}
        {isAdmin && (
          <div className="bg-surface rounded-2xl shadow-soft p-5">
            <h3 className="text-lg font-bold text-ink mb-1">内置技能 <span className="font-normal text-ink-faint text-xs">（{builtin.length} 个 · 随系统功能维护，只读）</span></h3>
            <p className="text-[11px] text-ink-faint mb-3">系统代码注册的 AI 能力目录与使用统计；在对应功能入口自动运行</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {builtin.map(s => (
                <div key={s.key} className="rounded-xl border border-hairline bg-gray-50 p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-ink">{s.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${CATEGORY_STYLES[s.category] || CATEGORY_STYLES.general}`}>
                      {CATEGORY_LABELS[s.category] || s.category}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-muted mt-1 leading-relaxed">{s.description}</p>
                  <p className="text-[10px] text-ink-faint mt-1.5">
                    入口：{s.feature} · 运行 {s.runCount} 次{s.lastRunAt ? ` · 最近 ${new Date(s.lastRunAt).toLocaleDateString('zh-CN')}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
