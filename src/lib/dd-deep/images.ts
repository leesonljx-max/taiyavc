/**
 * 深度报告图片收集
 *
 * 优先级：资料中心截图 → PDF/PPTX 关键页 → 公开来源 og:image。
 * 全部限量、失败静默，不阻塞报告生成。
 */

import { Buffer } from 'buffer'
import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import dns from 'dns/promises'
import net from 'net'
import { buildPagedBpText, extractBpPageImages } from '@/lib/project-interpretation/bp-images'
import type { DeepContext } from './context'
import type { DeepImage } from './spec'

const MAX_IMAGES = 10
const MAX_SCREENSHOTS = 6
const MAX_DOC_PAGES = 6
const MAX_WEB_IMAGES = 4
const MAX_DOC_BYTES = 30 * 1024 * 1024
const DOC_TIMEOUT_MS = 20_000
const IMAGE_KEYWORDS = /架构|拓扑|流程|示意|技术路线|产品|平台|系统|部署|客户|订单|矩阵|图谱/

const IMAGE_MODULES = new Set([
  'PROJECT_ENTITY',
  'PRODUCT_TECHNOLOGY',
  'MARKET_CUSTOMERS',
  'COMMERCIALIZATION',
])

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

/** 资料中心截图（URL 原样使用） */
function collectScreenshots(context: DeepContext): DeepImage[] {
  const images: DeepImage[] = []
  for (const module of context.modules) {
    for (const shot of module.screenshots) {
      if (images.length >= MAX_SCREENSHOTS) return images
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

function pickKeyPages(pagedText: string): number[] {
  const pages = parsePagedText(pagedText)
  if (pages.length === 0) return []
  const scored = pages.map(item => ({
    page: item.page,
    score: (item.text.match(IMAGE_KEYWORDS) || []).length,
  }))
  const hits = scored.filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.page - b.page)
  if (hits.length > 0) return hits.slice(0, 2).map(item => item.page)
  // 无关键词命中时，取封面后的前两页作为版式展示
  const fallback = pages.filter(item => item.page >= 2).slice(0, 2).map(item => item.page)
  return fallback.length > 0 ? fallback : [pages[0].page]
}

async function extractDocumentImages(context: DeepContext): Promise<{ images: DeepImage[]; notes: string[] }> {
  const images: DeepImage[] = []
  const notes: string[] = []
  let pageBudget = MAX_DOC_PAGES

  for (const module of context.modules) {
    if (!IMAGE_MODULES.has(module.moduleKey)) continue
    if (images.length >= MAX_SCREENSHOTS + MAX_DOC_PAGES || pageBudget <= 0) break

    const doc = module.documents.find(item => {
      if (!item.fileUrl) return false
      if (!/^\/research-docs\/[A-Za-z0-9._-]+$/.test(item.fileUrl)) return false
      return /\.(pdf|pptx)$/i.test(item.fileName)
    })
    if (!doc) continue

    const fileName = doc.fileUrl.replace('/research-docs/', '')
    const localPath = join(process.cwd(), 'public', 'research-docs', fileName)

    const result = await withTimeout(
      (async () => {
        const info = await stat(localPath)
        if (!info.size || info.size > MAX_DOC_BYTES) return null
        const buffer = await readFile(localPath)
        const paged = await buildPagedBpText(buffer, doc.fileName)
        if (!paged) return null
        const pages = pickKeyPages(paged).slice(0, Math.min(2, pageBudget))
        if (pages.length === 0) return null
        const extracted = await extractBpPageImages(
          buffer,
          doc.fileName,
          pages,
          `deep-${context.base.project.id}-${module.moduleKey}`
        )
        return extracted
      })(),
      DOC_TIMEOUT_MS
    )

    if (!result || result.length === 0) {
      notes.push(`${module.moduleName}：${doc.fileName} 未能提取架构图/流程图。`)
      continue
    }

    for (const item of result) {
      if (images.length >= MAX_SCREENSHOTS + MAX_DOC_PAGES) break
      images.push({
        moduleKey: module.moduleKey,
        url: item.url,
        caption: `${doc.fileName} 第 ${item.page} 页`,
        source: `资料中心 · ${doc.fileName}`,
        kind: 'doc',
      })
      pageBudget -= 1
    }
  }

  return { images, notes }
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
  notes.push(...docResult.notes)

  let images = [...screenshots, ...docResult.images]
  if (images.length < MAX_IMAGES) {
    const web = await collectWebImages(context)
    images = [...images, ...web]
  }

  // 按模块去重，保留上限
  const seen = new Set<string>()
  images = images.filter(image => {
    if (seen.has(image.url)) return false
    seen.add(image.url)
    return true
  }).slice(0, MAX_IMAGES)

  if (images.length === 0) {
    notes.push('本次未能收集到可展示的架构图/流程图，报告以文字、表格与统计图表为主。')
  }

  return { images, notes }
}
