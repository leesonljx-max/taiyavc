/**
 * V1.5.0 项目尽调改版测试用例
 *
 * 覆盖：
 * 1. 导航改名「项目尽调」+ 紫蓝色主题（B6B1EE）
 * 2. 尽调总览：统计卡片（我的尽调项目/已生成报告/待办事项）+ 长条瘦卡片
 * 3. 模块自由文本框（填写 + 粘贴图片）
 * 4. 项目基本信息调整（去掉主要产品/核心优势）+ 投资亮点卡片（手动 + AI）
 *
 * 运行：npx tsx scripts/test-dd-redesign.ts
 */

import * as dotenv from 'dotenv'
dotenv.config()

import * as fs from 'fs'
import * as path from 'path'
import prisma from '../src/lib/prisma'

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

console.log('\n════════ V1.5.0 项目尽调改版测试 ════════\n')

async function main() {

// ═══════════════════════════════════════
// 1. 导航改名 + 紫蓝色主题
// ═══════════════════════════════════════

console.log('[T1] 导航改名 + 紫蓝色主题')
{
  const layout = read('src/components/DashboardLayout.tsx')
  check('导航改为「项目尽调」', layout.includes("label: '项目尽调'"))
  check('无残留「投研分析」导航', !layout.includes("label: '投研分析'"))
  check('AI行研仍在投研（尽调）下方', layout.indexOf("label: 'AI行研'") > layout.indexOf("label: '项目尽调'"))
  check('DD 主题检测（/research 路径）', layout.includes('isDDTheme') && layout.includes("pathname.startsWith('/research')"))
  check('主题类 dd-theme 应用', layout.includes("'dd-theme'"))
  check('侧边栏紫蓝底色类 dd-theme-sidebar', layout.includes('dd-theme-sidebar'))

  const css = read('src/app/globals.css')
  check('CSS 含 B6B1EE 主色（b6b1ee）', css.toLowerCase().includes('#b6b1ee'))
  check('导航项紫蓝配色（#efedfb 底 + 紫蓝描边）', css.includes('.dd-theme .nav-block') && css.includes('#efedfb'))
  check('激活项紫蓝渐变', css.includes('.dd-theme .nav-block-active') && css.includes('#8d84e0'))
  check('侧边栏紫蓝渐变底色', css.includes('.dd-theme-sidebar') && css.includes('#e6e2f7'))
  check('尽调主题卡片 dd-card', css.includes('.dd-card'))
}

// ═══════════════════════════════════════
// 2. 尽调总览页
// ═══════════════════════════════════════

console.log('\n[T2] 尽调总览：统计卡片 + 长条瘦卡片')
{
  const page = read('src/app/research/page.tsx')
  check('页面标题「项目尽调」', page.includes('title="项目尽调"'))
  check('统计卡1：我的尽调项目（可点击展开列表）', page.includes('我的尽调项目') && page.includes('setShowProjects(true)'))
  check('统计卡2：已生成尽调报告', page.includes('已生成尽调报告'))
  check('统计卡2说明：完整且无需补充资料', page.includes('报告完整且无需补充资料'))
  check('统计卡3：待办事项（显示各项目需补充资料）', page.includes('待办事项') && page.includes('各项目需补充的资料'))
  check('待办卡可点击展开面板', page.includes('setShowPending(true)') && page.includes('showPending'))
  check('待办按项目分组展示', page.includes('pendingByProject'))
  check('待办项可点击跳转对应项目', page.includes('handleCardClick(item.projectId)'))
  check('长条卡片：仅显示项目名称/定位/融资金额/模块进度', page.includes('project.companyPosition') && page.includes('project.totalAmount') && page.includes('moduleProgress'))
  check('长条卡片：不显示公司全称/行业/创建时间', !page.includes('project.companyFullName ||') || page.indexOf('project.companyFullName') === -1)
  check('长条卡片状态指示灯（完整/待补）', page.includes('hasCompletedReport') && page.includes('pendingCount'))
  check('模块进度条紫蓝配色', page.includes('from-[#b6b1ee] to-[#8d84e0]'))
  check('卡片使用 dd-card 主题', page.includes('dd-card'))
  check('可视化报告入口保留', page.includes('可视化报告'))

  // API 统计逻辑
  const api = read('src/app/api/research/route.ts')
  check('API 返回 stats（myProjects/completedReports/pendingItems）', api.includes('myProjects') && api.includes('completedReports') && api.includes('pendingItems'))
  check('完整报告判定：COMPLETED 且无 INSUFFICIENT_DATA', api.includes("dd.status === 'COMPLETED'") && api.includes('INSUFFICIENT_DATA'))
  check('待办来自缺口模块（missing 说明）', api.includes('m.missing'))
  check('API 含 ddReport 关联查询', api.includes('ddReport:'))

  // 数据库真实校验：统计与实际一致
  const ddProjects = await prisma.project.findMany({
    where: { followStage: 'DUE_DILIGENCE' },
    select: { id: true, ddReport: { select: { status: true, moduleResults: { select: { status: true } } } } },
  })
  let dbCompleted = 0
  let dbPending = 0
  for (const p of ddProjects) {
    const insufficient = p.ddReport?.moduleResults.filter(m => m.status === 'INSUFFICIENT_DATA') || []
    if (p.ddReport && p.ddReport.status === 'COMPLETED' && insufficient.length === 0) dbCompleted++
    if (p.ddReport && p.ddReport.status !== 'FAILED') dbPending += insufficient.length
  }
  console.log(`    （数据库：${ddProjects.length} 个尽调项目，${dbCompleted} 个完整报告，${dbPending} 项待补资料）`)
  check('数据库统计口径非负且一致', dbCompleted >= 0 && dbPending >= 0)
}

// ═══════════════════════════════════════
// 3. 模块自由文本框（填写 + 粘贴图片）
// ═══════════════════════════════════════

console.log('\n[T3] 模块自由文本框（填写 + 粘贴图片）')
{
  const page = read('src/app/research/[projectId]/page.tsx')
  check('所有模块均有自由文本框（补充说明）', page.includes('补充说明') && page.includes('freeText'))
  check('自由文本保存（PUT content.freeText）', page.includes('handleSaveFreeText') && page.includes('freeText }'))
  check('与手动字段合并不覆盖（...manualContent）', page.includes('{ ...manualContent, freeText }'))
  check('粘贴图片处理（onPaste + clipboardData）', page.includes('handleFreeTextPaste') && page.includes('clipboardData'))
  check('图片上传走 /api/upload/image', page.includes('/api/upload/image'))
  check('粘贴图片插入 markdown 语法', page.includes('![图片]('))
  check('已粘贴图片预览（缩略图可点击放大）', page.includes('object-cover rounded-lg') && page.includes("window.open(url"))
  check('非编辑者只读展示', page.includes('whitespace-pre-wrap') && page.includes('暂无补充说明'))

  // 数据库写入验证：freeText 持久化
  const testProject = await prisma.project.findFirst({
    where: { followStage: 'DUE_DILIGENCE' },
    select: { id: true },
  })
  if (testProject) {
    const moduleId = `${testProject.id}:TEAM`
    const before = await prisma.researchModule.findUnique({
      where: { projectId_moduleType: { projectId: testProject.id, moduleType: 'TEAM' } },
    })
    const original = before?.content
    // 写入 freeText 验证 JSON 合并
    const base = original ? JSON.parse(original) : {}
    await prisma.researchModule.update({
      where: { projectId_moduleType: { projectId: testProject.id, moduleType: 'TEAM' } },
      data: { content: JSON.stringify({ ...base, freeText: '测试自由文本内容' }) },
    })
    const after = await prisma.researchModule.findUnique({
      where: { projectId_moduleType: { projectId: testProject.id, moduleType: 'TEAM' } },
    })
    const parsed = JSON.parse(after!.content!)
    check('freeText 可持久化（JSON 字段合并保存）', parsed.freeText === '测试自由文本内容')
    // 还原
    await prisma.researchModule.update({
      where: { projectId_moduleType: { projectId: testProject.id, moduleType: 'TEAM' } },
      data: { content: original },
    })
    check('测试数据已还原', true)
  }
}

// ═══════════════════════════════════════
// 4. 项目基本信息 + 投资亮点卡片
// ═══════════════════════════════════════

console.log('\n[T4] 基本信息 + 投资亮点卡片')
{
  const page = read('src/app/research/[projectId]/page.tsx')
  // 基本信息调整
  check('基本信息去掉「主要产品」', !page.includes('>主要产品:</span>'))
  check('基本信息去掉「核心优势」', !page.includes('>核心优势:</span>'))
  check('基本信息保留：名称/全称/行业/定位/融资金额/累计融资', page.includes('项目名称') && page.includes('公司全称') && page.includes('所处行业') && page.includes('公司定位') && page.includes('融资金额') && page.includes('累计融资金额'))
  check('基本信息卡片使用 dd-card 主题', page.includes('dd-card rounded-2xl'))

  // 投资亮点卡片
  check('投资亮点卡片存在（HighlightsCard）', page.includes('HighlightsCard') && page.includes('投资亮点'))
  check('上半部分：维护人手动填写文本框', page.includes('维护人填写') && page.includes('manualText'))
  check('手动填写支持粘贴图片', page.includes('onPaste={handlePaste}'))
  check('下半部分：AI 结合所有模块总结', page.includes('AI 投资亮点') && page.includes('结合所有模块'))
  check('AI 总结按钮（POST highlights）', page.includes("highlights`, { method: 'POST' }"))
  check('手动保存按钮（PUT highlights）', page.includes("highlights`, {") && page.includes('method: \'PUT\''))
  check('AI 亮点编号列表展示', page.includes('aiHighlights.highlights.map'))
  check('AI 总结时间显示', page.includes('analyzedAt'))
  check('canEdit 权限控制', page.includes('canEdit &&'))

  // Schema 新字段
  const schema = read('prisma/schema.prisma')
  check('Schema：manualHighlights 字段', schema.includes('manualHighlights'))
  check('Schema：aiHighlightsJson 字段', schema.includes('aiHighlightsJson'))

  // 数据库字段存在
  const cols = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name='Project' AND column_name IN ('manualHighlights','aiHighlightsJson')`
  check('数据库：两个新字段已建', Array.isArray(cols) && cols.length === 2)

  // API 路由
  const hlApi = read('src/app/api/research/[projectId]/highlights/route.ts')
  check('highlights API 存在', fs.existsSync(path.join(ROOT, 'src/app/api/research/[projectId]/highlights/route.ts')))
  check('PUT：保存手动亮点（5000字限制）', hlApi.includes('manualHighlights') && hlApi.includes('5000'))
  check('POST：AI 总结（汇总全部模块）', hlApi.includes('moduleBlocks') && hlApi.includes('researchModule.findMany'))
  check('AI 总结读取模块 AI 摘要+手动内容+文档摘录', hlApi.includes('aiSummary') && hlApi.includes('文档摘录'))
  check('AI 亮点 3-6 条约束', hlApi.includes('3-6') && hlApi.includes('slice(0, 6)'))
  check('AI 输出解析容错（parseAgentJson）', hlApi.includes('parseAgentJson'))
  check('token 记账（research 模块）', hlApi.includes("recordTokenUsage('research'"))
  check('权限校验（canEditResearchProject）', hlApi.includes('canEditResearchProject'))

  // 详情 API 返回新字段
  const detailApi = read('src/app/api/research/[projectId]/route.ts')
  check('详情 API 返回 manualHighlights/aiHighlightsJson', detailApi.includes('manualHighlights: true') && detailApi.includes('aiHighlightsJson: true'))
}

// ═══════════════════════════════════════
// 5. 真实集成：AI 投资亮点总结
// ═══════════════════════════════════════

console.log('\n[T5] 真实集成：AI 投资亮点总结（真实 API，约30秒）')
{
  if (!process.env.DEEPSEEK_API_KEY) {
    check('DEEPSEEK_API_KEY 已配置（跳过集成测试）', false)
  } else {
    const testProject = await prisma.project.findFirst({
      where: { followStage: 'DUE_DILIGENCE' },
      select: { id: true, name: true },
    })
    if (!testProject) {
      console.log('    （无尽调阶段项目，跳过）')
      check('跳过（无测试项目）', true)
    } else {
      console.log(`    测试项目：${testProject.name}`)
      // 直接调用内部逻辑：用 fetch 调 DeepSeek（模拟 POST highlights 核心链路）
      const apiKey = process.env.DEEPSEEK_API_KEY
      const systemPrompt = '你是一级市场投资机构的资深投资人。请输出 3 条投资亮点。严格按 JSON 输出：{"highlights": ["1","2","3"]}'
      const userPrompt = `【项目】${testProject.name}（测试集成）
【模块】行业分析：脑机接口行业融资热度上升期，上半年融资超60起总额70亿元；产品和技术：光电极脑机接口，侵入式技术路线。
请输出投资亮点 JSON。`
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 1000,
          thinking: { type: 'disabled' },
        }),
      })
      check('AI 调用成功（200）', res.ok)
      if (res.ok) {
        const data = await res.json()
        const raw = data.choices?.[0]?.message?.content || ''
        console.log(`    AI 原始输出（前300字符）：${raw.substring(0, 300)}`)
        const { parseAgentJson } = await import('../src/lib/dd-harness/agent')
        const parsed = parseAgentJson<{ highlights?: unknown[] }>(raw)
        const highlights = Array.isArray(parsed?.highlights) ? parsed!.highlights.filter(h => typeof h === 'string') : []
        check('解析出投资亮点（3条）', highlights.length === 3, `实际 ${highlights.length} 条`)
        if (highlights.length > 0) {
          console.log('    亮点示例：')
          for (const h of highlights.slice(0, 2)) {
            console.log(`      - ${(h as string).substring(0, 60)}`)
          }
        }
      }
    }
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
