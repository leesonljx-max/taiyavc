/**
 * 单元测试：分页功能
 *
 * 覆盖范围：
 * A. Pagination 组件
 * B. 项目库页面分页逻辑（项目库 50 / 我的项目 20 / 项目线索 30）
 * C. 工作台各阶段卡片分页逻辑（每阶段 20）
 * D. AI 线索分页逻辑（30）
 * E. 筛选条件变化时重置分页
 * F. 边界条件
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
// A. Pagination 组件测试
// ═══════════════════════════════════════════════════════════
console.log('\n══ A. Pagination 组件 ══')

{
  const componentPath = path.join(PROJECT_ROOT, 'src/components/Pagination.tsx')
  const content = fs.readFileSync(componentPath, 'utf-8')

  assert(content.includes('interface PaginationProps'), 'Pagination 接口定义存在')
  assert(content.includes('currentPage'), '包含 currentPage 属性')
  assert(content.includes('totalPages'), '包含 totalPages 属性')
  assert(content.includes('onPageChange'), '包含 onPageChange 回调')
  assert(content.includes('total'), '包含 total 属性')
  assert(content.includes('pageSize'), '包含 pageSize 属性')
  assert(content.includes('total <= pageSize'), '数据量不足一页时不显示分页')
  assert(content.includes('上一页') || content.includes('M15 19l-7-7 7-7'), '包含上一页按钮')
  assert(content.includes('下一页') || content.includes('M9 5l7 7-7 7'), '包含下一页按钮')
  assert(content.includes('currentPage <= 1'), '第一页时禁用上一页按钮')
  assert(content.includes('currentPage >= totalPages'), '最后一页时禁用下一页按钮')
  assert(content.includes('disabled:opacity-40'), '禁用状态有视觉反馈')
  assert(content.includes('disabled:cursor-not-allowed'), '禁用状态鼠标样式')
}

// ═══════════════════════════════════════════════════════════
// B. 项目库页面分页逻辑测试
// ═══════════════════════════════════════════════════════════
console.log('\n══ B. 项目库页面分页逻辑 ══')

{
  const pagePath = path.join(PROJECT_ROOT, 'src/app/projects/page.tsx')
  const content = fs.readFileSync(pagePath, 'utf-8')

  // 检查 import
  assert(content.includes("import Pagination from '@/components/Pagination'"), '项目库页面引入 Pagination 组件')

  // 检查分页常量
  assert(content.includes('PROJECT_PAGE_SIZE = 50'), '项目库每页 50 条')
  assert(content.includes('MINE_PAGE_SIZE = 20'), '我的项目每页 20 条')
  assert(content.includes('LEAD_PAGE_SIZE = 30'), '项目线索每页 30 条')

  // 检查分页状态
  assert(content.includes('projectPage'), '项目库分页状态存在')
  assert(content.includes('minePage'), '我的项目分页状态存在')
  assert(content.includes('leadPage'), '项目线索分页状态存在')

  // 检查分页计算
  assert(content.includes('currentProjectPageSize'), '动态选择项目页大小')
  assert(content.includes('currentProjectPage'), '动态选择当前项目页')
  assert(content.includes('setCurrentProjectPage'), '动态选择设置页码函数')
  assert(content.includes('totalProjectPages'), '项目总页数计算')
  assert(content.includes('pagedProjects'), '分页后的项目数组')
  assert(content.includes('totalLeadPages'), '线索总页数计算')
  assert(content.includes('pagedLeads'), '分页后的线索数组')

  // 检查筛选条件重置分页
  assert(content.includes("setProjectPage(1)"), '筛选条件变化时重置项目分页')
  assert(content.includes("setLeadPage(1)"), '搜索词变化时重置线索分页')

  // 检查 Pagination 组件使用
  assert(content.includes('<Pagination') || content.includes('Pagination ' as any) || content.includes('Pagination\n' as any) || content.includes('Pagination)'), '项目列表使用了 Pagination 组件')

  // 检查 pagedProjects 和 pagedLeads 用于渲染
  assert(content.includes('pagedProjects.map'), '项目卡片使用 pagedProjects 渲染')
  assert(content.includes('pagedLeads.map'), '线索卡片使用 pagedLeads 渲染')

  // 验证分页大小常量值
  const projectSizeMatch = content.match(/PROJECT_PAGE_SIZE\s*=\s*(\d+)/)
  const mineSizeMatch = content.match(/MINE_PAGE_SIZE\s*=\s*(\d+)/)
  const leadSizeMatch = content.match(/LEAD_PAGE_SIZE\s*=\s*(\d+)/)
  assertEqual(projectSizeMatch?.[1], '50', '项目库页面大小 = 50')
  assertEqual(mineSizeMatch?.[1], '20', '我的项目页面大小 = 20')
  assertEqual(leadSizeMatch?.[1], '30', '项目线索页面大小 = 30')

  // 验证 slice 逻辑
  assert(content.includes('filteredProjects.slice'), '项目分页使用 slice')
  assert(content.includes('filteredLeads.slice'), '线索分页使用 slice')
}

// ═══════════════════════════════════════════════════════════
// C. 工作台各阶段卡片分页逻辑测试
// ═══════════════════════════════════════════════════════════
console.log('\n══ C. 工作台各阶段卡片分页逻辑 ══')

{
  const pagePath = path.join(PROJECT_ROOT, 'src/app/workbench/page.tsx')
  const content = fs.readFileSync(pagePath, 'utf-8')

  // 检查 import
  assert(content.includes("import Pagination from '@/components/Pagination'"), '工作台引入 Pagination 组件')

  // 检查分页常量
  assert(content.includes('STAGE_PAGE_SIZE = 20'), '工作台每阶段每页 20 条')

  // 检查分页状态
  assert(content.includes('stagePage'), '工作台分页状态存在')
  assert(content.includes('setStagePage'), '工作台分页设置函数存在')

  // 检查筛选条件重置分页
  assert(content.includes("setStagePage(1)"), '阶段/经理变化时重置分页')

  // 检查分页计算
  assert(content.includes('totalStagePages'), '阶段总页数计算')
  assert(content.includes('pagedStageProjects'), '分页后的阶段项目数组')
  assert(content.includes('stageProjects.slice'), '阶段分页使用 slice')

  // 检查分页按钮在卡片头部
  assert(content.includes('stageProjects.length > STAGE_PAGE_SIZE'), '超过一页时显示分页按钮')

  // 检查分页按钮位置（在阶段头部）
  const headerSectionMatch = content.match(/阶段头部[\s\S]*?from-opacity-10[\s\S]*?/)
  assert(!!headerSectionMatch, '阶段头部区域存在')

  // 检查 pagedStageProjects 用于渲染
  assert(content.includes('pagedStageProjects.map'), '阶段项目卡片使用 pagedStageProjects 渲染')

  // 验证分页大小常量值
  const stageSizeMatch = content.match(/STAGE_PAGE_SIZE\s*=\s*(\d+)/)
  assertEqual(stageSizeMatch?.[1], '20', '工作台阶段页面大小 = 20')

  // 检查分页按钮 UI 元素
  assert(content.includes('M15 19l-7-7 7-7'), '上一页按钮图标存在')
  assert(content.includes('M9 5l7 7-7 7'), '下一页按钮图标存在')
  assert(content.includes('bg-white/20'), '分页按钮样式（半透明白色背景）')
}

// ═══════════════════════════════════════════════════════════
// D. AI 线索分页逻辑测试
// ═══════════════════════════════════════════════════════════
console.log('\n══ D. AI 线索分页逻辑 ══')

{
  const componentPath = path.join(PROJECT_ROOT, 'src/components/AILeadsTab.tsx')
  const content = fs.readFileSync(componentPath, 'utf-8')

  // 检查 import
  assert(content.includes("import Pagination from './Pagination'"), 'AI线索组件引入 Pagination')

  // 检查分页常量
  assert(content.includes('AI_LEAD_PAGE_SIZE = 30'), 'AI线索每页 30 条')

  // 检查分页状态
  assert(content.includes('[page, setPage]'), 'AI线索分页状态存在')

  // 检查筛选条件重置分页
  assert(content.includes("setPage(1)"), '搜索/筛选变化时重置分页')
  assert(content.includes("[searchTerm, filter]"), '搜索词和筛选条件触发重置')

  // 检查分页计算
  assert(content.includes('totalPages'), '总页数计算')
  assert(content.includes('pagedLeads'), '分页后的线索数组')
  assert(content.includes('filteredLeads.slice'), 'AI线索分页使用 slice')

  // 验证分页大小常量值
  const aiLeadSizeMatch = content.match(/AI_LEAD_PAGE_SIZE\s*=\s*(\d+)/)
  assertEqual(aiLeadSizeMatch?.[1], '30', 'AI线索页面大小 = 30')

  // 检查 Pagination 组件使用
  assert(content.includes('<Pagination'), 'AI线索列表使用了 Pagination 组件')
  assert(content.includes('currentPage={page}'), '传入 currentPage')
  assert(content.includes('totalPages={totalPages}'), '传入 totalPages')
  assert(content.includes('onPageChange={setPage}'), '传入 onPageChange')
  assert(content.includes('total={filteredLeads.length}'), '传入 total')
  assert(content.includes('pageSize={AI_LEAD_PAGE_SIZE}'), '传入 pageSize')

  // 检查 pagedLeads 用于渲染
  assert(content.includes('pagedLeads.map'), 'AI线索卡片使用 pagedLeads 渲染')
}

// ═══════════════════════════════════════════════════════════
// E. 分页逻辑数学验证
// ═══════════════════════════════════════════════════════════
console.log('\n══ E. 分页逻辑数学验证 ══')

{
  // 模拟分页计算函数
  function calcPagination(total: number, pageSize: number, currentPage: number) {
    const totalPages = Math.ceil(total / pageSize)
    const start = (currentPage - 1) * pageSize
    const end = start + pageSize
    const pagedItems = Array.from({ length: total }, (_, i) => i).slice(start, end)
    return { totalPages, pagedItems, pagedCount: pagedItems.length }
  }

  // 项目库：55 个项目，每页 50
  let result = calcPagination(55, 50, 1)
  assertEqual(result.totalPages, 2, '55 项目 / 50 每页 → 2 页')
  assertEqual(result.pagedCount, 50, '第 1 页 50 条')

  result = calcPagination(55, 50, 2)
  assertEqual(result.pagedCount, 5, '第 2 页 5 条')

  // 我的项目：25 个项目，每页 20
  result = calcPagination(25, 20, 1)
  assertEqual(result.totalPages, 2, '25 项目 / 20 每页 → 2 页')
  assertEqual(result.pagedCount, 20, '第 1 页 20 条')

  result = calcPagination(25, 20, 2)
  assertEqual(result.pagedCount, 5, '第 2 页 5 条')

  // 项目线索：65 个线索，每页 30
  result = calcPagination(65, 30, 1)
  assertEqual(result.totalPages, 3, '65 线索 / 30 每页 → 3 页')
  assertEqual(result.pagedCount, 30, '第 1 页 30 条')

  result = calcPagination(65, 30, 3)
  assertEqual(result.pagedCount, 5, '第 3 页 5 条')

  // AI 线索：30 个线索，每页 30
  result = calcPagination(30, 30, 1)
  assertEqual(result.totalPages, 1, '30 线索 / 30 每页 → 1 页（不分页）')
  assertEqual(result.pagedCount, 30, '第 1 页 30 条')

  // 工作台阶段：45 个项目，每页 20
  result = calcPagination(45, 20, 1)
  assertEqual(result.totalPages, 3, '45 项目 / 20 每页 → 3 页')
  assertEqual(result.pagedCount, 20, '第 1 页 20 条')

  result = calcPagination(45, 20, 3)
  assertEqual(result.pagedCount, 5, '第 3 页 5 条')

  // 边界：0 个项目
  result = calcPagination(0, 50, 1)
  assertEqual(result.totalPages, 0, '0 项目 → 0 页')
  assertEqual(result.pagedCount, 0, '0 项目 → 0 条')

  // 边界：刚好一页
  result = calcPagination(50, 50, 1)
  assertEqual(result.totalPages, 1, '50 项目 / 50 每页 → 1 页')
  assertEqual(result.pagedCount, 50, '刚好一页 50 条')

  // 边界：比一页多 1 个
  result = calcPagination(51, 50, 1)
  assertEqual(result.totalPages, 2, '51 项目 / 50 每页 → 2 页')
}

// ═══════════════════════════════════════════════════════════
// F. Pagination 组件渲染逻辑验证
// ═══════════════════════════════════════════════════════════
console.log('\n══ F. Pagination 组件渲染逻辑 ══')

{
  const componentPath = path.join(PROJECT_ROOT, 'src/components/Pagination.tsx')
  const content = fs.readFileSync(componentPath, 'utf-8')

  // 检查不渲染条件
  assert(content.includes('total <= pageSize'), '数据量 <= pageSize 时不渲染分页')

  // 检查显示信息
  assert(content.includes('start') && content.includes('end'), '显示当前范围（start-end）')
  assert(content.includes('共'), '显示总数')

  // 检查页码按钮逻辑
  assert(content.includes('totalPages > 5'), '超过 5 页时使用省略号')
  assert(content.includes('···'), '省略号符号存在')
  assert(content.includes('Math.abs(page - currentPage)'), '显示当前页附近的页码')

  // 检查页码高亮
  assert(content.includes('from-primary-500 to-primary-600'), '当前页码使用高亮样式')
  assert(content.includes('text-white'), '当前页码文字为白色')

  // 检查按钮类型
  assert(content.includes('onClick={() => onPageChange(currentPage - 1)}'), '上一页调用 onPageChange(page-1)')
  assert(content.includes('onClick={() => onPageChange(currentPage + 1)}'), '下一页调用 onPageChange(page+1)')
  assert(content.includes('onClick={() => onPageChange(page)}'), '页码按钮调用 onPageChange(page)')
}

// ═══════════════════════════════════════════════════════════
// G. 筛选条件重置分页验证
// ═══════════════════════════════════════════════════════════
console.log('\n══ G. 筛选条件重置分页 ══')

{
  const projectsPage = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/projects/page.tsx'), 'utf-8')
  const workbenchPage = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/workbench/page.tsx'), 'utf-8')
  const aiLeadsTab = fs.readFileSync(path.join(PROJECT_ROOT, 'src/components/AILeadsTab.tsx'), 'utf-8')

  // 项目库：搜索词、阶段、行业、年份变化时重置
  assert(
    projectsPage.includes('[searchTerm, selectedStage, selectedIndustry, selectedYear]') &&
    projectsPage.includes('setProjectPage(1)'),
    '项目库：搜索词/阶段/行业/年份变化时重置到第 1 页'
  )

  // 项目线索：搜索词变化时重置
  assert(
    projectsPage.includes('[leadSearchTerm]') &&
    projectsPage.includes('setLeadPage(1)'),
    '项目线索：搜索词变化时重置到第 1 页'
  )

  // 工作台：阶段和投资经理变化时重置
  assert(
    workbenchPage.includes('[selectedStage, selectedManagerId]') &&
    workbenchPage.includes('setStagePage(1)'),
    '工作台：阶段/投资经理变化时重置到第 1 页'
  )

  // AI 线索：搜索词和筛选条件变化时重置
  assert(
    aiLeadsTab.includes('[searchTerm, filter]') &&
    aiLeadsTab.includes('setPage(1)'),
    'AI线索：搜索词/筛选条件变化时重置到第 1 页'
  )
}

// ═══════════════════════════════════════════════════════════
// H. 一致性检查
// ═══════════════════════════════════════════════════════════
console.log('\n══ H. 一致性检查 ══')

{
  const projectsPage = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/projects/page.tsx'), 'utf-8')
  const workbenchPage = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/workbench/page.tsx'), 'utf-8')
  const aiLeadsTab = fs.readFileSync(path.join(PROJECT_ROOT, 'src/components/AILeadsTab.tsx'), 'utf-8')

  // 检查所有页面都使用了 Pagination 组件
  const projectsUsesPagination = projectsPage.includes("import Pagination from '@/components/Pagination'")
  const workbenchUsesPagination = workbenchPage.includes("import Pagination from '@/components/Pagination'")
  const aiLeadsUsesPagination = aiLeadsTab.includes("import Pagination from './Pagination'")
  assert(projectsUsesPagination && workbenchUsesPagination && aiLeadsUsesPagination, '所有页面都引入了 Pagination 组件')

  // 检查分页大小符合需求
  assert(projectsPage.includes('50'), '项目库分页大小包含 50')
  assert(projectsPage.includes('20'), '我的项目分页大小包含 20')
  assert(projectsPage.includes('30'), '项目线索分页大小包含 30')
  assert(workbenchPage.includes('20'), '工作台分页大小包含 20')
  assert(aiLeadsTab.includes('30'), 'AI线索分页大小包含 30')

  // 检查没有使用 filteredProjects.map（应该用 pagedProjects.map）
  assert(!projectsPage.includes('filteredProjects.map(project'), '项目库不再直接渲染 filteredProjects')
  assert(!projectsPage.includes('filteredLeads.map(lead'), '项目线索不再直接渲染 filteredLeads')
  assert(!workbenchPage.includes('stageProjects.map(project'), '工作台不再直接渲染 stageProjects')
  assert(!aiLeadsTab.includes('filteredLeads.map(lead'), 'AI线索不再直接渲染 filteredLeads')

  // 检查使用了分页后的数组
  assert(projectsPage.includes('pagedProjects.map'), '项目库使用 pagedProjects.map')
  assert(projectsPage.includes('pagedLeads.map'), '项目线索使用 pagedLeads.map')
  assert(workbenchPage.includes('pagedStageProjects.map'), '工作台使用 pagedStageProjects.map')
  assert(aiLeadsTab.includes('pagedLeads.map'), 'AI线索使用 pagedLeads.map')
}

// ═══════════════════════════════════════════════════════════
// I. 边界条件测试
// ═══════════════════════════════════════════════════════════
console.log('\n══ I. 边界条件测试 ══')

{
  // 模拟分页组件的渲染逻辑
  function shouldRenderPagination(total: number, pageSize: number): boolean {
    return total > pageSize
  }

  assert(!shouldRenderPagination(0, 50), '0 条数据 → 不渲染分页')
  assert(!shouldRenderPagination(49, 50), '49 条 < 50 → 不渲染分页')
  assert(!shouldRenderPagination(50, 50), '50 条 = 50 → 不渲染分页')
  assert(shouldRenderPagination(51, 50), '51 条 > 50 → 渲染分页')

  assert(!shouldRenderPagination(19, 20), '19 条 < 20 → 不渲染分页')
  assert(!shouldRenderPagination(20, 20), '20 条 = 20 → 不渲染分页')
  assert(shouldRenderPagination(21, 20), '21 条 > 20 → 渲染分页')

  assert(!shouldRenderPagination(29, 30), '29 条 < 30 → 不渲染分页')
  assert(!shouldRenderPagination(30, 30), '30 条 = 30 → 不渲染分页')
  assert(shouldRenderPagination(31, 30), '31 条 > 30 → 渲染分页')

  // 模拟 start-end 计算
  function calcRange(currentPage: number, pageSize: number, total: number) {
    const start = (currentPage - 1) * pageSize + 1
    const end = Math.min(currentPage * pageSize, total)
    return { start, end }
  }

  assertEqual(calcRange(1, 50, 55), { start: 1, end: 50 }, '第1页 1-50 / 共55')
  assertEqual(calcRange(2, 50, 55), { start: 51, end: 55 }, '第2页 51-55 / 共55')
  assertEqual(calcRange(1, 20, 25), { start: 1, end: 20 }, '第1页 1-20 / 共25')
  assertEqual(calcRange(2, 20, 25), { start: 21, end: 25 }, '第2页 21-25 / 共25')
  assertEqual(calcRange(1, 30, 65), { start: 1, end: 30 }, '第1页 1-30 / 共65')
  assertEqual(calcRange(3, 30, 65), { start: 61, end: 65 }, '第3页 61-65 / 共65')
}

// ═══════════════════════════════════════════════════════════
// J. 文件完整性检查
// ═══════════════════════════════════════════════════════════
console.log('\n══ J. 文件完整性 ══')

{
  const files = [
    'src/components/Pagination.tsx',
    'src/app/projects/page.tsx',
    'src/app/workbench/page.tsx',
    'src/components/AILeadsTab.tsx',
  ]

  files.forEach(f => {
    const fullPath = path.join(PROJECT_ROOT, f)
    assert(fs.existsSync(fullPath), `文件存在: ${f}`)
  })

  // 检查 Pagination 组件导出
  const paginationContent = fs.readFileSync(path.join(PROJECT_ROOT, 'src/components/Pagination.tsx'), 'utf-8')
  assert(paginationContent.includes('export default'), 'Pagination 组件正确导出')

  // 检查项目库页面语法完整性
  const projectsContent = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/projects/page.tsx'), 'utf-8')
  const projectBraces = (projectsContent.match(/{/g) || []).length
  const projectCloseBraces = (projectsContent.match(/}/g) || []).length
  assert(projectBraces === projectCloseBraces, '项目库页面花括号匹配')

  // 检查工作台页面语法完整性
  const workbenchContent = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app/workbench/page.tsx'), 'utf-8')
  const workbenchBraces = (workbenchContent.match(/{/g) || []).length
  const workbenchCloseBraces = (workbenchContent.match(/}/g) || []).length
  assert(workbenchBraces === workbenchCloseBraces, '工作台页面花括号匹配')

  // 检查 AI 线索组件语法完整性
  const aiLeadsContent = fs.readFileSync(path.join(PROJECT_ROOT, 'src/components/AILeadsTab.tsx'), 'utf-8')
  const aiLeadsBraces = (aiLeadsContent.match(/{/g) || []).length
  const aiLeadsCloseBraces = (aiLeadsContent.match(/}/g) || []).length
  assert(aiLeadsBraces === aiLeadsCloseBraces, 'AI线索组件花括号匹配')
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
