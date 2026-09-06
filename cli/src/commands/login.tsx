/**
 * login 命令 —— 交互式登录
 *
 * 首次使用需输入服务器地址（如 http://1.2.3.4:3000），之后只需账户名/密码。
 * 输入框采用原生行编辑模式，中文输入法安全。
 */

import { login as apiLogin } from '../api/client.js'
import { readConfig, updateSession, normalizeServer } from '../config.js'
import { c, roleLabel } from '../format.js'
import type { SessionUser, UserRole } from '../types.js'

/**
 * 原生 stdin 行提问（TTY 与管道模式均稳定，支持中文 IME）
 *
 * 关键：共享行缓冲队列。管道模式下多行输入可能在同一个 chunk 到达，
 * 必须缓存剩余行供后续 prompt 使用（否则第二行会丢失）。
 */
let stdinBuf = ''
let lineWaiter: ((line: string) => void) | null = null
let listening = false

function ensureListening(): void {
  if (listening) return
  listening = true
  process.stdin.setEncoding('utf-8')
  process.stdin.on('data', (chunk: string) => {
    stdinBuf += chunk
    drainLines()
  })
  process.stdin.resume()
}

/** 把缓冲中的完整行派发给等待中的 prompt */
function drainLines(): void {
  while (lineWaiter !== null && stdinBuf.includes('\n')) {
    const idx = stdinBuf.indexOf('\n')
    const line = stdinBuf.slice(0, idx).replace(/\r$/, '')
    stdinBuf = stdinBuf.slice(idx + 1)
    const waiter = lineWaiter
    lineWaiter = null
    waiter(line)
  }
}

function prompt(question: string): Promise<string> {
  return new Promise(resolve => {
    process.stdout.write(question)
    lineWaiter = resolve
    ensureListening()
    // 缓冲中可能已有完整行（前一个 prompt 残留）
    drainLines()
  })
}

/** 密码提问：TTY 下隐藏回显（raw mode），管道下明文（测试用） */
function promptPassword(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return prompt(question)
  }
  return new Promise(resolve => {
    process.stdout.write(question)
    let input = ''
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf-8')
    const onData = (ch: string) => {
      // 回车确认
      if (ch === '\r' || ch === '\n') {
        process.stdin.setRawMode(false)
        process.stdin.removeListener('data', onData)
        process.stdin.pause()
        process.stdout.write('\n')
        resolve(input)
        return
      }
      // Ctrl+C 取消
      if (ch === '\u0003') {
        process.stdout.write('\n')
        process.exit(130)
      }
      // 退格
      if (ch === '\u007f' || ch === '\b') {
        if (input.length > 0) {
          input = Array.from(input).slice(0, -1).join('')
          process.stdout.write('\b \b')
        }
        return
      }
      input += ch
      process.stdout.write('*')
    }
    process.stdin.on('data', onData)
  })
}

export async function runLogin(serverArg?: string): Promise<void> {
  const existing = readConfig()

  // 服务器地址：命令行参数 > 已保存配置 > 交互输入
  let server = serverArg ? normalizeServer(serverArg) : existing?.server
  if (!server) {
    server = normalizeServer(await prompt(c.bold('服务器地址（如 http://1.2.3.4:3000）: ')))
    if (!server) {
      console.error(c.red('✗ 服务器地址不能为空'))
      process.exit(1)
    }
  }
  if (!/^https?:\/\//.test(server)) {
    server = `http://${server}`
  }

  console.log(c.dim(`服务器：${server}`))

  const username = (await prompt('账户名或邮箱: ')).trim()
  if (!username) {
    console.error(c.red('✗ 账户名不能为空'))
    process.exit(1)
  }
  const password = await promptPassword('密码: ')
  if (!password) {
    console.error(c.red('✗ 密码不能为空'))
    process.exit(1)
  }

  try {
    const result = await apiLogin(server, username, password)
    const user: SessionUser = {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
      role: (result.user.role as UserRole) ?? 'TEMP_VISITOR',
    }
    updateSession({
      server,
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      loggedInAt: Date.now(),
      user,
    })
    console.log(c.green('✓ 登录成功'))
    console.log(`  用户：${c.bold(user.name ?? user.email)}`)
    console.log(`  角色：${roleLabel(user.role)}`)
    console.log(c.dim(`  会话有效期约 30 天，过期后重新 investrask login 即可`))
  } catch (err) {
    console.error(c.red(`✗ 登录失败：${err instanceof Error ? err.message : String(err)}`))
    process.exit(1)
  }
}
