export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import {
  isDDEvidenceSourceType,
  isDDEvidenceGrade,
  type DDEvidenceGrade,
} from '@/lib/dd-workbench/constants'
import { loadBatchContext, UNAUTHORIZED_BODY } from '@/lib/dd-workbench/guards'

/** 摘录长度上限（原文定位用，超长应拆分引用） */
const EXCERPT_MAX = 2000

/**
 * POST /api/dd/evidence
 * 创建证据片段（事实与结论的可追溯来源）
 * body: { taskId, sourceType, excerpt, grade?, sourceUrl?, sourceLabel?, location?, documentId?, note? }
 *
 * 来源规则（文档 §4）：
 * - DOCUMENT：需 documentId，且资料必须属于同一项目（防跨项目引用）
 * - WEB：需合法 http(s) 链接（创建时间即抓取时间记录）
 * - MANUAL：访谈/口述属一手陈述，等级固定 B
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(UNAUTHORIZED_BODY, { status: 401 })
    }
    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const body = await request.json().catch(() => ({}))
    const taskId = typeof body.taskId === 'string' ? body.taskId : ''
    if (!taskId) return NextResponse.json({ error: '缺少 taskId' }, { status: 400 })

    const task = await prisma.dDTask.findUnique({
      where: { id: taskId },
      select: { id: true, batchId: true },
    })
    if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

    const ctx = await loadBatchContext(task.batchId, currentUser, 'edit')
    if (ctx === null) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    if (ctx === 'FORBIDDEN') return NextResponse.json({ error: '无权操作该批次' }, { status: 403 })
    if (ctx.batch.status === 'FROZEN') {
      return NextResponse.json({ error: '批次已冻结，不可添加证据' }, { status: 400 })
    }

    // ── 字段校验 ──
    const sourceType = typeof body.sourceType === 'string' ? body.sourceType : ''
    if (!isDDEvidenceSourceType(sourceType)) {
      return NextResponse.json(
        { error: '无效的证据来源类型（DOCUMENT/WEB/MANUAL）' },
        { status: 400 }
      )
    }

    const excerpt = typeof body.excerpt === 'string' ? body.excerpt.trim() : ''
    if (!excerpt) return NextResponse.json({ error: '摘录原文不能为空' }, { status: 400 })
    if (excerpt.length > EXCERPT_MAX) {
      return NextResponse.json({ error: `摘录过长（上限 ${EXCERPT_MAX} 字符）` }, { status: 400 })
    }

    let grade: DDEvidenceGrade = 'C'
    if (body.grade !== undefined) {
      if (typeof body.grade !== 'string' || !isDDEvidenceGrade(body.grade)) {
        return NextResponse.json({ error: '无效的证据等级（A/B/C/D）' }, { status: 400 })
      }
      grade = body.grade
    }
    if (sourceType === 'MANUAL') {
      grade = 'B' // 一手陈述固定 B 级
    }

    const sourceLabel = typeof body.sourceLabel === 'string' && body.sourceLabel.trim() ? body.sourceLabel.trim() : null
    const location = typeof body.location === 'string' && body.location.trim() ? body.location.trim() : null
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null

    let sourceUrl: string | null = null
    let documentId: string | null = null

    if (sourceType === 'WEB') {
      sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : ''
      if (!sourceUrl || !/^https?:\/\//.test(sourceUrl)) {
        return NextResponse.json({ error: 'WEB 证据需要合法的 http(s) 链接' }, { status: 400 })
      }
    }

    if (sourceType === 'DOCUMENT') {
      documentId = typeof body.documentId === 'string' ? body.documentId : ''
      if (!documentId) {
        return NextResponse.json({ error: 'DOCUMENT 证据需要指定引用的资料' }, { status: 400 })
      }
      // 资料必须属于同一项目（防跨项目引用）
      const doc = await prisma.projectDocument.findUnique({
        where: { id: documentId },
        select: { id: true, projectId: true, fileName: true },
      })
      if (!doc || doc.projectId !== ctx.batch.projectId) {
        return NextResponse.json({ error: '引用的资料不存在或不属于该项目' }, { status: 400 })
      }
    }

    const evidence = await prisma.dDEvidence.create({
      data: {
        batchId: task.batchId,
        taskId: task.id,
        sourceType,
        documentId,
        sourceUrl,
        sourceLabel,
        location,
        excerpt,
        grade,
        status: 'PENDING',
        note,
        createdById: session.user.id,
      },
    })

    return NextResponse.json({ evidence }, { status: 201 })
  } catch (error) {
    console.error('DD evidence create error:', error)
    return NextResponse.json({ error: '创建证据失败' }, { status: 500 })
  }
}

/**
 * GET /api/dd/evidence?taskId=xxx
 * 任务证据列表（新→旧），带资料文件名（DOCUMENT 来源溯源展示）
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(UNAUTHORIZED_BODY, { status: 401 })
    }
    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    const { searchParams } = new URL(request.url)
    const taskId = searchParams.get('taskId') || ''
    if (!taskId) return NextResponse.json({ error: '缺少 taskId' }, { status: 400 })

    const task = await prisma.dDTask.findUnique({
      where: { id: taskId },
      select: { id: true, batchId: true },
    })
    if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

    const ctx = await loadBatchContext(task.batchId, currentUser, 'view')
    if (ctx === null) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    if (ctx === 'FORBIDDEN') return NextResponse.json({ error: '无权查看该批次' }, { status: 403 })

    const evidences = await prisma.dDEvidence.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
        confirmedBy: { select: { id: true, name: true } },
      },
    })

    // 补充资料文件名（documentId 无外键，需手动关联；已删除的资料显示 null）
    const docIds = Array.from(new Set(evidences.map(e => e.documentId).filter((v): v is string => !!v)))
    const docs = docIds.length
      ? await prisma.projectDocument.findMany({ where: { id: { in: docIds } }, select: { id: true, fileName: true, fileUrl: true } })
      : []
    const docById = new Map(docs.map(d => [d.id, d]))

    return NextResponse.json({
      evidences: evidences.map(e => ({
        id: e.id,
        batchId: e.batchId,
        taskId: e.taskId,
        sourceType: e.sourceType,
        documentId: e.documentId,
        documentFileName: e.documentId ? docById.get(e.documentId)?.fileName || null : null,
        sourceUrl: e.sourceUrl,
        sourceLabel: e.sourceLabel,
        location: e.location,
        excerpt: e.excerpt,
        grade: e.grade,
        status: e.status,
        note: e.note,
        createdBy: e.createdBy,
        confirmedBy: e.confirmedBy,
        confirmedAt: e.confirmedAt?.toISOString() || null,
        createdAt: e.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('DD evidence list error:', error)
    return NextResponse.json({ error: '获取证据列表失败' }, { status: 500 })
  }
}
