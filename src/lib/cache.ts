/**
 * 轻量级前端内存缓存
 *
 * 设计目标：
 * 1. 切换页面时瞬时显示缓存数据（无需 loading）
 * 2. 后台静默刷新，数据自动保持新鲜
 * 3. 窗口获焦时自动刷新（用户切回标签页时更新）
 * 4. 数据变更后可手动失效缓存
 * 5. 无需额外依赖（不引入 SWR/React Query）
 *
 * 缓存策略：
 * - staleTime: 30 秒内不重复请求（数据"新鲜"）
 * - focusRefresh: 窗口获焦时若数据已过期则静默刷新
 * - invalidate: 数据变更后手动清除缓存
 */

interface CacheEntry<T> {
  data: T
  timestamp: number
  promise?: Promise<T>  // 进行中的请求（去重）
}

// 内存缓存存储
const cacheStore = new Map<string, CacheEntry<any>>()

// 订阅者列表（组件订阅缓存变化）
const subscribers = new Map<string, Set<() => void>>()

// 默认 staleTime：30 秒内认为数据是新鲜的
const DEFAULT_STALE_TIME = 30 * 1000

/**
 * 获取缓存数据（同步，可能为 null）
 */
export function getCachedData<T>(key: string): T | null {
  const entry = cacheStore.get(key)
  if (!entry) return null
  return entry.data as T
}

/**
 * 获取缓存时间戳（用于判断是否需要 loading）
 */
export function getCacheTimestamp(key: string): number | null {
  const entry = cacheStore.get(key)
  return entry ? entry.timestamp : null
}

/**
 * 订阅缓存变化（返回取消订阅函数）
 */
export function subscribeCache(key: string, callback: () => void): () => void {
  if (!subscribers.has(key)) {
    subscribers.set(key, new Set())
  }
  subscribers.get(key)!.add(callback)
  return () => {
    subscribers.get(key)?.delete(callback)
  }
}

/**
 * 通知所有订阅者缓存已更新
 */
function notifySubscribers(key: string) {
  subscribers.get(key)?.forEach(cb => cb())
}

/**
 * fetcher 函数类型
 */
type Fetcher<T> = () => Promise<T>

/**
 * 获取数据（带缓存 + 请求去重）
 * - 如果缓存新鲜（< staleTime），直接返回缓存
 * - 如果缓存过期，返回缓存数据但后台静默刷新
 * - 如果无缓存，发起请求
 *
 * @param key 缓存键
 * @param fetcher 数据获取函数
 * @param staleTime 数据新鲜期（毫秒），默认 30 秒
 * @returns 最新数据
 */
export async function fetchWithCache<T>(
  key: string,
  fetcher: Fetcher<T>,
  staleTime: number = DEFAULT_STALE_TIME
): Promise<T> {
  const now = Date.now()
  const entry = cacheStore.get(key)

  // 1. 缓存存在且新鲜 → 直接返回
  if (entry && now - entry.timestamp < staleTime) {
    return entry.data
  }

  // 2. 缓存存在但过期 → 后台静默刷新，先返回旧数据
  if (entry && entry.data !== undefined) {
    // 如果已有进行中的请求，等待它
    if (entry.promise) {
      return entry.promise
    }
    // 后台静默刷新（不阻塞）
    entry.promise = fetcher()
      .then(data => {
        cacheStore.set(key, { data, timestamp: Date.now() })
        notifySubscribers(key)
        return data
      })
      .catch(err => {
        // 刷新失败保留旧数据，不影响用户
        console.error(`[cache] 后台刷新失败 ${key}:`, err)
        return entry.data
      })
      .finally(() => {
        if (entry) entry.promise = undefined
      })
    return entry.data
  }

  // 3. 无缓存 → 发起请求（首次加载）
  if (entry?.promise) {
    return entry.promise
  }

  const promise = fetcher()
    .then(data => {
      cacheStore.set(key, { data, timestamp: Date.now() })
      notifySubscribers(key)
      return data
    })
    .finally(() => {
      if (entry) entry.promise = undefined
    })

  // 暂存 promise 防止重复请求
  cacheStore.set(key, { data: null as any, timestamp: 0, promise })
  return promise
}

/**
 * 失效缓存（数据变更后调用）
 * 支持通配符匹配，例如 invalidateCache('projects:*') 失效所有 projects 开头的缓存
 *
 * @param key 缓存键，支持通配符 * 结尾
 */
export function invalidateCache(key: string) {
  if (key.endsWith('*')) {
    // 通配符匹配：失效所有匹配的缓存
    const prefix = key.slice(0, -1)
    for (const k of cacheStore.keys()) {
      if (k.startsWith(prefix)) {
        cacheStore.delete(k)
        notifySubscribers(k)
      }
    }
  } else {
    // 精确匹配
    if (cacheStore.has(key)) {
      cacheStore.delete(key)
      notifySubscribers(key)
    }
  }
}

/**
 * 预加载数据（在页面加载前预热缓存）
 * 例如在 Layout 中预加载下一页数据
 */
export async function prefetchCache<T>(
  key: string,
  fetcher: Fetcher<T>,
  staleTime: number = DEFAULT_STALE_TIME
): Promise<void> {
  await fetchWithCache(key, fetcher, staleTime)
}

/**
 * 是否需要显示 loading（无缓存时）
 */
export function shouldShowLoading(key: string, staleTime: number = DEFAULT_STALE_TIME): boolean {
  const entry = cacheStore.get(key)
  if (!entry) return true
  // 有缓存数据（即使是过期的），不显示 loading
  return false
}

/**
 * 设置窗口获焦时自动刷新
 * 在组件中调用，返回清理函数
 *
 * @param keys 需要刷新的缓存键列表
 * @param fetchers 对应的 fetcher 函数列表
 * @param staleTime 数据新鲜期
 */
export function setupFocusRefresh<T>(
  keys: string[],
  fetchers: Fetcher<T>[],
  staleTime: number = DEFAULT_STALE_TIME
): () => void {
  let isRefreshing = false

  const handleFocus = async () => {
    if (isRefreshing) return
    isRefreshing = true

    const now = Date.now()
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const entry = cacheStore.get(key)
      // 仅在数据过期时刷新
      if (!entry || now - entry.timestamp >= staleTime) {
        try {
          await fetchWithCache(key, fetchers[i], staleTime)
        } catch {
          // 忽略刷新错误
        }
      }
    }
    isRefreshing = false
  }

  window.addEventListener('focus', handleFocus)
  return () => window.removeEventListener('focus', handleFocus)
}
