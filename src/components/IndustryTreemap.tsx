'use client'

import { useRef, useEffect } from 'react'
import * as echarts from 'echarts/core'
import { CustomChart, type CustomSeriesOption } from 'echarts/charts'
import { GridComponent, TooltipComponent, type GridComponentOption, type TooltipComponentOption } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ComposeOption } from 'echarts/core'

// 按需注册（tree-shaking，仅约 110KB gzip，只进入 /statistics 路由 chunk）
echarts.use([CustomChart, GridComponent, TooltipComponent, CanvasRenderer])

type ECOption = ComposeOption<CustomSeriesOption | GridComponentOption | TooltipComponentOption>

export interface TreemapDatum {
  industry: string
  count: number
}

/** 点击柱体时回传柱体中心坐标（相对图谱容器，用于喷射动画起点） */
export interface TreemapOrigin {
  x: number
  y: number
}

interface IndustryTreemapProps {
  industries: TreemapDatum[]
  /** 当前选中行业（点击柱体 toggle） */
  selected: string | null
  onSelect: (industry: string | null, origin?: TreemapOrigin) => void
}

/** 柱体配色：浅薰衣草 → 品牌紫罗兰（数量多 → 更深） */
const RAMP: number[][] = [
  [221, 214, 254], // #DDD6FE
  [196, 181, 253], // #C4B5FD
  [167, 139, 250], // #A78BFA
  [139, 92, 246],  // #8B5CF6
]

function mix(a: number[], b: number[], t: number): string {
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * t))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

/** 按数量占比在柔和区间内插值取底色 */
function barColor(ratio: number): number[] {
  const t = Math.min(1, Math.max(0, ratio))
  const scaled = t * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(scaled))
  const f = scaled - i
  return RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * f))
}

/** 前十行业在类目标签上显示排名前缀 */
const TOP_N_BADGE = 10

export default function IndustryTreemap({ industries, selected, onSelect }: IndustryTreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const onSelectRef = useRef(onSelect)
  const selectedRef = useRef<string | null>(selected)
  const dataRef = useRef<TreemapDatum[]>(industries)
  onSelectRef.current = onSelect
  selectedRef.current = selected
  dataRef.current = industries

  useEffect(() => {
    if (!containerRef.current) return

    const chart = echarts.init(containerRef.current)
    chartRef.current = chart

    // 点击柱体：toggle 选中，并把柱体中心坐标回传（喷射动画起点）
    chart.on('click', params => {
      if (params.seriesType !== 'custom') return
      const item = dataRef.current[params.dataIndex]
      if (!item) return
      const ev = params.event as { offsetX?: number; offsetY?: number } | undefined
      const origin =
        typeof ev?.offsetX === 'number' && typeof ev?.offsetY === 'number'
          ? { x: ev.offsetX, y: ev.offsetY }
          : undefined
      onSelectRef.current(selectedRef.current === item.industry ? null : item.industry, origin)
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
    const total = industries.reduce((sum, i) => sum + i.count, 0)
    // 类目轴统一用序号（dim 0），避免中文长名称映射问题；名称仅在标签显示
    const names = industries.map(i => i.industry)

    const option: ECOption = {
      tooltip: {
        confine: true,
        backgroundColor: '#111111',
        borderWidth: 0,
        borderRadius: 12,
        padding: [8, 12],
        textStyle: { color: '#FFFFFF', fontSize: 12 },
        formatter: params => {
          const item = industries[(params as { dataIndex: number }).dataIndex]
          if (!item) return ''
          const percent = total > 0 ? Math.round((item.count / total) * 100) : 0
          return `<b>${item.industry}</b><br/>项目数：${item.count}（占比 ${percent}%）`
        },
      },
      grid: { left: 8, right: 20, top: 44, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category',
        data: names.map((_, idx) => String(idx)),
        axisLine: { lineStyle: { color: '#E9DFCE' } },
        axisTick: { show: false },
        axisLabel: {
          interval: 0,
          rotate: 40,
          fontSize: 10,
          color: '#6B7589',
          formatter: (value: string) => {
            const idx = Number(value)
            const name = names[idx] ?? ''
            const short = name.length > 5 ? `${name.slice(0, 5)}…` : name
            const badge = idx < TOP_N_BADGE ? `${idx + 1}. ` : ''
            return `${badge}${short}`
          },
        },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#9AA2B1', fontSize: 11 },
        splitLine: { lineStyle: { color: 'rgba(233,223,206,0.7)' } },
      },
      series: [
        {
          type: 'custom',
          coordinateSystem: 'cartesian2d',
          encode: { x: 0, y: 1 },
          data: industries.map((item, idx) => [idx, item.count]),
          // 等距三面棱柱：正面 / 右侧面 / 顶面
          renderItem: (params, api) => {
            const catIdx = api.value(0)
            const value = api.value(1)
            const base = api.coord([catIdx, 0]) as number[]
            const top = api.coord([catIdx, value]) as number[]
            const bandW = api.size?.([1, 0]) as number[] | undefined
            const sizeW = bandW?.[0] || 24

            const w = Math.max(6, Math.min(sizeW * 0.52, 42))
            const d = w * 0.34 // 立体深度（等距右上偏移）
            const cx = base[0]
            const y0 = base[1] // 基线
            const y1 = top[1]  // 柱顶
            const left = cx - w / 2
            const right = cx + w / 2

            const idx = params.dataIndex
            const ratio = industries[idx] ? industries[idx].count / maxCount : 0
            const rgb = barColor(ratio)
            const frontFill = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
            const topFill = mix(rgb, [255, 255, 255], 0.34)
            const sideFill = mix(rgb, [0, 0, 0], 0.22)
            const isSelected = selected === industries[idx]?.industry
            const stroke = isSelected ? '#8B5CF6' : 'rgba(255,255,255,0.85)'
            const strokeWidth = isSelected ? 2 : 1

            const shapes: unknown[] = [
              // 右侧面
              {
                type: 'polygon',
                shape: {
                  points: [
                    [right, y1],
                    [right + d, y1 - d],
                    [right + d, y0 - d],
                    [right, y0],
                  ],
                },
                style: { fill: sideFill, stroke, lineWidth: strokeWidth },
              },
              // 顶面
              {
                type: 'polygon',
                shape: {
                  points: [
                    [left, y1],
                    [left + d, y1 - d],
                    [right + d, y1 - d],
                    [right, y1],
                  ],
                },
                style: { fill: topFill, stroke, lineWidth: strokeWidth },
              },
              // 正面（最后画，压在最上层）
              {
                type: 'polygon',
                shape: {
                  points: [
                    [left, y1],
                    [right, y1],
                    [right, y0],
                    [left, y0],
                  ],
                },
                style: { fill: frontFill, stroke, lineWidth: strokeWidth },
              },
              // 数值标签（柱顶上方）
              {
                type: 'text',
                style: {
                  text: String(industries[idx]?.count ?? ''),
                  x: cx + d / 2,
                  y: y1 - d - 8,
                  fill: isSelected ? '#6D28D9' : '#3B4664',
                  font: `bold ${industries.length > 14 ? 10 : 12}px sans-serif`,
                  textAlign: 'center',
                  textVerticalAlign: 'bottom',
                },
                emphasisDisabled: true,
              },
            ]

            return {
              type: 'group',
              children: shapes,
              // 悬停时轻微提亮
              emphasis: { disabled: false },
            } as unknown as ReturnType<NonNullable<CustomSeriesOption['renderItem']>>
          },
        },
      ],
    }
    chart.setOption(option, { replaceMerge: ['series', 'xAxis', 'yAxis', 'grid'] })
  }, [industries, selected])

  return (
    <div
      ref={containerRef}
      className="w-full rounded-2xl bg-surface"
      style={{ height: `${Math.max(320, Math.min(480, industries.length * 36 + 180))}px` }}
    />
  )
}
