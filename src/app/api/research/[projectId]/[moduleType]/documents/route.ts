export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import {
  canEditResearchProject,
  isValidModuleType,
} from '@/lib/research-permissions'
import {
  extractTextFromFile,
  validateResearchDoc,
} from '@/lib/document-extract'

/**
 * POST /api/research/[projectId]/[moduleType]/documents
 * 上传投研分析模块文档（Word/Excel/PPT/PDF）
 *
 * 流程：
 * 1. 验证文件格式和大小
 * 2. 保存文件到 public/research-docs/
 * 3. 提取文本内容（存入 extractedText 字段）
 * 4. 创建 ResearchDocument 记录
 */

const UPLOAD_DIR = join(process.cwd(), 'public', 'research-docs')

export async function POST(
  request: Request,
  { params }: { params: { projectId: string; moduleType: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const { projectId, moduleType } = params

    // 验证 moduleType
    if (!isValidModuleType(moduleType)) {
      return NextResponse.json(
        { error: `无效的模块类型: ${moduleType}` },
        { status: 400 }
      )
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        createdById: true,
        members: { select: { userId: true } },
      },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权上传文档' }, { status: 403 })
    }

    // 解析 multipart 表单
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: '未找到上传文件' }, { status: 400 })
    }

    // 验证文件
    const validation = validateResearchDoc(file.name, file.size, file.type)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // 确保上传目录存在
    await mkdir(UPLOAD_DIR, { recursive: true })

    // 生成唯一文件名
    const ext = file.name.split('.').pop()
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}.${ext}`
    const filePath = join(UPLOAD_DIR, uniqueName)

    // 保存文件
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    await writeFile(filePath, buffer)

    // 提取文本内容
    const { text: extractedText, truncated } = await extractTextFromFile(
      buffer,
      file.name,
      file.type
    )

    // 获取或创建模块
    const module = await prisma.researchModule.upsert({
      where: {
        projectId_moduleType: { projectId, moduleType },
      },
      create: { projectId, moduleType },
      update: {},
    })

    // 创建文档记录
    const document = await prisma.researchDocument.create({
      data: {
        moduleId: module.id,
        fileName: file.name,
        fileUrl: `/research-docs/${uniqueName}`,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        extractedText: extractedText || null,
        uploadedById: session.user.id,
      },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
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
        extractedTextLength: extractedText.length,
        truncated,
      },
    })
  } catch (error) {
    console.error('Research document upload error:', error)
    return NextResponse.json(
      { error: '上传文档失败' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/research/[projectId]/[moduleType]/documents
 * 获取模块的文档列表
 */
export async function GET(
  _request: Request,
  { params }: { params: { projectId: string; moduleType: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const { projectId, moduleType } = params

    if (!isValidModuleType(moduleType)) {
      return NextResponse.json(
        { error: `无效的模块类型: ${moduleType}` },
        { status: 400 }
      )
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        createdById: true,
        members: { select: { userId: true } },
      },
    })

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    }

    const memberIds = project.members.map(m => m.userId)

    // 投研分析查看权限
    const { canViewResearchProject } = await import('@/lib/research-permissions')
    if (!canViewResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权查看该项目' }, { status: 403 })
    }

    const module = await prisma.researchModule.findUnique({
      where: {
        projectId_moduleType: { projectId, moduleType },
      },
      include: {
        documents: {
          select: {
            id: true,
            fileName: true,
            fileUrl: true,
            fileType: true,
            fileSize: true,
            createdAt: true,
            uploadedBy: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    return NextResponse.json({
      documents: module?.documents || [],
    })
  } catch (error) {
    console.error('Research documents list error:', error)
    return NextResponse.json(
      { error: '获取文档列表失败' },
      { status: 500 }
    )
  }
}
