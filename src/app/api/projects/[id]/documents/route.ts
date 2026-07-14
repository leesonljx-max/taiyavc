import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import { canViewProject, canEditProject, type PermissionUser } from '@/lib/permissions'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { isCosConfigured, uploadToCos } from '@/lib/cos'

/**
 * GET /api/projects/[id]/documents
 * 获取项目文档列表（需要 canViewProject 权限）
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    if (!session.user.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: { members: { select: { userId: true } } },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    const memberIds = project.members.map(m => m.userId)
    if (!canViewProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })) {
      return NextResponse.json({ error: '无权查看该项目' }, { status: 403 })
    }

    const documents = await prisma.projectDocument.findMany({
      where: { projectId: params.id },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({
      documents: documents.map(doc => ({
        id: doc.id,
        fileName: doc.fileName,
        fileUrl: doc.fileUrl,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        createdAt: doc.createdAt,
        uploadedBy: doc.uploadedBy,
      })),
    })
  } catch (error) {
    console.error('Get project documents error:', error)
    return NextResponse.json({ error: '获取文档列表失败' }, { status: 500 })
  }
}

/**
 * POST /api/projects/[id]/documents
 * 上传项目文档（PDF/PPT/PPTX），需要 canEditProject 权限
 * 接收 FormData，字段名 "file"
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    if (!session.user.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: { members: { select: { userId: true } } },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    const memberIds = project.members.map(m => m.userId)
    if (!canEditProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })) {
      return NextResponse.json({ error: '无权上传文档' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: '请选择文件' }, { status: 400 })
    }

    // 文件类型白名单：PDF / PPT / PPTX
    const allowedTypes: Record<string, string> = {
      'application/pdf': 'pdf',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    }

    const ext = allowedTypes[file.type]
    if (!ext) {
      return NextResponse.json(
        { error: '不支持的文件类型，仅支持 PDF / PPT / PPTX' },
        { status: 400 }
      )
    }

    // 文件大小限制：50MB（BP 等文档通常较大）
    const MAX_SIZE = 50 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: '文件不能超过 50MB' }, { status: 400 })
    }

    // 生成随机文件名（保留原始文件名展示用）
    const storedFileName = `${params.id}-${Date.now()}-${randomUUID()}.${ext}`

    // 读取文件内容
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // 上传：COS 优先，本地存储 fallback
    let fileUrl: string
    if (isCosConfigured()) {
      const cosKey = `project-docs/${storedFileName}`
      const cosUrl = await uploadToCos(buffer, cosKey, file.type)
      if (!cosUrl) throw new Error('COS 上传失败')
      fileUrl = cosUrl
    } else {
      // 本地存储 fallback
      const uploadDir = path.join(process.cwd(), 'public', 'project-docs')
      await mkdir(uploadDir, { recursive: true })
      const filePath = path.join(uploadDir, storedFileName)
      await writeFile(filePath, buffer)
      fileUrl = `/project-docs/${storedFileName}`
    }

    // 保存文档记录到数据库
    const document = await prisma.projectDocument.create({
      data: {
        projectId: params.id,
        fileName: file.name,
        fileUrl,
        fileType: file.type,
        fileSize: file.size,
        uploadedById: session.user.id,
      },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({
      document: {
        id: document.id,
        fileName: document.fileName,
        fileUrl: document.fileUrl,
        fileType: document.fileType,
        fileSize: document.fileSize,
        createdAt: document.createdAt,
        uploadedBy: document.uploadedBy,
      },
    })
  } catch (error) {
    console.error('Upload project document error:', error)
    return NextResponse.json({ error: '文档上传失败' }, { status: 500 })
  }
}
