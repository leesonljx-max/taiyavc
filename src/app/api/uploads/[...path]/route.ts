import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'

export const dynamic = 'force-dynamic'

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
}

// 只允许访问这些目录
const ALLOWED_DIRS = new Set([
  'avatars',
  'project-docs',
  'project-images',
  'research-docs',
  'dd-unclassified',
  'interpretation-docs',
  'interpretation-images',
  'post-investment-docs',
  'post-investment-thumbs',
])

/**
 * 文件服务（流式 + Range）
 * - 用 createReadStream 代替 readFileSync：读大文件时不再阻塞 Node 事件循环
 * - 支持 Range（PDF 预览可分段加载，拖动进度条不用整文件重下）
 */
export async function GET(
  request: Request,
  { params }: { params: { path: string[] } }
) {
  try {
    // 参数安全检查
    if (!params.path || params.path.length < 2) {
      return new NextResponse('Not Found', { status: 404 })
    }

    const dir = params.path[0]
    if (!ALLOWED_DIRS.has(dir)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    // 防止路径遍历攻击
    const filePath = params.path.join('/')
    if (filePath.includes('..')) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const absolutePath = path.join(process.cwd(), 'public', filePath)

    let stat: fs.Stats
    try {
      stat = await fs.promises.stat(absolutePath)
    } catch {
      return new NextResponse('Not Found', { status: 404 })
    }
    if (!stat.isFile()) {
      return new NextResponse('Not Found', { status: 404 })
    }

    const ext = path.extname(absolutePath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    const baseHeaders = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
    }

    // Range 请求：bytes=start-end / bytes=start- / bytes=-suffix
    const rangeHeader = request.headers.get('range')
    const match = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/)
    if (match) {
      const hasStart = match[1] !== ''
      const hasEnd = match[2] !== ''
      let start = hasStart ? Number(match[1]) : 0
      let end = hasEnd ? Number(match[2]) : stat.size - 1

      // 后缀范围：bytes=-N 表示最后 N 字节
      if (!hasStart && hasEnd) {
        const suffixLength = Number(match[2])
        start = Math.max(0, stat.size - suffixLength)
        end = stat.size - 1
      }

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        start >= stat.size ||
        end < start
      ) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes' },
        })
      }
      end = Math.min(end, stat.size - 1)

      const stream = fs.createReadStream(absolutePath, { start, end })
      return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': String(end - start + 1),
        },
      })
    }

    const stream = fs.createReadStream(absolutePath)
    return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': String(stat.size),
      },
    })
  } catch (error) {
    console.error('File access error:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
