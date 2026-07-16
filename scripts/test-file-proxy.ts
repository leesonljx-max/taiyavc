/**
 * 文件代理 API 测试用例
 *
 * 测试目标：
 * 1. 验证 /api/uploads/[...path]/route.ts 存在且语法正确
 * 2. 验证 next.config.js 包含 rewrites 规则
 * 3. 验证 rewrites 规则覆盖三个上传目录
 * 4. 验证 API 路由的安全检查逻辑
 * 5. 验证 MIME 类型映射完整
 * 6. 验证上传 API 返回的 URL 路径与 rewrites 规则匹配
 */

import fs from 'fs'
import path from 'path'

interface TestResult {
  name: string
  passed: boolean
  detail?: string
}

const results: TestResult[] = []

function test(name: string, fn: () => void | string) {
  try {
    const detail = fn()
    results.push({ name, passed: true, detail: typeof detail === 'string' ? detail : undefined })
  } catch (e) {
    results.push({ name, passed: false, detail: e instanceof Error ? e.message : String(e) })
  }
}

const projectRoot = path.resolve(__dirname, '..')

// ============ 1. API 路由文件存在性测试 ============

test('API 路由文件存在: src/app/api/uploads/[...path]/route.ts', () => {
  const filePath = path.join(projectRoot, 'src/app/api/uploads/[...path]/route.ts')
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`)
  }
  return '存在'
})

test('API 路由包含 dynamic 声明', () => {
  const filePath = path.join(projectRoot, 'src/app/api/uploads/[...path]/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes("export const dynamic = 'force-dynamic'")) {
    throw new Error('缺少 export const dynamic = "force-dynamic"')
  }
})

test('API 路由包含 GET 函数', () => {
  const filePath = path.join(projectRoot, 'src/app/api/uploads/[...path]/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes('export async function GET')) {
    throw new Error('缺少 GET 函数')
  }
})

// ============ 2. 安全检查测试 ============

test('API 路由包含路径遍历防护', () => {
  const filePath = path.join(projectRoot, 'src/app/api/uploads/[...path]/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes('..')) {
    throw new Error('缺少路径遍历防护（..检查）')
  }
})

test('API 路由包含目录白名单', () => {
  const filePath = path.join(projectRoot, 'src/app/api/uploads/[...path]/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes('ALLOWED_DIRS')) {
    throw new Error('缺少目录白名单')
  }
  if (!content.includes("'avatars'")) {
    throw new Error('白名单缺少 avatars')
  }
  if (!content.includes("'project-docs'")) {
    throw new Error('白名单缺少 project-docs')
  }
  if (!content.includes("'project-images'")) {
    throw new Error('白名单缺少 project-images')
  }
})

// ============ 3. MIME 类型测试 ============

test('API 路由包含 PDF MIME 类型', () => {
  const filePath = path.join(projectRoot, 'src/app/api/uploads/[...path]/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes("'.pdf': 'application/pdf'")) {
    throw new Error('缺少 PDF MIME 类型')
  }
})

test('API 路由包含 PNG MIME 类型', () => {
  const filePath = path.join(projectRoot, 'src/app/api/uploads/[...path]/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes("'.png': 'image/png'")) {
    throw new Error('缺少 PNG MIME 类型')
  }
})

test('API 路由包含 JPEG MIME 类型', () => {
  const filePath = path.join(projectRoot, 'src/app/api/uploads/[...path]/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes("'.jpg': 'image/jpeg'") || !content.includes("'.jpeg': 'image/jpeg'")) {
    throw new Error('缺少 JPEG MIME 类型')
  }
})

test('API 路由包含 PPT MIME 类型', () => {
  const filePath = path.join(projectRoot, 'src/app/api/uploads/[...path]/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes('.ppt')) {
    throw new Error('缺少 PPT MIME 类型')
  }
  if (!content.includes('.pptx')) {
    throw new Error('缺少 PPTX MIME 类型')
  }
})

// ============ 4. next.config.js rewrites 测试 ============

test('next.config.js 包含 rewrites 函数', () => {
  const configPath = path.join(projectRoot, 'next.config.js')
  const content = fs.readFileSync(configPath, 'utf-8')
  if (!content.includes('async rewrites()')) {
    throw new Error('next.config.js 缺少 rewrites 函数')
  }
})

test('rewrites 包含 /avatars/ 规则', () => {
  const configPath = path.join(projectRoot, 'next.config.js')
  const content = fs.readFileSync(configPath, 'utf-8')
  if (!content.includes("source: '/avatars/:path*'")) {
    throw new Error('rewrites 缺少 /avatars/ 规则')
  }
  if (!content.includes("destination: '/api/uploads/avatars/:path*'")) {
    throw new Error('rewrites /avatars/ 目标不正确')
  }
})

test('rewrites 包含 /project-docs/ 规则', () => {
  const configPath = path.join(projectRoot, 'next.config.js')
  const content = fs.readFileSync(configPath, 'utf-8')
  if (!content.includes("source: '/project-docs/:path*'")) {
    throw new Error('rewrites 缺少 /project-docs/ 规则')
  }
  if (!content.includes("destination: '/api/uploads/project-docs/:path*'")) {
    throw new Error('rewrites /project-docs/ 目标不正确')
  }
})

test('rewrites 包含 /project-images/ 规则', () => {
  const configPath = path.join(projectRoot, 'next.config.js')
  const content = fs.readFileSync(configPath, 'utf-8')
  if (!content.includes("source: '/project-images/:path*'")) {
    throw new Error('rewrites 缺少 /project-images/ 规则')
  }
  if (!content.includes("destination: '/api/uploads/project-images/:path*'")) {
    throw new Error('rewrites /project-images/ 目标不正确')
  }
})

// ============ 5. 上传 API URL 一致性测试 ============

test('头像上传 API 返回 /avatars/ 路径（与 rewrites 匹配）', () => {
  const filePath = path.join(projectRoot, 'src/app/api/user/avatar/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes('/avatars/')) {
    throw new Error('头像上传 API 未使用 /avatars/ 路径')
  }
})

test('文档上传 API 返回 /project-docs/ 路径（与 rewrites 匹配）', () => {
  const filePath = path.join(projectRoot, 'src/app/api/projects/[id]/documents/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes('/project-docs/')) {
    throw new Error('文档上传 API 未使用 /project-docs/ 路径')
  }
})

test('图片上传 API 返回 /project-images/ 路径（与 rewrites 匹配）', () => {
  const filePath = path.join(projectRoot, 'src/app/api/upload/image/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes('/project-images/')) {
    throw new Error('图片上传 API 未使用 /project-images/ 路径')
  }
})

// ============ 6. 上传目录和 .gitkeep 测试 ============

const requiredDirs = ['public/avatars', 'public/project-docs', 'public/project-images']

for (const dir of requiredDirs) {
  test(`上传目录存在: ${dir}`, () => {
    const fullPath = path.join(projectRoot, dir)
    if (!fs.existsSync(fullPath)) {
      throw new Error(`目录不存在: ${fullPath}`)
    }
    const stat = fs.statSync(fullPath)
    if (!stat.isDirectory()) {
      throw new Error(`不是目录: ${fullPath}`)
    }
  })

  test(`.gitkeep 存在: ${dir}/.gitkeep`, () => {
    const fullPath = path.join(projectRoot, dir, '.gitkeep')
    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件不存在: ${fullPath}`)
    }
  })
}

// ============ 7. .gitignore 配置测试 ============

test('.gitignore 正确配置（保留目录，忽略文件内容）', () => {
  const gitignorePath = path.join(projectRoot, '.gitignore')
  const content = fs.readFileSync(gitignorePath, 'utf-8')

  const checks = [
    { pattern: '/public/avatars/*', shouldExist: true },
    { pattern: '!/public/avatars/.gitkeep', shouldExist: true },
    { pattern: '/public/project-docs/*', shouldExist: true },
    { pattern: '!/public/project-docs/.gitkeep', shouldExist: true },
    { pattern: '/public/project-images/*', shouldExist: true },
    { pattern: '!/public/project-images/.gitkeep', shouldExist: true },
  ]

  for (const check of checks) {
    const exists = content.includes(check.pattern)
    if (check.shouldExist && !exists) {
      throw new Error(`.gitignore 缺少: ${check.pattern}`)
    }
    if (!check.shouldExist && exists) {
      throw new Error(`.gitignore 不应包含: ${check.pattern}`)
    }
  }
})

// ============ 8. 文件存储路径一致性测试 ============

test('头像 API 使用 public/avatars/ 存储路径', () => {
  const filePath = path.join(projectRoot, 'src/app/api/user/avatar/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  // path.join(process.cwd(), 'public', 'avatars') 或 'public/avatars'
  if (!(content.includes("'public'") && content.includes("'avatars'")) && !content.includes('public/avatars')) {
    throw new Error('头像 API 未使用 public/avatars 存储路径')
  }
})

test('文档 API 使用 public/project-docs/ 存储路径', () => {
  const filePath = path.join(projectRoot, 'src/app/api/projects/[id]/documents/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!(content.includes("'public'") && content.includes("'project-docs'")) && !content.includes('public/project-docs')) {
    throw new Error('文档 API 未使用 public/project-docs 存储路径')
  }
})

test('图片 API 使用 public/project-images/ 存储路径', () => {
  const filePath = path.join(projectRoot, 'src/app/api/upload/image/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!(content.includes("'public'") && content.includes("'project-images'")) && !content.includes('public/project-images')) {
    throw new Error('图片 API 未使用 public/project-images 存储路径')
  }
})

// ============ 输出结果 ============

console.log('\n========================================')
console.log('  文件代理 API 测试结果')
console.log('========================================\n')

let passed = 0
let failed = 0

for (const r of results) {
  const icon = r.passed ? '✅' : '❌'
  console.log(`${icon} ${r.name}`)
  if (r.detail && !r.passed) {
    console.log(`   详情: ${r.detail}`)
  }
  if (r.passed) passed++
  else failed++
}

console.log('\n----------------------------------------')
console.log(`总计: ${results.length} | 通过: ${passed} | 失败: ${failed}`)
console.log('----------------------------------------\n')

if (failed > 0) {
  console.error('❌ 存在失败的测试用例！')
  process.exit(1)
} else {
  console.log('✅ 全部测试通过！')
}
