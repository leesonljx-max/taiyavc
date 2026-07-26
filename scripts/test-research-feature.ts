/**
 * 单元测试：投研分析功能
 *
 * 覆盖范围：
 *   A. Prisma Schema 数据模型
 *   B. 文档提取工具库 document-extract.ts
 *   C. 投研分析权限 research-permissions.ts
 *   D. 模块 prompts 配置 research-prompts.ts
 *   E. API 路由结构（6 个路由）
 *   F. 前端页面（列表页 + 详情页）
 *   G. 模块配置完整性（9 个模块）
 *   H. 数据流完整性（Tavily + DeepSeek + 文档提取）
 *
 * 运行: npx tsx scripts/test-research-feature.ts
 */
import 'dotenv/config'
import { readFile } from 'fs/promises'
import { join } from 'path'

interface TestResult { name: string; passed: boolean; detail?: string }
const results: TestResult[] = []

function log(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail })
  const mark = passed ? '✓' : '✗'
  const suffix = !passed && detail ? ` — ${detail}` : ''
  console.log(`${mark} ${name}${suffix}`)
}

async function readFileContent(relativePath: string): Promise<string> {
  return readFile(join(__dirname, '..', relativePath), 'utf-8')
}

// ════════════════════════════════════════════════════════
// A. Prisma Schema 数据模型
// ════════════════════════════════════════════════════════

async function testA_Schema() {
  console.log('\n━━━ A. Prisma Schema 数据模型 ━━━\n')

  const schema = await readFileContent('prisma/schema.prisma')

  log('A1. ResearchModule 模型存在', schema.includes('model ResearchModule'))
  log('A2. ResearchDocument 模型存在', schema.includes('model ResearchDocument'))

  // ResearchModule 字段
  log('A3. ResearchModule 有 projectId', schema.includes('projectId     String'))
  log('A4. ResearchModule 有 moduleType', schema.includes('moduleType    String'))
  log('A5. ResearchModule 有 content (手动输入)', schema.includes('content       String?'))
  log('A6. ResearchModule 有 aiJson (AI 分析结果)', schema.includes('aiJson        String?'))
  log('A7. ResearchModule 有 aiSummary', schema.includes('aiSummary     String?'))
  log('A8. ResearchModule 有 analyzedAt', schema.includes('analyzedAt    DateTime?'))

  // 唯一约束
  log('A9. ResearchModule 有 projectId+moduleType 唯一约束', schema.includes('@@unique([projectId, moduleType])'))

  // ResearchDocument 字段
  log('A10. ResearchDocument 有 moduleId', schema.includes('moduleId      String'))
  log('A11. ResearchDocument 有 extractedText', schema.includes('extractedText String?'))
  log('A12. ResearchDocument 有 fileName/fileUrl/fileType/fileSize',
    schema.includes('fileName') && schema.includes('fileUrl') && schema.includes('fileType') && schema.includes('fileSize'))

  // Project 关联
  log('A13. Project 模型关联 researchModules', schema.includes('researchModules  ResearchModule[]'))
  log('A14. User 模型关联 researchDocuments', schema.includes('researchDocuments  ResearchDocument[]'))

  // 索引
  log('A15. ResearchModule 有 projectId 索引', schema.includes('@@index([projectId])') && schema.includes('@@index([moduleType])'))
  log('A16. ResearchDocument 有 moduleId 索引', schema.includes('@@index([moduleId])'))
}

// ════════════════════════════════════════════════════════
// B. 文档提取工具库
// ════════════════════════════════════════════════════════

async function testB_DocumentExtract() {
  console.log('\n━━━ B. 文档提取工具库 document-extract.ts ━━━\n')

  const content = await readFileContent('src/lib/document-extract.ts')

  log('B1. 导出 detectFileType', content.includes('export function detectFileType'))
  log('B2. 导出 extractTextFromFile', content.includes('export async function extractTextFromFile'))
  log('B3. 导出 validateResearchDoc', content.includes('export function validateResearchDoc'))
  log('B4. 导出允许的扩展名白名单', content.includes('ALLOWED_RESEARCH_DOC_EXTENSIONS'))
  log('B5. 导出允许的 MIME 类型白名单', content.includes('ALLOWED_RESEARCH_DOC_MIME_TYPES'))
  log('B6. 导出最大文件大小', content.includes('MAX_RESEARCH_DOC_SIZE'))

  // 支持 4 种格式
  log('B7. 支持 PDF', content.includes("'pdf'"))
  log('B8. 支持 Word(.docx)', content.includes("'docx'"))
  log('B9. 支持 Excel(.xlsx)', content.includes("'xlsx'"))
  log('B10. 支持 PPT(.pptx)', content.includes("'pptx'"))

  // 使用对应的库
  log('B11. PDF 使用 pdf-parse', content.includes("import('pdf-parse')"))
  log('B12. Word 使用 mammoth', content.includes("import('mammoth')"))
  log('B13. Excel 使用 xlsx', content.includes("import('xlsx')"))
  log('B14. PPT 使用 jszip', content.includes("import('jszip')"))

  // 文本截断
  log('B15. 有最大提取长度限制', content.includes('MAX_EXTRACT_LENGTH'))

  // 文件大小限制 50MB
  log('B16. 文件大小限制 50MB', content.includes('50 * 1024 * 1024'))

  // 动态导入（避免构建时加载）
  log('B17. 使用动态 import', content.includes('await import'))

  // 验证测试
  const { validateResearchDoc, detectFileType } = await import('../src/lib/document-extract')

  const validPdf = validateResearchDoc('test.pdf', 1024, 'application/pdf')
  log('B18. validateResearchDoc 接受 PDF', validPdf.valid)

  const validDocx = validateResearchDoc('test.docx', 1024)
  log('B19. validateResearchDoc 接受 DOCX', validDocx.valid)

  const invalid = validateResearchDoc('test.txt', 1024)
  log('B20. validateResearchDoc 拒绝 TXT', !invalid.valid)

  const tooLarge = validateResearchDoc('test.pdf', 100 * 1024 * 1024)
  log('B21. validateResearchDoc 拒绝超 50MB', !tooLarge.valid)

  log('B22. detectFileType 识别 PDF', detectFileType('test.pdf') === 'pdf')
  log('B23. detectFileType 识别 DOCX', detectFileType('test.docx') === 'docx')
  log('B24. detectFileType 识别 XLSX', detectFileType('test.xlsx') === 'xlsx')
  log('B25. detectFileType 识别 PPTX', detectFileType('test.pptx') === 'pptx')
  log('B26. detectFileType 未知类型', detectFileType('test.txt') === 'unknown')
}

// ════════════════════════════════════════════════════════
// C. 投研分析权限
// ════════════════════════════════════════════════════════

async function testC_Permissions() {
  console.log('\n━━━ C. 投研分析权限 research-permissions.ts ━━━\n')

  const content = await readFileContent('src/lib/research-permissions.ts')

  log('C1. 导出 canViewResearchProject', content.includes('export function canViewResearchProject'))
  log('C2. 导出 canEditResearchProject', content.includes('export function canEditResearchProject'))
  log('C3. 导出 needsAIAnalysis', content.includes('export function needsAIAnalysis'))
  log('C4. 导出 needsTavilySearch', content.includes('export function needsTavilySearch'))
  log('C5. 导出 needsDocumentExtraction', content.includes('export function needsDocumentExtraction'))
  log('C6. 导出 ALL_MODULE_TYPES', content.includes('ALL_MODULE_TYPES'))
  log('C7. 导出 MODULE_TYPE_LABELS', content.includes('MODULE_TYPE_LABELS'))
  log('C8. 导出 isValidModuleType', content.includes('export function isValidModuleType'))

  // 实际测试权限逻辑
  const {
    canViewResearchProject,
    canEditResearchProject,
    needsAIAnalysis,
    needsTavilySearch,
    needsDocumentExtraction,
    isValidModuleType,
    ALL_MODULE_TYPES,
  } = await import('../src/lib/research-permissions')

  const partner = { id: 'partner1', role: 'INVESTMENT_PARTNER' as const }
  const manager = { id: 'manager1', role: 'INVESTMENT_MANAGER' as const }
  const admin = { id: 'admin1', role: 'ADMIN' as const }
  const officer = { id: 'officer1', role: 'POST_INVESTMENT_OFFICER' as const }

  const ownProject = { createdById: 'manager1', memberIds: [] }
  const otherProject = { createdById: 'other-user', memberIds: [] }
  const memberProject = { createdById: 'other-user', memberIds: ['manager1'] }

  // 查看权限
  log('C9. PARTNER 可见所有项目', canViewResearchProject(partner, otherProject))
  log('C10. ADMIN 可见所有项目', canViewResearchProject(admin, otherProject))
  log('C11. MANAGER 可见自己创建的项目', canViewResearchProject(manager, ownProject))
  log('C12. MANAGER 可见自己是成员的项目', canViewResearchProject(manager, memberProject))
  log('C13. MANAGER 不可见他人项目', !canViewResearchProject(manager, otherProject))
  log('C14. POST_INVESTMENT_OFFICER 不可见他人项目', !canViewResearchProject(officer, otherProject))

  // 编辑权限
  log('C15. PARTNER 可编辑所有项目', canEditResearchProject(partner, otherProject))
  log('C16. ADMIN 可编辑所有项目', canEditResearchProject(admin, otherProject))
  log('C17. MANAGER 可编辑自己项目', canEditResearchProject(manager, ownProject))
  log('C18. MANAGER 不可编辑他人项目', !canEditResearchProject(manager, otherProject))

  // AI 分析需求
  log('C19. INDUSTRY 需要 AI 分析', needsAIAnalysis('INDUSTRY'))
  log('C20. FINANCING 不需要 AI 分析', !needsAIAnalysis('FINANCING'))
  log('C21. RECOMMENDATION 不需要 AI 分析', !needsAIAnalysis('RECOMMENDATION'))

  // Tavily 搜索需求
  log('C22. INDUSTRY 需要 Tavily 搜索', needsTavilySearch('INDUSTRY'))
  log('C23. COMPETITION 需要 Tavily 搜索', needsTavilySearch('COMPETITION'))
  log('C24. FINANCIAL_DD 不需要 Tavily 搜索', !needsTavilySearch('FINANCIAL_DD'))
  log('C25. BUSINESS_DD 不需要 Tavily 搜索', !needsTavilySearch('BUSINESS_DD'))

  // 文档提取需求
  log('C26. BUSINESS_DD 需要文档提取', needsDocumentExtraction('BUSINESS_DD'))
  log('C27. FINANCIAL_DD 需要文档提取', needsDocumentExtraction('FINANCIAL_DD'))
  log('C28. INDUSTRY 不需要文档提取', !needsDocumentExtraction('INDUSTRY'))

  // 模块类型验证
  log('C29. isValidModuleType 接受 INDUSTRY', isValidModuleType('INDUSTRY'))
  log('C30. isValidModuleType 拒绝 INVALID', !isValidModuleType('INVALID'))

  // 9 个模块类型
  log('C31. 共 9 个模块类型', ALL_MODULE_TYPES.length === 9, `实际: ${ALL_MODULE_TYPES.length}`)
  log('C32. 包含所有 9 个模块类型',
    ALL_MODULE_TYPES.includes('INDUSTRY') &&
    ALL_MODULE_TYPES.includes('PRODUCT_TECH') &&
    ALL_MODULE_TYPES.includes('COMPETITION') &&
    ALL_MODULE_TYPES.includes('BUSINESS_DD') &&
    ALL_MODULE_TYPES.includes('FINANCIAL_DD') &&
    ALL_MODULE_TYPES.includes('TEAM') &&
    ALL_MODULE_TYPES.includes('COMPANY') &&
    ALL_MODULE_TYPES.includes('FINANCING') &&
    ALL_MODULE_TYPES.includes('RECOMMENDATION')
  )
}

// ════════════════════════════════════════════════════════
// D. 模块 prompts 配置
// ════════════════════════════════════════════════════════

async function testD_Prompts() {
  console.log('\n━━━ D. 模块 prompts 配置 research-prompts.ts ━━━\n')

  const content = await readFileContent('src/lib/research-prompts.ts')

  log('D1. 导出 MODULE_PROMPTS', content.includes('export const MODULE_PROMPTS'))

  const { MODULE_PROMPTS } = await import('../src/lib/research-prompts')

  // 每个模块都有配置
  const moduleTypes = ['INDUSTRY', 'PRODUCT_TECH', 'COMPETITION', 'BUSINESS_DD', 'FINANCIAL_DD', 'TEAM', 'COMPANY', 'FINANCING', 'RECOMMENDATION']
  for (const mt of moduleTypes) {
    log(`D2. ${mt} 有 prompt 配置`, !!MODULE_PROMPTS[mt as keyof typeof MODULE_PROMPTS])
  }

  // 行业分析 prompt 包含 TRL
  const industryConfig = MODULE_PROMPTS.INDUSTRY
  const industryPrompt = industryConfig.userPromptBuilder({ name: 'test', totalAmount: '0' } as any, '', '', '')
  log('D3. 行业分析 prompt 包含 TRL', industryPrompt.includes('trlLevel') || industryPrompt.includes('TRL'))
  log('D4. 行业分析有 Tavily 搜索', industryConfig.searchQueries({ name: 'test', totalAmount: '0' } as any).length > 0)

  // 竞争分析 prompt 包含 4 维度
  const compConfig = MODULE_PROMPTS.COMPETITION
  const compPrompt = compConfig.userPromptBuilder({ name: 'test', totalAmount: '0' } as any, '', '', '')
  log('D5. 竞争分析 prompt 包含"产品定位"', compPrompt.includes('产品定位'))
  log('D6. 竞争分析 prompt 包含"市场策略"', compPrompt.includes('市场策略'))
  log('D7. 竞争分析 prompt 包含"业务进展"', compPrompt.includes('业务进展'))
  log('D8. 竞争分析 prompt 包含"团队背景"', compPrompt.includes('团队背景'))

  // 业务尽调 prompt 包含客户/订单
  const bizConfig = MODULE_PROMPTS.BUSINESS_DD
  const bizPrompt = bizConfig.userPromptBuilder({ name: 'test', totalAmount: '0' } as any, '', '', '')
  log('D9. 业务尽调 prompt 包含"前十大客户"', bizPrompt.includes('topCustomers') || bizPrompt.includes('前十大客户'))
  log('D10. 业务尽调 prompt 包含"已签订单"', bizPrompt.includes('signedOrders') || bizPrompt.includes('已签订单'))
  log('D11. 业务尽调 prompt 包含"意向订单"', bizPrompt.includes('intentOrders') || bizPrompt.includes('意向订单'))

  // 融资规划和投资建议不需要 AI
  log('D12. FINANCING 不需要 AI（空 prompt）', MODULE_PROMPTS.FINANCING.systemPrompt === '')
  log('D13. RECOMMENDATION 不需要 AI（空 prompt）', MODULE_PROMPTS.RECOMMENDATION.systemPrompt === '')

  // 使用 deepseek-v4-flash 模型（在 API 路由中检查）
  log('D14. 所有需要 AI 的模块都有 systemPrompt',
    ['INDUSTRY', 'PRODUCT_TECH', 'COMPETITION', 'BUSINESS_DD', 'FINANCIAL_DD', 'TEAM', 'COMPANY'].every(
      mt => MODULE_PROMPTS[mt as keyof typeof MODULE_PROMPTS].systemPrompt.length > 0
    )
  )
}

// ════════════════════════════════════════════════════════
// E. API 路由结构
// ════════════════════════════════════════════════════════

async function testE_APIRoutes() {
  console.log('\n━━━ E. API 路由结构 ━━━\n')

  const routes = [
    { path: 'src/app/api/research/route.ts', name: 'GET /api/research', expects: ['GET', 'DUE_DILIGENCE', 'canViewResearchProject'] },
    { path: 'src/app/api/research/[projectId]/route.ts', name: 'GET /api/research/[projectId]', expects: ['GET', 'ALL_MODULE_TYPES', 'canViewResearchProject'] },
    { path: 'src/app/api/research/[projectId]/[moduleType]/route.ts', name: 'PUT /api/research/[projectId]/[moduleType]', expects: ['PUT', 'canEditResearchProject', 'isValidModuleType'] },
    { path: 'src/app/api/research/[projectId]/[moduleType]/analyze/route.ts', name: 'POST .../analyze', expects: ['POST', 'searchWeb', 'deepseek-v4-flash', 'repairJson'] },
    { path: 'src/app/api/research/[projectId]/[moduleType]/documents/route.ts', name: 'POST .../documents', expects: ['POST', 'extractTextFromFile', 'validateResearchDoc'] },
    { path: 'src/app/api/research/[projectId]/documents/[docId]/route.ts', name: 'DELETE .../documents/[docId]', expects: ['DELETE', 'canEditResearchProject'] },
  ]

  for (const route of routes) {
    const content = await readFileContent(route.path)
    log(`E. ${route.name} 存在`, content.length > 0)
    for (const expect of route.expects) {
      log(`E. ${route.name} 包含 ${expect}`, content.includes(expect))
    }
  }

  // 具体验证
  const listRoute = await readFileContent('src/app/api/research/route.ts')
  log('E1. 列表 API 筛选 DUE_DILIGENCE 阶段', listRoute.includes("followStage: 'DUE_DILIGENCE'"))
  log('E2. 列表 API 计算 moduleProgress', listRoute.includes('moduleProgress'))

  const detailRoute = await readFileContent('src/app/api/research/[projectId]/route.ts')
  log('E3. 详情 API 自动创建缺失模块', detailRoute.includes('createMany') || detailRoute.includes('missingTypes'))

  const analyzeRoute = await readFileContent('src/app/api/research/[projectId]/[moduleType]/analyze/route.ts')
  log('E4. 分析 API 使用 Tavily 搜索', analyzeRoute.includes('searchWeb'))
  log('E5. 分析 API 读取文档提取文本', analyzeRoute.includes('extractedText'))
  log('E6. 分析 API 调用 DeepSeek', analyzeRoute.includes('api.deepseek.com'))
  log('E7. 分析 API 使用 90s 超时', analyzeRoute.includes('90000'))
  log('E8. 分析 API 缓存结果到 aiJson', analyzeRoute.includes('aiJson'))
  log('E9. 分析 API 设置 analyzedAt', analyzeRoute.includes('analyzedAt'))
  log('E10. 分析 API 验证 needsAIAnalysis', analyzeRoute.includes('needsAIAnalysis'))

  const uploadRoute = await readFileContent('src/app/api/research/[projectId]/[moduleType]/documents/route.ts')
  log('E11. 上传 API 验证文件格式', uploadRoute.includes('validateResearchDoc'))
  log('E12. 上传 API 提取文本', uploadRoute.includes('extractTextFromFile'))
  log('E13. 上传 API 保存到 research-docs 目录', uploadRoute.includes('research-docs'))
  log('E14. 上传 API 创建 ResearchDocument 记录', uploadRoute.includes('researchDocument.create'))

  const deleteRoute = await readFileContent('src/app/api/research/[projectId]/documents/[docId]/route.ts')
  log('E15. 删除 API 验证文档归属项目', deleteRoute.includes('module.projectId') || deleteRoute.includes('projectId'))
  log('E16. 删除 API 删除文件系统文件', deleteRoute.includes('unlink'))
  log('E17. 删除 API 删除数据库记录', deleteRoute.includes('researchDocument.delete'))
}

// ════════════════════════════════════════════════════════
// F. 前端页面
// ════════════════════════════════════════════════════════

async function testF_Frontend() {
  console.log('\n━━━ F. 前端页面 ━━━\n')

  // 导航项
  const layout = await readFileContent('src/components/DashboardLayout.tsx')
  log('F1. DashboardLayout 包含投研分析导航', layout.includes("href: '/research'") && layout.includes("label: '投研分析'"))
  log('F2. 投研分析在工作台之后', layout.indexOf("href: '/workbench'") < layout.indexOf("href: '/research'"))
  log('F3. 投研分析在统计分析之前', layout.indexOf("href: '/research'") < layout.indexOf("href: '/statistics'"))

  // 列表页
  const listPage = await readFileContent('src/app/research/page.tsx')
  log('F4. 列表页存在', listPage.length > 0)
  log('F5. 列表页调用 GET /api/research', listPage.includes("fetch('/api/research'"))
  log('F6. 列表页使用 DashboardLayout', listPage.includes('DashboardLayout'))
  log('F7. 列表页显示模块进度', listPage.includes('moduleProgress'))
  log('F8. 列表页跳转到详情页', listPage.includes('router.push') && listPage.includes('/research/'))

  // 详情页
  const detailPage = await readFileContent('src/app/research/[projectId]/page.tsx')
  log('F9. 详情页存在', detailPage.length > 0)
  log('F10. 详情页调用 GET /api/research/[projectId]', detailPage.includes("fetch(`/api/research/${params.projectId}`"))
  log('F11. 详情页使用 DashboardLayout', detailPage.includes('DashboardLayout'))
  log('F12. 详情页包含 9 个模块', detailPage.includes('INDUSTRY') && detailPage.includes('RECOMMENDATION'))
  log('F13. 详情页有 AI 分析按钮', detailPage.includes('handleAnalyze'))
  log('F14. 详情页有文档上传', detailPage.includes('handleUpload'))
  log('F15. 详情页有文档删除', detailPage.includes('handleDeleteDoc'))
  log('F16. 详情页有手动输入保存', detailPage.includes('handleSaveContent'))
  log('F17. 详情页 AI 分析调用 POST', detailPage.includes("method: 'POST'") && detailPage.includes('/analyze'))
  log('F18. 详情页手动输入调用 PUT', detailPage.includes("method: 'PUT'"))
  log('F19. 详情页文档上传支持 4 种格式', detailPage.includes('accept=".pdf,.docx,.xlsx,.pptx"'))
  log('F20. 详情页有 AIResultRenderer 组件', detailPage.includes('AIResultRenderer'))

  // 融资规划手动输入字段
  log('F21. 融资规划有融资金额字段', detailPage.includes('financingAmount'))
  log('F22. 融资规划有投前估值字段', detailPage.includes('preValuation'))
  log('F23. 融资规划有老股估值字段', detailPage.includes('oldShareValuation'))
  log('F24. 融资规划有其它机构进展字段', detailPage.includes('otherInstitutions'))
  log('F25. 融资规划有核心条款字段', detailPage.includes('coreTerms'))

  // 投资建议手动输入字段
  log('F26. 投资建议有投资金额区间字段', detailPage.includes('investmentRange'))
  log('F27. 投资建议有领投或跟投字段', detailPage.includes('investmentType'))
}

// ════════════════════════════════════════════════════════
// G. 模块配置完整性
// ════════════════════════════════════════════════════════

async function testG_ModuleCompleteness() {
  console.log('\n━━━ G. 模块配置完整性 ━━━\n')

  const { MODULE_TYPE_LABELS, MODULE_TYPE_DESCRIPTIONS, ALL_MODULE_TYPES } = await import('../src/lib/research-permissions')
  const { MODULE_PROMPTS } = await import('../src/lib/research-prompts')

  for (const mt of ALL_MODULE_TYPES) {
    log(`G1. ${mt} 有中文标签`, !!MODULE_TYPE_LABELS[mt])
    log(`G2. ${mt} 有描述`, !!MODULE_TYPE_DESCRIPTIONS[mt])
    log(`G3. ${mt} 有 prompt 配置`, !!MODULE_PROMPTS[mt])
  }

  // 模块顺序
  const expectedOrder = ['INDUSTRY', 'PRODUCT_TECH', 'COMPETITION', 'BUSINESS_DD', 'FINANCIAL_DD', 'TEAM', 'COMPANY', 'FINANCING', 'RECOMMENDATION']
  log('G4. 模块顺序正确', JSON.stringify(ALL_MODULE_TYPES) === JSON.stringify(expectedOrder))

  // 融资规划字段完整性
  const financingDesc = MODULE_TYPE_DESCRIPTIONS.FINANCING
  log('G5. 融资规划描述包含融资金额', financingDesc.includes('融资金额'))
  log('G6. 融资规划描述包含投前估值', financingDesc.includes('投前估值'))
  log('G7. 融资规划描述包含老股估值', financingDesc.includes('老股估值'))
  log('G8. 融资规划描述包含其它机构进展', financingDesc.includes('其它机构进展'))
  log('G9. 融资规划描述包含核心条款', financingDesc.includes('核心条款'))

  // 投资建议字段完整性
  const recDesc = MODULE_TYPE_DESCRIPTIONS.RECOMMENDATION
  log('G10. 投资建议描述包含投资金额区间', recDesc.includes('投资金额区间'))
  log('G11. 投资建议描述包含领投或跟投', recDesc.includes('领投或跟投'))
}

// ════════════════════════════════════════════════════════
// H. 数据流完整性（Tavily + DeepSeek + 文档提取）
// ════════════════════════════════════════════════════════

async function testH_DataFlow() {
  console.log('\n━━━ H. 数据流完整性 ━━━\n')

  const analyzeRoute = await readFileContent('src/app/api/research/[projectId]/[moduleType]/analyze/route.ts')
  const uploadRoute = await readFileContent('src/app/api/research/[projectId]/[moduleType]/documents/route.ts')

  // 文档上传 → 提取文本 → 存储
  log('H1. 上传时提取文本', uploadRoute.includes('extractTextFromFile'))
  log('H2. 提取文本存入 extractedText 字段', uploadRoute.includes('extractedText'))

  // AI 分析 → 读取文档文本 + Tavily 搜索 → DeepSeek
  log('H3. AI 分析读取文档提取文本', analyzeRoute.includes('d.extractedText') || analyzeRoute.includes('extractedText'))
  log('H4. AI 分析读取手动输入内容', analyzeRoute.includes('module.content') || analyzeRoute.includes('manualContent'))
  log('H5. AI 分析执行 Tavily 搜索', analyzeRoute.includes('searchWeb'))
  log('H6. AI 分析调用 DeepSeek', analyzeRoute.includes('api.deepseek.com'))
  log('H7. AI 分析使用 MODULE_PROMPTS 配置', analyzeRoute.includes('MODULE_PROMPTS'))
  log('H8. AI 分析结果缓存到 aiJson', analyzeRoute.includes('aiJson'))
  log('H9. AI 分析摘要缓存到 aiSummary', analyzeRoute.includes('aiSummary'))
  log('H10. AI 分析时间记录到 analyzedAt', analyzeRoute.includes('analyzedAt'))

  // 权限控制
  log('H11. 列表 API 权限筛选', (await readFileContent('src/app/api/research/route.ts')).includes('canViewResearchProject'))
  log('H12. 详情 API 权限校验', (await readFileContent('src/app/api/research/[projectId]/route.ts')).includes('canViewResearchProject'))
  log('H13. 更新 API 编辑权限', (await readFileContent('src/app/api/research/[projectId]/[moduleType]/route.ts')).includes('canEditResearchProject'))
  log('H14. 分析 API 编辑权限', analyzeRoute.includes('canEditResearchProject'))
  log('H15. 上传 API 编辑权限', uploadRoute.includes('canEditResearchProject'))
  log('H16. 删除 API 编辑权限', (await readFileContent('src/app/api/research/[projectId]/documents/[docId]/route.ts')).includes('canEditResearchProject'))

  // session 校验
  for (const route of [
    'src/app/api/research/route.ts',
    'src/app/api/research/[projectId]/route.ts',
    'src/app/api/research/[projectId]/[moduleType]/route.ts',
    'src/app/api/research/[projectId]/[moduleType]/analyze/route.ts',
    'src/app/api/research/[projectId]/[moduleType]/documents/route.ts',
    'src/app/api/research/[projectId]/documents/[docId]/route.ts',
  ]) {
    const content = await readFileContent(route)
    log(`H17. ${route.split('/').pop()} 校验 session.user.id`, content.includes('session.user.id'))
  }

  // force-dynamic
  for (const route of [
    'src/app/api/research/route.ts',
    'src/app/api/research/[projectId]/route.ts',
    'src/app/api/research/[projectId]/[moduleType]/route.ts',
    'src/app/api/research/[projectId]/[moduleType]/analyze/route.ts',
    'src/app/api/research/[projectId]/[moduleType]/documents/route.ts',
    'src/app/api/research/[projectId]/documents/[docId]/route.ts',
  ]) {
    const content = await readFileContent(route)
    log(`H18. ${route.split('/').pop()} 设置 force-dynamic`, content.includes("dynamic = 'force-dynamic'"))
  }
}

// ════════════════════════════════════════════════════════
// 主函数
// ════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  投研分析功能 - 单元测试')
  console.log('═══════════════════════════════════════════════════')

  await testA_Schema()
  await testB_DocumentExtract()
  await testC_Permissions()
  await testD_Prompts()
  await testE_APIRoutes()
  await testF_Frontend()
  await testG_ModuleCompleteness()
  await testH_DataFlow()

  // 汇总
  const total = results.length
  const passed = results.filter(r => r.passed).length
  const failed = total - passed

  console.log('\n═══════════════════════════════════════════════════')
  console.log(`  汇总: ${passed}/${total} 通过, ${failed} 失败`)
  console.log('═══════════════════════════════════════════════════')

  if (failed > 0) {
    console.log('\n失败用例:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    })
  }

  process.exit(failed === 0 ? 0 : 1)
}

main().catch(err => {
  console.error('测试执行失败:', err)
  process.exit(1)
})
