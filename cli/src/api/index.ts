/**
 * 业务 API —— 与主项目接口一一对应
 */

import { request } from './client.js'
import type { DashboardData, ProjectDetail, ProjectListItem, SessionUser } from '../types.js'

/** 工作台仪表盘（周统计） */
export function fetchDashboard(): Promise<DashboardData> {
  return request<DashboardData>('/api/dashboard')
}

/** 项目列表（scope=all 项目库 / scope=mine 我的项目） */
export function fetchProjects(scope: 'all' | 'mine' = 'all'): Promise<{ projects: ProjectListItem[] }> {
  return request<{ projects: ProjectListItem[] }>(`/api/projects?scope=${scope}`)
}

/** 项目详情 */
export function fetchProjectDetail(id: string): Promise<{ project: ProjectDetail }> {
  return request<{ project: ProjectDetail }>(`/api/projects/${id}`)
}

/** 当前会话用户 */
export function fetchSession(): Promise<{ user?: SessionUser }> {
  return request<{ user?: SessionUser }>('/api/auth/session')
}

/** 按名称模糊查找项目（本地过滤，数据量小无需服务端搜索） */
export async function findProjectByName(keyword: string, scope: 'all' | 'mine' = 'all'): Promise<ProjectListItem | null> {
  const { projects } = await fetchProjects(scope)
  const kw = keyword.trim().toLowerCase()
  // 精确匹配 > 前缀匹配 > 包含匹配
  const exact = projects.find(p => p.name.toLowerCase() === kw)
  if (exact) return exact
  const prefix = projects.find(p => p.name.toLowerCase().startsWith(kw))
  if (prefix) return prefix
  const contains = projects.find(
    p =>
      p.name.toLowerCase().includes(kw) ||
      (p.companyFullName ?? '').toLowerCase().includes(kw)
  )
  return contains ?? null
}
