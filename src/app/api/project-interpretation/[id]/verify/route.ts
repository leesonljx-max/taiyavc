export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { runBatchVerification, runConclusion } from '@/lib/project-interpretation/runner'
import { parseInterviewSource } from '@/lib/project-interpretation/interview'

/** 自动生成综合结论所需的最低已覆盖问题数 */
const MIN_COVERED = 3

/**
 * POST /api/project-interpretation/[id]/verify
 * 批量访谈校验：整个项目只上传一次访谈纪要（音频/文档/粘贴文本），
 * 单次 AI 调用校验全部问题 → 逐题落库 → 覆盖 ≥3 题时自动生成综合结论
 *
 * multipart: { file?, text? }（音频需配合 text 转写内容）
 * 无请求内容时回退使用上传时一并存入的访谈全文（自动链路：BP+纪要一起上传）
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const record = await prisma.projectInterpretation.findUnique({
      where: { id: params.id },
      include: { questions: { orderBy: { order: 'asc' } } },
    })
    if (!record || record.userId !== session.user.id) {
      return NextResponse.json({ error: '记录不存在' }, { status: 404 })
    }
    if (record.questionsStatus !== 'READY' || record.questions.length === 0) {
      return NextResponse.json({ error: '请先生成问题清单再上传访谈纪要' }, { status: 400 })
    }
    if (record.verifyStatus === 'RUNNING') {
      return NextResponse.json({ error: '访谈校验进行中，请稍候' }, { status: 400 })
    }

    // ── 解析访谈内容（请求内文件/粘贴文本；缺省回退上传时存的访谈全文） ──
    const contentType = request.headers.get('content-type') || ''
    let interviewText = ''
    let interviewFileName = record.interviewFileName
    let interviewFileUrl = record.interviewFileUrl

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      const pastedText = formData.get('text')
      const pasted = typeof pastedText === 'string' ? pastedText.trim() : ''

      if (file || pasted) {
        const parsed = await parseInterviewSource(file, pasted)
        if (parsed.error) {
          return NextResponse.json({ error: parsed.error }, { status: 400 })
        }
        if (parsed.needTranscript) {
          // 音频已留档但缺转写：保存文件引用并提示
          await prisma.projectInterpretation.update({
            where: { id: record.id },
            data: { interviewFileName: parsed.fileName, interviewFileUrl: parsed.fileUrl },
          })
          return NextResponse.json(
            { error: '音频文件已保存。系统暂不支持自动转写，请粘贴访谈纪要文字后再次提交校验。', needTranscript: true },
            { status: 400 }
          )
        }
        // 请求内容与已存全文合并（新内容在前，保留完整记录）
        interviewText = parsed.text
        if (parsed.fileName) {
          interviewFileName = parsed.fileName
          interviewFileUrl = parsed.fileUrl
        }
      }
    } else {
      const body = await request.json().catch(() => ({}))
      if (typeof body.text === 'string' && body.text.trim()) {
        interviewText = body.text.trim()
      }
    }

    // 回退：上传时一并存入的访谈全文
    if (!interviewText && record.interviewText) {
      interviewText = record.interviewText
    }

    if (!interviewText || interviewText.length < 50) {
      return NextResponse.json(
        { error: '缺少访谈内容：请上传访谈纪要文档或粘贴访谈文字记录' },
        { status: 400 }
      )
    }

    // ── 批量校验（单次 AI 调用） ──
    await prisma.projectInterpretation.update({
      where: { id: record.id },
      data: { verifyStatus: 'RUNNING', error: null },
    })

    try {
      const results = await runBatchVerification({
        questions: record.questions.map(q => ({ order: q.order, question: q.question, idealAnswer: q.idealAnswer })),
        interviewText,
      })

      // 逐题落库（按 order 对齐）
      await prisma.$transaction(
        record.questions.map((q, i) =>
          prisma.interpretationQuestion.update({
            where: { id: q.id },
            data: {
              verifyStatus: 'VERIFIED',
              verifyFileName: interviewFileName,
              verifyFileUrl: interviewFileUrl,
              verifyText: interviewText.slice(0, 20000),
              verifyResultJson: JSON.stringify(results[i]),
            },
          })
        )
      )

      // 覆盖（非 UNCOVERED）问题 ≥3 时自动生成综合结论
      const covered = record.questions
        .map((q, i) => ({ q, r: results[i] }))
        .filter(({ r }) => r && r.matchLevel !== 'UNCOVERED')
      let conclusionGenerated = false
      if (covered.length >= MIN_COVERED) {
        const conclusion = await runConclusion({
          projectName: record.projectName,
          verified: covered.map(({ q, r }) => ({
            question: q.question,
            category: q.category,
            idealAnswer: q.idealAnswer,
            verifyResult: r,
          })),
        })
        await prisma.projectInterpretation.update({
          where: { id: record.id },
          data: {
            verifyStatus: 'DONE',
            interviewFileName,
            interviewFileUrl,
            interviewText: interviewText.slice(0, 40000),
            conclusionJson: JSON.stringify(conclusion),
            error: null,
          },
        })
        conclusionGenerated = true
      } else {
        await prisma.projectInterpretation.update({
          where: { id: record.id },
          data: {
            verifyStatus: 'DONE',
            interviewFileName,
            interviewFileUrl,
            interviewText: interviewText.slice(0, 40000),
            error: null,
          },
        })
      }

      return NextResponse.json({
        verifiedCount: record.questions.length,
        coveredCount: covered.length,
        uncoveredCount: record.questions.length - covered.length,
        conclusionGenerated,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '访谈校验失败'
      await prisma.projectInterpretation.update({
        where: { id: record.id },
        data: { verifyStatus: 'FAILED', error: message },
      })
      return NextResponse.json({ error: message }, { status: 502 })
    }
  } catch (error) {
    console.error('Batch verify error:', error)
    return NextResponse.json({ error: '访谈校验失败' }, { status: 500 })
  }
}
