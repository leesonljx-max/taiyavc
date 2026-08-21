/**
 * AI行研 ChatBot（Harness + 分层记忆）测试用例
 *
 * A. 纯函数单测（无网络）：
 *    1. extractQueryKeywords：中文滑窗分词 + 停用词过滤 + 英文词
 *    2. formatMemoriesForPrompt：FACT/EPISODE 分组格式化
 *    3. formatProjectHits：项目命中格式化（含尽调结论）
 *    4. 三原则 prompt 契约：时间窗口/领军判断/数据高亮/模板
 *
 * B. 数据库集成测试（本地 Postgres，需先 db push）：
 *    5. saveMemory：FACT 冲突覆盖（同 subject+field 新旧交替）
 *    6. recallMemories：关键词召回 + 会话情景记忆
 *
 * C. 静态检查：
 *    7. Schema 三表 + 索引
 *    8. API 路由（sessions/messages 权限与结构）
 *    9. 前端页面 + 导航
 *   10. 成本控制：记忆召回零 token、collect 模式、记账埋点
 *
 * D. 真实集成测试（真实 API）：
 *   11. runAIResearchChat 端到端：内部项目库命中 + 回答生成
 *
 * 运行：npx tsx scripts/test-ai-research.ts
 */

import * as dotenv from 'dotenv'
dotenv.config()

import * as fs from 'fs'
import * as path from 'path'
import prisma from '../src/lib/prisma'
import {
  extractQueryKeywords,
  formatMemoriesForPrompt,
  saveMemory,
  recallMemories,
} from '../src/lib/ai-memory'
import {
  formatProjectHits,
  searchProjectsInternal,
} from '../src/lib/dd-harness/projects-tool'
import {
  AI_RESEARCH_SYSTEM_PROMPT,
  runAIResearchChat,
} from '../src/lib/ai-research-runner'

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

console.log('\n════════ AI行研 ChatBot 测试 ════════\n')

async function main() {

// ═══════════════════════════════════════
// A. 纯函数单测
// ═══════════════════════════════════════

console.log('[A1] extractQueryKeywords：中文滑窗分词')
{
  const kws = extractQueryKeywords('脑机接口行业还有投资窗口吗')
  check('提取到行业关键词', kws.includes('脑机接口') || kws.some(k => k.includes('脑机')))
  check('提取到"投资窗口"相关词', kws.some(k => k.includes('窗口') || k.includes('投资')))

  const kws2 = extractQueryKeywords('光枢科技和Neuralink对比')
  check('英文词提取（Neuralink）', kws2.includes('neuralink'))
  check('中文公司名提取', kws2.some(k => k.includes('光枢')))

  const kws3 = extractQueryKeywords('的的了吗')
  // 单字停用词已过滤；滑窗组合（如"的了"）不属于停用词表是可接受的边界情况
  check('单字停用词被过滤（的/了/吗 不在结果中）', !kws3.includes('的') && !kws3.includes('了') && !kws3.includes('吗'))

  check('空输入返回空数组', extractQueryKeywords('').length === 0)
}

console.log('\n[A2] formatMemoriesForPrompt：记忆格式化')
{
  const formatted = formatMemoriesForPrompt([
    { id: '1', type: 'FACT', subject: '光枢科技', field: 'fundingRound', content: '完成天使轮2500万融资', importance: 5 },
    { id: '2', type: 'EPISODE', subject: null, field: null, content: '用户询问了脑机接口行业窗口', importance: 1 },
  ])
  check('FACT 记忆带主体前缀', formatted.includes('[光枢科技] 完成'))
  check('EPISODE 归入会话上下文', formatted.includes('本轮会话上下文'))
  check('空记忆返回占位提示', formatMemoriesForPrompt([]).includes('暂无'))
}

console.log('\n[A3] formatProjectHits：项目命中格式化')
{
  const text = formatProjectHits([
    {
      projectId: 'p1', projectName: '苏州光枢科技', industry: '脑机接口',
      companyPosition: '光电极脑机接口', financingRound: '天使轮',
      totalAmount: '2500万', raisedAmount: '', followStage: 'POST_INVESTMENT',
      followStageLabel: '投后', ddConclusion: '主要产品：光电极技术验证中',
    },
  ])
  check('含项目名与阶段标签', text.includes('苏州光枢科技') && text.includes('投后'))
  check('含融资金额', text.includes('2500万'))
  check('含尽调结论摘要', text.includes('光电极技术验证中'))
  check('空命中返回提示', formatProjectHits([]).includes('未找到'))
}

console.log('\n[A4] 三原则 prompt 契约')
{
  const p = AI_RESEARCH_SYSTEM_PROMPT
  check('原则1：融资时间窗口评估', p.includes('融资时间窗口') && p.includes('不足半年'))
  check('原则1：窗口<半年强制风险提示', p.includes('⚠️ 时间窗口风险'))
  check('原则2：领军者与差异化分析', p.includes('领军') && p.includes('差异化'))
  check('原则3：数据【】高亮契约', p.includes('【】') && p.includes('【5亿元】'))
  check('原则3：模板化输出（行业/项目/对比）', p.includes('行业分析') && p.includes('项目分析') && p.includes('对比分析'))
  check('内部项目库优先', p.includes('search_projects') && p.includes('内部项目库'))
  check('信息来源要求', p.includes('信息来源'))
  check('投资人视角', p.includes('一级市场') && p.includes('投资人'))
}

// ═══════════════════════════════════════
// B. 数据库集成测试
// ═══════════════════════════════════════

console.log('\n[B5] saveMemory：FACT 冲突覆盖')
{
  const testSubject = `测试主体_${Date.now()}`
  const sid = 'test-session'

  // 第一条事实
  await saveMemory({ type: 'FACT', subject: testSubject, field: 'fundingRound', content: 'A轮融资5000万', keywords: '测试 A轮', importance: 4 }, sid)
  let facts = await prisma.aIMemory.findMany({
    where: { type: 'FACT', subject: testSubject, field: 'fundingRound' },
  })
  check('事实入库', facts.length === 1 && facts[0].content === 'A轮融资5000万')

  // 同 subject+field 新事实 → 旧记录被标记 superseded
  await saveMemory({ type: 'FACT', subject: testSubject, field: 'fundingRound', content: 'B轮融资2亿', keywords: '测试 B轮', importance: 5 }, sid)
  facts = await prisma.aIMemory.findMany({
    where: { type: 'FACT', subject: testSubject, field: 'fundingRound' },
  })
  const active = facts.filter(f => !f.superseded)
  const superseded = facts.filter(f => f.superseded)
  check('新事实覆盖：仅 1 条活跃记录', active.length === 1 && active[0].content === 'B轮融资2亿')
  check('旧事实标记 superseded（不物理删除）', superseded.length === 1 && superseded[0].content === 'A轮融资5000万')

  // 不同 field 不覆盖
  await saveMemory({ type: 'FACT', subject: testSubject, field: 'valuation', content: '估值10亿', keywords: '测试 估值', importance: 4 }, sid)
  const rounds = await prisma.aIMemory.findMany({
    where: { type: 'FACT', subject: testSubject, field: 'fundingRound', superseded: false },
  })
  check('不同 field 不互相覆盖', rounds.length === 1 && rounds[0].content === 'B轮融资2亿')

  // EPISODE 入库（会话级）
  await saveMemory({ type: 'EPISODE', content: '测试对话摘要', keywords: '测试', importance: 1 }, sid)
  const episode = await prisma.aIMemory.findFirst({
    where: { type: 'EPISODE', scope: `session:${sid}`, content: '测试对话摘要' },
  })
  check('EPISODE 入库（scope=会话）', episode !== null)

  // 无 subject 的 FACT 被拒绝
  const rejected = await saveMemory({ type: 'FACT', subject: '', field: 'other', content: 'x', keywords: '', importance: 2 }, sid)
  check('无主体 FACT 被拒绝', rejected === false)

  // 清理测试数据
  await prisma.aIMemory.deleteMany({ where: { OR: [{ subject: testSubject }, { scope: `session:${sid}` }] } })
}

console.log('\n[B6] recallMemories：召回')
{
  const testSubject = `召回测试_${Date.now()}`
  const sid = 'test-recall-session'

  await saveMemory({ type: 'FACT', subject: testSubject, field: 'fundingRound', content: '完成天使轮融资', keywords: `${testSubject} 融资 天使轮`, importance: 5 }, sid)
  await saveMemory({ type: 'EPISODE', content: '此前讨论过融资话题', keywords: '融资', importance: 1 }, sid)

  // 关键词召回
  const recalled = await recallMemories(`查询${testSubject}的融资情况`, sid)
  check('关键词命中全局 FACT', recalled.some(m => m.type === 'FACT' && m.content === '完成天使轮融资'))
  check('会话 EPISODE 一并召回', recalled.some(m => m.type === 'EPISODE' && m.content === '此前讨论过融资话题'))
  check('FACT 排在 EPISODE 前', recalled.findIndex(m => m.type === 'FACT') < recalled.findIndex(m => m.type === 'EPISODE'))

  // 无关查询：仅返回会话情景
  const unrelated = await recallMemories('量子计算zzz完全无关词', sid)
  check('无关查询仍带回会话上下文', unrelated.some(m => m.type === 'EPISODE'))

  // 清理
  await prisma.aIMemory.deleteMany({ where: { OR: [{ subject: testSubject }, { scope: `session:${sid}` }] } })
}

// ═══════════════════════════════════════
// C. 静态检查
// ═══════════════════════════════════════

console.log('\n[C7] Schema 三表')
{
  const schema = read('prisma/schema.prisma')
  check('AIChatSession 模型', schema.includes('model AIChatSession'))
  check('AIChatMessage 模型（sourcesJson/projectsJson）', schema.includes('model AIChatMessage') && schema.includes('sourcesJson') && schema.includes('projectsJson'))
  check('AIMemory 模型（type/scope/superseded）', schema.includes('model AIMemory') && schema.includes('superseded'))
  check('会话级联删除', /model AIChatSession[\s\S]*?onDelete: Cascade/.test(schema))
  check('User 反向关系', schema.includes('aiChatSessions'))
  check('记忆索引（subject+field+superseded）', schema.includes('@@index([subject, field, superseded])'))
}

console.log('\n[C8] API 路由')
{
  const sessionsRoute = read('src/app/api/ai-research/sessions/route.ts')
  check('sessions GET/POST/DELETE 路由', sessionsRoute.includes('export async function GET') && sessionsRoute.includes('export async function POST') && sessionsRoute.includes('export async function DELETE'))
  check('会话按用户隔离（userId 校验）', sessionsRoute.includes('userId !== session.user.id') || sessionsRoute.includes('where: { userId: session.user.id }'))

  const messagesRoute = read('src/app/api/ai-research/messages/route.ts')
  check('messages GET/POST 路由', messagesRoute.includes('export async function GET') && messagesRoute.includes('export async function POST'))
  check('提问长度限制（2000字）', messagesRoute.includes('2000'))
  check('会话标题自动生成（前20字）', messagesRoute.includes('substring(0, 20)'))
  check('工作记忆取最近2轮', messagesRoute.includes('take: 4'))
  check('消息保存含溯源（sourcesJson）', messagesRoute.includes('sourcesJson: JSON.stringify'))
}

console.log('\n[C9] Runner 与工具')
{
  const runner = read('src/lib/ai-research-runner.ts')
  check('Harness Agent 循环（runAgent）', runner.includes('runAgent'))
  check('maxTurns=4', runner.includes('maxTurns: 4'))
  check('工具集：search_projects + web_search', runner.includes('searchProjectsTool') && runner.includes('webSearchTool'))
  check('记忆召回注入 prompt', runner.includes('recallMemories') && runner.includes('formatMemoriesForPrompt'))
  check('异步记忆提取（不阻塞）', runner.includes('void extractAndSaveMemories'))
  check('token 记账（ai-research 模块）', runner.includes("recordTokenUsage('ai-research'"))
  check('溯源：内部项目命中', runner.includes('projectHits'))
  check('溯源：联网 URL 白名单（会话日志内）', runner.includes('searchedUrls'))

  const tool = read('src/lib/dd-harness/projects-tool.ts')
  check('search_projects 工具定义', tool.includes('name: \'search_projects\''))
  check('投后/尽调阶段优先排序', tool.includes('POST_INVESTMENT: 0') && tool.includes('DUE_DILIGENCE: 2'))
  check('字段白名单（无敏感财务明细）', !tool.includes('financialData:') || tool.includes('financialData') === false)
  check('附带尽调结论摘要', tool.includes('ddReport'))
  check('REJECTED 项目排除', tool.includes("status: { not: 'REJECTED' }"))
}

console.log('\n[C10] 前端与成本控制')
{
  const page = read('src/app/ai-research/page.tsx')
  check('AI行研页面存在', exists('src/app/ai-research/page.tsx'))
  check('会话列表（新建/切换/删除）', page.includes('handleNewSession') && page.includes('handleDeleteSession'))
  check('数据【】高亮渲染', page.includes('【([^】]+)】') || page.includes('bg-amber-100'))
  check('⚠️ 风险提示醒目块', page.includes('⚠️') && page.includes('bg-red-50'))
  check('内部项目关联标签（可跳转详情）', page.includes('href={`/projects/${p.projectId}`}'))
  check('来源可点击（target=_blank）', page.includes('target="_blank"'))
  check('markdown 轻量渲染', page.includes('RichContent'))

  const layout = read('src/components/DashboardLayout.tsx')
  check('导航：AI行研在投研分析下方', layout.indexOf("label: 'AI行研'") > layout.indexOf("label: '投研分析'"))

  // 成本控制
  const memory = read('src/lib/ai-memory.ts')
  check('召回走 SQL（零 token）', memory.includes('prisma.aIMemory.findMany') && !memory.includes('embedding'))
  check('提取为轻量调用（max_tokens 500）', memory.includes('500') || memory.includes('max_tokens'))
  check('EPISODE 情景记忆 scope=会话', memory.includes('EPISODE') && memory.includes('session:'))
  check('FACT 全局共享 scope=global', memory.includes("scope: 'global'"))
  check('冲突覆盖（updateMany superseded）', memory.includes('updateMany') && memory.includes('superseded: true'))
}

// ═══════════════════════════════════════
// D. 真实集成测试
// ═══════════════════════════════════════

console.log('\n[D11] 真实集成：runAIResearchChat 端到端（真实 API，约1-2分钟）')
{
  if (!process.env.DEEPSEEK_API_KEY) {
    check('DEEPSEEK_API_KEY 已配置（跳过集成测试）', false)
  } else {
    // 用测试会话（不落真实消息表，记忆会写入但清理）
    const testSessionId = `test-integration-${Date.now()}`
    const result = await runAIResearchChat(
      '脑机接口行业当前的投资时间窗口如何？我们内部项目库有相关项目吗？',
      { sessionId: testSessionId, recentMessages: [] }
    )

    check('返回非空回答', result.content.length > 100, `实际 ${result.content.length} 字`)
    check('回答涉及时间窗口（原则1）', result.content.includes('窗口') || result.content.includes('时间'))

    console.log('    回答预览：')
    console.log('    ' + result.content.substring(0, 400).replace(/\n/g, '\n    ') + '...')

    // 内部项目库命中（数据库有脑机接口测试项目）
    console.log(`    内部命中项目：${result.projectHits.map(p => `${p.projectName}`).join('、') || '（无）'}`)
    console.log(`    联网引用：${result.citations.length} 个`)

    // 记忆提取（异步，等待生效）
    await new Promise(r => setTimeout(r, 5000))
    const memories = await prisma.aIMemory.findMany({
      where: { sourceSessionId: testSessionId },
    })
    check('记忆提取入库（异步）', memories.length >= 1, `实际 ${memories.length} 条`)
    if (memories.length > 0) {
      console.log('    提取的记忆示例：')
      for (const m of memories.slice(0, 3)) {
        console.log(`      [${m.type}] ${m.subject ? `(${m.subject}) ` : ''}${m.content.substring(0, 60)}`)
      }
    }

    // 清理测试记忆
    await prisma.aIMemory.deleteMany({ where: { sourceSessionId: testSessionId } })
  }
}

// ═══════════════════════════════════════
console.log('\n════════ 测试结果 ════════')
console.log(`  通过: ${passed}  失败: ${failed}`)
console.log(failed === 0 ? '  ✅ 全部通过\n' : '  ❌ 存在失败用例\n')
process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => {
  console.error('测试脚本执行失败:', e)
  process.exit(1)
})
