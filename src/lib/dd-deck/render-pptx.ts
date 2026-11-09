/**
 * 原生 PPTX 渲染
 *
 * 与在线查看器共用同一份 SlideSpec；16:9、深海军蓝 + 青绿 + 金色主题，
 * 文字保持可编辑，便于投委会前修改措辞。
 */

import { mkdir } from 'fs/promises'
import { join } from 'path'
import PptxGenJS from 'pptxgenjs'
import prisma from '@/lib/prisma'
import type { DeckSpec, SlideSpec } from './spec'

const FONT = 'Microsoft YaHei'

const C = {
  navy: '0B1F33',
  navySoft: '16324A',
  teal: '14B8A6',
  tealSoft: 'E6F4F1',
  gold: 'C9A227',
  goldSoft: 'F3E8C8',
  ivory: 'F7F3EA',
  white: 'FFFFFF',
  ink: '172B3A',
  slate: '5B6B7C',
  line: 'D9D2C3',
  red: 'B9412F',
  redSoft: 'FBEAE7',
}

type Slide = PptxGenJS.Slide

function addText(
  slide: Slide,
  text: string,
  options: PptxGenJS.TextPropsOptions
): void {
  slide.addText(text, {
    fontFace: FONT,
    color: C.ink,
    margin: 0,
    valign: 'top',
    ...options,
  })
}

function addFooter(slide: Slide, footer: string | undefined, pageNo: number): void {
  if (footer) {
    addText(slide, footer, {
      x: 0.7, y: 7.02, w: 8.5, h: 0.3, fontSize: 8, color: C.slate,
    })
  }
  addText(slide, String(pageNo).padStart(2, '0'), {
    x: 12.0, y: 7.02, w: 0.6, h: 0.3, fontSize: 9, color: C.slate, align: 'right',
  })
}

function addKicker(slide: Slide, kicker: string | undefined, y = 0.55): void {
  if (!kicker) return
  addText(slide, kicker, {
    x: 0.7, y, w: 8, h: 0.28, fontSize: 10, color: C.teal, bold: true,
    charSpacing: 1.5,
  })
}

function addTitle(slide: Slide, title: string, options?: { y?: number; w?: number; size?: number }): void {
  addText(slide, title, {
    x: 0.7,
    y: options?.y ?? 0.9,
    w: options?.w ?? 11.9,
    h: 1.05,
    fontSize: options?.size ?? 26,
    bold: true,
    color: C.navy,
    fit: 'shrink',
    breakLine: false,
  })
}

function addGoldLine(slide: Slide, x: number, y: number, w: number): void {
  slide.addShape('rect', {
    x, y, w, h: 0.045,
    fill: { color: C.gold },
    line: { color: C.gold, width: 0 },
  })
}

function addStatBoxes(slide: Slide, stats: NonNullable<SlideSpec['stats']>, y: number): void {
  const items = stats.slice(0, 4)
  if (items.length === 0) return
  const gap = 0.16
  const totalW = 11.93
  const w = (totalW - gap * (items.length - 1)) / items.length
  items.forEach((stat, i) => {
    const x = 0.7 + i * (w + gap)
    slide.addShape('roundRect', {
      x, y, w, h: 1.0,
      fill: { color: C.white },
      line: { color: C.line, width: 0.75 },
      rectRadius: 0.04,
    })
    addText(slide, stat.label, {
      x: x + 0.16, y: y + 0.12, w: w - 0.32, h: 0.24, fontSize: 9, color: C.slate,
    })
    addText(slide, stat.value, {
      x: x + 0.16, y: y + 0.38, w: w - 0.32, h: 0.36, fontSize: 19, bold: true, color: C.navy,
      fit: 'shrink',
    })
    if (stat.hint) {
      addText(slide, stat.hint, {
        x: x + 0.16, y: y + 0.74, w: w - 0.32, h: 0.18, fontSize: 7, color: C.slate,
      })
    }
  })
}

function addBullets(
  slide: Slide,
  bullets: string[],
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize = 13
): void {
  const items = bullets.slice(0, 5)
  const lineH = h / Math.max(items.length, 1)
  items.forEach((bullet, i) => {
    const top = y + i * lineH
    slide.addShape('rect', {
      x: x + 0.02, y: top + 0.11, w: 0.09, h: 0.09,
      fill: { color: C.teal }, line: { color: C.teal, width: 0 },
    })
    addText(slide, bullet, {
      x: x + 0.24, y: top, w: w - 0.24, h: lineH - 0.06,
      fontSize, color: C.ink, fit: 'shrink', lineSpacingMultiple: 1.15,
    })
  })
}

function addCallout(slide: Slide, text: string | undefined, y = 6.18): void {
  if (!text) return
  slide.addShape('roundRect', {
    x: 0.7, y, w: 11.93, h: 0.62,
    fill: { color: C.goldSoft },
    line: { color: C.gold, width: 0.75 },
    rectRadius: 0.03,
  })
  addText(slide, text, {
    x: 0.9, y: y + 0.1, w: 11.5, h: 0.42,
    fontSize: 11, color: C.navy, bold: true, fit: 'shrink',
  })
}

function addColumns(
  slide: Slide,
  columns: NonNullable<SlideSpec['columns']>,
  y: number,
  h: number
): void {
  const items = columns.slice(0, 3)
  if (items.length === 0) return
  const gap = 0.2
  const totalW = 11.93
  const w = (totalW - gap * (items.length - 1)) / items.length
  items.forEach((col, i) => {
    const x = 0.7 + i * (w + gap)
    const fill = col.tone === 'negative' ? C.redSoft : col.tone === 'positive' ? C.tealSoft : C.white
    const headerColor = col.tone === 'negative' ? C.red : col.tone === 'positive' ? C.teal : C.navy
    slide.addShape('roundRect', {
      x, y, w, h,
      fill: { color: fill },
      line: { color: C.line, width: 0.75 },
      rectRadius: 0.04,
    })
    addText(slide, col.title, {
      x: x + 0.18, y: y + 0.14, w: w - 0.36, h: 0.32,
      fontSize: 11, bold: true, color: headerColor,
    })
    addText(slide, (col.items.length > 0 ? col.items : ['—']).slice(0, 5).join('\n'), {
      x: x + 0.18, y: y + 0.55, w: w - 0.36, h: h - 0.7,
      fontSize: 9.5, color: C.ink, fit: 'shrink', lineSpacingMultiple: 1.25,
    })
  })
}

function renderCover(slide: Slide, spec: SlideSpec): void {
  slide.background = { color: C.navy }
  slide.addShape('rect', {
    x: 0, y: 0, w: 0.16, h: 7.5, fill: { color: C.gold }, line: { color: C.gold, width: 0 },
  })
  addKicker(slide, spec.kicker, 1.7)
  addText(slide, spec.title, {
    x: 0.9, y: 2.15, w: 11.4, h: 1.5, fontSize: 40, bold: true, color: C.white, fit: 'shrink',
  })
  addGoldLine(slide, 0.9, 3.85, 1.6)
  if (spec.subtitle) {
    addText(slide, spec.subtitle, {
      x: 0.9, y: 4.12, w: 10.8, h: 0.5, fontSize: 15, color: 'D7DFE7', fit: 'shrink',
    })
  }
  if (spec.callout) {
    addText(slide, spec.callout, {
      x: 0.9, y: 5.7, w: 10.8, h: 0.4, fontSize: 10, color: C.gold,
    })
  }
}

function renderSection(slide: Slide, spec: SlideSpec): void {
  slide.background = { color: C.ivory }
  addText(slide, spec.sectionNo || '01', {
    x: 0.7, y: 2.0, w: 2.4, h: 1.4, fontSize: 72, bold: true, color: C.gold,
  })
  addText(slide, spec.title, {
    x: 3.0, y: 2.35, w: 9.2, h: 0.9, fontSize: 32, bold: true, color: C.navy, fit: 'shrink',
  })
  if (spec.subtitle) {
    addText(slide, spec.subtitle, {
      x: 3.02, y: 3.35, w: 8.8, h: 0.8, fontSize: 13, color: C.slate, fit: 'shrink',
    })
  }
  addGoldLine(slide, 3.02, 3.2, 1.4)
}

function renderContent(slide: Slide, spec: SlideSpec): void {
  slide.background = { color: C.ivory }
  addKicker(slide, spec.kicker)
  addTitle(slide, spec.title)
  addGoldLine(slide, 0.7, 1.72, 0.9)

  let contentY = 2.0
  if (spec.stats && spec.stats.length > 0) {
    addStatBoxes(slide, spec.stats, contentY)
    contentY += 1.18
  }

  if (spec.columns && spec.columns.length > 0) {
    addColumns(slide, spec.columns, contentY, spec.callout ? 3.85 : 4.4)
  } else if (spec.bullets && spec.bullets.length > 0) {
    addBullets(slide, spec.bullets, 0.7, contentY, 11.93, spec.callout ? 3.9 : 4.5)
  }

  addCallout(slide, spec.callout)
}

function buildPptx(spec: DeckSpec): PptxGenJS {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Investrask'
  pptx.company = 'Investrask'
  pptx.subject = spec.title
  pptx.title = spec.title

  for (const slideSpec of spec.slides) {
    const slide = pptx.addSlide()
    if (slideSpec.layout === 'cover') {
      renderCover(slide, slideSpec)
    } else if (slideSpec.layout === 'section') {
      renderSection(slide, slideSpec)
    } else {
      renderContent(slide, slideSpec)
    }
    addFooter(slide, slideSpec.footer, slideSpec.slideNo)
  }

  return pptx
}

/**
 * 生成 PPTX 并返回可访问 URL。
 * 已存在时直接返回，除非 force=true。
 */
export async function renderDeckPptx(deckId: string, force = false): Promise<string> {
  const deck = await prisma.dDSlideDeck.findUnique({ where: { id: deckId } })
  if (!deck) throw new Error('报告不存在')
  if (!deck.specJson) throw new Error('报告内容尚未生成')
  if (deck.pptxUrl && !force) return deck.pptxUrl

  const spec = JSON.parse(deck.specJson) as DeckSpec
  if (!Array.isArray(spec.slides) || spec.slides.length === 0) {
    throw new Error('报告内容为空')
  }

  const dir = join(process.cwd(), 'public', 'dd-decks')
  await mkdir(dir, { recursive: true })
  const fileName = `${deckId}.pptx`
  const filePath = join(dir, fileName)

  const pptx = buildPptx(spec)
  await pptx.writeFile({ fileName: filePath })

  const url = `/dd-decks/${fileName}`
  await prisma.dDSlideDeck.update({
    where: { id: deckId },
    data: { pptxUrl: url },
  })
  return url
}
