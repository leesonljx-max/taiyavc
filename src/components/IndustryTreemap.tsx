'use client'

import { useRef, useEffect } from 'react'
import * as echarts from 'echarts/core'
import { TreemapChart, type TreemapSeriesOption } from 'echarts/charts'
import { TooltipComponent, type TooltipComponentOption } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ComposeOption } from 'echarts/core'

// 按需注册（tree-shaking，仅约 110KB gzip，只进入 /statistics 路由 chunk）
echarts.use([TreemapChart, TooltipComponent, CanvasRenderer])

type ECOption = ComposeOption<TreemapSeriesOption | TooltipComponentOption>

export interface TreemapDatum {
  industry: string
  count: number
}

interface IndustryTreemapProps {
  industries: TreemapDatum[]
  /** 当前选中行业（点击块 toggle） */
  selected: string | null
  onSelect: (industry: string | null) => void
}

/** 块渐变色对（浅 → 深），按项目数排名循环取色 */
const PALETTE: Array<[string, string]> = [
  ['#6366f1', '#4338ca'], // indigo
  ['#3b82f6', '#1d4ed8'], // blue
  ['#06b6d4', '#0e7490'], // cyan
  ['#10b981', '#047857'], // emerald
  ['#f59e0b', '#b45309'], // amber
  ['#ec4899', '#be185d'], // pink
  ['#8b5cf6', '#6d28d9'], // violet
  ['#64748b', '#334155'], // slate
]

/** 前十行业在块上显示排名角标（通过 label prefix） */
const TOP_N_BADGE = 10

export default function IndustryTreemap({ industries, selected, onSelect }: IndustryTreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const onSelectRef = useRef(onSelect)
  const selectedRef = useRef<string | null>(selected)
  onSelectRef.current = onSelect
  selectedRef.current = selected

  useEffect(() => {
    if (!containerRef.current) return

    const chart = echarts.init(containerRef.current)
    chartRef.current = chart

    // 点击行业块：toggle 选中（nodeClick 已禁用默认下钻）
    chart.on('click', params => {
      if (params.seriesType !== 'treemap' || typeof params.name !== 'string') return
      onSelectRef.current(selectedRef.current === params.name ? null : params.name)
    })

    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  // 数据/选中态变化时更新
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const maxCount = industries[0]?.count || 1
    const option: ECOption = {
      tooltip: {
        confine: true,
        formatter: params => {
          const p = params as { name: string; value: number; treePathInfo?: Array<{ value: number }> }
          const total = p.treePathInfo?.[0]?.value || 0
          const percent = total > 0 ? Math.round((p.value / total) * 100) : 0
          return `<b>${p.name}</b><br/>项目数：${p.value}（占比 ${percent}%）`
        },
      },
      series: [
        {
          type: 'treemap',
          nodeClick: false,
          breadcrumb: { show: false },
          roam: false,
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          itemStyle: { borderWidth: 2, borderColor: '#fff', gapWidth: 2, borderRadius: 6 },
          label: {
            show: true,
            formatter: p => {
              const idx = (p.dataIndex as number) ?? 0
              const badge = idx < TOP_N_BADGE ? `${idx + 1}. ` : ''
              const name = String(p.name ?? '')
              return `{badge|${badge}}{name|${name}}\n{count|${p.value} 个项目}`
            },
            rich: {
              badge: { fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 'bold' },
              name: { fontSize: 13, color: '#fff', fontWeight: 'bold' },
              count: { fontSize: 11, color: 'rgba(255,255,255,0.85)', padding: [4, 0, 0, 0] },
            },
            overflow: 'truncate',
          },
          upperLabel: { show: false },
          data: industries.map((item, idx) => {
            const [c1, c2] = PALETTE[idx % PALETTE.length]
            const isSelected = selected === item.industry
            return {
              name: item.industry,
              value: item.count,
              itemStyle: {
                color: {
                  type: 'linear', x: 0, y: 0, x2: 1, y2: 1,
                  colorStops: [
                    { offset: 0, color: c1 },
                    { offset: 1, color: c2 },
                  ],
                },
                borderColor: isSelected ? '#312e81' : '#fff',
                borderWidth: isSelected ? 4 : 2,
              },
              emphasis: { itemStyle: { shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.35)' } },
            }
          }),
        },
      ],
    }
    chart.setOption(option, { replaceMerge: ['series'] })
  }, [industries, selected])

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{ height: `${Math.max(300, Math.min(460, industries.length * 36 + 160))}px` }}
    />
  )
}
