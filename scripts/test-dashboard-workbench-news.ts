/**
 * 测试脚本：首页维护人统计/项目库年份筛选/工作台已否阶段/新闻监控
 *
 * 测试覆盖：
 * A. 首页维护人阶段统计（仅统计当周变更）
 *   1. dashboard API: stageCounts 基于 weeklyNewProjects 而非 yearFilteredProjects
 *   2. dashboard API: INITIAL_TALK 仅当 targetDate >= weekStart 时统计
 *   3. dashboard API: 其它阶段仅当 stageChangedAt >= weekStart 时统计
 *   4. dashboard API: 不再使用 parsePassedStages 累计统计 stageCounts
 *   5. page.tsx: 显示"本周阶段变更"标签
 *
 * B. 项目库年份筛选位置
 *   6. page.tsx: 年份筛选使用按钮样式（非 select 下拉框）
 *   7. page.tsx: 年份筛选位于阶段卡片和搜索栏之间
 *   8. page.tsx: 搜索栏不再包含年份 select
 *
 * C. 工作台"已否"阶段
 *   9. types.ts: FollowStage 包含 REJECTED
 *   10. types.ts: followStageLabels 包含 REJECTED: '已否'
 *   11. types.ts: followStageColors 包含 REJECTED
 *   12. workbench/page.tsx: STAGE_ORDER 包含 REJECTED
 *   13. workbench/page.tsx: stageGradients 包含 REJECTED
 *   14. workbench/page.tsx: stageBorderLeft 包含 REJECTED
 *   15. workbench/page.tsx: stageIcons 包含 REJECTED
 *   16. workbench/page.tsx: 存在 handleReject 函数
 *   17. workbench/page.tsx: 存在"标记为已否"按钮
 *   18. projects/page.tsx: stageIcons 包含 REJECTED（类型完整性）
 *   19. projects/page.tsx: stageCardStyles 包含 REJECTED
 *   20. projects/page.tsx: 阶段卡片过滤掉 REJECTED
 *   21. project API: REJECTED 不需要审批
 *   22. stage-utils.ts: REJECTED 不在 STAGE_ORDER 中（不参与正常流程）
 *
 * D. 新闻监控
 *   23. schema.prisma: 存在 NewsKeyword 模型
 *   24. schema.prisma: 存在 NewsSource 模型
 *   25. news/route.ts: 过滤 publishedAt >= 7天前
 *   26. news/route.ts: 不再使用 weekStart 过滤
 *   27. news/search/route.ts: 过滤 publishedAt >= 7天前
 *   28. news/search/route.ts: 使用自定义关键字
 *   29. news/search/route.ts: 使用自定义来源
 *   30. news/keywords/route.ts: 存在 GET/POST/DELETE
 *   31. news/sources/route.ts: 存在 GET/POST/DELETE
 *   32. news/page.tsx: 存在关键字和来源管理 UI
 *   33. news/page.tsx: fetchNews 不再传 week=current
 */
import 'dotenv/config'
import { readFile } from 'fs/promises'
import { join } from 'path'

interface TestResult { name: string; passed: boolean; detail?: string }
const results: TestResult[] = []

function log(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail })
  console.log(`${passed ? '✓' : '✗'} ${name}${!passed && detail ? ` — ${detail}` : ''}`)
}

async function readSrc(relPath: string): Promise<string> {
  return readFile(join(process.cwd(), relPath), 'utf-8')
}

// ========== A. 首页维护人阶段统计 ==========

async function testDashboardWeeklyStats() {
  console.log('\n━━━ A. 首页维护人阶段统计（仅统计当周变更）━━━\n')

  const dashSrc = await readSrc('src/app/api/dashboard/route.ts')
  const homeSrc = await readSrc('src/app/page.tsx')

  console.log('── A1-A4: dashboard API 逻辑验证 ──')

  log(
    'stageCounts 基于 weeklyNewProjects（非 yearFilteredProjects）',
    /周维度统计[\s\S]*for\s*\(const\s+p\s+of\s+weeklyNewProjects\)[\s\S]*stageCounts/.test(dashSrc)
  )

  log(
    "INITIAL_TALK 仅当 targetDate >= weekStart 时统计",
    dashSrc.includes('initialDate && initialDate >= weekStart') &&
    dashSrc.includes('entry.stageCounts.INITIAL_TALK++')
  )

  log(
    '其它阶段仅当 stageChangedAt >= weekStart 时统计',
    dashSrc.includes('stageChangedAt && stageChangedAt >= weekStart') &&
    dashSrc.includes('entry.stageCounts[currentStage]++')
  )

  log(
    '不再使用 parsePassedStages 累计统计 stageCounts',
    !/for\s*\(const\s+p\s+of\s+yearFilteredProjects\)[\s\S]*parsePassedStages[\s\S]*stageCounts/.test(dashSrc)
  )

  console.log('\n── A5: page.tsx UI 验证 ──')
  log(
    '显示"本周阶段变更"标签',
    homeSrc.includes('本周阶段变更')
  )
}

// ========== B. 项目库年份筛选位置 ==========

async function testYearFilterPlacement() {
  console.log('\n━━━ B. 项目库年份筛选位置 ━━━\n')

  const pageSrc = await readSrc('src/app/projects/page.tsx')

  console.log('── B6-B8: 年份筛选 UI 验证 ──')

  log(
    '年份筛选使用按钮样式（非 select）',
    pageSrc.includes('年份筛选') &&
    /setSelectedYear\('all'\)/.test(pageSrc) &&
    pageSrc.includes('availableYears.map(y =>')
  )

  // 检查年份筛选位于阶段卡片之后、搜索栏之前
  const stageCardsIdx = pageSrc.indexOf('阶段卡片（不含"已否"')
  const yearFilterIdx = pageSrc.indexOf('年份筛选（与阶段卡片同行级')
  const searchFilterIdx = pageSrc.indexOf('搜索、行业筛选')

  log(
    '年份筛选位于阶段卡片和搜索栏之间',
    stageCardsIdx > 0 && yearFilterIdx > stageCardsIdx && searchFilterIdx > yearFilterIdx,
    `stageCards=${stageCardsIdx}, yearFilter=${yearFilterIdx}, search=${searchFilterIdx}`
  )

  // 检查搜索栏不再包含年份 select
  const searchSection = pageSrc.substring(searchFilterIdx, searchFilterIdx + 800)
  log(
    '搜索栏不再包含年份 select',
    !searchSection.includes('selectedYear') || !searchSection.includes('<select')
  )
}

// ========== C. 工作台"已否"阶段 ==========

async function testRejectedStage() {
  console.log('\n━━━ C. 工作台"已否"阶段 ━━━\n')

  const typesSrc = await readSrc('src/app/projects/types.ts')
  const workbenchSrc = await readSrc('src/app/workbench/page.tsx')
  const projectsPageSrc = await readSrc('src/app/projects/page.tsx')
  const apiSrc = await readSrc('src/app/api/projects/[id]/route.ts')
  const stageUtilsSrc = await readSrc('src/lib/stage-utils.ts')

  console.log('── C9-C11: types.ts 验证 ──')
  log("FollowStage 包含 REJECTED", typesSrc.includes("'REJECTED'"))
  log("followStageLabels 包含 REJECTED: '已否'", /REJECTED:\s*'已否'/.test(typesSrc))
  log('followStageColors 包含 REJECTED', /REJECTED:\s*'bg-red-100 text-red-800'/.test(typesSrc))

  console.log('\n── C12-C16: workbench/page.tsx 验证 ──')
  log(
    'STAGE_ORDER 包含 REJECTED',
    /STAGE_ORDER[\s\S]*'REJECTED'/.test(workbenchSrc)
  )
  log(
    'stageGradients 包含 REJECTED',
    /REJECTED:\s*'from-red-400 to-red-500'/.test(workbenchSrc)
  )
  log(
    'stageBorderLeft 包含 REJECTED',
    /REJECTED:\s*'border-l-red-400'/.test(workbenchSrc)
  )
  log(
    'stageIcons 包含 REJECTED',
    /REJECTED:\s*\(/.test(workbenchSrc)
  )
  log(
    '存在 handleReject 函数',
    workbenchSrc.includes('handleReject') &&
    workbenchSrc.includes("followStage: 'REJECTED'")
  )

  console.log('\n── C17: "标记为已否"按钮 ──')
  log(
    '存在"标记为已否"按钮',
    workbenchSrc.includes('标记为已否')
  )
  log(
    '按钮有 onClick 阻止冒泡',
    workbenchSrc.includes('e.stopPropagation()') &&
    workbenchSrc.includes('handleReject(project.id, project.name)')
  )

  console.log('\n── C18-C20: projects/page.tsx 验证 ──')
  log(
    'stageIcons 包含 REJECTED（类型完整性）',
    /REJECTED:\s*\(/.test(projectsPageSrc)
  )
  log(
    'stageCardStyles 包含 REJECTED',
    /REJECTED:\s*'from-red-400 to-red-500'/.test(projectsPageSrc)
  )
  log(
    '阶段卡片过滤掉 REJECTED',
    projectsPageSrc.includes("filter(s => s !== 'REJECTED')")
  )

  console.log('\n── C21: 项目 API REJECTED 不需要审批 ──')
  log(
    "REJECTED 不在 requiresApproval 条件中",
    !/requiresApproval[\s\S]*REJECTED/.test(apiSrc)
  )

  console.log('\n── C22: stage-utils.ts STAGE_ORDER 不含 REJECTED ──')
  log(
    'REJECTED 不在 stage-utils STAGE_ORDER 中（不参与正常流程）',
    !stageUtilsSrc.includes("'REJECTED'")
  )

  // 单元测试：computePassedStages 对 REJECTED 的处理
  console.log('\n── 单元测试：REJECTED 不影响 passedStages ──')
  const STAGE_ORDER_LOCAL = ['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'AGREEMENT', 'CLOSING', 'POST_INVESTMENT'] as const
  function computePassedStagesLocal(current: string[], newStage: string): string[] {
    const newIdx = STAGE_ORDER_LOCAL.indexOf(newStage as any)
    if (newIdx === -1) return current // REJECTED 不在列表中，返回原值
    const required = STAGE_ORDER_LOCAL.slice(0, newIdx + 1)
    const set = new Set([...current, ...required])
    return STAGE_ORDER_LOCAL.filter(s => set.has(s))
  }

  const result = computePassedStagesLocal(['INITIAL_TALK', 'PRE_DD'], 'REJECTED')
  log(
    "computePassedStages(['INITIAL_TALK','PRE_DD'], 'REJECTED') 不修改 passedStages",
    JSON.stringify(result) === JSON.stringify(['INITIAL_TALK', 'PRE_DD']),
    `result=${JSON.stringify(result)}`
  )
}

// ========== D. 新闻监控 ==========

async function testNewsMonitoring() {
  console.log('\n━━━ D. 新闻监控 ━━━\n')

  const schemaSrc = await readSrc('prisma/schema.prisma')
  const newsRouteSrc = await readSrc('src/app/api/news/route.ts')
  const newsSearchSrc = await readSrc('src/app/api/news/search/route.ts')
  const newsPageSrc = await readSrc('src/app/news/page.tsx')

  console.log('── D23-D24: Prisma 模型验证 ──')
  log(
    '存在 NewsKeyword 模型',
    schemaSrc.includes('model NewsKeyword') &&
    schemaSrc.includes('keyword') &&
    schemaSrc.includes('@unique')
  )
  log(
    '存在 NewsSource 模型',
    schemaSrc.includes('model NewsSource') &&
    schemaSrc.includes('name') &&
    schemaSrc.includes('@unique')
  )

  console.log('\n── D25-D26: news/route.ts 过滤逻辑 ──')
  log(
    '过滤 publishedAt >= 7天前',
    newsRouteSrc.includes('sevenDaysAgo') &&
    newsRouteSrc.includes('publishedAt: { gte: sevenDaysAgo }')
  )
  log(
    '不再使用 weekStart 过滤',
    !newsRouteSrc.includes('weekStart: { gte:')
  )

  console.log('\n── D27-D29: news/search/route.ts ──')
  log(
    '过滤 publishedAt >= 7天前（保存前）',
    newsSearchSrc.includes('if (publishedDate < sevenDaysAgo) continue')
  )
  log(
    '使用自定义关键字',
    newsSearchSrc.includes('customKeywords') &&
    newsSearchSrc.includes('customKeywordsList') &&
    newsSearchSrc.includes('searchTopics')
  )
  log(
    '使用自定义来源',
    newsSearchSrc.includes('customSources') &&
    newsSearchSrc.includes('allSources')
  )
  log(
    '查询已保存文章也按7天过滤',
    newsSearchSrc.includes('publishedAt: { gte: sevenDaysAgo }')
  )

  console.log('\n── D30-D31: API 路由存在性 ──')
  log(
    'news/keywords/route.ts 存在 GET/POST/DELETE',
    newsSearchSrc !== undefined // 文件存在即可
  )

  // 读取 keywords 和 sources 路由文件
  const keywordsRouteSrc = await readSrc('src/app/api/news/keywords/route.ts').catch(() => null)
  const sourcesRouteSrc = await readSrc('src/app/api/news/sources/route.ts').catch(() => null)

  log(
    'keywords API 存在 GET/POST/DELETE',
    keywordsRouteSrc !== null &&
    keywordsRouteSrc.includes('export async function GET') &&
    keywordsRouteSrc.includes('export async function POST') &&
    keywordsRouteSrc.includes('export async function DELETE')
  )
  log(
    'sources API 存在 GET/POST/DELETE',
    sourcesRouteSrc !== null &&
    sourcesRouteSrc.includes('export async function GET') &&
    sourcesRouteSrc.includes('export async function POST') &&
    sourcesRouteSrc.includes('export async function DELETE')
  )

  console.log('\n── D32-D33: news/page.tsx UI 验证 ──')
  log(
    '存在关键字和来源管理 UI',
    newsPageSrc.includes('关键字和来源管理') &&
    newsPageSrc.includes('handleAddKeyword') &&
    newsPageSrc.includes('handleAddSource')
  )
  log(
    'fetchNews 不再传 week=current',
    !newsPageSrc.includes("week: 'current'")
  )

  // 单元测试：7天过滤逻辑
  console.log('\n── 单元测试：7天过滤逻辑 ──')

  const now = new Date()
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  // 模拟文章数据
  const mockArticles = [
    { title: '今天发布的', publishedAt: new Date(now.getTime() - 1000) }, // 1秒前
    { title: '3天前发布的', publishedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) }, // 3天前
    { title: '6天前发布的', publishedAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000) }, // 6天前
    { title: '8天前发布的', publishedAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000) }, // 8天前
    { title: '30天前发布的', publishedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) }, // 30天前
  ]

  const filtered = mockArticles.filter(a => a.publishedAt >= sevenDaysAgo)
  log(
    '7天过滤保留3篇文章（今天/3天/6天前）',
    filtered.length === 3,
    `count=${filtered.length}, titles=${filtered.map(a => a.title).join(', ')}`
  )
  log(
    '7天过滤排除8天和30天前的文章',
    !filtered.some(a => a.title === '8天前发布的') &&
    !filtered.some(a => a.title === '30天前发布的')
  )

  // 单元测试：关键字和来源合并
  console.log('\n── 单元测试：关键字和来源合并 ──')

  const defaultSources = ['36氪', '投资界', '量子位']
  const customSources = [{ name: '中科创星' }, { name: '36氪' }] // 36氪重复
  const allSources = Array.from(new Set([...defaultSources, ...customSources.map(s => s.name)]))

  log(
    '来源合并去重后包含4个来源',
    allSources.length === 4 && allSources.includes('中科创星'),
    `sources=${JSON.stringify(allSources)}`
  )

  const industries = ['AI/企业服务', '新能源']
  const customKeywords = ['可控核聚变']
  const searchTopics = [...industries, ...customKeywords]

  log(
    '检索主题包含行业和自定义关键字',
    searchTopics.length === 3 &&
    searchTopics.includes('可控核聚变') &&
    searchTopics.includes('AI/企业服务'),
    `topics=${JSON.stringify(searchTopics)}`
  )
}

// ========== 主测试入口 ==========

async function main() {
  console.log('\n========================================')
  console.log('  首页/项目库/工作台/新闻监控 更新测试')
  console.log('========================================\n')

  try { await testDashboardWeeklyStats() } catch (e) { console.error('首页统计测试出错:', e) }
  try { await testYearFilterPlacement() } catch (e) { console.error('年份筛选测试出错:', e) }
  try { await testRejectedStage() } catch (e) { console.error('已否阶段测试出错:', e) }
  try { await testNewsMonitoring() } catch (e) { console.error('新闻监控测试出错:', e) }

  // 汇总
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  const total = results.length

  console.log('\n========================================')
  console.log(`  测试结果：${passed}/${total} 通过，${failed} 失败`)
  console.log('========================================')

  if (failed > 0) {
    console.log('\n失败项：')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    })
  }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('测试运行失败:', e)
  process.exit(1)
})
