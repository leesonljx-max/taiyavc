/**
 * 尽调工作台 API 共享守卫：批次上下文加载 + 权限校验
 *
 * 权限复用投研分析规则（research-permissions）：
 * - 查看：ADMIN / INVESTMENT_PARTNER 全可见；其他角色仅项目维护人
 * - 编辑（发起批次/改任务/加证据/冻结）：ADMIN / INVESTMENT_PARTNER / 项目维护人
 */

import prisma from '@/lib/prisma'
import type { PermissionUser } from '@/lib/permissions'
import {
  canViewResearchProject,
  canEditResearchProject,
} from '@/lib/research-permissions'

/** 401 响应体（项目规范：session.user.id 缺失时的统一文案） */
export const UNAUTHORIZED_BODY = { error: '登录已过期，请退出后重新登录' }

export interface DDBatchContext {
  batch: {
    id: string
    projectId: string
    round: string | null
    templateVersion: string
    status: string
    initiatedById: string
    dueDate: Date | null
    createdAt: Date
    updatedAt: Date
  }
  project: {
    id: string
    name: string
    companyFullName: string | null
    industry: string | null
    financingRound: string | null
    followStage: string
    createdById: string
    totalAmount: string
    investmentValuation: number | null
  }
}

/**
 * 加载批次上下文并按需校验权限
 * 返回 null = 批次不存在；'FORBIDDEN' = 无权；context = 通过
 */
export async function loadBatchContext(
  batchId: string,
  user: PermissionUser,
  need: 'view' | 'edit'
): Promise<DDBatchContext | null | 'FORBIDDEN'> {
  const batch = await prisma.dDBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      projectId: true,
      round: true,
      templateVersion: true,
      status: true,
      initiatedById: true,
      dueDate: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!batch) return null

  const project = await prisma.project.findUnique({
    where: { id: batch.projectId },
    select: {
      id: true,
      name: true,
      companyFullName: true,
      industry: true,
      financingRound: true,
      followStage: true,
      createdById: true,
      totalAmount: true,
      investmentValuation: true,
      members: { select: { userId: true } },
    },
  })
  if (!project) return null

  const memberIds = project.members.map(m => m.userId)
  const membership = { createdById: project.createdById, memberIds }

  const allowed = need === 'edit'
    ? canEditResearchProject(user, membership)
    : canViewResearchProject(user, membership)
  if (!allowed) return 'FORBIDDEN'

  const { members: _members, ...projectFields } = project
  return { batch, project: projectFields }
}

/** 加载任务（含批次归属校验前的原始行）供任务级路由使用 */
export async function loadTaskWithBatch(taskId: string) {
  return prisma.dDTask.findUnique({
    where: { id: taskId },
    include: { batch: true },
  })
}
