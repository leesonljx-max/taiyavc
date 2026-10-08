export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { listSkills, isBuiltinKey, SKILL_CATEGORIES } from '@/lib/skill-registry'

/**
 * Agent 技能管理（P3，仅管理员）
 * GET   /api/admin/skills            全量技能清单（内置目录 + 动态技能 + 使用统计）
 * POST  /api/admin/skills            创建动态技能（MD 提示词，可选联网）
 * PATCH /api/admin/skills            更新动态技能（内置技能不可编辑）
 * DELETE /api/admin/skills?key=xxx   删除动态技能
 */

async function requireAdmin(): Promise<{ userId: string } | { response: NextResponse }> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return { response: NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 }) }
  }
  if (session.user.role !== 'ADMIN') {
    return { response: NextResponse.json({ error: '无权访问，仅管理员可管理技能' }, { status: 403 }) }
  }
  return { userId: session.user.id }
}

export async function GET() {
  try {
    const auth = await requireAdmin()
    if ('response' in auth) return auth.response
    const skills = await listSkills()
    return NextResponse.json({ skills })
  } catch (error) {
    console.error('Admin skills GET error:', error)
    return NextResponse.json({ error: '获取技能清单失败' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin()
    if ('response' in auth) return auth.response
    const adminId = auth.userId

    const body = await request.json().catch(() => ({}))
    const key = String(body.key || '').trim().toLowerCase()
    const name = String(body.name || '').trim()
    const description = String(body.description || '').trim()
    const category = String(body.category || 'general').trim()
    const content = String(body.content || '').trim()
    const useSearch = body.useSearch === true

    // 校验
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(key)) {
      return NextResponse.json({ error: '技能标识格式不合法（2-40 位小写字母/数字/连字符，字母开头）' }, { status: 400 })
    }
    if (isBuiltinKey(key)) {
      return NextResponse.json({ error: `「${key}」为内置技能标识，不可占用` }, { status: 400 })
    }
    if (await prisma.agentSkill.findUnique({ where: { key } })) {
      return NextResponse.json({ error: `技能标识「${key}」已存在` }, { status: 400 })
    }
    if (!name || name.length > 50) {
      return NextResponse.json({ error: '技能名称必填（≤50 字）' }, { status: 400 })
    }
    if (!description || description.length > 200) {
      return NextResponse.json({ error: '能力说明必填（≤200 字，说明何时该用）' }, { status: 400 })
    }
    if (content.length < 20) {
      return NextResponse.json({ error: '提示词内容过短（至少 20 字）：内容将作为技能的 system prompt' }, { status: 400 })
    }
    if (!SKILL_CATEGORIES.includes(category as (typeof SKILL_CATEGORIES)[number])) {
      return NextResponse.json({ error: '分类不合法' }, { status: 400 })
    }

    const skill = await prisma.agentSkill.create({
      data: { key, name, description, category, content, useSearch, type: 'DYNAMIC', createdById: adminId },
    })
    return NextResponse.json({ skill }, { status: 201 })
  } catch (error) {
    console.error('Admin skills POST error:', error)
    return NextResponse.json({ error: '创建技能失败' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin()
    if ('response' in auth) return auth.response

    const body = await request.json().catch(() => ({}))
    const key = String(body.key || '').trim()
    const existing = await prisma.agentSkill.findUnique({ where: { key } })
    if (!existing) return NextResponse.json({ error: '技能不存在' }, { status: 404 })
    if (existing.type === 'BUILTIN') {
      return NextResponse.json({ error: '内置技能不可编辑（随系统功能维护）' }, { status: 400 })
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
    if (body.category !== undefined) {
      const category = String(body.category || '').trim()
      if (!SKILL_CATEGORIES.includes(category as (typeof SKILL_CATEGORIES)[number])) {
        return NextResponse.json({ error: '分类不合法' }, { status: 400 })
      }
      data.category = category
    }
    if (body.content !== undefined) {
      const content = String(body.content || '').trim()
      if (content.length < 20) return NextResponse.json({ error: '提示词内容过短（至少 20 字）' }, { status: 400 })
      data.content = content
    }
    if (body.useSearch !== undefined) data.useSearch = body.useSearch === true
    if (body.isActive !== undefined) data.isActive = body.isActive === true
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '无可更新字段' }, { status: 400 })
    }

    const skill = await prisma.agentSkill.update({ where: { id: existing.id }, data })
    return NextResponse.json({ skill })
  } catch (error) {
    console.error('Admin skills PATCH error:', error)
    return NextResponse.json({ error: '更新技能失败' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin()
    if ('response' in auth) return auth.response

    const url = new URL(request.url)
    const key = url.searchParams.get('key') || ''
    const existing = await prisma.agentSkill.findUnique({ where: { key } })
    if (!existing) return NextResponse.json({ error: '技能不存在' }, { status: 404 })
    if (existing.type === 'BUILTIN') {
      return NextResponse.json({ error: '内置技能不可删除' }, { status: 400 })
    }
    await prisma.agentSkill.delete({ where: { id: existing.id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Admin skills DELETE error:', error)
    return NextResponse.json({ error: '删除技能失败' }, { status: 500 })
  }
}
