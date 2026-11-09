'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DD_TEMPLATE_MODULES } from '@/lib/dd-workbench/template'

export interface UnclassifiedCandidate {
  moduleKey: string
  moduleName: string
  confidence: number
  rationale: string
}

export interface UnclassifiedClassification {
  summary: string
  candidates: UnclassifiedCandidate[]
  classifiedAt: string
}

export interface UnclassifiedAsset {
  id: string
  fileName: string
  fileUrl: string
  fileType: string
  fileSize: number
  ocrStatus: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'
  ocrConfidence: number | null
  pageCount: number | null
  classification: UnclassifiedClassification | null
  status: 'UNCLASSIFIED' | 'CLASSIFIED'
  moduleKey: string | null
  error: string | null
  createdAt: string
}

const ACCEPT = '.pdf,.docx,.xlsx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp,.gif'

const MODULE_NAMES = new Map(DD_TEMPLATE_MODULES.map(m => [m.key, m.name]))

const OCR_BADGES: Record<string, { label: string; className: string }> = {
  PENDING: { label: '排队中', className: 'bg-gray-100 text-ink-muted border border-hairline' },
  PROCESSING: {
    label: '识别中',
    className: 'bg-primary-50 text-primary-600 border border-primary-100 animate-pulse',
  },
  READY: { label: '已识别', className: 'bg-success-50 text-success-700 border border-success-200' },
  FAILED: { label: '识别失败', className: 'bg-danger-50 text-danger-700 border border-danger-200' },
}

function formatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024
  if (mb < 1) return `${Math.max(0.01, mb).toFixed(2)} MB`
  return `${mb.toFixed(1)} MB`
}

function httpErrorMessage(status: number, fallback: string): string {
  if (status === 401) return '登录已过期，请重新登录'
  if (status === 403) return '无编辑权限'
  return fallback
}

export default function DDUnclassifiedPanel(props: {
  projectId: string
  canEdit: boolean
  onChanged: () => void
}) {
  const { projectId, canEdit, onChanged } = props

  const [assets, setAssets] = useState<UnclassifiedAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [uploadingName, setUploadingName] = useState<string | null>(null)
  const [uploadedCount, setUploadedCount] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)
  const uploadingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/dd/unclassified/${projectId}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (mountedRef.current) {
          setError(data?.error || httpErrorMessage(res.status, '加载非分类资料失败'))
        }
        return
      }
      if (mountedRef.current) {
        setAssets(Array.isArray(data?.assets) ? (data.assets as UnclassifiedAsset[]) : [])
      }
    } catch {
      if (mountedRef.current) setError('网络异常，请稍后重试')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  // OCR 完成后还有一步异步归类（LLM 回写 classification），需要继续轮询直到归类结果出现
  const needsPoll = useMemo(
    () =>
      assets.some(
        a =>
          a.ocrStatus === 'PENDING' ||
          a.ocrStatus === 'PROCESSING' ||
          (a.ocrStatus === 'READY' && !a.classification)
      ),
    [assets]
  )
  const pollTicksRef = useRef(0)

  useEffect(() => {
    if (!needsPoll) {
      pollTicksRef.current = 0
      return
    }
    // 最多轮询 30 次（约 2 分钟），避免无法归类的短文本造成无限请求
    if (pollTicksRef.current >= 30) return
    const timer = setInterval(() => {
      pollTicksRef.current += 1
      if (pollTicksRef.current >= 30) clearInterval(timer)
      void load()
    }, 4000)
    return () => clearInterval(timer)
  }, [needsPoll, load])

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!canEdit || files.length === 0 || uploadingRef.current) return
      uploadingRef.current = true
      setError(null)
      setNotice(null)
      let okCount = 0
      for (const file of files) {
        setUploadingName(file.name)
        try {
          const formData = new FormData()
          formData.append('file', file)
          const res = await fetch(`/api/dd/unclassified/${projectId}`, {
            method: 'POST',
            body: formData,
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            setError(`${file.name}：${data?.error || httpErrorMessage(res.status, '上传失败')}`)
            continue
          }
          if (data?.duplicate) {
            setNotice(`「${file.name}」文件已存在，已跳过重复上传`)
          } else {
            okCount += 1
          }
          await load()
          onChanged()
        } catch {
          setError(`${file.name}：网络异常，上传失败`)
        }
      }
      uploadingRef.current = false
      if (mountedRef.current) {
        if (okCount > 0) setUploadedCount(count => count + okCount)
        setUploadingName(null)
      }
    },
    [canEdit, load, onChanged, projectId]
  )

  const assignModule = useCallback(
    async (asset: UnclassifiedAsset, moduleKey: string | null) => {
      if (!canEdit) return
      const snapshot = assets
      setAssets(current =>
        current.map(item =>
          item.id === asset.id
            ? {
                ...item,
                moduleKey,
                status: (moduleKey ? 'CLASSIFIED' : 'UNCLASSIFIED') as UnclassifiedAsset['status'],
              }
            : item
        )
      )
      setBusyId(asset.id)
      setError(null)
      try {
        const res = await fetch(`/api/dd/unclassified/${projectId}/${asset.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moduleKey }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setAssets(snapshot)
          setError(data?.error || httpErrorMessage(res.status, '归类失败，已恢复原状'))
          return
        }
        await load()
        onChanged()
      } catch {
        setAssets(snapshot)
        setError('网络异常，归类失败，已恢复原状')
      } finally {
        if (mountedRef.current) setBusyId(null)
      }
    },
    [assets, canEdit, load, onChanged, projectId]
  )

  const retryOcr = useCallback(
    async (asset: UnclassifiedAsset) => {
      if (!canEdit) return
      setBusyId(asset.id)
      setError(null)
      try {
        const res = await fetch(`/api/dd/unclassified/${projectId}/${asset.id}/retry`, {
          method: 'POST',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data?.error || httpErrorMessage(res.status, '重试 OCR 失败'))
          return
        }
        await load()
        onChanged()
      } catch {
        setError('网络异常，重试 OCR 失败')
      } finally {
        if (mountedRef.current) setBusyId(null)
      }
    },
    [canEdit, load, onChanged, projectId]
  )

  const removeAsset = useCallback(
    async (asset: UnclassifiedAsset) => {
      if (!canEdit) return
      if (!window.confirm(`确认删除「${asset.fileName}」？删除后无法恢复。`)) return
      setBusyId(asset.id)
      setError(null)
      try {
        const res = await fetch(`/api/dd/unclassified/${projectId}/${asset.id}`, {
          method: 'DELETE',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data?.error || httpErrorMessage(res.status, '删除失败'))
          return
        }
        await load()
        onChanged()
      } catch {
        setError('网络异常，删除失败')
      } finally {
        if (mountedRef.current) setBusyId(null)
      }
    },
    [canEdit, load, onChanged, projectId]
  )

  return (
    <div className="dd-card p-4 sm:p-5">
      <div className="text-sm font-bold text-ink">非分类资料</div>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        非分类资料：不确定归入哪个模块的文件先放这里，上传后自动 OCR 并按内容推荐模块。
      </p>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">
          <span className="flex-1">⚠ {error}</span>
          <button
            type="button"
            className="text-[11px] font-bold hover:underline"
            onClick={() => setError(null)}
          >
            关闭
          </button>
        </div>
      )}

      {notice && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-primary-100 bg-primary-50 px-3 py-2 text-xs text-primary-700">
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            className="text-[11px] font-bold hover:underline"
            onClick={() => setNotice(null)}
          >
            关闭
          </button>
        </div>
      )}

      <div
        onDragOver={e => {
          if (!canEdit) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          if (!canEdit) return
          e.preventDefault()
          setDragging(false)
          void uploadFiles(Array.from(e.dataTransfer.files))
        }}
        onClick={() => {
          if (canEdit) fileInputRef.current?.click()
        }}
        className={`mt-3 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
          !canEdit
            ? 'cursor-not-allowed border-hairline bg-gray-50 opacity-70'
            : dragging
              ? 'cursor-pointer border-primary-400 bg-primary-50'
              : 'cursor-pointer border-hairline bg-gray-50 hover:border-primary-300 hover:bg-primary-50/40'
        }`}
      >
        <div className="text-2xl">📎</div>
        <div className="mt-1 text-xs font-semibold text-ink">
          {uploadingName
            ? `上传中：${uploadingName}`
            : canEdit
              ? '拖拽文件到此处，或点击选择文件'
              : '无编辑权限'}
        </div>
        <div className="mt-1 text-[11px] text-ink-faint">
          支持 PDF / Word / Excel / PPT / txt / md / 图片，单个文件不超过 50MB，可多选
        </div>
        {uploadedCount > 0 && (
          <div className="mt-1 text-[11px] font-semibold text-success-700">
            已上传 {uploadedCount} 个
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        disabled={!canEdit}
        onChange={e => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          void uploadFiles(files)
        }}
      />

      <div className="mt-4">
        {loading && assets.length === 0 && (
          <div className="text-xs text-ink-faint">加载非分类资料...</div>
        )}

        {!loading && assets.length === 0 && (
          <div className="rounded-xl border border-hairline bg-gray-50 px-4 py-6 text-center text-xs text-ink-muted">
            还没有非分类资料，上传后会在这里自动识别与归类
          </div>
        )}

        <div className="space-y-2">
          {assets.map(asset => {
            const badge = OCR_BADGES[asset.ocrStatus] || OCR_BADGES.PENDING
            const candidates = asset.classification?.candidates ?? []
            const manualHint =
              asset.status === 'UNCLASSIFIED' &&
              candidates.some(c => c.confidence >= 0.5 && c.confidence < 0.75)

            return (
              <div key={asset.id} className="rounded-xl border border-hairline bg-surface p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink" title={asset.fileName}>
                      {asset.fileName}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                      <span>{formatSize(asset.fileSize)}</span>
                      {asset.pageCount != null && <span>{asset.pageCount} 页</span>}
                      <span className={`pill ${badge.className}`}>{badge.label}</span>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        className="rounded-full border border-hairline bg-white px-2.5 py-1 text-[11px] font-bold text-ink-muted hover:text-primary-600"
                        onClick={() => window.open(asset.fileUrl, '_blank', 'noopener,noreferrer')}
                      >
                        预览
                      </button>
                      {asset.ocrStatus === 'FAILED' && (
                        <button
                          type="button"
                          className="rounded-full bg-primary-50 px-2.5 py-1 text-[11px] font-bold text-primary-600 hover:bg-primary-100 disabled:opacity-40"
                          disabled={busyId === asset.id}
                          onClick={() => void retryOcr(asset)}
                        >
                          重试 OCR
                        </button>
                      )}
                      <button
                        type="button"
                        className="rounded-full bg-danger-50 px-2.5 py-1 text-[11px] font-bold text-danger-700 hover:bg-danger-100 disabled:opacity-40"
                        disabled={busyId === asset.id}
                        onClick={() => void removeAsset(asset)}
                      >
                        删除
                      </button>
                    </div>
                  )}
                </div>

                {asset.classification?.summary && (
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-muted">
                    {asset.classification.summary}
                  </p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-ink-muted">
                    当前归类：
                    <span className="font-semibold text-ink">
                      {asset.moduleKey
                        ? MODULE_NAMES.get(asset.moduleKey) || asset.moduleKey
                        : '未归类'}
                    </span>
                  </span>
                  <select
                    className="input-field !w-auto max-w-[180px] !py-1 !text-xs"
                    value={asset.moduleKey || ''}
                    disabled={!canEdit || busyId === asset.id}
                    onChange={e => void assignModule(asset, e.target.value || null)}
                  >
                    <option value="">未归类</option>
                    {DD_TEMPLATE_MODULES.map(m => (
                      <option key={m.key} value={m.key}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                {candidates.length > 0 && (
                  <div className="mt-2 space-y-1.5 rounded-lg bg-gray-50 px-2.5 py-2">
                    <div className="text-[11px] font-bold text-ink-muted">推荐归类</div>
                    {candidates.slice(0, 2).map(candidate => {
                      const percent = Math.round(candidate.confidence * 100)
                      const auto = candidate.confidence >= 0.75
                      const suggested =
                        candidate.confidence >= 0.5 && candidate.confidence < 0.75
                      return (
                        <div
                          key={candidate.moduleKey}
                          className="flex flex-wrap items-center gap-2 text-[11px]"
                        >
                          <span className="font-semibold text-ink">{candidate.moduleName}</span>
                          <span className="text-ink-faint">{percent}%</span>
                          {auto && (
                            <span className="pill bg-success-50 text-success-700 border border-success-200">
                              已自动归入
                            </span>
                          )}
                          {suggested && (
                            <span className="pill bg-warning-50 text-warning-700 border border-warning-200">
                              建议归入
                            </span>
                          )}
                          {suggested && canEdit && asset.moduleKey !== candidate.moduleKey && (
                            <button
                              type="button"
                              className="font-bold text-primary-600 hover:underline disabled:opacity-40"
                              disabled={busyId === asset.id}
                              onClick={() => void assignModule(asset, candidate.moduleKey)}
                            >
                              采用
                            </button>
                          )}
                        </div>
                      )
                    })}
                    {manualHint && (
                      <div className="text-[11px] text-ink-faint">
                        系统无法确定唯一模块，可在上方手动选择归类。
                      </div>
                    )}
                  </div>
                )}

                {asset.ocrStatus === 'FAILED' && asset.error && (
                  <div className="mt-2 text-[11px] text-danger-700">⚠ {asset.error}</div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
