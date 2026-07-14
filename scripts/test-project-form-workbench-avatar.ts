/**
 * 测试脚本：新建项目表单改造 / 工作台筛选投资经理 / 头像裁剪与更新修复
 *
 * 测试覆盖：
 * A. 新建项目详细页
 *   1. prisma schema: raisedAmount 类型为 String
 *   2. prisma schema: raisedAmount 默认值为 ""
 *   3. new/page.tsx: 导入 RichTextEditor 组件
 *   4. new/page.tsx: 存在 INDUSTRY_OPTIONS 常量
 *   5. new/page.tsx: INDUSTRY_OPTIONS 包含 12 个预设行业
 *   6. new/page.tsx: industry 使用 datalist（input list="industry-options"）
 *   7. new/page.tsx: 提交前对 industry/companyPosition/investmentValuation 必填校验
 *   8. new/page.tsx: raisedAmount 提交时使用 trim()（字符串）
 *   9. new/page.tsx: raisedAmount 输入框 type="text"（不再 type="number"）
 *  10. new/page.tsx: 8 个详细字段使用 RichTextEditor（mainProducts/coreAdvantage/coreTeam/financialData/orderProgress/competitors/financingPlan/description）
 *  11. edit/page.tsx: 同步使用 RichTextEditor
 *  12. edit/page.tsx: 同步行业 datalist
 *  13. edit/page.tsx: 同步必填校验
 *  14. projects/[id]/page.tsx: raisedAmount 类型为 string
 *  15. projects/[id]/page.tsx: 使用 dangerouslySetInnerHTML 渲染 HTML 内容
 *  16. projects/[id]/page.tsx: 存在 renderHtmlContent 函数
 *  17. projects/[id]/page.tsx: 存在 isContentEmpty 函数
 *
 * B. API route 适配
 *  18. POST /api/projects: 必填校验 industry/companyPosition/investmentValuation
 *  19. POST /api/projects: raisedAmount 字符串处理
 *  20. GET /api/projects: 返回 raisedAmount（不转 Number）
 *  21. PUT /api/projects/[id]: 必填字段校验（不允许设为空）
 *  22. PUT /api/projects/[id]: raisedAmount 字符串处理
 *  23. PUT /api/projects/[id]: investmentValuation 校验为有效数字
 *  24. GET /api/projects/[id]: 返回 raisedAmount（不转 Number）
 *  25. ai-card route: raisedAmount 不再追加 "万元"
 *
 * C. 工作台投资合伙人筛选投资经理
 *  26. /api/users/managers/route.ts 存在
 *  27. managers API: 仅 ADMIN / INVESTMENT_PARTNER 可访问
 *  28. managers API: 仅返回 INVESTMENT_MANAGER + ACTIVE 用户
 *  29. workbench/page.tsx: 存在 managers 状态
 *  30. workbench/page.tsx: 存在 selectedManagerId 状态
 *  31. workbench/page.tsx: 存在 fetchManagers 函数
 *  32. workbench/page.tsx: 存在按 selectedManagerId 过滤的逻辑
 *  33. workbench/page.tsx: 存在筛选下拉框 UI（select 元素）
 *  34. workbench/page.tsx: 默认选项为"全部投资经理"
 *  35. workbench/page.tsx: raisedAmount 类型为 string
 *
 * D. 头像裁剪与更新修复
 *  36. AvatarCropper 组件存在
 *  37. AvatarCropper: 使用 Canvas API 裁剪
 *  38. AvatarCropper: 输出 1:1 正方形
 *  39. RichTextEditor 组件存在
 *  40. RichTextEditor: 拦截 paste 事件
 *  41. RichTextEditor: 检测 image/* 类型
 *  42. RichTextEditor: 上传到 /api/upload/image
 *  43. /api/upload/image/route.ts 存在
 *  44. upload API: 校验图片类型
 *  45. upload API: 校验文件大小 5MB
 *  46. ProfileEditModal: 导入 AvatarCropper
 *  47. ProfileEditModal: 选择图片后打开裁剪器（setShowCropper(true)）
 *  48. ProfileEditModal: handleUploadAvatar 调用 updateSession({ avatar: ... })
 *  49. ProfileEditModal: handleSaveInfo 调用 updateSession({ name })
 *  50. auth.ts: jwt callback 处理 trigger === 'update'
 *  51. auth.ts: trigger === 'update' 时更新 token.avatar
 *  52. auth.ts: trigger === 'update' 时更新 token.name
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

// ========== A. 新建项目详细页 ==========

async function testProjectForm() {
  console.log('\n━━━ A. 新建项目详细页改造 ━━━\n')

  const schemaSrc = await readSrc('prisma/schema.prisma')
  const newPageSrc = await readSrc('src/app/projects/new/page.tsx')
  const editPageSrc = await readSrc('src/app/projects/[id]/edit/page.tsx')
  const detailPageSrc = await readSrc('src/app/projects/[id]/page.tsx')

  console.log('── A1-A2: Prisma schema ──')
  log(
    'schema: raisedAmount 类型为 String',
    /raisedAmount\s+String/.test(schemaSrc)
  )
  log(
    'schema: raisedAmount 默认值为空字符串',
    /raisedAmount\s+String\s+@default\(""\)/.test(schemaSrc)
  )

  console.log('\n── A3-A10: new/page.tsx ──')
  log(
    'new/page.tsx: 导入 RichTextEditor',
    /import\s+RichTextEditor/.test(newPageSrc) || /from\s+['"]@\/components\/RichTextEditor['"]/.test(newPageSrc)
  )
  log(
    'new/page.tsx: 存在 INDUSTRY_OPTIONS 常量',
    /INDUSTRY_OPTIONS/.test(newPageSrc)
  )
  const industryMatches = newPageSrc.match(/AI应用|AI硬件|AI基础设施|具身智能|商业航天|量子计算|脑机接口|可控核聚变|半导体设备|半导体芯片|光学|新材料/g)
  log(
    'new/page.tsx: INDUSTRY_OPTIONS 包含 12 个预设行业',
    !!industryMatches && industryMatches.length >= 12,
    industryMatches ? `找到 ${industryMatches.length} 个` : '未找到'
  )
  log(
    'new/page.tsx: industry 使用 datalist',
    newPageSrc.includes('list="industry-options"') && newPageSrc.includes('<datalist')
  )
  log(
    'new/page.tsx: industry 必填校验',
    /industry.*trim\(\)|!formData\.industry/.test(newPageSrc) || /industry.*必填|请输入.*行业/.test(newPageSrc)
  )
  log(
    'new/page.tsx: companyPosition 必填校验',
    /companyPosition.*trim\(\)|!formData\.companyPosition/.test(newPageSrc) || /companyPosition.*必填|请输入.*定位/.test(newPageSrc)
  )
  log(
    'new/page.tsx: investmentValuation 必填校验',
    /investmentValuation.*trim\(\)|!formData\.investmentValuation/.test(newPageSrc) || /investmentValuation.*必填|请输入.*估值/.test(newPageSrc)
  )
  log(
    'new/page.tsx: raisedAmount 提交时使用 trim()',
    /formData\.raisedAmount\.trim\(\)|raisedAmount.*\.trim\(\)/.test(newPageSrc)
  )
  log(
    'new/page.tsx: raisedAmount 输入框为 text 类型（不再 number）',
    /raisedAmount[\s\S]{0,200}type="text"/.test(newPageSrc) || /name="raisedAmount"[\s\S]{0,200}type="text"/.test(newPageSrc)
  )
  // 8 个字段使用 RichTextEditor
  const richTextFields = ['mainProducts', 'coreAdvantage', 'coreTeam', 'financialData', 'orderProgress', 'competitors', 'financingPlan', 'description']
  let richTextCount = 0
  for (const field of richTextFields) {
    // 简单检测：每个字段附近出现 RichTextEditor
    const regex = new RegExp(`<RichTextEditor[^>]*value=\\{${field}\\}|value=\\{${field}\\}[\\s\\S]{0,100}<RichTextEditor|name="${field}"[\\s\\S]{0,200}RichTextEditor`, 'm')
    if (regex.test(newPageSrc) || newPageSrc.includes(`<RichTextEditor`) && newPageSrc.includes(`${field}`)) {
      richTextCount++
    }
  }
  log(
    `new/page.tsx: 详细字段使用 RichTextEditor（${richTextCount}/8）`,
    richTextCount >= 8,
    `匹配到 ${richTextCount} 个`
  )

  console.log('\n── A11-A13: edit/page.tsx 同步 ──')
  log(
    'edit/page.tsx: 导入或使用 RichTextEditor',
    /RichTextEditor/.test(editPageSrc)
  )
  log(
    'edit/page.tsx: 行业 datalist',
    editPageSrc.includes('list="industry-options"') || editPageSrc.includes('<datalist')
  )
  log(
    'edit/page.tsx: 必填校验',
    /industry[\s\S]{0,200}(trim\(\)|必填)|companyPosition[\s\S]{0,200}(trim\(\)|必填)/.test(editPageSrc)
  )

  console.log('\n── A14-A17: 项目详情页 ──')
  log(
    'detail page: raisedAmount 类型为 string',
    /raisedAmount:\s*string/.test(detailPageSrc)
  )
  log(
    'detail page: 使用 dangerouslySetInnerHTML 渲染内容',
    detailPageSrc.includes('dangerouslySetInnerHTML')
  )
  log(
    'detail page: 存在 renderHtmlContent 函数',
    detailPageSrc.includes('function renderHtmlContent') || /const\s+renderHtmlContent/.test(detailPageSrc)
  )
  log(
    'detail page: 存在 isContentEmpty 函数',
    detailPageSrc.includes('function isContentEmpty') || /const\s+isContentEmpty/.test(detailPageSrc)
  )
}

// ========== B. API route 适配 ==========

async function testApiRoutes() {
  console.log('\n━━━ B. API route 适配 ━━━\n')

  const postRouteSrc = await readSrc('src/app/api/projects/route.ts')
  const putRouteSrc = await readSrc('src/app/api/projects/[id]/route.ts')
  const aiCardSrc = await readSrc('src/app/api/projects/[id]/ai-card/route.ts')

  console.log('── B18-B20: POST /api/projects ──')
  log(
    'POST: 必填校验 industry/companyPosition/investmentValuation',
    /industry[\s\S]{0,300}(必填|不能为空|trim\(\))/.test(postRouteSrc) &&
    /companyPosition[\s\S]{0,300}(必填|不能为空|trim\(\))/.test(postRouteSrc) &&
    /investmentValuation[\s\S]{0,300}(必填|不能为空|trim\(\))/.test(postRouteSrc)
  )
  log(
    'POST: raisedAmount 字符串处理（String() 或 trim）',
    /String\(.*raisedAmount|raisedAmount.*String\(|data\.raisedAmount\s*=\s*String/.test(postRouteSrc)
  )
  log(
    'GET: 返回 raisedAmount 不转 Number',
    !/Number\(p\.raisedAmount\)/.test(postRouteSrc)
  )

  console.log('\n── B21-B24: PUT /api/projects/[id] ──')
  log(
    'PUT: 必填字段校验（不允许设为空）',
    putRouteSrc.includes('REQUIRED_FIELDS') && putRouteSrc.includes('不能为空')
  )
  log(
    'PUT: raisedAmount 字符串处理',
    /data\.raisedAmount\s*=\s*String/.test(putRouteSrc)
  )
  log(
    'PUT: investmentValuation 校验为有效数字',
    /investmentValuation[\s\S]{0,200}isNaN/.test(putRouteSrc)
  )
  log(
    'GET /api/projects/[id]: 返回 raisedAmount 不转 Number',
    !/Number\(project\.raisedAmount\)/.test(putRouteSrc) && !/Number\(updatedProject\.raisedAmount\)/.test(putRouteSrc)
  )

  console.log('\n── B25: ai-card route ──')
  log(
    'ai-card: raisedAmount 不再追加 "万元"',
    !/raisedAmount[\s\S]{0,30}万元/.test(aiCardSrc)
  )
}

// ========== C. 工作台投资合伙人筛选投资经理 ==========

async function testWorkbenchFilter() {
  console.log('\n━━━ C. 工作台投资合伙人筛选投资经理 ━━━\n')

  const managersApiExists = existsSync(join(process.cwd(), 'src/app/api/users/managers/route.ts'))
  log(
    'C26: /api/users/managers/route.ts 存在',
    managersApiExists
  )

  if (managersApiExists) {
    const managersApiSrc = await readSrc('src/app/api/users/managers/route.ts')
    log(
      'C27: managers API 仅 ADMIN / INVESTMENT_PARTNER 可访问',
      managersApiSrc.includes("'ADMIN'") && managersApiSrc.includes("'INVESTMENT_PARTNER'")
    )
    log(
      'C28: managers API 仅返回 INVESTMENT_MANAGER + ACTIVE',
      managersApiSrc.includes("role: 'INVESTMENT_MANAGER'") && managersApiSrc.includes("status: 'ACTIVE'")
    )
  }

  const workbenchSrc = await readSrc('src/app/workbench/page.tsx')
  console.log('\n── C29-C35: workbench/page.tsx ──')
  log(
    'C29: workbench 存在 managers 状态',
    /useState<\{[^}]*id:\s*string[^}]*name[^}]*\}>/.test(workbenchSrc) || /const\s+\[managers,/.test(workbenchSrc)
  )
  log(
    'C30: workbench 存在 selectedManagerId 状态',
    /const\s+\[selectedManagerId,/.test(workbenchSrc)
  )
  log(
    'C31: workbench 存在 fetchManagers 函数',
    /const\s+fetchManagers\s*=/.test(workbenchSrc) || /fetchManagers\(\)/.test(workbenchSrc)
  )
  log(
    'C32: workbench 存在按 selectedManagerId 过滤逻辑',
    /selectedManagerId[\s\S]{0,200}filter/.test(workbenchSrc) || /filter\(p\s*=>\s*p\.createdBy\?\.id\s*===\s*selectedManagerId\)/.test(workbenchSrc)
  )
  log(
    'C33: workbench 存在筛选下拉框 UI（select 元素）',
    /<select[\s\S]{0,200}selectedManagerId/.test(workbenchSrc)
  )
  log(
    'C34: workbench 默认选项为"全部投资经理"',
    workbenchSrc.includes('全部投资经理')
  )
  log(
    'C35: workbench raisedAmount 类型为 string',
    /raisedAmount:\s*string/.test(workbenchSrc)
  )
}

// ========== D. 头像裁剪与更新修复 ==========

async function testAvatarAndRichText() {
  console.log('\n━━━ D. 头像裁剪与更新修复 ━━━\n')

  const cropperExists = existsSync(join(process.cwd(), 'src/components/AvatarCropper.tsx'))
  log(
    'D36: AvatarCropper 组件存在',
    cropperExists
  )
  if (cropperExists) {
    const cropperSrc = await readSrc('src/components/AvatarCropper.tsx')
    log(
      'D37: AvatarCropper 使用 Canvas API 裁剪',
      cropperSrc.includes('canvas') && cropperSrc.includes('getContext') && cropperSrc.includes('drawImage')
    )
    log(
      'D38: AvatarCropper 输出 1:1 正方形',
      /canvas\.width\s*===\s*canvas\.height/.test(cropperSrc) ||
      (/\bwidth:\s*\d+,\s*height:\s*\d+/.test(cropperSrc) && /CONTAINER_SIZE/.test(cropperSrc))
    )
  }

  const richTextExists = existsSync(join(process.cwd(), 'src/components/RichTextEditor.tsx'))
  log(
    'D39: RichTextEditor 组件存在',
    richTextExists
  )
  if (richTextExists) {
    const richTextSrc = await readSrc('src/components/RichTextEditor.tsx')
    log(
      'D40: RichTextEditor 拦截 paste 事件',
      richTextSrc.includes('onPaste') || /addEventListener\(['"]paste['"]/.test(richTextSrc) || /handlePaste/.test(richTextSrc)
    )
    log(
      'D41: RichTextEditor 检测 image/* 类型',
      richTextSrc.includes('image/') || /item\.type\.startsWith\(['"]image\/['"]\)/.test(richTextSrc)
    )
    log(
      'D42: RichTextEditor 上传到 /api/upload/image',
      richTextSrc.includes('/api/upload/image')
    )
  }

  const uploadApiExists = existsSync(join(process.cwd(), 'src/app/api/upload/image/route.ts'))
  log(
    'D43: /api/upload/image/route.ts 存在',
    uploadApiExists
  )
  if (uploadApiExists) {
    const uploadApiSrc = await readSrc('src/app/api/upload/image/route.ts')
    log(
      'D44: upload API 校验图片类型',
      uploadApiSrc.includes('image/jpeg') || uploadApiSrc.includes('image/png') || uploadApiSrc.includes('image/') || /type.*startsWith.*image/.test(uploadApiSrc)
    )
    log(
      'D45: upload API 校验文件大小 5MB',
      uploadApiSrc.includes('5 * 1024 * 1024') || uploadApiSrc.includes('5MB') || uploadApiSrc.includes('5242880')
    )
  }

  const profileModalSrc = await readSrc('src/components/ProfileEditModal.tsx')
  console.log('\n── D46-D49: ProfileEditModal ──')
  log(
    'D46: ProfileEditModal 导入 AvatarCropper',
    /import\s+AvatarCropper/.test(profileModalSrc) || /from\s+['"]\.\/AvatarCropper['"]/.test(profileModalSrc)
  )
  log(
    'D47: 选择图片后打开裁剪器',
    profileModalSrc.includes('setShowCropper(true)') || profileModalSrc.includes('setShowCropper')
  )
  log(
    'D48: handleUploadAvatar 调用 updateSession({ avatar })',
    /updateSession\(\{\s*avatar[\s\S]*\}\)/.test(profileModalSrc)
  )
  log(
    'D49: handleSaveInfo 调用 updateSession({ name })',
    /updateSession\(\{\s*name[\s\S]*\}\)/.test(profileModalSrc)
  )

  const authSrc = await readSrc('src/lib/auth.ts')
  console.log('\n── D50-D52: auth.ts 修复 ──')
  log(
    'D50: auth.ts jwt callback 处理 trigger === "update"',
    authSrc.includes("trigger === 'update'") || authSrc.includes('trigger === "update"')
  )
  log(
    'D51: trigger === "update" 时更新 token.avatar',
    /trigger\s*===\s*['"]update['"][\s\S]{0,300}token\.avatar/.test(authSrc)
  )
  log(
    'D52: trigger === "update" 时更新 token.name',
    /trigger\s*===\s*['"]update['"][\s\S]{0,500}token\.name/.test(authSrc)
  )
}

// ========== 主入口 ==========

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║   测试：新建项目表单 / 工作台筛选 / 头像裁剪与更新修复   ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  await testProjectForm()
  await testApiRoutes()
  await testWorkbenchFilter()
  await testAvatarAndRichText()

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
