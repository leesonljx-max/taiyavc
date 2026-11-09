/**
 * 非分类资料池
 *
 * 上传只做快速提取（不跑 OCR），扫描件交给后台 OCR 队列；
 * OCR 完成后自动归类，置信度 ≥0.75 直接归入模块，0.5–0.75 仅建议。
 */

import { createHash } from 'crypto'
import { mkdir, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import prisma from '@/lib/prisma'
import { extractTextFromFile } from '@/lib/document-extract'
import { upsertModuleResource, type DDResourceDoc } from '@/lib/dd-workbench/resources'
import { DD_TEMPLATE_MODULES } from '@/lib/dd-workbench/template'
import { refreshGapsForProject } from '@/lib/dd-research/gap'
import { callDeepSeekJson } from '@/lib/dd-research/llm'

export const ASSET_DIR = join(process.cwd(), 'public', 'dd-unclassified')
export const ASSET_URL_PREFIX = '/dd-unclassified'
export const ASSET_MAX_SIZE = 50 * 1024 * 1024
export const ASSET_EXTENSIONS = [
  '.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.md',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
]

export function validateAsset(fileName: string, fileSize: number): { valid: boolean; error?: string } {
  const ext = '.' + (fileName.toLowerCase().split('.').pop() || '')
  if (!ASSET_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `不支持的文件类型: ${ext}，仅支持 PDF/Word/Excel/PPT/txt/md/图片` }
  }
  if (fileSize > ASSET_MAX_SIZE) {
    return { valid: false, error: '文件大小超过 50MB 限制' }
  }
  return { valid: true }
}

export interface ClassificationCandidate {
  moduleKey: string
  moduleName: string
  confidence: number
  rationale: string
}

export interface ClassificationPayload {
  summary: string
  candidates: ClassificationCandidate[]
  classifiedAt: string
}

export interface AssetView {
  id: string
  fileName: string
  fileUrl: string
  fileType: string
  fileSize: number
  ocrStatus: string
  ocrConfidence: number | null
  pageCount: number | null
  classification: ClassificationPayload | null
  status: string
  moduleKey: string | null
  error: string | null
  createdAt: Date
}

function parseClassification(raw: string | null): ClassificationPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ClassificationPayload
    if (!parsed || !Array.isArray(parsed.candidates)) return null
    return parsed
  } catch {
    return null
  }
}

export function toAssetView(asset: {
  id: string
  fileName: string
  fileUrl: string
  fileType: string
  fileSize: number
  ocrStatus: string
  ocrConfidence: number | null
  pageCount: number | null
  classificationJson: string | null
  status: string
  moduleKey: string | null
  error: string | null
  createdAt: Date
}): AssetView {
  return {
    id: asset.id,
    fileName: asset.fileName,
    fileUrl: asset.fileUrl,
    fileType: asset.fileType,
    fileSize: asset.fileSize,
    ocrStatus: asset.ocrStatus,
    ocrConfidence: asset.ocrConfidence,
    pageCount: asset.pageCount,
    classification: parseClassification(asset.classificationJson),
    status: asset.status,
    moduleKey: asset.moduleKey,
    error: asset.error,
    createdAt: asset.createdAt,
  }
}

export async function listAssets(projectId: string): Promise<AssetView[]> {
  const rows = await prisma.dDUnclassifiedAsset.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(toAssetView)
}

export interface CreateAssetResult {
  asset: AssetView
  needsOcr: boolean
  duplicate: boolean
}

export async function createAsset(input: {
  projectId: string
  userId: string
  fileName: string
  mimeType: string
  buffer: Buffer
}): Promise<CreateAssetResult> {
  const hash = createHash('sha256').update(input.buffer).digest('hex')

  const existing = await prisma.dDUnclassifiedAsset.findFirst({
    where: { projectId: input.projectId, contentHash: hash },
  })
  if (existing) {
    return { asset: toAssetView(existing), needsOcr: existing.ocrStatus === 'PENDING' || existing.ocrStatus === 'FAILED', duplicate: true }
  }

  await mkdir(ASSET_DIR, { recursive: true })
  const ext = input.fileName.split('.').pop() || 'pdf'
  const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
  await writeFile(join(ASSET_DIR, uniqueName), input.buffer)

  let text = ''
  let needsOcr = false
  try {
    const lowerExt = input.fileName.toLowerCase().split('.').pop() || ''
    if (lowerExt === 'txt' || lowerExt === 'md') {
      text = input.buffer.toString('utf8').trim()
    } else {
      const extracted = await extractTextFromFile(
        input.buffer,
        input.fileName,
        input.mimeType,
        { skipOcr: true }
      )
      text = extracted.text
      needsOcr = extracted.needsOcr || (!text && extracted.fileType === 'image')
    }
  } catch {
    text = ''
    needsOcr = true
  }

  const asset = await prisma.dDUnclassifiedAsset.create({
    data: {
      projectId: input.projectId,
      fileName: input.fileName,
      fileUrl: `${ASSET_URL_PREFIX}/${uniqueName}`,
      fileType: input.mimeType || 'application/octet-stream',
      fileSize: input.buffer.length,
      text: text || null,
      ocrStatus: needsOcr ? 'PENDING' : 'READY',
      status: 'UNCLASSIFIED',
      contentHash: hash,
      uploadedBy: input.userId,
    },
  })

  // 已有文字的资料立即归类（不阻塞上传）
  if (!needsOcr && text.trim()) {
    void classifyAsset(asset.id).catch(error => {
      console.error('[dd-ingest] 自动归类失败:', error)
    })
  }

  return { asset: toAssetView(asset), needsOcr, duplicate: false }
}

const CLASSIFY_SYSTEM = [
  '你是投资机构资料管理员。根据文件内容判断它最适合归入哪个尽调模块。',
  '只能从给定模块中选择；不确定就返回空 candidates，不要勉强归类。',
  'confidence 表示内容与模块核心问题的匹配程度（0–1）。',
  '只输出 JSON，不要输出 Markdown。',
].join('\n')

export async function classifyAsset(assetId: string): Promise<ClassificationPayload | null> {
  const asset = await prisma.dDUnclassifiedAsset.findUnique({ where: { id: assetId } })
  if (!asset) return null
  if (!asset.text || asset.text.trim().length < 20) return null

  const modules = DD_TEMPLATE_MODULES
    .map(m => `- ${m.key}（${m.name}）：${m.coreQuestion}；输入：${m.inputs}`)
    .join('\n')

  const payload = await callDeepSeekJson<{
    summary?: unknown
    candidates?: Array<{ moduleKey?: unknown; confidence?: unknown; rationale?: unknown }>
  }>({
    system: CLASSIFY_SYSTEM,
    user: [
      `文件：${asset.fileName}`,
      `模块列表：\n${modules}`,
      '',
      '文件内容（截断）：',
      asset.text.slice(0, 8000),
      '',
      '输出：{"summary":"一句话概括文件内容","candidates":[{"moduleKey":"PRODUCT_TECHNOLOGY","confidence":0.82,"rationale":"包含产品参数与检测数据"}]}',
    ].join('\n'),
    module: 'dd-ingest',
    maxTokens: 1200,
    timeoutMs: 60_000,
    temperature: 0.1,
  })

  const summary = typeof payload?.summary === 'string' ? payload.summary.slice(0, 300) : ''
  const validKeys = new Set(DD_TEMPLATE_MODULES.map(m => m.key))
  const candidates: ClassificationCandidate[] = (payload?.candidates || [])
    .flatMap(c => {
      const moduleKey = String(c.moduleKey || '')
      if (!validKeys.has(moduleKey)) return []
      const confidence = Math.max(0, Math.min(1, Number(c.confidence)))
      if (!Number.isFinite(confidence) || confidence <= 0) return []
      const tpl = DD_TEMPLATE_MODULES.find(m => m.key === moduleKey)
      return [{
        moduleKey,
        moduleName: tpl?.name || moduleKey,
        confidence: Math.round(confidence * 100) / 100,
        rationale: String(c.rationale || '').slice(0, 160),
      }]
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)

  const result: ClassificationPayload = {
    summary,
    candidates,
    classifiedAt: new Date().toISOString(),
  }

  await prisma.dDUnclassifiedAsset.update({
    where: { id: assetId },
    data: { classificationJson: JSON.stringify(result) },
  })

  if (candidates[0] && candidates[0].confidence >= 0.75) {
    await applyAssetToModule(asset.projectId, assetId, candidates[0].moduleKey)
  }

  return result
}

/** 归类/移动/取消归类：同步模块资料 JSON，并刷新缺口 */
export async function applyAssetToModule(
  projectId: string,
  assetId: string,
  moduleKey: string | null
): Promise<void> {
  const asset = await prisma.dDUnclassifiedAsset.findFirst({
    where: { id: assetId, projectId },
  })
  if (!asset) throw new Error('资料不存在')

  if (moduleKey && !DD_TEMPLATE_MODULES.some(m => m.key === moduleKey)) {
    throw new Error('无效的模块标识')
  }

  const docId = `asset-${asset.id}`

  if (asset.moduleKey && asset.moduleKey !== moduleKey) {
    await removeDocFromModule(projectId, asset.moduleKey, docId)
  }

  if (moduleKey) {
    const record = await upsertModuleResource(projectId, moduleKey)
    let docs: DDResourceDoc[] = []
    if (record.documents) {
      try {
        const parsed = JSON.parse(record.documents)
        if (Array.isArray(parsed)) docs = parsed as DDResourceDoc[]
      } catch {
        docs = []
      }
    }
    docs = docs.filter(d => d.id !== docId)
    docs.push({
      id: docId,
      fileName: asset.fileName,
      fileUrl: asset.fileUrl,
      fileType: asset.fileType,
      fileSize: asset.fileSize,
      text: asset.text || '',
      uploadedAt: new Date().toISOString(),
    })
    await prisma.dDModuleResource.update({
      where: { id: record.id },
      data: { documents: JSON.stringify(docs) },
    })
  }

  await prisma.dDUnclassifiedAsset.update({
    where: { id: asset.id },
    data: {
      moduleKey,
      status: moduleKey ? 'CLASSIFIED' : 'UNCLASSIFIED',
    },
  })

  await refreshGapsForProject(projectId)
}

async function removeDocFromModule(projectId: string, moduleKey: string, docId: string): Promise<void> {
  const record = await prisma.dDModuleResource.findUnique({
    where: { projectId_moduleKey: { projectId, moduleKey } },
  })
  if (!record?.documents) return
  try {
    const parsed = JSON.parse(record.documents)
    if (!Array.isArray(parsed)) return
    const next = parsed.filter((d: { id?: string }) => d.id !== docId)
    await prisma.dDModuleResource.update({
      where: { id: record.id },
      data: { documents: JSON.stringify(next) },
    })
  } catch {
    // 忽略损坏 JSON
  }
}

export async function deleteAsset(projectId: string, assetId: string): Promise<void> {
  const asset = await prisma.dDUnclassifiedAsset.findFirst({ where: { id: assetId, projectId } })
  if (!asset) throw new Error('资料不存在')

  if (asset.moduleKey) {
    await removeDocFromModule(projectId, asset.moduleKey, `asset-${asset.id}`)
  }

  const fileName = asset.fileUrl.split('/').pop()
  if (fileName) {
    await unlink(join(ASSET_DIR, fileName)).catch(() => undefined)
  }

  await prisma.dDUnclassifiedAsset.delete({ where: { id: asset.id } })
  await refreshGapsForProject(projectId)
}

export async function getAsset(projectId: string, assetId: string) {
  return prisma.dDUnclassifiedAsset.findFirst({ where: { id: assetId, projectId } })
}
