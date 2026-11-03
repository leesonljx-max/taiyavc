/**
 * 文档文本提取工具库
 * 支持 PDF / Word(.docx) / Excel(.xlsx/.xls) / PPT(.pptx) / 图片；扫描件与图片自动 OCR
 *
 * 用于投研分析模块：上传文档时提取文本，供 DeepSeek 分析
 */

import type { Buffer } from 'buffer'
import { DEEPSEEK_MODEL } from '@/lib/deepseek-model'

export type SupportedFileType = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'unknown'

/** 最大提取文本长度（避免超大文档消耗过多 token；Excel 多工作表/多表需完整提取） */
const MAX_EXTRACT_LENGTH = 60000

/**
 * 剔除 NUL 字节（\u0000）
 * PostgreSQL 的 text 类型不接受 0x00（报 22021 invalid byte sequence for encoding "UTF8"），
 * PDF 提取（pdf.js 解析部分字体/CMap）与部分网页正文会带出该字符，写入数据库前必须清除。
 */
export function stripNul(s: string): string {
  return s.replace(/\u0000/g, '')
}

/**
 * 根据文件名或 MIME 类型判断支持的文件类型
 */
export function detectFileType(fileName: string, mimeType?: string): SupportedFileType {
  const ext = fileName.toLowerCase().split('.').pop() || ''
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf'
  if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') return 'xlsx'
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'application/vnd.ms-excel.sheet.macroEnabled.12'
  ) return 'xlsx'
  if (ext === 'pptx' || mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx'
  if (IMAGE_MIME_BY_EXT[ext]) return 'image'
  if (mimeType && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType)) return 'image'
  return 'unknown'
}

/**
 * 提取 PDF 文本（使用 pdf-parse）
 * 返回文本与页数（页数用于判断是否为扫描件：文字过少时走 OCR）
 */
async function extractPdf(buffer: Buffer): Promise<{ text: string; total: number }> {
  // 动态 import 避免 Next.js 构建时加载
  // 注意：pdf-parse v2 API 变更为 PDFParse 类
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return { text: result.text || '', total: result.total || 0 }
  } finally {
    await parser.destroy().catch(() => {})
  }
}

/** 单次多模态请求携带的页数/图片数（仅分批，不限制总量） */
const OCR_PAGES_PER_CALL = 3
/** PDF 每块渲染页数（仅控制内存峰值，不限制总页数） */
const PDF_RENDER_CHUNK = 6

/** 文字过少的 PDF 视为扫描件（平均每页文字 < 40 且总量 < 60 时触发 OCR） */
export function shouldOcrPdf(text: string, pageCount: number): boolean {
  if (pageCount <= 0) return false
  const chars = (text || '').replace(/\s+/g, '').length
  return chars < Math.max(60, pageCount * 40)
}

const OCR_SYSTEM_PROMPT = `你是专业的文档 OCR 引擎。用户提供文档页面或图片，请完整转录其中的文字与表格。
要求：
1. 表格必须保留行列结构：同一行的单元格用 | 分隔，表头与数值一一对应
2. 数字、百分比、单位与原文完全一致，禁止四舍五入、改写、推算或补全
3. 印章、手写批注、页眉页脚也尽量转录
4. 多页文档每页以[第N页]开头（使用文档绝对页码）；只输出转录文本，不要总结、不要解释`

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** 图片扩展名 / MIME 标准化 */
function imageMimeType(fileName: string, mimeType?: string): string | null {
  if (mimeType && mimeType.startsWith('image/')) return mimeType
  const ext = fileName.toLowerCase().split('.').pop() || ''
  return IMAGE_MIME_BY_EXT[ext] || null
}

/**
 * 调用多模态模型转录图片
 * 无 API Key / 请求失败时返回空字符串（不影响上传）
 */
async function callOcrModel(imageUrls: string[], instruction: string, maxTokens = 8000): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey || imageUrls.length === 0) return ''

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120000)
    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: 'system', content: OCR_SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: instruction },
                ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } })),
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: maxTokens,
          thinking: { type: 'disabled' },
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw new Error(`${response.status} ${errText.slice(0, 150)}`)
      }
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
      return (data.choices?.[0]?.message?.content || '').trim()
    } catch (error) {
      if (attempt === 2) {
        console.error('OCR 识别失败（已重试）:', error)
        return ''
      }
      // 503/超时等临时故障：等待后重试一次
      console.warn(`OCR 识别失败，${attempt === 1 ? '2 秒后重试' : ''}:`, error)
      await new Promise(resolve => setTimeout(resolve, 2000))
    } finally {
      clearTimeout(timeoutId)
    }
  }
  return ''
}

/**
 * 扫描版 PDF OCR：把全部页面渲染成图片，分批调用多模态模型逐页转录
 * 仅在提取不到文字时触发；无 API Key 或渲染失败时返回空字符串（不影响上传）
 */
async function ocrScannedPdf(buffer: Buffer, pageCount: number): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: buffer })
  const textParts: string[] = []
  try {
    // 分块渲染（每块 6 页）避免一次性生成大量图片占满内存；分块不是页数上限
    for (let chunkStart = 1; chunkStart <= pageCount; chunkStart += PDF_RENDER_CHUNK) {
      const chunkEnd = Math.min(chunkStart + PDF_RENDER_CHUNK - 1, pageCount)
      const pageNumbers: number[] = []
      for (let p = chunkStart; p <= chunkEnd; p++) pageNumbers.push(p)

      const shot = await parser.getScreenshot({
        partial: pageNumbers,
        desiredWidth: 1400,
        imageDataUrl: true,
        imageBuffer: false,
      })
      const pageUrls = shot.pages.map(page => page.dataUrl).filter((url): url is string => Boolean(url))

      for (let i = 0; i < pageUrls.length; i += OCR_PAGES_PER_CALL) {
        const batch = pageUrls.slice(i, i + OCR_PAGES_PER_CALL)
        const firstPage = chunkStart + i
        const lastPage = firstPage + batch.length - 1
        const text = await callOcrModel(
          batch,
          `请完整转录第 ${firstPage}-${lastPage} 页（按顺序逐页输出，使用绝对页码，保留表格行列）。`
        )
        if (text) textParts.push(text)
      }
    }
  } catch (error) {
    console.error('PDF 页面渲染/OCR 失败:', error)
  } finally {
    await parser.destroy().catch(() => {})
  }

  return textParts.join('\n\n')
}

/** 扫描版 PDF OCR（供 BP 按页预填等场景复用） */
export async function ocrPdfPagedText(buffer: Buffer, pageCount: number): Promise<string> {
  return ocrScannedPdf(buffer, pageCount)
}

/** 单张图片 OCR */
async function ocrImage(buffer: Buffer, fileName: string, mimeType?: string): Promise<string> {
  const mime = imageMimeType(fileName, mimeType)
  if (!mime) return ''
  return callOcrModel(
    [`data:${mime};base64,${buffer.toString('base64')}`],
    '请完整转录这张图片中的全部文字与表格（保留表格行列，数字与单位保持原文）。'
  )
}

/**
 * Office 文件内嵌图片 OCR（Word/PPT 里整页截图、扫描图片）
 * 过滤 <10KB 的图标/装饰元素（噪音），正文图片全部识别
 */
async function ocrZipMediaImages(buffer: Buffer, mediaRegex: RegExp): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)
  const imageUrls: string[] = []
  const names = Object.keys(zip.files).filter(name => mediaRegex.test(name)).sort()
  for (const name of names) {
    const mime = imageMimeType(name)
    if (!mime) continue
    const data = await zip.files[name].async('nodebuffer')
    if (data.length < 10 * 1024) continue
    imageUrls.push(`data:${mime};base64,${data.toString('base64')}`)
  }
  if (imageUrls.length === 0) return ''

  const parts: string[] = []
  for (let i = 0; i < imageUrls.length; i += OCR_PAGES_PER_CALL) {
    const batch = imageUrls.slice(i, i + OCR_PAGES_PER_CALL)
    const text = await callOcrModel(
      batch,
      `请逐张完整转录以下第 ${i + 1}-${i + batch.length} 张图片中的文字与表格（保留行列结构，数字与单位保持原文）。`
    )
    if (text) parts.push(text)
  }
  return parts.join('\n\n')
}

/**
 * 提取 Word(.docx) 文本（使用 mammoth）
 */
async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  const text = result.value || ''
  // 纯截图/扫描图片的 Word：正文文字极少时 OCR 内嵌图片
  if (text.replace(/\s/g, '').length < 100) {
    const ocr = await ocrZipMediaImages(buffer, /^word\/media\//)
    if (ocr) return text.trim() ? `${text}\n\n${ocr}` : ocr
  }
  return text
}

/**
 * 提取 Excel(.xlsx) 文本（使用 xlsx/SheetJS）
 * 逐个工作表、逐行转换为文本；保留空列/空行以维持表格结构：
 * - 同一工作表内可能有多张表（空行分隔），空行保留为分隔线
 * - 使用 Excel 显示格式（raw:false），日期/百分比/千分位与用户看到的原表一致
 */
async function extractXlsx(buffer: Buffer): Promise<string> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const lines: string[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    lines.push(`【工作表：${sheetName}】`)
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: true,
    })
    for (const row of rows) {
      const cells = (row || []).map(c => String(c ?? '').replace(/\s+/g, ' ').trim())
      // 去掉行尾空列，保留中间空列（列位置不塌陷，便于 AI 对齐「标签 → 数值」）
      while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
      lines.push(cells.join('\t'))
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 提取 PPT(.pptx) 文本（使用 jszip 解析 XML）
 * PPTX 是 ZIP 包，幻灯片文本在 ppt/slides/slideN.xml 的 <a:t> 标签内
 */
async function extractPptx(buffer: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)
  const lines: string[] = []

  // 找到所有 slide 文件并按序号排序
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)?.[1] || '0', 10)
      const nb = parseInt(b.match(/slide(\d+)/)?.[1] || '0', 10)
      return na - nb
    })

  for (let i = 0; i < slideFiles.length; i++) {
    const fileName = slideFiles[i]
    const content = await zip.files[fileName].async('string')
    // 提取 <a:t>...</a:t> 标签内的文本
    const matches = content.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || []
    const texts = matches
      .map(m => m.replace(/<[^>]+>/g, ''))
      .filter(t => t.trim())

    if (texts.length > 0) {
      lines.push(`【第 ${i + 1} 页】`)
      lines.push(texts.join('\n'))
      lines.push('')
    }
  }

  const plain = lines.join('\n')
  // 图片型 BP/PPT：文字极少时 OCR 内嵌图片
  if (slideFiles.length > 0 && plain.replace(/\s/g, '').length < slideFiles.length * 20) {
    const ocr = await ocrZipMediaImages(buffer, /^ppt\/media\//)
    if (ocr) return plain.trim() ? `${plain}\n\n${ocr}` : ocr
  }
  return plain
}

/**
 * 主入口：从文件 Buffer 提取文本
 * @param buffer 文件内容
 * @param fileName 文件名（用于判断类型）
 * @param mimeType MIME 类型（可选）
 * @returns 提取的文本（截断至 MAX_EXTRACT_LENGTH）
 */
export async function extractTextFromFile(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): Promise<{ text: string; fileType: SupportedFileType; truncated: boolean }> {
  const fileType = detectFileType(fileName, mimeType)
  let text = ''

  try {
    switch (fileType) {
      case 'pdf': {
        const pdf = await extractPdf(buffer)
        text = pdf.text
        // 扫描版 PDF：无文字层 → 渲染页面图片后 OCR
        if (shouldOcrPdf(pdf.text, pdf.total)) {
          // OCR 失败时置空，避免把 pdf-parse 的页码占位符当成正文
          text = await ocrScannedPdf(buffer, pdf.total)
        }
        break
      }
      case 'docx':
        text = await extractDocx(buffer)
        break
      case 'xlsx':
        text = await extractXlsx(buffer)
        break
      case 'pptx':
        text = await extractPptx(buffer)
        break
      case 'image':
        text = await ocrImage(buffer, fileName, mimeType)
        break
      default:
        text = ''
    }
  } catch (error) {
    console.error(`Document extraction failed for ${fileName}:`, error)
    text = ''
  }

  const truncated = text.length > MAX_EXTRACT_LENGTH
  if (truncated) {
    text = text.substring(0, MAX_EXTRACT_LENGTH)
  }

  return { text: stripNul(text).trim(), fileType, truncated }
}

/**
 * 允许上传的文件扩展名白名单
 */
export const ALLOWED_RESEARCH_DOC_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg', '.webp', '.gif']

/**
 * 允许上传的 MIME 类型白名单
 */
export const ALLOWED_RESEARCH_DOC_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]

/**
 * 最大文件大小：50MB
 */
export const MAX_RESEARCH_DOC_SIZE = 50 * 1024 * 1024

/**
 * 验证文件是否允许上传
 */
export function validateResearchDoc(fileName: string, fileSize: number, mimeType?: string): {
  valid: boolean
  error?: string
} {
  const ext = '.' + (fileName.toLowerCase().split('.').pop() || '')
  if (!ALLOWED_RESEARCH_DOC_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `不支持的文件类型: ${ext}，仅支持 PDF/Word/Excel/PPT/图片` }
  }
  if (fileSize > MAX_RESEARCH_DOC_SIZE) {
    return { valid: false, error: '文件大小超过 50MB 限制' }
  }
  if (mimeType && !ALLOWED_RESEARCH_DOC_MIME_TYPES.includes(mimeType)) {
    // MIME 类型不一致时仅警告，不拒绝（某些系统 MIME 类型可能不准确）
    console.warn(`MIME type mismatch for ${fileName}: ${mimeType}`)
  }
  return { valid: true }
}
