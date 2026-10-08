export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import {
  listMySkills, listColleagueSkills, validateSkillInput,
} from '@/lib/skill-registry'

/**
 * 个人技能 API（P3.5，所有登录账号可用）
 * GET    /api/skills          我的技能（DRAFT+CONFIRMED）+ 同事技能（其他人 CONFIRMED）
 * POST   /api/skills          创建技能（初始 DRAFT 调试中）
 * PATCH  /api/skills          更新本人技能（提示词/能力勾选变更后回到 DRAFT 重新调试）
 * DELETE /api/skills?key=xxx  删除本人技能
 */
async function requireUser(): Promise<{ userId: string } | { response: NextResponse }> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return { response: NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 }) }
  }
  return { userId: session.user.id }
}

export async function GET() {
  try {
    const auth = await requireUser()
    if ('response' in auth) return auth.response
    const [mySkills, colleagueSkills] = await Promise.all([
      listMySkills(auth.userId),
      listColleagueSkills(auth.userId),
    ])
    return NextResponse.json({ mySkills, colleagueSkills })
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
