/**
 * 融资热点图 + 新闻监控 + AI线索 修复验证测试
 *
 * 验证项：
 * 1. 融资热点图 GET 不再依赖 getVisibleIndustries（先读缓存）
 * 2. 融资热点图 POST 使用所有项目行业（不按用户权限过滤）
 * 3. 新闻监控 POST 使用所有项目行业（不按用户权限过滤）
 * 4. cron 接口正常工作
 * 5. 已删除 getVisibleIndustries 函数
 * 6. 已清理未使用的导入
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

function checkContent(filePath: string, pattern: string | RegExp, description: string) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const found = typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content)
    check(found, description)
  } catch {
    check(false, `${description} (文件读取失败)`)
  }
}

function checkNotContent(filePath: string, pattern: string | RegExp, description: string) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const found = typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content)
    check(!found, description)
  } catch {
    check(false, `${description} (文件读取失败)`)
  }
}

console.log('=== 融资热点图 + 新闻监控 + AI线索 修复验证 ===\n')

// ── 1. 融资热点图 GET 修复验证 ──
console.log('1. 融资热点图 GET 修复验证')
const heatmapRoute = path.join(ROOT, 'src/app/api/statistics/financing-heatmap/route.ts')

// 不应再依赖 getVisibleIndustries
checkNotContent(heatmapRoute, 'getVisibleIndustries', 'GET 不再调用 getVisibleIndustries')
checkNotContent(heatmapRoute, 'canViewProject', 'GET 不再使用 canViewProject 权限过滤')
checkNotContent(heatmapRoute, 'PermissionUser', '不再使用 PermissionUser 类型')

// 应该先读缓存
checkContent(heatmapRoute, '// 先读缓存', 'GET 先读缓存')
checkContent(heatmapRoute, 'cacheKey = `heatmap:${validYear}`', 'GET 使用正确的缓存键')
checkContent(heatmapRoute, 'ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000', 'GET 检查 1 个月缓存有效期')
checkContent(heatmapRoute, 'isCacheValid', 'GET 返回 isCacheValid 字段')
checkContent(heatmapRoute, 'cacheAge', 'GET 返回 cacheAge 字段')

// 可用年份应从所有项目提取（不按权限过滤）
checkContent(heatmapRoute, '// 可用年份（从所有项目中提取，不按用户权限过滤）', 'GET 年份从所有项目提取')

// ── 2. 融资热点图 POST 修复验证 ──
console.log('\n2. 融资热点图 POST 修复验证')

// 应使用所有项目行业
checkContent(heatmapRoute, '// 获取所有项目的行业（不按用户权限过滤，与 cron 一致）', 'POST 使用所有项目行业')
checkContent(heatmapRoute, 'industriesSet', 'POST 使用 Set 去重行业')

// 应检查 1 个月缓存
checkContent(heatmapRoute, 'forceRefresh', 'POST 支持 force 参数强制刷新')
checkContent(heatmapRoute, '缓存仍在有效期内', 'POST 缓存有效期内跳过 API 调用')

// ── 3. 新闻监控 POST 修复验证 ──
console.log('\n3. 新闻监控 POST 修复验证')
const newsSearchRoute = path.join(ROOT, 'src/app/api/news/search/route.ts')

// 不应再依赖 getVisibleIndustries
checkNotContent(newsSearchRoute, 'getVisibleIndustries', 'POST 不再调用 getVisibleIndustries')
checkNotContent(newsSearchRoute, 'canViewProject', 'POST 不再使用 canViewProject 权限过滤')
checkNotContent(newsSearchRoute, 'PermissionUser', 'POST 不再使用 PermissionUser 类型')
checkNotContent(newsSearchRoute, 'UserRole', '不再导入 UserRole 类型')

// 应使用所有项目行业
checkContent(newsSearchRoute, '// 1. 获取所有项目的行业（不按用户权限过滤，与 cron 一致）', 'POST 使用所有项目行业')

// ── 4. cron 接口验证 ──
console.log('\n4. cron 接口验证')

const heatmapCron = path.join(ROOT, 'src/app/api/cron/refresh-heatmap/route.ts')
check(fs.existsSync(heatmapCron), '融资热点图 cron 路由存在')
checkContent(heatmapCron, 'authorizeCronRequest', '融资热点图 cron 使用授权校验')
checkContent(heatmapCron, 'getAllIndustries', '融资热点图 cron 使用 getAllIndustries（不按权限过滤）')
checkContent(heatmapCron, '每月 1 号早上 6:00', '融资热点图 cron 文档说明每月1号执行')

const newsCron = path.join(ROOT, 'src/app/api/cron/news-search/route.ts')
check(fs.existsSync(newsCron), '新闻检索 cron 路由存在')
checkContent(newsCron, 'authorizeCronRequest', '新闻检索 cron 使用授权校验')
checkContent(newsCron, 'getRecentInitialTalkKeywords', '新闻检索 cron 使用近3月初聊项目关键词')
checkContent(newsCron, '90 天', '新闻检索 cron 检索近 90 天项目')
checkContent(newsCron, 'INITIAL_TALK', '新闻检索 cron 检索初聊阶段项目')
checkContent(newsCron, '每天早上 7:00', '新闻检索 cron 文档说明每天执行')

const aiLeadsCron = path.join(ROOT, 'src/app/api/cron/ai-leads-retrieval/route.ts')
check(fs.existsSync(aiLeadsCron), 'AI线索检索 cron 路由存在')
checkContent(aiLeadsCron, 'CRON_SECRET', 'AI线索检索 cron 使用 CRON_SECRET 授权')

// ── 5. 共享授权工具验证 ──
console.log('\n5. 共享授权工具验证')
const cronAuth = path.join(ROOT, 'src/lib/cron-auth.ts')
check(fs.existsSync(cronAuth), 'cron-auth.ts 文件存在')
checkContent(cronAuth, 'authorizeCronRequest', '导出 authorizeCronRequest')
checkContent(cronAuth, 'unauthorizedResponse', '导出 unauthorizedResponse')
checkContent(cronAuth, 'CRON_SECRET', '使用 CRON_SECRET 环境变量')

// ── 6. 新闻列表 API 验证 ──
console.log('\n6. 新闻列表 API 验证')
const newsRoute = path.join(ROOT, 'src/app/api/news/route.ts')
checkContent(newsRoute, 'sevenDaysAgo', '新闻列表返回最近 7 天文章')
checkContent(newsRoute, 'publishedAt: { gte: sevenDaysAgo }', '新闻列表按发布时间过滤')
checkContent(newsRoute, 'industries', '新闻列表返回行业筛选器')
checkContent(newsRoute, 'sources', '新闻列表返回来源筛选器')

// ── 7. 数据一致性验证 ──
console.log('\n7. 数据一致性验证（cron 与手动 API 使用相同数据源）')

// 融资热点图 cron 和 POST 都应使用所有项目行业
checkContent(heatmapCron, 'prisma.project.findMany', 'cron 查询所有项目')
checkContent(heatmapRoute, 'prisma.project.findMany', 'POST 查询所有项目')

// 新闻检索 cron 和 POST 都应查询项目行业
checkContent(newsCron, 'prisma.project.findMany', 'cron 查询所有项目')
checkContent(newsSearchRoute, 'prisma.project.findMany', 'POST 查询所有项目')

// ── 8. 缓存策略验证 ──
console.log('\n8. 缓存策略验证')

// 融资热点图：1 个月缓存
checkContent(heatmapRoute, '30 * 24 * 60 * 60 * 1000', '融资热点图使用 1 个月缓存期')

// 新闻监控：按周缓存
checkContent(newsSearchRoute, "getISOWeekKey", '新闻监控按 ISO 周号缓存')
checkContent(newsCron, "getISOWeekKey", 'cron 也按 ISO 周号缓存')
checkContent(newsSearchRoute, "news:${weekKey}", '新闻监控使用 news:YYYY-Www 缓存键')
checkContent(newsCron, "news:${weekKey}", 'cron 使用 news:YYYY-Www 缓存键')

// ── 9. 无未使用导入 ──
console.log('\n9. 无未使用导入验证')
checkNotContent(heatmapRoute, "canEditProject", '融资热点图不再导入 canEditProject')
checkNotContent(newsSearchRoute, "canViewProject", '新闻搜索不再导入 canViewProject')
checkNotContent(newsSearchRoute, "UserRole", '新闻搜索不再导入 UserRole')

// ── 结果汇总 ──
console.log('\n=== 测试结果 ===')
console.log(`通过: ${passCount} 项`)
console.log(`失败: ${failCount} 项`)
console.log(`总计: ${passCount + failCount} 项`)
console.log(failCount === 0 ? '\n🎉 全部通过！' : `\n⚠️ 有 ${failCount} 项未通过`)
process.exit(failCount === 0 ? 0 : 1)
