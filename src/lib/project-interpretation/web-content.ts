/**
 * 网页链接内容抓取（项目解读：BP 之外可粘贴网页链接，合并分析）
 *
 * - 服务端 fetch + HTML 正文提取（去 script/style/标签，保留文本结构）
 * - 单链接 15s 超时；正文截断 12000 字（防超长页面）
 * - 失败/非 HTML 静默跳过（返回 null，不阻塞上传）
 */

export interface WebLinkContent {
  url: string
  title: string
  content: string
}

/** 从粘贴文本解析 URL 列表（换行/空格/逗号分隔；最多 5 个） */
export function parseUrlsFromText(text: string, max = 5): string[] {
  const raw = (text || '')
    .split(/[\s,，;；]+/)
    .map(s => s.trim())
    .filter(Boolean)
  const urls: string[] = []
  for (const item of raw) {
    const candidate = /^https?:\/\//i.test(item) ? item : `https://${item}`
    try {
      const u = new URL(candidate)
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')) {
        if (!urls.includes(u.href)) urls.push(u.href)
      }
    } catch { /* 非法 URL 跳过 */ }
    if (urls.length >= max) break
  }
  return urls
}

/** HTML 正文提取：去 script/style/nav 等噪声，标签转换行，压缩空行 */
function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<(?:nav|footer|header|aside|noscript)\b[^>]*>[\s\S]*?<\/(?:nav|footer|header|aside|noscript)>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/(?:p|div|br|li|tr|h[1-6]|section|article|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

/** 提取页面标题 */
function extractTitle(html: string, url: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  if (og?.[1]) return decodeEntities(og[1]).slice(0, 100)
  const t = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  if (t?.[1] && t[1].trim()) return decodeEntities(t[1]).slice(0, 100)
  try {
    return new URL(url).hostname
  } catch {
    return url.slice(0, 100)
  }
}

function decodeEntities(s: string): string {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

/**
 * 抓取单个网页：15s 超时；content-type 非 HTML 时跳过；
 * 成功返回 { url, title, content(≤12000字) }，失败返回 null
 */
export async function fetchWebLinkContent(url: string): Promise<WebLinkContent | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('html')) return null
    const html = (await res.text()).slice(0, 600000) // HTML 源码上限 600KB
    const title = extractTitle(html, url)
    const content = htmlToText(html).slice(0, 12000)
    if (content.length < 50) return null // 无有效正文
    return { url, title, content }
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

/** 批量抓取（并发，单链接失败跳过）；至少一条成功才返回数组 */
export async function fetchWebLinks(urls: string[]): Promise<WebLinkContent[]> {
  if (urls.length === 0) return []
  const results = await Promise.all(urls.map(u => fetchWebLinkContent(u)))
  return results.filter((r): r is WebLinkContent => r !== null)
}
