/**
 * 非分类资料 OCR 队列
 *
 * 上传接口只做快速文本提取；扫描 PDF / 图片在这里后台识别。
 * 并发 2，进程重启后恢复 PENDING，超时 PROCESSING 重新排队。
 */

import { readFile } from 'fs/promises'
import { join } from 'path'
import prisma from '@/lib/prisma'
import { extractTextFromFile } from '@/lib/document-extract'
import { ASSET_DIR, classifyAsset } from './unclassified'

const CONCURRENCY = 2
const POLL_MS = 15_000
const STALE_MS = 10 * 60_000

const waiting: string[] = []
const queued = new Set<string>()
let active = 0
let started = false
let timer: ReturnType<typeof setInterval> | null = null
let recovering: Promise<void> | null = null

export function enqueueAssetOcr(assetId: string): void {
  if (!assetId || queued.has(assetId)) return
  queued.add(assetId)
  waiting.push(assetId)
  ensureStarted()
}

function ensureStarted(): void {
  if (started) return
  started = true
  void (async () => {
    await recoverStale()
    pump()
  })()
  timer = setInterval(() => {
    void pump()
  }, POLL_MS)
  timer.unref?.()
}

async function recoverStale(): Promise<void> {
  if (recovering) return recovering
  recovering = (async () => {
    try {
      await prisma.dDUnclassifiedAsset.updateMany({
        where: { ocrStatus: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
        data: { ocrStatus: 'PENDING', error: 'OCR 超时，已重新排队' },
      })
      const rows = await prisma.dDUnclassifiedAsset.findMany({
        where: { ocrStatus: 'PENDING', updatedAt: { lt: new Date(Date.now() - 5_000) } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 10,
      })
      for (const row of rows) enqueueAssetOcr(row.id)
    } catch (error) {
      console.error('[dd-ingest] 恢复 OCR 队列失败:', error)
    } finally {
      recovering = null
    }
  })()
  return recovering
}

async function processAsset(assetId: string): Promise<void> {
  const asset = await prisma.dDUnclassifiedAsset.findUnique({ where: { id: assetId } })
  if (!asset) return
  if (asset.ocrStatus !== 'PENDING' && asset.ocrStatus !== 'FAILED' && asset.ocrStatus !== 'PROCESSING') return

  await prisma.dDUnclassifiedAsset.update({
    where: { id: assetId },
    data: { ocrStatus: 'PROCESSING', error: null },
  })

  try {
    const fileName = asset.fileUrl.split('/').pop() || ''
    if (!fileName) throw new Error('文件路径无效')
    const buffer = await readFile(join(ASSET_DIR, fileName))
    const extracted = await extractTextFromFile(
      buffer,
      asset.fileName,
      asset.fileType,
      { skipOcr: false }
    )
    const text = extracted.text.trim()

    if (!text) {
      await prisma.dDUnclassifiedAsset.update({
        where: { id: assetId },
        data: {
          ocrStatus: 'FAILED',
          error: 'OCR 未识别出可用文字，请上传清晰版本或补充文本框说明',
        },
      })
      return
    }

    await prisma.dDUnclassifiedAsset.update({
      where: { id: assetId },
      data: {
        text,
        ocrStatus: 'READY',
        error: null,
      },
    })

    // OCR 完成后自动归类（失败不影响资料可用）
    await classifyAsset(assetId).catch(error => {
      console.error('[dd-ingest] OCR 后归类失败:', error)
    })
  } catch (error) {
    await prisma.dDUnclassifiedAsset.update({
      where: { id: assetId },
      data: {
        ocrStatus: 'FAILED',
        error: error instanceof Error ? error.message.slice(0, 300) : 'OCR 失败',
      },
    }).catch(() => undefined)
  }
}

function pump(): void {
  while (active < CONCURRENCY && waiting.length > 0) {
    const assetId = waiting.shift() as string
    active += 1
    void processAsset(assetId)
      .catch(error => {
        console.error(`[dd-ingest] OCR 队列异常 ${assetId}:`, error)
      })
      .finally(() => {
        active -= 1
        queued.delete(assetId)
        pump()
      })
  }
}

export async function retryAssetOcr(assetId: string): Promise<void> {
  await prisma.dDUnclassifiedAsset.update({
    where: { id: assetId },
    data: { ocrStatus: 'PENDING', error: null },
  })
  enqueueAssetOcr(assetId)
}
