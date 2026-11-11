/**
 * 深度报告图片收集
 *
 * 优先级：资料中心截图 → PDF/PPTX 关键页 → 公开来源 og:image。
 * 全部限量、失败静默，不阻塞报告生成。
 */

import { Buffer } from 'buffer'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import dns from 'dns/promises'
import net from 'net'
import { buildPagedBpText, extractBpPageImages } from '@/lib/project-interpretation/bp-images'
import type { DeepContext, DeepDocument } from './context'
import type { DeepImage } from './spec'

const MAX_IMAGES = 72
const MAX_PER_MODULE = 12
const MAX_SCREENSHOTS_PER_MODULE = 8
const MAX_DOC_PAGES = 30
const MAX_OFFICE_MEDIA = 24
const MAX_WEB_IMAGES = 8
const MAX_DOC_BYTES = 30 * 1024 * 1024
const DOC_TIMEOUT_MS = 25_000
const IMAGE_KEYWORDS = /架构|拓扑|流程|示意|技术路线|产品|平台|系统|部署|客户|订单|矩阵|图谱|组织|团队|市场|规模|竞争|财务|收入|毛利|估值|融资|专利|证书/
const MEDIA_DIR = join(process.cwd(), 'public', 'interpretation-images')
const MEDIA_URL_PREFIX = '/api/uploads/interpretation-images'

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(part => Number(part))
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part))) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 0 && parts[2] === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return false
}

function isPrivateIpv6(ip: string): boolean {
  const value = ip.toLowerCase()
  if (value === '::1' || value === '::') return true
  if (value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true
  if (value.startsWith('ff')) return true
  if (value.startsWith('2001:db8')) return true
  if (value.startsWith('::ffff:')) return isPrivateIpv4(value.slice(7))
  return false
}

/** 仅允许公网 http/https 地址，防止 SSRF */
export async function isPublicHttpUrl(raw: string): Promise<boolean> {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname
    if (!host) return false
    if (host === 'localhost') return false
    if (net.isIP(host)) {
      return net.isIPv4(host) ? !isPrivateIpv4(host) : !isPrivateIpv6(host)
    }
    const records = await dns.lookup(host, { all: true })
    if (records.length === 0) return false
    return records.every(record =>
      net.isIPv4(record.address) ? !isPrivateIpv4(record.address) : !isPrivateIpv6(record.address)
    )
  } catch {
    return false
  }
}

async function safeFetch(url: string, init: RequestInit): Promise<Response | null> {
  let current = url
  for (let hop = 0; hop < 3; hop++) {
    if (!(await isPublicHttpUrl(current))) return null
    const response = await fetch(current, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return null
      current = new URL(location, current).toString()
      continue
    }
    return response
  }
  return null
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ])
}

/** 资料中心截图（URL 原样使用），每个模块最多 8 张，按篇章需要选用 */
function collectScreenshots(context: DeepContext): DeepImage[] {
  const images: DeepImage[] = []
  for (const module of context.modules) {
    for (const shot of module.screenshots.slice(0, MAX_SCREENSHOTS_PER_MODULE)) {
      images.push({
        moduleKey: module.moduleKey,
        url: shot.url,
        caption: `${module.moduleName}资料截图：${shot.fileName}`,
        source: '资料中心',
        kind: 'screenshot',
      })
    }
  }
  return images
}

function parsePagedText(paged: string): Array<{ page: number; text: string }> {
  const pages: Array<{ page: number; text: string }> = []
  const regex = /\[第(\d+)页\]\n?([\s\S]*?)(?=\[第\d+页\]|$)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(paged)) !== null) {
    const page = Number(match[1])
    if (Number.isFinite(page) && page > 0) {
      pages.push({ page, text: match[2] || '' })
    }
  }
  return pages
}

function pickKeyPages(pagedText: string, limit = 2): Array<{ page: number; text: string }> {
  const pages = parsePagedText(pagedText)
  if (pages.length === 0) return []
  const scored = pages.map(item => ({
    ...item,
    score: (item.text.match(IMAGE_KEYWORDS) || []).length,
  }))
  const hits = scored.filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.page - b.page)
  if (hits.length > 0) return hits.slice(0, limit)
  // 无关键词命中时，取封面后的前两页作为版式展示
  const fallback = pages.filter(item => item.page >= 2).slice(0, limit)
  return fallback.length > 0 ? fallback : pages.slice(0, limit)
}

function pageSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 30)
}

const LOCAL_DOC_RULES = [
  { prefix: '/research-docs/', dir: join(process.cwd(), 'public', 'research-docs'), serve: '/api/uploads/research-docs/' },
  { prefix: '/dd-unclassified/', dir: join(process.cwd(), 'public', 'dd-unclassified'), serve: '/dd-unclassified/' },
]

/** 资料中心本地文件：模块资料 / 非分类资料池，统一解析为磁盘路径与可访问 URL */
function resolveLocalDoc(fileUrl: string): { path: string; url: string } | null {
  if (!fileUrl) return null
  for (const rule of LOCAL_DOC_RULES) {
    if (!fileUrl.startsWith(rule.prefix)) continue
    const name = fileUrl.slice(rule.prefix.length)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return null
    return { path: join(rule.dir, name), url: `${rule.serve}${name}` }
  }
  return null
}

function isLocalResearchDoc(doc: DeepDocument): boolean {
  return resolveLocalDoc(doc.fileUrl) !== null
}

function localDocPath(doc: DeepDocument): string {
  return resolveLocalDoc(doc.fileUrl)?.path || ''
}

/** PDF / PPTX 关键页截图：覆盖所有有资料的模块，每模块按需最多 6 页 */
async function extractDocumentImages(context: DeepContext): Promise<{ images: DeepImage[]; notes: string[] }> {
  const images: DeepImage[] = []
  const notes: string[] = []
  let pageBudget = MAX_DOC_PAGES

  for (const module of context.modules) {
    if (pageBudget <= 0) break
    const docs = module.documents
      .filter(isLocalResearchDoc)
      .filter(doc => /\.(pdf|pptx)$/i.test(doc.fileName))
      .slice(0, 3)
    if (docs.length === 0) continue

    let moduleCount = 0
    for (const doc of docs) {
      if (pageBudget <= 0 || moduleCount >= 6) break
      const localPath = localDocPath(doc)
      const result = await withTimeout(
        (async () => {
          const info = await stat(localPath)
          if (!info.size || info.size > MAX_DOC_BYTES) return null
          const buffer = await readFile(localPath)
          const paged = await buildPagedBpText(buffer, doc.fileName)
          if (!paged) return null
          const pages = pickKeyPages(paged, Math.min(3, pageBudget))
          if (pages.length === 0) return null
          const extracted = await extractBpPageImages(
            buffer,
            doc.fileName,
            pages.map(item => item.page),
            `deep-${context.base.project.id}-${module.moduleKey}`
          )
          const textByPage = new Map(pages.map(item => [item.page, item.text]))
          return extracted.map(item => ({
            ...item,
            snippet: pageSnippet(textByPage.get(item.page) || ''),
          }))
        })(),
        DOC_TIMEOUT_MS
      )

      if (!result || result.length === 0) {
        notes.push(`${module.moduleName}：${doc.fileName} 未能提取架构图/流程图。`)
        continue
      }

      for (const item of result) {
        if (pageBudget <= 0 || moduleCount >= 6) break
        for (const url of item.url.split(';').filter(Boolean)) {
          if (pageBudget <= 0 || moduleCount >= 6) break
          images.push({
            moduleKey: module.moduleKey,
            url,
            caption: `${doc.fileName} 第 ${item.page} 页${item.snippet ? `：${item.snippet}` : ''}`,
            source: `资料中心 · ${doc.fileName}`,
            kind: 'doc',
          })
          pageBudget -= 1
          moduleCount += 1
        }
      }
    }
  }

  return { images, notes }
}

/** DOCX/XLSX/PPTX 内嵌图片（没有可渲染页面时的兜底） */
async function extractOfficeMedia(context: DeepContext): Promise<DeepImage[]> {
  const images: DeepImage[] = []
  let budget = MAX_OFFICE_MEDIA

  for (const module of context.modules) {
    if (budget <= 0 || images.length >= MAX_IMAGES) break
    const docs = module.documents
      .filter(isLocalResearchDoc)
      .filter(doc => /\.(docx|xlsx|pptx)$/i.test(doc.fileName))
      .slice(0, 3)

    for (const doc of docs) {
      if (budget <= 0) break
      const media = await withTimeout(
        (async () => {
          const info = await stat(localDocPath(doc))
          if (!info.size || info.size > MAX_DOC_BYTES) return null
          const buffer = await readFile(localDocPath(doc))
          const JSZip = (await import('jszip')).default
          const zip = await JSZip.loadAsync(buffer)
          const entries = Object.values(zip.files)
            .filter(file => !file.dir && /^(word|xl|ppt)\/media\/[^/]+\.(png|jpe?g|gif|webp)$/i.test(file.name))
            .slice(0, 10)
          const out: Array<{ data: Buffer; ext: string }> = []
          for (const entry of entries) {
            const data = await entry.async('nodebuffer')
            if (data.length < 30 * 1024 || data.length > 2 * 1024 * 1024) continue
            const ext = (entry.name.split('.').pop() || 'png').toLowerCase()
            out.push({ data, ext })
            if (out.length >= 4) break
          }
          return out
        })(),
        DOC_TIMEOUT_MS
      )
      if (!media || media.length === 0) continue

      await mkdir(MEDIA_DIR, { recursive: true })
      for (const item of media) {
        if (budget <= 0) break
        const name = `deep-${context.base.project.id}-${module.moduleKey}-media-${budget}.${item.ext}`
        await writeFile(join(MEDIA_DIR, name), item.data)
        images.push({
          moduleKey: module.moduleKey,
          url: `${MEDIA_URL_PREFIX}/${name}`,
          caption: `${doc.fileName} 内嵌图`,
          source: `资料中心 · ${doc.fileName}`,
          kind: 'doc',
        })
        budget -= 1
      }
    }
  }

  return images
}

/** 直接上传的图片资料（模块资料 / 非分类资料池），按需全部收集 */
function collectImageDocs(context: DeepContext): DeepImage[] {
  const images: DeepImage[] = []
  for (const module of context.modules) {
    for (const doc of module.documents) {
      if (!/\.(png|jpe?g|webp|gif)$/i.test(doc.fileName)) continue
      const local = resolveLocalDoc(doc.fileUrl)
      if (!local) continue
      images.push({
        moduleKey: module.moduleKey,
        url: local.url,
        caption: doc.fileName,
        source: `资料中心 · ${doc.fileName}`,
        kind: 'doc',
      })
    }
  }
  return images
}

function parseOgImage(html: string, baseUrl: string): string | null {
  const patterns = [
    /<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image(?::secure_url)?["']/i,
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (!match?.[1]) continue
    try {
      const resolved = new URL(match[1], baseUrl).toString()
      if (/^https?:\/\//i.test(resolved)) return resolved
    } catch {
      // 忽略非法 URL
    }
  }
  return null
}

async function collectWebImages(context: DeepContext): Promise<DeepImage[]> {
  const images: DeepImage[] = []
  const seenDomains = new Set<string>()

  const candidates = context.base.sources
    .filter(source => source.grade === 'A' || source.grade === 'B')
    .filter(source => {
      if (seenDomains.has(source.domain)) return false
      seenDomains.add(source.domain)
      return true
    })
    .slice(0, 8)

  for (const source of candidates) {
    if (images.length >= MAX_WEB_IMAGES) break
    try {
      const page = await safeFetch(source.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InvestraskBot/1.0)' },
      })
      if (!page || !page.ok) continue
      const contentType = page.headers.get('content-type') || ''
      if (!contentType.includes('text/html')) continue
      const html = (await page.text()).slice(0, 300_000)
      const imageUrl = parseOgImage(html, source.url)
      if (!imageUrl) continue

      const check = await safeFetch(imageUrl, { method: 'HEAD' })
      if (!check || !check.ok) continue
      const imageType = check.headers.get('content-type') || ''
      if (!imageType.startsWith('image/')) continue
      const length = Number(check.headers.get('content-length') || '0')
      if (Number.isFinite(length) && length > 2 * 1024 * 1024) continue

      images.push({
        moduleKey: source.moduleKey,
        url: imageUrl,
        caption: source.title,
        source: `${source.title} · ${source.domain}`,
        kind: 'web',
      })
    } catch {
      // 网络图片失败静默
    }
  }

  return images
}

export async function collectDeepImages(context: DeepContext): Promise<{ images: DeepImage[]; notes: string[] }> {
  const notes: string[] = []
  const screenshots = collectScreenshots(context)
  const docResult = await extractDocumentImages(context)
  const officeMedia = await extractOfficeMedia(context)
  const imageDocs = collectImageDocs(context)
  notes.push(...docResult.notes)

  // BP/PPT 关键页优先，其次资料截图与内嵌图，保证每个模块先拿到可引用的原文页面
  let images = [...docResult.images, ...screenshots, ...officeMedia, ...imageDocs]
  if (images.length < MAX_IMAGES) {
    const web = await collectWebImages(context)
    images = [...images, ...web]
  }

  // 去重 + 每模块限额 + 总量限额
  const seen = new Set<string>()
  const perModule = new Map<string, number>()
  images = images.filter(image => {
    if (seen.has(image.url)) return false
    const count = perModule.get(image.moduleKey) || 0
    if (count >= MAX_PER_MODULE) return false
    seen.add(image.url)
    perModule.set(image.moduleKey, count + 1)
    return true
  }).slice(0, MAX_IMAGES)

  if (images.length < 3) {
    notes.push('本次仅收集到少量可展示的架构图/流程图，报告以文字、表格与统计图表为主。')
  }

  return { images, notes }
}
