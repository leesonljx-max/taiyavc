export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { extractTextFromFile } from '@/lib/document-extract'
import {
  PI_DOC_ACCEPTED_EXTENSIONS,
  PI_DOC_MAX_SIZE,
  fileExt,
} from '@/lib/project-interpretation/constants'
import { parseInterviewSource, type ParsedInterview } from '@/lib/project-interpretation/interview'

/** 上传目录（/api/uploads/[...path] 运行时文件服务白名单内） */
const UPLOAD_DIR = join(process.cwd(), 'public', 'interpretation-docs')

/**
 * POST /api/project-interpretation/upload
 * 上传项目文档（PDF/Word/PPT/Excel/文本），提取文本并创建解读记录
 * multipart: { file, projectName?, interviewFile?, interviewText? } 或 { text, projectName }（粘贴文本备选通道）
 * 同时上传访谈纪要（interviewFile/interviewText）时存入记录，前端自动执行：解读 → 问题清单 → 访谈校验 → 结论
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const pastedText = formData.get('text')
    const interviewFile = formData.get('interviewFile') as File | null
    const interviewTextRaw = formData.get('interviewText')
    const interviewText = typeof interviewTextRaw === 'string' ? interviewTextRaw.trim() : ''

    const projectNameRaw = formData.get('projectName')
    const projectName =
      typeof projectNameRaw === 'string' && projectNameRaw.trim() ? projectNameRaw.trim().slice(0, 100) : ''

    // ── 可选：同时上传访谈纪要（文档自动提取 / 音频留档待转写 / 粘贴文本） ──
    let interview: ParsedInterview | null = null
    if (interviewFile || interviewText) {
      interview = await parseInterviewSource(interviewFile, interviewText)
      if (interview.error) {
        return NextResponse.json({ error: interview.error }, { status: 400 })
      }
    }

    // ── 备选通道：无 BP 文件时接受粘贴文本 ──
    if (!file) {
      const text = typeof pastedText === 'string' ? pastedText.trim() : ''
      if (!text || text.length < 100) {
        return NextResponse.json(
          { error: '未找到上传文件，或粘贴的项目文本过短（至少 100 字）' },
          { status: 400 }
        )
      }
      const record = await prisma.projectInterpretation.create({
        data: {
          userId: session.user.id,
          projectName: projectName || '粘贴文本项目',
          fileName: '粘贴文本.txt',
          fileUrl: '',
          fileType: 'text/plain',
          fileSize: text.length,
          documentText: text.slice(0, 60000),
          status: 'UPLOADED',
          ...(interview
            ? {
                interviewFileName: interview.fileName,
                interviewFileUrl: interview.fileUrl,
                interviewText: interview.text ? interview.text.slice(0, 40000) : null,
              }
            : {}),
        },
      })
      return NextResponse.json(
        {
          interpretation: {
            id: record.id,
            projectName: record.projectName,
            fileName: record.fileName,
            fileUrl: record.fileUrl,
            status: record.status,
            questionsStatus: record.questionsStatus,
            hasInterview: !!interview?.text,
            createdAt: record.createdAt.toISOString(),
          },
        },
        { status: 201 }
      )
    }

    // 格式与大小校验（仅接受可提取文本的格式）
    const ext = fileExt(file.name)
    if (!PI_DOC_ACCEPTED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: `不支持的文件类型 .${ext}，请上传 PDF / Word(docx) / PPT(pptx) / Excel / txt 文档` },
        { status: 400 }
      )
    }
    if (file.size > PI_DOC_MAX_SIZE) {
      return NextResponse.json({ error: '文件大小超过 50MB 限制' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // 提取文本（txt/md 直接读取；其余走提取器）
    let documentText = ''
    if (ext === 'txt' || ext === 'md') {
      documentText = buffer.toString('utf8').trim()
    } else {
      documentText = (await extractTextFromFile(buffer, file.name, file.type)).text
    }
    if (!documentText || documentText.length < 50) {
      return NextResponse.json(
        {
          error:
            `无法从文档提取到有效文本（仅提取到 ${documentText.length} 字符，可能为扫描件/图片型文档）。` +
            '建议：① 上传可复制文本的 PDF/DOCX/PPTX；② 使用下方的"粘贴项目文本"直接粘贴内容',
        },
        { status: 400 }
      )
    }

    // 保存文件
    await mkdir(UPLOAD_DIR, { recursive: true })
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}.${ext}`
    await writeFile(join(UPLOAD_DIR, uniqueName), buffer)
    const fileUrl = `/api/uploads/interpretation-docs/${uniqueName}`

    // 建记录：项目名缺省取文件名（去扩展名），解读阶段由 AI 推断后回填
    const record = await prisma.projectInterpretation.create({
      data: {
        userId: session.user.id,
        projectName: projectName || file.name.replace(/\.[^.]+$/, '').slice(0, 100),
        fileName: file.name,
        fileUrl,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        documentText,
        status: 'UPLOADED',
        ...(interview
          ? {
              interviewFileName: interview.fileName,
              interviewFileUrl: interview.fileUrl,
              interviewText: interview.text ? interview.text.slice(0, 40000) : null,
            }
          : {}),
      },
    })

    return NextResponse.json(
      {
        interpretation: {
          id: record.id,
          projectName: record.projectName,
          fileName: record.fileName,
          fileUrl: record.fileUrl,
          status: record.status,
          questionsStatus: record.questionsStatus,
          hasInterview: !!interview?.text,
          createdAt: record.createdAt.toISOString(),
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Project interpretation upload error:', error)
    return NextResponse.json({ error: '上传失败' }, { status: 500 })
  }
}
