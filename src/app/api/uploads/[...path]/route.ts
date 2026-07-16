import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

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
}

// 只允许访问这三个目录
const ALLOWED_DIRS = new Set(['avatars', 'project-docs', 'project-images'])

export async function GET(
  _request: Request,
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

    // 检查文件是否存在
    if (!fs.existsSync(absolutePath)) {
      return new NextResponse('Not Found', { status: 404 })
    }

    const stat = fs.statSync(absolutePath)
    if (!stat.isFile()) {
      return new NextResponse('Not Found', { status: 404 })
    }

    const ext = path.extname(absolutePath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    const fileBuffer = fs.readFileSync(absolutePath)

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': stat.size.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.error('File access error:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
