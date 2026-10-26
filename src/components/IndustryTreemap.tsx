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
type RenderItemParams = Parameters<NonNullable<CustomSeriesOption['renderItem']>>[0]
type RenderItemApi = Parameters<NonNullable<CustomSeriesOption['renderItem']>>[1]

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

/** 前十行业：柱顶数值标签拥挤时仍始终显示 */
const TOP_N_BADGE = 10
/** 前 20 名行业占用 65% 幅宽（柱子放大并显示赛道名）；其余占 35%（柱子缩小，悬停查看） */
const TOP_STRONG = 20

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
      // 两个系列分别承载「前 20 名」与「其余行业」，需按系列偏移还原全局索引
      const idx = (params.seriesIndex === 1 ? TOP_STRONG : 0) + params.dataIndex
      const item = dataRef.current[idx]
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
    const labelLimit = 4
    // 拆成两段：前 20 名占 65% 幅宽（放大），其余占 35%（缩小）
    const strong = industries.slice(0, TOP_STRONG)
    const tail = industries.slice(TOP_STRONG)
    const hasTail = tail.length > 0

    // 等距三面棱柱：正面 / 右侧面 / 顶面（baseIndex 用于把系列内索引还原为全局排名）
    const makeRenderItem = (baseIndex: number) => (params: RenderItemParams, api: RenderItemApi) => {
      const catIdx = api.value(0)
      const value = api.value(1)
      const base = api.coord([catIdx, 0]) as number[]
      const top = api.coord([catIdx, value]) as number[]
      const bandW = api.size?.([1, 0]) as number[] | undefined
      const sizeW = bandW?.[0] || 24

      const idx = baseIndex + params.dataIndex
      // 前 20 名之外的柱子：缩小、半透明、无名称（悬停查看）
      const isTail = idx >= TOP_STRONG
      const barW = Math.max(6, Math.min(sizeW * 0.62, 46))
      const w = isTail ? Math.max(4, barW * 0.55) : barW
      const shapeOpacity = isTail ? 0.55 : 1
      // 数值标签防重叠：尾部柱不显示；柱带过窄时只保留前十柱
      const showValue = !isTail && (idx < TOP_N_BADGE || sizeW >= 26)
      const ratio = industries[idx] ? industries[idx].count / maxCount : 0
      const rgb = barColor(ratio)
      const frontFill = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
      const topFill = mix(rgb, [255, 255, 255], 0.34)
      const sideFill = mix(rgb, [0, 0, 0], 0.22)
      const isSelected = selected === industries[idx]?.industry
      const stroke = isSelected ? '#8B5CF6' : 'rgba(255,255,255,0.85)'
      const strokeWidth = isSelected ? 2 : 1

      const d = w * 0.34 // 立体深度（等距右上偏移）
      const cx = base[0]
      const y0 = base[1] // 基线
      const y1 = top[1]  // 柱顶
      const left = cx - w / 2
      const right = cx + w / 2

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
          style: { fill: sideFill, stroke, lineWidth: strokeWidth, opacity: shapeOpacity },
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
          style: { fill: topFill, stroke, lineWidth: strokeWidth, opacity: shapeOpacity },
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
          style: { fill: frontFill, stroke, lineWidth: strokeWidth, opacity: shapeOpacity },
        },
        // 数值标签（柱顶上方；拥挤时仅前十柱显示）
        ...(showValue
          ? [
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
          : []),
      ]

      return {
        type: 'group',
        children: shapes,
        // 悬停时轻微提亮
        emphasis: { disabled: false },
      } as unknown as ReturnType<NonNullable<CustomSeriesOption['renderItem']>>
    }

    const option: ECOption = {
      tooltip: {
        confine: true,
        backgroundColor: '#111111',
        borderWidth: 0,
        borderRadius: 12,
        padding: [8, 12],
        textStyle: { color: '#FFFFFF', fontSize: 12 },
        formatter: params => {
          const p = params as { dataIndex: number; seriesIndex?: number }
          const idx = (p.seriesIndex === 1 ? TOP_STRONG : 0) + p.dataIndex
          const item = industries[idx]
          if (!item) return ''
          const percent = total > 0 ? Math.round((item.count / total) * 100) : 0
          return `<b>${item.industry}</b><br/>排名：第 ${idx + 1} 名 · 项目数：${item.count}（占比 ${percent}%）`
        },
      },
      grid: [
        // 前 20 名：左侧预留 y 轴刻度，幅宽约占 65%（不足 20 个行业时占满全宽）
        { left: 40, right: hasTail ? '35%' : 8, top: 44, bottom: 70 },
        // 其余行业：幅宽约占 35%（隐藏 y 轴，基线与前段对齐）
        { left: '65%', right: 8, top: 44, bottom: 70 },
      ],
      xAxis: [
        {
          type: 'category',
          gridIndex: 0,
          data: strong.map((_, idx) => String(idx)),
          axisLine: { lineStyle: { color: '#E2EAEF' } },
          axisTick: { show: false },
          axisLabel: {
            interval: 0,
            rotate: 90,
            fontSize: 10,
            color: '#6B7589',
            formatter: (value: string) => {
              const name = names[Number(value)] ?? ''
              return name.length > labelLimit ? `${name.slice(0, labelLimit)}…` : name
            },
          },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: tail.map((_, idx) => String(idx)),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
        },
      ],
      yAxis: [
        {
          type: 'value',
          gridIndex: 0,
          min: 0,
          max: maxCount,
          minInterval: 1,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: '#9AA2B1', fontSize: 11 },
          splitLine: { lineStyle: { color: 'rgba(226, 234, 239, 0.7)' } },
        },
        // 与左段共用刻度（隐藏轴线/网格线），保证两段柱体高度口径一致
        { type: 'value', gridIndex: 1, min: 0, max: maxCount, show: false },
      ],
      series: [
        {
          type: 'custom',
          xAxisIndex: 0,
          yAxisIndex: 0,
          coordinateSystem: 'cartesian2d',
          encode: { x: 0, y: 1 },
          data: strong.map((item, idx) => [idx, item.count]),
          renderItem: makeRenderItem(0),
        },
        {
          type: 'custom',
          xAxisIndex: 1,
          yAxisIndex: 1,
          coordinateSystem: 'cartesian2d',
          encode: { x: 0, y: 1 },
          data: tail.map((item, idx) => [idx, item.count]),
          renderItem: makeRenderItem(TOP_STRONG),
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
