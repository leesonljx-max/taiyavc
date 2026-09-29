export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canEditResearchProject } from '@/lib/research-permissions'
import { upsertModuleResource, isValidModuleKey, type DDScreenshot } from '@/lib/dd-workbench/resources'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

/** 截图目录（走 /api/uploads 白名单访问） */
const UPLOAD_DIR = join(process.cwd(), 'public', 'project-images')

const MAX_SCREENSHOT_SIZE = 10 * 1024 * 1024 // 10MB

async function loadShotList(projectId: string, moduleKey: string): Promise<DDScreenshot[]> {
  const record = await prisma.dDModuleResource.findUnique({
    where: { projectId_moduleKey: { projectId, moduleKey } },
  })
  if (!record?.screenshots) return []
  try {
    const arr = JSON.parse(record.screenshots)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/**
 * POST /api/dd/resources/[projectId]/[moduleKey]/screenshots
 * 上传模块截图（image/*，随报告原样嵌入展示）
 */
export async function POST(
  request: Request,
  { params }: { params: { projectId: string; moduleKey: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const currentUser: PermissionUser = { id: session.user.id, role: session.user.role as UserRole }

    const { projectId, moduleKey } = params
    if (!isValidModuleKey(moduleKey)) {
      return NextResponse.json({ error: `无效的模块标识: ${moduleKey}` }, { status: 400 })
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { createdById: true, members: { select: { userId: true } } },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权编辑该项目' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: '未找到上传文件' }, { status: 400 })
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: '仅支持图片格式截图' }, { status: 400 })
    }
    if (file.size > MAX_SCREENSHOT_SIZE) {
      return NextResponse.json({ error: '截图大小超过 10MB 限制' }, { status: 400 })
    }

    await mkdir(UPLOAD_DIR, { recursive: true })
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const uniqueName = `ddshot-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(join(UPLOAD_DIR, uniqueName), buffer)

    const record = await upsertModuleResource(projectId, moduleKey)
    const shots = await loadShotList(projectId, moduleKey)
    if (shots.length >= 30) {
      return NextResponse.json({ error: '截图数量超过上限（30 张）' }, { status: 400 })
    }
    shots.push({
      id: `shot-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      url: `/api/uploads/project-images/${uniqueName}`,
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
    })
    await prisma.dDModuleResource.update({
      where: { id: record.id },
      data: { screenshots: JSON.stringify(shots) },
    })

    return NextResponse.json({ ok: true, count: shots.length, url: shots[shots.length - 1].url })
  } catch (error) {
    console.error('DD screenshot upload error:', error)
    return NextResponse.json({ error: '上传截图失败' }, { status: 500 })
  }
}

/**
 * DELETE /api/dd/resources/[projectId]/[moduleKey]/screenshots?shotId=xxx
 * 删除模块截图
 */
export async function DELETE(
  request: Request,
  { params }: { params: { projectId: string; moduleKey: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '登录已过期，请退出后重新登录' }, { status: 401 })
    }
    const currentUser: PermissionUser = { id: session.user.id, role: session.user.role as UserRole }

    const { projectId, moduleKey } = params
    const shotId = new URL(request.url).searchParams.get('shotId')
    if (!shotId) return NextResponse.json({ error: '缺少 shotId' }, { status: 400 })

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { createdById: true, members: { select: { userId: true } } },
    })
    if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 })
    const memberIds = project.members.map(m => m.userId)
    if (!canEditResearchProject(currentUser, { createdById: project.createdById, memberIds })) {
      return NextResponse.json({ error: '无权编辑该项目' }, { status: 403 })
    }

    const record = await prisma.dDModuleResource.findUnique({
      where: { projectId_moduleKey: { projectId, moduleKey } },
    })
    if (!record) return NextResponse.json({ error: '截图不存在' }, { status: 404 })

    const shots = await loadShotList(projectId, moduleKey)
    if (!shots.some(s => s.id === shotId)) {
      return NextResponse.json({ error: '截图不存在' }, { status: 404 })
    }
    const remaining = shots.filter(s => s.id !== shotId)
    await prisma.dDModuleResource.update({
      where: { id: record.id },
      data: { screenshots: JSON.stringify(remaining) },
    })

    return NextResponse.json({ ok: true, count: remaining.length })
  } catch (error) {
    console.error('DD screenshot delete error:', error)
    return NextResponse.json({ error: '删除截图失败' }, { status: 500 })
  }
}
