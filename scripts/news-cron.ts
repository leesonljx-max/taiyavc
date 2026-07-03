import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface NewsItem {
  title: string
  source: string
  url: string
  summary: string
  publishedAt: Date
}

interface AnalysisResult {
  type: 'OPPORTUNITY' | 'RISK' | 'NEUTRAL' | 'UNKNOWN'
  detail: string
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0',
]

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchProjectsWithKeywords(): Promise<{ id: string; keywords: string; name: string }[]> {
  const projects = await prisma.project.findMany({
    where: {
      keywords: {
        not: null,
      },
    },
    select: {
      id: true,
      keywords: true,
      name: true,
    },
  })

  return projects.filter(p => p.keywords && p.keywords.trim()) as { id: string; keywords: string; name: string }[]
}

async function searchWeChatArticles(keyword: string, maxResults: number = 5): Promise<NewsItem[]> {
  const results: NewsItem[] = []
  
  try {
    const encodedKeyword = encodeURIComponent(keyword)
    const url = `https://weixin.sogou.com/weixin?type=2&query=${encodedKeyword}&page=1`

    const response = await fetch(url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Referer': 'https://weixin.sogou.com/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })

    if (!response.ok) {
      console.warn(`搜索失败，状态码: ${response.status}`)
      return results
    }

    const html = await response.text()

    const articlePattern = /<div class="news-list">[\s\S]*?<\/div>/
    const match = html.match(articlePattern)
    if (!match) {
      console.warn(`未找到新闻列表，可能被反爬`)
      return results
    }

    const newsListHtml = match[0]

    const itemPattern = /<li>[\s\S]*?<\/li>/g
    const items = newsListHtml.match(itemPattern) || []

    for (const itemHtml of items.slice(0, maxResults)) {
      try {
        const titleMatch = itemHtml.match(/<h3.*?>([\s\S]*?)<\/h3>/)
        const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : ''

        const urlMatch = itemHtml.match(/<a\s+href="([^"]+)"/)
        const relativeUrl = urlMatch ? urlMatch[1] : ''
        const url = relativeUrl ? `https://weixin.sogou.com${relativeUrl}` : ''

        const sourceMatch = itemHtml.match(/<span class="s2">[\s\S]*?<a[^>]*>([^<]+)<\/a>/)
        const source = sourceMatch ? sourceMatch[1].trim() : ''

        const summaryMatch = itemHtml.match(/<p class="txt-info">([\s\S]*?)<\/p>/)
        const summary = summaryMatch ? summaryMatch[1].replace(/<[^>]*>/g, '').trim() : ''

        const timeMatch = itemHtml.match(/<span class="s3">([^<]+)<\/span>/)
        const timeStr = timeMatch ? timeMatch[1].trim() : ''

        let publishedAt = new Date()
        if (timeStr.includes('天前')) {
          const days = parseInt(timeStr) || 0
          publishedAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        } else if (timeStr.includes('小时前')) {
          const hours = parseInt(timeStr) || 0
          publishedAt = new Date(Date.now() - hours * 60 * 60 * 1000)
        } else if (timeStr.match(/\d{4}-\d{2}-\d{2}/)) {
          publishedAt = new Date(timeStr)
        }

        if (title && url) {
          results.push({ title, source, url, summary, publishedAt })
        }
      } catch (error) {
        console.warn(`解析新闻条目失败: ${error}`)
      }
    }
  } catch (error) {
    console.warn(`搜索微信文章失败: ${error}`)
  }

  return results
}

async function analyzeNews(news: NewsItem, projectName: string): Promise<AnalysisResult> {
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY
  if (!deepseekApiKey) {
    console.error('DeepSeek API Key 未配置')
    return { type: 'UNKNOWN', detail: 'API Key 未配置' }
  }

  const prompt = `你是一个资深的投资分析师。请根据以下新闻内容，分析对「${projectName}」这个项目来说，这是一个机会、风险还是中性信息。

新闻标题：${news.title}
新闻来源：${news.source || '未知'}
新闻摘要：${news.summary || '无'}
新闻链接：${news.url}

请按照以下 JSON 格式输出，不要包含任何其他文字：
{
  "type": "OPPORTUNITY",
  "detail": "分析理由"
}

type 可选值：OPPORTUNITY（机会）、RISK（风险）、NEUTRAL（中性）、UNKNOWN（无法判断）
detail 简要说明分析理由，不超过100字。`

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是一个专业的投资分析助手，擅长分析新闻对投资项目的影响。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'API 请求失败' }))
      console.error(`DeepSeek API 调用失败: ${errorData.message}`)
      return { type: 'UNKNOWN', detail: `API 调用失败: ${errorData.message}` }
    }

    const result = await response.json()
    const content = result.choices?.[0]?.message?.content

    if (!content) {
      return { type: 'UNKNOWN', detail: 'AI 返回数据为空' }
    }

    let analysis: { type: string; detail: string }
    try {
      analysis = JSON.parse(content)
    } catch {
      return { type: 'UNKNOWN', detail: 'AI 返回数据格式错误' }
    }

    const validTypes: AnalysisResult['type'][] = ['OPPORTUNITY', 'RISK', 'NEUTRAL', 'UNKNOWN']
    const type = validTypes.includes(analysis.type as AnalysisResult['type']) 
      ? analysis.type as AnalysisResult['type']
      : 'UNKNOWN'

    return { type, detail: analysis.detail || '无详细分析' }
  } catch (error) {
    console.error(`分析新闻失败: ${error}`)
    return { type: 'UNKNOWN', detail: `分析失败: ${error}` }
  }
}

async function saveNewsToDatabase(projectId: string, news: NewsItem, analysis: AnalysisResult): Promise<void> {
  try {
    await prisma.projectNews.create({
      data: {
        projectId,
        title: news.title,
        source: news.source,
        url: news.url,
        summary: news.summary,
        analysisType: analysis.type,
        analysisDetail: analysis.detail,
        publishedAt: news.publishedAt,
      },
    })
    console.log(`✓ 保存新闻: ${news.title}`)
  } catch (error: any) {
    if (error.code === 'P2002') {
      console.log(`✓ 新闻已存在，跳过: ${news.title}`)
    } else {
      console.error(`保存新闻失败: ${error}`)
    }
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('投资项目新闻监控脚本启动')
  console.log(new Date().toLocaleString('zh-CN'))
  console.log('='.repeat(60))

  try {
    const projects = await fetchProjectsWithKeywords()
    console.log(`\n找到 ${projects.length} 个有关键词的项目`)

    for (const project of projects) {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      console.log(`项目: ${project.name}`)
      console.log(`关键词: ${project.keywords}`)
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

      const keywords = project.keywords!.split(/[,，、\s]+/).filter(k => k.trim())
      
      for (const keyword of keywords) {
        console.log(`\n🔍 搜索关键词: ${keyword}`)
        
        const newsItems = await searchWeChatArticles(keyword)
        console.log(`找到 ${newsItems.length} 篇相关文章`)

        for (const news of newsItems) {
          console.log(`\n📰 标题: ${news.title}`)
          console.log(`来源: ${news.source}`)
          console.log(`发布时间: ${news.publishedAt.toLocaleDateString('zh-CN')}`)

          const analysis = await analyzeNews(news, project.name)
          console.log(`📊 分析结果: ${analysis.type}`)
          console.log(`💬 分析详情: ${analysis.detail}`)

          await saveNewsToDatabase(project.id, news, analysis)
          
          await delay(1000)
        }

        await delay(2000)
      }
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log('新闻监控脚本执行完成')
    console.log(new Date().toLocaleString('zh-CN'))
    console.log('='.repeat(60))
  } catch (error) {
    console.error(`脚本执行失败: ${error}`)
  } finally {
    await prisma.$disconnect()
  }
}

main()