/**
 * 前端图片压缩工具（截图上传前压缩，解决小带宽服务器上传慢的问题）
 *
 * 背景：Mac 截图粘贴的 PNG 通常 2-5MB，公网上传到小带宽 CVM 需要数分钟。
 * 通过 Canvas 将截图限制最大边长并转为 JPEG（质量 0.85），
 * 体积一般可缩小 90%（5MB → 300-500KB），上传时间同步缩短。
 *
 * 压缩策略：
 * - GIF 不压缩（会破坏动画）
 * - 小于 300KB 的图不压缩（收益低，直接上传）
 * - 最大边长 1600px（足够截图文字清晰阅读），等比缩放
 * - 输出 JPEG 质量 0.85；若压缩后反而更大（极端色块图），回退原图
 * - PNG 透明通道会被填充白色（JPEG 无透明）
 */

const MAX_EDGE = 1600
const QUALITY = 0.85
const SKIP_COMPRESS_THRESHOLD = 300 * 1024 // 300KB 以下不压缩

/** 等待图片解码完成 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解码失败'))
    }
    img.src = url
  })
}

/**
 * 压缩图片文件。无法压缩时（格式不支持/解码失败/压完更大）原样返回。
 */
export async function compressImage(file: File): Promise<File> {
  // GIF 动图与小于阈值的小图：不处理
  if (file.type === 'image/gif' || file.size <= SKIP_COMPRESS_THRESHOLD) {
    return file
  }
  // 仅处理浏览器可解码的位图格式
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    return file
  }

  try {
    const img = await loadImage(file)

    // 等比缩放到最大边长
    let { width, height } = img
    if (Math.max(width, height) > MAX_EDGE) {
      const scale = MAX_EDGE / Math.max(width, height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file

    // PNG 透明通道填充白色（JPEG 不支持透明）
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY)
    )
    if (!blob || blob.size >= file.size) {
      return file // 压缩无效，回退原图
    }

    // 生成压缩后的 File（保留原文件名主干，扩展名改为 jpg）
    const baseName = (file.name || 'image').replace(/\.[^.]+$/, '')
    const compressed = new File([blob], `${baseName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    })
    console.log(
      `[ImageCompress] ${(file.size / 1024).toFixed(0)}KB → ${(blob.size / 1024).toFixed(0)}KB (${Math.round((1 - blob.size / file.size) * 100)}% 缩减)`
    )
    return compressed
  } catch (err) {
    console.error('[ImageCompress] 压缩失败，使用原图上传:', err)
    return file
  }
}
