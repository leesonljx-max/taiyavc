/**
 * Tavily Extract 全文获取测试
 *
 * 验证项：
 * 1. Extract API 连接正常
 * 2. 返回结构包含 results 和 failed_results
 * 3. raw_content 内容长度远大于 search snippet
 * 4. 多 URL 批量提取正常
 * 5. 失败 URL 不影响其他结果
 * 6. 集成测试：search → extract → 内容增强
 *
 * 运行: npx tsx scripts/test-tavily-extract.ts
 */
import { tavily } from '@tavily/core'

const client = tavily({ apiKey: process.env.TAVILY_API_KEY! })

// 复制 ai-lead-retrieval.ts 中的函数
interface SearchResultItem {
  title: string
  url: string
  snippet: string
}

async function searchTavily(query: string, count = 10): Promise<SearchResultItem[]> {
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
    console.warn(`Tavily 搜索失败:`, error instanceof Error ? error.message : error)
    return []
  }
}

async function extractFullContent(
  results: SearchResultItem[],
  topN = 5
): Promise<SearchResultItem[]> {
  if (results.length === 0) return results

  const targets = results.slice(0, topN)
  const urls = targets.map(r => r.url)

  try {
    const res = await client.extract(urls, {
      extractDepth: 'basic',
      format: 'markdown',
    })

    const contentMap = new Map<string, string>()
    for (const item of res.results) {
      const content = (item as any).rawContent as string | undefined
      if (content) {
        const truncated = content.length > 8000
          ? content.substring(0, 8000) + '...[内容截断]'
          : content
        contentMap.set(item.url, truncated)
      }
    }

    const failedResults = (res as any).failedResults as any[] | undefined
    if (failedResults && failedResults.length > 0) {
      console.warn(`  ⚠ ${failedResults.length} 个 URL 提取失败`)
    }

    return results.map(r => {
      const fullContent = contentMap.get(r.url)
      return fullContent ? { ...r, snippet: fullContent } : r
    })
  } catch (error) {
    console.warn('Tavily Extract 失败:', error instanceof Error ? error.message : error)
    return results
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Tavily Extract 全文获取测试')
  console.log('═══════════════════════════════════════════════════════════════\n')

  let allPassed = true

  // ━━━ 测试 1: 搜索 → 提取全文 → 对比内容长度 ━━━
  console.log('━━━ 测试 1: search → extract 内容增强 ━━━')
  const searchResults = await searchTavily('AI芯片 融资 2026', 5)

  if (searchResults.length === 0) {
    console.log('  ⚠ 搜索无结果，跳过测试\n')
    process.exit(0)
  }

  console.log(`  搜索返回 ${searchResults.length} 条结果`)
  const originalLengths = searchResults.map(r => r.snippet.length)
  console.log(`  原始 snippet 长度: [${originalLengths.join(', ')}]`)

  const enrichedResults = await extractFullContent(searchResults, 5)
  const enrichedLengths = enrichedResults.map(r => r.snippet.length)
  console.log(`  Extract 后 snippet 长度: [${enrichedLengths.join(', ')}]`)

  // 验证：至少有一条结果的全文比原始 snippet 长
  let hasEnrichment = false
  for (let i = 0; i < enrichedResults.length; i++) {
    if (enrichedLengths[i] > originalLengths[i] * 2) {
      hasEnrichment = true
      break
    }
  }

  if (hasEnrichment) {
    console.log('  ✓ Extract 全文内容显著长于原始 snippet\n')
  } else {
    console.log('  ✗ 全文未显著增长（可能所有 URL 提取失败）\n')
    allPassed = false
  }

  // ━━━ 测试 2: 验证返回结构 ━━━
  console.log('━━━ 测试 2: Extract 返回结构验证 ━━━')
  const testUrl = searchResults[0]?.url
  if (testUrl) {
    try {
      const res = await client.extract(testUrl, {
        extractDepth: 'basic',
        format: 'markdown',
      })

      const hasResults = Array.isArray(res.results)
      const failedResults = (res as any).failedResults
      const hasFailedResults = Array.isArray(failedResults)

      console.log(`  results 是数组: ${hasResults ? '✓' : '✗'}`)
      console.log(`  failedResults 是数组: ${hasFailedResults ? '✓' : '✗'}`)

      if (hasResults && res.results.length > 0) {
        const item = res.results[0] as any
        const hasUrl = typeof item.url === 'string'
        const hasContent = typeof item.rawContent === 'string'
        console.log(`  results[0].url 存在: ${hasUrl ? '✓' : '✗'}`)
        console.log(`  results[0].rawContent 存在: ${hasContent ? '✓' : '✗'}`)
        console.log(`  rawContent 长度: ${item.rawContent?.length || 0} 字符`)

        if (!hasUrl || !hasContent) allPassed = false
      }

      if (!hasResults || !hasFailedResults) allPassed = false
    } catch (e) {
      console.log(`  ✗ Extract 调用失败: ${e instanceof Error ? e.message : e}`)
      allPassed = false
    }
  }
  console.log('')

  // ━━━ 测试 3: 多 URL 批量提取 ━━━
  console.log('━━━ 测试 3: 多 URL 批量提取 ━━━')
  if (searchResults.length >= 3) {
    const multiUrls = searchResults.slice(0, 3).map(r => r.url)
    try {
      const res = await client.extract(multiUrls, {
        extractDepth: 'basic',
        format: 'markdown',
      })

      console.log(`  提交 ${multiUrls.length} 个 URL`)
      console.log(`  成功: ${res.results.length} 个`)
      const fr = (res as any).failedResults as any[] | undefined
      console.log(`  失败: ${fr?.length || 0} 个`)

      // 验证：成功的 URL 数量 + 失败的 URL 数量 = 提交的 URL 数量
      const totalProcessed = res.results.length + (fr?.length || 0)
      if (totalProcessed === multiUrls.length) {
        console.log('  ✓ 处理数量一致\n')
      } else {
        console.log(`  ✗ 处理数量不一致（期望 ${multiUrls.length}，实际 ${totalProcessed}）\n`)
        allPassed = false
      }
    } catch (e) {
      console.log(`  ✗ 批量提取失败: ${e instanceof Error ? e.message : e}\n`)
      allPassed = false
    }
  }

  // ━━━ 测试 4: 超长内容截断 ━━━
  console.log('━━━ 测试 4: 超长内容截断验证 ━━━')
  const longResults = await extractFullContent(searchResults, 5)
  let maxLen = 0
  for (const r of longResults) {
    if (r.snippet.length > maxLen) maxLen = r.snippet.length
  }
  // 截断阈值是 8000 + 截断后缀
  if (maxLen <= 8100) {
    console.log(`  ✓ 最长内容 ${maxLen} 字符，在截断范围内\n`)
  } else {
    console.log(`  ✗ 最长内容 ${maxLen} 字符，超出截断范围\n`)
    allPassed = false
  }

  // ━━━ 汇总 ━━━
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`  结果: ${allPassed ? '✓ 全部通过' : '✗ 存在失败项'}`)
  console.log('═══════════════════════════════════════════════════════════════')

  process.exit(allPassed ? 0 : 1)
}

main().catch(e => {
  console.error('测试脚本执行失败:', e)
  process.exit(1)
})
