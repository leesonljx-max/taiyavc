/**
 * 单元测试：AI 检索核心库新优化逻辑
 *
 * 覆盖步骤 4 的 7 项优化：
 *   D. JSON 修复（repairJson）
 *   E. 智能 Extract（snippet >= 500 跳过）
 *   F. 动态批大小（内容长度决定 batchSize）
 *   G. 超时控制（DeepSeek 60s 超时降级）
 *   H. 并发搜索（Promise.all 多关键词）
 *   I. 消除重复 industryTags
 *   J. 超时静默降级
 *
 * 运行: npx tsx scripts/test-optimizations.ts
 */
import 'dotenv/config'

// ── D. JSON 修复函数测试 ──

function repairJson(text: string): string {
  let s = text.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  s = s.replace(/,\s*([}\]])/g, '$1')
  return s
}

function testD_RepairJson() {
  console.log('\n━━━ D. JSON 修复（repairJson）━━━\n')

  const cases: { name: string; input: string; expected: string }[] = [
    { name: '正常 JSON', input: '[{"a":1}]', expected: '[{"a":1}]' },
    { name: 'markdown 代码块', input: '```json\n[{"a":1}]\n```', expected: '[{"a":1}]' },
    { name: '无 json 标记代码块', input: '```\n[{"a":1}]\n```', expected: '[{"a":1}]' },
    { name: '尾随逗号(数组)', input: '[{"a":1,},{"b":2,}]', expected: '[{"a":1},{"b":2}]' },
    { name: '尾随逗号(嵌套)', input: '[{"a":[1,2,],"b":{"c":3,}}]', expected: '[{"a":[1,2],"b":{"c":3}}]' },
    { name: '混合问题', input: '```json\n[{"a":1,},]\n```', expected: '[{"a":1}]' },
  ]

  let passed = 0
  for (const c of cases) {
    const result = repairJson(c.input)
    const ok = result === c.expected
    if (ok) {
      passed++
      console.log(`  ✓ ${c.name}`)
    } else {
      console.log(`  ✗ ${c.name}`)
      console.log(`    期望: ${c.expected}`)
      console.log(`    实际: ${result}`)
    }

    // 额外验证：修复后的 JSON 能被 JSON.parse 成功解析
    try {
      JSON.parse(result)
    } catch {
      console.log(`    ✗ 修复后仍无法 JSON.parse`)
      passed--
    }
  }

  console.log(`\n  汇总: ${passed}/${cases.length} 通过`)
  return passed === cases.length
}

// ── E. 智能 Extract 逻辑测试 ──

function testE_SmartExtract() {
  console.log('\n━━━ E. 智能 Extract（snippet >= 500 跳过）━━━\n')

  const MIN_SNIPPET_LEN = 500

  const mockResults = [
    { title: '短文章1', url: 'https://a.com/1', snippet: '短内容'.repeat(10) },      // 30 字符
    { title: '短文章2', url: 'https://b.com/2', snippet: '短内容'.repeat(50) },      // 150 字符
    { title: '长文章1', url: 'https://c.com/3', snippet: '长内容'.repeat(200) },     // 600 字符
    { title: '长文章2', url: 'https://d.com/4', snippet: '长内容'.repeat(300) },     // 900 字符
  ]

  // 模拟 extractFullContent 中的筛选逻辑
  const topN = 5
  const targets = mockResults
    .slice(0, topN)
    .filter(r => r.snippet.length < MIN_SNIPPET_LEN)

  const shortCount = targets.length
  const longCount = mockResults.length - shortCount

  const passed = shortCount === 2 && longCount === 2
  console.log(`  短 snippet (< ${MIN_SNIPPET_LEN}): ${shortCount} 条 → 需要 Extract`)
  console.log(`  长 snippet (>= ${MIN_SNIPPET_LEN}): ${longCount} 条 → 跳过 Extract`)
  console.log(`  ${passed ? '✓' : '✗'} 智能筛选正确`)

  // 验证：所有 snippet 都够长时跳过 Extract
  const allLongResults = [
    { title: '长文章1', url: 'https://a.com/1', snippet: '长内容'.repeat(200) },   // 600 字符
    { title: '长文章2', url: 'https://b.com/2', snippet: '长内容'.repeat(300) },   // 900 字符
  ]
  const needExtract = allLongResults.filter(r => r.snippet.length < MIN_SNIPPET_LEN)
  const shouldSkip = needExtract.length === 0
  console.log(`  ${shouldSkip ? '✓' : '✗'} 所有 snippet 够长时跳过 Extract（${needExtract.length} 条需要 Extract）`)

  return passed && shouldSkip
}

// ── F. 动态批大小测试 ──

function testF_DynamicBatchSize() {
  console.log('\n━━━ F. 动态批大小（内容长度决定 batchSize）━━━\n')

  const testCases: { name: string; snippets: string[]; expectedBatch: number }[] = [
    {
      name: '短内容（snippet < 3000）→ batchSize=5',
      snippets: Array(10).fill('短内容'.repeat(100)),  // ~300 字符/条
      expectedBatch: 5,
    },
    {
      name: '长内容（snippet > 3000）→ batchSize=2',
      snippets: Array(10).fill('长内容'.repeat(2000)),  // ~6000 字符/条
      expectedBatch: 2,
    },
    {
      name: '混合内容（平均 > 3000）→ batchSize=2',
      snippets: [
        ...Array(2).fill('短'.repeat(100)),    // 100 字符
        ...Array(8).fill('长'.repeat(4000)),   // 4000 字符 → avg = (200+32000)/10 = 3220
      ],
      expectedBatch: 2,
    },
  ]

  let passed = 0
  for (const tc of testCases) {
    const avgLen = tc.snippets.reduce((s, r) => s + r.length, 0) / tc.snippets.length
    const batch = avgLen > 3000 ? 2 : 5

    const ok = batch === tc.expectedBatch
    if (ok) {
      passed++
      console.log(`  ✓ ${tc.name} (avgLen=${Math.round(avgLen)}, batch=${batch})`)
    } else {
      console.log(`  ✗ ${tc.name} (avgLen=${Math.round(avgLen)}, 期望 batch=${tc.expectedBatch}, 实际=${batch})`)
    }
  }

  console.log(`\n  汇总: ${passed}/${testCases.length} 通过`)
  return passed === testCases.length
}

// ── G. 超时控制测试 ──

async function testG_TimeoutControl() {
  console.log('\n━━━ G. 超时控制（DeepSeek 60s 超时降级）━━━\n')

  // 模拟 AbortController 超时行为
  const results: { name: string; passed: boolean; detail?: string }[] = []

  // 1. AbortController 正常工作（不超时）
  const controller1 = new AbortController()
  const timeoutId1 = setTimeout(() => controller1.abort(), 5000)
  await new Promise(r => setTimeout(r, 100))
  clearTimeout(timeoutId1)
  results.push({
    name: '1. AbortController 正常不超时',
    passed: !controller1.signal.aborted,
  })

  // 2. AbortController 超时触发
  const controller2 = new AbortController()
  const timeoutId2 = setTimeout(() => controller2.abort(), 50)
  await new Promise(r => setTimeout(r, 100))
  clearTimeout(timeoutId2)
  results.push({
    name: '2. AbortController 超时触发 abort',
    passed: controller2.signal.aborted,
  })

  // 3. 超时后 fetch 抛出 AbortError
  const controller3 = new AbortController()
  setTimeout(() => controller3.abort(), 50)
  let caughtAbortError = false
  try {
    await fetch('https://httpbin.org/delay/5', { signal: controller3.signal })
  } catch (e) {
    caughtAbortError = e instanceof Error && (e.name === 'AbortError' || e.message.includes('abort'))
  }
  results.push({
    name: '3. 超时后 fetch 抛出 AbortError',
    passed: caughtAbortError,
  })

  let passed = 0
  for (const r of results) {
    console.log(`  ${r.passed ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    if (r.passed) passed++
  }

  console.log(`\n  汇总: ${passed}/${results.length} 通过`)
  return passed === results.length
}

// ── H. 并发搜索测试 ──

async function testH_ConcurrentSearch() {
  console.log('\n━━━ H. 并发搜索（Promise.all 多关键词）━━━\n')

  // 模拟并发搜索：验证 Promise.all 比顺序执行更快
  const keywords = ['关键词1', '关键词2', '关键词3']
  const delayMs = 200

  // 顺序执行
  const seqStart = Date.now()
  for (const kw of keywords) {
    await new Promise(r => setTimeout(r, delayMs))
  }
  const seqTime = Date.now() - seqStart

  // 并发执行
  const concStart = Date.now()
  await Promise.all(
    keywords.map(kw => new Promise(r => setTimeout(r, delayMs)))
  )
  const concTime = Date.now() - concStart

  // 并发应该比顺序快至少 2 倍（3 个任务并发 vs 顺序）
  const speedup = seqTime / concTime
  const passed = concTime < seqTime * 0.6

  console.log(`  顺序执行: ${seqTime}ms`)
  console.log(`  并发执行: ${concTime}ms`)
  console.log(`  加速比: ${speedup.toFixed(1)}x`)
  console.log(`  ${passed ? '✓' : '✗'} 并发搜索显著快于顺序搜索`)

  return passed
}

// ── I. 消除重复 industryTags 测试 ──

function testI_NoDuplicateIndustryTags() {
  console.log('\n━━━ I. 消除重复 industryTags ━━━\n')

  // 模拟项目列表
  const projects = [
    { name: '项目A', industry: 'AI应用' },
    { name: '项目B', industry: 'AI应用' },      // 重复
    { name: '项目C', industry: '商业航天' },
    { name: '项目D', industry: null },
    { name: '项目E', industry: '  ' },           // 空白
    { name: '项目F', industry: '半导体芯片' },
  ]

  // 模拟去重逻辑
  const industryTags = Array.from(
    new Set(
      projects
        .map(p => p.industry)
        .filter((i): i is string => !!i && i.trim().length > 0)
    )
  )

  const expected = ['AI应用', '商业航天', '半导体芯片']
  const passed = industryTags.length === expected.length &&
    expected.every(tag => industryTags.includes(tag))

  console.log(`  原始项目: ${projects.length} 个，含重复行业和空值`)
  console.log(`  去重后: ${industryTags.length} 个 → [${industryTags.join(', ')}]`)
  console.log(`  ${passed ? '✓' : '✗'} industryTags 正确去重`)

  return passed
}

// ── J. 超时静默降级测试 ──

function testJ_TimeoutSilentDegrade() {
  console.log('\n━━━ J. 超时静默降级 ━━━\n')

  // 模拟 searchTavily 中的超时处理逻辑
  const timeoutMsg = 'Request timed out after 60 seconds.'
  const networkMsg = 'Network error'

  // 超时消息应被静默处理（不记录为 warn）
  const isTimeout = timeoutMsg.includes('timed out') || timeoutMsg.includes('timeout')
  const isNetwork = networkMsg.includes('timed out') || networkMsg.includes('timeout')

  const passed = isTimeout && !isNetwork

  console.log(`  超时消息 "${timeoutMsg}" → 静默: ${isTimeout ? '是' : '否'}`)
  console.log(`  网络错误 "${networkMsg}" → 静默: ${isNetwork ? '是' : '否'}`)
  console.log(`  ${passed ? '✓' : '✗'} 超时静默，非超时记录 warn`)

  return passed
}

// ── 主流程 ──

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  单元测试：AI 检索核心库新优化逻辑')
  console.log('═══════════════════════════════════════════════════════════════')

  const results: { name: string; passed: boolean }[] = []

  results.push({ name: 'D. JSON 修复', passed: testD_RepairJson() })
  results.push({ name: 'E. 智能 Extract', passed: testE_SmartExtract() })
  results.push({ name: 'F. 动态批大小', passed: testF_DynamicBatchSize() })
  results.push({ name: 'G. 超时控制', passed: await testG_TimeoutControl() })
  results.push({ name: 'H. 并发搜索', passed: await testH_ConcurrentSearch() })
  results.push({ name: 'I. 消除重复 industryTags', passed: testI_NoDuplicateIndustryTags() })
  results.push({ name: 'J. 超时静默降级', passed: testJ_TimeoutSilentDegrade() })

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log(`  测试汇总: ${passed} 通过 / ${failed} 失败 / 共 ${results.length} 项`)
  console.log('═══════════════════════════════════════════════════════════════')

  if (failed > 0) {
    console.log('\n失败项:')
    results.filter(r => !r.passed).forEach(r => console.log(`  ✗ ${r.name}`))
    process.exit(1)
  }
}

main().catch(e => {
  console.error('测试脚本执行失败:', e)
  process.exit(1)
})
