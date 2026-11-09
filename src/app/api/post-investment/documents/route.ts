export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { isValidPeriod, isCompletedPeriod } from '@/lib/post-investment/calc'
import { extractTextFromFile, stripNul } from '@/lib/document-extract'
import { enqueueDocExtraction } from '@/lib/post-investment/extract-queue'
import { isCosConfigured, uploadToCos, deleteCosByUrl } from '@/lib/cos'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'

/** 投后文档目录（走 /api/uploads 白名单访问） */
const UPLOAD_DIR = join(process.cwd(), 'public', 'post-investment-docs')
const THUMB_DIR = join(process.cwd(), 'public', 'post-investment-thumbs')

const DOC_TYPES = ['OPERATION_REPORT', 'FINANCIAL_STATEMENT', 'BP', 'OTHER'] as const
const DOC_TYPE_LABELS: Record<string, string> = {
  OPERATION_REPORT: '经营报告',
  FINANCIAL_STATEMENT: '财务报表',
  BP: 'BP',
  OTHER: '其他',
}
const DOC_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.xls', '.xlsm', '.pptx', '.txt', '.md', '.png', '.jpg', '.jpeg', '.webp', '.gif']
const EXCEL_EXTENSIONS = ['.xlsx', '.xls', '.xlsm']
const MAX_SIZE = 50 * 1024 * 1024
/** Excel 上限（业务大表可放宽，但不能无限大：解析会占用大量 CPU/内存） */
const MAX_EXCEL_SIZE = 100 * 1024 * 1024
/** 小于该体积的文件在上传请求内做快速解析（不跑 OCR）；大文件直接转后台 */
const QUICK_EXTRACT_LIMIT = 8 * 1024 * 1024

/** 手动填写内容是否为富文本 HTML（含编辑器格式标签/截图） */
function looksLikeRichHtml(s: string): boolean {
  return /<(p|div|span|img|br|strong|em|b|i|u|ul|ol|li|h[1-6]|table|blockquote)\b/i.test(s)
}

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
    const manualText = String(formData.get('text') || '')

    if (!projectId) return NextResponse.json({ error: '缺少 projectId' }, { status: 400 })
    if (!isValidPeriod(period)) {
      return NextResponse.json({ error: '无效的报告期（格式：2026Q1 / 2026H1 / 2026FY）' }, { status: 400 })
    }
    if (!isCompletedPeriod(period)) {
      return NextResponse.json({ error: `「${period}」尚未结束，暂不能上传该期报告` }, { status: 400 })
    }
    if (!DOC_TYPES.includes(docType as typeof DOC_TYPES[number])) {
      return NextResponse.json({ error: '无效的文档类型' }, { status: 400 })
    }
    if (!file && !manualText.trim()) {
      return NextResponse.json({ error: '请上传文件或填写投后信息' }, { status: 400 })
    }

    let ext = ''
    if (file) {
      ext = '.' + (file.name.toLowerCase().split('.').pop() || '')
      if (!DOC_EXTENSIONS.includes(ext)) {
        return NextResponse.json({ error: `不支持的文件类型: ${ext}，仅支持 PDF/Word/Excel/PPT/txt/md/图片` }, { status: 400 })
      }
      // Excel 上限放宽到 100MB（业务导出的大表常超过 50MB），但不允许无限大
      const sizeLimit = EXCEL_EXTENSIONS.includes(ext) ? MAX_EXCEL_SIZE : MAX_SIZE
      if (file.size > sizeLimit) {
        const limitMb = Math.round(sizeLimit / 1024 / 1024)
        return NextResponse.json({ error: `文件大小超过 ${limitMb}MB 限制` }, { status: 400 })
      }
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

    // ── 手动填写投后资料：文本/富文本（含截图）作为一份资料直接入库（无需上传文件） ──
    if (!file) {
      const content = stripNul(manualText).trim()
      const isRich = looksLikeRichHtml(content)
      const doc = await prisma.postInvestDoc.create({
        data: {
          projectId,
          docType,
          period,
          fileName: `手动填写-${period}${isRich ? '.html' : '.txt'}`,
          fileUrl: '',
          fileType: isRich ? 'text/html' : 'text/plain',
          fileSize: Buffer.byteLength(content, 'utf8'),
          text: content,
          textStatus: 'READY',
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
          hasText: true,
          textStatus: doc.textStatus,
          thumbUrl: doc.thumbUrl,
        },
      })
    }

    const rawExt = file.name.split('.').pop() || 'pdf'
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}.${rawExt}`
    const buffer = Buffer.from(await file.arrayBuffer())

    // 存储：COS（配置了 CDN 则写入 CDN 地址）优先，失败回退本地
    let fileUrl = ''
    if (isCosConfigured()) {
      fileUrl = (await uploadToCos(buffer, `post-investment-docs/${uniqueName}`, file.type || 'application/octet-stream').catch(() => null)) || ''
    }
    if (!fileUrl) {
      await mkdir(UPLOAD_DIR, { recursive: true })
      await writeFile(join(UPLOAD_DIR, uniqueName), buffer)
      fileUrl = `/api/uploads/post-investment-docs/${uniqueName}`
    }

    // 快速解析（不跑 OCR）：文本型文档立即可用；扫描件/图片/大文件转后台识别
    const extLower = ext.toLowerCase()
    let text = ''
    let textStatus: 'READY' | 'PENDING' = 'PENDING'
    try {
      if (file.size <= QUICK_EXTRACT_LIMIT) {
        if (extLower === '.txt' || extLower === '.md') {
          text = stripNul(buffer.toString('utf8')).trim()
          textStatus = 'READY'
        } else {
          const quick = await extractTextFromFile(buffer, file.name, file.type, { skipOcr: true })
          text = quick.text
          textStatus = quick.needsOcr ? 'PENDING' : 'READY'
        }
      }
    } catch {
      text = ''
      textStatus = 'PENDING'
    }

    const doc = await prisma.postInvestDoc.create({
      data: {
        projectId,
        docType,
        period,
        fileName: file.name,
        fileUrl,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        text,
        textStatus,
        uploadedById: session.user.id,
      },
    })

    // 后台识别（不阻塞响应）：OCR 与 PDF 缩略图都在队列中完成
    try {
      enqueueDocExtraction(doc.id)
    } catch (error) {
      console.error('Post-investment enqueue error:', error)
    }

    return NextResponse.json({
      ok: true,
      doc: {
        id: doc.id,
        fileName: doc.fileName,
        docTypeLabel: DOC_TYPE_LABELS[docType] || docType,
        period,
        fileSize: doc.fileSize,
        hasText: text.length > 0,
        textStatus: doc.textStatus,
        thumbUrl: doc.thumbUrl,
      },
    })
  } catch (error) {
    console.error('Post-investment upload error:', error)
    return NextResponse.json({ error: '上传投后资料失败' }, { status: 500 })
  }
}

/**
 * GET /api/post-investment/documents/content?docId=xxx
 * 获取文档提取全文（本地环境的 Office 文档文本阅览回退）
 */
export async function GET(request: Request) {
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
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds }) &&
        !['ADMIN', 'INVESTMENT_PARTNER'].includes(currentUser.role)) {
      return NextResponse.json({ error: '无权查看该文档' }, { status: 403 })
    }

    return NextResponse.json({ text: doc.text || '' })
  } catch (error) {
    console.error('Post-investment doc content error:', error)
    return NextResponse.json({ error: '获取文档内容失败' }, { status: 500 })
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
    // 清理文件（失败不阻塞）：COS 走对象删除，本地兼容新旧 fileUrl 格式
    if (/^https?:\/\//i.test(doc.fileUrl)) {
      await deleteCosByUrl(doc.fileUrl).catch(() => {})
    } else {
      const m = doc.fileUrl.match(/\/(?:api\/uploads\/)?post-investment-docs\/([A-Za-z0-9._-]+)$/)
      if (m) await unlink(join(UPLOAD_DIR, m[1])).catch(() => {})
    }
    // 清理缩略图
    if (doc.thumbUrl) {
      if (/^https?:\/\//i.test(doc.thumbUrl)) {
        await deleteCosByUrl(doc.thumbUrl).catch(() => {})
      } else if (doc.thumbUrl.startsWith('/api/uploads/post-investment-thumbs/')) {
        await unlink(join(THUMB_DIR, doc.thumbUrl.split('/').pop() || '')).catch(() => {})
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Post-investment delete error:', error)
    return NextResponse.json({ error: '删除投后文档失败' }, { status: 500 })
  }
}
