'use client'

/**
 * 项目解读（一级栏目）
 *
 * 上传 BP（可同时上传访谈纪要）→ 七维解读 + 融资案例智能匹配 → 问题清单 → 访谈校验 → 综合结论
 * 结论生成后可一键闭环创建到项目库（AI 按项目库模板截取 BP 关键信息）
 */

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import ProjectInterpretationPanel from '@/components/ai-research/ProjectInterpretationPanel'

export default function ProjectInterpretationPage() {
  const { status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login?callbackUrl=/project-interpretation')
    }
  }, [status, router])

  if (status !== 'authenticated') {
    return (
      <DashboardLayout title="项目解读" subtitle="加载中...">
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout
      title="项目解读"
      subtitle="上传 BP 与访谈纪要 · 固定框架解读 · 闭环创建到项目库"
    >
      <ProjectInterpretationPanel />
    </DashboardLayout>
  )
}
