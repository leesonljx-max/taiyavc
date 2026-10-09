export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import {
  listMySkills, listColleagueSkills, validateSkillInput,
  isSkillInScene, isSkillScene, sanitizeScenes,
} from '@/lib/skill-registry'

/**
 * 个人技能 API（P3.5，所有登录账号可用；场景化：每页一套独立技能设定）
 * GET    /api/skills?scene=x  三桶：mySkills（本场景我的）+ librarySkills（我的其他场景技能，可跨场景启用）
 *                              + colleagueSkills（同事挂载在本场景的 CONFIRMED 技能）
 *                              无 scene 时兼容全量视图（librarySkills 为空）
 * POST   /api/skills          创建技能（初始 DRAFT；body.scene → scenes=[scene]，缺省全场景兼容态）
 * PATCH  /api/skills          更新本人技能（提示词/能力勾选变更后回到 DRAFT；scenes 数组可更新且不重置状态）
 * DELETE /api/skills?key=xxx  删除本人技能
 */
async function requireUser(): Promise<{ userId: string } | { response: NextResponse }> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return { response: NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 }) }
  }
  return { userId: session.user.id }
}

export async function GET(request: Request) {
  try {
    const auth = await requireUser()
    if ('response' in auth) return auth.response
    const scene = new URL(request.url).searchParams.get('scene') || undefined
    if (scene && !isSkillScene(scene)) {
      return NextResponse.json({ error: '无效的场景标识' }, { status: 400 })
    }
    const [allMine, allColleagues] = await Promise.all([
      listMySkills(auth.userId),
      listColleagueSkills(auth.userId),
    ])
    // 场景分桶：本场景我的技能 / 我的技能库（其他场景，可跨场景启用）/ 同事挂载在本场景的技能
    const mySkills = allMine.filter(s => isSkillInScene(s.scenes, scene))
    const librarySkills = scene ? allMine.filter(s => !isSkillInScene(s.scenes, scene)) : []
    const colleagueSkills = allColleagues.filter(s => isSkillInScene(s.scenes, scene))
    return NextResponse.json({ mySkills, librarySkills, colleagueSkills })
  } catch (error) {
    console.error('Skills GET error:', error)
    return NextResponse.json({ error: '获取技能列表失败' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireUser()
    if ('response' in auth) return auth.response
    const body = await request.json().catch(() => ({}))

    const validated = validateSkillInput(body)
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }
    // 适用场景：scenes 数组优先（编辑器多选），scene 单值兜底（旧客户端）；空数组=全场景兼容态
    const scene = String(body.scene || '')
    if (scene && !isSkillScene(scene)) {
      return NextResponse.json({ error: '无效的场景标识' }, { status: 400 })
    }
    const scenes = Array.isArray(body.scenes)
      ? sanitizeScenes(body.scenes)
      : scene
        ? [scene]
        : []
    const { key, name, description, category, content } = validated.value
    if (await prisma.agentSkill.findUnique({ where: { key } })) {
      return NextResponse.json({ error: `技能标识「${key}」已存在，请换一个` }, { status: 400 })
    }

    const skill = await prisma.agentSkill.create({
      data: {
        key, name, description, category, content,
        useSearch: body.useSearch === true,
        useProjectLibrary: body.useProjectLibrary === true,
        usePostInvestment: body.usePostInvestment === true,
        type: 'DYNAMIC',
        status: 'DRAFT', // 创建后先调试，确认使用前不挂载
        scenes,
        createdById: auth.userId,
      },
    })
    return NextResponse.json({ skill }, { status: 201 })
  } catch (error) {
    console.error('Skills POST error:', error)
    return NextResponse.json({ error: '创建技能失败' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireUser()
    if ('response' in auth) return auth.response
    const body = await request.json().catch(() => ({}))
    const key = String(body.key || '').trim()

    const existing = await prisma.agentSkill.findUnique({ where: { key } })
    if (!existing) return NextResponse.json({ error: '技能不存在' }, { status: 404 })
    if (existing.type === 'BUILTIN') {
      return NextResponse.json({ error: '内置技能不可编辑（随系统功能维护）' }, { status: 400 })
    }
    if (existing.createdById !== auth.userId) {
      return NextResponse.json({ error: '只能编辑自己的技能' }, { status: 403 })
    }

    const data: Record<string, unknown> = {}
    if (body.name !== undefined) {
      const name = String(body.name || '').trim()
      if (!name || name.length > 50) return NextResponse.json({ error: '技能名称必填（≤50 字）' }, { status: 400 })
      data.name = name
    }
    if (body.description !== undefined) {
      const description = String(body.description || '').trim()
      if (!description || description.length > 200) return NextResponse.json({ error: '能力说明必填（≤200 字）' }, { status: 400 })
      data.description = description
    }
    if (body.content !== undefined) {
      const content = String(body.content || '').trim()
      if (content.length < 20) return NextResponse.json({ error: '提示词内容过短（至少 20 字）' }, { status: 400 })
      data.content = content
    }
    if (body.useSearch !== undefined) data.useSearch = body.useSearch === true
    if (body.useProjectLibrary !== undefined) data.useProjectLibrary = body.useProjectLibrary === true
    if (body.usePostInvestment !== undefined) data.usePostInvestment = body.usePostInvestment === true
    // 适用场景更新（白名单过滤；场景挂载调整不属于能力变更，不重置 DRAFT/CONFIRMED 状态）
    if (body.scenes !== undefined) data.scenes = sanitizeScenes(body.scenes)
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '无可更新字段' }, { status: 400 })
    }

    // 提示词或能力勾选变更 → 回到 DRAFT 重新调试确认（保证挂载的都是验证过的版本）
    const capabilityChanged =
      (data.content !== undefined && data.content !== existing.content) ||
      (data.useSearch !== undefined && data.useSearch !== existing.useSearch) ||
      (data.useProjectLibrary !== undefined && data.useProjectLibrary !== existing.useProjectLibrary) ||
      (data.usePostInvestment !== undefined && data.usePostInvestment !== existing.usePostInvestment)
    if (capabilityChanged && existing.status === 'CONFIRMED') {
      data.status = 'DRAFT'
    }

    const skill = await prisma.agentSkill.update({ where: { id: existing.id }, data })
    return NextResponse.json({ skill })
  } catch (error) {
    console.error('Skills PATCH error:', error)
    return NextResponse.json({ error: '更新技能失败' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireUser()
    if ('response' in auth) return auth.response
    const url = new URL(request.url)
    const key = url.searchParams.get('key') || ''

    const existing = await prisma.agentSkill.findUnique({ where: { key } })
    if (!existing) return NextResponse.json({ error: '技能不存在' }, { status: 404 })
    if (existing.type === 'BUILTIN') {
      return NextResponse.json({ error: '内置技能不可删除' }, { status: 400 })
    }
    if (existing.createdById !== auth.userId) {
      return NextResponse.json({ error: '只能删除自己的技能' }, { status: 403 })
    }
    await prisma.agentSkill.delete({ where: { id: existing.id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Skills DELETE error:', error)
    return NextResponse.json({ error: '删除技能失败' }, { status: 500 })
  }
}
