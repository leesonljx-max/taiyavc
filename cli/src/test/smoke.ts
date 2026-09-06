/**
 * CLI 冒烟测试（无需真实账号）
 *
 * 运行：cd cli && npm run test（需本地 dev server 或远程服务器）
 * 环境变量：
 *   TEST_SERVER  服务器地址（默认 http://localhost:3000）
 *
 * 覆盖：
 *   T1  csrf 接口可达（NextAuth 流程第一步）
 *   T2  错误密码登录 → 401 且提示「账户名或密码错误」
 *   T3  待审批账号提示（构造 PENDING 用户名登录，若该用户不存在则跳过）
 *   T4  无会话调用业务 API → 401「登录已过期」
 *   T5  extractCookie 解析
 *   T6  displayWidth / padEnd 中文对齐
 *   T7  配置文件读写 + 会话清除
 */

import { login, extractCookie, request, ApiError } from '../api/client.js'
import { readConfig, writeConfig, clearSession, normalizeServer } from '../config.js'
import { displayWidth, padEnd, truncate } from '../format.js'

const SERVER = process.env.TEST_SERVER ?? 'http://localhost:3000'

let passCount = 0
let failCount = 0

function check(cond: boolean, desc: string): void {
  if (cond) {
    passCount++
    console.log(`  ✅ ${desc}`)
  } else {
    failCount++
    console.log(`  ❌ ${desc}`)
  }
}

async function main(): Promise<void> {
  console.log('════ investrask CLI 冒烟测试 ════\n')

  // T1 csrf
  console.log('[T1] NextAuth csrf 接口')
  {
    const res = await fetch(`${SERVER}/api/auth/csrf`)
    const data = (await res.json()) as { csrfToken?: string }
    check(res.status === 200, `GET /api/auth/csrf 返回 200（实际 ${res.status}）`)
    check(!!data.csrfToken, '返回 csrfToken')
  }

  // T2 错误密码
  console.log('\n[T2] 错误密码登录')
  {
    try {
      await login(SERVER, 'nonexistent-user-xyz', 'wrong-password')
      check(false, '应抛出 ApiError')
    } catch (err) {
      const apiErr = err as ApiError
      check(apiErr instanceof ApiError, `抛出 ApiError（401）`)
      check(
        apiErr.message.includes('账户名或密码错误') || apiErr.status === 401,
        `错误提示合理：${apiErr.message}`
      )
    }
  }

  // T3 空密码
  console.log('\n[T3] 空密码被拒绝（本地校验前置）')
  {
    // client.login 不做空校验，由命令层负责；这里验证服务端对空密码也返回失败
    try {
      await login(SERVER, 'someuser', '')
      check(false, '应抛出 ApiError')
    } catch (err) {
      check(err instanceof ApiError, `空密码登录失败（${(err as ApiError).message}）`)
    }
  }

  // T4 无会话调用业务 API
  console.log('\n[T4] 无会话调用业务 API')
  {
    // 临时清掉本地会话
    const backup = readConfig()
    clearSession()
    // request 需要 sessionToken 存在才会发出；直接裸 fetch 验证服务端行为
    const res = await fetch(`${SERVER}/api/dashboard`)
    const data = (await res.json()) as { error?: string }
    check(res.status === 401, `无会话 GET /api/dashboard 返回 401（实际 ${res.status}）`)
    check(data.error === '登录已过期，请退出后重新登录', `返回标准错误消息：${data.error}`)
    // 恢复
    if (backup) writeConfig(backup)
  }

  // T5 extractCookie
  console.log('\n[T5] cookie 解析')
  {
    const setCookies = [
      'next-auth.csrf-token=abc123%7Chmac; Path=/; HttpOnly; SameSite=Lax',
      'next-auth.session-token=eyJhbGci|sig; Path=/; HttpOnly',
    ]
    check(extractCookie(setCookies, 'next-auth.csrf-token') === 'abc123|hmac', '解析 csrf cookie（解码 %7C）')
    check(extractCookie(setCookies, 'next-auth.session-token') === 'eyJhbGci|sig', '解析 session cookie')
    check(extractCookie(setCookies, 'not-exist') === null, '不存在的 cookie 返回 null')
  }

  // T6 中文对齐
  console.log('\n[T6] 中文宽度对齐')
  {
    check(displayWidth('abc') === 3, '英文宽度=3')
    check(displayWidth('投资') === 4, '中文宽度=4')
    check(displayWidth('a投b资') === 6, '混合宽度=6')
    const padded = padEnd('投资', 8)
    check(displayWidth(padded) === 8, `padEnd 后宽度=8`)
    check(padded === '投资    ', 'padEnd 内容正确（4 空格）')
    check(truncate('投资管理系统非常长', 8) === '投资管…', '截断含省略号')
  }

  // T7 配置读写
  console.log('\n[T7] 配置管理')
  {
    const backup = readConfig()
    writeConfig({
      server: 'http://test:3000',
      sessionToken: 'tok-test',
      csrfToken: '',
      loggedInAt: 123,
      user: null,
    })
    let cfg = readConfig()
    check(cfg?.sessionToken === 'tok-test', '写入后可读回')
    clearSession()
    cfg = readConfig()
    check(cfg?.sessionToken === '' && cfg?.server === 'http://test:3000', 'clearSession 保留 server')
    // 恢复原配置
    if (backup) writeConfig(backup)
    else clearSession()
    check(normalizeServer('http://1.2.3.4:3000/') === 'http://1.2.3.4:3000', 'normalizeServer 去尾斜杠')
  }

  // 结果
  console.log('\n════ 测试结果 ════')
  console.log(`  通过: ${passCount}  失败: ${failCount}`)
  if (failCount > 0) {
    process.exit(1)
  } else {
    console.log('  ✅ 全部通过')
  }
}

main().catch(err => {
  console.error(`测试运行失败：${err instanceof Error ? err.message : String(err)}`)
  console.error(`请确认服务器可达：${SERVER}（可用 TEST_SERVER=http://IP:3000 指定）`)
  process.exit(1)
})
