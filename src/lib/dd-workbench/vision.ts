/**
 * 多模态视觉工具：从富文本文本框提取粘贴的截图 → [图N] 占位 + base64 data URI
 * DeepSeek chat/completions 支持 content 数组格式的 image_url 输入（png/jpeg/webp/gif）
 *
 * 用于：尽调报告生成、团队评价成员识别、评分审校 —— 让模型"看懂"文本框里粘贴的截图
 */

import { readFile } from 'fs/promises'
import { join } from 'path'

/** 每次调用允许进入模型的图片上限（控制 token 与时长） */
export const MAX_IMAGES_PER_CALL = 6
/** 单图大小上限（compressImage 压缩后的截图通常远小于此值） */
export const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024

export interface ExtractedImage {
  /** 占位标记（图1、图2…，与文本中的 [图N] 对应） */
  marker: string
  /** 前端展示地址（/api/uploads/project-images/xxx.png） */
  src: string
  /** 模型输入用 data URI（文件缺失/超限时为空） */
  dataUri?: string
}

export type ChatMessageContent = Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
>

/** 仅匹配带 src 的 img 标签（提取与占位替换共用，保证编号一一对应）；限定本站路径防外链 */
const IMG_RE = /<img[^>]+src=["'](\/(?:api\/uploads\/)?[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+)["'][^>]*>/gi

/**
 * 处理模块文本框：img → [图N] 占位（保持出现位置），其余标签剥除
 * 返回带占位的纯文本 + 图片列表（含 data URI）
 */
export async function buildMultimodalDigest(textBlocks: Array<{ content: string }>): Promise<{
  plain: string
  images: ExtractedImage[]
}> {
  const lines: string[] = []
  let imgCount = 0
  for (const t of textBlocks) {
    if (!t.content || !t.content.trim()) continue
    const html = t.content.replace(IMG_RE, (_match, src: string) => {
      imgCount++
      return imgCount <= MAX_IMAGES_PER_CALL ? `[图${imgCount}]` : '（截图）'
    })
    lines.push(html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim())
  }

  const images: ExtractedImage[] = []
  if (imgCount > 0) {
    const srcs: string[] = []
    for (const t of textBlocks) {
      if (!t.content) continue
      let m: RegExpExecArray | null
      IMG_RE.lastIndex = 0
      while ((m = IMG_RE.exec(t.content))) srcs.push(m[1])
    }
    for (let i = 0; i < srcs.length && i < MAX_IMAGES_PER_CALL; i++) {
      images.push({ marker: `图${i + 1}`, src: srcs[i], dataUri: await toDataUri(srcs[i]) })
    }
  }
  return { plain: lines.join('\n'), images }
}

/** 读取本地图片为 data URI（文件缺失/超大返回 null） */
async function toDataUri(src: string): Promise<string | undefined> {
  try {
    const m = src.match(/^\/(?:api\/uploads\/)?\/?([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+)$/)
    if (!m) return undefined
    const buf = await readFile(join(process.cwd(), 'public', m[1], m[2]))
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return undefined
    const ext = m[2].toLowerCase().split('.').pop()
    const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

/**
 * 组装多模态消息 content：文本 + 图片（data URI）
 * 无可用图片时返回纯文本字符串（与普通调用格式一致）
 */
export function buildMessageContent(text: string, images: ExtractedImage[]): string | ChatMessageContent {
  const withUri = images.filter(i => i.dataUri)
  if (withUri.length === 0) return text
  const parts: ChatMessageContent = [
    {
      type: 'text',
      text: `${text}\n\n（随附 ${withUri.length} 张文本框截图：${withUri.map(i => `[${i.marker}]`).join('、')}，已按图片原样提供给你，请结合图片内容理解与分析）`,
    },
  ]
  for (const img of withUri) {
    parts.push({ type: 'image_url', image_url: { url: img.dataUri! } })
  }
  return parts
}
