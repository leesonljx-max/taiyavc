'use client'

/**
 * 深度尽调报告 16:9 文档渲染
 *
 * 每页固定 1280×720px（16:9），打印时按 338.67mm × 190.5mm 输出。
 * 模块正文以「论点」为单位独立成页，按内容 / 分析 / 论据 / 观点四段式排版。
 * 样式对齐参考报告：深海军蓝 + 金色，白色页面，图文混排。
 */

import React from 'react'
import type { DeepBlock, DeepDocSpec, DeepPage } from '@/lib/dd-deep/spec'

const NAVY = '#0B1F33'
const GOLD = '#C9A227'
const TEAL = '#14B8A6'
const INK = '#1F2937'
const MUTED = '#6B7280'
const HAIRLINE = '#D9DEE5'
const PAPER = '#FBF7EA'

const PAGE_W = 1280
const PAGE_H = 720

const CHART_COLORS = [NAVY, GOLD, TEAL, '#8FA3B5', '#B08968', '#5B7083']

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

const DOC_STYLE = `
.deep-doc { display: flex; flex-direction: column; align-items: center; gap: 24px; }
.deep-page {
  width: ${PAGE_W}px; height: ${PAGE_H}px; background: #FFFFFF; position: relative;
  overflow: hidden; box-sizing: border-box; flex-shrink: 0;
  box-shadow: 0 12px 34px rgba(11,31,51,0.18);
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.deep-cover { background: ${NAVY}; color: #FFFFFF; padding: 46px 64px 36px; display: flex; flex-direction: column; }
.deep-cover-grid { display: flex; flex: 1; gap: 40px; align-items: center; }
.deep-cover-main { flex: 1.35; min-width: 0; }
.deep-cover-aside { flex: 0.65; align-self: stretch; position: relative; border-left: 1px solid rgba(255,255,255,0.12); padding-left: 36px; display: flex; flex-direction: column; justify-content: center; gap: 18px; }
.deep-cover-title { font-size: 44px; font-weight: 700; line-height: 1.24; letter-spacing: 0.5px; }
.deep-cover-sub { font-size: 15px; color: #D7DFE8; line-height: 1.8; margin-top: 14px; max-width: 660px; }
.deep-cover-company { font-size: 24px; font-weight: 700; color: ${GOLD}; margin-top: 22px; }
.deep-cover-meta { display: flex; gap: 40px; margin-top: 26px; }
.deep-cover-meta-label { font-size: 10px; color: #8FA3B5; letter-spacing: 1px; }
.deep-cover-meta-value { font-size: 13px; color: #FFFFFF; margin-top: 4px; }
.deep-cover-stat { border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.04); padding: 14px 16px; }
.deep-cover-stat-value { font-size: 26px; font-weight: 700; color: ${GOLD}; line-height: 1; }
.deep-cover-stat-label { font-size: 10px; color: #B9C4D0; letter-spacing: 1px; margin-top: 6px; }
.deep-toc { padding: 42px 64px 38px; display: flex; flex-direction: column; }
.deep-toc-grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(7, auto); grid-auto-flow: column; column-gap: 54px; align-content: start; }
.deep-section { background: ${NAVY}; color: #FFFFFF; padding: 56px 72px; display: flex; flex-direction: column; justify-content: center; }
.deep-content { padding: 34px 56px 38px; display: flex; flex-direction: column; }
.deep-header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid ${HAIRLINE}; padding-bottom: 8px; margin-bottom: 12px; font-size: 11px; color: ${MUTED}; letter-spacing: 0.6px; }
.deep-header b { color: ${NAVY}; font-weight: 700; }
.deep-footer { position: absolute; left: 56px; right: 56px; bottom: 16px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid ${HAIRLINE}; padding-top: 6px; font-size: 9px; color: #94A3B8; letter-spacing: 0.6px; }
.deep-body { flex: 1; min-height: 0; overflow: hidden; }
.deep-h1 { font-size: 21px; font-weight: 700; color: ${NAVY}; margin: 14px 0 9px; padding-left: 11px; border-left: 3px solid ${GOLD}; line-height: 1.4; }
.deep-h1:first-child { margin-top: 0; }
.deep-h2 { font-size: 16px; font-weight: 700; color: ${NAVY}; margin: 11px 0 7px; }
.deep-p { font-size: 14px; line-height: 1.78; color: ${INK}; text-align: justify; margin: 0 0 9px; }
.deep-ul { list-style: none; margin: 0 0 8px; padding: 0; }
.deep-li { position: relative; font-size: 13.5px; line-height: 1.72; color: ${INK}; text-align: justify; padding-left: 16px; margin-bottom: 6px; }
.deep-li::before { content: ''; position: absolute; left: 2px; top: 9px; width: 5px; height: 5px; background: ${GOLD}; border-radius: 50%; }
.deep-qa { margin: 0 0 9px; }
.deep-q { display: flex; gap: 9px; font-size: 14px; font-weight: 700; color: ${NAVY}; line-height: 1.6; margin-bottom: 3px; }
.deep-q-badge { flex-shrink: 0; width: 20px; height: 20px; border-radius: 3px; background: ${NAVY}; color: ${GOLD}; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
.deep-a { font-size: 13px; line-height: 1.7; color: #374151; text-align: justify; padding-left: 29px; }
.deep-table-wrap { margin: 8px 0 10px; }
.deep-table-title { font-size: 12px; font-weight: 700; color: ${NAVY}; margin-bottom: 5px; }
.deep-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.deep-table th { background: ${NAVY}; color: #FFFFFF; font-size: 11px; font-weight: 600; padding: 7px 8px; text-align: left; border: 1px solid ${NAVY}; }
.deep-table td { font-size: 11px; line-height: 1.5; color: ${INK}; padding: 6px 8px; border: 1px solid ${HAIRLINE}; vertical-align: top; word-break: break-word; }
.deep-table tr:nth-child(even) td { background: #F7F8FA; }
.deep-note { font-size: 9.5px; color: #94A3B8; margin-top: 4px; line-height: 1.55; }
.deep-chart { margin: 8px 0 10px; border: 1px solid ${HAIRLINE}; padding: 10px 14px 8px; background: #FCFCFD; }
.deep-chart-title { font-size: 12px; font-weight: 700; color: ${NAVY}; margin-bottom: 5px; display: flex; justify-content: space-between; }
.deep-image { margin: 8px 0 10px; text-align: center; }
.deep-image img { max-width: 100%; max-height: 320px; object-fit: contain; border: 1px solid ${HAIRLINE}; background: #FFFFFF; }
.deep-image-caption { font-size: 9.5px; color: ${MUTED}; margin-top: 4px; line-height: 1.55; }
.deep-callout { border-left: 3px solid ${GOLD}; background: ${PAPER}; padding: 9px 13px; margin: 9px 0; }
.deep-callout-title { font-size: 10.5px; font-weight: 700; color: ${NAVY}; margin-bottom: 3px; letter-spacing: 0.6px; }
.deep-callout-text { font-size: 13px; line-height: 1.7; color: ${INK}; text-align: justify; }
.deep-callout.red { border-left-color: #C0523F; background: #FDF1EE; }
.deep-callout.red .deep-callout-title { color: #9F2F1F; }
.deep-callout.teal { border-left-color: ${TEAL}; background: #ECF8F6; }
.deep-toc-row { display: flex; align-items: baseline; gap: 10px; padding: 7px 0; border-bottom: 1px dotted #DDE3E9; }
.deep-toc-no { width: 34px; font-size: 12px; color: ${GOLD}; font-weight: 700; font-variant-numeric: tabular-nums; }
.deep-toc-title { flex: 1; font-size: 13.5px; color: ${INK}; }
.deep-toc-page { font-size: 12px; color: ${MUTED}; font-variant-numeric: tabular-nums; }
.deep-argument { height: 100%; display: flex; flex-direction: column; }
.deep-argument-head { display: flex; align-items: flex-start; gap: 12px; padding-bottom: 9px; border-bottom: 1px solid ${HAIRLINE}; margin-bottom: 12px; }
.deep-argument-index { flex-shrink: 0; background: ${NAVY}; color: ${GOLD}; font-size: 10px; font-weight: 700; letter-spacing: 0.8px; padding: 5px 9px; border-radius: 2px; margin-top: 3px; }
.deep-argument-title { font-size: 21px; font-weight: 700; color: ${NAVY}; line-height: 1.35; }
.deep-argument-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 1.52fr 0.88fr; gap: 22px; overflow: hidden; }
.deep-argument-main { min-width: 0; overflow: hidden; }
.deep-argument-side { min-width: 0; display: flex; flex-direction: column; gap: 12px; overflow: hidden; }
.deep-section-label { display: flex; align-items: center; gap: 7px; font-size: 10px; font-weight: 700; color: ${GOLD}; letter-spacing: 1.4px; margin-bottom: 4px; }
.deep-section-label i { display: inline-flex; width: 16px; height: 16px; border-radius: 50%; background: ${NAVY}; color: ${GOLD}; font-style: normal; font-size: 9px; align-items: center; justify-content: center; }
.deep-section-text { font-size: 13px; line-height: 1.68; color: ${INK}; text-align: justify; margin-bottom: 9px; }
.deep-evidence { border-left: 2px solid ${GOLD}; background: #FAF8F2; padding: 8px 11px; margin-bottom: 7px; }
.deep-evidence-head { display: flex; align-items: center; gap: 7px; margin-bottom: 3px; }
.deep-evidence-text { flex: 1; font-size: 12px; color: #4B5563; line-height: 1.55; }
.deep-evidence-ref { flex-shrink: 0; font-size: 9px; font-weight: 700; color: ${NAVY}; background: #EFE6C8; padding: 2px 5px; border-radius: 2px; }
.deep-evidence-quote { font-size: 11.5px; color: ${INK}; line-height: 1.6; font-style: italic; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.deep-citation-check { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 7px 10px; background: #ECF8F6; border: 1px solid #CBE9E4; font-size: 10.5px; color: #0F5F57; line-height: 1.5; }
.deep-citation-check b { font-weight: 700; }
.deep-argument--dense .deep-argument-title { font-size: 19px; }
.deep-argument--dense .deep-section-text { font-size: 12.2px; line-height: 1.6; margin-bottom: 7px; }
.deep-argument--dense .deep-section-label { margin-bottom: 2px; }
.deep-argument--dense .deep-evidence { padding: 7px 10px; margin-bottom: 6px; }
.deep-argument--dense .deep-evidence-text { font-size: 11.2px; }
.deep-argument--dense .deep-evidence-quote { font-size: 11px; }
.deep-argument--dense .deep-view-text { font-size: 12px; line-height: 1.6; }
.deep-view { background: ${NAVY}; color: #FFFFFF; padding: 13px 15px; flex-shrink: 0; }
.deep-view-label { font-size: 10px; color: ${GOLD}; letter-spacing: 1.6px; font-weight: 700; margin-bottom: 5px; }
.deep-view-text { font-size: 12px; line-height: 1.62; color: #F1F5F9; text-align: justify; }
.deep-argument-image { border: 1px solid ${HAIRLINE}; padding: 6px; background: #FFFFFF; min-height: 0; }
.deep-argument-image img { display: block; width: 100%; max-height: 236px; object-fit: contain; }
.deep-argument-image-caption { font-size: 9px; color: ${MUTED}; margin-top: 4px; line-height: 1.45; }
.deep-source-hint { border: 1px dashed #C7D0DA; padding: 10px 12px; font-size: 10.5px; color: ${MUTED}; line-height: 1.6; }
.deep-section-stat { display: flex; gap: 14px; margin-top: 28px; }
.deep-section-stat-card { border: 1px solid rgba(255,255,255,0.18); padding: 12px 18px; min-width: 112px; }
.deep-section-stat-value { font-size: 22px; font-weight: 700; color: ${GOLD}; line-height: 1; }
.deep-section-stat-label { font-size: 10px; color: #B9C4D0; letter-spacing: 1px; margin-top: 5px; }
@page { size: 338.67mm 190.5mm; margin: 0; }
@media print {
  .deep-doc { gap: 0 !important; }
  .deep-page { box-shadow: none !important; break-after: page; page-break-after: always; width: 338.67mm; height: 190.5mm; }
  .deep-page:last-child { break-after: auto; page-break-after: auto; }
  .deep-doc-zoom { zoom: 1 !important; }
}
`

function CoverPage({ spec }: { spec: DeepDocSpec }) {
  const meta: Array<{ label: string; value: string }> = []
  if (spec.industry) meta.push({ label: '所属行业', value: spec.industry })
  if (spec.financingRound) meta.push({ label: '融资轮次', value: spec.financingRound })
  if (spec.totalAmount) meta.push({ label: '融资规模', value: spec.totalAmount })

  const modulePages = spec.pages.filter(page => {
    if (page.kind !== 'section') return false
    const no = Number(page.sectionNo)
    return Number.isFinite(no) && no >= 3 && no <= 11
  }).length

  return (
    <div className="deep-page deep-cover">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: '#93A3B5' }}>INVESTMENT DUE DILIGENCE</div>
        <div style={{ fontSize: 10, letterSpacing: 2, color: GOLD }}>机密</div>
      </div>

      <div className="deep-cover-grid" style={{ marginTop: 22 }}>
        <div className="deep-cover-main">
          <div style={{ fontSize: 12, color: '#B9C4D0', letterSpacing: 2 }}>泰亚投资 · 项目尽调</div>
          <div className="deep-cover-title" style={{ marginTop: 12 }}>{spec.title}</div>
          <div style={{ width: 92, height: 2, background: GOLD, margin: '20px 0' }} />
          <div className="deep-cover-sub">{spec.subtitle}</div>
          <div className="deep-cover-company">{spec.projectName}</div>
          {spec.companyFullName && spec.companyFullName !== spec.projectName ? (
            <div style={{ fontSize: 12, color: '#A9B7C6', marginTop: 5 }}>{spec.companyFullName}</div>
          ) : null}

          {meta.length > 0 ? (
            <div className="deep-cover-meta">
              {meta.map(item => (
                <div key={item.label}>
                  <div className="deep-cover-meta-label">{item.label}</div>
                  <div className="deep-cover-meta-value">{item.value}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="deep-cover-aside">
          <div className="deep-cover-stat">
            <div className="deep-cover-stat-value">{spec.pageCount}</div>
            <div className="deep-cover-stat-label">报告页数</div>
          </div>
          <div className="deep-cover-stat">
            <div className="deep-cover-stat-value">{modulePages || 9}</div>
            <div className="deep-cover-stat-label">尽调模块</div>
          </div>
          <div className="deep-cover-stat">
            <div className="deep-cover-stat-value">{spec.stats.docCount}</div>
            <div className="deep-cover-stat-label">资料中心文件</div>
          </div>
          <div style={{ fontSize: 10, color: '#8FA3B5', lineHeight: 1.8, marginTop: 6 }}>
            本报告由九大尽调模块驱动，逐论点引用资料中心原文与公开检索证据。
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.16)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#8FA3B5' }}>
        <span>{formatDate(spec.generatedAt)}</span>
        <span>机密 · 仅供投资决策使用</span>
      </div>
    </div>
  )
}

function TocPage({ spec }: { spec: DeepDocSpec }) {
  return (
    <div className="deep-page deep-toc">
      <div style={{ fontSize: 10, letterSpacing: 3, color: GOLD }}>CONTENTS</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: NAVY, marginTop: 4, marginBottom: 6 }}>目录</div>
      <div style={{ width: 64, height: 2, background: GOLD, marginBottom: 18 }} />
      <div className="deep-toc-grid">
        {spec.toc.map(item => (
          <div className="deep-toc-row" key={`${item.no}-${item.title}`}>
            <div className="deep-toc-no">{item.no}</div>
            <div className="deep-toc-title">{item.title}</div>
            <div className="deep-toc-page">{item.page}</div>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, bottom: 28, display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94A3B8', borderTop: `1px solid ${HAIRLINE}`, paddingTop: 7 }}>
        <span>{spec.projectName}</span>
        <span>2</span>
      </div>
    </div>
  )
}

function SectionPage({ page, spec }: { page: DeepPage; spec: DeepDocSpec }) {
  return (
    <div className="deep-page deep-section">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 40 }}>
        <div style={{ fontSize: 132, fontWeight: 700, color: GOLD, lineHeight: 0.9, minWidth: 190 }}>{page.sectionNo}</div>
        <div style={{ paddingTop: 18, maxWidth: 760 }}>
          <div style={{ width: 74, height: 2, background: 'rgba(201,162,39,0.65)', marginBottom: 22 }} />
          <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.35 }}>{page.sectionTitle}</div>
          {page.kicker ? (
            <div style={{ fontSize: 14, color: '#B9C4D0', marginTop: 14, lineHeight: 1.8 }}>{page.kicker}</div>
          ) : null}
          {page.sectionStats && page.sectionStats.length > 0 ? (
            <div className="deep-section-stat">
              {page.sectionStats.map(item => (
                <div className="deep-section-stat-card" key={item.label}>
                  <div className="deep-section-stat-value">{item.value}</div>
                  <div className="deep-section-stat-label">{item.label}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 72, right: 72, bottom: 24, display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#7E8FA1' }}>
        <span>{spec.projectName}</span>
        <span>{page.pageNo}</span>
      </div>
    </div>
  )
}

function ChartView({ block }: { block: Extract<DeepBlock, { type: 'chart' }> }) {
  if (block.chart.kind === 'donut') {
    const series = block.chart.series
    const total = series.reduce((sum, item) => sum + item.value, 0)
    const radius = 66
    const circumference = 2 * Math.PI * radius
    let offset = 0
    return (
      <div className="deep-chart">
        <div className="deep-chart-title">
          <span>{block.title}</span>
          {block.unit ? <span style={{ color: MUTED, fontWeight: 400 }}>单位：{block.unit}</span> : null}
        </div>
        {total <= 0 ? (
          <div style={{ fontSize: 11, color: MUTED, padding: '16px 0' }}>暂无数据</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
            <svg width={190} height={190} viewBox="0 0 190 190">
              <circle cx={95} cy={95} r={radius} fill="none" stroke="#EEF1F4" strokeWidth={26} />
              {series.map((item, index) => {
                const dash = (item.value / total) * circumference
                const el = (
                  <circle
                    key={`${item.label}-${index}`}
                    cx={95}
                    cy={95}
                    r={radius}
                    fill="none"
                    stroke={item.color || CHART_COLORS[index % CHART_COLORS.length]}
                    strokeWidth={26}
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 95 95)"
                  />
                )
                offset += dash
                return el
              })}
              <text x={95} y={90} textAnchor="middle" fontSize={22} fontWeight={700} fill={NAVY}>{total}</text>
              <text x={95} y={110} textAnchor="middle" fontSize={10} fill={MUTED}>{block.unit || '合计'}</text>
            </svg>
            <div style={{ flex: 1 }}>
              {series.map((item, index) => (
                <div key={`${item.label}-legend-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8, fontSize: 12 }}>
                  <span style={{ width: 10, height: 10, background: item.color || CHART_COLORS[index % CHART_COLORS.length], borderRadius: 2 }} />
                  <span style={{ flex: 1, color: INK }}>{item.label}</span>
                  <span style={{ color: NAVY, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {block.note ? <div className="deep-note">{block.note}</div> : null}
      </div>
    )
  }

  if (block.chart.kind === 'stackedBar') {
    const categories = block.chart.categories
    const series = block.chart.series
    const labelWidth = 120
    const valueWidth = 34
    const chartWidth = 1080
    const rowHeight = 27
    const height = categories.length * rowHeight + 12
    const max = Math.max(1, ...categories.map((_, categoryIndex) =>
      series.reduce((sum, item) => sum + (item.values[categoryIndex] || 0), 0)
    ))
    return (
      <div className="deep-chart">
        <div className="deep-chart-title">
          <span>{block.title}</span>
          {block.unit ? <span style={{ color: MUTED, fontWeight: 400 }}>单位：{block.unit}</span> : null}
        </div>
        <div style={{ display: 'flex', gap: 16, marginBottom: 5 }}>
          {series.map((item, index) => (
            <span key={`${item.label}-legend`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: INK }}>
              <i style={{ width: 9, height: 9, background: item.color || CHART_COLORS[index % CHART_COLORS.length], display: 'inline-block', borderRadius: 2 }} />
              {item.label}
            </span>
          ))}
        </div>
        <svg width="100%" viewBox={`0 0 ${chartWidth} ${height}`} style={{ display: 'block' }}>
          {categories.map((category, categoryIndex) => {
            const barMax = chartWidth - labelWidth - valueWidth
            const total = series.reduce((sum, item) => sum + (item.values[categoryIndex] || 0), 0)
            let offset = 0
            const y = categoryIndex * rowHeight + 4
            return (
              <g key={`${category}-stack`}>
                <text x={labelWidth - 8} y={y + 12} textAnchor="end" fontSize={10.5} fill={INK}>{category}</text>
                <rect x={labelWidth} y={y} width={barMax} height={14} fill="#F1F4F7" rx={2} />
                {series.map((item, seriesIndex) => {
                  const value = item.values[categoryIndex] || 0
                  if (value <= 0) return null
                  const width = Math.max(1, (value / max) * barMax)
                  const rect = (
                    <rect
                      key={`${item.label}-${categoryIndex}`}
                      x={labelWidth + offset}
                      y={y}
                      width={width}
                      height={14}
                      fill={item.color || CHART_COLORS[seriesIndex % CHART_COLORS.length]}
                    />
                  )
                  offset += width
                  return rect
                })}
                <text x={labelWidth + barMax + 6} y={y + 11} fontSize={10.5} fontWeight={700} fill={NAVY}>{total}</text>
              </g>
            )
          })}
        </svg>
        {block.note ? <div className="deep-note">{block.note}</div> : null}
      </div>
    )
  }

  const series = block.chart.series
  const max = Math.max(1, ...series.map(item => item.value))
  const labelWidth = 162
  const valueWidth = 42
  const chartWidth = 1080
  const rowHeight = 28
  const height = series.length * rowHeight + 12

  return (
    <div className="deep-chart">
      <div className="deep-chart-title">
        <span>{block.title}</span>
        {block.unit ? <span style={{ color: MUTED, fontWeight: 400 }}>单位：{block.unit}</span> : null}
      </div>
      <svg width="100%" viewBox={`0 0 ${chartWidth} ${height}`} style={{ display: 'block' }}>
        {series.map((item, index) => {
          const barMax = chartWidth - labelWidth - valueWidth
          const width = Math.max(2, (item.value / max) * barMax)
          const y = index * rowHeight + 4
          return (
            <g key={`${item.label}-bar-${index}`}>
              <text x={labelWidth - 8} y={y + 13} textAnchor="end" fontSize={11} fill={INK}>{item.label}</text>
              <rect x={labelWidth} y={y} width={barMax} height={15} fill="#F1F4F7" rx={2} />
              <rect x={labelWidth} y={y} width={width} height={15} fill={item.color || CHART_COLORS[index % CHART_COLORS.length]} rx={2} />
              <text x={labelWidth + barMax + 6} y={y + 12} fontSize={11} fontWeight={700} fill={NAVY}>{item.value}</text>
            </g>
          )
        })}
      </svg>
      {block.note ? <div className="deep-note">{block.note}</div> : null}
    </div>
  )
}

function ArgumentView({ block }: { block: Extract<DeepBlock, { type: 'argument' }> }) {
  const argument = block.argument
  const density = argument.content.length + argument.analysis.length + argument.view.length
    + argument.evidence.reduce((sum, item) => sum + item.text.length + (item.quote?.length || 0), 0)
  const denseClass = density > 560 ? ' deep-argument--dense' : ''
  const docQuotes = argument.evidence.filter(item => item.quote && item.ref?.startsWith('资料')).length
  const publicRefs = argument.evidence.filter(item => item.ref && /^[FE]\d+$/.test(item.ref)).length
  return (
    <div className={`deep-argument${denseClass}`}>
      <div className="deep-argument-head">
        <span className="deep-argument-index">论点 {block.index} / {block.total}</span>
        <div className="deep-argument-title">{argument.title}</div>
      </div>
      <div className="deep-argument-grid">
        <div className="deep-argument-main">
          <div className="deep-section-label"><i>01</i>内容</div>
          <div className="deep-section-text">{argument.content}</div>

          <div className="deep-section-label"><i>02</i>分析</div>
          <div className="deep-section-text">{argument.analysis}</div>

          <div className="deep-section-label"><i>03</i>论据</div>
          {argument.evidence.map((item, index) => (
            <div className="deep-evidence" key={`${item.text.slice(0, 10)}-${index}`}>
              <div className="deep-evidence-head">
                <span className="deep-evidence-text">{item.text}</span>
                {item.ref ? <span className="deep-evidence-ref">{item.ref}</span> : null}
              </div>
              {item.quote ? <div className="deep-evidence-quote">“{item.quote}”</div> : null}
            </div>
          ))}
          <div className="deep-citation-check">
            引用校验：本论点 <b>{argument.evidence.length}</b> 条论据
            {docQuotes > 0 ? <> · 资料中心原文 <b>{docQuotes}</b> 条（已逐字校验）</> : null}
            {publicRefs > 0 ? <> · 公开证据 <b>{publicRefs}</b> 条</> : null}
          </div>
        </div>

        <div className="deep-argument-side">
          <div className="deep-view">
            <div className="deep-view-label">观点</div>
            <div className="deep-view-text">{argument.view}</div>
          </div>
          {block.image ? (
            <div className="deep-argument-image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={block.image.url} alt={block.image.caption} referrerPolicy="no-referrer" loading="lazy" />
              <div className="deep-argument-image-caption">
                {block.image.caption}{block.image.source ? ` · 来源：${block.image.source}` : ''}
              </div>
            </div>
          ) : (
            <div className="deep-source-hint">
              本论点未关联资料图片；证据编号对应附录「资料中心资料索引」与「事实索引」。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function BlockView({ block }: { block: DeepBlock }) {
  switch (block.type) {
    case 'heading':
      return <div className={block.level === 2 ? 'deep-h2' : 'deep-h1'}>{block.text}</div>
    case 'paragraph':
      return <p className="deep-p">{block.text}</p>
    case 'bullets':
      return (
        <ul className="deep-ul">
          {block.items.map((item, index) => (
            <li className="deep-li" key={`${item.slice(0, 12)}-${index}`}>{item}</li>
          ))}
        </ul>
      )
    case 'qa':
      return (
        <div>
          {block.items.map((item, index) => (
            <div className="deep-qa" key={`${item.question.slice(0, 12)}-${index}`}>
              <div className="deep-q">
                <span className="deep-q-badge">Q</span>
                <span>{item.question}</span>
              </div>
              <div className="deep-a">{item.answer}</div>
            </div>
          ))}
        </div>
      )
    case 'table':
      return (
        <div className="deep-table-wrap">
          {block.title ? <div className="deep-table-title">{block.title}</div> : null}
          <table className="deep-table">
            <thead>
              <tr>
                {block.columns.map(column => <th key={column}>{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={`row-${index}`}>
                  {row.map((cell, cellIndex) => <td key={`cell-${index}-${cellIndex}`}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {block.note ? <div className="deep-note">{block.note}</div> : null}
        </div>
      )
    case 'chart':
      return <ChartView block={block} />
    case 'image':
      return (
        <div className="deep-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.url} alt={block.caption} referrerPolicy="no-referrer" loading="lazy" />
          <div className="deep-image-caption">
            {block.caption}{block.source ? ` · 来源：${block.source}` : ''}
          </div>
        </div>
      )
    case 'callout':
      return (
        <div className={`deep-callout ${block.tone || 'gold'}`}>
          {block.title ? <div className="deep-callout-title">{block.title}</div> : null}
          <div className="deep-callout-text">{block.text}</div>
        </div>
      )
    case 'argument':
      return <ArgumentView block={block} />
    default:
      return null
  }
}

function ContentPage({ page, spec }: { page: DeepPage; spec: DeepDocSpec }) {
  return (
    <div className="deep-page deep-content">
      <div className="deep-header">
        <span>{page.sectionNo ? <><b>{page.sectionNo}</b> · </> : ''}{page.sectionTitle || spec.title}</span>
        <span>{spec.projectName}</span>
      </div>
      <div className="deep-body">
        {page.blocks.map((block, index) => <BlockView block={block} key={`${block.type}-${index}`} />)}
      </div>
      <div className="deep-footer">
        <span>机密 · 仅供投资决策使用</span>
        <span>{page.pageNo} / {spec.pageCount}</span>
      </div>
    </div>
  )
}

export default function DeepReportDocument({ spec }: { spec: DeepDocSpec }) {
  return (
    <div className="deep-doc">
      <style>{DOC_STYLE}</style>
      {spec.pages.map(page => {
        if (page.kind === 'cover') return <CoverPage spec={spec} key="cover" />
        if (page.kind === 'toc') return <TocPage spec={spec} key="toc" />
        if (page.kind === 'section') return <SectionPage page={page} spec={spec} key={`section-${page.pageNo}`} />
        return <ContentPage page={page} spec={spec} key={`page-${page.pageNo}`} />
      })}
    </div>
  )
}
