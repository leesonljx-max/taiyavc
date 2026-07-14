/**
 * 测试脚本：首页改造 + 工作台阶段卡片收窄
 *
 * 测试覆盖：
 * A. 首页改造（去掉年份筛选 + 去掉项目库卡片 + 4 个本周统计卡片）
 *   1. page.tsx: 不再使用 selectedYear 状态
 *   2. page.tsx: 不再有年份筛选器 UI（不存在"年份筛选"文本）
 *   3. page.tsx: fetchDashboard 不再传 year 参数
 *   4. page.tsx: DashboardData 接口仅包含 weeklyNew/preDD/initiated/dueDiligence
 *   5. page.tsx: 不再有"项目库"统计卡片（stats 数组无 label="项目库"）
 *   6. page.tsx: 不再有"已投项目"统计卡片
 *   7. page.tsx: stats 数组包含"本周新增"卡片
 *   8. page.tsx: stats 数组包含"PreDD"卡片
 *   9. page.tsx: stats 数组包含"立项项目"卡片
 *  10. page.tsx: stats 数组包含"尽调项目"卡片
 *  11. page.tsx: stats 卡片总数为 4 个
 *  12. page.tsx: 不再使用"查看项目库"链接
 *  13. page.tsx: 副标题改为"本周项目动态总览"
 *
 * B. Dashboard API 改造
 *  14. route.ts: stats 返回字段包含 weeklyNew
 *  15. route.ts: stats 返回字段包含 preDD
 *  16. route.ts: stats 返回字段包含 initiated
 *  17. route.ts: stats 返回字段包含 dueDiligence
 *  18. route.ts: stats 不再返回 totalProjects
 *  19. route.ts: stats 不再返回 invested
 *  20. route.ts: 不再返回 years 字段
 *  21. route.ts: 不再返回 selectedYear 字段
 *  22. route.ts: weeklyNewCount 基于 targetDate >= weekStart
 *  23. route.ts: preDDCount 基于 stageChangedAt >= weekStart 且 followStage === 'PRE_DD'
 *  24. route.ts: initiatedCount 基于 stageChangedAt >= weekStart 且 followStage === 'PROJECT_INITIATION'
 *  25. route.ts: dueDiligenceCount 基于 stageChangedAt >= weekStart 且 followStage === 'DUE_DILIGENCE'
 *  26. route.ts: 不再使用 parsePassedStages（导入或调用）
 *  27. route.ts: GET 函数签名不再需要 request 参数
 *
 * C. 工作台阶段卡片收窄（6 个一行）
 *  28. workbench/page.tsx: 阶段统计概览使用 6 列布局（grid-cols-6）
 *  29. workbench/page.tsx: 卡片 padding 收窄（p-3 而非 p-4）
 *  30. workbench/page.tsx: 卡片圆角收窄（rounded-xl 而非 rounded-2xl）
 *  31. workbench/page.tsx: 图标容器尺寸缩小（w-8 h-8）
 *  32. workbench/page.tsx: 数量字号缩小（text-lg 而非 text-xl）
 *  33. workbench/page.tsx: stageIcons SVG 尺寸为 w-4 h-4（与收窄卡片匹配）
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

// ========== A. 首页改造 ==========

async function testHomePage() {
  console.log('\n━━━ A. 首页改造 ━━━\n')

  const pageSrc = await readSrc('src/app/page.tsx')

  console.log('── A1-A3: 去掉年份筛选 ──')
  log(
    'A1: 不再使用 selectedYear 状态',
    !/selectedYear/.test(pageSrc)
  )
  log(
    'A2: 不再有年份筛选器 UI',
    !pageSrc.includes('年份筛选')
  )
  log(
    'A3: fetchDashboard 不再传 year 参数',
    !/fetchDashboard\(\s*\w+\s*\)/.test(pageSrc) || /fetchDashboard\(\s*\)/.test(pageSrc)
  )

  console.log('\n── A4: DashboardData 接口 ──')
  log(
    'A4: DashboardData 接口仅含 weeklyNew/preDD/initiated/dueDiligence',
    /interface DashboardData[\s\S]*?stats:\s*\{[\s\S]*?weeklyNew[\s\S]*?preDD[\s\S]*?initiated[\s\S]*?dueDiligence[\s\S]*?\}/.test(pageSrc)
  )

  console.log('\n── A5-A11: stats 数组 ──')
  log(
    'A5: 不再有"项目库"统计卡片',
    !/label:\s*['"]项目库['"]/.test(pageSrc)
  )
  log(
    'A6: 不再有"已投项目"统计卡片',
    !/label:\s*['"]已投项目['"]/.test(pageSrc)
  )
  log(
    'A7: 包含"本周新增"卡片',
    /label:\s*['"]本周新增['"]/.test(pageSrc)
  )
  log(
    'A8: 包含"PreDD"卡片',
    /label:\s*['"]PreDD['"]/.test(pageSrc)
  )
  log(
    'A9: 包含"立项项目"卡片',
    /label:\s*['"]立项项目['"]/.test(pageSrc)
  )
  log(
    'A10: 包含"尽调项目"卡片',
    /label:\s*['"]尽调项目['"]/.test(pageSrc)
  )

  // 统计 stats 数组中的卡片数量：通过 value: data?.stats?.xxx 的出现次数
  const valueMatches = pageSrc.match(/value:\s*data\?\.stats\?\.\w+/g)
  const cardCount = valueMatches ? valueMatches.length : 0
  log(
    `A11: stats 卡片总数为 4 个（实际 ${cardCount} 个）`,
    cardCount === 4,
    `找到 ${cardCount} 个 value 字段引用`
  )

  console.log('\n── A12-A13: 其他清理 ──')
  log(
    'A12: 不再使用"查看项目库"链接',
    !pageSrc.includes('查看项目库')
  )
  log(
    'A13: 副标题改为"本周项目动态总览"',
    pageSrc.includes('本周项目动态总览')
  )
}

// ========== B. Dashboard API 改造 ==========

async function testDashboardApi() {
  console.log('\n━━━ B. Dashboard API 改造 ━━━\n')

  const apiSrc = await readSrc('src/app/api/dashboard/route.ts')

  console.log('── B14-B21: stats 返回字段 ──')
  log(
    'B14: stats 包含 weeklyNew',
    /stats:\s*\{[\s\S]*?weeklyNew:/.test(apiSrc)
  )
  log(
    'B15: stats 包含 preDD',
    /stats:\s*\{[\s\S]*?preDD:/.test(apiSrc)
  )
  log(
    'B16: stats 包含 initiated',
    /stats:\s*\{[\s\S]*?initiated:/.test(apiSrc)
  )
  log(
    'B17: stats 包含 dueDiligence',
    /stats:\s*\{[\s\S]*?dueDiligence:/.test(apiSrc)
  )
  log(
    'B18: stats 不再返回 totalProjects',
    !/stats:\s*\{[\s\S]*?totalProjects:/.test(apiSrc)
  )
  log(
    'B19: stats 不再返回 invested',
    !/stats:\s*\{[\s\S]*?invested:/.test(apiSrc)
  )
  log(
    'B20: 不再返回 years 字段',
    !/years,/.test(apiSrc) && !/years:\s*years/.test(apiSrc)
  )
  log(
    'B21: 不再返回 selectedYear 字段',
    !/selectedYear:/.test(apiSrc)
  )

  console.log('\n── B22-B25: 统计逻辑 ──')
  log(
    'B22: weeklyNewCount 基于 targetDate >= weekStart',
    /weeklyNewCount[\s\S]{0,300}initialDate[\s\S]{0,100}>=\s*weekStart/.test(apiSrc)
  )
  log(
    "B23: preDDCount 基于 stageChangedAt >= weekStart 且 followStage === 'PRE_DD'",
    /preDDCount[\s\S]{0,400}stageChangedAt[\s\S]{0,200}>=\s*weekStart[\s\S]{0,200}PRE_DD/.test(apiSrc)
  )
  log(
    "B24: initiatedCount 基于 stageChangedAt >= weekStart 且 followStage === 'PROJECT_INITIATION'",
    /initiatedCount[\s\S]{0,400}stageChangedAt[\s\S]{0,200}>=\s*weekStart[\s\S]{0,200}PROJECT_INITIATION/.test(apiSrc)
  )
  log(
    "B25: dueDiligenceCount 基于 stageChangedAt >= weekStart 且 followStage === 'DUE_DILIGENCE'",
    /dueDiligenceCount[\s\S]{0,400}stageChangedAt[\s\S]{0,200}>=\s*weekStart[\s\S]{0,200}DUE_DILIGENCE/.test(apiSrc)
  )

  console.log('\n── B26-B27: 清理 ──')
  log(
    'B26: 不再使用 parsePassedStages',
    !apiSrc.includes('parsePassedStages')
  )
  log(
    'B27: GET 函数签名不再需要 request 参数',
    /export async function GET\(\)/.test(apiSrc)
  )
}

// ========== C. 工作台阶段卡片收窄 ==========

async function testWorkbenchCards() {
  console.log('\n━━━ C. 工作台阶段卡片收窄 ━━━\n')

  const workbenchSrc = await readSrc('src/app/workbench/page.tsx')

  console.log('── C28-C33: 阶段统计概览 ──')
  log(
    'C28: 使用 6 列布局（md:grid-cols-6）',
    /md:grid-cols-6/.test(workbenchSrc)
  )
  log(
    'C29: 卡片 padding 收窄（p-3）',
    /阶段统计概览[\s\S]{0,500}p-3/.test(workbenchSrc)
  )
  log(
    'C30: 卡片圆角收窄（rounded-xl）',
    /阶段统计概览[\s\S]{0,500}rounded-xl/.test(workbenchSrc)
  )
  log(
    'C31: 图标容器尺寸缩小（w-8 h-8）',
    /阶段统计概览[\s\S]{0,500}w-8 h-8/.test(workbenchSrc)
  )
  log(
    'C32: 数量字号缩小（text-lg）',
    /md:grid-cols-6[\s\S]{0,800}text-lg font-bold/.test(workbenchSrc)
  )
  log(
    'C33: stageIcons SVG 尺寸为 w-4 h-4',
    !/w-5 h-5 text-white/.test(workbenchSrc) && /w-4 h-4 text-white/.test(workbenchSrc)
  )
}

// ========== 主入口 ==========

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  测试：首页改造 + 工作台阶段卡片收窄（6 个一行）        ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  await testHomePage()
  await testDashboardApi()
  await testWorkbenchCards()

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
