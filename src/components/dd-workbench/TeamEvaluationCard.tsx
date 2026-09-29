'use client'

/**
 * 团队评价表（尽调·团队与治理模块，10 分制）
 *
 * 一级权重固定：实控人/CEO 独占 60 分；团队整体独占 20 分；联创&核心高管共享 20 分（取平均）
 * 二级权重可调（每人合计 100%），评分 0-10；行得分 = 权重 × 评分 × 系数（CEO=6，其余=2）
 * 最终得分 =（CEO + 高管平均 + 团队整体）/ 10；>8 绿 / 7.5-8 黄 / 7-7.5 橙 / ≤7 红
 */

import { useState, useEffect, useCallback, Fragment } from 'react'

// ── 类型（与后端 team-evaluation.ts 对齐） ──

type ProfileType = 'CEO' | 'TECH' | 'OPS'

interface MemberDimension {
  key: string
  label: string
  hint: string
  group: string
  weight: number
  score: number | null
}

interface TeamMember {
  id: string
  name: string
  roleLabel: string
  profileType: ProfileType
  dimensions: MemberDimension[]
}

interface EvaluationState {
  members: TeamMember[]
  team: MemberDimension[]
  status: 'DRAFT' | 'CONFIRMED'
  finalScore: number | null
}

const PROFILE_LABELS: Record<ProfileType, string> = {
  CEO: '实控人/CEO · 独占 60 分',
  TECH: '产品&技术画像 · 共享 20 分',
  OPS: '运营&销售画像 · 共享 20 分',
}

const SCORE_COLOR_STYLES: Record<string, { bg: string; label: string }> = {
  green: { bg: 'bg-emerald-500', label: '优秀' },
  yellow: { bg: 'bg-yellow-400', label: '良好' },
  orange: { bg: 'bg-orange-400', label: '一般' },
  red: { bg: 'bg-red-500', label: '风险' },
}

function scoreColor(score: number): 'green' | 'yellow' | 'orange' | 'red' {
  if (score > 8) return 'green'
  if (score > 7.5) return 'yellow'
  if (score > 7) return 'orange'
  return 'red'
}

/** 行得分 = 权重 × 评分 × 系数 */
function rowScore(weight: number, score: number | null, coefficient: number): number | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null
  return Math.round(weight * score * coefficient * 100) / 100
}

/** 单人小计 */
function subtotal(dims: MemberDimension[], coefficient: number): number | null {
  if (dims.some(d => d.score === null || d.score === undefined)) return null
  return Math.round(dims.reduce((a, d) => a + d.weight * (d.score || 0) * coefficient, 0) * 100) / 100
}

/** 前端本地实时计算（与后端 computeEvaluation 口径一致） */
function computeLocal(members: TeamMember[], team: MemberDimension[]) {
  const ceo = members.find(m => m.profileType === 'CEO') || null
  const execs = members.filter(m => m.profileType !== 'CEO')
  const ceoScore = ceo ? subtotal(ceo.dimensions, 6) : null
  const execSubs = execs.map(m => ({ id: m.id, name: m.name, score: subtotal(m.dimensions, 2) }))
  const teamScore = subtotal(team, 2)
  const scoredExecs = execSubs.filter(e => e.score !== null).map(e => e.score as number)
  const execAvg = scoredExecs.length > 0 ? Math.round((scoredExecs.reduce((a, b) => a + b, 0) / scoredExecs.length) * 100) / 100 : null
  const allScored = ceoScore !== null && teamScore !== null && execSubs.every(e => e.score !== null)
  const finalScore = allScored
    ? Math.round((((ceoScore as number) + (execAvg as number) + (teamScore as number)) / 10) * 100) / 100
    : null
  return { ceoScore, execSubs, execAvg, teamScore, allScored, finalScore }
}

// ── 组件 ──

export default function TeamEvaluationCard({
  projectId,
  canEdit,
  hasResourceData,
  onChanged,
}: {
  projectId: string
  canEdit: boolean
  hasResourceData: boolean
  onChanged: () => Promise<void>
}) {
  const [evaluation, setEvaluation] = useState<EvaluationState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [activeExecId, setActiveExecId] = useState<string>('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/dd/team-evaluation/${projectId}`)
      const data = await res.json()
      if (res.ok) {
        const ev = data.evaluation as EvaluationState | null
        setEvaluation(ev)
        if (ev && ev.members.length > 0) {
          const firstExec = ev.members.find(m => m.profileType !== 'CEO')
          setActiveExecId(firstExec?.id || '')
        }
      } else {
        setErr(data.error || '加载失败')
      }
    } catch {
      setErr('网络错误')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    setMsg('')
    setErr('')
    load()
  }, [load])

  const generate = async () => {
    if (busy) return
    setBusy(true)
    setErr('')
    setMsg('AI 正在从模块资料中识别核心成员（约 30 秒）...')
    try {
      const res = await fetch(`/api/dd/team-evaluation/${projectId}/generate`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setMsg(''); setErr(data.error || '生成失败'); return }
      setMsg('')
      await load()
    } catch {
      setMsg('')
      setErr('网络错误（AI 识别耗时较长，请稍后重试）')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!evaluation || busy) return
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`/api/dd/team-evaluation/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members: evaluation.members, team: evaluation.team }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error || '保存失败'); return }
      setMsg('评价表已保存 ✓')
      await load()
    } catch { setErr('网络错误') } finally { setBusy(false) }
  }

  const confirmOrReopen = async () => {
    if (!evaluation || busy) return
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`/api/dd/team-evaluation/${projectId}/confirm`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setErr(data.error || '操作失败'); return }
      if (data.reopened) {
        setMsg('已重新打开为草稿，可编辑后再次确认')
      } else {
        setMsg('')
      }
      await load()
      await onChanged()
    } catch { setErr('网络错误') } finally { setBusy(false) }
  }

  /** 更新某成员某维度 */
  const patchDim = (target: 'members' | 'team', memberId: string, dimKey: string, field: 'weight' | 'score', value: number | null) => {
    setEvaluation(prev => {
      if (!prev) return prev
      if (target === 'team') {
        return { ...prev, team: prev.team.map(d => (d.key === dimKey ? { ...d, [field]: value } : d)) }
      }
      return {
        ...prev,
        members: prev.members.map(m =>
          m.id === memberId
            ? { ...m, dimensions: m.dimensions.map(d => (d.key === dimKey ? { ...d, [field]: value } : d)) }
            : m
        ),
      }
    })
    setMsg('')
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-[#ddd7f2] bg-white p-4 text-center">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#8d84e0] mx-auto"></div>
      </div>
    )
  }

  const confirmed = evaluation?.status === 'CONFIRMED'
  const result = evaluation ? computeLocal(evaluation.members, evaluation.team) : null
  const ceo = evaluation?.members.find(m => m.profileType === 'CEO') || null
  const execs = evaluation?.members.filter(m => m.profileType !== 'CEO') || []
  const activeExec = execs.find(m => m.id === activeExecId) || execs[0] || null

  return (
    <div className="rounded-2xl border border-[#ddd7f2] bg-white p-4">
      {/* 标题 */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <span className="text-sm font-bold text-gray-800">
          📋 团队评价表 <span className="text-[10px] font-normal text-gray-400">必填 · 实控人 60 分 + 团队整体 20 分 + 联创/高管平均 20 分 = 10 分制</span>
        </span>
        {confirmed && evaluation?.finalScore !== null && evaluation?.finalScore !== undefined && (
          <span className={`px-3 py-1 rounded-xl text-white text-lg font-black ${SCORE_COLOR_STYLES[scoreColor(evaluation.finalScore)].bg}`}>
            {evaluation.finalScore.toFixed(2)}
            <span className="text-[10px] font-bold ml-1">{SCORE_COLOR_STYLES[scoreColor(evaluation.finalScore)].label}</span>
          </span>
        )}
      </div>

      {msg && <div className="mb-3 p-2.5 rounded-lg text-xs bg-blue-50 text-blue-700 border border-blue-100">{msg}</div>}
      {err && <div className="mb-3 p-2.5 rounded-lg text-xs bg-red-50 text-red-600 border border-red-100">{err}</div>}

      {/* 未生成 */}
      {!evaluation && (
        <div className="py-6 text-center">
          <p className="text-xs text-gray-400 mb-3">
            {hasResourceData ? 'AI 将从本模块上传的简历中识别核心成员（实控人/CEO、联创、核心高管）并生成打分表' : '请先到资料中心上传核心成员简历，再生成评价表'}
          </p>
          {canEdit && (
            <button
              onClick={generate}
              disabled={busy || !hasResourceData}
              className={`px-5 py-2 text-sm font-bold rounded-xl shadow-md transition-all ${
                hasResourceData && !busy
                  ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-500/25'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none'
              }`}
            >
              {busy ? '⏳ AI 识别中...' : '📋 生成团队评价表'}
            </button>
          )}
          {!canEdit && <p className="text-xs text-gray-400">由项目维护人生成并评分</p>}
        </div>
      )}

      {/* 已生成：编辑 / 只读 */}
      {evaluation && (
        <div className="space-y-4">
          {/* ── 区段一：实控人/CEO（60 分） ── */}
          {ceo && (
            <DimensionSection
              title={`实控人/CEO · 独占 60 分`}
              badge={`${ceo.name}${ceo.roleLabel ? `（${ceo.roleLabel}）` : ''}`}
              badgeStyle="bg-blue-600 text-white"
              dims={ceo.dimensions}
              coefficient={6}
              subtotalVal={result?.ceoScore ?? null}
              editable={canEdit && !confirmed}
              onPatch={(dimKey, field, value) => patchDim('members', ceo.id, dimKey, field, value)}
            />
          )}

          {/* ── 区段二：联创&核心高管（共享 20 分，取平均） ── */}
          <div>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <span className="text-xs font-bold text-[#6f63c9]">联创 & 核心高管 · 共享 20 分（{execs.length} 人取平均）</span>
              {result?.execAvg !== null && result?.execAvg !== undefined && (
                <span className="text-[11px] font-bold text-[#6f63c9]">平均 {result.execAvg.toFixed(2)} 分</span>
              )}
            </div>
            {execs.length === 0 ? (
              <p className="text-[11px] text-gray-400 px-1 py-2">未识别到联创/核心高管（仅实控人评分也可确认）</p>
            ) : (
              <>
                {/* 成员 tab */}
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  {execs.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setActiveExecId(m.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                        activeExec?.id === m.id ? 'bg-[#6f63c9] text-white shadow-sm' : 'bg-[#efedfb] text-[#6f63c9] hover:bg-[#e2ddf8]'
                      }`}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
                {activeExec && (
                  <DimensionSection
                    title={PROFILE_LABELS[activeExec.profileType]}
                    badge={`${activeExec.name}${activeExec.roleLabel ? `（${activeExec.roleLabel}）` : ''}`}
                    badgeStyle="bg-[#8d84e0] text-white"
                    dims={activeExec.dimensions}
                    coefficient={2}
                    subtotalVal={result?.execSubs.find(e => e.id === activeExec.id)?.score ?? null}
                    editable={canEdit && !confirmed}
                    onPatch={(dimKey, field, value) => patchDim('members', activeExec.id, dimKey, field, value)}
                  />
                )}
              </>
            )}
          </div>

          {/* ── 区段三：团队整体（20 分） ── */}
          <DimensionSection
            title="团队整体 · 独占 20 分"
            badge="完整性 / 稳定性"
            badgeStyle="bg-teal-600 text-white"
            dims={evaluation.team}
            coefficient={2}
            subtotalVal={result?.teamScore ?? null}
            editable={canEdit && !confirmed}
            onPatch={(dimKey, field, value) => patchDim('team', '', dimKey, field, value)}
          />

          {/* ── 汇总与操作 ── */}
          {!confirmed ? (
            <div className="pt-3 border-t border-gray-100 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                <span className="text-gray-500">
                  实时合计：CEO {result?.ceoScore?.toFixed(2) ?? '—'} + 高管平均 {result?.execAvg?.toFixed(2) ?? '—'} + 团队 {result?.teamScore?.toFixed(2) ?? '—'}
                </span>
                <span className="font-black text-gray-700">
                  最终得分（10 分制）：{result?.finalScore?.toFixed(2) ?? '—'}
                </span>
              </div>
              {canEdit && (
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={save}
                    disabled={busy}
                    className="px-4 py-1.5 text-xs font-bold rounded-lg border border-[#ddd7f2] text-[#6f63c9] hover:bg-[#efedfb] disabled:opacity-40"
                  >
                    {busy ? '处理中...' : '保存草稿'}
                  </button>
                  <button
                    onClick={confirmOrReopen}
                    disabled={busy || !result?.allScored}
                    className={`px-4 py-1.5 text-xs font-bold rounded-lg shadow-md transition-all ${
                      result?.allScored && !busy
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-500/25'
                        : 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none'
                    }`}
                    title={result?.allScored ? '确认后计算最终得分' : '完成全部维度评分后可确认'}
                  >
                    ✅ 确认评分
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="pt-3 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs text-gray-400">
                已确认 · 得分构成：CEO {result?.ceoScore?.toFixed(2) ?? '—'} + 高管平均 {result?.execAvg?.toFixed(2) ?? '—'} + 团队 {result?.teamScore?.toFixed(2) ?? '—'}，满分 10 分
              </span>
              {canEdit && (
                <button
                  onClick={confirmOrReopen}
                  disabled={busy}
                  className="px-3 py-1 text-xs font-bold rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
                >
                  ✏️ 重新编辑
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 维度表格区段 ──

function DimensionSection({
  title,
  badge,
  badgeStyle,
  dims,
  coefficient,
  subtotalVal,
  editable,
  onPatch,
}: {
  title: string
  badge: string
  badgeStyle: string
  dims: MemberDimension[]
  coefficient: number
  subtotalVal: number | null
  editable: boolean
  onPatch: (dimKey: string, field: 'weight' | 'score', value: number | null) => void
}) {
  const weightSum = dims.reduce((a, d) => a + (Number(d.weight) || 0), 0)
  const weightInvalid = Math.abs(weightSum - 1) > 0.005
  // 按分组渲染
  const groups = Array.from(new Set(dims.map(d => d.group)))

  return (
    <div className="rounded-xl border border-[#efedfb] overflow-hidden">
      <div className={`flex items-center justify-between gap-2 px-3 py-2 flex-wrap`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${badgeStyle}`}>{badge}</span>
          <span className="text-[11px] font-bold text-gray-600">{title}</span>
        </div>
        <span className="text-xs font-black text-gray-700">
          小计：<span className={subtotalVal === null ? 'text-gray-300' : 'text-[#6f63c9]'}>{subtotalVal?.toFixed(2) ?? '待评分'}</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50/80 text-gray-400 text-[10px]">
              <th className="text-left font-bold px-3 py-1.5">二级目录</th>
              <th className="text-left font-bold px-2 py-1.5">提示</th>
              <th className="text-right font-bold px-2 py-1.5 w-20">权重(%)</th>
              <th className="text-right font-bold px-2 py-1.5 w-20">评分(0-10)</th>
              <th className="text-right font-bold px-3 py-1.5 w-16">得分</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(group => (
              <Fragment key={group}>
                {dims.filter(d => d.group === group).map(d => {
                  const rs = rowScore(d.weight, d.score, coefficient)
                  return (
                    <tr key={d.key} className="border-t border-gray-50">
                      <td className="px-3 py-1.5 font-bold text-gray-700">{d.label}</td>
                      <td className="px-2 py-1.5 text-gray-400 text-[10px] max-w-[180px] truncate" title={d.hint}>{d.hint}</td>
                      <td className="px-2 py-1.5 text-right">
                        {editable ? (
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={Math.round(d.weight * 100)}
                            onChange={e => {
                              const v = e.target.value === '' ? null : Number(e.target.value)
                              onPatch(d.key, 'weight', v === null ? 0 : v / 100)
                            }}
                            className="w-16 px-1.5 py-0.5 text-right border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                          />
                        ) : (
                          <span className="text-gray-600">{(d.weight * 100).toFixed(0)}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {editable ? (
                          <input
                            type="number"
                            min={0}
                            max={10}
                            step={0.5}
                            value={d.score ?? ''}
                            onChange={e => {
                              const v = e.target.value === '' ? null : Number(e.target.value)
                              onPatch(d.key, 'score', v)
                            }}
                            className={`w-16 px-1.5 py-0.5 text-right rounded-lg border focus:ring-2 focus:ring-blue-200 ${
                              d.score === null ? 'border-amber-200 bg-amber-50/50' : 'border-gray-200 focus:border-blue-300'
                            }`}
                          />
                        ) : (
                          <span className="font-bold text-gray-700">{d.score ?? '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-bold text-gray-600">{rs?.toFixed(2) ?? '—'}</td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {weightInvalid && (
        <p className="px-3 py-1.5 text-[10px] text-red-500 bg-red-50/60 border-t border-red-100">
          ⚠ 权重合计为 {(weightSum * 100).toFixed(1)}%，须等于 100%（不调整请保持默认）
        </p>
      )}
    </div>
  )
}
