import type { UserRole } from './auth'
import type { FollowStage } from '@/app/projects/types'

export type PermissionUser = {
  id: string
  role: UserRole
}

export type PermissionProject = {
  followStage: FollowStage | string
  createdById: string
  memberIds: string[]
}

export const RESTRICTED_STAGES: FollowStage[] = ['PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'AGREEMENT', 'CLOSING', 'POST_INVESTMENT']
export const PUBLIC_STAGES: FollowStage[] = ['INITIAL_TALK']

/** 全部阶段值（新增 FollowStage 枚举值时必须同步，等价性测试会拦截漂移） */
export const ALL_VIEW_STAGES: FollowStage[] = [
  'INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE',
  'AGREEMENT', 'CLOSING', 'POST_INVESTMENT', 'REJECTED',
]

/**
 * 兜底放行阶段 = 全集 - 公开 - 受限（canViewProject 的最后 return true 分支）
 */
export const FALLBACK_VIEW_STAGES: FollowStage[] = ALL_VIEW_STAGES.filter(
  s => !PUBLIC_STAGES.includes(s) && !RESTRICTED_STAGES.includes(s)
)

/**
 * 无需成员身份即可被所有人查看的阶段 = 公开阶段 ∪ 兜底放行阶段
 * （由上方名单自动派生，新增枚举值只需维护 ALL/RESTRICTED/PUBLIC 三张名单）
 */
export const OPEN_VIEW_STAGES: FollowStage[] = [...PUBLIC_STAGES, ...FALLBACK_VIEW_STAGES]

/**
 * 是否能查看项目（项目库 + 项目详情）
 * - ADMIN: 所有项目
 * - INVESTMENT_PARTNER: 所有项目
 * - INVESTMENT_MANAGER: 所有项目（项目库只读 + 自己维护的）
 * - 其他: 公开阶段项目
 */
export function canViewProject(user: PermissionUser | null | undefined, project: PermissionProject): boolean {
  if (!user) return false

  if (user.role === 'ADMIN') return true
  if (user.role === 'INVESTMENT_PARTNER') return true
  if (user.role === 'INVESTMENT_MANAGER') return true

  if (PUBLIC_STAGES.includes(project.followStage as FollowStage)) {
    return true
  }

  if (RESTRICTED_STAGES.includes(project.followStage as FollowStage)) {
    if (project.memberIds.includes(user.id)) return true
    return false
  }

  return true
}

/**
 * 是否能编辑项目
 * - ADMIN: 所有项目
 * - INVESTMENT_PARTNER: 所有项目
 * - INVESTMENT_MANAGER: 仅自己维护的（createdById 或 memberIds）
 */
export function canEditProject(user: PermissionUser | null | undefined, project: PermissionProject): boolean {
  if (!user) return false

  if (user.role === 'ADMIN') return true
  if (user.role === 'INVESTMENT_PARTNER') return true

  if (user.role === 'INVESTMENT_MANAGER') {
    if (project.createdById === user.id) return true
    if (project.memberIds.includes(user.id)) return true
    return false
  }

  if (PUBLIC_STAGES.includes(project.followStage as FollowStage)) {
    return project.createdById === user.id
  }

  if (RESTRICTED_STAGES.includes(project.followStage as FollowStage)) {
    if (project.createdById === user.id) return true
    if (project.memberIds.includes(user.id)) return true
    return false
  }

  return false
}

/**
 * 是否能删除项目
 * - ADMIN: 所有项目
 * - 其他: 仅创建者
 */
export function canDeleteProject(user: PermissionUser | null | undefined, project: PermissionProject): boolean {
  if (!user) return false

  if (user.role === 'ADMIN') return true

  return project.createdById === user.id
}

/**
 * 是否在"我的项目"视图中维护该项目
 * - ADMIN/PARTNER: 不使用"我的项目"过滤，看所有
 * - INVESTMENT_MANAGER: 仅自己创建或作为成员的项目
 * - 其他: 仅自己创建的
 */
export function isMaintainedByUser(user: PermissionUser | null | undefined, project: PermissionProject): boolean {
  if (!user) return false
  if (project.createdById === user.id) return true
  if (project.memberIds.includes(user.id)) return true
  return false
}

/**
 * 是否能发布投资合伙人评价
 * - ADMIN / INVESTMENT_PARTNER
 */
export function canPublishReview(user: PermissionUser | null | undefined): boolean {
  if (!user) return false
  return user.role === 'ADMIN' || user.role === 'INVESTMENT_PARTNER'
}

/**
 * 是否能添加跟进笔记
 * - ADMIN / INVESTMENT_PARTNER / INVESTMENT_MANAGER (维护人)
 */
export function canAddNote(user: PermissionUser | null | undefined, project: PermissionProject): boolean {
  return canEditProject(user, project)
}

/**
 * 是否能审批立项阶段
 * - ADMIN / INVESTMENT_PARTNER
 */
export function canApproveStage(user: PermissionUser | null | undefined): boolean {
  if (!user) return false
  return user.role === 'ADMIN' || user.role === 'INVESTMENT_PARTNER'
}

/**
 * 是否能管理用户（账号管理、注册审批、权限分配）
 * - ADMIN
 */
export function canManageUsers(user: PermissionUser | null | undefined): boolean {
  if (!user) return false
  return user.role === 'ADMIN'
}

/**
 * 是否能看到管理员后台
 */
export function canAccessAdmin(user: PermissionUser | null | undefined): boolean {
  return canManageUsers(user)
}
