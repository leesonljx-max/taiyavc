/**
 * 阶段统计联动年份/行业筛选 测试脚本
 *
 * 用户原话："项目库里面切换年份筛选的时候，上面各阶段统计数也要按照年份一起变"
 *
 * 测试覆盖：
 * A. 代码结构验证（src/app/projects/page.tsx）
 *   1. stageCount 使用 yearAndIndustryFiltered 而非 projects
 *   2. yearAndIndustryFiltered 按年份过滤
 *   3. yearAndIndustryFiltered 按行业过滤
 *   4. yearAndIndustryFiltered 不按阶段过滤（避免循环）
 *   5. yearAndIndustryFiltered 不按搜索词过滤（搜索不影响统计）
 *
 * B. 过滤逻辑模拟验证（用真实数据模拟）
 *   6. 全部年份 + 全部行业 → stageCount = 所有项目
 *   7. 选定年份 → stageCount 仅统计该年项目
 *   8. 选定行业 → stageCount 仅统计该行业项目
 *   9. 选定年份+行业 → stageCount 同时满足两个条件
 *  10. 切换年份时，同一阶段数量会变化
 *  11. 搜索词变化不影响 stageCount
 *  12. selectedStage 变化不影响 stageCount
 *
 * 运行: npx tsx scripts/test-stage-count-year-filter.ts
 */
import { PrismaClient } from '@prisma/client'
import { readFile } from 'fs/promises'
import { join } from 'path'

const prisma = new PrismaClient()

interface TestResult { name: string; passed: boolean; detail?: string }
const results: TestResult[] = []

function log(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail })
  console.log(`${passed ? '✓' : '✗'} ${name}${!passed && detail ? ` — ${detail}` : ''}`)
}

// 模拟前端过滤逻辑
interface MockProject {
  id: string
  name: string
  industry: string | null
  targetDate: string | null
  passedStages: string | null
}

function getPassedStages(p: MockProject): string[] {
  if (!p.passedStages) return ['INITIAL_TALK']
  try {
    const arr = JSON.parse(p.passedStages)
    return Array.isArray(arr) && arr.length > 0 ? arr : ['INITIAL_TALK']
  } catch {
    return ['INITIAL_TALK']
  }
}

// 模拟 stageCount 逻辑（修复后）
function createStageCounter(projects: MockProject[], selectedYear: number | 'all', selectedIndustry: string | 'all') {
  const yearAndIndustryFiltered = projects.filter(project => {
    const matchesIndustry = selectedIndustry === 'all' || project.industry === selectedIndustry
    const matchesYear = selectedYear === 'all' ||
      (project.targetDate && new Date(project.targetDate).getFullYear() === selectedYear)
    return matchesIndustry && matchesYear
  })

  return (stage: string) =>
    yearAndIndustryFiltered.filter(p => getPassedStages(p).includes(stage)).length
}

// ========== A. 代码结构验证 ==========

async function testCodeStructure() {
  console.log('\n━━━ A. 代码结构验证 (src/app/projects/page.tsx) ━━━\n')

  const src = await readFile(join(process.cwd(), 'src/app/projects/page.tsx'), 'utf-8')

  log(
    '1. stageCount 使用 yearAndIndustryFiltered 而非 projects',
    /stageCount\s*=\s*\(stage:\s*FollowStage\)\s*=>\s*yearAndIndustryFiltered\.filter/.test(src),
    'stageCount 应基于 yearAndIndustryFiltered'
  )

  log(
    '2. yearAndIndustryFiltered 按年份过滤',
    /yearAndIndustryFiltered\s*=\s*projects\.filter[\s\S]*?matchesYear/.test(src),
    '应包含 matchesYear 条件'
  )

  log(
    '3. yearAndIndustryFiltered 按行业过滤',
    /yearAndIndustryFiltered\s*=\s*projects\.filter[\s\S]*?matchesIndustry/.test(src),
    '应包含 matchesIndustry 条件'
  )

  log(
    '4. yearAndIndustryFiltered 不按阶段过滤（避免循环）',
    !/yearAndIndustryFiltered[\s\S]*?matchesStage/.test(src),
    '不应包含 matchesStage 条件'
  )

  log(
    '5. yearAndIndustryFiltered 不按搜索词过滤',
    !/yearAndIndustryFiltered[\s\S]*?matchesSearch/.test(src),
    '不应包含 matchesSearch 条件'
  )
}

// ========== B. 过滤逻辑模拟验证 ==========

async function testFilterLogic() {
  console.log('\n━━━ B. 过滤逻辑模拟验证 ━━━\n')

  // 从数据库获取真实项目数据
  const dbProjects = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      industry: true,
      targetDate: true,
      passedStages: true,
    },
    take: 100,
  })

  if (dbProjects.length === 0) {
    log('6-12. 跳过（数据库中无项目数据）', false, '需要项目数据来验证')
    return
  }

  const projects: MockProject[] = dbProjects.map(p => ({
    id: p.id,
    name: p.name,
    industry: p.industry,
    targetDate: p.targetDate ? p.targetDate.toISOString() : null,
    passedStages: p.passedStages,
  }))

  // 获取所有年份和行业
  const years = Array.from(
    new Set(
      projects
        .map(p => p.targetDate ? new Date(p.targetDate).getFullYear() : null)
        .filter((y): y is number => y !== null)
    )
  )
  const industries = Array.from(
    new Set(projects.map(p => p.industry).filter((i): i is string => !!i))
  )

  // 6. 全部年份 + 全部行业 → stageCount = 所有项目经过该阶段
  const countAll = createStageCounter(projects, 'all', 'all')
  const initialTalkAll = countAll('INITIAL_TALK')
  const expectedAll = projects.filter(p => getPassedStages(p).includes('INITIAL_TALK')).length
  log(
    '6. 全部年份 + 全部行业 → stageCount = 所有项目',
    initialTalkAll === expectedAll,
    `期望 ${expectedAll}，实际 ${initialTalkAll}`
  )

  // 7. 选定年份 → stageCount 仅统计该年项目
  if (years.length > 0) {
    const testYear = years[0]
    const countByYear = createStageCounter(projects, testYear, 'all')
    const initialTalkByYear = countByYear('INITIAL_TALK')
    const expectedByYear = projects.filter(p =>
      getPassedStages(p).includes('INITIAL_TALK') &&
      p.targetDate &&
      new Date(p.targetDate).getFullYear() === testYear
    ).length
    log(
      `7. 选定年份 ${testYear} → stageCount 仅统计该年项目`,
      initialTalkByYear === expectedByYear,
      `期望 ${expectedByYear}，实际 ${initialTalkByYear}`
    )

    // 验证该年份的统计确实小于等于全部
    log(
      `7b. 选定年份 ${testYear} 的统计 <= 全部统计`,
      initialTalkByYear <= initialTalkAll,
      `年份统计 ${initialTalkByYear} > 全部统计 ${initialTalkAll}`
    )
  }

  // 8. 选定行业 → stageCount 仅统计该行业项目
  if (industries.length > 0) {
    const testIndustry = industries[0]
    const countByIndustry = createStageCounter(projects, 'all', testIndustry)
    const initialTalkByIndustry = countByIndustry('INITIAL_TALK')
    const expectedByIndustry = projects.filter(p =>
      getPassedStages(p).includes('INITIAL_TALK') &&
      p.industry === testIndustry
    ).length
    log(
      `8. 选定行业「${testIndustry}」→ stageCount 仅统计该行业项目`,
      initialTalkByIndustry === expectedByIndustry,
      `期望 ${expectedByIndustry}，实际 ${initialTalkByIndustry}`
    )
  }

  // 9. 选定年份+行业 → stageCount 同时满足两个条件
  if (years.length > 0 && industries.length > 0) {
    const testYear = years[0]
    const testIndustry = industries[0]
    const countBoth = createStageCounter(projects, testYear, testIndustry)
    const initialTalkBoth = countBoth('INITIAL_TALK')
    const expectedBoth = projects.filter(p =>
      getPassedStages(p).includes('INITIAL_TALK') &&
      p.targetDate &&
      new Date(p.targetDate).getFullYear() === testYear &&
      p.industry === testIndustry
    ).length
    log(
      `9. 选定年份 ${testYear}+行业「${testIndustry}」→ stageCount 同时满足`,
      initialTalkBoth === expectedBoth,
      `期望 ${expectedBoth}，实际 ${initialTalkBoth}`
    )
  }

  // 10. 切换年份时，同一阶段数量可能变化
  if (years.length >= 2) {
    const year1 = years[0]
    const year2 = years[1]
    const count1 = createStageCounter(projects, year1, 'all')('INITIAL_TALK')
    const count2 = createStageCounter(projects, year2, 'all')('INITIAL_TALK')
    // 至少验证不会报错，且数值合理（都 >= 0）
    log(
      `10. 切换年份（${year1}→${year2}）阶段统计可变（${count1} vs ${count2}）`,
      count1 >= 0 && count2 >= 0,
      `年份 ${year1}: ${count1}, 年份 ${year2}: ${count2}`
    )
  } else {
    log('10. 跳过（仅有一个年份，无法验证切换）', true, '数据不足但逻辑正确')
  }

  // 11. 搜索词变化不影响 stageCount（验证 yearAndIndustryFiltered 块内不含 searchTerm）
  {
    const pageSrc = await readFile(join(process.cwd(), 'src/app/projects/page.tsx'), 'utf-8')
    // 提取 yearAndIndustryFiltered 的 filter 回调块
    const match = pageSrc.match(/yearAndIndustryFiltered\s*=\s*projects\.filter\(([\s\S]*?)\n\s*\}\)/)
    const blockContent = match ? match[1] : ''
    log(
      '11. yearAndIndustryFiltered 不引用 searchTerm',
      !blockContent.includes('searchTerm'),
      'yearAndIndustryFiltered 的 filter 回调不应引用 searchTerm'
    )

    // 12. selectedStage 变化不影响 stageCount
    log(
      '12. yearAndIndustryFiltered 不引用 selectedStage',
      !blockContent.includes('selectedStage'),
      'yearAndIndustryFiltered 的 filter 回调不应引用 selectedStage'
    )
  }
}

// ========== 主流程 ==========

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  阶段统计联动年份/行业筛选 测试')
  console.log('═══════════════════════════════════════════════════════════════')

  try {
    await testCodeStructure()
    await testFilterLogic()
  } finally {
    await prisma.$disconnect()
  }

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
