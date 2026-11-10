export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { listPluginViews, installPlugin, installPluginByName, uninstallPlugin, upgradePlugin, togglePlugin, setPluginScenes, setProjectPluginEnabled, createPromptPlugin } from '@/lib/plugin-runtime'

/**
 * 插件中心（P4）
 * GET   /api/admin/plugins?projectId=   插件目录 + 安装/启用状态 + 项目列表 + 统计（所有登录账号）
 * POST  /api/admin/plugins              管理动作：
 *   - 所有登录账号：install / upgrade / installByName / scenes
 *   - 仅管理员：uninstall / toggle / create / project
 *   { action: 'install'|'uninstall'|'upgrade', key }
 *   { action: 'installByName', name }
 *   { action: 'scenes', key, scenes: string[] }
 *   { action: 'toggle', key, isActive }
 *   { action: 'project', projectId, key, enabled }
 *   { action: 'create', key, name, description, content, scenes?, modules? }
 */

async function requireSession(): Promise<{ userId: string; role: string } | { response: NextResponse }> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return { response: NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 }) }
  }
  return { userId: session.user.id, role: session.user.role }
}

export async function GET(request: Request) {
  try {
    const auth = await requireSession()
    if ('response' in auth) return auth.response
    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId') || undefined

    const [plugins, projects] = await Promise.all([
      listPluginViews(projectId),
      prisma.project.findMany({
        select: { id: true, name: true },
        orderBy: [{ updatedAt: 'desc' }],
        take: 200,
      }),
    ])
    const installed = plugins.filter(p => p.installed)
    const stats = {
      installed: installed.length,
      active: installed.filter(p => p.isActive).length,
      total: plugins.length,
      totalRuns: installed.reduce((sum, p) => sum + p.runCount, 0),
    }
    return NextResponse.json({ plugins, projects, stats })
  } catch (error) {
    console.error('Plugins GET error:', error)
    return NextResponse.json({ error: '获取插件目录失败' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireSession()
    if ('response' in auth) return auth.response

    const body = await request.json().catch(() => ({}))
    const action = String(body.action || '')
    const key = String(body.key || '').trim().toLowerCase()

    if (action === 'create') {
      if (auth.role !== 'ADMIN') {
        return NextResponse.json({ error: '无权操作，仅管理员可创建插件' }, { status: 403 })
      }
      await createPromptPlugin({
        key,
        name: String(body.name || ''),
        description: String(body.description || ''),
        content: String(body.content || ''),
        scenes: body.scenes,
        modules: body.modules,
        userId: auth.userId,
      })
      return NextResponse.json({ ok: true }, { status: 201 })
    }

    if (action === 'installByName') {
      const name = String(body.name || '').trim()
      if (!name) return NextResponse.json({ error: '请输入插件名称' }, { status: 400 })
      const result = await installPluginByName(name, auth.userId)
      return NextResponse.json({ ok: true, ...result })
    }

    if ((action === 'uninstall' || action === 'toggle') && auth.role !== 'ADMIN') {
      return NextResponse.json({ error: '无权操作，仅管理员可停用或卸载插件' }, { status: 403 })
    }

    if (!key) return NextResponse.json({ error: '缺少插件标识 key' }, { status: 400 })

    if (action === 'install') {
      await installPlugin(key, auth.userId)
    } else if (action === 'uninstall') {
      await uninstallPlugin(key)
    } else if (action === 'upgrade') {
      await upgradePlugin(key)
    } else if (action === 'toggle') {
      await togglePlugin(key, body.isActive === true)
    } else if (action === 'scenes') {
      await setPluginScenes(key, body.scenes)
    } else if (action === 'project') {
      if (auth.role !== 'ADMIN') {
        return NextResponse.json({ error: '无权操作' }, { status: 403 })
      }
      const projectId = String(body.projectId || '').trim()
      if (!projectId) return NextResponse.json({ error: '缺少 projectId' }, { status: 400 })
      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
      if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })
      await setProjectPluginEnabled(projectId, key, body.enabled === true)
    } else {
      return NextResponse.json({ error: '未知操作' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Plugins POST error:', error)
    const message = error instanceof Error ? error.message : '操作失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
