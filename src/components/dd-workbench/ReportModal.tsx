'use client'

/**
 * 尽调整包报告弹层：实时预览 / 冻结快照 / 版本历史 / Markdown 导出
 */

import { useState } from 'react'
import { DD_TASK_STATUS_LABELS, DD_RED_FLAG_LABELS, type DDTaskStatus } from '@/lib/dd-workbench/constants'
import type { AssembledFullPackage } from '@/lib/dd-workbench/report'
import type { ReportVersionView } from './ModuleDetail'

const taskStatusStyles: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  IN_REVIEW: 'bg-amber-100 text-amber-700',
  DONE: 'bg-emerald-100 text-emerald-700',
  BLOCKED: 'bg-red-100 text-red-700',
}

interface ReportModalProps {
  report: AssembledFullPackage | null
  versionMeta: { version: number; frozenBy: string | null; frozenAt: string } | null
  versions: ReportVersionView[]
  onClose: () => void
  onViewVersion: (versionId: string) => void
  onDownload: (versionId?: string) => void
}

export default function ReportModal({
  report,
  versionMeta,
  versions,
  onClose,
  onViewVersion,
  onDownload,
}: ReportModalProps) {
  const [tab, setTab] = useState<'report' | 'versions'>('report')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-gray-900">尽调整包报告 · 投委会阅读版</h3>
            {versionMeta ? (
              <span className="px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-600 text-xs font-bold">
                冻结版 v{versionMeta.version} · {versionMeta.frozenBy || ''} · {versionMeta.frozenAt.slice(0, 10)}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-600 text-xs font-bold">实时预览（未冻结）</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onDownload()}
              className="px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg hover:bg-blue-100"
              title="导出 Markdown"
            >
              ⬇ 导出 MD
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 px-2">✕</button>
          </div>
        </div>

        {/* Tab */}
        <div className="flex gap-1 px-5 pt-3 border-b border-gray-100">
          {([
            { key: 'report' as const, label: '报告内容' },
            { key: 'versions' as const, label: `版本历史（${versions.length}）` },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm font-bold rounded-t-lg ${
                tab === t.key ? 'text-blue-700 border-b-2 border-blue-600' : 'text-gray-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'versions' ? (
            versions.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400">暂无冻结版本。批次复核通过后可冻结生成投委会材料。</p>
            ) : (
              <div className="space-y-2">
                {versions.map(v => (
                  <div key={v.id} className="flex items-center justify-between px-4 py-3 bg-slate-50 rounded-xl">
                    <div className="text-sm">
                      <b className="text-gray-900">v{v.version}</b>
                      <span className="text-gray-400 ml-2">
                        {v.frozenBy?.name || '未知'} 冻结于 {new Date(v.frozenAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => onViewVersion(v.id)} className="px-3 py-1.5 bg-white border border-gray-200 text-xs rounded-lg hover:border-blue-300">
                        查看
                      </button>
                      <button onClick={() => onDownload(v.id)} className="px-3 py-1.5 bg-blue-50 text-blue-700 text-xs rounded-lg font-bold">
                        导出
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : !report ? (
            <div className="py-16 flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="space-y-5">
              {/* 一页摘要 */}
              <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl">
                <h4 className="font-bold text-gray-900">{report.project.name} · 尽调整包</h4>
                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-600">
                  <span>行业：{report.project.industry || '—'}</span>
                  <span>轮次：{report.batch.round || report.project.financingRound || '—'}</span>
                  <span>融资金额：{report.project.totalAmount || '—'}</span>
                  <span>完成度：{report.progress.done}/{report.progress.total}（{report.progress.completionRate}%）</span>
                </div>
                {report.redFlags.length > 0 && (
                  <div className="mt-2 flex gap-1.5 flex-wrap">
                    {report.redFlags.map(f => (
                      <span key={f.moduleKey} className={`px-2 py-0.5 rounded text-[11px] font-bold ${f.level === 'HIGH' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        ⚑ {f.name}（{f.level === 'HIGH' ? '高' : '中'}）
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 九大模块 */}
              {report.modules.map(m => (
                <div key={m.moduleKey} className="border border-gray-100 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50">
                    <span className="font-bold text-sm text-gray-900">{m.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${taskStatusStyles[m.status] || 'bg-gray-100'}`}>
                      {DD_TASK_STATUS_LABELS[m.status as DDTaskStatus] || m.status}
                    </span>
                    {m.redFlagLevel !== 'NONE' && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${m.redFlagLevel === 'HIGH' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        ⚑ {DD_RED_FLAG_LABELS[m.redFlagLevel as keyof typeof DD_RED_FLAG_LABELS]}
                      </span>
                    )}
                  </div>
                  <div className="px-4 py-3 text-sm space-y-2">
                    <p className="text-gray-800 leading-relaxed">{m.conclusion?.trim() || <span className="text-gray-400">（结论未填写）</span>}</p>
                    {m.supportingEvidence.length > 0 && (
                      <div className="text-xs">
                        <span className="text-emerald-600 font-bold">支撑证据（已确认）：</span>
                        {m.supportingEvidence.map(e => (
                          <div key={e.id} className="text-gray-500 mt-0.5">
                            [{e.ref}] {e.sourceLabel}{e.location ? `（${e.location}）` : ''}（{e.grade} 级）：“{e.excerpt}”
                          </div>
                        ))}
                      </div>
                    )}
                    {m.conflictEvidence.length > 0 && (
                      <div className="text-xs">
                        <span className="text-red-500 font-bold">⚠ 冲突证据（待裁决）：</span>
                        {m.conflictEvidence.map(e => (
                          <div key={e.id} className="text-red-400 mt-0.5">[{e.ref}] “{e.excerpt}”</div>
                        ))}
                      </div>
                    )}
                    {m.pendingEvidence.length > 0 && (
                      <div className="text-xs text-gray-400">待核验附录：{m.pendingEvidence.length} 条（D 级/待确认，不作为结论支撑）</div>
                    )}
                    {m.openQuestions.length > 0 && (
                      <p className="text-xs text-amber-600">未决：{m.openQuestions.join('；')}</p>
                    )}
                  </div>
                </div>
              ))}

              {/* 缺口清单 */}
              {report.pendingItems.length > 0 && (
                <div className="px-4 py-3 bg-amber-50/60 border border-amber-100 rounded-xl text-xs">
                  <b className="text-amber-700">缺口清单（{report.pendingItems.length} 个未完成模块）：</b>
                  <span className="text-gray-600 ml-1">
                    {report.pendingItems.map(p => `${p.name}（${p.reason}）`).join('、')}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
