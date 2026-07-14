/**
 * 测试脚本：项目文档上传/预览/删除功能
 *
 * 测试覆盖：
 * A. Prisma schema - ProjectDocument 模型
 *   1. schema 中存在 ProjectDocument 模型
 *   2. ProjectDocument 包含 projectId 字段
 *   3. ProjectDocument 包含 fileName 字段
 *   4. ProjectDocument 包含 fileUrl 字段
 *   5. ProjectDocument 包含 fileType 字段
 *   6. ProjectDocument 包含 fileSize 字段（Int）
 *   7. ProjectDocument 包含 uploadedById 字段
 *   8. ProjectDocument 包含 createdAt 字段
 *   9. Project 模型包含 documents 关系字段
 *  10. User 模型包含 projectDocuments 反向关系字段
 *  11. ProjectDocument 有 projectId 索引
 *
 * B. 文档列表 API (GET /api/projects/[id]/documents)
 *  12. route.ts 存在
 *  13. GET 函数存在
 *  14. 鉴权：未登录返回 401
 *  15. session.user.id 缺失返回 401（登录已过期）
 *  16. 项目不存在返回 404
 *  17. 使用 canViewProject 权限校验
 *  18. 无权查看返回 403
 *  19. 按 createdAt 倒序排序
 *  20. 包含 uploadedBy 关联查询
 *
 * C. 文档上传 API (POST /api/projects/[id]/documents)
 *  21. POST 函数存在
 *  22. 鉴权：未登录返回 401
 *  23. 使用 canEditProject 权限校验
 *  24. 无权上传返回 403
 *  25. 文件类型白名单：PDF / PPT / PPTX
 *  26. 文件大小限制 50MB
 *  27. COS 优先 + 本地 fallback
 *  28. 本地存储路径为 public/project-docs/
 *  29. 返回 document 对象（包含 id/fileName/fileUrl/fileType/fileSize）
 *
 * D. 文档删除 API (DELETE /api/projects/[id]/documents/[docId])
 *  30. [docId]/route.ts 存在
 *  31. DELETE 函数存在
 *  32. 鉴权：未登录返回 401
 *  33. 使用 canEditProject 权限校验
 *  34. 文档不存在返回 404
 *  35. 校验 docId 属于 projectId
 *  36. 删除本地文件（仅当 URL 以 /project-docs/ 开头）
 *  37. 删除数据库记录
 *
 * E. 文档预览模态组件 (DocumentPreviewModal)
 *  38. 组件文件存在
 *  39. 接收 open/onClose/fileName/fileUrl/fileType props
 *  40. open=false 时不渲染
 *  41. ESC 键关闭模态框
 *  42. PDF 使用 iframe 嵌入预览
 *  43. PPT/PPTX 显示下载提示
 *  44. 内容区域支持滚动（overflow-auto）
 *  45. 提供下载按钮
 *  46. 点击遮罩关闭模态框
 *
 * F. 项目详情页集成
 *  47. 导入 DocumentPreviewModal
 *  48. 存在 ProjectDocument 接口
 *  49. 存在 documents 状态
 *  50. 存在 uploadingDoc 状态
 *  51. 存在 previewDoc 状态
 *  52. 存在 fetchDocuments 函数
 *  53. 存在 handleUploadDocument 函数
 *  54. 存在 handleDeleteDocument 函数
 *  55. fetchProject 中调用 fetchDocuments
 *  56. 项目文档卡片位于竞争态势分析上方
 *  57. 上传按钮仅在 canEdit 时显示
 *  58. 文档列表显示文件名/大小/上传时间/上传人
 *  59. 点击文档触发预览（setPreviewDoc）
 *  60. 删除按钮仅在 canEdit 时显示
 *  61. 渲染 DocumentPreviewModal 组件
 *  62. accept 属性包含 PDF/PPT/PPTX
 */
import 'dotenv/config'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

interface TestResult { name: string; passed: boolean; detail?: string }
const results: TestResult[] = []

function log(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail })
  console.log(`${passed ? '✓' : '✗'} ${name}${!passed && detail ? ` — ${detail}` : ''}`)
}

async function readSrc(relPath: string): Promise<string> {
  return readFile(join(process.cwd(), relPath), 'utf-8')
}

// ========== A. Prisma schema ==========

async function testSchema() {
  console.log('\n━━━ A. Prisma schema - ProjectDocument 模型 ━━━\n')

  const schemaSrc = await readSrc('prisma/schema.prisma')

  log(
    'A1: schema 中存在 ProjectDocument 模型',
    /model\s+ProjectDocument\s*\{/.test(schemaSrc)
  )
  log(
    'A2: ProjectDocument 包含 projectId 字段',
    /model\s+ProjectDocument\s*\{[\s\S]*?projectId\s+String/.test(schemaSrc)
  )
  log(
    'A3: ProjectDocument 包含 fileName 字段',
    /model\s+ProjectDocument\s*\{[\s\S]*?fileName\s+String/.test(schemaSrc)
  )
  log(
    'A4: ProjectDocument 包含 fileUrl 字段',
    /model\s+ProjectDocument\s*\{[\s\S]*?fileUrl\s+String/.test(schemaSrc)
  )
  log(
    'A5: ProjectDocument 包含 fileType 字段',
    /model\s+ProjectDocument\s*\{[\s\S]*?fileType\s+String/.test(schemaSrc)
  )
  log(
    'A6: ProjectDocument 包含 fileSize 字段（Int）',
    /model\s+ProjectDocument\s*\{[\s\S]*?fileSize\s+Int/.test(schemaSrc)
  )
  log(
    'A7: ProjectDocument 包含 uploadedById 字段',
    /model\s+ProjectDocument\s*\{[\s\S]*?uploadedById\s+String/.test(schemaSrc)
  )
  log(
    'A8: ProjectDocument 包含 createdAt 字段',
    /model\s+ProjectDocument\s*\{[\s\S]*?createdAt\s+DateTime/.test(schemaSrc)
  )
  log(
    'A9: Project 模型包含 documents 关系字段',
    /model\s+Project\s*\{[\s\S]*?documents\s+ProjectDocument\[\]/.test(schemaSrc)
  )
  log(
    'A10: User 模型包含 projectDocuments 反向关系字段',
    /model\s+User\s*\{[\s\S]*?projectDocuments\s+ProjectDocument\[\]/.test(schemaSrc)
  )
  log(
    'A11: ProjectDocument 有 projectId 索引',
    /model\s+ProjectDocument\s*\{[\s\S]*?@@index\(\[projectId\]\)/.test(schemaSrc)
  )
}

// ========== B. 文档列表 API ==========

async function testListApi() {
  console.log('\n━━━ B. 文档列表 API (GET) ━━━\n')

  const apiExists = existsSync(join(process.cwd(), 'src/app/api/projects/[id]/documents/route.ts'))
  log('B12: route.ts 存在', apiExists)

  if (!apiExists) return

  const apiSrc = await readSrc('src/app/api/projects/[id]/documents/route.ts')

  log(
    'B13: GET 函数存在',
    /export async function GET/.test(apiSrc)
  )
  log(
    'B14: 鉴权：未登录返回 401',
    apiSrc.includes("未登录") && apiSrc.includes('401')
  )
  log(
    "B15: session.user.id 缺失返回 401（登录已过期）",
    apiSrc.includes('登录已过期，请退出后重新登录')
  )
  log(
    'B16: 项目不存在返回 404',
    apiSrc.includes('项目不存在') && apiSrc.includes('404')
  )
  log(
    'B17: 使用 canViewProject 权限校验',
    apiSrc.includes('canViewProject')
  )
  log(
    'B18: 无权查看返回 403',
    apiSrc.includes('无权查看该项目') && apiSrc.includes('403')
  )
  log(
    'B19: 按 createdAt 倒序排序',
    /orderBy:\s*\{\s*createdAt:\s*['"]desc['"]\s*\}/.test(apiSrc)
  )
  log(
    'B20: 包含 uploadedBy 关联查询',
    /include:\s*\{[\s\S]*?uploadedBy:\s*\{[\s\S]*?select:/.test(apiSrc)
  )
}

// ========== C. 文档上传 API ==========

async function testUploadApi() {
  console.log('\n━━━ C. 文档上传 API (POST) ━━━\n')

  const apiSrc = await readSrc('src/app/api/projects/[id]/documents/route.ts')

  log(
    'C21: POST 函数存在',
    /export async function POST/.test(apiSrc)
  )
  log(
    'C22: 鉴权：未登录返回 401',
    /export async function POST[\s\S]{0,1500}未登录[\s\S]{0,100}401/.test(apiSrc)
  )
  log(
    'C23: 使用 canEditProject 权限校验',
    apiSrc.includes('canEditProject')
  )
  log(
    'C24: 无权上传返回 403',
    apiSrc.includes('无权上传文档') && apiSrc.includes('403')
  )
  log(
    'C25: 文件类型白名单 PDF/PPT/PPTX',
    apiSrc.includes('application/pdf') &&
    apiSrc.includes('application/vnd.ms-powerpoint') &&
    apiSrc.includes('application/vnd.openxmlformats-officedocument.presentationml.presentation')
  )
  log(
    'C26: 文件大小限制 50MB',
    apiSrc.includes('50 * 1024 * 1024')
  )
  log(
    'C27: COS 优先 + 本地 fallback',
    apiSrc.includes('isCosConfigured()') && apiSrc.includes('uploadToCos')
  )
  log(
    'C28: 本地存储路径为 public/project-docs/',
    apiSrc.includes("'public', 'project-docs'") || apiSrc.includes('"public", "project-docs"')
  )
  log(
    'C29: 返回 document 对象',
    /return NextResponse\.json\(\s*\{[\s\S]*?document:[\s\S]*?id:[\s\S]*?fileName:[\s\S]*?fileUrl:/.test(apiSrc)
  )
}

// ========== D. 文档删除 API ==========

async function testDeleteApi() {
  console.log('\n━━━ D. 文档删除 API (DELETE) ━━━\n')

  const apiExists = existsSync(join(process.cwd(), 'src/app/api/projects/[id]/documents/[docId]/route.ts'))
  log('D30: [docId]/route.ts 存在', apiExists)

  if (!apiExists) return

  const apiSrc = await readSrc('src/app/api/projects/[id]/documents/[docId]/route.ts')

  log(
    'D31: DELETE 函数存在',
    /export async function DELETE/.test(apiSrc)
  )
  log(
    'D32: 鉴权：未登录返回 401',
    /export async function DELETE[\s\S]{0,1500}未登录[\s\S]{0,100}401/.test(apiSrc)
  )
  log(
    'D33: 使用 canEditProject 权限校验',
    apiSrc.includes('canEditProject')
  )
  log(
    'D34: 文档不存在返回 404',
    apiSrc.includes('文档不存在') && apiSrc.includes('404')
  )
  log(
    'D35: 校验 docId 属于 projectId',
    apiSrc.includes('document.projectId !== params.id')
  )
  log(
    'D36: 删除本地文件（仅当 URL 以 /project-docs/ 开头）',
    apiSrc.includes("startsWith('/project-docs/')") || apiSrc.includes('startsWith("/project-docs/")')
  )
  log(
    'D37: 删除数据库记录',
    apiSrc.includes('prisma.projectDocument.delete')
  )
}

// ========== E. 文档预览模态组件 ==========

async function testPreviewModal() {
  console.log('\n━━━ E. 文档预览模态组件 (DocumentPreviewModal) ━━━\n')

  const componentExists = existsSync(join(process.cwd(), 'src/components/DocumentPreviewModal.tsx'))
  log('E38: 组件文件存在', componentExists)

  if (!componentExists) return

  const componentSrc = await readSrc('src/components/DocumentPreviewModal.tsx')

  log(
    'E39: 接收 open/onClose/fileName/fileUrl/fileType props',
    componentSrc.includes('open') &&
    componentSrc.includes('onClose') &&
    componentSrc.includes('fileName') &&
    componentSrc.includes('fileUrl') &&
    componentSrc.includes('fileType')
  )
  log(
    'E40: open=false 时不渲染',
    componentSrc.includes('if (!open) return null')
  )
  log(
    'E41: ESC 键关闭模态框',
    componentSrc.includes("'Escape'") || componentSrc.includes('"Escape"')
  )
  log(
    'E42: PDF 使用 iframe 嵌入预览',
    componentSrc.includes('<iframe')
  )
  log(
    'E43: PPT/PPTX 显示下载提示',
    componentSrc.includes('PowerPoint') || componentSrc.includes('ppt')
  )
  log(
    'E44: 内容区域支持滚动（overflow-auto）',
    componentSrc.includes('overflow-auto')
  )
  log(
    'E45: 提供下载按钮',
    componentSrc.includes('download=') || componentSrc.includes('下载')
  )
  log(
    'E46: 点击遮罩关闭模态框',
    componentSrc.includes('onClick={onClose}')
  )
}

// ========== F. 项目详情页集成 ==========

async function testDetailPageIntegration() {
  console.log('\n━━━ F. 项目详情页集成 ━━━\n')

  const pageSrc = await readSrc('src/app/projects/[id]/page.tsx')

  log(
    'F47: 导入 DocumentPreviewModal',
    /import\s+DocumentPreviewModal/.test(pageSrc)
  )
  log(
    'F48: 存在 ProjectDocument 接口',
    /interface\s+ProjectDocument/.test(pageSrc)
  )
  log(
    'F49: 存在 documents 状态',
    /const\s+\[documents,/.test(pageSrc)
  )
  log(
    'F50: 存在 uploadingDoc 状态',
    /const\s+\[uploadingDoc,/.test(pageSrc)
  )
  log(
    'F51: 存在 previewDoc 状态',
    /const\s+\[previewDoc,/.test(pageSrc)
  )
  log(
    'F52: 存在 fetchDocuments 函数',
    /const\s+fetchDocuments\s*=/.test(pageSrc)
  )
  log(
    'F53: 存在 handleUploadDocument 函数',
    /const\s+handleUploadDocument\s*=/.test(pageSrc)
  )
  log(
    'F54: 存在 handleDeleteDocument 函数',
    /const\s+handleDeleteDocument\s*=/.test(pageSrc)
  )
  log(
    'F55: fetchProject 中调用 fetchDocuments',
    /fetchDocuments\(\)/.test(pageSrc)
  )

  // 项目文档卡片位于竞争态势分析卡片上方
  // 使用"项目文档（BP"作为文档卡片的标识，使用"竞争态势分析"卡片标题作为分析卡片的标识
  const docCardIdx = pageSrc.indexOf('项目文档（BP')
  // 找到作为卡片标题的"竞争态势分析"，即 {/* 竞争态势分析 */} 注释之后的位置
  const competitorCardMatch = pageSrc.match(/\{\/\*\s*竞争态势分析\s*\*\//)
  const competitorIdx = competitorCardMatch ? competitorCardMatch.index! : -1
  log(
    'F56: 项目文档卡片位于竞争态势分析上方',
    docCardIdx > 0 && competitorIdx > 0 && docCardIdx < competitorIdx,
    `文档卡片位置: ${docCardIdx}, 竞争态势卡片位置: ${competitorIdx}`
  )

  // 检查在项目文档卡片范围内是否存在 project.canEdit（控制上传按钮显示）
  const docCardStart = pageSrc.indexOf('项目文档（BP')
  const competitorCardStart = pageSrc.indexOf('竞争态势分析', docCardStart > 0 ? docCardStart : 0)
  const docCardSection = docCardStart > 0 && competitorCardStart > 0
    ? pageSrc.substring(docCardStart, competitorCardStart)
    : ''
  log(
    'F57: 上传按钮仅在 canEdit 时显示',
    docCardSection.includes('project.canEdit') && docCardSection.includes('handleUploadDocument'),
    docCardSection ? '文档卡片范围内找到 canEdit 和 handleUploadDocument' : '未找到文档卡片范围'
  )
  log(
    'F58: 文档列表显示文件名/大小/上传时间/上传人',
    pageSrc.includes('doc.fileName') &&
    pageSrc.includes('formatFileSize') &&
    pageSrc.includes('doc.createdAt') &&
    pageSrc.includes('doc.uploadedBy')
  )
  log(
    'F59: 点击文档触发预览（setPreviewDoc）',
    /setPreviewDoc\(\{[\s\S]*?fileName:[\s\S]*?fileUrl:[\s\S]*?fileType:/.test(pageSrc)
  )
  log(
    'F60: 删除按钮仅在 canEdit 时显示',
    /\{project\.canEdit\s*&&[\s\S]{0,300}handleDeleteDocument/.test(pageSrc)
  )
  log(
    'F61: 渲染 DocumentPreviewModal 组件',
    /<DocumentPreviewModal/.test(pageSrc)
  )
  log(
    'F62: accept 属性包含 PDF/PPT/PPTX',
    pageSrc.includes('application/pdf') &&
    pageSrc.includes('.ppt') &&
    pageSrc.includes('.pptx')
  )
}

// ========== 主入口 ==========

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  测试：项目文档上传 / 预览 / 删除功能                   ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  await testSchema()
  await testListApi()
  await testUploadApi()
  await testDeleteApi()
  await testPreviewModal()
  await testDetailPageIntegration()

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  const total = results.length

  console.log('\n╔════════════════════════════════════════╗')
  console.log(`║  总计：${total}  ✓ 通过：${passed}  ✗ 失败：${failed}  ║`)
  console.log('╚════════════════════════════════════════╝')

  if (failed > 0) {
    console.log('\n失败用例：')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    })
    process.exit(1)
  } else {
    console.log('\n✓ 全部测试通过')
    process.exit(0)
  }
}

main().catch(err => {
  console.error('测试脚本执行失败：', err)
  process.exit(1)
})
