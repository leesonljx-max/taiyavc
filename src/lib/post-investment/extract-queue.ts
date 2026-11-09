/**
 * 投后资料后台识别队列（进程内，单机部署适用）
 *
 * 上传接口只做「快速解析」（文本型 PDF/Word/Excel 直接出文本），
 * 扫描件/图片等需要 OCR 的文档标记 PENDING 后立即返回，
 * 由本队列按并发 1-2 在后台识别，避免 OCR 把上传请求拖到几十秒甚至超时。
 *
 * 队列以数据库状态为准（PENDING → PROCESSING → READY / FAILED），
 * 进程重启后，轮询任务会把滞留的 PENDING 文档重新捡起来。
 */

import prisma from '@/lib/prisma'
import { extractTextFromFile, stripNul } from '@/lib/document-extract'
import { isCosConfigured, uploadToCos } from '@/lib/cos'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

const DOC_DIR = join(process.cwd(), 'public', 'post-investment-docs')
const THUMB_DIR = join(process.cwd(), 'public', 'post-investment-thumbs')

/** 同时识别的文档数（默认 2，可用环境变量收敛到 1） */
const CONCURRENCY = Math.min(
  2,
  Math.max(1, Number.parseInt(process.env.POST_INVEST_EXTRACT_CONCURRENCY || '2', 10) || 2)
)
/** 轮询间隔：兜底恢复进程重启后滞留的任务 */
const POLL_MS = 20_000
/** PROCESSING 超过该时长视为卡死，重新排队 */
const STALE_MS = 10 * 60_000

const waiting: string[] = []
const queued = new Set<string>()
let active = 0
let started = false
let timer: ReturnType<typeof setInterval> | null = null

/** 把文档加入识别队列（重复入队自动去重） */
export function enqueueDocExtraction(docId: string): void {
  if (!docId || queued.has(docId)) return
  queued.add(docId)
  waiting.push(docId)
  ensureStarted()
}

/** 启动后台队列（惰性启动，只在首次入队时执行） */
function ensureStarted(): void {
  if (started) return
  started = true
  void pump(true)
  timer = setInterval(() => { void pump(true) }, POLL_MS)
  // 测试/构建进程不因该定时器挂住
  timer.unref?.()
}

async function pump(recover: boolean): Promise<void> {
  if (recover) {
    await recoverStale().catch(error => console.error('[post-invest] 恢复滞留任务失败:', error))
  }
  while (active < CONCURRENCY && waiting.length > 0) {
    const docId = waiting.shift()!
    active++
    void runJob(docId)
      .catch(error => console.error(`[post-invest] 后台识别异常 ${docId}:`, error))
      .finally(() => {
        active--
        queued.delete(docId)
        void pump(false)
      })
  }
}

/** 进程重启/异常退出后的兜底：卡死的 PROCESSING 重置，滞留的 PENDING 重新入队 */
async function recoverStale(): Promise<void> {
  await prisma.postInvestDoc.updateMany({
    where: { textStatus: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
    data: { textStatus: 'PENDING', textError: '识别超时，已重新排队' },
  })
  const rows = await prisma.postInvestDoc.findMany({
    where: {
      textStatus: 'PENDING',
      updatedAt: { lt: new Date(Date.now() - 10_000) },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  })
  for (const row of rows) enqueueDocExtraction(row.id)
}

async function runJob(docId: string): Promise<void> {
  const doc = await prisma.postInvestDoc.findUnique({ where: { id: docId } })
  if (!doc || !doc.fileUrl) return

  if (doc.textStatus === 'PENDING') {
    // 原子认领，避免多进程/重复入队导致同一文档被识别两次
    const claimed = await prisma.postInvestDoc.updateMany({
      where: { id: docId, textStatus: 'PENDING' },
      data: { textStatus: 'PROCESSING', textError: null },
    })
    if (claimed.count === 0) return

    try {
      const buffer = await readDocBuffer(doc.fileUrl)
      if (!buffer) throw new Error('原文件不存在或无法读取')

      const ext = '.' + (doc.fileName.toLowerCase().split('.').pop() || '')
      const { text } = ext === '.txt' || ext === '.md'
        ? { text: stripNul(buffer.toString('utf8')).trim() }
        : await extractTextFromFile(buffer, doc.fileName, doc.fileType)

      const finalText = text.trim()
      await prisma.postInvestDoc.update({
        where: { id: docId },
        data: {
          text: finalText,
          textStatus: finalText ? 'READY' : 'FAILED',
          textError: finalText ? null : '未能识别出文字，请确认文件内容或扫描清晰度',
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : '识别失败'
      await prisma.postInvestDoc
        .update({ where: { id: docId }, data: { textStatus: 'FAILED', textError: message } })
        .catch(() => {})
      console.error(`[post-invest] 资料识别失败 ${docId}:`, error)
      // 识别失败也继续生成缩略图：扫描件仍可正常预览，只是不能参与 AI 分析
    }
  }

  // PDF 首页缩略图：预览弹窗先显示缩略图，用户点击后才加载完整文件
  const isPdf = doc.fileType === 'application/pdf' || doc.fileName.toLowerCase().endsWith('.pdf')
  if (isPdf && !doc.thumbUrl) {
    await ensureThumbnail(doc.id, doc.fileUrl)
  }
}

async function ensureThumbnail(docId: string, fileUrl: string): Promise<void> {
  try {
    const buffer = await readDocBuffer(fileUrl)
    if (!buffer) return

    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buffer })
    try {
      const shot = await parser.getScreenshot({
        partial: [1],
        desiredWidth: 480,
        imageBuffer: true,
        imageDataUrl: false,
      })
      const page = shot.pages[0]
      if (!page?.data || page.data.length === 0) {
        await prisma.postInvestDoc.update({ where: { id: docId }, data: { thumbUrl: '' } })
        return
      }
      const thumb = Buffer.from(page.data)

      let url: string | null = null
      if (isCosConfigured()) {
        url = await uploadToCos(thumb, `post-investment-thumbs/${docId}.png`, 'image/png').catch(() => null)
      }
      if (!url) {
        await mkdir(THUMB_DIR, { recursive: true })
        await writeFile(join(THUMB_DIR, `${docId}.png`), thumb)
        url = `/api/uploads/post-investment-thumbs/${docId}.png`
      }
      await prisma.postInvestDoc.update({ where: { id: docId }, data: { thumbUrl: url } })
    } finally {
      await parser.destroy().catch(() => {})
    }
  } catch (error) {
    console.error(`[post-invest] 缩略图生成失败 ${docId}:`, error)
    // 标记为「已尝试」，避免每次轮询重复渲染
    await prisma.postInvestDoc.update({ where: { id: docId }, data: { thumbUrl: '' } }).catch(() => {})
  }
}

/** 读取原文件：COS/CDN 走 HTTPS，本地走 public 目录 */
async function readDocBuffer(fileUrl: string): Promise<Buffer | null> {
  if (/^https?:\/\//i.test(fileUrl)) {
    try {
      const res = await fetch(fileUrl)
      if (!res.ok) return null
      return Buffer.from(await res.arrayBuffer())
    } catch {
      return null
    }
  }
  const m = fileUrl.match(/\/(?:api\/uploads\/)?post-investment-docs\/([A-Za-z0-9._-]+)$/)
  if (!m) return null
  try {
    return await readFile(join(DOC_DIR, m[1]))
  } catch {
    return null
  }
}
