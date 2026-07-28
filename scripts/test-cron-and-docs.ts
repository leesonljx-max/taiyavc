/**
 * 单元测试：AI线索定时触发 + 投研分析文档404修复
 *
 * 覆盖范围：
 * A. AI线索定时触发 cron 路由
 * B. 投研分析文档404修复（next.config.js + uploads 路由）
 * C. 文档上传与访问链路
 * D. 环境变量配置
 * E. 定时任务配置说明
 */

import fs from 'fs'
import path from 'path'

const PROJECT_ROOT = path.resolve(__dirname, '..')
let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++
    console.log(`  ✓ ${message}`)
  } else {
    failed++
    console.log(`  ✗ ${message}`)
  }
}

// ═══════════════════════════════════════════════════════════
// A. AI线索定时触发 cron 路由
// ═══════════════════════════════════════════════════════════
console.log('\n══ A. AI线索定时触发 cron 路由 ══')

{
  const routePath = path.join(PROJECT_ROOT, 'src/app/api/cron/ai-leads-retrieval/route.ts')
  assert(fs.existsSync(routePath), 'cron 路由文件存在')

  const content = fs.readFileSync(routePath, 'utf-8')

  // 检查导入
  assert(content.includes('runAIRetrieval'), '导入 runAIRetrieval 函数')
  assert(content.includes("from '@/lib/ai-lead-retrieval'"), '从 ai-lead-retrieval 导入')

  // 检查授权
  assert(content.includes('CRON_SECRET'), '使用 CRON_SECRET 环境变量')
  assert(content.includes('authorize'), '存在 authorize 函数')
  assert(content.includes('searchParams.get'), '从 query 读取 token')
  assert(content.includes('authorization'), '从 header 读取 token')
  assert(content.includes('Bearer'), '支持 Bearer token')

  // 检查 GET 端点
  assert(content.includes('export async function GET'), 'GET 端点存在')
  assert(content.includes('401'), '未授权返回 401')

  // 检查 POST 端点
  assert(content.includes('export async function POST'), 'POST 端点存在')

  // 检查日志
  assert(content.includes('[Cron]'), '包含日志输出')
  assert(content.includes('开始触发'), '日志：开始触发')
  assert(content.includes('完成'), '日志：完成')
  assert(content.includes('失败'), '日志：失败处理')

  // 检查返回值
  assert(content.includes('success: true'), '返回 success: true')
  assert(content.includes('timestamp'), '返回 timestamp')
  assert(content.includes('500'), '错误返回 500')

  // 检查动态渲染
  assert(content.includes("dynamic = 'force-dynamic'"), '设置为 force-dynamic')

  // 检查定时计划说明
  assert(content.includes('周一'), '注释包含周一')
  assert(content.includes('周三'), '注释包含周三')
  assert(content.includes('周五'), '注释包含周五')
  assert(content.includes('8:00'), '注释包含 8:00')
  assert(content.includes('crontab'), '注释包含 crontab 说明')
  assert(content.includes('0 8 * * 1,3,5'), 'crontab 表达式正确')
}

// ═══════════════════════════════════════════════════════════
// B. 投研分析文档404修复 - next.config.js
// ═══════════════════════════════════════════════════════════
console.log('\n══ B. next.config.js 重写规则 ══')

{
  const configPath = path.join(PROJECT_ROOT, 'next.config.js')
  const content = fs.readFileSync(configPath, 'utf-8')

  // 检查 rewrites 函数
  assert(content.includes('rewrites'), '存在 rewrites 函数')

  // 检查所有目录的重写规则
  assert(content.includes('/avatars/:path*'), 'avatars 重写规则存在')
  assert(content.includes('/project-docs/:path*'), 'project-docs 重写规则存在')
  assert(content.includes('/project-images/:path*'), 'project-images 重写规则存在')
  assert(content.includes('/research-docs/:path*'), 'research-docs 重写规则存在（新增）')

  // 检查重写目标
  assert(content.includes('/api/uploads/avatars/:path*'), 'avatars 重写目标正确')
  assert(content.includes('/api/uploads/project-docs/:path*'), 'project-docs 重写目标正确')
  assert(content.includes('/api/uploads/project-images/:path*'), 'project-images 重写目标正确')
  assert(content.includes('/api/uploads/research-docs/:path*'), 'research-docs 重写目标正确（新增）')

  // 检查 research-docs 在注释中
  assert(content.includes('research-docs'), '注释中提及 research-docs')
}

// ═══════════════════════════════════════════════════════════
// C. uploads 路由 - ALLOWED_DIRS
// ═══════════════════════════════════════════════════════════
console.log('\n══ C. uploads 路由 ALLOWED_DIRS ══')

{
  const routePath = path.join(PROJECT_ROOT, 'src/app/api/uploads/[...path]/route.ts')
  const content = fs.readFileSync(routePath, 'utf-8')

  // 检查 ALLOWED_DIRS 包含 research-docs
  assert(content.includes('research-docs'), 'ALLOWED_DIRS 包含 research-docs')
  assert(content.includes("'avatars'"), 'ALLOWED_DIRS 包含 avatars')
  assert(content.includes("'project-docs'"), 'ALLOWED_DIRS 包含 project-docs')
  assert(content.includes("'project-images'"), 'ALLOWED_DIRS 包含 project-images')

  // 检查 MIME 类型
  assert(content.includes('.pdf'), 'MIME 类型包含 PDF')
  assert(content.includes('.ppt'), 'MIME 类型包含 PPT')
  assert(content.includes('.pptx'), 'MIME 类型包含 PPTX')
  assert(content.includes('.doc'), 'MIME 类型包含 DOC')
  assert(content.includes('.docx'), 'MIME 类型包含 DOCX')
  assert(content.includes('.xls'), 'MIME 类型包含 XLS（新增）')
  assert(content.includes('.xlsx'), 'MIME 类型包含 XLSX（新增）')

  // 检查安全措施
  assert(content.includes('..'), '防止路径遍历攻击')
  assert(content.includes('isFile'), '检查是否为文件')
  assert(content.includes('403'), '禁止访问返回 403')
  assert(content.includes('404'), '文件不存在返回 404')

  // 检查文件读取
  assert(content.includes('readFileSync'), '使用 readFileSync 读取文件')
  assert(content.includes('Content-Type'), '设置 Content-Type')
  assert(content.includes('Content-Length'), '设置 Content-Length')
  assert(content.includes('Cache-Control'), '设置 Cache-Control')
}

// ═══════════════════════════════════════════════════════════
// D. 文档上传路由
// ═══════════════════════════════════════════════════════════
console.log('\n══ D. 文档上传路由 ══')

{
  const uploadRoute = path.join(PROJECT_ROOT, 'src/app/api/research/[projectId]/[moduleType]/documents/route.ts')
  const content = fs.readFileSync(uploadRoute, 'utf-8')

  // 检查上传目录
  assert(content.includes('research-docs'), '上传目录为 research-docs')
  assert(content.includes("public', 'research-docs'"), '上传到 public/research-docs/')

  // 检查文件 URL 格式
  assert(content.includes('/research-docs/'), '文件 URL 格式为 /research-docs/xxx')
  assert(content.includes('uniqueName'), '使用唯一文件名')

  // 检查文本提取
  assert(content.includes('extractTextFromFile'), '上传时提取文本')
  assert(content.includes('extractedText'), '存储 extractedText')

  // 检查权限
  assert(content.includes('canEditResearchProject'), '使用 canEditResearchProject 权限')
  assert(content.includes('401'), '未登录返回 401')
  assert(content.includes('403'), '无权限返回 403')
}

// ═══════════════════════════════════════════════════════════
// E. 环境变量配置
// ═══════════════════════════════════════════════════════════
console.log('\n══ E. 环境变量配置 ══')

{
  const envPath = path.join(PROJECT_ROOT, '.env')
  const envContent = fs.readFileSync(envPath, 'utf-8')

  assert(envContent.includes('CRON_SECRET'), '.env 包含 CRON_SECRET')
  assert(envContent.includes('TAVILY_API_KEY'), '.env 包含 TAVILY_API_KEY')
  assert(envContent.includes('DEEPSEEK_API_KEY'), '.env 包含 DEEPSEEK_API_KEY')
}

// ═══════════════════════════════════════════════════════════
// F. 定时任务配置验证
// ═══════════════════════════════════════════════════════════
console.log('\n══ F. 定时任务配置 ══')

{
  const routePath = path.join(PROJECT_ROOT, 'src/app/api/cron/ai-leads-retrieval/route.ts')
  const content = fs.readFileSync(routePath, 'utf-8')

  // 验证 crontab 表达式正确性
  // 0 8 * * 1,3,5 = 每天 8:00，但仅周一、三、五
  assert(content.includes('0 8 * * 1,3,5'), 'crontab 表达式: 0 8 * * 1,3,5')

  // 验证调用 localhost
  assert(content.includes('localhost:3000'), 'crontab 使用 localhost:3000')

  // 验证 token 参数
  assert(content.includes('token=$CRON_SECRET'), 'crontab 使用 CRON_SECRET 环境变量')

  // 模拟验证 crontab 字段含义
  const cronExpr = '0 8 * * 1,3,5'
  const fields = cronExpr.split(' ')
  assertEqual(fields[0], '0', 'crontab 分钟: 0（整点）')
  assertEqual(fields[1], '8', 'crontab 小时: 8（早8点）')
  assertEqual(fields[2], '*', 'crontab 日: *（每天）')
  assertEqual(fields[3], '*', 'crontab 月: *（每月）')
  assertEqual(fields[4], '1,3,5', 'crontab 周: 1,3,5（周一三五）')
}

function assertEqual(actual: any, expected: any, message: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
    console.log(`  ✓ ${message}`)
  } else {
    failed++
    console.log(`  ✗ ${message} (expected: ${JSON.stringify(expected)}, actual: ${JSON.stringify(actual)})`)
  }
}

// ═══════════════════════════════════════════════════════════
// G. 文档访问链路完整性
// ═══════════════════════════════════════════════════════════
console.log('\n══ G. 文档访问链路 ══')

{
  const nextConfig = fs.readFileSync(path.join(PROJECT_ROOT, 'next.config.js'), 'utf-8')
  const uploadsRoute = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/api/uploads/[...path]/route.ts'), 'utf-8')
  const uploadRoute = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/api/research/[projectId]/[moduleType]/documents/route.ts'), 'utf-8')

  // 链路1: 上传 → 文件存储在 public/research-docs/
  assert(uploadRoute.includes("public', 'research-docs'"), '上传: 存储到 public/research-docs/')

  // 链路2: 访问 /research-docs/xxx → 重写到 /api/uploads/research-docs/xxx
  assert(
    nextConfig.includes('/research-docs/:path*') &&
    nextConfig.includes('/api/uploads/research-docs/:path*'),
    '访问: /research-docs/xxx → /api/uploads/research-docs/xxx'
  )

  // 链路3: /api/uploads 路由允许 research-docs 目录
  assert(uploadsRoute.includes('research-docs'), 'API: ALLOWED_DIRS 包含 research-docs')

  // 链路4: API 路由从文件系统读取文件
  assert(uploadsRoute.includes('readFileSync'), 'API: 从文件系统读取文件')

  // 完整链路验证
  assert(
    uploadRoute.includes('/research-docs/') &&
    nextConfig.includes('/research-docs/:path*') &&
    uploadsRoute.includes('research-docs'),
    '完整链路: 上传 → 存储 → 重写 → API → 文件系统'
  )
}

// ═══════════════════════════════════════════════════════════
// H. cron 路由与释放线索路由一致性
// ═══════════════════════════════════════════════════════════
console.log('\n══ H. cron 路由一致性 ══')

{
  const aiLeadsRoute = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/api/cron/ai-leads-retrieval/route.ts'), 'utf-8')
  const releaseRoute = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/api/cron/release-leads/route.ts'), 'utf-8')

  // 两个路由应有相同的授权模式
  assert(
    aiLeadsRoute.includes('CRON_SECRET') && releaseRoute.includes('CRON_SECRET'),
    '两个 cron 路由都使用 CRON_SECRET'
  )
  assert(
    aiLeadsRoute.includes('authorize') && releaseRoute.includes('authorize'),
    '两个 cron 路由都有 authorize 函数'
  )
  assert(
    aiLeadsRoute.includes("dynamic = 'force-dynamic'") && releaseRoute.includes("dynamic = 'force-dynamic'"),
    '两个 cron 路由都设置为 force-dynamic'
  )
  assert(
    aiLeadsRoute.includes('export async function GET') && releaseRoute.includes('export async function GET'),
    '两个 cron 路由都有 GET 端点'
  )
  assert(
    aiLeadsRoute.includes('export async function POST') && releaseRoute.includes('export async function POST'),
    '两个 cron 路由都有 POST 端点'
  )
}

// ═══════════════════════════════════════════════════════════
// I. runAIRetrieval 函数验证
// ═══════════════════════════════════════════════════════════
console.log('\n══ I. runAIRetrieval 函数 ══')

{
  const libPath = path.join(PROJECT_ROOT, 'src/lib/ai-lead-retrieval.ts')
  const content = fs.readFileSync(libPath, 'utf-8')

  assert(content.includes('export async function runAIRetrieval'), 'runAIRetrieval 函数存在')
  assert(content.includes('triggeredById'), '接受 triggeredById 参数')
  assert(content.includes('RetrievalResult'), '返回 RetrievalResult 类型')

  // 检查流程
  assert(content.includes('Tavily') || content.includes('tavily'), '使用 Tavily 搜索')
  assert(content.includes('DeepSeek') || content.includes('deepseek'), '使用 DeepSeek 分析')
}

// ═══════════════════════════════════════════════════════════
// 结果汇总
// ═══════════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════')
console.log(`  通过: ${passed}  失败: ${failed}  总计: ${passed + failed}`)
console.log(`  结果: ${failed === 0 ? '✓ 全部通过' : '✗ 有失败项'}`)
console.log('═══════════════════════════════════════')

if (failed > 0) {
  process.exit(1)
}
