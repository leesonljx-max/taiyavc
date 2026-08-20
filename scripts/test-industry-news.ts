/**
 * 行业动态（统计分析页）测试用例
 *
 * A. 纯函数单测（直接 import）：
 *    1. todayKey：本地时区日期键
 *    2. 事件规范化 normalizeEvents（经 runner 内部逻辑验证：上限5件/必填校验/日期兜底）
 *       —— runner 未导出，通过静态检查覆盖；此处验证导出的 TOP_N
 *
 * B. 静态检查：
 *    3. Harness Runner：前十行业、并发池、缓存键、引用过滤、防重入、cron入口
 *    4. API：GET 读缓存 / POST 即时分析（industries/force）
 *    5. Cron 路由：04:00 计划、token 鉴权
 *    6. 前端：默认前十卡片、点击气泡出按钮、即时分析、事件类型徽章、引用溯源
 *    7. 融资热点图已移除（右侧替换为行业动态）
 *
 * 运行：npx tsx scripts/test-industry-news.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { TOP_N, todayKey } from '../src/lib/industry-news-runner'

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

console.log('\n════════ 行业动态（统计分析）测试 ════════\n')

// ── A. 纯函数单测 ──

console.log('[A1] todayKey：日期键')
{
  const key = todayKey(new Date(2026, 7, 20, 10, 30)) // 2026-08-20 本地时区
  check('格式 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(key))
  check('本地日期正确', key === '2026-08-20')
  check('默认参数可用', /^\d{4}-\d{2}-\d{2}$/.test(todayKey()))
  // 月/日补零
  check('月日补零', todayKey(new Date(2026, 0, 5)) === '2026-01-05')
}

console.log('\n[A2] TOP_N 常量')
{
  check('前十行业 TOP_N = 10', TOP_N === 10)
}

// ── B. 静态检查 ──

console.log('\n[B3] Harness Runner（industry-news-runner.ts）')
const runner = read('src/lib/industry-news-runner.ts')
check('Runner 文件存在', exists('src/lib/industry-news-runner.ts'))
check('复用 dd-harness Agent（runAgent）', runner.includes("from '@/lib/dd-harness/agent'") && runner.includes('runAgent'))
check('复用 web_search 工具（ddTools）', runner.includes("from '@/lib/dd-harness/tools'") && runner.includes('ddTools()'))
check('前十行业计算（getTopIndustries 按项目数排序）', runner.includes('sort((a, b) => b[1] - a[1])') && runner.includes('TOP_N'))
check('缓存键 industry-news:YYYY-MM-DD', runner.includes('`industry-news:${date}`'))
check('AICache upsert 读写', runner.includes('aICache.upsert') && runner.includes('aICache.findUnique'))
check('子Agent 并发池（CONCURRENCY）', runner.includes('CONCURRENCY = 2') && runner.includes('Promise.all(workers)'))
check('防重入（runningIndustries）', runner.includes('runningIndustries') && runner.includes('runningIndustries.add'))
check('引用过滤（仅保留真实搜索 URL）', runner.includes('urlSet.has(url)') && runner.includes('sessionLog.searchedUrls()'))
check('事件上限 5 件', runner.includes('if (out.length >= 5) break'))
check('事件必填校验（title+company）', runner.includes("if (!title || !company) continue"))
check('事件类型覆盖（融资/产品发布/技术突破/人员变更）', ['融资', '产品发布', '技术突破', '人员变更'].every(t => runner.includes(t)))
check('分析失败降级（note=分析失败）', runner.includes('分析失败，请稍后重试'))
check('缓存合并（mergeCards 保留已分析行业）', runner.includes('mergeCards'))
check('cron 入口 runDailyIndustryNews', runner.includes('export async function runDailyIndustryNews'))
check('系统提示要求 3-5 件事', runner.includes('3-5 件事'))
check('空事件说明 note', runner.includes('今日暂未检索到重要动态'))
check('note 上限 200 且按句截断', runner.includes('rawNote.length <= 200'))

console.log('\n[B4] API 路由')
const api = read('src/app/api/statistics/industry-news/route.ts')
check('GET/POST 路由存在', exists('src/app/api/statistics/industry-news/route.ts'))
check('GET 返回当日缓存 + 前十行业', api.includes('getIndustryNews') && api.includes('topIndustries'))
check('POST 支持 industries 指定行业', api.includes('body.industries'))
check('POST 支持 force 强制重跑', api.includes('body.force === true'))
check('POST industries 数量限制（≤5）', api.includes('slice(0, 5)'))
check('登录校验', api.includes('getServerSession'))
check('POST 同步等待结果（即时分析）', !api.includes('void runIndustryNews'))

console.log('\n[B5] Cron 路由')
const cron = read('src/app/api/cron/industry-news/route.ts')
check('cron 路由存在', exists('src/app/api/cron/industry-news/route.ts'))
check('token 鉴权（authorizeCronRequest）', cron.includes('authorizeCronRequest') && cron.includes('unauthorizedResponse'))
check('GET/POST 均支持', cron.includes('export async function GET') && cron.includes('export async function POST'))
check('调用每日收集入口', cron.includes('runDailyIndustryNews'))
check('注释含 04:00 定时计划', cron.includes('04:00'))

console.log('\n[B6] 前端 statistics 页')
const page = read('src/app/statistics/page.tsx')
check('行业动态卡片组件（IndustryNewsCardView）', page.includes('IndustryNewsCardView'))
check('默认显示前十行业动态（topIndustries 排序）', page.includes('topIndustries') && page.includes('visibleCards'))
check('点击气泡显示「行业动态分析」按钮', page.includes('行业动态分析'))
check('即时分析（POST industries + force）', page.includes('handleAnalyzeIndustry') && page.includes('[industry], true'))
check('分析中状态（analyzingIndustry）', page.includes('analyzingIndustry') && page.includes('动态收集中'))
check('事件类型徽章配色（EVENT_TYPE_STYLES）', page.includes('EVENT_TYPE_STYLES'))
check('事件列表渲染（title/company/detail）', page.includes('e.title') && page.includes('e.company') && page.includes('e.detail'))
check('引用来源可点击溯源（target=_blank）', page.includes('target="_blank"'))
check('无事件卡片自动强制重跑（autoTriggeredRef 仅一次）', page.includes('autoTriggeredRef') && page.includes('analyzeNews(undefined, true)'))
check('POST body 始终携带 force 字段', page.includes('JSON.stringify({ industries, force })'))
check('前十行业气泡角标（idx < 10）', page.includes('idx < 10'))
check('事件数徽章（今日 N 件事）', page.includes('今日 {card.events.length} 件事'))
check('每 4:00 提示文案', page.includes('04:00'))

console.log('\n[B7] 融资热点图移除确认')
check('页面标题已改为「行业图谱与行业动态分析」', page.includes('行业图谱与行业动态分析'))
check('融资热点图区块已移除', !page.includes('融资热点图'))
check('heatmap 相关状态已清理', !page.includes('heatmapData') && !page.includes('refreshHeatmap'))
check('热度等级配色已清理', !page.includes("heatColors"))
check(' financing-heatmap API 保留（数据未删，仅前端替换）', exists('src/app/api/statistics/financing-heatmap/route.ts'))

// ── 结果 ──
console.log('\n════════ 测试结果 ════════')
console.log(`  通过: ${passed}  失败: ${failed}`)
console.log(failed === 0 ? '  ✅ 全部通过\n' : '  ❌ 存在失败用例\n')
process.exit(failed === 0 ? 0 : 1)
