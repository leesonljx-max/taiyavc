'use client'

/**
 * 尽调报告预览器（全屏弹窗）
 *
 * - 读取 /api/dd/deck/[deckId]，优先使用 spec.slides 渲染
 * - 1280×720 画布按容器可用宽高等比缩放（最大 1）
 * - 键盘 ←/→ 翻页、Esc 关闭；缩略图条横向滚动
 * - 支持导出当前页 PNG 与全部页面 ZIP（html-to-image + jszip 动态加载）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import DeckSlide from './DeckSlide'
import type { DeckSpec, DeckType, SlideSpec } from '@/lib/dd-deck/spec'

interface DeckDetailDeck {
  id: string
  projectId: string
  projectName: string
  type: DeckType
  status: 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED'
  version: number
  templateVersion: string
  slideCount: number
  pptxUrl: string | null
  generatedAt: string | null
  error: string | null
  createdAt: string
}

interface DeckDetailSlide {
  id: string
  slideNo: number
  layout: string
  title: string
  content: SlideSpec | null
  notes: string | null
}

interface DeckDetail {
  deck: DeckDetailDeck
  spec: DeckSpec | null
  slides: DeckDetailSlide[]
}

const C = {
  navy: '#0B1F33',
  teal: '#14B8A6',
  gold: '#C9A227',
  ivory: '#F7F3EA',
  text: '#E8EEF4',
}

const BTN: CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.14)',
  color: C.text,
  fontSize: 12,
  lineHeight: 1.2,
  padding: '7px 12px',
  borderRadius: 8,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const BTN_DISABLED: CSSProperties = {
  opacity: 0.45,
  cursor: 'not-allowed',
}

/** 清理文件名中的非法字符 */
function safeFileName(input: string): string {
  return (
    input
      .replace(/[\\/:*?"<>|\r\n\t]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || '尽调报告'
  )
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export default function DDDeckViewer({ deckId, onClose }: { deckId: string; onClose: () => void }) {
  const [data, setData] = useState<DeckDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [current, setCurrent] = useState(0)
  const [scale, setScale] = useState(1)
  const [exporting, setExporting] = useState<'none' | 'single' | 'zip'>('none')
  const [exportError, setExportError] = useState<string | null>(null)

  const viewerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const exportRef = useRef<HTMLDivElement | null>(null)

  // ── 加载详情 ──
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setData(null)
    setCurrent(0)

    fetch(`/api/dd/deck/${deckId}`)
      .then(async res => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error || `加载报告失败（${res.status}）`)
        }
        return (await res.json()) as DeckDetail
      })
      .then(detail => {
        if (cancelled) return
        setData(detail)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '加载报告失败')
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [deckId])

  const slides: SlideSpec[] = useMemo(() => {
    if (!data) return []
    if (data.spec && Array.isArray(data.spec.slides) && data.spec.slides.length > 0) {
      return data.spec.slides
    }
    return data.slides
      .map(s => s.content)
      .filter((c): c is SlideSpec => Boolean(c))
  }, [data])

  const total = slides.length
  const index = total > 0 ? Math.min(current, total - 1) : 0
  const slide = slides[index]
  const projectName = data?.spec?.projectName || data?.deck.projectName || '项目'
  const deckType: DeckType = data?.spec?.type || data?.deck.type || 'BRIEF'
  const status = data?.deck.status

  // ── body 滚动锁定 ──
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // ── 键盘翻页 / 关闭 ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setCurrent(prev => (total > 0 ? Math.min(prev + 1, total - 1) : 0))
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setCurrent(prev => Math.max(prev - 1, 0))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [total, onClose])

  // ── 舞台尺寸测量 ──
  useEffect(() => {
    const el = stageRef.current
    if (!el) return

    const measure = () => {
      const rect = el.getBoundingClientRect()
      const availableWidth = Math.max(rect.width - 32, 0)
      const availableHeight = Math.max(rect.height - 32, 0)
      if (availableWidth <= 0 || availableHeight <= 0) return
      const next = Math.min(availableWidth / 1280, availableHeight / 720, 1)
      setScale(next > 0 ? next : 1)
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── 全屏 ──
  const toggleFullscreen = useCallback(() => {
    const el = viewerRef.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {})
      return
    }
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {})
  }, [])

  // ── PNG / ZIP 导出 ──
  const runExport = useCallback(
    async (kind: 'single' | 'zip') => {
      const root = exportRef.current
      if (!root || total === 0) return

      setExporting(kind)
      setExportError(null)
      try {
        const { toPng } = await import('html-to-image')
        const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-deck-slide]'))
        const targets = kind === 'single' ? nodes.filter((_, i) => i === index) : nodes
        if (targets.length === 0) throw new Error('未找到可导出的页面')

        const prefix = safeFileName(`尽调报告-${projectName}`)
        const files: Array<{ name: string; dataUrl: string }> = []

        for (let i = 0; i < targets.length; i++) {
          const dataUrl = await toPng(targets[i], {
            pixelRatio: 2,
            width: 1280,
            height: 720,
            backgroundColor: C.ivory,
            cacheBust: true,
            style: { transform: 'none', margin: '0', boxShadow: 'none' },
          })
          const pageNo = kind === 'single' ? index + 1 : i + 1
          files.push({ name: `${prefix}-${String(pageNo).padStart(3, '0')}.png`, dataUrl })
        }

        if (kind === 'single') {
          triggerDownload(files[0].dataUrl, files[0].name)
        } else {
          const { default: JSZip } = await import('jszip')
          const zip = new JSZip()
          files.forEach(file => {
            zip.file(file.name, file.dataUrl.split(',')[1], { base64: true })
          })
          const blob = await zip.generateAsync({ type: 'blob' })
          const url = URL.createObjectURL(blob)
          triggerDownload(url, `${prefix}.zip`)
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        }
      } catch (err) {
        setExportError(err instanceof Error ? err.message : '导出失败，请重试')
      } finally {
        setExporting('none')
      }
    },
    [index, projectName, total]
  )

  const typeLabel = deckType === 'FINAL' ? '尽调报告' : '资料简报'
  const title = data?.spec?.title || data?.deck.projectName || '尽调报告'
  const busy = exporting !== 'none'

  return (
    <div
      ref={viewerRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(11,31,51,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        boxSizing: 'border-box',
        fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      }}
    >
      <style>{'@keyframes ddspin{to{transform:rotate(360deg)}}'}</style>

      <div
        style={{
          width: '100%',
          height: '100%',
          maxWidth: 1600,
          background: '#0E1B28',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 14,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        {/* 顶部工具栏 */}
        <div
          style={{
            flexShrink: 0,
            background: C.navy,
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            rowGap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 260px' }}>
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: '#FFFFFF',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 420,
              }}
            >
              {title}
            </span>
            <span
              style={{
                flexShrink: 0,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1,
                color: C.navy,
                background: C.gold,
                borderRadius: 4,
                padding: '3px 7px',
              }}
            >
              {typeLabel}
            </span>
            <span style={{ flexShrink: 0, fontSize: 12, color: '#8FA3B5' }}>
              {data?.deck.version ? `v${data.deck.version} · ` : ''}{total} 页
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setCurrent(prev => Math.max(prev - 1, 0))}
              disabled={index <= 0 || total === 0}
              style={{ ...BTN, ...(index <= 0 || total === 0 ? BTN_DISABLED : {}) }}
            >
              ◀ 上一页
            </button>
            <span
              style={{
                fontSize: 12,
                color: C.text,
                minWidth: 56,
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {total === 0 ? '0/0' : `${index + 1}/${total}`}
            </span>
            <button
              type="button"
              onClick={() => setCurrent(prev => Math.min(prev + 1, Math.max(total - 1, 0)))}
              disabled={index >= total - 1 || total === 0}
              style={{ ...BTN, ...(index >= total - 1 || total === 0 ? BTN_DISABLED : {}) }}
            >
              下一页 ▶
            </button>
            <button type="button" onClick={toggleFullscreen} style={BTN}>
              ⛶ 全屏
            </button>
            <button
              type="button"
              onClick={() => window.open(`/api/dd/deck/${deckId}/pptx`, '_blank')}
              style={BTN}
            >
              ⬇ 下载 PPTX
            </button>
            <button
              type="button"
              onClick={() => void runExport('single')}
              disabled={busy || total === 0}
              style={{ ...BTN, ...(busy || total === 0 ? BTN_DISABLED : {}) }}
            >
              {exporting === 'single' ? '导出中...' : '🖼 导出当前页 PNG'}
            </button>
            <button
              type="button"
              onClick={() => void runExport('zip')}
              disabled={busy || total === 0}
              style={{ ...BTN, ...(busy || total === 0 ? BTN_DISABLED : {}) }}
            >
              {exporting === 'zip' ? '导出中...' : '📦 导出全部 PNG（ZIP）'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                ...BTN,
                background: 'rgba(201,162,39,0.18)',
                borderColor: 'rgba(201,162,39,0.5)',
                color: '#F1DFA5',
              }}
            >
              ✕ 关闭
            </button>
          </div>
        </div>

        {exportError ? (
          <div
            style={{
              flexShrink: 0,
              background: 'rgba(192,82,63,0.16)',
              borderBottom: '1px solid rgba(192,82,63,0.4)',
              color: '#F0B2A4',
              fontSize: 12,
              padding: '7px 18px',
            }}
          >
            导出失败：{exportError}
          </div>
        ) : null}

        {/* 主舞台 */}
        <div
          ref={stageRef}
          style={{
            flex: 1,
            minHeight: 0,
            position: 'relative',
            background: '#0E1B28',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  border: '3px solid rgba(255,255,255,0.16)',
                  borderTopColor: C.teal,
                  animation: 'ddspin 0.8s linear infinite',
                }}
              />
              <div style={{ fontSize: 13, color: '#8FA3B5' }}>报告加载中…</div>
            </div>
          ) : loadError ? (
            <StateMessage title="加载失败" detail={loadError} />
          ) : status === 'FAILED' ? (
            <StateMessage
              title="报告生成失败"
              detail={data?.deck.error || '报告未能生成，请回到尽调工作台重试生成。'}
              action="请回到尽调工作台，点击「生成尽调报告」重新生成后再打开预览。"
            />
          ) : status === 'QUEUED' || status === 'GENERATING' ? (
            <StateMessage title="报告生成中" detail="报告正在生成，请稍后再刷新查看。" />
          ) : !slide ? (
            <StateMessage title="暂无可预览页面" detail="该报告还没有可展示的幻灯片内容。" />
          ) : (
            <div
              style={{
                width: 1280 * scale,
                height: 720 * scale,
                flexShrink: 0,
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 18px 48px rgba(0,0,0,0.5)',
              }}
            >
              <div
                style={{
                  width: 1280,
                  height: 720,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              >
                <DeckSlide slide={slide} projectName={projectName} deckType={deckType} />
              </div>
            </div>
          )}
        </div>

        {/* 缩略图条 */}
        {!loading && !loadError && total > 0 ? (
          <div
            style={{
              flexShrink: 0,
              height: 104,
              background: C.navy,
              borderTop: '1px solid rgba(255,255,255,0.1)',
              padding: '12px 16px',
              boxSizing: 'border-box',
              display: 'flex',
              gap: 10,
              overflowX: 'auto',
              overflowY: 'hidden',
            }}
          >
            {slides.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrent(i)}
                title={`第 ${i + 1} 页`}
                style={{
                  flexShrink: 0,
                  width: 128,
                  height: 72,
                  padding: 0,
                  borderRadius: 6,
                  overflow: 'hidden',
                  background: 'transparent',
                  border: i === index ? `2px solid ${C.teal}` : '2px solid rgba(255,255,255,0.12)',
                  cursor: 'pointer',
                  position: 'relative',
                  boxSizing: 'content-box',
                }}
              >
                <div
                  style={{
                    width: 1280,
                    height: 720,
                    transform: 'scale(0.1)',
                    transformOrigin: 'top left',
                    pointerEvents: 'none',
                  }}
                >
                  <DeckSlide slide={s} projectName={projectName} deckType={deckType} />
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {/* 隐藏导出容器：渲染全部页面 */}
        <div
          ref={exportRef}
          aria-hidden
          style={{
            position: 'fixed',
            left: -10000,
            top: 0,
            width: 1280,
            background: C.ivory,
            pointerEvents: 'none',
          }}
        >
          {slides.map((s, i) => (
            <div key={i} style={{ width: 1280, height: 720 }}>
              <DeckSlide slide={s} projectName={projectName} deckType={deckType} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StateMessage({ title, detail, action }: { title: string; detail: string; action?: string }) {
  return (
    <div
      style={{
        maxWidth: 520,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        padding: '0 24px',
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 700, color: '#FFFFFF' }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.7, color: '#9FB0BF' }}>{detail}</div>
      {action ? (
        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            lineHeight: 1.6,
            color: '#F1DFA5',
            background: 'rgba(201,162,39,0.14)',
            border: '1px solid rgba(201,162,39,0.35)',
            borderRadius: 8,
            padding: '8px 14px',
          }}
        >
          {action}
        </div>
      ) : null}
    </div>
  )
}
