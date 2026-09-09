/**
 * 测试基础设施（必须在测试文件的第一个 import）
 *
 * 职责（在被测模块加载前全部就位）：
 * 1. 加载 .env 并将 DATABASE_URL 指向独立测试库 investrack_test（与开发库隔离）
 * 2. 预填 require.cache 拦截 '@/lib/tavily-search'：
 *    @tavily/core 走 axios + http 模块，mock 全局 fetch 拦不住，
 *    所以直接在模块解析层替换 searchWebDual（真实 Tavily 零调用）
 * 3. 预填 require.cache 拦截 'next-auth'（getServerSession）与 '@/lib/auth'（authOptions）
 * 4. mock 全局 fetch（拦截 DeepSeek chat/completions，按可编程 handler 分发）
 *
 * 注意：项目无 "type": "module"，tsx 将测试文件按 CJS 编译，
 * import 语句按物理顺序转为 require()，因此本文件的顶层注入先于被测模块加载。
 */
import 'dotenv/config'

// ── 1. 测试库隔离（必须在 import prisma 前设置） ──
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://leeson@localhost:5432/investrack_test'
if (!process.env.DEEPSEEK_API_KEY) process.env.DEEPSEEK_API_KEY = 'test-deepseek-key'
if (!process.env.TAVILY_API_KEY) process.env.TAVILY_API_KEY = 'test-tavily-key'

// ── mock 状态注册表 ──

export interface MockSearchResult {
  title: string
  url: string
  content: string
}

export interface RecordedSearch {
  query: string
  options: Record<string, unknown>
}

export interface RecordedFetch {
  url: string
  body: Record<string, unknown>
}

export interface MockSession {
  user: { id: string; name?: string | null; email: string; role: string }
}

export const mockState = {
  /** searchWebDual 调用记录（断言调用次数/参数用） */
  searchCalls: [] as RecordedSearch[],
  /** searchWebDual 可编程返回：query → 结果数组 */
  searchResponses: new Map<string, MockSearchResult[]>(),
  /** searchWebDual 未命中 searchResponses 时的默认返回 */
  searchDefault: [] as MockSearchResult[],
  /** 全局 fetch 调用记录 */
  fetchCalls: [] as RecordedFetch[],
  /** fetch 可编程 handler：返回 JSON 数据；null 时返回空 chat 响应 */
  fetchHandler: null as null | ((url: string, body: Record<string, unknown>) => unknown),
  /** getServerSession mock 返回值（API 路由测试用） */
  session: null as null | MockSession,
}

/** 每个 test 前清空调用记录与可编程返回 */
export function resetMocks(): void {
  mockState.searchCalls = []
  mockState.searchResponses.clear()
  mockState.searchDefault = []
  mockState.fetchCalls = []
  mockState.fetchHandler = null
  mockState.session = null
}

/** DeepSeek chat/completions 成功响应体 */
export function chatCompletions(content: string): Record<string, unknown> {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  }
}

/** 快捷构造搜索结果 */
export function searchResult(title: string, url: string, content = '示例内容'): MockSearchResult {
  return { title, url, content }
}

// ── 2. require.cache 注入（模块级 mock） ──

function injectCache(path: string, exports: unknown): void {
  require.cache[path] = {
    id: path,
    filename: path,
    loaded: true,
    exports,
  } as unknown as NodeModule
}

// 拦截 '@/lib/tavily-search'：searchWebDual 记录调用并返回可编程结果
injectCache(require.resolve('@/lib/tavily-search'), {
  searchWebDual: async (query: string, options?: unknown): Promise<MockSearchResult[]> => {
    mockState.searchCalls.push({ query, options: (options || {}) as Record<string, unknown> })
    return mockState.searchResponses.get(query) ?? mockState.searchDefault
  },
  searchWeb: async (): Promise<MockSearchResult[]> => [],
})

// 拦截 'next-auth'：getServerSession 返回可编程 session
injectCache(require.resolve('next-auth'), {
  getServerSession: async (): Promise<MockSession | null> => mockState.session,
})

// 拦截 '@/lib/auth'：authOptions 提供空对象（真实模块会拉 bcryptjs 等重依赖）
injectCache(require.resolve('@/lib/auth'), { authOptions: {} })

// ── 3. 全局 fetch mock（拦截 DeepSeek 调用） ──

const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  let body: Record<string, unknown> = {}
  if (typeof init?.body === 'string') {
    try {
      body = JSON.parse(init.body)
    } catch {
      body = { raw: init.body }
    }
  }
  mockState.fetchCalls.push({ url, body })

  const data = mockState.fetchHandler
    ? mockState.fetchHandler(url, body)
    : chatCompletions('{}')

  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response
}

globalThis.fetch = mockFetch as typeof fetch
