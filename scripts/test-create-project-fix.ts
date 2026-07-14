/**
 * 测试脚本：新建项目失败问题修复验证
 *
 * 问题根因：之前会话修改了 Prisma schema（raisedAmount Float→String、新增 ProjectDocument 模型），
 * 但 Prisma Client 未及时重新生成，导致运行时类型不匹配，触发 500 错误"创建项目失败"。
 *
 * 修复方案：
 * 1. 执行 `npx prisma generate` 重新生成 Prisma Client
 * 2. 改进 API 错误处理：开发环境返回 detail 字段便于诊断
 * 3. package.json 添加 postinstall 钩子，确保每次安装依赖后自动生成 Prisma Client
 * 4. package.json 添加 db:push 脚本，确保 schema 同步时同时生成 Client
 *
 * 测试覆盖：
 * A. Prisma Client 重新生成验证
 *   1. Prisma Client 类型定义文件存在
 *   2. Prisma Client 类型定义包含 raisedAmount 字段
 *   3. schema 中 raisedAmount 类型为 String
 *   4. schema 中 raisedAmount 默认值为 ""
 *   5. schema 中存在 ProjectDocument 模型
 *
 * B. API 错误处理改进
 *   6. POST /api/projects 的 catch 块存在
 *   7. 开发环境返回 detail 字段
 *   8. 使用 NODE_ENV 判断是否为开发环境
 *   9. detail 字段包含 error.message
 *
 * C. package.json 脚本改进
 *  10. 存在 postinstall 脚本
 *  11. postinstall 脚本执行 prisma generate
 *  12. 存在 db:push 脚本
 *  13. db:push 脚本执行 prisma db push && prisma generate
 *
 * D. 创建项目 API 逻辑验证
 *  14. POST 函数存在
 *  15. 鉴权：未登录返回 401
 *  16. session.user.id 缺失返回 401（登录已过期）
 *  17. 必填项校验：项目名称
 *  18. 必填项校验：所处行业
 *  19. 必填项校验：公司定位
 *  20. 必填项校验：投资估值
 *  21. totalAmount 字符串处理
 *  22. raisedAmount 字符串处理
 *  23. investmentValuation 数字转换
 *  24. targetDate ISO-8601 转换
 *  25. financialData 字符串处理（兼容对象和字符串）
 *  26. 同名项目检查（409 响应）
 *  27. 项目线索合并逻辑
 *  28. 保护期设置（3个月）
 *  29. passedStages 计算
 *  30. 成功创建返回 201
 *
 * E. 前端提交逻辑验证
 *   31. 必填项校验：项目名称和融资金额
 *   32. 必填项校验：所处行业
 *   33. 必填项校验：公司定位
 *   34. 必填项校验：投资估值（有效数字）
 *   35. raisedAmount 使用 trim() 提交
 *   36. investmentValuation 使用 parseFloat 转换
 *   37. financialData 直接传递 HTML 字符串
 *   38. targetDate 转换为 ISO-8601
 *   39. 409 响应处理（显示重复提示）
 *   40. 错误信息显示 result.detail || result.error
 *
 * F. 前端安全 JSON 解析（防止 "Unexpected token" 错误）
 *   41. 新建页面检查 content-type 是否为 application/json
 *   42. 新建页面非 JSON 响应给出友好错误（重启开发服务器提示）
 *   43. 新建页面 JSON 解析失败给出友好错误（刷新页面提示）
 *   44. 编辑页面检查 content-type 是否为 application/json
 *   45. 编辑页面非 JSON 响应给出友好错误
 *   46. 编辑页面 JSON 解析失败给出友好错误
 *   47. 编辑页面错误信息显示 result.detail || result.error
 *
 * G. PUT API 错误处理改进
 *   48. PUT 的 catch 块返回 detail 字段（开发环境）
 *   49. PUT 使用 NODE_ENV 判断
 *   50. PUT detail 包含 error.message
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

// ========== A. Prisma Client 重新生成验证 ==========

async function testPrismaClient() {
  console.log('\n━━━ A. Prisma Client 重新生成验证 ━━━\n')

  const clientExists = existsSync(join(process.cwd(), 'node_modules/.prisma/client/index.d.ts'))
  log(
    'A1: Prisma Client 类型定义文件存在',
    clientExists
  )

  if (clientExists) {
    const clientSrc = await readSrc('node_modules/.prisma/client/index.d.ts')
    log(
      'A2: Prisma Client 类型定义包含 raisedAmount 字段',
      clientSrc.includes('raisedAmount'),
      clientSrc.includes('raisedAmount') ? '' : '未在类型定义中找到 raisedAmount'
    )
  }

  const schemaSrc = await readSrc('prisma/schema.prisma')
  log(
    'A3: schema 中 raisedAmount 类型为 String',
    /raisedAmount\s+String/.test(schemaSrc)
  )
  log(
    'A4: schema 中 raisedAmount 默认值为 ""',
    /raisedAmount\s+String\s+@default\(""\)/.test(schemaSrc)
  )
  log(
    'A5: schema 中存在 ProjectDocument 模型',
    /model\s+ProjectDocument\s*\{/.test(schemaSrc)
  )
}

// ========== B. API 错误处理改进 ==========

async function testApiErrorHandling() {
  console.log('\n━━━ B. API 错误处理改进 ━━━\n')

  const apiSrc = await readSrc('src/app/api/projects/route.ts')

  log(
    'B6: POST 的 catch 块存在',
    /export async function POST[\s\S]*catch\s*\(error\)/.test(apiSrc)
  )
  log(
    'B7: 开发环境返回 detail 字段',
    apiSrc.includes('detail') && apiSrc.includes('isDev')
  )
  log(
    'B8: 使用 NODE_ENV 判断是否为开发环境',
    apiSrc.includes("process.env.NODE_ENV !== 'production'")
  )
  log(
    'B9: detail 字段包含 error.message',
    /detail:\s*error\s+instanceof\s+Error\s*\?\s*error\.message/.test(apiSrc)
  )
}

// ========== C. package.json 脚本改进 ==========

async function testPackageJson() {
  console.log('\n━━━ C. package.json 脚本改进 ━━━\n')

  const pkgSrc = await readSrc('package.json')
  const pkg = JSON.parse(pkgSrc)

  log(
    'C10: 存在 postinstall 脚本',
    !!pkg.scripts?.postinstall
  )
  log(
    'C11: postinstall 脚本执行 prisma generate',
    pkg.scripts?.postinstall === 'prisma generate'
  )
  log(
    'C12: 存在 db:push 脚本',
    !!pkg.scripts?.['db:push']
  )
  log(
    'C13: db:push 脚本执行 prisma db push && prisma generate',
    pkg.scripts?.['db:push'] === 'prisma db push && prisma generate'
  )
}

// ========== D. 创建项目 API 逻辑验证 ==========

async function testCreateApiLogic() {
  console.log('\n━━━ D. 创建项目 API 逻辑验证 ━━━\n')

  const apiSrc = await readSrc('src/app/api/projects/route.ts')

  log(
    'D14: POST 函数存在',
    /export async function POST/.test(apiSrc)
  )
  log(
    'D15: 鉴权：未登录返回 401',
    apiSrc.includes('未登录') && apiSrc.includes('401')
  )
  log(
    'D16: session.user.id 缺失返回 401（登录已过期）',
    apiSrc.includes('登录已过期，请退出后重新登录')
  )
  log(
    'D17: 必填项校验：项目名称',
    apiSrc.includes('项目名称是必填项')
  )
  log(
    'D18: 必填项校验：所处行业',
    apiSrc.includes('所处行业是必填项')
  )
  log(
    'D19: 必填项校验：公司定位',
    apiSrc.includes('公司定位是必填项')
  )
  log(
    'D20: 必填项校验：投资估值',
    apiSrc.includes('投资估值是必填项')
  )
  log(
    'D21: totalAmount 字符串处理',
    /data\.totalAmount\s*=\s*String\(data\.totalAmount\)\.trim\(\)/.test(apiSrc)
  )
  log(
    'D22: raisedAmount 字符串处理',
    /data\.raisedAmount\s*=\s*String\(data\.raisedAmount\)\.trim\(\)/.test(apiSrc)
  )
  log(
    'D23: investmentValuation 数字转换',
    /data\.investmentValuation\s*=\s*v/.test(apiSrc) && /Number\(data\.investmentValuation\)/.test(apiSrc)
  )
  log(
    'D24: targetDate ISO-8601 转换',
    /data\.targetDate\s*=\s*d\.toISOString\(\)/.test(apiSrc)
  )
  log(
    'D25: financialData 字符串处理（兼容对象和字符串）',
    /typeof\s+financialData\s*===\s*['"]object['"]/.test(apiSrc) && apiSrc.includes('JSON.stringify(financialData)')
  )
  log(
    'D26: 同名项目检查（409 响应）',
    apiSrc.includes('项目名称已存在') && apiSrc.includes('409')
  )
  log(
    'D27: 项目线索合并逻辑',
    apiSrc.includes('isHighlyOverlapping') && apiSrc.includes('fillIfEmpty')
  )
  log(
    'D28: 保护期设置（3个月）',
    apiSrc.includes('THREE_MONTHS_MS') && apiSrc.includes('90 * 24 * 60 * 60 * 1000')
  )
  log(
    'D29: passedStages 计算',
    apiSrc.includes('computePassedStages') && apiSrc.includes('passedStages: JSON.stringify')
  )
  log(
    'D30: 成功创建返回 201',
    apiSrc.includes("status: 201")
  )
}

// ========== E. 前端提交逻辑验证 ==========

async function testFrontendLogic() {
  console.log('\n━━━ E. 前端提交逻辑验证 ━━━\n')

  const pageSrc = await readSrc('src/app/projects/new/page.tsx')

  log(
    'E31: 必填项校验：项目名称和融资金额',
    pageSrc.includes('项目名称和融资金额是必填项')
  )
  log(
    'E32: 必填项校验：所处行业',
    pageSrc.includes('所处行业是必填项')
  )
  log(
    'E33: 必填项校验：公司定位',
    pageSrc.includes('公司定位是必填项')
  )
  log(
    'E34: 必填项校验：投资估值（有效数字）',
    pageSrc.includes('投资估值是必填项') && pageSrc.includes('isNaN(parseFloat')
  )
  log(
    'E35: raisedAmount 使用 trim() 提交',
    /raisedAmount:\s*formData\.raisedAmount\.trim\(\)/.test(pageSrc)
  )
  log(
    'E36: investmentValuation 使用 parseFloat 转换',
    /investmentValuation:\s*parseFloat\(formData\.investmentValuation\)/.test(pageSrc)
  )
  log(
    'E37: financialData 直接传递 HTML 字符串',
    /financialData:\s*formData\.financialData\s*\|\|\s*null/.test(pageSrc)
  )
  log(
    'E38: targetDate 转换为 ISO-8601',
    /targetDate:\s*formData\.targetDate\s*\?\s*new Date\(formData\.targetDate\)\.toISOString\(\)/.test(pageSrc)
  )
  log(
    'E39: 409 响应处理（显示重复提示）',
    pageSrc.includes('response.status === 409') && pageSrc.includes('setDuplicateWarning')
  )
  log(
    'E40: 错误信息显示 result.detail || result.error',
    pageSrc.includes('result.detail || result.error || \'创建项目失败\'')
  )
}

// ========== F. 前端安全 JSON 解析（防止 "Unexpected token" 错误）==========

async function testSafeJsonParse() {
  console.log('\n━━━ F. 前端安全 JSON 解析（防止 "Unexpected token" 错误）━━━\n')

  const newPageSrc = await readSrc('src/app/projects/new/page.tsx')
  const editPageSrc = await readSrc('src/app/projects/[id]/edit/page.tsx')

  // 新建页面
  log(
    'E41: 新建页面检查 content-type 是否为 application/json',
    newPageSrc.includes("contentType.includes('application/json')")
  )
  log(
    'E42: 新建页面非 JSON 响应给出友好错误（重启开发服务器提示）',
    newPageSrc.includes('服务器返回了非预期的响应，请重启开发服务器后重试')
  )
  log(
    'E43: 新建页面 JSON 解析失败给出友好错误（刷新页面提示）',
    newPageSrc.includes('服务器返回了无效的响应，请刷新页面后重试')
  )

  // 编辑页面
  log(
    'E44: 编辑页面检查 content-type 是否为 application/json',
    editPageSrc.includes("contentType.includes('application/json')")
  )
  log(
    'E45: 编辑页面非 JSON 响应给出友好错误',
    editPageSrc.includes('服务器返回了非预期的响应，请重启开发服务器后重试')
  )
  log(
    'E46: 编辑页面 JSON 解析失败给出友好错误',
    editPageSrc.includes('服务器返回了无效的响应，请刷新页面后重试')
  )
  log(
    'E47: 编辑页面错误信息显示 result.detail || result.error',
    editPageSrc.includes('result.detail || result.error || \'更新项目失败\'')
  )
}

// ========== G. PUT API 错误处理改进 ==========

async function testPutApiErrorHandling() {
  console.log('\n━━━ G. PUT API 错误处理改进 ━━━\n')

  const apiSrc = await readSrc('src/app/api/projects/[id]/route.ts')

  log(
    'E48: PUT 的 catch 块返回 detail 字段（开发环境）',
    /export async function PUT[\s\S]*catch\s*\(error\)[\s\S]*detail/.test(apiSrc)
  )
  log(
    'E49: PUT 使用 NODE_ENV 判断',
    apiSrc.includes("process.env.NODE_ENV !== 'production'")
  )
  log(
    'E50: PUT detail 包含 error.message',
    /detail:\s*error\s+instanceof\s+Error\s*\?\s*error\.message/.test(apiSrc)
  )
}

// ========== 主入口 ==========

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  测试：新建项目失败问题修复验证                          ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  await testPrismaClient()
  await testApiErrorHandling()
  await testPackageJson()
  await testCreateApiLogic()
  await testFrontendLogic()
  await testSafeJsonParse()
  await testPutApiErrorHandling()

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
