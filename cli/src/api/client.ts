/**
 * API 客户端 —— 对接主项目 Next.js API
 *
 * 认证方式：复用 NextAuth 凭据登录（与网页端同一套账号体系）
 * 流程：
 *   1. GET  /api/auth/csrf                        → 拿 csrfToken
 *   2. POST /api/auth/callback/credentials        → 换 session cookie
 *   3. 之后所有请求携带 Cookie 头
 */

import { readConfig } from '../config.js'
import type { SessionUser } from '../types.js'

/** 业务错误（含状态码与后端错误消息） */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

/** 未登录/会话过期错误 */
export class AuthError extends Error {
  constructor() {
    super('登录已过期，请先运行 investrask login')
    this.name = 'AuthError'
  }
}

// ── cookie 解析工具 ──

/** 从 Set-Cookie 头数组中提取指定 cookie 的值 */
export function extractCookie(setCookies: string[], name: string): string | null {
  for (const raw of setCookies) {
    // 形如 "next-auth.session-token=xxx; Path=/; HttpOnly"
    const prefix = `${name}=`
    const idx = raw.indexOf(prefix)
    if (idx === -1) continue
    const valuePart = raw.slice(idx + prefix.length)
    const endIdx = valuePart.indexOf(';')
    const value = endIdx === -1 ? valuePart : valuePart.slice(0, endIdx)
    if (value) return decodeURIComponent(value)
  }
  return null
}

// ── 登录流程 ──

export interface LoginResult {
  sessionToken: string
  csrfToken: string
  user: SessionUser
}

/**
 * NextAuth 凭据登录（支持账户名或邮箱，与网页端一致）
 * @throws ApiError 登录失败（含具体原因：密码错误/待审批/被禁用等）
 */
export async function login(server: string, username: string, password: string): Promise<LoginResult> {
  // 1. 获取 csrfToken
  const csrfRes = await fetch(`${server}/api/auth/csrf`, {
    headers: { Accept: 'application/json' },
  })
  if (!csrfRes.ok) {
    throw new ApiError(csrfRes.status, `无法连接服务器（${csrfRes.status}），请检查地址：${server}`)
  }
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }
  const csrfCookie = extractCookie(csrfRes.headers.getSetCookie?.() ?? [], 'next-auth.csrf-token')

  // 2. 凭据登录（form-encoded，与 NextAuth 网页端流程一致）
  const body = new URLSearchParams({
    csrfToken,
    email: username,
    password,
    callbackUrl: `${server}/auth/login`,
    json: 'true',
  })
  const loginRes = await fetch(`${server}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...(csrfCookie ? { Cookie: `next-auth.csrf-token=${encodeURIComponent(csrfCookie)}` } : {}),
    },
    body: body.toString(),
    redirect: 'manual',
  })

  const setCookies = loginRes.headers.getSetCookie?.() ?? []
  const sessionToken = extractCookie(setCookies, 'next-auth.session-token')

  if (!sessionToken) {
    // 登录失败：从响应中提取错误原因
    let reason = '账户名或密码错误'
    try {
      const data = (await loginRes.json()) as { url?: string; error?: string }
      const errUrl = data.url || data.error || ''
      const match = errUrl.match(/[?&]error=([^&]+)/)
      if (match) {
        const decoded = decodeURIComponent(match[1])
        if (decoded === 'CredentialsSignin') {
          reason = '账户名或密码错误'
        } else {
          reason = decoded
        }
      }
    } catch {
      // 响应非 JSON，保持默认提示
    }
    throw new ApiError(401, reason)
  }

  // 3. 拉取会话信息验证登录成功
  const sessionRes = await fetch(`${server}/api/auth/session`, {
    headers: {
      Accept: 'application/json',
      Cookie: `next-auth.session-token=${encodeURIComponent(sessionToken)}`,
    },
  })
  const session = (await sessionRes.json()) as { user?: SessionUser }
  if (!session?.user?.id) {
    throw new ApiError(401, '登录失败：无法获取会话信息')
  }

  return { sessionToken, csrfToken: csrfCookie ?? csrfToken, user: session.user }
}

/** 登出（调用 NextAuth signout 清除服务端会话） */
export async function logout(server: string, sessionToken: string): Promise<void> {
  try {
    await fetch(`${server}/api/auth/signout`, { method: 'POST' }).catch(() => undefined)
  } catch {
    // 登出接口失败不影响本地清除
  }
}

// ── 业务请求封装 ──

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
}

/** 携带会话发起 API 请求；401 时抛 AuthError */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const cfg = readConfig()
  if (!cfg || !cfg.sessionToken) {
    throw new AuthError()
  }

  const url = path.startsWith('http') ? path : `${cfg.server}${path}`
  let res: Response
  try {
    res = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Cookie: `next-auth.session-token=${encodeURIComponent(cfg.sessionToken)}`,
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    })
  } catch (err) {
    throw new ApiError(0, `网络错误，无法连接服务器：${cfg.server}（${err instanceof Error ? err.message : String(err)}）`)
  }

  if (res.status === 401) {
    throw new AuthError()
  }

  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new ApiError(res.status, `服务器返回异常（${res.status}）`)
  }

  if (!res.ok) {
    const errMsg = (data as { error?: string }).error ?? `请求失败（${res.status}）`
    throw new ApiError(res.status, errMsg)
  }

  return data as T
}
