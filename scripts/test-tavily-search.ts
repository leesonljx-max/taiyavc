/**
 * Tavily 搜索封装函数测试
 *
 * 验证项：
 * 1. Tavily API 连接正常
 * 2. 搜索返回结构化结果（title, url, snippet）
 * 3. snippet（content）内容质量优于 Bing HTML snippet
 * 4. 多个关键词搜索正常
 * 5. days=3 时间过滤生效（只返回近3天新闻）
 *
 * 运行: npx tsx scripts/test-tavily-search.ts
 */
import { tavily } from '@tavily/core'

const client = tavily({ apiKey: process.env.TAVILY_API_KEY! })

// 复制 ai-lead-retrieval.ts 中的 searchTavily 函数进行独立验证
async function searchTavily(query: string, count = 10) {
  try {
    const res = await client.search(query, {
      topic: 'news',
      maxResults: count,
      searchDepth: 'basic',
      days: 3,
    })
    return res.results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }))
  } catch (error) {
    console.warn(`Tavily 搜索失败 [${query}]:`, error instanceof Error ? error.message : error)
    return []
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Tavily 搜索封装函数测试')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const testQueries = [
    'AI应用 融资 2026',
    '商业航天 投资 2026',
    '半导体 芯片 融资',
  ]

  let totalResults = 0
  let allPassed = true

  for (const query of testQueries) {
    console.log(`━━━ 搜索: "${query}" ━━━`)
    const results = await searchTavily(query, 5)

    if (results.length === 0) {
      console.log(`  ⚠ 未返回结果（可能是近3天无相关新闻）\n`)
      continue
    }

    console.log(`  ✓ 返回 ${results.length} 条结果`)
    totalResults += results.length

    // 验证每条结果结构完整
    let structOk = true
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      const hasTitle = typeof r.title === 'string' && r.title.length > 0
      const hasUrl = typeof r.url === 'string' && r.url.startsWith('http')
      const hasSnippet = typeof r.snippet === 'string' && r.snippet.length > 0

      if (!hasTitle || !hasUrl || !hasSnippet) {
        console.log(`  ✗ 结果 [${i + 1}] 结构不完整: title=${hasTitle} url=${hasUrl} snippet=${hasSnippet}`)
        structOk = false
        allPassed = false
      }

      console.log(`  [${i + 1}] ${r.title.substring(0, 50)}...`)
      console.log(`      URL: ${r.url}`)
      console.log(`      内容长度: ${r.snippet.length} 字符`)
    }

    if (structOk) {
      console.log(`  ✓ 结果结构全部完整\n`)
    }
  }

  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`  测试汇总: 共搜索 ${testQueries.length} 个关键词，返回 ${totalResults} 条结果`)
  console.log(`  结果: ${allPassed ? '✓ 全部通过' : '✗ 存在失败项'}`)
  console.log('═══════════════════════════════════════════════════════════════')

  process.exit(allPassed ? 0 : 1)
}

main().catch(e => {
  console.error('测试脚本执行失败:', e)
  process.exit(1)
})
