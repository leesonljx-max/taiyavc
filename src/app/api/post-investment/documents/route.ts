export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { isValidPeriod } from '@/lib/post-investment/calc'
import { extractTextFromFile } from '@/lib/document-extract'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'

/** 投后文档目录（走 /api/uploads 白名单访问） */
const UPLOAD_DIR = join(process.cwd(), 'public', 'post-investment-docs')

const DOC_TYPES = ['OPERATION_REPORT', 'FINANCIAL_STATEMENT', 'BP', 'OTHER'] as const
const DOC_TYPE_LABELS: Record<string, string> = {
  OPERATION_REPORT: '经营报告',
  FINANCIAL_STATEMENT: '财务报表',
  BP: 'BP',
  OTHER: '其他',
}
const DOC_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.txt', '.md']
const MAX_SIZE = 50 * 1024 * 1024

/**
 * POST /api/post-investment/documents
 * 上传投后资料（formData: projectId / period / docType / file）
 * 上传后自动提取全文入库，供指标提取与 AI 分析
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const currentUser: PermissionUser = { id: session.user.id, role: session.user.role as UserRole }

    const formData = await request.formData()
    const projectId = String(formData.get('projectId') || '')
    const period = String(formData.get('period') || '')
    const docType = String(formData.get('docType') || '')
    const file = formData.get('file') as File | null

    if (!projectId) return NextResponse.json({ error: '缺少 projectId' }, { status: 400 })
    if (!isValidPeriod(period)) {
      return NextResponse.json({ error: '无效的报告期（格式：2026Q1 / 2026H1 / 2026FY）' }, { status: 400 })
    }
    if (!DOC_TYPES.includes(docType as typeof DOC_TYPES[number])) {
      return NextResponse.json({ error: '无效的文档类型' }, { status: 400 })
    }
    if (!file) return NextResponse.json({ error: '未找到上传文件' }, { status: 400 })

    const ext = '.' + (file.name.toLowerCase().split('.').pop() || '')
    if (!DOC_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ error: `不支持的文件类型: ${ext}，仅支持 PDF/Word/Excel/txt/md` }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: '文件大小超过 50MB 限制' }, { status: 400 })
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { createdById: true, members: { select: { userId: true } } },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权上传该项目资料' }, { status: 403 })
    }

    await mkdir(UPLOAD_DIR, { recursive: true })
    const rawExt = file.name.split('.').pop() || 'pdf'
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}.${rawExt}`
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(join(UPLOAD_DIR, uniqueName), buffer)

    // 提取全文（指标提取输入；失败不阻塞上传）
    let text = ''
    try {
      if (rawExt.toLowerCase() === 'txt' || rawExt.toLowerCase() === 'md') {
        text = buffer.toString('utf8').trim()
      } else {
        text = (await extractTextFromFile(buffer, file.name, file.type)).text
      }
    } catch {
      text = ''
    }

    const doc = await prisma.postInvestDoc.create({
      data: {
        projectId,
        docType,
        period,
        fileName: file.name,
        fileUrl: `/post-investment-docs/${uniqueName}`,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        text,
        uploadedById: session.user.id,
      },
    })

    return NextResponse.json({
      ok: true,
      doc: {
        id: doc.id,
        fileName: doc.fileName,
        docTypeLabel: DOC_TYPE_LABELS[docType] || docType,
        period,
        fileSize: doc.fileSize,
        hasText: text.length > 0,
      },
    })
  } catch (error) {
    console.error('Post-investment upload error:', error)
    return NextResponse.json({ error: '上传投后资料失败' }, { status: 500 })
  }
}

/**
 * DELETE /api/post-investment/documents?docId=xxx
 * 删除投后文档（同时清理本地文件）
 */
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const currentUser: PermissionUser = { id: session.user.id, role: session.user.role as UserRole }

    const docId = new URL(request.url).searchParams.get('docId')
    if (!docId) return NextResponse.json({ error: '缺少 docId' }, { status: 400 })

    const doc = await prisma.postInvestDoc.findUnique({ where: { id: docId } })
    if (!doc) return NextResponse.json({ error: '文档不存在' }, { status: 404 })

    const project = await prisma.project.findUnique({
      where: { id: doc.projectId },
      select: { createdById: true, members: { select: { userId: true } } },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权删除该项目资料' }, { status: 403 })
    }

    await prisma.postInvestDoc.delete({ where: { id: doc.id } })
    // 清理本地文件（失败不阻塞）
    const m = doc.fileUrl.match(/^\/post-investment-docs\/([A-Za-z0-9._-]+)$/)
    if (m) await unlink(join(UPLOAD_DIR, m[1])).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Post-investment delete error:', error)
    return NextResponse.json({ error: '删除投后文档失败' }, { status: 500 })
  }
}
