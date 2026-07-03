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

const RESTRICTED_STAGES: FollowStage[] = ['PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'CLOSING', 'POST_INVESTMENT']
const PUBLIC_STAGES: FollowStage[] = ['INITIAL_TALK']

export function canViewProject(user: PermissionUser | null | undefined, project: PermissionProject): boolean {
  if (!user) return false
  
  if (user.role === 'ADMIN') return true
  
  if (PUBLIC_STAGES.includes(project.followStage as FollowStage)) {
    return true
  }
  
  if (RESTRICTED_STAGES.includes(project.followStage as FollowStage)) {
    if (user.role === 'INVESTMENT_PARTNER') return true
    if (project.memberIds.includes(user.id)) return true
    return false
  }
  
  return true
}

export function canEditProject(user: PermissionUser | null | undefined, project: PermissionProject): boolean {
  if (!user) return false
  
  if (user.role === 'ADMIN') return true
  
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

export function canDeleteProject(user: PermissionUser | null | undefined, project: PermissionProject): boolean {
  if (!user) return false
  
  if (user.role === 'ADMIN') return true
  
  return project.createdById === user.id
}