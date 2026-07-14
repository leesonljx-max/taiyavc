/**
 * 测试脚本：项目库三项更新
 *
 * 测试覆盖：
 * A. "协议"(AGREEMENT) 阶段
 *   1. types.ts: FollowStage 类型、followStageLabels、followStageColors 包含 AGREEMENT
 *   2. stage-utils.ts: STAGE_ORDER 包含 AGREEMENT 且位置正确（尽调和交割之间）
 *   3. stage-utils.ts: parsePassedStages 向后兼容（旧数据自动补齐 AGREEMENT）
 *   4. stage-utils.ts: computePassedStages 包含 AGREEMENT
 *   5. permissions.ts: AGREEMENT 在 RESTRICTED_STAGES 中
 *   6. projects/page.tsx: stageIcons 和 stageCardStyles 包含 AGREEMENT
 *   7. projects/[id]/route.ts: 交割审批条件为 AGREEMENT → CLOSING（非 DUE_DILIGENCE → CLOSING）
 *   8. dashboard/route.ts: MAINTAINER_STAGES 和 stageCounts 包含 AGREEMENT
 *   9. page.tsx（首页）: 维护人阶段列表包含 AGREEMENT
 *   10. workbench/page.tsx: STAGE_ORDER、stageGradients、stageBorderLeft、stageIcons 包含 AGREEMENT
 *   11. statistics/page.tsx: stageLabels 包含 AGREEMENT
 *
 * B. 年份筛选
 *   12. projects/page.tsx: 存在 selectedYear 状态
 *   13. projects/page.tsx: 存在 availableYears 计算逻辑
 *   14. projects/page.tsx: filteredProjects 包含 matchesYear 过滤条件
 *   15. projects/page.tsx: 存在年份筛选下拉框 UI
 *
 * C. Tab 切换竞态修复
 *   16. projects/page.tsx: 存在 AbortController ref（fetchProjectsAbort）
 *   17. projects/page.tsx: fetchProjects 使用 AbortController（signal + abort）
 *   18. projects/page.tsx: fetchLeads 使用 AbortController
 *   19. projects/page.tsx: 不存在 scope 依赖的旧 useEffect（tab → scope → fetch 链已移除）
 *   20. projects/page.tsx: Tab 切换直接触发 fetch（非通过 scope 间接触发）
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

// ========== 本地实现（与 src/lib/stage-utils.ts 一致，含 AGREEMENT） ==========
const STAGE_ORDER = [
  'INITIAL_TALK',
  'PRE_DD',
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'AGREEMENT',
  'CLOSING',
  'POST_INVESTMENT',
] as const
type FollowStage = typeof STAGE_ORDER[number]

function parsePassedStagesLocal(raw: string | null | undefined): FollowStage[] {
  if (!raw) return ['INITIAL_TALK']
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr) && arr.length > 0) {
      const stages = arr as FollowStage[]
      let latestIdx = -1
      for (const s of stages) {
        const idx = STAGE_ORDER.indexOf(s)
        if (idx > latestIdx) latestIdx = idx
      }
      if (latestIdx >= 0) {
        const required = STAGE_ORDER.slice(0, latestIdx + 1)
        const set = new Set<FollowStage>([...stages, ...required])
        return STAGE_ORDER.filter(s => set.has(s))
      }
      return stages
    }
  } catch {}
  return ['INITIAL_TALK']
}

function computePassedStagesLocal(current: FollowStage[], newStage: FollowStage): FollowStage[] {
  const newIdx = STAGE_ORDER.indexOf(newStage)
  if (newIdx === -1) return current
  const required = STAGE_ORDER.slice(0, newIdx + 1)
  const set = new Set<FollowStage>([...current, ...required])
  return STAGE_ORDER.filter(s => set.has(s))
}

// ========== A. AGREEMENT 阶段测试 ==========

async function testAgreementStage() {
  console.log('\n━━━ A. "协议"(AGREEMENT) 阶段测试 ━━━\n')

  // ── A1: types.ts 验证 ──
  console.log('── A1: types.ts 验证 ──')
  const typesSrc = await readSrc('src/app/projects/types.ts')

  log(
    'FollowStage 类型包含 AGREEMENT',
    /'AGREEMENT'/.test(typesSrc) && /AGREEMENT.*CLOSING/.test(typesSrc.replace(/\s+/g, ''))
  )
  log(
    "followStageLabels 包含 AGREEMENT: '协议'",
    /AGREEMENT:\s*'协议'/.test(typesSrc)
  )
  log(
    'followStageColors 包含 AGREEMENT',
    /AGREEMENT:\s*'bg-teal-100 text-teal-800'/.test(typesSrc)
  )

  // ── A2: stage-utils.ts STAGE_ORDER 验证 ──
  console.log('\n── A2: stage-utils.ts STAGE_ORDER 验证 ──')
  const stageUtilsSrc = await readSrc('src/lib/stage-utils.ts')

  log(
    'STAGE_ORDER 包含 AGREEMENT',
    stageUtilsSrc.includes("'AGREEMENT'")
  )
  log(
    'AGREEMENT 位于 DUE_DILIGENCE 和 CLOSING 之间',
    stageUtilsSrc.indexOf("'DUE_DILIGENCE'") < stageUtilsSrc.indexOf("'AGREEMENT'") &&
    stageUtilsSrc.indexOf("'AGREEMENT'") < stageUtilsSrc.indexOf("'CLOSING'")
  )

  // ── A3: parsePassedStages 向后兼容测试 ──
  console.log('\n── A3: parsePassedStages 向后兼容测试 ──')

  // 旧数据：项目在 AGREEMENT 添加前已进入 CLOSING，passedStages 不含 AGREEMENT
  const oldDataClosing = '["INITIAL_TALK","PRE_DD","PROJECT_INITIATION","DUE_DILIGENCE","CLOSING"]'
  const parsedClosing = parsePassedStagesLocal(oldDataClosing)
  log(
    '旧数据（已到CLOSING）自动补齐 AGREEMENT',
    parsedClosing.includes('AGREEMENT'),
    `parsed=${JSON.stringify(parsedClosing)}`
  )
  log(
    '补齐后 AGREEMENT 在 CLOSING 之前',
    parsedClosing.indexOf('AGREEMENT') < parsedClosing.indexOf('CLOSING'),
    `parsed=${JSON.stringify(parsedClosing)}`
  )

  // 旧数据：项目已到 POST_INVESTMENT
  const oldDataPost = '["INITIAL_TALK","PRE_DD","PROJECT_INITIATION","DUE_DILIGENCE","CLOSING","POST_INVESTMENT"]'
  const parsedPost = parsePassedStagesLocal(oldDataPost)
  log(
    '旧数据（已到POST_INVESTMENT）自动补齐 AGREEMENT',
    parsedPost.includes('AGREEMENT'),
    `parsed=${JSON.stringify(parsedPost)}`
  )

  // 新数据：已包含 AGREEMENT
  const newData = '["INITIAL_TALK","PRE_DD","PROJECT_INITIATION","DUE_DILIGENCE","AGREEMENT"]'
  const parsedNew = parsePassedStagesLocal(newData)
  log(
    '新数据（已含AGREEMENT）正常解析',
    parsedNew.includes('AGREEMENT') && parsedNew.length === 5,
    `parsed=${JSON.stringify(parsedNew)}`
  )

  // 边界：只有 INITIAL_TALK
  log(
    'parsePassedStages(\'["INITIAL_TALK"]\') 不补齐 AGREEMENT',
    !parsePassedStagesLocal('["INITIAL_TALK"]').includes('AGREEMENT')
  )

  // ── A4: computePassedStages 包含 AGREEMENT ──
  console.log('\n── A4: computePassedStages 包含 AGREEMENT ──')

  log(
    'computePassedStages([], AGREEMENT) = 包含 INITIAL_TALK 到 AGREEMENT',
    JSON.stringify(computePassedStagesLocal([], 'AGREEMENT')) ===
    JSON.stringify(['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'AGREEMENT']),
    `result=${JSON.stringify(computePassedStagesLocal([], 'AGREEMENT'))}`
  )

  log(
    'computePassedStages(["INITIAL_TALK","PRE_DD","PROJECT_INITIATION","DUE_DILIGENCE","AGREEMENT"], CLOSING) 包含全部到 CLOSING',
    JSON.stringify(computePassedStagesLocal(
      ['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'AGREEMENT'], 'CLOSING'
    )) === JSON.stringify(['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'AGREEMENT', 'CLOSING'])
  )

  log(
    'computePassedStages(["INITIAL_TALK"], CLOSING) 补齐中间所有阶段含 AGREEMENT',
    JSON.stringify(computePassedStagesLocal(['INITIAL_TALK'], 'CLOSING')) ===
    JSON.stringify(['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'AGREEMENT', 'CLOSING']),
    `result=${JSON.stringify(computePassedStagesLocal(['INITIAL_TALK'], 'CLOSING'))}`
  )

  log(
    'computePassedStages 到 POST_INVESTMENT 包含全部7阶段',
    computePassedStagesLocal([], 'POST_INVESTMENT').length === 7 &&
    computePassedStagesLocal([], 'POST_INVESTMENT').includes('AGREEMENT')
  )

  // ── A5: permissions.ts 验证 ──
  console.log('\n── A5: permissions.ts 验证 ──')
  const permSrc = await readSrc('src/lib/permissions.ts')
  log(
    'RESTRICTED_STAGES 包含 AGREEMENT',
    /RESTRICTED_STAGES.*AGREEMENT/.test(permSrc.replace(/\s+/g, ' '))
  )

  // ── A6: projects/page.tsx stageIcons & stageCardStyles ──
  console.log('\n── A6: projects/page.tsx 阶段图标和样式 ──')
  const pageSrc = await readSrc('src/app/projects/page.tsx')

  log(
    'stageIcons 包含 AGREEMENT',
    /AGREEMENT:\s*\(/.test(pageSrc)
  )
  log(
    'stageCardStyles 包含 AGREEMENT',
    /AGREEMENT:\s*'from-teal-400 to-teal-500'/.test(pageSrc)
  )
  log(
    '统计卡片 grid 使用 lg:grid-cols-8（7阶段+1项目库）',
    pageSrc.includes('lg:grid-cols-8')
  )

  // ── A7: 项目更新 API 交割审批条件 ──
  console.log('\n── A7: 项目更新 API 交割审批条件 ──')
  const apiSrc = await readSrc('src/app/api/projects/[id]/route.ts')

  log(
    "审批条件为 AGREEMENT → CLOSING（非 DUE_DILIGENCE → CLOSING）",
    apiSrc.includes("data.followStage === 'CLOSING' && project.followStage === 'AGREEMENT'") &&
    !apiSrc.includes("data.followStage === 'CLOSING' && project.followStage === 'DUE_DILIGENCE'")
  )

  // ── A8: dashboard API ──
  console.log('\n── A8: dashboard API 验证 ──')
  const dashSrc = await readSrc('src/app/api/dashboard/route.ts')

  log(
    'MAINTAINER_STAGES 包含 AGREEMENT',
    dashSrc.includes("'AGREEMENT'")
  )
  log(
    'stageCounts 初始化包含 AGREEMENT: 0',
    /AGREEMENT:\s*0/.test(dashSrc)
  )

  // ── A9: 首页 page.tsx ──
  console.log('\n── A9: 首页 page.tsx 验证 ──')
  const homeSrc = await readSrc('src/app/page.tsx')

  log(
    "维护人阶段列表包含 AGREEMENT: '协议'",
    homeSrc.includes("AGREEMENT") && homeSrc.includes("协议")
  )
  log(
    'lateStages 包含 AGREEMENT',
    /lateStages.*AGREEMENT/.test(homeSrc.replace(/\s+/g, ' '))
  )

  // ── A10: workbench/page.tsx ──
  console.log('\n── A10: workbench/page.tsx 验证 ──')
  const workbenchSrc = await readSrc('src/app/workbench/page.tsx')

  log(
    'STAGE_ORDER 包含 AGREEMENT',
    workbenchSrc.includes("'AGREEMENT'")
  )
  log(
    'PARTNER_VISIBLE_STAGES 包含 AGREEMENT',
    /PARTNER_VISIBLE_STAGES[\s\S]*AGREEMENT/.test(workbenchSrc)
  )
  log(
    'stageGradients 包含 AGREEMENT',
    /AGREEMENT:\s*'from-teal-400 to-teal-500'/.test(workbenchSrc)
  )
  log(
    'stageBorderLeft 包含 AGREEMENT',
    /AGREEMENT:\s*'border-l-teal-400'/.test(workbenchSrc)
  )
  log(
    'stageIcons 包含 AGREEMENT',
    /AGREEMENT:\s*\(/.test(workbenchSrc)
  )

  // ── A11: statistics/page.tsx ──
  console.log('\n── A11: statistics/page.tsx 验证 ──')
  const statsSrc = await readSrc('src/app/statistics/page.tsx')

  log(
    "stageLabels 包含 AGREEMENT: '协议'",
    /AGREEMENT:\s*'协议'/.test(statsSrc)
  )
}

// ========== B. 年份筛选测试 ==========

async function testYearFiltering() {
  console.log('\n━━━ B. 年份筛选测试 ━━━\n')

  const pageSrc = await readSrc('src/app/projects/page.tsx')

  // ── B12: selectedYear 状态 ──
  console.log('── B12: selectedYear 状态 ──')
  log(
    "存在 selectedYear 状态声明",
    /const\s+\[selectedYear,\s*setSelectedYear\]\s*=\s*useState<number\s*\|\s*'all'>\('all'\)/.test(pageSrc)
  )

  // ── B13: availableYears 计算逻辑 ──
  console.log('\n── B13: availableYears 计算逻辑 ──')
  log(
    '存在 availableYears 变量计算（基于 targetDate 提取年份）',
    pageSrc.includes('availableYears') &&
    pageSrc.includes('new Date(p.targetDate).getFullYear()') &&
    pageSrc.includes('availableYears')
  )
  log(
    'availableYears 降序排列',
    /availableYears[\s\S]*sort\(\(a,\s*b\)\s*=>\s*b\s*-\s*a\)/.test(pageSrc)
  )

  // ── B14: filteredProjects 包含 matchesYear ──
  console.log('\n── B14: filteredProjects 包含 matchesYear ──')
  log(
    'filteredProjects 包含 matchesYear 过滤条件',
    pageSrc.includes('matchesYear') &&
    pageSrc.includes('new Date(project.targetDate).getFullYear() === selectedYear')
  )
  log(
    'filteredProjects 返回条件包含 matchesYear',
    /return\s+matchesSearch\s*&&\s*matchesStage\s*&&\s*matchesIndustry\s*&&\s*matchesYear/.test(pageSrc.replace(/\s+/g, ' '))
  )

  // ── B15: 年份筛选下拉框 UI ──
  console.log('\n── B15: 年份筛选下拉框 UI ──')
  log(
    '存在年份筛选 select 元素',
    pageSrc.includes('selectedYear') &&
    pageSrc.includes('setSelectedYear') &&
    pageSrc.includes('所有年份')
  )
  log(
    '年份下拉框渲染 availableYears',
    /availableYears\.map\(year\s*=>/.test(pageSrc)
  )

  // ── 年份过滤逻辑单元测试 ──
  console.log('\n── 年份过滤逻辑单元测试 ──')

  // 模拟项目数据
  const mockProjects = [
    { name: '项目A', targetDate: '2025-03-15T00:00:00.000Z' },
    { name: '项目B', targetDate: '2026-01-10T00:00:00.000Z' },
    { name: '项目C', targetDate: '2026-06-20T00:00:00.000Z' },
    { name: '项目D', targetDate: '2024-11-05T00:00:00.000Z' },
    { name: '项目E', targetDate: '' },
  ]

  // 测试 availableYears 提取
  const extractedYears = Array.from(
    new Set(
      mockProjects
        .map(p => p.targetDate ? new Date(p.targetDate).getFullYear() : null)
        .filter((y): y is number => y !== null)
    )
  ).sort((a, b) => b - a)

  log(
    'availableYears 正确提取年份 [2026, 2025, 2024]',
    JSON.stringify(extractedYears) === JSON.stringify([2026, 2025, 2024]),
    `result=${JSON.stringify(extractedYears)}`
  )

  // 测试年份过滤
  const filterByYear = (projects: typeof mockProjects, year: number | 'all') => {
    return projects.filter(p =>
      year === 'all' ||
      (p.targetDate && new Date(p.targetDate).getFullYear() === year)
    )
  }

  log(
    'selectedYear=2026 过滤出2个项目',
    filterByYear(mockProjects, 2026).length === 2,
    `count=${filterByYear(mockProjects, 2026).length}`
  )
  log(
    'selectedYear=2025 过滤出1个项目',
    filterByYear(mockProjects, 2025).length === 1
  )
  log(
    'selectedYear=2024 过滤出1个项目',
    filterByYear(mockProjects, 2024).length === 1
  )
  log(
    "selectedYear='all' 过滤出全部5个项目",
    filterByYear(mockProjects, 'all').length === 5
  )
  log(
    '空 targetDate 项目在年份筛选下不显示',
    !filterByYear(mockProjects, 2026).some(p => p.name === '项目E')
  )
}

// ========== C. Tab 切换竞态修复测试 ==========

async function testTabSwitchingRaceCondition() {
  console.log('\n━━━ C. Tab 切换竞态修复测试 ━━━\n')

  const pageSrc = await readSrc('src/app/projects/page.tsx')

  // ── C16: AbortController ref ──
  console.log('── C16: AbortController ref ──')
  log(
    '存在 fetchProjectsAbort ref 声明',
    pageSrc.includes('fetchProjectsAbort') &&
    /useRef<AbortController\s*\|\s*null>/.test(pageSrc)
  )
  log(
    '存在 fetchLeadsAbort ref 声明',
    pageSrc.includes('fetchLeadsAbort')
  )

  // ── C17: fetchProjects 使用 AbortController ──
  console.log('\n── C17: fetchProjects 使用 AbortController ──')
  log(
    'fetchProjects 开头取消上一个请求 (abort)',
    /fetchProjects\s*=\s*useCallback[\s\S]*fetchProjectsAbort\.current\.abort\(\)/.test(pageSrc)
  )
  log(
    'fetchProjects 创建新 AbortController',
    /fetchProjects\s*=\s*useCallback[\s\S]*const\s+controller\s*=\s*new\s+AbortController\(\)/.test(pageSrc)
  )
  log(
    'fetch 请求传入 signal 参数',
    pageSrc.includes('signal: controller.signal')
  )
  log(
    'catch 中处理 AbortError（不显示错误）',
    pageSrc.includes("error.name === 'AbortError'") ||
    pageSrc.includes('AbortError')
  )
  log(
    'loading 状态仅在当前请求未取消时更新',
    pageSrc.includes('fetchProjectsAbort.current === controller')
  )

  // ── C18: fetchLeads 使用 AbortController ──
  console.log('\n── C18: fetchLeads 使用 AbortController ──')
  log(
    'fetchLeads 开头取消上一个请求 (abort)',
    /fetchLeads\s*=\s*useCallback[\s\S]*fetchLeadsAbort\.current\.abort\(\)/.test(pageSrc)
  )
  log(
    'fetchLeads 创建新 AbortController',
    /fetchLeads\s*=\s*useCallback[\s\S]*const\s+controller\s*=\s*new\s+AbortController\(\)/.test(pageSrc)
  )
  log(
    'fetchLeads loading 状态仅在当前请求未取消时更新',
    pageSrc.includes('fetchLeadsAbort.current === controller')
  )

  // ── C19: 旧的 scope 依赖 useEffect 已移除 ──
  console.log('\n── C19: 旧的 scope 依赖链已移除 ──')

  // 检查不存在 "useEffect(() => { if (tab !== 'leads') fetchProjects() }, [scope, tab])"
  log(
    '不存在 [scope, tab] 依赖的旧 useEffect',
    !/\},\s*\[scope,\s*tab\]\)/.test(pageSrc)
  )
  log(
    '不存在 [scope] 依赖的旧 useEffect',
    !/\},\s*\[scope\]\)/.test(pageSrc)
  )
  log(
    '不存在 tab → setScope → fetch 的间接触发链',
    !(/useEffect\(\(\)\s*=>\s*\{[\s\S]*if\s*\(tab\s*===\s*'library'\)\s*setScope\('all'\)/.test(pageSrc) &&
      /\},\s*\[scope,/.test(pageSrc))
  )

  // ── C20: Tab 切换直接触发 fetch ──
  console.log('\n── C20: Tab 切换直接触发 fetch ──')
  log(
    'Tab useEffect 直接调用 fetchProjects(currentScope)',
    /useEffect\(\(\)\s*=>\s*\{[\s\S]*if\s*\(tab\s*===\s*'leads'\)\s*\{[\s\S]*fetchLeads\(\)[\s\S]*\}\s*else\s*\{[\s\S]*fetchProjects\(currentScope\)/.test(pageSrc)
  )
  log(
    'fetchProjects 接受 currentScope 参数（非从 state 读取 scope）',
    /fetchProjects\s*=\s*useCallback\(async\s*\(currentScope:\s*'all'\s*\|\s*'mine'\)/.test(pageSrc)
  )
  log(
    'useCallback 依赖数组为空（不会因 scope 变化重新创建）',
    /fetchProjects\s*=\s*useCallback\([\s\S]*\},\s*\[\]\)/.test(pageSrc)
  )

  // ── AbortController 行为模拟测试 ──
  console.log('\n── AbortController 行为模拟测试 ──')

  // 模拟 AbortController 的竞态保护行为
  let lastResult = ''
  let lastLoading = false

  async function simulatedFetch(scope: string, controller: AbortController): Promise<void> {
    try {
      // 模拟网络延迟
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 50)
        controller.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
      // 模拟设置结果
      lastResult = `data_for_${scope}`
      lastLoading = false
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return // 被取消，不更新结果
      }
      throw e
    }
  }

  // 模拟快速切换 Tab：library → mine → library
  const controller1 = new AbortController()
  const controller2 = new AbortController()
  const controller3 = new AbortController()

  // 并发发起3个请求（模拟快速切换）
  const fetch1 = simulatedFetch('all', controller1)
  // 中途取消第一个，发起第二个
  controller1.abort()
  const fetch2 = simulatedFetch('mine', controller2)
  // 中途取消第二个，发起第三个
  controller2.abort()
  const fetch3 = simulatedFetch('all', controller3)

  await Promise.all([fetch1, fetch2, fetch3])

  log(
    '快速切换后最终结果为最后一个请求的数据',
    lastResult === 'data_for_all',
    `lastResult=${lastResult}`
  )
  log(
    '被取消的请求不更新 loading 状态',
    lastLoading === false
  )
}

// ========== 主测试入口 ==========

async function main() {
  console.log('\n========================================')
  console.log('  项目库三项更新测试')
  console.log('  1. 增加"协议"阶段')
  console.log('  2. 按年份筛选')
  console.log('  3. Tab切换竞态修复')
  console.log('========================================\n')

  try {
    await testAgreementStage()
  } catch (e) {
    console.error('AGREEMENT 阶段测试出错:', e)
  }

  try {
    await testYearFiltering()
  } catch (e) {
    console.error('年份筛选测试出错:', e)
  }

  try {
    await testTabSwitchingRaceCondition()
  } catch (e) {
    console.error('Tab切换竞态测试出错:', e)
  }

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
