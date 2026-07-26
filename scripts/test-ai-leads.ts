/**
 * AI 自动项目线索检索模块 综合测试脚本
 *
 * 用户原话："我们准备把项目线索这个功能开发为AI自动检索项目线索的模块...
 *           在完成之后，先生成测试用例进行测试，对于数据结构以及存储应符合部署环境要求，
 *           在测试没有问题之后才能结束任务。"
 *
 * 测试覆盖：
 * A. Prisma schema - ProjectLead AI 扩展字段 + AIRetrievalLog 模型
 *   1. ProjectLead 包含 source 字段（默认 MANUAL）
 *   2. ProjectLead 包含 fundingRound 字段
 *   3. ProjectLead 包含 fundingAmount 字段（String 类型，符合部署环境）
 *   4. ProjectLead 包含 valuation 字段（String 类型）
 *   5. ProjectLead 包含 investors 字段（JSON 数组字符串）
 *   6. ProjectLead 包含 financialAdvisors 字段
 *   7. ProjectLead 包含 coreAdvantage 字段
 *   8. ProjectLead 包含 sourceUrl 字段
 *   9. ProjectLead 包含 sourceTitle 字段
 *  10. ProjectLead 包含 matchedProjectId 字段
 *  11. ProjectLead 包含 matchedConfidence 字段（Float）
 *  12. ProjectLead 包含 releasedAt 字段（DateTime?）
 *  13. ProjectLead 包含 aiSummary 字段
 *  14. AIRetrievalLog 模型存在
 *  15. AIRetrievalLog 包含 status/keywords/foundCount/savedCount 字段
 *  16. AIRetrievalLog 包含 triggeredById 关系
 *  17. User 模型包含 aiRetrievalLogs 反向关系
 *
 * B. AI 检索核心库 (src/lib/ai-lead-retrieval.ts)
 *  18. 文件存在
 *  19. 导出 runAIRetrieval 函数
 *  20. 导出 releaseExpiredLeads 函数
 *  21. 导出 RetrievalResult 类型
 *  22. 内部包含 getInitialTalkProjects（近3个月初聊项目）
 *  23. 内部包含 generateSearchKeywords（DeepSeek 关键词生成）
 *  24. 内部包含 searchBing（Bing 搜索爬取）
 *  25. 内部包含 extractLeadInfo（DeepSeek 信息抽取）
 *  26. 内部包含 matchProject（项目匹配）
 *  27. 内部包含 saveLeads（保存线索）
 *  28. saveLeads 优先用 matchedMaintainerId 作为 createdById
 *  29. 没有匹配到维护人的线索立即释放（releasedAt = now）
 *
 * C. AI 线索 API (src/app/api/ai-leads/route.ts)
 *  30. 文件存在
 *  31. GET 函数存在
 *  32. POST 函数存在
 *  33. 鉴权：未登录返回 401
 *  34. POST 仅 ADMIN/PARTNER 可触发
 *  35. POST 校验 DEEPSEEK_API_KEY
 *  36. GET 按 source='AI' 过滤
 *  37. GET 非管理员仅可见已释放+自己的
 *
 * D. AI 线索详情 API (src/app/api/ai-leads/[id]/route.ts)
 *  38. 文件存在
 *  39. GET/DELETE/PATCH 函数存在
 *  40. 仅 AI 来源线索可访问
 *  41. 已释放线索全部可见；未释放仅创建者可见
 *
 * E. AI 线索转化 API (src/app/api/ai-leads/[id]/convert/route.ts)
 *  42. 文件存在
 *  43. POST 函数存在
 *  44. 必填字段校验：totalAmount、investmentValuation、industry、companyPosition
 *  45. 项目名称重复检查
 *  46. 使用事务同时创建项目和更新线索状态
 *  47. 转化后线索 status=CONVERTED
 *  48. 项目 protectionExpiresAt 设置为3个月后
 *  49. 项目 passedStages 包含 INITIAL_TALK
 *
 * F. Cron 释放 API (src/app/api/cron/release-leads/route.ts)
 *  50. 文件存在
 *  51. GET/POST 函数存在
 *  52. 通过 CRON_SECRET 鉴权
 *  53. 调用 releaseExpiredLeads 函数
 *
 * G. 前端组件 (src/components/AILeadsTab.tsx)
 *  54. 文件存在
 *  55. 包含 AI 检索按钮
 *  56. 仅 ADMIN/PARTNER 显示检索按钮
 *  57. 包含线索详情弹窗
 *  58. 包含转化为项目功能
 *  59. 显示释放状态徽章（保护中/已释放/已转化）
 *  60. 统计卡片（全部/保护中/已释放/已转化）
 *
 * H. 项目页面集成 (src/app/projects/page.tsx)
 *  61. 导入 AILeadsTab
 *  62. TabKey 包含 'ai-leads'
 *  63. 包含 AI 线索 Tab 按钮
 *  64. tab === 'ai-leads' 时渲染 AILeadsTab
 *
 * I. 数据库存储与端到端验证
 *  65. 创建 AI 线索（含扩展字段）
 *  66. 查询验证字段持久化
 *  67. JSON 数组字段（investors/financialAdvisors）正确序列化
 *  68. 创建 AIRetrievalLog 日志记录
 *  69. 两周释放逻辑：未释放 → 释放（releasedAt 更新）
 *  70. 清理测试数据
 *
 * 运行: npx tsx scripts/test-ai-leads.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const prisma = new PrismaClient()

interface TestResult { name: string; passed: boolean; detail?: string }
const results: TestResult[] = []
const createdLeadIds: string[] = []
const createdLogIds: string[] = []
const createdProjectIds: string[] = []

function log(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail })
  console.log(`${passed ? '✓' : '✗'} ${name}${!passed && detail ? ` — ${detail}` : ''}`)
}

async function readSrc(relPath: string): Promise<string> {
  return readFile(join(process.cwd(), relPath), 'utf-8')
}

async function getTestUser(role: string) {
  return prisma.user.findFirst({ where: { role, status: 'ACTIVE' } })
}

// ========== A. Prisma schema ==========

async function testSchema() {
  console.log('\n━━━ A. Prisma schema - ProjectLead AI 扩展字段 + AIRetrievalLog ━━━\n')

  const schema = await readSrc('prisma/schema.prisma')

  // 1. source 字段
  log(
    '1. ProjectLead 包含 source 字段（默认 MANUAL）',
    /source\s+String\s+@default\("MANUAL"\)/.test(schema)
  )

  // 2-13. AI 扩展字段
  const fields = [
    { name: 'fundingRound', pattern: /fundingRound\s+String\?/ },
    { name: 'fundingAmount (String)', pattern: /fundingAmount\s+String\?/ },
    { name: 'valuation (String)', pattern: /valuation\s+String\?/ },
    { name: 'investors', pattern: /investors\s+String\?/ },
    { name: 'financialAdvisors', pattern: /financialAdvisors\s+String\?/ },
    { name: 'coreAdvantage', pattern: /coreAdvantage\s+String\?/ },
    { name: 'sourceUrl', pattern: /sourceUrl\s+String\?/ },
    { name: 'sourceTitle', pattern: /sourceTitle\s+String\?/ },
    { name: 'matchedProjectId', pattern: /matchedProjectId\s+String\?/ },
    { name: 'matchedConfidence (Float)', pattern: /matchedConfidence\s+Float\?/ },
    { name: 'releasedAt (DateTime?)', pattern: /releasedAt\s+DateTime\?/ },
    { name: 'aiSummary', pattern: /aiSummary\s+String\?/ },
  ]
  fields.forEach((f, i) => {
    log(`${i + 2}. ProjectLead 包含 ${f.name} 字段`, f.pattern.test(schema))
  })

  // 14. AIRetrievalLog 模型存在
  log('14. AIRetrievalLog 模型存在', /model\s+AIRetrievalLog\s*\{/.test(schema))

  // 15. AIRetrievalLog 字段
  const logFields = [
    { name: 'status', pattern: /status\s+String\s+@default\("RUNNING"\)/ },
    { name: 'keywords', pattern: /keywords\s+String\?/ },
    { name: 'foundCount', pattern: /foundCount\s+Int\s+@default\(0\)/ },
    { name: 'savedCount', pattern: /savedCount\s+Int\s+@default\(0\)/ },
    { name: 'error', pattern: /error\s+String\?/ },
    { name: 'startedAt', pattern: /startedAt\s+DateTime\s+@default\(now\(\)\)/ },
    { name: 'completedAt', pattern: /completedAt\s+DateTime\?/ },
  ]
  logFields.forEach((f, i) => {
    log(`15.${i + 1}. AIRetrievalLog 包含 ${f.name} 字段`, f.pattern.test(schema))
  })

  // 16. triggeredById 关系
  log(
    '16. AIRetrievalLog 包含 triggeredById 关系',
    /triggeredById\s+String\?/.test(schema) && /triggeredBy\s+User\?/.test(schema)
  )

  // 17. User 反向关系
  log(
    '17. User 模型包含 aiRetrievalLogs 反向关系',
    /aiRetrievalLogs\s+AIRetrievalLog\[\]/.test(schema)
  )
}

// ========== B. AI 检索核心库 ==========

async function testCoreLibrary() {
  console.log('\n━━━ B. AI 检索核心库 (src/lib/ai-lead-retrieval.ts) ━━━\n')

  const filePath = 'src/lib/ai-lead-retrieval.ts'
  log('18. 核心库文件存在', existsSync(join(process.cwd(), filePath)))

  const src = await readSrc(filePath)

  log('19. 导出 runAIRetrieval 函数', /export\s+async\s+function\s+runAIRetrieval/.test(src))
  log('20. 导出 releaseExpiredLeads 函数', /export\s+async\s+function\s+releaseExpiredLeads/.test(src))
  log('21. 导出 RetrievalResult 类型', /export\s+interface\s+RetrievalResult/.test(src))

  log(
    '22. 包含 getInitialTalkProjects（近3个月初聊项目）',
    /async\s+function\s+getInitialTalkProjects/.test(src) &&
      /followStage:\s*'INITIAL_TALK'/.test(src) &&
      /threeMonthsAgo/.test(src)
  )

  log(
    '23. 包含 generateSearchKeywords（DeepSeek 关键词生成）',
    /async\s+function\s+generateSearchKeywords/.test(src) &&
      /api\.deepseek\.com/.test(src)
  )

  log(
    '24. 包含 searchBing（Bing 搜索爬取）',
    /async\s+function\s+searchBing/.test(src) &&
      /bing\.com\/search/.test(src)
  )

  log(
    '25. 包含 extractLeadInfo（DeepSeek 信息抽取）',
    /async\s+function\s+extractLeadInfo/.test(src)
  )

  log(
    '26. 包含 matchProject（项目匹配）',
    /function\s+matchProject/.test(src) &&
      /isHighlyOverlapping/.test(src)
  )

  log('27. 包含 saveLeads（保存线索）', /async\s+function\s+saveLeads/.test(src))

  log(
    '28. saveLeads 优先用 matchedMaintainerId 作为 createdById',
    /lead\.matchedMaintainerId\s*\|\|\s*triggeredById/.test(src)
  )

  log(
    '29. 没有匹配到维护人的线索立即释放（releasedAt = now）',
    /shouldRelease\s*=\s*!lead\.matchedMaintainerId/.test(src) &&
      /releasedAt:\s*shouldRelease\s*\?\s*now\s*:\s*null/.test(src)
  )
}

// ========== C. AI 线索 API ==========

async function testLeadsAPI() {
  console.log('\n━━━ C. AI 线索 API (src/app/api/ai-leads/route.ts) ━━━\n')

  const filePath = 'src/app/api/ai-leads/route.ts'
  log('30. 文件存在', existsSync(join(process.cwd(), filePath)))

  const src = await readSrc(filePath)

  log('31. GET 函数存在', /export\s+async\s+function\s+GET/.test(src))
  log('32. POST 函数存在', /export\s+async\s+function\s+POST/.test(src))

  log(
    '33. 鉴权：未登录返回 401',
    /登录已过期，请退出后重新登录/.test(src) && /status:\s*401/.test(src)
  )

  log(
    '34. POST 仅 ADMIN/PARTNER 可触发',
    /role\s*!==\s*'ADMIN'\s*&&\s*role\s*!==\s*'INVESTMENT_PARTNER'/.test(src) &&
      /无权触发 AI 检索任务/.test(src)
  )

  log(
    '35. POST 校验 DEEPSEEK_API_KEY',
    /process\.env\.DEEPSEEK_API_KEY/.test(src) &&
      /DeepSeek API Key 未配置/.test(src)
  )

  log(
    '36. GET 按 source=AI 过滤',
    /source:\s*'AI'/.test(src)
  )

  log(
    '37. GET 非管理员仅可见已释放+自己的',
    /releasedAt:\s*\{\s*not:\s*null\s*\}/.test(src) &&
      /createdById:\s*currentUser\.id/.test(src)
  )
}

// ========== D. AI 线索详情 API ==========

async function testLeadDetailAPI() {
  console.log('\n━━━ D. AI 线索详情 API (src/app/api/ai-leads/[id]/route.ts) ━━━\n')

  const filePath = 'src/app/api/ai-leads/[id]/route.ts'
  log('38. 文件存在', existsSync(join(process.cwd(), filePath)))

  const src = await readSrc(filePath)

  log(
    '39. GET/DELETE/PATCH 函数存在',
    /export\s+async\s+function\s+GET/.test(src) &&
      /export\s+async\s+function\s+DELETE/.test(src) &&
      /export\s+async\s+function\s+PATCH/.test(src)
  )

  log(
    '40. 仅 AI 来源线索可访问',
    /lead\.source\s*!==\s*'AI'/.test(src)
  )

  log(
    '41. 已释放线索全部可见；未释放仅创建者可见',
    /if\s*\(lead\.releasedAt\)\s*return\s*lead/.test(src) &&
      /if\s*\(lead\.createdById\s*===\s*currentUser\.id\)\s*return\s*lead/.test(src)
  )
}

// ========== E. AI 线索转化 API ==========

async function testConvertAPI() {
  console.log('\n━━━ E. AI 线索转化 API (src/app/api/ai-leads/[id]/convert/route.ts) ━━━\n')

  const filePath = 'src/app/api/ai-leads/[id]/convert/route.ts'
  log('42. 文件存在', existsSync(join(process.cwd(), filePath)))

  const src = await readSrc(filePath)

  log('43. POST 函数存在', /export\s+async\s+function\s+POST/.test(src))

  log(
    '44. 必填字段校验：totalAmount',
    /融资金额是必填项/.test(src) && /投资估值是必填项/.test(src) &&
      /所处行业是必填项/.test(src) && /公司定位是必填项/.test(src)
  )

  log(
    '45. 项目名称重复检查',
    /prisma\.project\.findFirst\(\s*{\s*where:\s*\{\s*name:\s*lead\.name/.test(src) ||
      /name:\s*lead\.name/.test(src)
  )

  log(
    '46. 使用事务同时创建项目和更新线索状态',
    /prisma\.\$transaction/.test(src) &&
      /prisma\.project\.create/.test(src) &&
      /prisma\.projectLead\.update/.test(src)
  )

  log(
    '47. 转化后线索 status=CONVERTED',
    /status:\s*'CONVERTED'/.test(src)
  )

  log(
    '48. 项目 protectionExpiresAt 设置为3个月后',
    /protectionExpiresAt/.test(src) && /90\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(src)
  )

  log(
    '49. 项目 passedStages 包含 INITIAL_TALK',
    /passedStages:\s*JSON\.stringify\(\['INITIAL_TALK'\]\)/.test(src)
  )
}

// ========== F. Cron 释放 API ==========

async function testCronAPI() {
  console.log('\n━━━ F. Cron 释放 API (src/app/api/cron/release-leads/route.ts) ━━━\n')

  const filePath = 'src/app/api/cron/release-leads/route.ts'
  log('50. 文件存在', existsSync(join(process.cwd(), filePath)))

  const src = await readSrc(filePath)

  log(
    '51. GET/POST 函数存在',
    /export\s+async\s+function\s+GET/.test(src) &&
      /export\s+async\s+function\s+POST/.test(src)
  )

  log(
    '52. 通过 CRON_SECRET 鉴权',
    /process\.env\.CRON_SECRET/.test(src) && /未授权/.test(src)
  )

  log(
    '53. 调用 releaseExpiredLeads 函数',
    /import\s+\{[^}]*releaseExpiredLeads[^}]*\}\s+from\s+'@\/lib\/ai-lead-retrieval'/.test(src) ||
      /releaseExpiredLeads/.test(src)
  )
}

// ========== G. 前端组件 ==========

async function testFrontendComponent() {
  console.log('\n━━━ G. 前端组件 (src/components/AILeadsTab.tsx) ━━━\n')

  const filePath = 'src/components/AILeadsTab.tsx'
  log('54. 组件文件存在', existsSync(join(process.cwd(), filePath)))

  const src = await readSrc(filePath)

  log(
    '55. 包含 AI 检索按钮',
    /AI 检索/.test(src) && /handleRetrieve/.test(src)
  )

  log(
    '56. 仅 ADMIN/PARTNER 显示检索按钮',
    /canTrigger\s*=\s*userRole\s*===\s*'ADMIN'\s*\|\|\s*userRole\s*===\s*'INVESTMENT_PARTNER'/.test(src) &&
      /\{canTrigger\s*&&/.test(src)
  )

  log(
    '57. 包含线索详情弹窗',
    /viewingLead/.test(src) && /setViewingLead/.test(src)
  )

  log(
    '58. 包含转化为项目功能',
    /convertingLead/.test(src) && /handleConvert/.test(src) && /convert/.test(src)
  )

  log(
    '59. 显示释放状态徽章',
    /保护中/.test(src) && /已释放/.test(src) && /已转化/.test(src)
  )

  log(
    '60. 统计卡片（全部/保护中/已释放/已转化）',
    /'all'\s*\|\s*'released'\s*\|\s*'locked'\s*\|\s*'converted'/.test(src)
  )
}

// ========== H. 项目页面集成 ==========

async function testPageIntegration() {
  console.log('\n━━━ H. 项目页面集成 (src/app/projects/page.tsx) ━━━\n')

  const src = await readSrc('src/app/projects/page.tsx')

  log(
    '61. 导入 AILeadsTab',
    /import\s+AILeadsTab\s+from\s+'@\/components\/AILeadsTab'/.test(src)
  )

  log(
    "62. TabKey 包含 'ai-leads'",
    /type\s+TabKey\s*=\s*'library'\s*\|\s*'mine'\s*\|\s*'leads'\s*\|\s*'ai-leads'/.test(src)
  )

  log(
    "63. 包含 AI 线索 Tab 按钮",
    /setTab\('ai-leads'\)/.test(src) && /AI 线索/.test(src)
  )

  log(
    "64. tab === 'ai-leads' 时渲染 AILeadsTab",
    /\{tab\s*===\s*'ai-leads'\s*&&\s*<AILeadsTab\s*\/>\s*\}/.test(src)
  )
}

// ========== I. 数据库存储与端到端验证 ==========

async function testDatabaseStorage() {
  console.log('\n━━━ I. 数据库存储与端到端验证 ━━━\n')

  // 找一个测试用户
  const user = await getTestUser('ADMIN') || await getTestUser('INVESTMENT_PARTNER')
  if (!user) {
    log('65-70. 跳过（无可用测试用户）', false, '需要 ADMIN 或 INVESTMENT_PARTNER 用户')
    return
  }

  // 65. 创建 AI 线索（含扩展字段）
  try {
    const lead = await prisma.projectLead.create({
      data: {
        name: '[TEST] AI测试线索_' + Date.now(),
        industry: '商业航天',
        companyPosition: '测试公司定位',
        mainProducts: '卫星互联网；太空态势感知',
        description: '这是一个测试线索',
        status: 'PENDING',
        createdById: user.id,
        source: 'AI',
        fundingRound: 'B轮',
        fundingAmount: '5000万元',
        valuation: '5亿',
        investors: JSON.stringify(['红杉资本', 'IDG资本']),
        financialAdvisors: JSON.stringify(['华兴资本']),
        coreAdvantage: '技术领先；团队优秀',
        sourceUrl: 'https://example.com/test-pr',
        sourceTitle: '测试 PR 文章标题',
        matchedProjectId: null,
        matchedConfidence: 0.85,
        releasedAt: null,
        aiSummary: '测试摘要：公司完成B轮融资',
      },
    })
    createdLeadIds.push(lead.id)
    log('65. 创建 AI 线索（含扩展字段）', true)

    // 66. 查询验证字段持久化
    const fetched = await prisma.projectLead.findUnique({ where: { id: lead.id } })
    log(
      '66. 查询验证字段持久化',
      !!fetched &&
        fetched.source === 'AI' &&
        fetched.fundingRound === 'B轮' &&
        fetched.fundingAmount === '5000万元' &&
        fetched.valuation === '5亿' &&
        fetched.matchedConfidence === 0.85,
      `实际值: source=${fetched?.source}, round=${fetched?.fundingRound}`
    )

    // 67. JSON 数组字段正确序列化
    const investors = JSON.parse(fetched?.investors || '[]')
    const advisors = JSON.parse(fetched?.financialAdvisors || '[]')
    log(
      '67. JSON 数组字段（investors/financialAdvisors）正确序列化',
      Array.isArray(investors) &&
        investors.length === 2 &&
        investors[0] === '红杉资本' &&
        Array.isArray(advisors) &&
        advisors[0] === '华兴资本',
      `investors=${JSON.stringify(investors)}`
    )

    // 70. 清理（删除测试线索）- 放到最后
  } catch (e) {
    log('65. 创建 AI 线索（含扩展字段）', false, e instanceof Error ? e.message : String(e))
  }

  // 68. 创建 AIRetrievalLog 日志记录
  try {
    const logRecord = await prisma.aIRetrievalLog.create({
      data: {
        status: 'COMPLETED',
        keywords: JSON.stringify(['商业航天 融资', '卫星互联网 B轮']),
        foundCount: 10,
        savedCount: 3,
        error: null,
        completedAt: new Date(),
        triggeredById: user.id,
      },
    })
    createdLogIds.push(logRecord.id)
    log(
      '68. 创建 AIRetrievalLog 日志记录',
      logRecord.status === 'COMPLETED' && logRecord.foundCount === 10 && logRecord.savedCount === 3
    )
  } catch (e) {
    log('68. 创建 AIRetrievalLog 日志记录', false, e instanceof Error ? e.message : String(e))
  }

  // 69. 两周释放逻辑：创建一个3周前的线索，验证释放逻辑
  try {
    const threeWeeksAgo = new Date()
    threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21)

    const oldLead = await prisma.projectLead.create({
      data: {
        name: '[TEST] 旧AI线索_' + Date.now(),
        industry: 'AI应用',
        createdById: user.id,
        source: 'AI',
        status: 'PENDING',
        releasedAt: null,
        createdAt: threeWeeksAgo, // 设置为3周前
      },
    })
    createdLeadIds.push(oldLead.id)

    // 模拟 releaseExpiredLeads 的核心逻辑
    const twoWeeksAgo = new Date()
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)

    const expiredLeads = await prisma.projectLead.findMany({
      where: {
        source: 'AI',
        status: 'PENDING',
        releasedAt: null,
        createdAt: { lt: twoWeeksAgo },
      },
    })

    const oldLeadInResults = expiredLeads.find(l => l.id === oldLead.id)
    log(
      '69a. 两周释放逻辑：旧线索被识别为可释放',
      !!oldLeadInResults,
      `找到 ${expiredLeads.length} 条可释放线索`
    )

    if (oldLeadInResults) {
      // 执行释放
      await prisma.projectLead.update({
        where: { id: oldLead.id },
        data: { releasedAt: new Date() },
      })

      const updated = await prisma.projectLead.findUnique({ where: { id: oldLead.id } })
      log(
        '69b. 释放后 releasedAt 已更新',
        !!updated?.releasedAt,
        `releasedAt=${updated?.releasedAt?.toISOString()}`
      )
    }
  } catch (e) {
    log('69. 两周释放逻辑', false, e instanceof Error ? e.message : String(e))
  }

  // 70. 清理测试数据
  try {
    if (createdLeadIds.length > 0) {
      await prisma.projectLead.deleteMany({ where: { id: { in: createdLeadIds } } })
    }
    if (createdLogIds.length > 0) {
      await prisma.aIRetrievalLog.deleteMany({ where: { id: { in: createdLogIds } } })
    }
    if (createdProjectIds.length > 0) {
      await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } })
    }
    log('70. 清理测试数据', true)
  } catch (e) {
    log('70. 清理测试数据', false, e instanceof Error ? e.message : String(e))
  }
}

// ========== 主流程 ==========

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  AI 自动项目线索检索模块 综合测试')
  console.log('═══════════════════════════════════════════════════════════════')

  try {
    await testSchema()
    await testCoreLibrary()
    await testLeadsAPI()
    await testLeadDetailAPI()
    await testConvertAPI()
    await testCronAPI()
    await testFrontendComponent()
    await testPageIntegration()
    await testDatabaseStorage()
  } finally {
    await prisma.$disconnect()
  }

  // 汇总
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log(`  测试汇总: ${passed} 通过 / ${failed} 失败 / 共 ${results.length} 项`)
  console.log('═══════════════════════════════════════════════════════════════')

  if (failed > 0) {
    console.log('\n失败项:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    })
    process.exit(1)
  }
}

main().catch(e => {
  console.error('测试脚本执行失败:', e)
  process.exit(1)
})
