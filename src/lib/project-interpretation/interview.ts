/**
 * 访谈纪要内容解析（上传与批量校验共用）
 *
 * 三通道：文档（自动提取文本）/ 音频（自动转写，需服务器配置 ASR；无配置时留档待粘贴）/ 直接粘贴文本
 * 音频无转写时返回 needTranscript=true（文件已保存，由调用方决定提示与持久化）
 */

import { writeFile, mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { extractTextFromFile } from '@/lib/document-extract'
import { transcribeAudio, isAsrConfigured, ASR_MAX_FILE_SIZE } from './speech-to-text'
import {
  PI_INTERVIEW_MAX_SIZE,
  PI_INTERVIEW_AUDIO_EXTENSIONS,
  PI_INTERVIEW_DOC_EXTENSIONS,
  fileExt,
} from './constants'

const UPLOAD_DIR = join(process.cwd(), 'public', 'interpretation-docs')

export interface ParsedInterview {
  /** 访谈全文（文档提取/音频自动转写/粘贴） */
  text: string
  fileName: string | null
  fileUrl: string | null
  /** 音频已留档但缺少转写文本（未配置 ASR 或转写失败） */
  needTranscript: boolean
  /** 自动转写不可用的具体原因（调用方据此给出针对性提示） */
  needTranscriptReason?: 'NOT_CONFIGURED' | 'FILE_TOO_LARGE' | 'TRANSCRIBE_FAILED'
  /** 本次由音频自动转写生成（前端提示"已自动转写"） */
  autoTranscribed?: boolean
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
      // 音频且无粘贴文本：尝试自动转写（ASR 已配置时，转写文本直接作为访谈纪要参与校验）
      if (isAsrConfigured()) {
        // 转写接口单文件 25MB 上限：超限明确提示（而非笼统的"转写失败"）
        if (buffer.length > ASR_MAX_FILE_SIZE) {
          return {
            text: '',
            fileName,
            fileUrl,
            needTranscript: true,
            needTranscriptReason: 'FILE_TOO_LARGE',
          }
        }
        const transcript = await transcribeAudio(buffer, file.name)
        if (transcript && transcript.length > 0) {
          return { text: transcript, fileName, fileUrl, needTranscript: false, autoTranscribed: true }
        }
        // 已配置但转写失败（网络/密钥/音频格式问题）
        return { text: '', fileName, fileUrl, needTranscript: true, needTranscriptReason: 'TRANSCRIBE_FAILED' }
      }
      // 未配置 ASR：留档，等待粘贴文本
      return { text: '', fileName, fileUrl, needTranscript: true, needTranscriptReason: 'NOT_CONFIGURED' }
    }
  }

  return { text, fileName, fileUrl, needTranscript: false }
}

/** 从留档音频文件路径重新转写（verify 兜底：上传时未转写成功、后续配置了 ASR 的场景） */
export async function transcribeSavedAudio(fileUrl: string): Promise<string | null> {
  const m = fileUrl.match(/^\/api\/uploads\/interpretation-docs\/([A-Za-z0-9._-]+)$/)
  if (!m) return null
  try {
    const buffer = await readFile(join(UPLOAD_DIR, m[1]))
    return await transcribeAudio(buffer, m[1])
  } catch {
    return null
  }
}
