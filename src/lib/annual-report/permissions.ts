/**
 * 年度报告权限
 */

import type { UserRole } from '@/lib/auth'
import type { AnnualReportType } from './types'

export function canGenerateReport(type: AnnualReportType, role: UserRole): boolean {
  if (role === 'TEMP_VISITOR') return false
  if (type === 'COMPANY') return role === 'ADMIN' || role === 'INVESTMENT_PARTNER'
  return true
}

/** 公司版：内部员工可读（临时访客不可读） */
export function canViewCompanyReport(role: UserRole): boolean {
  return role !== 'TEMP_VISITOR'
}

/** 个人版：本人、管理员、合伙人可读 */
export function canViewPersonalReport(role: UserRole, ownerId: string | null, userId: string): boolean {
  return ownerId === userId || role === 'ADMIN' || role === 'INVESTMENT_PARTNER'
}

export function canViewReport(
  report: { type: string; ownerId: string | null },
  role: UserRole,
  userId: string
): boolean {
  if (report.type === 'COMPANY') return canViewCompanyReport(role)
  return canViewPersonalReport(role, report.ownerId, userId)
}
