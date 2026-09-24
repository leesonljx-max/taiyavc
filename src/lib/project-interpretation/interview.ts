/**
 * 访谈纪要内容解析（上传与批量校验共用）
 *
 * 三通道：文档（自动提取文本）/ 音频（留档，需配合粘贴转写）/ 直接粘贴文本
 * 音频无转写时返回 needTranscript=true（文件已保存，由调用方决定提示与持久化）
 */

import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { extractTextFromFile } from '@/lib/document-extract'
import {
  PI_INTERVIEW_MAX_SIZE,
  PI_INTERVIEW_AUDIO_EXTENSIONS,
  PI_INTERVIEW_DOC_EXTENSIONS,
  fileExt,
} from './constants'

const UPLOAD_DIR = join(process.cwd(), 'public', 'interpretation-docs')

export interface ParsedInterview {
  /** 访谈全文（文档提取或粘贴；音频无转写时为空） */
  text: string
  fileName: string | null
  fileUrl: string | null
  /** 音频已留档但缺少转写文本 */
  needTranscript: boolean
  error?: string
}

/**
 * 解析访谈来源并保存文件
 * @param file 上传的访谈文件（可空）
 * @param pastedText 粘贴的访谈文本（可空）
 */
export async function parseInterviewSource(
  file: File | null,
  pastedText: string
): Promise<ParsedInterview> {
  let text = pastedText.trim()
  let fileName: string | null = null
  let fileUrl: string | null = null

  if (file) {
    const ext = fileExt(file.name)
    const isAudio = PI_INTERVIEW_AUDIO_EXTENSIONS.includes(ext)
    const isDoc = PI_INTERVIEW_DOC_EXTENSIONS.includes(ext)
    if (!isAudio && !isDoc) {
      return {
        text,
        fileName: null,
        fileUrl: null,
        needTranscript: false,
        error: `不支持的访谈文件类型 .${ext}（支持音频 mp3/wav/m4a 或文档 pdf/docx/txt/pptx）`,
      }
    }
    if (file.size > PI_INTERVIEW_MAX_SIZE) {
      return { text, fileName: null, fileUrl: null, needTranscript: false, error: '访谈文件超过 50MB 限制' }
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    await mkdir(UPLOAD_DIR, { recursive: true })
    const uniqueName = `iv-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`
    await writeFile(join(UPLOAD_DIR, uniqueName), buffer)
    fileName = file.name
    fileUrl = `/api/uploads/interpretation-docs/${uniqueName}`

    if (isDoc) {
      if (ext === 'txt' || ext === 'md') {
        const docText = buffer.toString('utf8').trim()
        // 粘贴文本与文档内容都有时，拼接（粘贴的可能是音频转写补充）
        text = text ? `${text}\n${docText}` : docText
      } else {
        const docText = (await extractTextFromFile(buffer, file.name, file.type)).text
        if (docText) text = text ? `${text}\n${docText}` : docText
      }
    } else if (!text) {
      // 音频且无转写文本：留档，等待转写
      return { text: '', fileName, fileUrl, needTranscript: true }
    }
  }

  return { text, fileName, fileUrl, needTranscript: false }
}
