/**
 * logout / whoami 命令
 */

import { readConfig, clearSession } from '../config.js'
import { c, roleLabel } from '../format.js'

export function runLogout(): void {
  const cfg = readConfig()
  if (cfg) {
    clearSession()
    console.log(c.green('✓ 已退出登录（本地会话已清除）'))
  } else {
    console.log(c.dim('当前未登录'))
  }
}

export function runWhoami(): void {
  const cfg = readConfig()
  if (!cfg?.user) {
    console.log(c.dim('当前未登录，请运行 investrask login'))
    process.exit(1)
  }
  const u = cfg.user
  console.log(c.bold(u.name ?? u.email))
  console.log(`  邮箱：${u.email}`)
  console.log(`  角色：${roleLabel(u.role)}`)
  console.log(`  服务器：${cfg.server}`)
  if (cfg.loggedInAt) {
    console.log(`  登录时间：${new Date(cfg.loggedInAt).toLocaleString('zh-CN')}`)
  }
}
