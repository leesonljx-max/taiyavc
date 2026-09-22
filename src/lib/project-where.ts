/**
 * 项目可见性 / 列表筛选的 Prisma where 构建器
 *
 * 目标：把 canViewProject / isMaintainedByUser 的内存权限判断精确翻译为数据库 where，
 * 使列表接口可以安全地做服务端分页（take/skip 要求过滤完全在 DB 层完成，
 * 否则查后内存过滤会导致页内条数不齐）。
 *
 * 等价关系（由 tests/project-where-equivalence.test.ts 保证）：
 *   findMany({ where: buildProjectVisibilityWhere(user) })
 *     ≡ findMany({}) 后逐行 canViewProject(user, p)
 *   findMany({ where: buildProjectScopeWhere(user, 'mine') })
 *     ≡ findMany({}) 后逐行 canViewProject(user, p) && isMaintainedByUser(user, p)
 */

import type { Prisma } from '@prisma/client'
import { OPEN_VIEW_STAGES } from '@/lib/permissions'
import type { PermissionUser } from '@/lib/permissions'

const PRIVILEGED_ROLES = ['ADMIN', 'INVESTMENT_PARTNER', 'INVESTMENT_MANAGER']

function isPrivileged(user: PermissionUser): boolean {
  return PRIVILEGED_ROLES.includes(user.role)
}

/**
 * 可见性 where（scope=all 语义）：
 * - 特权角色：全部可见
 * - 其余角色：公开/兜底阶段（OPEN_VIEW_STAGES）或本人是成员
 *   （受限阶段仅认成员身份，创建者非成员不可见——与 canViewProject 一致）
 */
export function buildProjectVisibilityWhere(user: PermissionUser): Prisma.ProjectWhereInput {
  if (isPrivileged(user)) return {}
  return {
    OR: [
      { followStage: { in: OPEN_VIEW_STAGES } },
      { members: { some: { userId: user.id } } },
    ],
  }
}

/**
 * 范围 where：
 * - scope=all：同可见性
 * - scope=mine：可见 ∩ 维护（维护 = 创建者或成员，见 isMaintainedByUser）
 *   化简后 = 成员 ∪ (创建者 ∩ 开放阶段)
 */
export function buildProjectScopeWhere(user: PermissionUser, scope: 'all' | 'mine'): Prisma.ProjectWhereInput {
  if (scope !== 'mine') return buildProjectVisibilityWhere(user)

  if (isPrivileged(user)) {
    return {
      OR: [
        { createdById: user.id },
        { members: { some: { userId: user.id } } },
      ],
    }
  }
  return {
    OR: [
      { members: { some: { userId: user.id } } },
      { AND: [{ createdById: user.id }, { followStage: { in: OPEN_VIEW_STAGES } }] },
    ],
  }
}

export interface ProjectListFilters {
  /** 搜索关键词（name / companyFullName，大小写不敏感 contains） */
  keyword?: string
  /** 累计阶段（passedStages JSON 数组字符串 contains，与前端 getPassedStages 口径一致） */
  stage?: string
  /** 行业精确等值 */
  industry?: string
  /** 初聊日期（targetDate）所在年份 */
  year?: number
  /** 经理（创建者或成员） */
  managerId?: string
}

/**
 * 列表查询 where = 范围（权限）where AND 用户筛选条件
 */
export function buildProjectListWhere(
  user: PermissionUser,
  scope: 'all' | 'mine',
  filters: ProjectListFilters = {}
): Prisma.ProjectWhereInput {
  const conditions: Prisma.ProjectWhereInput[] = [buildProjectScopeWhere(user, scope)]

  const kw = filters.keyword?.trim()
  if (kw) {
    conditions.push({
      OR: [
        { name: { contains: kw, mode: 'insensitive' } },
        { companyFullName: { contains: kw, mode: 'insensitive' } },
      ],
    })
  }

  // 阶段值互不为子串，带引号 contains 即精确命中 JSON 数组元素
  const stage = filters.stage?.trim()
  if (stage) {
    conditions.push({ passedStages: { contains: `"${stage}"` } })
  }

  if (filters.industry?.trim()) {
    conditions.push({ industry: filters.industry.trim() })
  }

  if (typeof filters.year === 'number' && Number.isFinite(filters.year)) {
    conditions.push({
      targetDate: {
        gte: new Date(filters.year, 0, 1),
        lt: new Date(filters.year + 1, 0, 1),
      },
    })
  }

  if (filters.managerId?.trim()) {
    const mId = filters.managerId.trim()
    conditions.push({
      OR: [{ createdById: mId }, { members: { some: { userId: mId } } }],
    })
  }

  return conditions.length === 1 ? conditions[0] : { AND: conditions }
}
