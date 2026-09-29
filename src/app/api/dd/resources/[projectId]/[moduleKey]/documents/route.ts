export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { upsertModuleResource, isValidModuleKey, type DDResourceDoc } from '@/lib/dd-workbench/resources'
import { extractTextFromFile } from '@/lib/document-extract'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'

/** 模块文档目录（与投研模块文档共用 research-docs，走 /api/uploads 白名单访问） */
const UPLOAD_DIR = join(process.cwd(), 'public', 'research-docs')

/** DD 资料文档支持的格式（比投研文档多 txt/md，纯文本纪要直接上传） */
const DD_DOC_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.md']
const DD_DOC_MAX_SIZE = 50 * 1024 * 1024

function validateDDDoc(fileName: string, fileSize: number): { valid: boolean; error?: string } {
  const ext = '.' + (fileName.toLowerCase().split('.').pop() || '')
  if (!DD_DOC_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `不支持的文件类型: ${ext}，仅支持 PDF/Word/Excel/PPT/txt/md` }
  }
  if (fileSize > DD_DOC_MAX_SIZE) {
    return { valid: false, error: '文件大小超过 50MB 限制' }
  }
  return { valid: true }
}

function localFilePath(fileUrl: string): string | null {
  const m = fileUrl.match(/^\/research-docs\/([A-Za-z0-9._-]+)$/)
  return m ? join(UPLOAD_DIR, m[1]) : null
}

async function loadDocList(projectId: string, moduleKey: string): Promise<DDResourceDoc[]> {
  const record = await prisma.dDModuleResource.findUnique({
    where: { projectId_moduleKey: { projectId, moduleKey } },
  })
  if (!record?.documents) return []
  try {
    const arr = JSON.parse(record.documents)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/**
 * POST /api/dd/resources/[projectId]/[moduleKey]/documents
 * 上传模块文档（Word/Excel/PPT/PDF/txt），提取全文存入（报告生成输入）
 */
export async function POST(
  request: Request,
  { params }: { params: { projectId: string; moduleKey: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const currentUser: PermissionUser = { id: session.user.id, role: session.user.role as UserRole }

    const { projectId, moduleKey } = params
    if (!isValidModuleKey(moduleKey)) {
      return NextResponse.json({ error: `无效的模块标识: ${moduleKey}` }, { status: 400 })
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { createdById: true, members: { select: { userId: true } } },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })

    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权编辑该项目' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: '未找到上传文件' }, { status: 400 })

    const validation = validateDDDoc(file.name, file.size)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    await mkdir(UPLOAD_DIR, { recursive: true })
    const ext = file.name.split('.').pop() || 'pdf'
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(join(UPLOAD_DIR, uniqueName), buffer)

    // 提取全文（报告生成输入；失败不阻塞上传。txt/md 直接读取，其余走提取器）
    let text = ''
    try {
      const lowerExt = file.name.toLowerCase().split('.').pop() || ''
      if (lowerExt === 'txt' || lowerExt === 'md') {
        text = buffer.toString('utf8').trim()
      } else {
        text = (await extractTextFromFile(buffer, file.name, file.type)).text
      }
    } catch {
      text = ''
    }

    const record = await upsertModuleResource(projectId, moduleKey)
    const docs = await loadDocList(projectId, moduleKey)
    docs.push({
      id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      fileName: file.name,
      fileUrl: `/research-docs/${uniqueName}`,
      fileType: file.type || 'application/octet-stream',
      fileSize: file.size,
      text,
      uploadedAt: new Date().toISOString(),
    })
    await prisma.dDModuleResource.update({
      where: { id: record.id },
      data: { documents: JSON.stringify(docs) },
    })

    return NextResponse.json({ ok: true, count: docs.length })
  } catch (error) {
    console.error('DD module document upload error:', error)
    return NextResponse.json({ error: '上传文档失败' }, { status: 500 })
  }
}

/**
 * DELETE /api/dd/resources/[projectId]/[moduleKey]/documents?docId=xxx
 * 删除模块文档（同时清理本地文件）
 */
export async function DELETE(
  request: Request,
  { params }: { params: { projectId: string; moduleKey: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const currentUser: PermissionUser = { id: session.user.id, role: session.user.role as UserRole }

    const { projectId, moduleKey } = params
    const docId = new URL(request.url).searchParams.get('docId')
    if (!docId) return NextResponse.json({ error: '缺少 docId' }, { status: 400 })

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { createdById: true, members: { select: { userId: true } } },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权编辑该项目' }, { status: 403 })
    }

    const record = await prisma.dDModuleResource.findUnique({
      where: { projectId_moduleKey: { projectId, moduleKey } },
    })
    if (!record) return NextResponse.json({ error: '文档不存在' }, { status: 404 })

    const docs = await loadDocList(projectId, moduleKey)
    const target = docs.find(d => d.id === docId)
    if (!target) return NextResponse.json({ error: '文档不存在' }, { status: 404 })

    const remaining = docs.filter(d => d.id !== docId)
    await prisma.dDModuleResource.update({
      where: { id: record.id },
      data: { documents: JSON.stringify(remaining) },
    })
    // 清理本地文件（失败不阻塞）
    const local = localFilePath(target.fileUrl)
    if (local) await unlink(local).catch(() => {})

    return NextResponse.json({ ok: true, count: remaining.length })
  } catch (error) {
    console.error('DD module document delete error:', error)
    return NextResponse.json({ error: '删除文档失败' }, { status: 500 })
  }
}
