export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { writeFile, mkdir, unlink } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { isCosConfigured, uploadToCos, deleteFromCos } from '@/lib/cos'

/**
 * POST /api/user/avatar
 * 上传/更新当前登录用户的头像
 * 接收 FormData 格式，字段名 "file"
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
      return NextResponse.json({ error: '请选择头像图片' }, { status: 400 })
    }

    // 校验文件类型并提取安全扩展名（白名单校验，不使用客户端提供的扩展名）
    const allowedTypes: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
    }
    // 白名单校验：仅允许以下图片类型（SVG 已剔除以防止 XSS）

    const ext = allowedTypes[file.type]
    if (!ext) {
      return NextResponse.json({ error: '不支持的文件类型，仅支持 JPG/PNG/GIF/WebP' }, { status: 400 })
    }

    // 校验文件大小（最大 2MB）
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: '头像图片不能超过 2MB' }, { status: 400 })
    }

    // 生成随机文件名：{userId}-{uuid}.{ext}
    const fileName = `${session.user.id}-${randomUUID()}.${ext}`

    // 读取文件内容
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // 查询旧头像用于后续清理
    const oldUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { avatar: true },
    })

    // 上传：COS 优先，本地存储 fallback
    let avatarUrl: string
    if (isCosConfigured()) {
      const cosKey = `avatars/${fileName}`
      const cosUrl = await uploadToCos(buffer, cosKey, file.type)
      if (!cosUrl) throw new Error('COS 上传失败')
      avatarUrl = cosUrl
    } else {
      // 本地存储 fallback
      const uploadDir = path.join(process.cwd(), 'public', 'avatars')
      await mkdir(uploadDir, { recursive: true })
      const filePath = path.join(uploadDir, fileName)
      await writeFile(filePath, buffer)
      avatarUrl = `/avatars/${fileName}`
    }

    // 更新数据库
    await prisma.user.update({
      where: { id: session.user.id },
      data: { avatar: avatarUrl },
    })

    // 清理旧头像文件
    if (oldUser?.avatar) {
      if (oldUser.avatar.startsWith('/avatars/')) {
        const oldFileName = path.basename(oldUser.avatar)
        const oldFilePath = path.join(process.cwd(), 'public', 'avatars', oldFileName)
        await unlink(oldFilePath).catch(() => {})
      } else if (oldUser.avatar.includes('myqcloud.com')) {
        const oldKey = oldUser.avatar.split('.myqcloud.com/')[1]
        if (oldKey) await deleteFromCos(oldKey).catch(() => {})
      }
    }

    return NextResponse.json({ avatar: avatarUrl })
  } catch (error) {
    console.error('Avatar upload error:', error)
    return NextResponse.json({ error: '头像上传失败' }, { status: 500 })
  }
}
