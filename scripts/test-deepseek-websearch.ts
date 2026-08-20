/**
 * DeepSeek web_search（官方托管搜索服务）验证脚本
 *
 * 验证目标：
 * 1. web_search 工具是否可用（Responses API，服务端执行）
 * 2. 计费方式：搜索消耗计入 API token 用量（usage 字段可验证）
 * 3. 搜索结果是否实时（用"最近一周的融资新闻"等时效性问题验证）
 *
 * 运行：npx tsx scripts/test-deepseek-websearch.ts
 */

import * as dotenv from 'dotenv'
dotenv.config()

const API_KEY = process.env.DEEPSEEK_API_KEY
const URL = 'https://api.deepseek.com/v1/responses'

if (!API_KEY) {
  console.error('错误：未配置 DEEPSEEK_API_KEY')
  process.exit(1)
}

// 当前日期（用于构造"实时性"问题）
const now = new Date()
const today = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })

async function callWebSearch(question: string, label: string) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`【${label}】`)
  console.log(`提问：${question}`)
  console.log('─'.repeat(60))

  const body = {
    model: 'deepseek-v4-flash',
    instructions: '你是一个严谨的研究助理，必须使用 web_search 工具搜索后再回答。',
    input: question,
    tools: [{ type: 'web_search' }],
    tool_choice: 'auto',
    stream: false,
  }

  const start = Date.now()
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.log(`❌ 调用失败：HTTP ${res.status}`)
    console.log(errText.substring(0, 500))
    return
  }

  const data = await res.json()
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  // ── 检查 web_search_call 输出项（证明服务端搜索真的执行了） ──
  const outputItems = (data.output || []) as Array<Record<string, unknown>>
  const searchCalls = outputItems.filter(i => i.type === 'web_search_call')
  const messages = outputItems.filter(i => i.type === 'message')

  console.log(`耗时：${elapsed}s | 响应状态：${data.status}`)
  console.log(`web_search_call 数量：${searchCalls.length}`)
  searchCalls.forEach((c, i) => {
    console.log(`  [搜索${i + 1}] action=${JSON.stringify((c as { action?: unknown }).action || {}).substring(0, 150)}`)
  })

  // ── usage（验证计费含在 API 里：搜索+摘要产生的 token 都计入） ──
  const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined
  if (usage) {
    console.log(`token 用量：input=${usage.input_tokens}, output=${usage.output_tokens}（搜索内容计入 input，摘要计入 output）`)
  }

  // ── 最终回答 ──
  let answer = ''
  for (const m of messages) {
    const content = (m as { content?: Array<{ text?: string }> }).content
    if (Array.isArray(content)) {
      answer += content.map(c => c.text || '').join('\n')
    }
  }
  console.log('─'.repeat(60))
  console.log('回答（前 1200 字符）：')
  console.log(answer.substring(0, 1200))
  return answer
}

async function main() {
  console.log('DeepSeek web_search 官方托管搜索服务验证')
  console.log(`当前本机日期：${today}`)

  // ── 测试1：实时性核心验证 —— 问"今天的日期和最新新闻" ──
  // 如果模型不知道今天日期（训练截止早于现在），它必须靠搜索才能给出近期信息
  const ans1 = await callWebSearch(
    '请联网搜索：今天（以你搜索到的最新信息为准）是什么日期？最近3天内中国一级市场（VC/PE）有哪些融资新闻？请给出新闻标题、日期和来源。',
    '测试1：实时性验证（最近3天融资新闻）'
  )

  // ── 测试2：垂直领域时效信息 ──
  const ans2 = await callWebSearch(
    '请联网搜索最近一周内（2026年8月中旬）脑机接口或医疗器械行业的融资新闻，列出具体公司名、金额、日期、投资方和来源链接。',
    '测试2：行业垂直搜索（脑机接口/医疗器械融资）'
  )

  // ── 实时性判定 ──
  console.log(`\n${'═'.repeat(60)}`)
  console.log('【实时性判定】')
  const combined = (ans1 || '') + (ans2 || '')
  // 检查回答中是否包含近期日期特征（2026年8月）
  const hasRecentDate = /2026\s*年\s*8\s*月|8\s*月\s*1[0-9]\s*日|8\s*月\s*[1-9]\s*日/.test(combined)
  console.log(`回答中包含 2026年8月 近期日期：${hasRecentDate ? '✅ 是（说明拿到的是当前时间线的信息）' : '❌ 否（可能是过时信息或未搜索到）'}`)

  const todayMonth = now.getMonth() + 1
  console.log(`\n结论：本机时间为 2026年${todayMonth}月，若模型能返回 2026年8月的具体新闻，即证明 web_search 返回实时信息。`)
}

main().catch(e => {
  console.error('脚本执行失败:', e)
  process.exit(1)
})
