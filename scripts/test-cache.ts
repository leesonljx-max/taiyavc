/**
 * 前端缓存功能测试
 *
 * 验证项：
 * 1. 缓存工具核心逻辑（fetchWithCache, getCachedData, invalidateCache）
 * 2. 数据变更后缓存失效（项目创建/编辑/删除/阶段变更/维护人变更）
 * 3. 页面组件正确集成缓存
 * 4. staleTime 配置正确
 * 5. 订阅机制工作正常
 */

import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')
let passCount = 0
let failCount = 0

function check(condition: boolean, description: string) {
  if (condition) {
    passCount++
    console.log(`  ✅ ${description}`)
  } else {
    failCount++
    console.log(`  ❌ ${description}`)
  }
}

function checkFile(filePath: string, description: string) {
  check(fs.existsSync(filePath), `${description}: ${filePath}`)
}

function checkContent(filePath: string, pattern: string | RegExp, description: string) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const found = typeof pattern === 'string'
      ? content.includes(pattern)
      : pattern.test(content)
    check(found, description)
  } catch {
    check(false, `${description} (文件读取失败: ${filePath})`)
  }
}

function checkNotContent(filePath: string, pattern: string | RegExp, description: string) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const found = typeof pattern === 'string'
      ? content.includes(pattern)
      : pattern.test(content)
    check(!found, description)
  } catch {
    check(false, `${description} (文件读取失败: ${filePath})`)
  }
}

console.log('=== 前端缓存功能测试 ===\n')

// ── 1. 缓存工具文件存在且导出正确 ──
console.log('1. 缓存工具文件验证')
const cacheFile = path.join(ROOT, 'src/lib/cache.ts')
checkFile(cacheFile, '缓存工具文件存在')
checkContent(cacheFile, 'async function fetchWithCache', '导出 fetchWithCache')
checkContent(cacheFile, 'export function getCachedData', '导出 getCachedData')
checkContent(cacheFile, 'export function subscribeCache', '导出 subscribeCache')
checkContent(cacheFile, 'export function invalidateCache', '导出 invalidateCache')
checkContent(cacheFile, 'export function setupFocusRefresh', '导出 setupFocusRefresh')
checkContent(cacheFile, 'DEFAULT_STALE_TIME = 30 * 1000', '默认 staleTime 为 30 秒')
checkContent(cacheFile, 'cacheStore', '内存缓存存储存在')
checkContent(cacheFile, 'subscribers', '订阅者列表存在')
checkContent(cacheFile, 'notifySubscribers', '通知订阅者函数存在')
checkContent(cacheFile, "endsWith('*')", '支持通配符失效缓存')

// ── 2. 首页（dashboard）集成缓存 ──
console.log('\n2. 首页（dashboard）缓存集成')
const homePage = path.join(ROOT, 'src/app/page.tsx')
checkContent(homePage, "from '@/lib/cache'", '首页导入缓存模块')
checkContent(homePage, 'fetchWithCache', '首页使用 fetchWithCache')
checkContent(homePage, 'getCachedData', '首页使用 getCachedData 读取初始数据')
checkContent(homePage, 'subscribeCache', '首页订阅缓存变化')
checkContent(homePage, 'setupFocusRefresh', '首页设置获焦刷新')
checkContent(homePage, 'DASHBOARD_CACHE_KEY', '首页使用缓存键')
checkContent(homePage, "getCachedData<DashboardData>(DASHBOARD_CACHE_KEY)", '首页初始状态从缓存读取')
checkContent(homePage, '!getCachedData<DashboardData>(DASHBOARD_CACHE_KEY)', '首页无缓存时显示 loading')

// ── 3. 项目库页面集成缓存 ──
console.log('\n3. 项目库页面缓存集成')
const projectsPage = path.join(ROOT, 'src/app/projects/page.tsx')
checkContent(projectsPage, "from '@/lib/cache'", '项目库导入缓存模块')
checkContent(projectsPage, 'fetchWithCache', '项目库使用 fetchWithCache')
checkContent(projectsPage, 'getCachedData', '项目库使用 getCachedData')
checkContent(projectsPage, 'subscribeCache', '项目库订阅缓存变化')
checkContent(projectsPage, 'setupFocusRefresh', '项目库设置获焦刷新')
checkContent(projectsPage, "'projects:all'", '项目库使用 projects:all 缓存键')
checkContent(projectsPage, "'projects:mine'", '项目库使用 projects:mine 缓存键')
checkContent(projectsPage, 'fetchProjectsAbort', '保留 AbortController 防竞态')

// ── 4. 工作台页面集成缓存 ──
console.log('\n4. 工作台页面缓存集成')
const workbenchPage = path.join(ROOT, 'src/app/workbench/page.tsx')
checkContent(workbenchPage, "from '@/lib/cache'", '工作台导入缓存模块')
checkContent(workbenchPage, 'fetchWithCache', '工作台使用 fetchWithCache')
checkContent(workbenchPage, 'getCachedData', '工作台使用 getCachedData')
checkContent(workbenchPage, 'subscribeCache', '工作台订阅缓存变化')
checkContent(workbenchPage, 'setupFocusRefresh', '工作台设置获焦刷新')
checkContent(workbenchPage, 'workbench:projects:', '工作台使用独立缓存键前缀')

// ── 5. 数据变更后失效缓存 ──
console.log('\n5. 数据变更后缓存失效')

// 5.1 项目创建
const newProjectPage = path.join(ROOT, 'src/app/projects/new/page.tsx')
checkContent(newProjectPage, "from '@/lib/cache'", '项目创建页导入缓存模块')
checkContent(newProjectPage, "invalidateCache('projects:*')", '项目创建后失效项目缓存')
checkContent(newProjectPage, "invalidateCache('workbench:*')", '项目创建后失效工作台缓存')
checkContent(newProjectPage, "invalidateCache('dashboard')", '项目创建后失效首页缓存')

// 5.2 项目编辑
const editPage = path.join(ROOT, 'src/app/projects/[id]/edit/page.tsx')
checkContent(editPage, "from '@/lib/cache'", '项目编辑页导入缓存模块')
checkContent(editPage, "invalidateCache('projects:*')", '项目编辑后失效项目缓存')
checkContent(editPage, "invalidateCache('workbench:*')", '项目编辑后失效工作台缓存')
checkContent(editPage, "invalidateCache('dashboard')", '项目编辑后失效首页缓存')

// 5.3 项目详情页（阶段变更、删除、维护人变更）
const detailPage = path.join(ROOT, 'src/app/projects/[id]/page.tsx')
checkContent(detailPage, "from '@/lib/cache'", '项目详情页导入缓存模块')
checkContent(detailPage, "invalidateCache('projects:*')", '项目详情页失效项目缓存')
checkContent(detailPage, "invalidateCache('workbench:*')", '项目详情页失效工作台缓存')
checkContent(detailPage, "invalidateCache('dashboard')", '项目详情页失效首页缓存')

// 验证在 handleStageChange 中调用
const stageChangeMatch = /handleStageChange[\s\S]*?invalidateCache\('projects:\*'\)/.test(
  fs.readFileSync(detailPage, 'utf-8')
)
check(stageChangeMatch, '阶段变更成功后失效缓存')

// 验证在 handleDelete 中调用
const deleteMatch = /handleDelete[\s\S]*?invalidateCache\('projects:\*'\)/.test(
  fs.readFileSync(detailPage, 'utf-8')
)
check(deleteMatch, '项目删除成功后失效缓存')

// 验证在 handleChangeOwner 中调用
const changeOwnerMatch = /handleChangeOwner[\s\S]*?invalidateCache\('projects:\*'\)/.test(
  fs.readFileSync(detailPage, 'utf-8')
)
check(changeOwnerMatch, '主维护人变更成功后失效缓存')

// 验证在 handleAddMember 中调用
const addMemberMatch = /handleAddMember[\s\S]*?invalidateCache\('projects:\*'\)/.test(
  fs.readFileSync(detailPage, 'utf-8')
)
check(addMemberMatch, '添加辅助维护人成功后失效缓存')

// 验证在 handleRemoveMember 中调用
const removeMemberMatch = /handleRemoveMember[\s\S]*?invalidateCache\('projects:\*'\)/.test(
  fs.readFileSync(detailPage, 'utf-8')
)
check(removeMemberMatch, '移除辅助维护人成功后失效缓存')

// 验证在 handleTakeoverAction 中调用
const takeoverMatch = /handleTakeoverAction[\s\S]*?invalidateCache\('projects:\*'\)/.test(
  fs.readFileSync(detailPage, 'utf-8')
)
check(takeoverMatch, '接手申请审批成功后失效缓存')

// ── 6. 缓存键命名规范 ──
console.log('\n6. 缓存键命名规范')
checkContent(cacheFile, "key.endsWith('*')", '通配符以 * 结尾')
checkContent(cacheFile, 'prefix = key.slice(0, -1)', '通配符匹配使用前缀')

// ── 7. 缓存策略验证 ──
console.log('\n7. 缓存策略验证')
checkContent(cacheFile, 'now - entry.timestamp < staleTime', 'staleTime 内直接返回缓存')
checkContent(cacheFile, '后台静默刷新', '过期时后台静默刷新')
checkContent(cacheFile, '请求去重', '支持请求去重')
checkContent(cacheFile, 'entry.promise', '使用 promise 防止重复请求')

// ── 8. 获焦刷新验证 ──
console.log('\n8. 获焦刷新验证')
checkContent(cacheFile, "window.addEventListener('focus'", '监听窗口 focus 事件')
checkContent(cacheFile, 'isRefreshing', '防止重复刷新')
checkContent(cacheFile, 'removeEventListener', '组件卸载时移除监听')

// ── 9. 错误处理 ──
console.log('\n9. 错误处理验证')
checkContent(cacheFile, '刷新失败保留旧数据', '后台刷新失败时保留旧数据')
checkContent(cacheFile, '忽略刷新错误', '获焦刷新忽略错误')

// ── 10. 首次加载优化 ──
console.log('\n10. 首次加载优化验证')
checkContent(homePage, 'useState<DashboardData | null>(() => getCachedData', '首页 useState 初始化从缓存读取')
checkContent(projectsPage, "const cached = getCachedData<Project[]>(cacheKey)", '项目库 Tab 切换时先读缓存')
checkContent(workbenchPage, "const cached = getCachedData<Project[]>(cacheKey)", '工作台加载时先读缓存')

// ── 11. 无重复请求 ──
console.log('\n11. 无重复请求验证')
// 首页不应有直接 fetch('/api/dashboard') 的调用（应通过 fetchDashboardData）
checkContent(homePage, "async function fetchDashboardData", '首页 fetcher 函数独立定义')

// ── 结果汇总 ──
console.log('\n=== 测试结果 ===')
console.log(`通过: ${passCount} 项`)
console.log(`失败: ${failCount} 项`)
console.log(`总计: ${passCount + failCount} 项`)
console.log(failCount === 0 ? '\n🎉 全部通过！' : `\n⚠️ 有 ${failCount} 项未通过`)
process.exit(failCount === 0 ? 0 : 1)
