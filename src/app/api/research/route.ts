export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import prisma from '@/lib/prisma'
import { authOptions, type UserRole } from '@/lib/auth'
import type { PermissionUser } from '@/lib/permissions'
import { canViewResearchProject } from '@/lib/research-permissions'

/** 九大模块口径 */
const DD_MODULE_COUNT = 9

/** 安全解析 JSON 数组字段 */
function parseJsonArray(s: string | null): Array<Record<string, unknown>> {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []
  } catch {
    return []
  }
}

/** 各模块资料完善统计（与尽调工作台口径一致：文档 50% + 非空文本 50%，历史截图兜底计入文本分） */
function computeResourceStats(rows: Array<{ documents: string | null; textBlocks: string | null; screenshots: string | null; reportJson: string | null }>) {
  let completeCount = 0
  let progressSum = 0
  let reportCount = 0
  for (const r of rows) {
    const hasDocs = parseJsonArray(r.documents).length > 0
    const hasTexts = parseJsonArray(r.textBlocks).some(t => typeof t?.content === 'string' && (t.content as string).trim().length > 0)
    const hasShots = parseJsonArray(r.screenshots).length > 0
    let p = 0
    if (hasDocs) p += 50
    if (hasTexts || hasShots) p += 50
    progressSum += p
    if (hasDocs || hasTexts || hasShots) completeCount++
    if (r.reportJson) reportCount++
  }
  return {
    completeCount,
    progressPct: Math.round(progressSum / DD_MODULE_COUNT),
    reportReady: reportCount >= DD_MODULE_COUNT,
  }
}

/**
 * GET /api/research
 * 项目尽调列表（尽调阶段 DUE_DILIGENCE）+ 已完成尽调项目 + 统计
 *
 * 权限：
 * - ADMIN / INVESTMENT_PARTNER：可见所有尽调阶段项目
 * - 其他角色：仅可见自己维护的尽调阶段项目
 *
 * 返回：
 * - projects：尽调阶段项目列表（卡片字段：名称/定位/融资金额/估值/各模块资料完善进度）
 * - completedProjects：已完成尽调项目（进入过尽调阶段且九大模块报告齐全；含已变更到协议/已否等阶段的项目）
 * - stats.myProjects：我的尽调项目数
 * - stats.completedDdProjects：已完成尽调项目数
 * - stats.pendingItems：待办事项（各项目需补充资料的模块清单）
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || !session.user.id) {
      return NextResponse.json(
        { error: '登录已过期，请退出后重新登录' },
        { status: 401 }
      )
    }

    const currentUser: PermissionUser = {
      id: session.user.id,
      role: session.user.role as UserRole,
    }

    // 1. 尽调阶段项目（主列表）
    const allDueDiligenceProjects = await prisma.project.findMany({
      where: { followStage: 'DUE_DILIGENCE' },
      select: {
        id: true,
        name: true,
        companyFullName: true,
        industry: true,
        companyPosition: true,
        totalAmount: true,
        raisedAmount: true,
        investmentValuation: true,
        targetDate: true,
        createdAt: true,
        createdById: true,
        createdBy: { select: { id: true, name: true, email: true } },
        members: { select: { userId: true } },
        researchModules: {
          select: {
            id: true,
            moduleType: true,
            analyzedAt: true,
            updatedAt: true,
          },
        },
        ddReport: {
          select: {
            id: true,
            status: true,
            gapsJson: true,
            moduleResults: {
              select: { status: true, missing: true, moduleName: true },
            },
          },
        },
        // 尽调工作台批次（列表徽标：进行中批次进度/红旗）
        ddBatches: {
          select: {
            id: true,
            status: true,
            round: true,
            tasks: { select: { status: true, redFlagLevel: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    // 2. 已完成尽调项目候选：进入过尽调阶段（当前尽调 或 passedStages 含 DUE_DILIGENCE），不限当前阶段
    const completedCandidates = await prisma.project.findMany({
      where: {
        OR: [
          { followStage: 'DUE_DILIGENCE' },
          { passedStages: { contains: 'DUE_DILIGENCE' } },
        ],
      },
      select: {
        id: true,
        name: true,
        companyFullName: true,
        industry: true,
        companyPosition: true,
        totalAmount: true,
        investmentValuation: true,
        followStage: true,
        createdById: true,
        updatedAt: true,
        members: { select: { userId: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    // 3. 一次性取相关项目的尽调工作台模块资料（报告/文档/文本/截图 → 完成度统计）
    const candidateIds = Array.from(new Set([...allDueDiligenceProjects, ...completedCandidates].map(p => p.id)))
    const ddRows = candidateIds.length > 0
      ? await prisma.dDModuleResource.findMany({
          where: { projectId: { in: candidateIds } },
          select: { projectId: true, documents: true, textBlocks: true, screenshots: true, reportJson: true },
        })
      : []
    const rowsByProject = new Map<string, Array<{ documents: string | null; textBlocks: string | null; screenshots: string | null; reportJson: string | null }>>()
    for (const r of ddRows) {
      if (!rowsByProject.has(r.projectId)) rowsByProject.set(r.projectId, [])
      rowsByProject.get(r.projectId)!.push(r)
    }

    // 权限筛选
    const canView = (p: { createdById: string; members: Array<{ userId: string }> }) =>
      canViewResearchProject(currentUser, { createdById: p.createdById, memberIds: p.members.map(m => m.userId) })

    const visibleProjects = allDueDiligenceProjects.filter(canView)
    const visibleCandidates = completedCandidates.filter(canView)

    // 4. 已完成尽调项目：九大模块报告齐全（已生成尽调报告）
    const completedProjects = visibleCandidates
      .filter(p => computeResourceStats(rowsByProject.get(p.id) || []).reportReady)
      .map(p => ({
        id: p.id,
        name: p.name,
        companyFullName: p.companyFullName,
        industry: p.industry,
        companyPosition: p.companyPosition,
        totalAmount: p.totalAmount,
        investmentValuation: p.investmentValuation,
        followStage: p.followStage,
        updatedAt: p.updatedAt.toISOString(),
      }))

    // 待办：解析各项目缺口清单（INSUFFICIENT_DATA 模块）
    const pendingItems: Array<{
      projectId: string
      projectName: string
      moduleName: string
      missing: string
    }> = []

    // 计算每个项目的模块完成情况 + 尽调报告状态 + 资料完善进度
    const projectsWithProgress = visibleProjects.map(project => {
      const moduleCount = project.researchModules.length
      const analyzedCount = project.researchModules.filter(m => m.analyzedAt).length

      // 尽调工作台：各模块资料完善进度（进度条数据源）
      const resourceStats = computeResourceStats(rowsByProject.get(project.id) || [])

      // 尽调报告：完成 = 报告 COMPLETED 且无 INSUFFICIENT_DATA 模块
      const dd = project.ddReport
      const insufficientModules = dd?.moduleResults.filter(m => m.status === 'INSUFFICIENT_DATA') || []
      const hasCompletedReport =
        !!dd && dd.status === 'COMPLETED' && insufficientModules.length === 0

      // 待办事项：缺口模块（需补充资料）
      if (dd && dd.status !== 'FAILED') {
        for (const m of insufficientModules) {
          pendingItems.push({
            projectId: project.id,
            projectName: project.name,
            moduleName: m.moduleName,
            missing: (m.missing || '资料不足，需补充').substring(0, 120),
          })
        }
      }

      // 尽调工作台批次徽标：进行中批次（进度/红旗）
      const batches = project.ddBatches || []
      const activeBatch = batches.find(b => b.status !== 'FROZEN') || null
      const ddWorkbench = activeBatch
        ? {
            batchId: activeBatch.id,
            status: activeBatch.status,
            round: activeBatch.round,
            done: activeBatch.tasks.filter(t => t.status === 'DONE').length,
            total: activeBatch.tasks.length,
            redFlags: activeBatch.tasks.filter(t => t.redFlagLevel !== 'NONE').length,
          }
        : null

      return {
        ...project,
        moduleProgress: {
          total: 9,
          created: moduleCount,
          analyzed: analyzedCount,
        },
        ddReportStatus: dd ? dd.status : null,
        hasCompletedReport,
        pendingCount: insufficientModules.length,
        ddWorkbench,
        frozenBatchCount: batches.filter(b => b.status === 'FROZEN').length,
        investmentValuation: project.investmentValuation,
        resourceCompleteCount: resourceStats.completeCount,
        resourceProgressPct: resourceStats.progressPct,
        reportReady: resourceStats.reportReady,
        members: undefined, // 不暴露 memberIds
        ddReport: undefined,
        ddBatches: undefined,
      }
    })

    return NextResponse.json({
      projects: projectsWithProgress,
      completedProjects,
      total: projectsWithProgress.length,
      stats: {
        myProjects: projectsWithProgress.length,
        completedDdProjects: completedProjects.length,
        completedReports: projectsWithProgress.filter(p => p.hasCompletedReport).length,
        pendingItems,
      },
    })
  } catch (error) {
    console.error('Research list error:', error)
    // 透传具体错误（如 Prisma P2021 表不存在），便于部署环境排查数据库问题
    const detail = error instanceof Error ? error.message : '未知错误'
    return NextResponse.json(
      { error: `获取项目尽调列表失败：${detail}` },
      { status: 500 }
    )
  }
}
