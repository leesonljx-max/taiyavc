'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import type { TreemapOrigin } from '@/components/IndustryTreemap'

export interface BurstProject {
  id: string
  name: string
  financingRound: string | null
  followStage: string
  totalAmount: string
}

interface IndustryProjectsBurstProps {
  industry: string
  projects: BurstProject[]
  /** 喷射起点（点击方块中心，相对本组件容器） */
  origin: TreemapOrigin
  /** 行业动态分析回调 */
  onAnalyze: () => void
  analyzing: boolean
  onClose: () => void
}

const stageLabels: Record<string, string> = {
  INITIAL_TALK: '初聊',
  PRE_DD: 'PreDD',
  PROJECT_INITIATION: '立项',
  DUE_DILIGENCE: '尽调',
  AGREEMENT: '协议',
  CLOSING: '交割',
  POST_INVESTMENT: '投后',
  REJECTED: '已否',
}

const stageBadgeStyles: Record<string, string> = {
  INITIAL_TALK: 'bg-gray-100 text-gray-600',
  PRE_DD: 'bg-primary-50 text-primary-700',
  PROJECT_INITIATION: 'bg-primary-100 text-primary-800',
  DUE_DILIGENCE: 'bg-primary-200 text-primary-800',
  AGREEMENT: 'bg-primary-300 text-primary-900',
  CLOSING: 'bg-primary-500 text-white',
  POST_INVESTMENT: 'bg-primary-600 text-white',
  REJECTED: 'bg-red-100 text-red-700',
}

/** 最多喷射的卡片数，超出显示"查看全部"入口 */
const MAX_BURST = 16
/** 卡片尺寸 */
const CARD_W = 152
const CARD_H = 68

/** 放射状布局：围绕容器中心环形（≤8）/双环（>8）排列 */
function layout(count: number, width: number, height: number): Array<{ x: number; y: number }> {
  const cx = width / 2
  const cy = height / 2
  const baseRadius = Math.min(width, height) * 0.3
  const positions: Array<{ x: number; y: number }> = []

  const ring = (n: number, radius: number, startAngle: number) => {
    for (let i = 0; i < n; i++) {
      const angle = startAngle + (i * 2 * Math.PI) / n
      positions.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) })
    }
  }

  if (count <= 8) {
    ring(count, baseRadius, -Math.PI / 2)
  } else {
    const inner = Math.min(8, count)
    ring(inner, baseRadius, -Math.PI / 2)
    const outerCount = count - inner
    if (outerCount > 0) {
      const outerRadius = baseRadius + Math.min(CARD_H + 26, Math.min(width, height) * 0.18)
      ring(outerCount, outerRadius, -Math.PI / 2 + Math.PI / outerCount)
    }
  }
  return positions
}

export default function IndustryProjectsBurst({
  industry,
  projects,
  origin,
  onAnalyze,
  analyzing,
  onClose,
}: IndustryProjectsBurstProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  /** 展开（true=目标位），false=喷射起点；两帧后置 true 触发过渡 */
  const [expanded, setExpanded] = useState(false)
  /** 收起中（卡片飞回起点后卸载） */
  const [closing, setClosing] = useState(false)
  /** 查看全部弹层 */
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setSize({ width: el.clientWidth, height: el.clientHeight })
    // 两帧后再展开，确保浏览器先渲染初始（起点）状态，过渡才会播放
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => setExpanded(true))
      return raf2
    })
    return () => cancelAnimationFrame(raf1)
  }, [])

  const handleClose = useCallback(() => {
    setClosing(true)
    setExpanded(false)
    setTimeout(onClose, 420)
  }, [onClose])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

  const total = projects.length
  const burstProjects = projects.slice(0, MAX_BURST)
  const hasMore = total > MAX_BURST
  // 布局槽位：卡片数 +（可能的一个"查看全部"槽）
  const slots = layout(burstProjects.length + (hasMore ? 1 : 0), size.width, size.height)

  const cardTransform = (i: number, expandedState: boolean) => {
    const target = slots[i] || { x: size.width / 2, y: size.height / 2 }
    if (expandedState) {
      return `translate(${target.x - CARD_W / 2}px, ${target.y - CARD_H / 2}px) scale(1) rotateY(0deg) translateZ(0)`
    }
    // 起点：点击的方块中心，缩到很小并带 3D 翻转角
    return `translate(${origin.x - CARD_W / 2}px, ${origin.y - CARD_H / 2}px) scale(0.15) rotateY(140deg) translateZ(-220px)`
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-20 rounded-2xl overflow-hidden"
      style={{ perspective: '1200px' }}
      onClick={e => {
        // 点击空白背景（非卡片/按钮）收起
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      {/* 半透明磨砂背景（压暗图谱、聚焦喷射卡片） */}
      <div
        className="absolute inset-0 bg-white/80 backdrop-blur-[2px] transition-opacity duration-500"
        style={{ opacity: expanded ? 1 : 0 }}
      />

      {/* 中心信息条：行业名 + 分析按钮 + 关闭 */}
      <div
        className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 transition-all duration-500"
        style={{
          opacity: expanded ? 1 : 0,
          transform: expanded
            ? 'translate(-50%, -50%) scale(1)'
            : `translate(calc(-50% + ${origin.x - size.width / 2}px), calc(-50% + ${origin.y - size.height / 2}px)) scale(0.3)`,
        }}
      >
        <div className="flex flex-col items-center gap-2 px-5 py-4 rounded-2xl bg-surface/90 backdrop-blur shadow-soft">
          <div className="text-sm font-bold text-ink">{industry}</div>
          <div className="text-xs text-ink-muted">共 {total} 个项目</div>
          <div className="flex items-center gap-2">
            <button
              onClick={onAnalyze}
              disabled={analyzing}
              className="btn-primary"
            >
              {analyzing ? (
                <span className="inline-flex items-center gap-1">
                  <span className="animate-spin inline-block w-3 h-3 border-b-2 border-white rounded-full" />
                  动态收集中...
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  行业动态分析
                </span>
              )}
            </button>
            <button
              onClick={handleClose}
              className="px-2.5 py-1.5 bg-gray-100 text-ink-muted text-xs font-medium rounded-full hover:bg-gray-200 hover:text-ink transition-all"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* 喷射卡片：从方块位置飞向环形排列位（错开延迟依次浮现） */}
      {burstProjects.map((p, i) => (
        <Link
          key={p.id}
          href={`/projects/${p.id}`}
          onClick={e => {
            // 查看全部弹层打开时，底层卡片不可点
            if (showAll) { e.preventDefault(); return }
            // allow default navigation
          }}
          className="absolute left-0 top-0 z-20 block rounded-2xl bg-surface/95 backdrop-blur shadow-soft hover:shadow-soft-lg transition-[box-shadow] will-change-transform"
          style={{
            width: CARD_W,
            height: CARD_H,
            transform: cardTransform(i, expanded),
            opacity: expanded ? 1 : 0,
            transition: `transform 640ms cubic-bezier(0.3, 1.25, 0.45, 1) ${i * 32}ms, opacity 420ms ease ${i * 32}ms, box-shadow 200ms ease, border-color 200ms ease`,
            pointerEvents: expanded ? 'auto' : 'none',
          }}
        >
          <div className="p-2.5 h-full flex flex-col justify-between">
            <div className="text-xs font-bold text-ink truncate">{p.name}</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${stageBadgeStyles[p.followStage] || 'bg-gray-100 text-gray-600'}`}>
                {stageLabels[p.followStage] || p.followStage}
              </span>
              {p.financingRound && (
                <span className="text-[10px] text-primary-600 font-medium truncate">{p.financingRound}</span>
              )}
              {p.totalAmount && (
                <span className="text-[10px] text-ink-faint truncate">{p.totalAmount}</span>
              )}
            </div>
          </div>
        </Link>
      ))}

      {/* "查看全部"槽位（项目数 > MAX_BURST 时） */}
      {hasMore && (
        <button
          onClick={() => setShowAll(true)}
          className="absolute left-0 top-0 z-20 rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50/80 backdrop-blur text-ink-muted hover:bg-gray-100 hover:border-gray-400 transition-[box-shadow,transform] will-change-transform"
          style={{
            width: CARD_W,
            height: CARD_H,
            transform: cardTransform(burstProjects.length, expanded),
            opacity: expanded ? 1 : 0,
            transition: `transform 640ms cubic-bezier(0.3, 1.25, 0.45, 1) ${burstProjects.length * 32}ms, opacity 420ms ease ${burstProjects.length * 32}ms`,
            pointerEvents: expanded ? 'auto' : 'none',
          }}
        >
          <div className="flex flex-col items-center justify-center h-full gap-0.5">
            <span className="text-xs font-bold">查看全部 {total} 个</span>
            <span className="text-[10px] text-ink-faint">已显示前 {MAX_BURST} 个</span>
          </div>
        </button>
      )}

      {/* 查看全部：完整列表弹层 */}
      {showAll && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-gray-900/30 backdrop-blur-sm rounded-2xl p-6"
          onClick={e => { if (e.target === e.currentTarget) setShowAll(false) }}
        >
          <div className="bg-surface rounded-2xl shadow-soft-lg w-full max-w-md max-h-[80%] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
              <span className="text-sm font-bold text-ink">{industry} · 全部 {total} 个项目</span>
              <button
                onClick={() => setShowAll(false)}
                className="text-ink-faint hover:text-ink-muted text-sm px-1"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto divide-y divide-hairline">
              {projects.map(p => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-ink truncate">{p.name}</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${stageBadgeStyles[p.followStage] || 'bg-gray-100 text-gray-600'}`}>
                      {stageLabels[p.followStage] || p.followStage}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 text-xs">
                    {p.financingRound && <span className="text-primary-600">{p.financingRound}</span>}
                    {p.totalAmount && <span className="text-ink-faint">{p.totalAmount}</span>}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
