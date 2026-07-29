/**
 * Cron 任务通用授权工具
 *
 * 通过 CRON_SECRET 环境变量校验，避免外部随意触发定时任务
 */

import { NextResponse } from 'next/server'

/**
 * 校验 cron 请求的 token
 * - 优先从 query 参数 token 读取
 * - 其次从 Authorization: Bearer XXX 读取
 */
export function authorizeCronRequest(request: Request): boolean {
  const token = process.env.CRON_SECRET
  if (!token) {
    return false
  }

  const url = new URL(request.url)
  const queryToken = url.searchParams.get('token')
  if (queryToken === token) return true

  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${token}`) return true

  return false
}

/**
 * 返回 401 未授权响应
 */
export function unauthorizedResponse() {
  return NextResponse.json({ error: '未授权' }, { status: 401 })
}
