import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

/**
 * POST /api/user/avatar
 * 上传/更新当前登录用户的头像
 * 接收 FormData 格式，字段名 "file"
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: '请选择头像图片' }, { status: 400 })
    }

    // 校验文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: '仅支持 JPG/PNG/GIF/WebP/SVG 格式' }, { status: 400 })
    }

    // 校验文件大小（最大 2MB）
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: '头像图片不能超过 2MB' }, { status: 400 })
    }

    // 生成文件名：{userId}.{ext}
    const ext = file.name.split('.').pop() || 'png'
    const fileName = `${session.user.id}.${ext}`
    const uploadDir = path.join(process.cwd(), 'public', 'avatars')

    // 确保目录存在
    await mkdir(uploadDir, { recursive: true })

    // 写入文件
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const filePath = path.join(uploadDir, fileName)
    await writeFile(filePath, buffer)

    // 更新数据库
    const avatarUrl = `/avatars/${fileName}`
    await prisma.user.update({
      where: { id: session.user.id },
      data: { avatar: avatarUrl },
    })

    return NextResponse.json({ avatar: avatarUrl })
  } catch (error) {
    return NextResponse.json(
      { error: '头像上传失败', detail: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    )
  }
}
