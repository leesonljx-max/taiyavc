export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { readFile } from 'fs/promises'
import { join } from 'path'

/**
 * GET /api/post-investment/documents/preview?docId=xxx
 * 文档在线阅览（服务端自渲染，不依赖外部服务）：
 * - docx → mammoth 转 HTML（保留标题/表格/列表/图片）
 * - xlsx → SheetJS 转 HTML 表格（逐 sheet）
 * - pdf / txt / md → 返回文件地址（浏览器原生渲染）
 * - pptx → 返回按页提取的文本
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

    const ext = '.' + (doc.fileName.toLowerCase().split('.').pop() || '')

    // pdf / txt / md：浏览器原生渲染，直接给文件地址（走 /api/uploads 白名单，生产可用）
    if (ext === '.pdf' || ext === '.txt' || ext === '.md') {
      return NextResponse.json({ kind: 'file', url: toPublicUrl(doc.fileUrl) })
    }

    // pptx：无法还原版式，返回按页提取的文本
    if (ext === '.pptx') {
      return NextResponse.json({ kind: 'text', text: doc.text || '（未能提取文本）' })
    }

    // docx / xlsx：读取本地文件 → 服务端转 HTML
    if (ext === '.docx' || ext === '.xlsx') {
      const buffer = await readDocFile(doc.fileUrl)
      if (!buffer) {
        // 文件丢失时回退提取文本
        return NextResponse.json({ kind: 'text', text: doc.text || '（文件不存在，且未能提取文本）' })
      }
      const html = ext === '.docx' ? await docxToHtml(buffer) : await xlsxToHtml(buffer)
      return NextResponse.json({ kind: 'html', html })
    }

    return NextResponse.json({ kind: 'text', text: doc.text || '' })
  } catch (error) {
    console.error('Post-investment doc preview error:', error)
    return NextResponse.json({ error: '获取文档预览失败' }, { status: 500 })
  }
}

// ── 工具 ──

const UPLOAD_DIR = join(process.cwd(), 'public', 'post-investment-docs')

/** fileUrl 兼容新旧格式：/post-investment-docs/x 与 /api/uploads/post-investment-docs/x */
function toPublicUrl(fileUrl: string): string {
  if (fileUrl.startsWith('/api/uploads/') || fileUrl.startsWith('http')) return fileUrl
  return `/api/uploads${fileUrl}`
}

async function readDocFile(fileUrl: string): Promise<Buffer | null> {
  const m = fileUrl.match(/\/(?:api\/uploads\/)?post-investment-docs\/([A-Za-z0-9._-]+)$/)
  if (!m) return null
  try {
    return await readFile(join(UPLOAD_DIR, m[1]))
  } catch {
    return null
  }
}

/** HTML 转义 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 清理 AI/转换器输出中的危险标签与属性 */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

/** docx → HTML（mammoth，保留标题/表格/列表，图片转 base64 内联） */
async function docxToHtml(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.convertToHtml({ buffer })
  return sanitizeHtml(result.value || '<p>（文档无文本内容）</p>')
}

/** xlsx → HTML 表格（逐 sheet，行数上限保护） */
async function xlsxToHtml(buffer: Buffer): Promise<string> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const parts: string[] = []
  for (const sheetName of workbook.SheetNames.slice(0, 20)) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }).slice(0, 500)
    parts.push(`<h3>${escapeHtml(sheetName)}</h3>`)
    parts.push('<table>')
    for (const row of rows) {
      parts.push('<tr>' + row.map(c => `<td>${escapeHtml(String(c ?? ''))}</td>`).join('') + '</tr>')
    }
    parts.push('</table>')
  }
  return sanitizeHtml(parts.join('\n') || '<p>（表格无内容）</p>')
}
