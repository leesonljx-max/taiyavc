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
import { parseUrlsFromText, fetchWebLinks, type WebLinkContent } from '@/lib/project-interpretation/web-content'

/** 上传目录（/api/uploads/[...path] 运行时文件服务白名单内） */
const UPLOAD_DIR = join(process.cwd(), 'public', 'interpretation-docs')

/** 合并后 documentText 上限（多文档 + 网页内容） */
const MAX_DOCUMENT_TEXT = 60000

/**
 * POST /api/project-interpretation/upload
 * 上传项目文档（PDF/Word/PPT/Excel/文本，支持多份），并可选粘贴网页链接：
 * - multipart: { files[]（多文件，兼容单 file）, links?（网页链接文本）, projectName?, interviewFile?, interviewText? }
 *   或 { text, projectName }（粘贴文本备选通道）
 * - 网页链接抓取正文后与文档文本合并分析；仅网页链接（无 BP）也可创建解读记录
 * - 同时上传访谈纪要（interviewFile/interviewText）时存入记录，前端自动执行：解读 → 问题清单 → 访谈校对 → 结论
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }

    const formData = await request.formData()
    // 多文件：优先 files[]，兼容旧客户端单 file
    const files = [
      ...formData.getAll('files').filter((f): f is File => f instanceof File),
      ...([] as File[]).concat(formData.get('file') instanceof File ? [formData.get('file') as File] : []),
    ]
    const pastedText = formData.get('text')
    const linksRaw = formData.get('links')
    const linksText = typeof linksRaw === 'string' ? linksRaw : ''
    const interviewFile = formData.get('interviewFile') as File | null
    const interviewTextRaw = formData.get('interviewText')
    const interviewText = typeof interviewTextRaw === 'string' ? interviewTextRaw.trim() : ''

    const projectNameRaw = formData.get('projectName')
    const projectName =
      typeof projectNameRaw === 'string' && projectNameRaw.trim() ? projectNameRaw.trim().slice(0, 100) : ''

    // ── 网页链接解析与抓取（可选；与 BP 一起合并分析，仅链接也可解读） ──
    const urls = parseUrlsFromText(linksText)
    const webLinks: WebLinkContent[] = urls.length > 0 ? await fetchWebLinks(urls) : []
    const failedUrls = webLinks.length > 0 ? urls.filter(u => !webLinks.some(w => w.url === u)) : []

    // ── 可选：同时上传访谈纪要（文档自动提取 / 音频自动转写 / 粘贴文本） ──
    let interview: ParsedInterview | null = null
    if (interviewFile || interviewText) {
      interview = await parseInterviewSource(interviewFile, interviewText)
      if (interview.error) {
        return NextResponse.json({ error: interview.error }, { status: 400 })
      }
      // 音频留档但既无粘贴文本也无自动转写 → 按原因给出针对性提示
      if (interview.needTranscript) {
        const hint =
          interview.needTranscriptReason === 'FILE_TOO_LARGE'
            ? `音频大小超过 25MB 转写上限（当前约 ${Math.round((interviewFile?.size || 0) / 1024 / 1024)} MB）。请压缩后上传（如转为 32kbps 单声道 MP3）或直接粘贴访谈纪要文字`
            : interview.needTranscriptReason === 'TRANSCRIBE_FAILED'
              ? '音频转写失败（网络或转写服务异常，详见服务器日志）。请重试，或直接粘贴访谈纪要文字'
              : '音频文件需要配合粘贴访谈纪要文本提交（或等服务器配置语音转写服务后自动转写）'
        return NextResponse.json({ error: hint }, { status: 400 })
      }
    }

    // ── 文档文本提取（多文件逐份提取后合并；首份为 BP 主体） ──
    const docTexts: string[] = []
    let primaryFile: { name: string; type: string; size: number; buffer: Buffer } | null = null
    let fileNameLabel = ''
    for (const file of files) {
      const ext = fileExt(file.name)
      if (!PI_DOC_ACCEPTED_EXTENSIONS.includes(ext)) {
        return NextResponse.json(
          { error: `不支持的文件类型 .${ext}，请上传 PDF / Word(docx) / PPT(pptx) / Excel / txt 文档` },
          { status: 400 }
        )
      }
      if (file.size > PI_DOC_MAX_SIZE) {
        return NextResponse.json({ error: `文件「${file.name}」超过 50MB 限制` }, { status: 400 })
      }
      const buffer = Buffer.from(await file.arrayBuffer())
      let text = ''
      if (ext === 'txt' || ext === 'md') {
        text = buffer.toString('utf8').trim()
      } else {
        text = (await extractTextFromFile(buffer, file.name, file.type)).text
      }
      if (text && text.length >= 50) {
        docTexts.push(`【文档：${file.name}】\n${text}`)
        if (!primaryFile) primaryFile = { name: file.name, type: file.type || 'application/octet-stream', size: file.size, buffer }
      }
    }
    fileNameLabel =
      files.length === 0 ? '' : files.length === 1 ? files[0].name : `${files[0].name} 等 ${files.length} 份`

    // ── 网页内容块（带来源标记，合并进分析文本） ──
    const webBlocks = webLinks.map(w => `【网页：${w.title}】\n来源：${w.url}\n${w.content}`)

    // ── 备选通道：粘贴文本 ──
    const pastedBlock = typeof pastedText === 'string' && pastedText.trim() ? pastedText.trim() : ''

    // ── 合并 documentText：文档 + 网页 + 粘贴文本 ──
    const documentText = [...docTexts, ...webBlocks, pastedBlock].filter(Boolean).join('\n\n').slice(0, MAX_DOCUMENT_TEXT)

    // 输入校验：至少一份有效文档 / 网页内容 / 粘贴文本
    if (files.length > 0 && docTexts.length === 0 && webLinks.length === 0 && pastedBlock.length < 100) {
      return NextResponse.json(
        {
          error:
            '无法从上传文档提取到有效文本（可能为扫描件/图片型或加密文档），且网页链接抓取失败。' +
            '建议：① 上传可复制文本的 PDF/DOCX/PPTX（加密 PDF 请先解除密码保护后重新导出）；② 使用"粘贴项目文本"直接粘贴内容',
        },
        { status: 400 }
      )
    }
    if (files.length === 0 && webLinks.length === 0 && pastedBlock.length < 100) {
      return NextResponse.json(
        {
          error: urls.length > 0
            ? `网页链接抓取失败（${urls.join('、')}），请检查链接可访问性，或上传 BP / 粘贴项目文本`
            : '未找到上传文件，或粘贴的项目文本过短（至少 100 字）',
        },
        { status: 400 }
      )
    }

    // ── 保存文件（BP 首份文件留档；后续文件一并保存） ──
    let fileUrl = ''
    if (primaryFile) {
      await mkdir(UPLOAD_DIR, { recursive: true })
      const ext = fileExt(primaryFile.name)
      const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}.${ext}`
      await writeFile(join(UPLOAD_DIR, uniqueName), primaryFile.buffer)
      fileUrl = `/api/uploads/interpretation-docs/${uniqueName}`
    }

    // ── 建记录：项目名缺省优先用户输入 → 首份文档名 → 首个网页标题 ──
    const defaultName =
      primaryFile?.name.replace(/\.[^.]+$/, '').slice(0, 100)
      || (webLinks[0]?.title || '').slice(0, 100)
      || '粘贴文本项目'
    const record = await prisma.projectInterpretation.create({
      data: {
        userId: session.user.id,
        projectName: projectName || defaultName,
        fileName: fileNameLabel || (webLinks.length > 0 ? `${webLinks.length} 个网页链接` : '粘贴文本.txt'),
        fileUrl,
        fileType: primaryFile?.type || 'text/plain',
        fileSize: primaryFile?.size || documentText.length,
        documentText,
        status: 'UPLOADED',
        linksJson: webLinks.length > 0 ? JSON.stringify(webLinks) : null,
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
          webLinkCount: webLinks.length,
          failedLinks: failedUrls,
          autoTranscribed: !!interview?.autoTranscribed,
          createdAt: record.createdAt.toISOString(),
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Project interpretation upload error:', error)
    // 透传具体错误（如 Prisma P2021 表不存在），便于部署环境排查数据库问题
    const detail = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json({ error: `上传失败：${detail}` }, { status: 500 })
  }
}
