/**
 * 文档文本提取工具库
 * 支持 PDF / Word(.docx) / Excel(.xlsx) / PPT(.pptx) 四种格式
 *
 * 用于投研分析模块：上传文档时提取文本，供 DeepSeek 分析
 */

import type { Buffer } from 'buffer'

export type SupportedFileType = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'unknown'

/** 最大提取文本长度（避免超大文档消耗过多 token） */
const MAX_EXTRACT_LENGTH = 30000

/**
 * 根据文件名或 MIME 类型判断支持的文件类型
 */
export function detectFileType(fileName: string, mimeType?: string): SupportedFileType {
  const ext = fileName.toLowerCase().split('.').pop() || ''
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf'
  if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (ext === 'xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx'
  if (ext === 'pptx' || mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx'
  return 'unknown'
}

/**
 * 提取 PDF 文本（使用 pdf-parse）
 */
async function extractPdf(buffer: Buffer): Promise<string> {
  // 动态 import 避免 Next.js 构建时加载
  const pdfParse = (await import('pdf-parse')).default
  const data = await pdfParse(buffer)
  return data.text || ''
}

/**
 * 提取 Word(.docx) 文本（使用 mammoth）
 */
async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  return result.value || ''
}

/**
 * 提取 Excel(.xlsx) 文本（使用 xlsx/SheetJS）
 * 逐 sheet 逐行转换为文本
 */
async function extractXlsx(buffer: Buffer): Promise<string> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const lines: string[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    lines.push(`【${sheetName}】`)
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1, defval: '' })
    for (const row of rows) {
      const cells = Object.values(row).map(c => String(c ?? '').trim())
      const line = cells.filter(c => c).join(' | ')
      if (line) lines.push(line)
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

  return lines.join('\n')
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
      case 'pdf':
        text = await extractPdf(buffer)
        break
      case 'docx':
        text = await extractDocx(buffer)
        break
      case 'xlsx':
        text = await extractXlsx(buffer)
        break
      case 'pptx':
        text = await extractPptx(buffer)
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

  return { text: text.trim(), fileType, truncated }
}

/**
 * 允许上传的文件扩展名白名单
 */
export const ALLOWED_RESEARCH_DOC_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.pptx']

/**
 * 允许上传的 MIME 类型白名单
 */
export const ALLOWED_RESEARCH_DOC_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
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
    return { valid: false, error: `不支持的文件类型: ${ext}，仅支持 PDF/Word/Excel/PPT` }
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
