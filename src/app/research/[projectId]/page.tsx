'use client'

/**
 * 项目尽调 · 项目详情页
 *
 * v2：页面仅保留尽调工作台（DDWorkbenchShell）——
 * 九大模块资料中心（3D 翻转）+ 分模块尽调报告 + 第 10 模块投资决策
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/DashboardLayout'
import { SkillPanelLauncher } from '@/components/SkillPanel'
import DDWorkbenchShell from '@/components/dd-workbench/DDWorkbenchShell'

interface ResearchProject {
  id: string
  name: string
  companyFullName: string | null
  industry: string | null
  createdById: string
  members: { userId: string }[]
  /** 服务端计算：当前用户是否维护人（主维护人/辅助维护人） */
  isMaintainer?: boolean
}

export default function ResearchDetailPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const { data: session, status } = useSession()

  const [project, setProject] = useState<ResearchProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/research/${params.projectId}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '加载失败')
        return
      }
      setProject(data.project)
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }, [params.projectId])

  useEffect(() => {
    if (status !== 'authenticated') return
    fetchData()
  }, [status, fetchData])

  if (status === 'loading' || loading) {
    return (
      <DashboardLayout title="项目尽调" subtitle="加载中...">
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  if (error || !project) {
    return (
      <DashboardLayout title="项目尽调">
        <div className="py-20 text-center">
          <p className="text-danger-600 mb-4">{error || '项目不存在'}</p>
          <button onClick={() => router.push('/research')} className="px-4 py-2 bg-primary-500 text-white rounded-lg">
            返回尽调列表
          </button>
        </div>
      </DashboardLayout>
    )
  }

  const canEdit =
    (session?.user?.role as string) === 'ADMIN' ||
    (session?.user?.role as string) === 'INVESTMENT_PARTNER' ||
    project.createdById === (session?.user?.id as string) ||
    project.isMaintainer === true

  return (
    <DashboardLayout
      title={`项目尽调 - ${project.name}`}
      subtitle={project.companyFullName || project.industry || ''}
      actions={
        <div className="flex gap-2">
          <SkillPanelLauncher />
          <button
            onClick={() => router.push(`/projects/${params.projectId}`)}
            className="px-3 py-1.5 bg-white border border-primary-200 text-primary-700 text-sm rounded-lg hover:bg-primary-50 font-medium"
          >
            项目详情
          </button>
          <button
            onClick={() => router.back()}
            className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200"
          >
            ← 返回
          </button>
        </div>
      }
    >
      {/* 页面仅保留尽调工作台：模块资料中心（3D 翻转）+ 分模块报告 + 投资决策 */}
      <DDWorkbenchShell
        projectId={params.projectId}
        projectName={project.name}
        canEdit={canEdit}
        userRole={(session?.user?.role as string) || ''}
      />
    </DashboardLayout>
  )
}
