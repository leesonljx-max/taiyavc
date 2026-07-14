import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { isCosConfigured, uploadToCos } from '@/lib/cos'

/**
 * POST /api/upload/image
 * 上传富文本编辑器中粘贴的图片（项目字段截图）
 * 接收 FormData 格式，字段名 "file"
 * 返回 { url: string }
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    if (!session.user.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: '请选择图片' }, { status: 400 })
    }

    // 校验文件类型并提取安全扩展名（白名单校验）
    const allowedTypes: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
    }

    const ext = allowedTypes[file.type]
    if (!ext) {
      return NextResponse.json({ error: '不支持的文件类型，仅支持 JPG/PNG/GIF/WebP' }, { status: 400 })
    }

    // 校验文件大小（最大 5MB，截图通常较大）
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: '图片不能超过 5MB' }, { status: 400 })
    }

    // 生成随机文件名
    const fileName = `${session.user.id}-${randomUUID()}.${ext}`

    // 读取文件内容
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // 上传：COS 优先，本地存储 fallback
    let imageUrl: string
    if (isCosConfigured()) {
      const cosKey = `project-images/${fileName}`
      const cosUrl = await uploadToCos(buffer, cosKey, file.type)
      if (!cosUrl) throw new Error('COS 上传失败')
      imageUrl = cosUrl
    } else {
      // 本地存储 fallback
      const uploadDir = path.join(process.cwd(), 'public', 'project-images')
      await mkdir(uploadDir, { recursive: true })
      const filePath = path.join(uploadDir, fileName)
      await writeFile(filePath, buffer)
      imageUrl = `/project-images/${fileName}`
    }

    return NextResponse.json({ url: imageUrl })
  } catch (error) {
    console.error('Image upload error:', error)
    return NextResponse.json({ error: '图片上传失败' }, { status: 500 })
  }
}
