import COS from 'cos-nodejs-sdk-v5'

let cosInstance: COS | null = null

function getCos(): COS | null {
  if (cosInstance !== null) return cosInstance
  const secretId = process.env.COS_SECRET_ID
  const secretKey = process.env.COS_SECRET_KEY
  const bucket = process.env.COS_BUCKET
  const region = process.env.COS_REGION
  if (!secretId || !secretKey || !bucket || !region) return null
  cosInstance = new COS({ SecretId: secretId, SecretKey: secretKey })
  return cosInstance
}

export function isCosConfigured(): boolean {
  return getCos() !== null
}

/** 对象访问地址：配置了 CDN 域名则优先走 CDN，否则用 COS 默认域名 */
export function cosUrlFor(key: string): string {
  const cdnBase = (process.env.COS_CDN_BASE_URL || '').trim().replace(/\/+$/, '')
  if (cdnBase) return `${cdnBase}/${key}`
  const bucket = process.env.COS_BUCKET!
  const region = process.env.COS_REGION!
  return `https://${bucket}.cos.${region}.myqcloud.com/${key}`
}

export async function uploadToCos(buffer: Buffer, key: string, contentType: string): Promise<string | null> {
  const cos = getCos()
  if (!cos) return null
  const bucket = process.env.COS_BUCKET!
  const region = process.env.COS_REGION!
  await cos.putObject({
    Bucket: bucket,
    Region: region,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  })
  return cosUrlFor(key)
}

/** 从访问 URL 反解 COS Key（支持 CDN 域名与 COS 默认域名） */
export function cosKeyFromUrl(url: string): string | null {
  if (!url) return null
  const cdnBase = (process.env.COS_CDN_BASE_URL || '').trim().replace(/\/+$/, '')
  if (cdnBase && url.startsWith(`${cdnBase}/`)) {
    return url.slice(cdnBase.length + 1).split('?')[0] || null
  }
  if (url.includes('.myqcloud.com/')) {
    return url.split('.myqcloud.com/')[1].split('?')[0] || null
  }
  return null
}

export async function deleteCosByUrl(url: string): Promise<void> {
  const key = cosKeyFromUrl(url)
  if (key) await deleteFromCos(key)
}

export async function deleteFromCos(key: string): Promise<void> {
  const cos = getCos()
  if (!cos) return
  const bucket = process.env.COS_BUCKET!
  const region = process.env.COS_REGION!
  await cos.deleteObject({ Bucket: bucket, Region: region, Key: key })
}
