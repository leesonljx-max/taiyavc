/**
 * V2.3.0 测试：多模态视觉工具
 * - 文本框粘贴的截图 → [图N] 占位 + 图片提取（本地文件存在时转 data URI）
 * - buildMessageContent：有图 → content 数组（text + image_url）；无图 → 纯文本
 */

import './helpers/setup'

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, unlink, mkdir } from 'fs/promises'
import { join } from 'path'
import { buildMultimodalDigest, buildMessageContent } from '@/lib/dd-workbench/vision'

// 合法的 1x1 PNG
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const IMG_DIR = join(process.cwd(), 'public', 'project-images')
const writtenFiles: string[] = []

after(async () => {
  for (const f of writtenFiles) await unlink(f).catch(() => {})
})

test('视觉工具：img → [图N] 占位 + dataUri 提取（文件存在/缺失分治）；外链图片被拒绝', async () => {
  const name = `test-vision-${Date.now()}.png`
  await mkdir(IMG_DIR, { recursive: true })
  await writeFile(join(IMG_DIR, name), Buffer.from(PNG_BASE64, 'base64'))
  writtenFiles.push(join(IMG_DIR, name))

  const { plain, images } = await buildMultimodalDigest([
    {
      content:
        '<p>产品介绍：</p><img src="/api/uploads/project-images/' + name + '" alt="产品图">' +
        '<img src="/api/uploads/project-images/not-exist.png">' +
        '<img src="https://evil.com/x.png">',
    },
    { content: '<p>纯文本框，无图片。</p>' },
  ])

  // 占位：本地图 → [图1]；缺失文件 → [图2]（仍占位，但无 dataUri）；外链 → 被剥除不占位
  assert.ok(plain.includes('[图1]'), '本地图应替换为 [图1] 占位')
  assert.ok(plain.includes('[图2]'), '缺失文件的本地图仍应占位 [图2]')
  assert.ok(plain.includes('产品介绍'), '文本内容应保留')
  assert.ok(!plain.includes('evil.com'), '外链图片应被拒绝')

  // 图片列表：两张本地图（含缺失文件）；外链不进入
  assert.equal(images.length, 2)
  assert.equal(images[0].marker, '图1')
  assert.match(images[0].dataUri!, /^data:image\/png;base64,/, '存在文件应转 data URI')
  assert.equal(images[1].dataUri, undefined, '缺失文件不产生 dataUri')

  // buildMessageContent：有可用图 → content 数组（仅包含有 dataUri 的图）
  const content = buildMessageContent('分析文本', images)
  assert.ok(Array.isArray(content), '有可用图片时应返回 content 数组')
  const parts = content as Array<{ type: string; text?: string; image_url?: { url: string } }>
  assert.equal(parts[0].type, 'text')
  assert.ok(parts[0].text!.includes('分析文本'))
  const imgParts = parts.filter(p => p.type === 'image_url')
  assert.equal(imgParts.length, 1, '仅 dataUri 存在的图进入消息')
  assert.match(imgParts[0].image_url!.url, /^data:image\/png;base64,/)

  // 无可用图 → 纯文本字符串（兼容普通调用）
  const noImage = buildMessageContent('分析文本', [{ marker: '图1', src: '/api/uploads/project-images/none.png' }])
  assert.equal(typeof noImage, 'string')
})
