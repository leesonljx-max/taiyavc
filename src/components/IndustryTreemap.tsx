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

/** 点击方块时回传方块中心坐标（相对图谱容器，用于喷射动画起点） */
export interface TreemapOrigin {
  x: number
  y: number
}

interface IndustryTreemapProps {
  industries: TreemapDatum[]
  /** 当前选中行业（点击块 toggle） */
  selected: string | null
  onSelect: (industry: string | null, origin?: TreemapOrigin) => void
}

/**
 * 单蓝色系磨砂玻璃配色：按数量占比连续插值（数量多 → 深蓝，数量少 → 浅蓝）
 * 返回 [填充色 rgba, 文字色]
 */
function frostBlue(ratio: number): { fill: string; text: string; border: string } {
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t)
  // 深蓝 blue-900 (30,58,138) → 浅蓝 blue-200 (191,219,254)
  const c1 = [30, 58, 138]
  const c2 = [191, 219, 254]
  const t = 1 - Math.min(1, Math.max(0, ratio)) // ratio 高 → t 低 → 深色
  const rgb = c1.map((v, i) => lerp(v, c2[i], t))
  return {
    // 半透明填充叠在浅色渐变底上形成磨砂玻璃质感
    fill: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.82)`,
    text: t < 0.55 ? '#ffffff' : '#1e3a8a', // 深块白字，浅块深蓝字
    border: 'rgba(255,255,255,0.65)',
  }
}

/** 前十行业在块上显示排名前缀 */
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

    // 点击行业块：toggle 选中，并把方块中心坐标回传（喷射动画起点）
    chart.on('click', params => {
      if (params.seriesType !== 'treemap' || typeof params.name !== 'string') return
      const ev = params.event as { offsetX?: number; offsetY?: number } | undefined
      const origin =
        typeof ev?.offsetX === 'number' && typeof ev?.offsetY === 'number'
          ? { x: ev.offsetX, y: ev.offsetY }
          : undefined
      onSelectRef.current(selectedRef.current === params.name ? null : params.name, origin)
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
          // 磨砂玻璃质感：半透明填充 + 白色半透明描边 + 圆角 + 柔和阴影
          itemStyle: { borderWidth: 2, borderColor: 'rgba(255,255,255,0.65)', gapWidth: 3, borderRadius: 10 },
          label: {
            show: true,
            formatter: p => {
              const idx = (p.dataIndex as number) ?? 0
              const badge = idx < TOP_N_BADGE ? `${idx + 1}. ` : ''
              return `${badge}${p.name}\n${p.value} 个项目`
            },
            fontSize: 13,
            fontWeight: 'bold',
            lineHeight: 18,
            overflow: 'truncate',
          },
          upperLabel: { show: false },
          data: industries.map((item, idx) => {
            const ratio = item.count / maxCount
            const color = frostBlue(ratio)
            const isSelected = selected === item.industry
            return {
              name: item.industry,
              value: item.count,
              label: { color: color.text },
              itemStyle: {
                color: color.fill,
                borderColor: isSelected ? '#1e3a8a' : color.border,
                borderWidth: isSelected ? 4 : 2,
                shadowBlur: isSelected ? 16 : 6,
                shadowColor: 'rgba(30,58,138,0.25)',
              },
              emphasis: { itemStyle: { shadowBlur: 14, shadowColor: 'rgba(30,58,138,0.4)' } },
            }
          }),
        },
      ],
    }
    chart.setOption(option, { replaceMerge: ['series'] })
  }, [industries, selected])

  return (
    // 浅蓝渐变底衬托半透明色块，形成磨砂玻璃质感
    <div
      ref={containerRef}
      className="w-full rounded-2xl bg-gradient-to-br from-blue-50 via-indigo-50/60 to-sky-50"
      style={{ height: `${Math.max(300, Math.min(460, industries.length * 36 + 160))}px` }}
    />
  )
}
