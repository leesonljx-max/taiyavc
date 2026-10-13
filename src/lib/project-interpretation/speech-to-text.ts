/**
 * 访谈音频自动转写（MP3/m4a/wav 等访谈录音 → 文字）
 *
 * OpenAI 兼容 /audio/transcriptions 接口（multipart），.env 配置：
 * - ASR_API_KEY   必填启用（未配置时返回 null，保留"需粘贴文本"的旧行为）
 * - ASR_BASE_URL  默认 https://api.siliconflow.cn/v1（硅基流动，SenseVoice 便宜好用；
 *                 也兼容 OpenAI https://api.openai.com/v1 等）
 * - ASR_MODEL     默认 FunAudioLLM/SenseVoiceSmall（OpenAI 用 whisper-1）
 *
 * 转写文本直接作为访谈纪要参与批量校验（保留项目方原话细节，校验质量最优）
 */

import { Buffer } from 'buffer'

/** ASR 单文件大小上限（25MB，主流 /audio/transcriptions 接口限制） */
export const ASR_MAX_FILE_SIZE = 25 * 1024 * 1024

/** 是否已配置语音转写服务 */
export function isAsrConfigured(): boolean {
  return !!process.env.ASR_API_KEY
}

/**
 * 转写音频文件：成功返回文本，未配置/超限/失败返回 null（调用方降级提示）
 * 120s 超时（长录音转写耗时）
 */
export async function transcribeAudio(buffer: Buffer, fileName: string): Promise<string | null> {
  const apiKey = process.env.ASR_API_KEY
  if (!apiKey || buffer.length === 0 || buffer.length > ASR_MAX_FILE_SIZE) return null

  const baseUrl = (process.env.ASR_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/$/, '')
  const model = process.env.ASR_MODEL || 'FunAudioLLM/SenseVoiceSmall'

  // 构造 multipart/form-data（原生 FormData + Blob，Node 18+ 支持）
  const form = new FormData()
  const ext = fileName.toLowerCase().split('.').pop() || 'mp3'
  const mime =
    ext === 'wav' ? 'audio/wav'
      : ext === 'm4a' ? 'audio/mp4'
        : ext === 'flac' ? 'audio/flac'
          : ext === 'ogg' ? 'audio/ogg'
            : ext === 'webm' ? 'audio/webm'
              : 'audio/mpeg'
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), fileName || `audio.${ext}`)
  form.append('model', model)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120000)
  try {
    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error(`ASR transcribe failed: ${res.status} ${errText.slice(0, 200)}`)
      return null
    }
    const data = (await res.json()) as { text?: string }
    const text = (data.text || '').trim()
    return text.length > 0 ? text : null
  } catch (error) {
    console.error('ASR transcribe error:', error)
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}
