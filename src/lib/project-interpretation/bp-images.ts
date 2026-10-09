/**
 * BP 按页文本与关键页图片提取（项目解读 → 创建到项目库 的图文预填）
 *
 * - PDF：pdf-parse v2 按页提取文本（[第N页] 标记）+ getScreenshot 渲染整页 PNG
 * - PPTX：jszip 按 slide 提取文本（[第N页] 标记）+ slide 引用的内嵌 media 图片
 * - 其他格式（docx/xlsx/txt）：无页概念，返回 null（纯文字预填）
 *
 * 图片存储：public/interpretation-images/{key}-p{n}.png，URL /api/uploads/interpretation-images/...
 */

import { Buffer } from 'buffer'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

const IMAGES_DIR = join(process.cwd(), 'public', 'interpretation-images')
const IMAGES_URL_PREFIX = '/api/uploads/interpretation-images'

/** 从解读记录 fileUrl 提取本地文件名（防路径穿越，与 create-project 同口径） */
export function bpLocalPath(fileUrl: string): string | null {
  const m = fileUrl.match(/^\/api\/uploads\/interpretation-docs\/([A-Za-z0-9._-]+)$/)
  return m ? join(process.cwd(), 'public', 'interpretation-docs', m[1]) : null
}

/**
 * 按页提取 BP 文本（带 [第N页] 标记，供 AI 标注 keyPages）
 * 返回 null 表示该格式无页概念（调用方回退全文）
 */
export async function buildPagedBpText(buffer: Buffer, fileName: string): Promise<string | null> {
  const ext = fileName.toLowerCase().split('.').pop() || ''

  if (ext === 'pdf') {
    try {
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: buffer })
      try {
        const result = await parser.getText()
        if (!result.pages || result.pages.length === 0) return null
        return result.pages
          .map(p => `[第${p.num}页]\n${(p.text || '').trim()}`)
          .join('\n\n')
      } finally {
        await parser.destroy().catch(() => {})
      }
    } catch {
      return null
    }
  }

  if (ext === 'pptx') {
    try {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(buffer)
      const slideFiles = Object.keys(zip.files)
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => {
          const na = parseInt(a.match(/slide(\d+)/)?.[1] || '0', 10)
          const nb = parseInt(b.match(/slide(\d+)/)?.[1] || '0', 10)
          return na - nb
        })
      const parts: string[] = []
      for (let i = 0; i < slideFiles.length; i++) {
        const content = await zip.files[slideFiles[i]].async('string')
        const matches = content.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || []
        const texts = matches.map(m => m.replace(/<[^>]+>/g, '')).filter(t => t.trim())
        if (texts.length > 0) {
          parts.push(`[第${i + 1}页]\n${texts.join('\n')}`)
        }
      }
      return parts.length > 0 ? parts.join('\n\n') : null
    } catch {
      return null
    }
  }

  return null
}

/**
 * 提取 BP 关键页图片：
 * - PDF：渲染整页为 PNG（保真呈现 BP 版式：流程图/表格/照片）
 * - PPTX：提取对应 slide 引用的内嵌 media 图片（过滤 <10KB 小图标）
 * key 为唯一前缀（解读记录 id），同名文件覆盖（重试不堆积）
 * 返回 [{ page, url }]；失败/无图返回空数组
 */
export async function extractBpPageImages(
  buffer: Buffer,
  fileName: string,
  pageNums: number[],
  key: string
): Promise<Array<{ page: number; url: string }>> {
  if (pageNums.length === 0) return []
  const ext = fileName.toLowerCase().split('.').pop() || ''

  try {
    if (ext === 'pdf') {
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: buffer })
      try {
        const result = await parser.getScreenshot({ partial: pageNums, imageDataUrl: true })
        if (!result.pages || result.pages.length === 0) return []
        await mkdir(IMAGES_DIR, { recursive: true })
        const out: Array<{ page: number; url: string }> = []
        for (const shot of result.pages) {
          const dataUrl = shot.dataUrl || ''
          const base64 = dataUrl.split(',')[1]
          if (!base64) continue
          const name = `${key}-p${shot.pageNumber}.png`
          await writeFile(join(IMAGES_DIR, name), Buffer.from(base64, 'base64'))
          out.push({ page: shot.pageNumber, url: `${IMAGES_URL_PREFIX}/${name}` })
        }
        return out
      } finally {
        await parser.destroy().catch(() => {})
      }
    }

    if (ext === 'pptx') {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(buffer)
      await mkdir(IMAGES_DIR, { recursive: true })
      const out: Array<{ page: number; url: string }> = []
      let seq = 0
      for (const pageNum of pageNums) {
        const slidePath = `ppt/slides/slide${pageNum}.xml`
        const relsPath = `ppt/slides/_rels/slide${pageNum}.xml.rels`
        if (!zip.files[slidePath] || !zip.files[relsPath]) continue
        const slideXml = await zip.files[slidePath].async('string')
        const relsXml = await zip.files[relsPath].async('string')
        // slide 引用的图片 rId → rels 解析 media 路径
        const rIds = Array.from(slideXml.matchAll(/r:embed="(rId\d+)"/g)).map(m => m[1])
        for (const rId of rIds) {
          const rel = relsXml.match(new RegExp(`Id="${rId}"[^>]*Target="([^"]+)"`))
          if (!rel) continue
          const mediaPath = rel[1].replace(/^\.\.\//, 'ppt/')
          const file = zip.files[mediaPath]
          if (!file || !/\.(png|jpe?g|gif)$/i.test(mediaPath)) continue
          const data = await file.async('nodebuffer')
          if (data.length < 10 * 1024) continue // 过滤小图标/装饰元素
          seq++
          const ext2 = mediaPath.split('.').pop() || 'png'
          const name = `${key}-p${pageNum}-${seq}.${ext2}`
          await writeFile(join(IMAGES_DIR, name), data)
          if (!out.some(o => o.page === pageNum)) {
            out.push({ page: pageNum, url: `${IMAGES_URL_PREFIX}/${name}` })
          } else {
            // 同页多图：URL 顺序拼接（页码去重，url 用 ; 连接便于后续展开）
            const hit = out.find(o => o.page === pageNum)!
            hit.url = `${hit.url};${IMAGES_URL_PREFIX}/${name}`
          }
        }
      }
      return out
    }
  } catch (error) {
    console.error('BP page image extraction failed:', error)
    return []
  }
  return []
}
