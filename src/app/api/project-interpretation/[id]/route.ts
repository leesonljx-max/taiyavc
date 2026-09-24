export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { unlink } from 'fs/promises'
import { join } from 'path'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

/** 本地文件目录（fileUrl 形如 /api/uploads/interpretation-docs/xxx.pdf） */
const UPLOAD_DIR = join(process.cwd(), 'public', 'interpretation-docs')

/** 从 fileUrl 提取本地文件名（仅 interpretation-docs 目录，防路径穿越） */
function localFilePath(fileUrl: string): string | null {
  const m = fileUrl.match(/^\/api\/uploads\/interpretation-docs\/([A-Za-z0-9._-]+)$/)
  return m ? join(UPLOAD_DIR, m[1]) : null
}

/** 加载自己的解读记录（含问题），非本人 404 */
async function loadOwn(id: string, userId: string) {
  const record = await prisma.projectInterpretation.findUnique({
    where: { id },
    include: {
      questions: { orderBy: { order: 'asc' } },
    },
  })
  if (!record || record.userId !== userId) return null
  return record
}

/**
 * GET /api/project-interpretation/[id]
 * 解读详情：记录（含解读结果 JSON/综合结论）+ 问题清单（含校验结果）
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const record = await loadOwn(params.id, session.user.id)
    if (!record) return NextResponse.json({ error: '记录不存在' }, { status: 404 })

    return NextResponse.json({
      interpretation: {
        id: record.id,
        projectName: record.projectName,
        fileName: record.fileName,
        fileUrl: record.fileUrl,
        fileType: record.fileType,
        fileSize: record.fileSize,
        status: record.status,
        interpretationJson: record.interpretationJson,
        questionsStatus: record.questionsStatus,
        conclusionJson: record.conclusionJson,
        verifyStatus: record.verifyStatus,
        interviewFileName: record.interviewFileName,
        interviewFileUrl: record.interviewFileUrl,
        error: record.error,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        questions: record.questions.map(q => ({
          id: q.id,
          order: q.order,
          category: q.category,
          question: q.question,
          idealAnswer: q.idealAnswer,
          verifyStatus: q.verifyStatus,
          verifyFileName: q.verifyFileName,
          verifyFileUrl: q.verifyFileUrl,
          verifyResultJson: q.verifyResultJson,
          updatedAt: q.updatedAt.toISOString(),
        })),
      },
    })
  } catch (error) {
    console.error('Project interpretation detail error:', error)
    return NextResponse.json({ error: '获取详情失败' }, { status: 500 })
  }
}

/**
 * DELETE /api/project-interpretation/[id]
 * 删除解读记录（含问题）与本地文档文件
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const record = await loadOwn(params.id, session.user.id)
    if (!record) return NextResponse.json({ error: '记录不存在' }, { status: 404 })

    await prisma.projectInterpretation.delete({ where: { id: record.id } })

    // 清理本地文件（项目文档 + 各问题的访谈文件；删除失败不阻塞）
    const urls = [record.fileUrl, ...record.questions.map(q => q.verifyFileUrl).filter((u): u is string => !!u)]
    for (const url of urls) {
      const p = localFilePath(url)
      if (p) await unlink(p).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Project interpretation delete error:', error)
    return NextResponse.json({ error: '删除失败' }, { status: 500 })
  }
}
