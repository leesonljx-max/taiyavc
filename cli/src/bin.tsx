#!/usr/bin/env node

/**
 * investrask —— 泰亚投资管理系统 Mac 终端客户端
 *
 * 用法：
 *   investrask                   进入交互界面（TUI）
 *   investrask login [服务器地址] 登录
 *   investrask logout            退出登录
 *   investrask whoami            查看当前账号
 *   investrask stats             工作台周统计
 *   investrask projects [--mine] 项目列表（--mine=我的项目）
 *   investrask projects 关键词    过滤项目
 *   investrask project <名称>    项目详情（模糊匹配）
 *   investrask help              帮助
 */

import { runLogin } from './commands/login.js'
import { runLogout, runWhoami } from './commands/logout.js'
import { runStats } from './commands/stats.js'
import { runProjects } from './commands/projects.js'
import { runProject } from './commands/project.js'
import { c } from './format.js'
import { VERSION } from './version.js'

const HELP = `
${c.bold('investrask')} —— 泰亚投资管理系统终端客户端

${c.bold('用法：')}
  investrask                     进入交互界面（方向键导航）
  investrask login [服务器地址]    登录（首次需输入服务器地址）
  investrask logout              退出登录
  investrask whoami              查看当前账号
  investrask stats               工作台周统计
  investrask projects [--mine]   项目列表（--mine 仅我的项目）
  investrask projects 关键词      按名称/行业/定位过滤
  investrask project <项目名称>   项目详情（支持模糊匹配）
  investrask help                显示本帮助

${c.bold('示例：')}
  investrask login http://1.2.3.4:3000
  investrask projects --mine
  investrask project 光电极

${c.dim('服务器地址与登录态保存在 ~/.investrask/config.json')}
`

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2)

  switch (cmd) {
    case undefined:
      // 无参数：进入 TUI（需 TTY 环境）
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error(c.red('✗ 当前不是交互终端，无法启动界面模式'))
        console.error(c.dim('  请使用快捷命令，如 investrask stats / projects / help'))
        process.exit(1)
      }
      // TUI 需要时才加载 ink（避免污染命令行模式的 stdin，同时加快启动）
      const [{ render }, { default: App }, React] = await Promise.all([
        import('ink'),
        import('./tui/App.js'),
        import('react'),
      ])
      render(React.createElement(App))
      break

    case 'login':
    case 'l':
      await runLogin(args.find(a => !a.startsWith('-')))
      break

    case 'logout':
      runLogout()
      break

    case 'whoami':
      runWhoami()
      break

    case 'stats':
    case 's':
      await runStats()
      break

    case 'projects':
    case 'p':
      await runProjects(args)
      break

    case 'project':
      await runProject(args)
      break

    case 'help':
    case '--help':
    case '-h':
      console.log(HELP)
      break

    case '--version':
    case '-v':
      console.log(VERSION)
      break

    default:
      console.error(c.red(`未知命令：${cmd}`))
      console.log(HELP)
      process.exit(1)
  }
}

main().catch(err => {
  console.error(c.red(`✗ ${err instanceof Error ? err.message : String(err)}`))
  process.exit(1)
})
