/**
 * 可视化报告（投研分析 view 页）测试用例
 *
 * 验证内容：
 * 1. Prisma Schema：ResearchComment 含 quoteText/quoteField 字段
 * 2. Migration SQL 存在且包含新增列
 * 3. comments API 路由：POST 支持 quoteText/quoteField，GET 返回锚点
 * 4. questions 聚合 API 路由存在
 * 5. 前端组件：ReportView（高亮渲染）、QuestionPanel（问答面板）
 * 6. view 页面存在（串珠导航 + 框选提问逻辑）
 * 7. 入口按钮：详情页 + 列表页
 *
 * 运行：npx tsx scripts/test-research-view.ts
 */

import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.join(__dirname, '..')
let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function read(p: string): string {
  try {
    return fs.readFileSync(path.join(ROOT, p), 'utf8')
  } catch {
    return ''
  }
}

function exists(p: string): boolean {
  return fs.existsSync(path.join(ROOT, p))
}

console.log('\n════════ 可视化报告（Research View）测试 ════════\n')

// ── 1. Prisma Schema ──
console.log('[1] Prisma Schema')
const schema = read('prisma/schema.prisma')
check('ResearchComment 模型含 quoteText 字段', /quoteText\s+String\?/.test(schema) && schema.includes('quoteText'))
check('ResearchComment 模型含 quoteField 字段', schema.includes('quoteField'))

// ── 2. Migration ──
console.log('\n[2] Migration')
const migrationDir = 'prisma/migrations/20260820000001_add_research_comment_quote'
const migrationSql = read(`${migrationDir}/migration.sql`)
check('migration 文件存在', exists(`${migrationDir}/migration.sql`))
check('migration 包含 quoteText 列', migrationSql.includes('"quoteText"'))
check('migration 包含 quoteField 列', migrationSql.includes('"quoteField"'))

// ── 3. comments API ──
console.log('\n[3] comments API（锚点支持）')
const commentsRoute = read('src/app/api/research/[projectId]/[moduleType]/comments/route.ts')
check('POST 解析 quoteText（截断500）', commentsRoute.includes('body.quoteText') && commentsRoute.includes('substring(0, 500)'))
check('POST 解析 quoteField（截断200）', commentsRoute.includes('body.quoteField') && commentsRoute.includes('substring(0, 200)'))
check('create data 写入 quoteText/quoteField', /quoteText,\s*\n\s*quoteField,/.test(commentsRoute))
check('GET 树形结构返回 quoteText/quoteField', commentsRoute.includes('quoteText: c.quoteText') && commentsRoute.includes('quoteField: c.quoteField'))

// ── 4. questions 聚合 API ──
console.log('\n[4] questions 聚合 API')
const questionsRoute = read('src/app/api/research/[projectId]/questions/route.ts')
check('路由文件存在', exists('src/app/api/research/[projectId]/questions/route.ts'))
check('权限校验 canViewResearchProject', questionsRoute.includes('canViewResearchProject'))
check('返回 moduleType 映射', questionsRoute.includes('moduleTypeById'))
check('返回 replies 树形', questionsRoute.includes('repliesByParent'))

// ── 5. 前端组件 ──
console.log('\n[5] 前端组件')
const reportView = read('src/components/research/ReportView.tsx')
check('ReportView 组件存在', exists('src/components/research/ReportView.tsx'))
check('核心数据高亮正则（金额/百分比/单位）', reportView.includes('CORE_DATA_REGEX') && reportView.includes('亿'))
check('mark 高亮样式（加粗+提亮）', reportView.includes('font-bold') && reportView.includes('from-amber-100'))
check('字段 data-field 锚点', reportView.includes('data-field={fieldKey}'))
check('字段提问标志 QuestionMarker', reportView.includes('QuestionMarker'))
check('结论性字段高亮卡片', reportView.includes('isConclusionKey'))
check('嵌套对象/数组递归渲染', reportView.includes('ValueRenderer'))

const questionPanel = read('src/components/research/QuestionPanel.tsx')
check('QuestionPanel 组件存在', exists('src/components/research/QuestionPanel.tsx'))
check('待回答/已回答筛选', questionPanel.includes("'open'") && questionPanel.includes("'answered'"))
check('框选原文引用展示', questionPanel.includes('quoteText'))
check('维护人回答（onReply）', questionPanel.includes('onReply') && questionPanel.includes('handleSubmitReply'))
check('按模块分组展示', questionPanel.includes('groupMap'))

// ── 6. view 页面 ──
console.log('\n[6] view 主页面')
const viewPage = read('src/app/research/[projectId]/view/page.tsx')
check('页面存在', exists('src/app/research/[projectId]/view/page.tsx'))
check('串珠导航（scroll-spy IntersectionObserver）', viewPage.includes('IntersectionObserver') && viewPage.includes('BeadNavItem'))
check('框选提问（getSelection + data-field 定位）', viewPage.includes('window.getSelection') && viewPage.includes('dataset.field'))
check('提问权限：仅 ADMIN/INVESTMENT_PARTNER 可框选', viewPage.includes("canAsk = userRole === 'ADMIN' || userRole === 'INVESTMENT_PARTNER'"))
check('回答权限：维护人/辅助维护人', viewPage.includes('createdById === currentUserId') && viewPage.includes('isMaintainer === true'))
check('members 空值防护（API 不返回成员列表）', !viewPage.includes('project.members.map'))
check('quoteField 格式：moduleType.fieldKey', viewPage.includes('`${askModal.moduleType}.${askModal.fieldKey}`'))
check('Hero 核心数据大卡片', viewPage.includes('HeroStat') && viewPage.includes('融资金额'))
check('字段提问标志 → 面板联动高亮', viewPage.includes('handleMarkerClick') && viewPage.includes('highlightQuestionId'))
check('提问提交带 quoteText/quoteField', viewPage.includes('quoteText: askModal.text'))
check('Hero 区提问挂载到 COMPANY 模块', viewPage.includes("moduleType === 'PROJECT'"))
check('移动端问答面板降级（details 折叠）', viewPage.includes('xl:hidden'))

// ── 7. 入口 ──
console.log('\n[7] 入口按钮')
const detailPage = read('src/app/research/[projectId]/page.tsx')
check('详情页含"可视化报告"入口', detailPage.includes('/view') && detailPage.includes('可视化报告'))
const listPage = read('src/app/research/page.tsx')
check('列表页含"可视化报告"入口', listPage.includes('/view') && listPage.includes('可视化报告'))
check('列表页入口 stopPropagation（不触发卡片跳转）', listPage.includes('e.stopPropagation()'))

// ── 结果 ──
console.log('\n════════ 测试结果 ════════')
console.log(`  通过: ${passed}  失败: ${failed}`)
console.log(failed === 0 ? '  ✅ 全部通过\n' : '  ❌ 存在失败用例\n')
process.exit(failed === 0 ? 0 : 1)
