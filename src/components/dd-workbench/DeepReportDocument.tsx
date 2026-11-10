'use client'

/**
 * 深度尽调报告 A4 文档渲染
 *
 * 每页固定 794×1123px（A4 @96dpi），打印时按 210mm 宽输出。
 * 样式对齐参考报告：深海军蓝 + 金色，白色纸张，图文混排。
 */

import React from 'react'
import type { DeepBlock, DeepDocSpec, DeepPage } from '@/lib/dd-deep/spec'

const NAVY = '#0B1F33'
const GOLD = '#C9A227'
const TEAL = '#14B8A6'
const INK = '#1F2937'
const MUTED = '#6B7280'
const HAIRLINE = '#D9DEE5'

const PAGE_W = 794
const PAGE_H = 1123

const CHART_COLORS = [NAVY, GOLD, TEAL, '#8FA3B5', '#B08968', '#5B7083']

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

const DOC_STYLE = `
.deep-doc { display: flex; flex-direction: column; align-items: center; gap: 28px; }
.deep-page {
  width: ${PAGE_W}px; height: ${PAGE_H}px; background: #FFFFFF; position: relative;
  overflow: hidden; box-sizing: border-box; flex-shrink: 0;
  box-shadow: 0 10px 30px rgba(11,31,51,0.16);
}
.deep-cover { background: ${NAVY}; color: #FFFFFF; padding: 64px 68px; display: flex; flex-direction: column; }
.deep-cover-rule { height: 2px; background: ${GOLD}; width: 92px; margin: 26px 0; }
.deep-toc { padding: 66px 68px 60px; }
.deep-section { background: ${NAVY}; color: #FFFFFF; padding: 96px 68px; display: flex; flex-direction: column; justify-content: center; }
.deep-content { padding: 54px 60px 66px; display: flex; flex-direction: column; }
.deep-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid ${HAIRLINE}; padding-bottom: 8px; margin-bottom: 22px; font-size: 10px; color: ${MUTED}; letter-spacing: 0.5px; }
.deep-footer { position: absolute; left: 60px; right: 60px; bottom: 26px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid ${HAIRLINE}; padding-top: 8px; font-size: 9px; color: #94A3B8; letter-spacing: 0.5px; }
.deep-body { flex: 1; min-height: 0; overflow: hidden; }
.deep-h1 { font-size: 19px; font-weight: 700; color: ${NAVY}; margin: 18px 0 10px; padding-left: 10px; border-left: 3px solid ${GOLD}; line-height: 1.4; }
.deep-h1:first-child { margin-top: 0; }
.deep-h2 { font-size: 14px; font-weight: 700; color: ${NAVY}; margin: 14px 0 8px; }
.deep-p { font-size: 11.5px; line-height: 1.95; color: ${INK}; text-align: justify; margin: 0 0 10px; }
.deep-ul { list-style: none; margin: 0 0 8px; padding: 0; }
.deep-li { position: relative; font-size: 11.5px; line-height: 1.85; color: ${INK}; text-align: justify; padding-left: 15px; margin-bottom: 6px; }
.deep-li::before { content: ''; position: absolute; left: 2px; top: 8px; width: 5px; height: 5px; background: ${GOLD}; border-radius: 50%; }
.deep-qa { margin: 0 0 10px; }
.deep-q { display: flex; gap: 8px; font-size: 11.5px; font-weight: 700; color: ${NAVY}; line-height: 1.7; margin-bottom: 3px; }
.deep-q-badge { flex-shrink: 0; width: 17px; height: 17px; border-radius: 3px; background: ${NAVY}; color: ${GOLD}; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 2px; }
.deep-a { font-size: 11px; line-height: 1.85; color: #374151; text-align: justify; padding-left: 25px; }
.deep-table-wrap { margin: 10px 0 12px; }
.deep-table-title { font-size: 10.5px; font-weight: 700; color: ${NAVY}; margin-bottom: 5px; }
.deep-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.deep-table th { background: ${NAVY}; color: #FFFFFF; font-size: 9.5px; font-weight: 600; padding: 7px 6px; text-align: left; border: 1px solid ${NAVY}; }
.deep-table td { font-size: 9.5px; line-height: 1.55; color: ${INK}; padding: 6px; border: 1px solid ${HAIRLINE}; vertical-align: top; word-break: break-word; }
.deep-table tr:nth-child(even) td { background: #F7F8FA; }
.deep-note { font-size: 9px; color: #94A3B8; margin-top: 4px; line-height: 1.6; }
.deep-chart { margin: 12px 0 14px; border: 1px solid ${HAIRLINE}; padding: 12px 14px 10px; background: #FCFCFD; }
.deep-chart-title { font-size: 10.5px; font-weight: 700; color: ${NAVY}; margin-bottom: 6px; display: flex; justify-content: space-between; }
.deep-image { margin: 12px 0 14px; text-align: center; }
.deep-image img { max-width: 100%; max-height: 290px; object-fit: contain; border: 1px solid ${HAIRLINE}; background: #FFFFFF; }
.deep-image-caption { font-size: 9px; color: ${MUTED}; margin-top: 5px; line-height: 1.6; }
.deep-callout { border-left: 3px solid ${GOLD}; background: #FBF7EA; padding: 11px 14px; margin: 12px 0; }
.deep-callout-title { font-size: 10px; font-weight: 700; color: ${NAVY}; margin-bottom: 4px; letter-spacing: 0.5px; }
.deep-callout-text { font-size: 11px; line-height: 1.85; color: ${INK}; text-align: justify; }
.deep-callout.red { border-left-color: #C0523F; background: #FDF1EE; }
.deep-callout.red .deep-callout-title { color: #9F2F1F; }
.deep-callout.teal { border-left-color: ${TEAL}; background: #ECF8F6; }
.deep-toc-row { display: flex; align-items: baseline; gap: 10px; padding: 8px 0; border-bottom: 1px dotted #DDE3E9; }
.deep-toc-no { width: 34px; font-size: 11px; color: ${GOLD}; font-weight: 700; font-variant-numeric: tabular-nums; }
.deep-toc-title { flex: 1; font-size: 12.5px; color: ${INK}; }
.deep-toc-page { font-size: 11px; color: ${MUTED}; font-variant-numeric: tabular-nums; }
@page { size: A4; margin: 0; }
@media print {
  .deep-doc { gap: 0 !important; }
  .deep-page { box-shadow: none !important; break-after: page; page-break-after: always; width: 210mm; height: 296.6mm; }
  .deep-page:last-child { break-after: auto; page-break-after: auto; }
  .deep-doc-zoom { zoom: 1 !important; }
}
`

function CoverPage({ spec }: { spec: DeepDocSpec }) {
  const meta: Array<{ label: string; value: string }> = []
  if (spec.industry) meta.push({ label: '所属行业', value: spec.industry })
  if (spec.financingRound) meta.push({ label: '融资轮次', value: spec.financingRound })
  if (spec.totalAmount) meta.push({ label: '融资规模', value: spec.totalAmount })

  return (
    <div className="deep-page deep-cover">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: '#93A3B5' }}>INVESTMENT DUE DILIGENCE</div>
        <div style={{ fontSize: 10, letterSpacing: 2, color: GOLD }}>机密</div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontSize: 13, color: '#B9C4D0', letterSpacing: 2 }}>泰亚投资 · 项目尽调</div>
        <div style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.25, marginTop: 14 }}>{spec.title}</div>
        <div className="deep-cover-rule" />
        <div style={{ fontSize: 17, color: '#E5EAF0', lineHeight: 1.7, maxWidth: 560 }}>{spec.subtitle}</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: GOLD, marginTop: 36 }}>{spec.projectName}</div>
        {spec.companyFullName && spec.companyFullName !== spec.projectName ? (
          <div style={{ fontSize: 12, color: '#A9B7C6', marginTop: 6 }}>{spec.companyFullName}</div>
        ) : null}

        {meta.length > 0 ? (
          <div style={{ display: 'flex', gap: 46, marginTop: 34 }}>
            {meta.map(item => (
              <div key={item.label}>
                <div style={{ fontSize: 9, color: '#8FA3B5', letterSpacing: 1 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: '#FFFFFF', marginTop: 3 }}>{item.value}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.16)', paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#8FA3B5' }}>
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
      <div style={{ fontSize: 28, fontWeight: 700, color: NAVY, marginTop: 6, marginBottom: 8 }}>目录</div>
      <div style={{ width: 64, height: 2, background: GOLD, marginBottom: 26 }} />
      <div>
        {spec.toc.map(item => (
          <div className="deep-toc-row" key={`${item.no}-${item.title}`}>
            <div className="deep-toc-no">{item.no}</div>
            <div className="deep-toc-title">{item.title}</div>
            <div className="deep-toc-page">{item.page}</div>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 68, right: 68, bottom: 46, display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94A3B8', borderTop: `1px solid ${HAIRLINE}`, paddingTop: 8 }}>
        <span>{spec.projectName}</span>
        <span>2</span>
      </div>
    </div>
  )
}

function SectionPage({ page, spec }: { page: DeepPage; spec: DeepDocSpec }) {
  return (
    <div className="deep-page deep-section">
      <div style={{ fontSize: 88, fontWeight: 700, color: GOLD, lineHeight: 1 }}>{page.sectionNo}</div>
      <div style={{ width: 74, height: 2, background: 'rgba(201,162,39,0.65)', margin: '26px 0' }} />
      <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.4 }}>{page.sectionTitle}</div>
      {page.kicker ? (
        <div style={{ fontSize: 13, color: '#B9C4D0', marginTop: 14, maxWidth: 520, lineHeight: 1.8 }}>{page.kicker}</div>
      ) : null}
      <div style={{ position: 'absolute', left: 68, right: 68, bottom: 40, display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#7E8FA1' }}>
        <span>{spec.projectName}</span>
        <span>{page.pageNo}</span>
      </div>
    </div>
  )
}

function ChartView({ block }: { block: Extract<DeepBlock, { type: 'chart' }> }) {
  const series = block.chart.series
  const total = series.reduce((sum, item) => sum + item.value, 0)

  if (block.chart.kind === 'donut') {
    const radius = 58
    const circumference = 2 * Math.PI * radius
    let offset = 0
    return (
      <div className="deep-chart">
        <div className="deep-chart-title">
          <span>{block.title}</span>
          {block.unit ? <span style={{ color: MUTED, fontWeight: 400 }}>单位：{block.unit}</span> : null}
        </div>
        {total <= 0 ? (
          <div style={{ fontSize: 10, color: MUTED, padding: '20px 0' }}>暂无数据</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
            <svg width={160} height={160} viewBox="0 0 160 160">
              <circle cx={80} cy={80} r={radius} fill="none" stroke="#EEF1F4" strokeWidth={24} />
              {series.map((item, index) => {
                const dash = (item.value / total) * circumference
                const el = (
                  <circle
                    key={`${item.label}-${index}`}
                    cx={80}
                    cy={80}
                    r={radius}
                    fill="none"
                    stroke={item.color || CHART_COLORS[index % CHART_COLORS.length]}
                    strokeWidth={24}
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 80 80)"
                  />
                )
                offset += dash
                return el
              })}
              <text x={80} y={76} textAnchor="middle" fontSize={18} fontWeight={700} fill={NAVY}>{total}</text>
              <text x={80} y={94} textAnchor="middle" fontSize={9} fill={MUTED}>{block.unit || '合计'}</text>
            </svg>
            <div style={{ flex: 1 }}>
              {series.map((item, index) => (
                <div key={`${item.label}-legend-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, fontSize: 10 }}>
                  <span style={{ width: 9, height: 9, background: item.color || CHART_COLORS[index % CHART_COLORS.length], borderRadius: 2 }} />
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

  const max = Math.max(1, ...series.map(item => item.value))
  const labelWidth = 108
  const valueWidth = 48
  const chartWidth = 620
  const rowHeight = 25
  const height = series.length * rowHeight + 14

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
              <text x={labelWidth - 8} y={y + 12} textAnchor="end" fontSize={9.5} fill={INK}>{item.label}</text>
              <rect x={labelWidth} y={y} width={barMax} height={13} fill="#F1F4F7" rx={2} />
              <rect
                x={labelWidth}
                y={y}
                width={width}
                height={13}
                fill={item.color || CHART_COLORS[index % CHART_COLORS.length]}
                rx={2}
              />
              <text x={labelWidth + barMax + 6} y={y + 11} fontSize={9.5} fontWeight={700} fill={NAVY}>{item.value}</text>
            </g>
          )
        })}
      </svg>
      {block.note ? <div className="deep-note">{block.note}</div> : null}
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
    default:
      return null
  }
}

function ContentPage({ page, spec }: { page: DeepPage; spec: DeepDocSpec }) {
  return (
    <div className="deep-page deep-content">
      <div className="deep-header">
        <span>{page.sectionNo ? `${page.sectionNo} · ` : ''}{page.sectionTitle || spec.title}</span>
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
