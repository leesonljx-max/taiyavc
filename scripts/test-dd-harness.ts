/**
 * 尽调系统（DeepSeek Harness 架构）测试用例
 *
 * A. 纯函数单测（直接 import，验证核心逻辑）：
 *    1. buildFramework：7 大必选模块强制包含；定制模块规范化/去重/限数
 *    2. computeInputHash：输入不变→稳定；任一输入变化→变化
 *    3. filterCitations：丢弃编造 URL / 非 http URL / 重复 URL；保留真实搜索来源
 *    4. aggregateGaps：仅收集 INSUFFICIENT_DATA 模块
 *    5. needsAnalysis：增量重跑判断（未分析/失败/资料不足→重跑；已完成且输入未变→跳过）
 *
 * B. 静态检查（Schema / Migration / Harness 库 / API / 触发 / 前端）：
 *    6. Prisma：DDReport / DDModuleResult 模型与 Project 反向关系
 *    7. Migration SQL 与模型一致
 *    8. Agent 循环：工具调用协议、thinking 禁用、轮次上限、兜底轮
 *    9. Runner：并发池、防重入、增量、缺口汇总、阶段触发
 *    10. API：GET/POST 权限与后台执行
 *    11. 阶段变更触发接线
 *    12. 前端面板与详情页嵌入
 *
 * 运行：npx tsx scripts/test-dd-harness.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  FIXED_MODULES,
  FIXED_MODULE_KEYS,
  buildFramework,
  computeInputHash,
  filterCitations,
  aggregateGaps,
  needsAnalysis,
} from '../src/lib/dd-harness/framework'
import {
  parseAgentJson,
  repairJson,
  stripJsonNoise,
  extractJsonBlock,
  escapeInnerQuotes,
} from '../src/lib/dd-harness/agent'

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

console.log('\n════════ 尽调系统（DD Harness）测试 ════════\n')

// ═══════════════════════════════════════
// A. 纯函数单测
// ═══════════════════════════════════════

console.log('[A1] buildFramework：7 大必选模块硬约束')
{
  // 完全无 AI 输出（解析失败/为空）→ 仍强制包含 7 大模块
  const f1 = buildFramework(null)
  check('无 AI 输出时仍包含 7 大必选模块', f1.modules.length === 7)
  check(
    '7 大模块 key 与规范一致',
    ['mainProducts','coreAdvantage','coreTeam','financialData','orderProgress','competitors','financingPlan']
      .every(k => f1.modules.some(m => m.key === k))
  )
  check('全部标记 required=true', f1.modules.every(m => m.required === true))
  check('必选模块均映射 projectField', f1.modules.every(m => !!m.projectField))

  // AI 试图用空数组移除必选模块 → 仍然保留
  const f2 = buildFramework({ customModules: [], focusNotes: {} })
  check('AI 输出空定制时必选模块仍在', f2.modules.length === 7)

  // focusNotes 覆盖默认关注点
  const f3 = buildFramework({ customModules: [], focusNotes: { coreTeam: '重点核实创始人学历真实性' } })
  check('focusNotes 覆盖关注点', f3.modules.find(m => m.key === 'coreTeam')!.focus === '重点核实创始人学历真实性')
}

{
  console.log('\n[A1b] buildFramework：定制模块规范化')
  const f = buildFramework({
    customModules: [
      { key: 'licensing', name: '行业资质与许可', focus: '注册证/批文' },
      { key: 'licensing', name: '重复模块', focus: '应被去重' },           // 重复 key → 去重
      { key: '正常 key!@#', name: '非法字符key', focus: '' },              // 非法字符 → 清洗
      { key: '', name: '', focus: '' },                                     // 空 name → 丢弃
      { key: 'a', name: '模块A', focus: 'x' },
      { key: 'b', name: '模块B', focus: 'x' },
      { key: 'c', name: '模块C', focus: 'x' },
      { key: 'd', name: '模块D', focus: 'x' },                             // 超过5个 → 截断
    ],
    focusNotes: {},
  })
  check('定制模块上限 5 个', f.modules.length <= 7 + 5)
  check('重复 key 被去重', f.modules.filter(m => m.moduleName === '重复模块').length === 0)
  check('定制模块 key 带 custom: 前缀', f.modules.filter(m => !FIXED_MODULE_KEYS.has(m.key)).every(m => m.key.startsWith('custom:')))
  check('空 name 定制模块被丢弃', f.modules.every(m => m.moduleName !== ''))
  check('定制模块 required=false', f.modules.filter(m => !FIXED_MODULE_KEYS.has(m.key)).every(m => m.required === false))
  check('必选模块未被定制覆盖/移除', FIXED_MODULES.every(fm => f.modules.some(m => m.key === fm.key)))
}

console.log('\n[A2] computeInputHash：输入指纹')
{
  const base = { field: '主要产品内容A', research: '投研内容A', docs: '文档A', focus: '重点A' }
  const h1 = computeInputHash(base)
  const h2 = computeInputHash({ ...base })
  check('相同输入 → 指纹稳定', h1 === h2)
  check('指纹为16位hex', /^[0-9a-f]{16}$/.test(h1))
  check('字段变化 → 指纹变化', h1 !== computeInputHash({ ...base, field: '字段已更新' }))
  check('文档变化 → 指纹变化', h1 !== computeInputHash({ ...base, docs: '新增文档内容' }))
  check('关注点变化 → 指纹变化', h1 !== computeInputHash({ ...base, focus: '框架重新生成' }))
  check('null 与空串归一化后指纹一致', computeInputHash({ a: null }) === computeInputHash({ a: '' }))
}

console.log('\n[A3] filterCitations：引用交叉验证（防编造）')
{
  const searched = ['https://a.com/x', 'https://b.com/y', 'https://c.com/z']
  const citations = [
    { label: '真实来源A', url: 'https://a.com/x' },          // ✅ 保留
    { label: '编造来源', url: 'https://evil.com/fake' },     // ❌ 不在会话日志
    { label: '非http', url: 'ftp://a.com/x' },               // ❌ 协议非法
    { label: '重复', url: 'https://a.com/x' },               // ❌ 重复 URL
    { label: '真实来源B', url: 'https://b.com/y' },          // ✅ 保留
    { label: '', url: 'https://c.com/z' },                   // ✅ 保留（label 兜底为 URL）
  ]
  const out = filterCitations(citations, searched)
  check('编造 URL 被丢弃', !out.some(c => c.url === 'https://evil.com/fake'))
  check('非 http(s) 协议被丢弃', !out.some(c => c.url.startsWith('ftp')))
  check('重复 URL 去重', out.filter(c => c.url === 'https://a.com/x').length === 1)
  check('真实搜索来源保留', ['https://a.com/x','https://b.com/y','https://c.com/z'].every(u => out.some(c => c.url === u)))
  check('空 label 兜底为 URL', out.find(c => c.url === 'https://c.com/z')!.label === 'https://c.com/z')
  check('空输入返回空数组', filterCitations([], searched).length === 0)
  check('无搜索记录时全部丢弃', filterCitations(citations, []).length === 0)
}

console.log('\n[A4] aggregateGaps：缺口清单')
{
  const gaps = aggregateGaps([
    { moduleKey: 'coreTeam', moduleName: '核心团队', status: 'INSUFFICIENT_DATA', missing: '需补充创始人简历' },
    { moduleKey: 'mainProducts', moduleName: '主要产品', status: 'COMPLETED' },                      // 已完成 → 不进缺口
    { moduleKey: 'financialData', moduleName: '财务数据', status: 'INSUFFICIENT_DATA', missing: null }, // missing 兜底
    { moduleKey: 'competitors', moduleName: '竞争对手', status: 'FAILED', missing: 'x' },              // 失败 → 不进缺口
  ])
  check('仅 INSUFFICIENT_DATA 进入缺口', gaps.length === 2)
  check('缺口含模块名与缺失说明', gaps[0].moduleName === '核心团队' && gaps[0].missing === '需补充创始人简历')
  check('missing 为空时兜底提示', gaps[1].missing.includes('资料不足'))
}

console.log('\n[A5] needsAnalysis：增量重跑判断')
{
  const hash = 'abc123'
  check('从未分析 → 需要分析', needsAnalysis(null, hash) === true)
  check('待分析 → 需要', needsAnalysis({ status: 'PENDING', inputHash: hash }, hash) === true)
  check('运行中 → 需要（异常恢复）', needsAnalysis({ status: 'RUNNING', inputHash: hash }, hash) === true)
  check('上次失败 → 需要', needsAnalysis({ status: 'FAILED', inputHash: hash }, hash) === true)
  check('资料不足 → 需要（输入可能已补充）', needsAnalysis({ status: 'INSUFFICIENT_DATA', inputHash: hash }, hash) === true)
  check('已完成且输入未变 → 跳过', needsAnalysis({ status: 'COMPLETED', inputHash: hash }, hash) === false)
  check('已完成但输入变化 → 重新分析', needsAnalysis({ status: 'COMPLETED', inputHash: 'old' }, hash) === true)
}

console.log('\n[A6] parseAgentJson：多层容错解析（本次修复的核心）')
{
  // 场景1：标准 JSON（模型完全遵守格式）
  const ok = parseAgentJson<{ status: string; conclusion: string }>(
    '{"status":"COMPLETED","conclusion":"结论内容"}'
  )
  check('标准 JSON 解析成功', ok?.conclusion === '结论内容')

  // 场景2：JSON 前后带说明文字（模型违反"不要其他文字"要求）
  const withPrefix = parseAgentJson<{ status: string; conclusion: string }>(
    '所有搜索均未返回结果。基于现有资料分析：\n\n{"status":"COMPLETED","conclusion":"结论"}\n以上为最终结论。'
  )
  check('JSON 前后带说明文字仍可解析', withPrefix?.conclusion === '结论')

  // 场景3【回归用例·实际抓到的失败样本】：字符串值内部含中文弯引号
  // 旧 repairJson 盲目把 “” 替换为英文引号，破坏 JSON 结构导致解析失败
  const cnQuote = parseAgentJson<{ status: string; conclusion: string }>(
    '{"status":"INSUFFICIENT_DATA","conclusion":"搜索关键词“苏州光枢科技 脑机接口”未返回结果，公司“极佳视界”资料缺失。","missing":"补充资料"}'
  )
  check('值内含中文弯引号不破坏解析（旧bug回归）', cnQuote?.status === 'INSUFFICIENT_DATA' && cnQuote.conclusion.includes('苏州光枢科技'))

  // 场景4：JSON 结构本身使用中文弯引号（另一类模型输出问题）
  const structQuote = parseAgentJson<{ status: string; conclusion: string }>(
    '{“status”:“COMPLETED”,“conclusion”:“结论内容”}'
  )
  check('结构使用中文引号可修复解析', structQuote?.conclusion === '结论内容')

  // 场景5：字符串值内部含未转义英文双引号
  const innerQuote = parseAgentJson<{ conclusion: string }>(
    '{"conclusion":"搜索“脑机接口 竞品”时发现关键词 "Neuralink" 无结果"}'
  )
  check('值内未转义英文引号可启发式修复', innerQuote?.conclusion.includes('Neuralink') === true)

  // 场景6：<think> 思考标签 + 代码块围栏
  const noisy = parseAgentJson<{ status: string }>(
    '<think>让我思考一下…</think>\n```json\n{"status":"COMPLETED"}\n```'
  )
  check('think 标签与代码块围栏被清洗', noisy?.status === 'COMPLETED')

  // 场景7：尾逗号容错
  const trailing = parseAgentJson<{ a: string }>('{"a":"x",}')
  check('尾逗号容错', trailing?.a === 'x')

  // 场景8：完全无 JSON → 返回 null（不抛异常）
  check('无 JSON 内容返回 null', parseAgentJson('纯文本回答，没有结构化输出') === null)
  check('空字符串返回 null', parseAgentJson('') === null)

  // 场景9：嵌套对象/数组正常解析
  const nested = parseAgentJson<{ status: string; citations: Array<{ label: string; url: string }> }>(
    '{"status":"COMPLETED","citations":[{"label":"来源A","url":"https://a.com"},{"label":"来源B","url":"https://b.com"}]}'
  )
  check('嵌套数组结构正常解析', nested?.citations?.length === 2 && nested.citations[0].url === 'https://a.com')

  // 场景10：真实失败样本完整复刻（值内大量中文引号 + 前置说明文字）
  const realWorld = parseAgentJson<{ status: string; conclusion: string; missing: string }>(
    '所有4次搜索均未返回有效结果。\n\n{\n  "status": "INSUFFICIENT_DATA",\n  "conclusion": "通过4次联网搜索（关键词涵盖“苏州光枢科技 脑机接口 光电极”、“光电极脑机接口 技术 公司 竞品”等），均未检索到该公司相关公开信息。",\n  "citations": [],\n  "missing": "缺少以下关键资料：1）公司“工商注册信息”"\n}'
  )
  check(
    '真实失败样本（前置文字+值内中文引号）完整修复',
    realWorld?.status === 'INSUFFICIENT_DATA' && realWorld.conclusion.includes('光电极') && realWorld.missing.includes('工商注册')
  )
}

console.log('\n[A6b] 解析辅助函数')
{
  // stripJsonNoise：保留中文引号（与 repairJson 的关键区别）
  check(
    'stripJsonNoise 保留中文弯引号',
    stripJsonNoise('“保留”').includes('“') && !stripJsonNoise('“保留”').includes('"')
  )
  check(
    'repairJson 将中文弯引号替换为英文引号',
    repairJson('“替换”') === '"替换"'
  )
  check('stripJsonNoise 移除 think 标签', stripJsonNoise('<think>x</think>{"a":1}') === '{"a":1}')

  // extractJsonBlock：平衡块提取
  check('extractJsonBlock 提取平衡对象', extractJsonBlock('前置文字 {"a":{"b":1}} 后置文字') === '{"a":{"b":1}}')
  check('extractJsonBlock 忽略字符串内的大括号', extractJsonBlock('{"a":"文本{嵌套}内容"}') === '{"a":"文本{嵌套}内容"}')
  check('extractJsonBlock 无左括号返回 null', extractJsonBlock('无JSON') === null)
  check('extractJsonBlock 不平衡返回 null', extractJsonBlock('{"a":1') === null)

  // escapeInnerQuotes：启发式转义
  check(
    'escapeInnerQuotes 转义值内引号但保留结构引号',
    escapeInnerQuotes('{"a":"他说 "x" 之后"}') === '{"a":"他说 \\"x\\" 之后"}'
  )
}

// ═══════════════════════════════════════
// B. 静态检查
// ═══════════════════════════════════════

console.log('\n[B6] Prisma Schema')
const schema = read('prisma/schema.prisma')
check('DDReport 模型存在', schema.includes('model DDReport'))
check('DDReport.projectId 唯一（单项目单报告）', /model DDReport[\s\S]*?projectId\s+String\s+@unique/.test(schema))
check('DDModuleResult 模型存在', schema.includes('model DDModuleResult'))
check('DDModuleResult 唯一约束 (reportId, moduleKey)', schema.includes('@@unique([reportId, moduleKey])'))
check('Project 反向关系 ddReport', schema.includes('ddReport         DDReport?'))
check('DDReport 级联删除', /model DDReport[\s\S]*?onDelete: Cascade/.test(schema))

console.log('\n[B7] Migration')
const mig = read('prisma/migrations/20260821000001_add_dd_report/migration.sql')
check('migration 文件存在', exists('prisma/migrations/20260821000001_add_dd_report/migration.sql'))
check('创建 DDReport 表', mig.includes('CREATE TABLE "DDReport"'))
check('创建 DDModuleResult 表', mig.includes('CREATE TABLE "DDModuleResult"'))
check('projectId 唯一索引', mig.includes('CREATE UNIQUE INDEX "DDReport_projectId_key"'))
check('(reportId, moduleKey) 唯一索引', mig.includes('CREATE UNIQUE INDEX "DDModuleResult_reportId_moduleKey_key"'))
check('外键级联删除', mig.includes('ON DELETE CASCADE'))

console.log('\n[B8] Agent 循环（Harness 核心）')
const agent = read('src/lib/dd-harness/agent.ts')
check('Agent 循环：runAgent 函数', agent.includes('export async function runAgent'))
check('DeepSeek 工具调用协议（tools + tool_choice）', agent.includes('tools:') && agent.includes("tool_choice: 'auto'"))
check('工具结果回填（role: tool + tool_call_id）', agent.includes("role: 'tool'") && agent.includes('tool_call_id'))
check('thinking 禁用（防思考标签污染 JSON）', agent.includes("thinking: { type: 'disabled' }"))
check('轮次上限默认 4', agent.includes('opts.maxTurns ?? 4'))
check('达到上限后兜底一轮强制输出结论', agent.includes('不要再调用工具'))
check('会话日志记录工具调用与结果', agent.includes("type: 'tool_call'") && agent.includes("type: 'tool_result'"))
check('repairJson 移除 <think> 标签', agent.includes('<think>[\\s\\S]*?<\\/think>'))
check('runSingleCall（框架生成无工具调用）', agent.includes('export async function runSingleCall'))

const tools = read('src/lib/dd-harness/tools.ts')
check('web_search 工具定义（可插拔接口）', tools.includes('export const webSearchTool'))
check('web_search 记录返回 URL 到会话日志（溯源）', tools.includes('sessionLog.append({ type: \'tool_result\', name: \'web_search\', urls'))
check('Tavily 实现可替换', tools.includes('searchWeb'))

console.log('\n[B9] Runner（编排器）')
const runner = read('src/lib/dd-harness/runner.ts')
check('框架生成（读行业/定位/融资历史）', runner.includes('generateFramework'))
check('强制含 7 大必选模块（buildFramework）', runner.includes('buildFramework'))
check('并行子Agent（runPool + CONCURRENCY=2）', runner.includes('runPool') && runner.includes('CONCURRENCY = 2'))
check('模块输入指纹计算（增量重跑）', runner.includes('computeInputHash') && runner.includes('needsAnalysis'))
check('引用交叉验证（filterCitations + searchedUrls）', runner.includes('filterCitations') && runner.includes('sessionLog.searchedUrls()'))
check('缺口汇总（aggregateGaps）', runner.includes('aggregateGaps'))
check('防重入（runningProjects）', runner.includes('runningProjects') && runner.includes('正在运行中'))
check('阶段触发：仅 DUE_DILIGENCE', runner.includes("newStage !== 'DUE_DILIGENCE'") && runner.includes('triggerDueDiligenceOnStage'))
check('阶段触发后台执行不阻塞', runner.includes('void runDueDiligence'))
check('报告状态流转 RUNNING→COMPLETED', runner.includes("status: 'RUNNING'") && runner.includes("status: 'COMPLETED'"))
check('子Agent读取项目资料+投研内容+文档', runner.includes('fieldValue') && runner.includes('researchContent') && runner.includes('documentText'))
check('模块失败不中断整体（FAILED 状态记录）', runner.includes("status: 'FAILED'"))

const prompts = read('src/lib/dd-harness/prompts.ts')
check('框架生成 prompt 说明 7 大必选模块由系统强制包含', prompts.includes('7 大必选模块已由系统强制包含'))
check('模块 prompt 禁止编造引用', prompts.includes('禁止编造'))
check('模块 prompt 要求 INSUFFICIENT_DATA 如实标记', prompts.includes('INSUFFICIENT_DATA'))

console.log('\n[B10] API 路由')
const ddRoute = read('src/app/api/research/[projectId]/dd/route.ts')
check('GET/POST 路由存在', exists('src/app/api/research/[projectId]/dd/route.ts'))
check('GET 权限：canViewResearchProject', ddRoute.includes('canViewResearchProject'))
check('POST 权限：canEditResearchProject', ddRoute.includes('canEditResearchProject'))
check('POST 后台执行（不阻塞请求）', ddRoute.includes('void runDueDiligence'))
check('POST 支持 force 全量/moduleKeys 指定模块', ddRoute.includes('body.force === true') && ddRoute.includes('moduleKeys'))
check('运行中返回 409', ddRoute.includes('409'))
check('GET 返回 running 状态供轮询', ddRoute.includes('isDDRunning') && ddRoute.includes('running'))
check('GET 返回是否处于尽调阶段', ddRoute.includes('inDueDiligenceStage'))

console.log('\n[B11] 阶段变更触发接线')
const stageRoute = read('src/app/api/stage-change-requests/[id]/action/route.ts')
check('action 路由导入 triggerDueDiligenceOnStage', stageRoute.includes('triggerDueDiligenceOnStage'))
check('审批通过后触发（事务之后）', stageRoute.indexOf('triggerDueDiligenceOnStage(') > stageRoute.indexOf('$transaction'))
check('触发不阻塞审批响应（void/后台）', stageRoute.includes('triggerDueDiligenceOnStage('))

console.log('\n[B12] 前端')
const panel = read('src/components/research/DDReportPanel.tsx')
check('DDReportPanel 组件存在', exists('src/components/research/DDReportPanel.tsx'))
check('运行中轮询（4秒）', panel.includes('setInterval(fetchReport, 4000)'))
check('五种模块状态展示', ['PENDING','RUNNING','COMPLETED','INSUFFICIENT_DATA','FAILED'].every(s => panel.includes(s)))
check('缺口清单卡片（需补充资料）', panel.includes('需补充资料'))
check('引用可点击溯源（target=_blank）', panel.includes('target="_blank"'))
check('增量分析 + 全量重跑按钮', panel.includes('增量分析') && panel.includes('全量重跑'))
check('canEdit 控制按钮可见性', panel.includes('canEdit &&'))

const detailPage = read('src/app/research/[projectId]/page.tsx')
check('详情页嵌入 DDReportPanel', detailPage.includes('<DDReportPanel'))
check('canEdit 权限传递（维护人/合伙人/ADMIN）', detailPage.includes('project.createdById ===') && detailPage.includes('INVESTMENT_PARTNER'))

// ═══════════════════════════════════════
console.log('\n════════ 测试结果 ════════')
console.log(`  通过: ${passed}  失败: ${failed}`)
console.log(failed === 0 ? '  ✅ 全部通过\n' : '  ❌ 存在失败用例\n')
process.exit(failed === 0 ? 0 : 1)
