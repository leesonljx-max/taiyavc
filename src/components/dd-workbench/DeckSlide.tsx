'use client'

/**
 * 单页幻灯片渲染（1280×720 固定画布）
 *
 * 全部使用内联 style + 十六进制颜色：html-to-image 截图时不依赖外部样式，
 * 避免 Tailwind 颜色类在克隆节点时丢失导致导出失败。
 */

import type { CSSProperties } from 'react'
import type { SlideColumn, SlideSpec, SlideStat } from '@/lib/dd-deck/spec'

const C = {
  navy: '#0B1F33',
  navy2: '#12314F',
  teal: '#14B8A6',
  gold: '#C9A227',
  ivory: '#F7F3EA',
  ink: '#1B2A38',
  gray: '#6B7A88',
  line: '#E3DCCB',
  card: '#FFFDF6',
  calloutBg: '#FBF3DC',
  negative: '#C0523F',
  white: '#FFFFFF',
  coverSub: '#B9C6D2',
}

const SERIF = 'Georgia, "Songti SC", "Noto Serif SC", serif'
const SANS = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

const TONE_COLOR: Record<NonNullable<SlideColumn['tone']>, string> = {
  positive: C.teal,
  negative: C.negative,
  neutral: C.gold,
}

const PAGE: CSSProperties = {
  width: 1280,
  height: 720,
  boxSizing: 'border-box',
  overflow: 'hidden',
  position: 'relative',
  fontFamily: SANS,
  color: C.ink,
}

const CLAMP_2: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
}

function clampLines(n: number): CSSProperties {
  return {
    display: '-webkit-box',
    WebkitLineClamp: n,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  }
}

function CoverSlide({
  slide,
  projectName,
  deckType,
}: {
  slide: SlideSpec
  projectName?: string
  deckType?: 'BRIEF' | 'FINAL'
}) {
  const kicker = slide.kicker || (deckType === 'FINAL' ? '尽调报告' : '资料简报')

  return (
    <div
      style={{
        ...PAGE,
        background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navy2} 62%, ${C.navy} 100%)`,
        color: C.white,
      }}
    >
      {/* 装饰几何 */}
      <div
        style={{
          position: 'absolute',
          right: -150,
          top: -170,
          width: 460,
          height: 460,
          borderRadius: '50%',
          border: `2px solid ${C.teal}`,
          opacity: 0.3,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 40,
          top: -70,
          width: 240,
          height: 240,
          borderRadius: '50%',
          background: C.teal,
          opacity: 0.12,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: -60,
          bottom: -120,
          width: 380,
          height: 380,
          background: `linear-gradient(135deg, ${C.gold} 0%, rgba(201,162,39,0) 72%)`,
          opacity: 0.16,
          transform: 'rotate(-14deg)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 88,
          top: 0,
          width: 3,
          height: 150,
          background: C.gold,
          opacity: 0.55,
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          height: '100%',
          padding: '0 88px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: C.gold,
            marginBottom: 22,
          }}
        >
          {kicker}
        </div>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 56,
            lineHeight: 1.2,
            fontWeight: 700,
            color: C.white,
            maxWidth: 960,
            ...CLAMP_2,
          }}
        >
          {slide.title}
        </div>
        {slide.subtitle ? (
          <div
            style={{
              marginTop: 22,
              fontSize: 22,
              lineHeight: 1.5,
              color: C.coverSub,
              maxWidth: 820,
              ...clampLines(2),
            }}
          >
            {slide.subtitle}
          </div>
        ) : null}
        <div style={{ width: 72, height: 3, background: C.teal, marginTop: 34 }} />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 88,
          right: 88,
          bottom: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          fontSize: 14,
          color: '#E8EEF4',
          zIndex: 1,
        }}
      >
        <span style={{ maxWidth: 640, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {projectName || ''}
        </span>
        {slide.footer ? (
          <>
            <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.28)' }} />
            <span style={{ fontSize: 13, color: '#8FA3B5' }}>{slide.footer}</span>
          </>
        ) : null}
      </div>
    </div>
  )
}

function SectionSlide({ slide }: { slide: SlideSpec }) {
  const sectionNo = slide.sectionNo || String(slide.slideNo).padStart(2, '0')

  return (
    <div
      style={{
        ...PAGE,
        background: `linear-gradient(120deg, ${C.navy} 0%, ${C.navy2} 100%)`,
        color: C.white,
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: -100,
          bottom: -140,
          width: 400,
          height: 400,
          borderRadius: '50%',
          border: `2px solid ${C.gold}`,
          opacity: 0.18,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 88,
          top: '50%',
          transform: 'translateY(-50%)',
          fontFamily: SERIF,
          fontSize: 120,
          lineHeight: 1,
          fontWeight: 700,
          color: C.white,
          opacity: 0.12,
          letterSpacing: -2,
        }}
      >
        {sectionNo}
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          height: '100%',
          padding: '0 88px 0 320px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 3,
            color: C.gold,
            textTransform: 'uppercase',
            marginBottom: 18,
          }}
        >
          {slide.kicker || '章节'}
        </div>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 44,
            lineHeight: 1.28,
            fontWeight: 700,
            color: C.white,
            ...CLAMP_2,
          }}
        >
          {slide.title}
        </div>
        {slide.subtitle ? (
          <div style={{ marginTop: 16, fontSize: 18, lineHeight: 1.6, color: C.coverSub, ...clampLines(2) }}>
            {slide.subtitle}
          </div>
        ) : null}
        <div style={{ width: 56, height: 3, background: C.teal, marginTop: 26 }} />
      </div>
    </div>
  )
}

function StatsRow({ stats }: { stats: SlideStat[] }) {
  const items = stats.slice(0, 4)

  return (
    <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
      {items.map((stat, i) => (
        <div
          key={`${stat.label}-${i}`}
          style={{
            flex: 1,
            minWidth: 0,
            background: C.card,
            border: `1px solid ${C.line}`,
            borderRadius: 14,
            padding: '16px 18px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: C.gray,
              letterSpacing: 0.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {stat.label}
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 34,
              lineHeight: 1.2,
              fontWeight: 700,
              color: C.navy,
              marginTop: 6,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {stat.value}
          </div>
          {stat.hint ? (
            <div style={{ fontSize: 11, color: C.gray, marginTop: 4, ...clampLines(1) }}>{stat.hint}</div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ColumnsRow({ columns }: { columns: SlideColumn[] }) {
  const colCount = columns.length >= 3 ? 3 : 2

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
        gap: 22,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {columns.map((col, ci) => (
        <div key={`${col.title}-${ci}`} style={{ minWidth: 0, overflow: 'hidden' }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: C.ink,
              paddingBottom: 8,
              borderBottom: `2px solid ${TONE_COLOR[col.tone || 'neutral']}`,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {col.title}
          </div>
          <ul
            style={{
              margin: 0,
              padding: 0,
              marginTop: 10,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
              overflow: 'hidden',
            }}
          >
            {(col.items || []).slice(0, 5).map((item, ii) => (
              <li
                key={ii}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  fontSize: 15,
                  lineHeight: 1.5,
                  color: C.ink,
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: TONE_COLOR[col.tone || 'neutral'],
                    marginTop: 9,
                    flexShrink: 0,
                  }}
                />
                <span style={{ minWidth: 0, ...clampLines(3) }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function BulletList({ bullets }: { bullets: string[] }) {
  const items = bullets.slice(0, 5)
  const centered = items.length <= 3

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: centered ? 'center' : 'flex-start',
        gap: centered ? 20 : 14,
        overflow: 'hidden',
      }}
    >
      {items.map((bullet, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            fontSize: 18,
            lineHeight: 1.55,
            color: C.ink,
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: C.teal,
              marginTop: 10,
              flexShrink: 0,
            }}
          />
          <span style={{ minWidth: 0, ...clampLines(2) }}>{bullet}</span>
        </div>
      ))}
    </div>
  )
}

function Callout({ text }: { text: string }) {
  return (
    <div
      style={{
        flexShrink: 0,
        background: C.calloutBg,
        borderLeft: `4px solid ${C.gold}`,
        borderRadius: 8,
        padding: '12px 16px',
        fontSize: 15,
        lineHeight: 1.5,
        color: '#4A3F22',
        ...clampLines(3),
      }}
    >
      {text}
    </div>
  )
}

export default function DeckSlide({
  slide,
  projectName,
  deckType,
}: {
  slide: SlideSpec
  projectName?: string
  deckType?: 'BRIEF' | 'FINAL'
}) {
  if (slide.layout === 'cover') {
    return (
      <div data-deck-slide style={PAGE}>
        <CoverSlide slide={slide} projectName={projectName} deckType={deckType} />
      </div>
    )
  }

  if (slide.layout === 'section') {
    return (
      <div data-deck-slide style={PAGE}>
        <SectionSlide slide={slide} />
      </div>
    )
  }

  const stats = slide.stats || []
  const columns = slide.columns || []
  const bullets = slide.bullets || []
  const refs = slide.evidenceRefs || []
  const kicker = slide.kicker || (deckType === 'FINAL' ? '尽调报告' : '资料简报')

  return (
    <div data-deck-slide style={{ ...PAGE, background: C.ivory }}>
      {/* 左上细金线 */}
      <div style={{ position: 'absolute', left: 64, top: 0, width: 120, height: 3, background: C.gold }} />

      <div
        style={{
          height: '100%',
          boxSizing: 'border-box',
          padding: '48px 64px 0',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ flexShrink: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: C.gold,
              marginBottom: 10,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {kicker}
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 34,
              lineHeight: 1.25,
              fontWeight: 700,
              color: C.navy,
              ...CLAMP_2,
            }}
          >
            {slide.title}
          </div>
          <div style={{ width: 48, height: 3, background: C.teal, marginTop: 12 }} />
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: '20px 0 16px',
            overflow: 'hidden',
          }}
        >
          {stats.length > 0 ? <StatsRow stats={stats} /> : null}
          {columns.length > 0 ? <ColumnsRow columns={columns} /> : null}
          {bullets.length > 0 ? <BulletList bullets={bullets} /> : null}
          {bullets.length === 0 ? <div style={{ flex: 1, minHeight: 0 }} /> : null}
          {slide.callout ? <Callout text={slide.callout} /> : null}
        </div>

        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            paddingBottom: 30,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: C.gray,
              letterSpacing: 0.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {slide.footer || projectName || ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
            {refs.length > 0 ? (
              <span style={{ fontSize: 10, color: C.gray, letterSpacing: 0.3 }}>
                证据 {refs.join(' · ')}
              </span>
            ) : null}
            <span style={{ fontSize: 12, fontWeight: 700, color: C.navy, minWidth: 18, textAlign: 'right' }}>
              {slide.slideNo}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
