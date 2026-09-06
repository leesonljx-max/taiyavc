/**
 * 配置与会话管理
 *
 * 配置文件：~/.investrask/config.json
 * 存储服务器地址 + NextAuth 会话 cookie + 当前用户信息
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { SessionUser } from './types.js'

export interface CliConfig {
  /** 服务器地址，如 http://1.2.3.4:3000 */
  server: string
  /** NextAuth 会话 cookie（next-auth.session-token 的值） */
  sessionToken: string
  /** csrf cookie（next-auth.csrf-token 的值） */
  csrfToken: string
  /** 登录时间戳（毫秒） */
  loggedInAt: number
  /** 当前用户 */
  user: SessionUser | null
}

const CONFIG_DIR = path.join(os.homedir(), '.investrask')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

export function readConfig(): CliConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
    const cfg = JSON.parse(raw) as CliConfig
    // server 必须存在；sessionToken 允许为空（登出后仍可读取服务器地址）
    if (!cfg.server) return null
    return cfg
  } catch (err) {
    console.error('[Config] 读取配置失败:', err)
    return null
  }
}

export function writeConfig(cfg: CliConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8')
  } catch (err) {
    console.error('[Config] 写入配置失败:', err)
    throw err
  }
}

/** 更新会话字段（保留其他配置） */
export function updateSession(fields: Partial<CliConfig>): CliConfig {
  const current = readConfig() ?? {
    server: '',
    sessionToken: '',
    csrfToken: '',
    loggedInAt: 0,
    user: null,
  }
  const next = { ...current, ...fields }
  writeConfig(next)
  return next
}

/** 清除会话（登出），保留 server 地址 */
export function clearSession(): void {
  const current = readConfig()
  if (current) {
    writeConfig({ ...current, sessionToken: '', csrfToken: '', loggedInAt: 0, user: null })
  }
}

/** 标准化服务器地址（去掉末尾斜杠） */
export function normalizeServer(input: string): string {
  return input.trim().replace(/\/+$/, '')
}
