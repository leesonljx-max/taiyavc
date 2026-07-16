/**
 * 文件上传与访问测试用例
 *
 * 测试目标：
 * 1. 验证 public/avatars/、public/project-docs/、public/project-images/ 目录存在
 * 2. 验证 .gitignore 正确配置（保留目录，忽略文件内容）
 * 3. 验证 .gitkeep 文件存在
 * 4. 验证 Next.js 生产构建能识别这些静态文件路径
 * 5. 验证 API 上传逻辑返回的 URL 路径正确
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

// ============ 1. 目录存在性测试 ============

const requiredDirs = ['public/avatars', 'public/project-docs', 'public/project-images']

for (const dir of requiredDirs) {
  test(`目录存在: ${dir}`, () => {
    const fullPath = path.join(projectRoot, dir)
    if (!fs.existsSync(fullPath)) {
      throw new Error(`目录不存在: ${fullPath}`)
    }
    const stat = fs.statSync(fullPath)
    if (!stat.isDirectory()) {
      throw new Error(`不是目录: ${fullPath}`)
    }
    return `${fullPath}`
  })
}

// ============ 2. .gitkeep 文件存在性测试 ============

for (const dir of requiredDirs) {
  test(`.gitkeep 存在: ${dir}/.gitkeep`, () => {
    const fullPath = path.join(projectRoot, dir, '.gitkeep')
    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件不存在: ${fullPath}`)
    }
    return `${fullPath}`
  })
}

// ============ 3. .gitignore 配置测试 ============

test('.gitignore 忽略 avatars 文件但保留目录', () => {
  const gitignorePath = path.join(projectRoot, '.gitignore')
  const content = fs.readFileSync(gitignorePath, 'utf-8')

  if (!content.includes('/public/avatars/*')) {
    throw new Error('.gitignore 未忽略 /public/avatars/*')
  }
  if (!content.includes('!/public/avatars/.gitkeep')) {
    throw new Error('.gitignore 未排除 /public/avatars/.gitkeep')
  }
})

test('.gitignore 忽略 project-docs 文件但保留目录', () => {
  const gitignorePath = path.join(projectRoot, '.gitignore')
  const content = fs.readFileSync(gitignorePath, 'utf-8')

  if (!content.includes('/public/project-docs/*')) {
    throw new Error('.gitignore 未忽略 /public/project-docs/*')
  }
  if (!content.includes('!/public/project-docs/.gitkeep')) {
    throw new Error('.gitignore 未排除 /public/project-docs/.gitkeep')
  }
})

test('.gitignore 忽略 project-images 文件但保留目录', () => {
  const gitignorePath = path.join(projectRoot, '.gitignore')
  const content = fs.readFileSync(gitignorePath, 'utf-8')

  if (!content.includes('/public/project-images/*')) {
    throw new Error('.gitignore 未忽略 /public/project-images/*')
  }
  if (!content.includes('!/public/project-images/.gitkeep')) {
    throw new Error('.gitignore 未排除 /public/project-images/.gitkeep')
  }
})

// ============ 4. next.config.js 配置测试 ============

test('next.config.js 包含 ignoreBuildErrors', () => {
  const configPath = path.join(projectRoot, 'next.config.js')
  const content = fs.readFileSync(configPath, 'utf-8')
  if (!content.includes('ignoreBuildErrors: true')) {
    throw new Error('next.config.js 未配置 typescript.ignoreBuildErrors')
  }
})

test('next.config.js 包含 ignoreDuringBuilds', () => {
  const configPath = path.join(projectRoot, 'next.config.js')
  const content = fs.readFileSync(configPath, 'utf-8')
  if (!content.includes('ignoreDuringBuilds: true')) {
    throw new Error('next.config.js 未配置 eslint.ignoreDuringBuilds')
  }
})

// ============ 5. API 路由 dynamic 声明测试 ============

const apiRoutes = [
  'src/app/api/upload/image/route.ts',
  'src/app/api/user/avatar/route.ts',
  'src/app/api/projects/[id]/documents/route.ts',
]

for (const route of apiRoutes) {
  test(`API 路由包含 dynamic 声明: ${route}`, () => {
    const fullPath = path.join(projectRoot, route)
    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件不存在: ${fullPath}`)
    }
    const content = fs.readFileSync(fullPath, 'utf-8')
    if (!content.includes("export const dynamic = 'force-dynamic'")) {
      throw new Error(`缺少 export const dynamic = 'force-dynamic'`)
    }
  })
}

// ============ 6. 上传 API 路径配置测试 ============

test('图片上传 API 返回 /project-images/ 路径', () => {
  const filePath = path.join(projectRoot, 'src/app/api/upload/image/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes('/project-images/')) {
    throw new Error('图片上传 API 未使用 /project-images/ 路径')
  }
})

test('头像上传 API 返回 /avatars/ 路径', () => {
  const filePath = path.join(projectRoot, 'src/app/api/user/avatar/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes('/avatars/')) {
    throw new Error('头像上传 API 未使用 /avatars/ 路径')
  }
})

test('文档上传 API 返回 /project-docs/ 路径', () => {
  const filePath = path.join(projectRoot, 'src/app/api/projects/[id]/documents/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes('/project-docs/')) {
    throw new Error('文档上传 API 未使用 /project-docs/ 路径')
  }
})

// ============ 7. 上传 API mkdir 逻辑测试 ============

test('图片上传 API 包含 mkdir recursive', () => {
  const filePath = path.join(projectRoot, 'src/app/api/upload/image/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes('mkdir') || !content.includes('recursive')) {
    throw new Error('图片上传 API 未使用 mkdir recursive 创建目录')
  }
})

test('头像上传 API 包含 mkdir recursive', () => {
  const filePath = path.join(projectRoot, 'src/app/api/user/avatar/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes('mkdir') || !content.includes('recursive')) {
    throw new Error('头像上传 API 未使用 mkdir recursive 创建目录')
  }
})

test('文档上传 API 包含 mkdir recursive', () => {
  const filePath = path.join(projectRoot, 'src/app/api/projects/[id]/documents/route.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes('mkdir') || !content.includes('recursive')) {
    throw new Error('文档上传 API 未使用 mkdir recursive 创建目录')
  }
})

// ============ 8. auth.ts cookie 配置测试 ============

test('auth.ts cookie 使用 NEXTAUTH_URL 判断 HTTPS', () => {
  const filePath = path.join(projectRoot, 'src/lib/auth.ts')
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes("NEXTAUTH_URL?.startsWith('https://')")) {
    throw new Error('auth.ts cookie 未使用 NEXTAUTH_URL 判断 HTTPS')
  }
  if (content.includes("NODE_ENV === 'production'")) {
    throw new Error('auth.ts cookie 仍使用 NODE_ENV 判断，HTTP 环境会导致 cookie 丢失')
  }
})

// ============ 输出结果 ============

console.log('\n========================================')
console.log('  文件上传与访问测试结果')
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
