/**
 * 研究与报告版本指纹
 *
 * 目的：资料/项目未变化时直接复用已有结果，避免每次点击都重新检索与生成；
 * 仅当项目字段、上传资料、非分类资料或模板版本变化时才产生新版本。
 */

import crypto from 'crypto'
import prisma from '@/lib/prisma'
import { DD_DECK_VERSION, DD_RESEARCH_VERSION } from './constants'
import type { DeckType } from '@/lib/dd-deck/spec'

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)
}

function docIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr)
      ? arr.map((d: { id?: unknown }) => String(d?.id || '')).filter(Boolean).sort()
      : []
  } catch {
    return []
  }
}

export async function computeResearchFingerprint(projectId: string): Promise<string> {
  const [project, resources, assets] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        name: true,
        companyFullName: true,
        industry: true,
        companyPosition: true,
        mainProducts: true,
        financingRound: true,
        totalAmount: true,
        investmentValuation: true,
        coreAdvantage: true,
        coreTeam: true,
        competitors: true,
        description: true,
      },
    }),
    prisma.dDModuleResource.findMany({
      where: { projectId },
      select: { moduleKey: true, documents: true },
    }),
    prisma.dDUnclassifiedAsset.findMany({
      where: { projectId },
      select: { id: true, contentHash: true, moduleKey: true, status: true },
    }),
  ])
  if (!project) throw new Error('项目不存在')

  return hash({
    v: DD_RESEARCH_VERSION,
    project,
    resources: resources
      .map(r => ({ moduleKey: r.moduleKey, docs: docIds(r.documents) }))
      .sort((a, b) => a.moduleKey.localeCompare(b.moduleKey)),
    assets: assets
      .map(a => ({ id: a.id, hash: a.contentHash, moduleKey: a.moduleKey, status: a.status }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  })
}

export async function latestResearchRun(projectId: string) {
  return prisma.dDResearchRun.findFirst({
    where: { projectId, status: { in: ['DONE', 'PARTIAL'] } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      inputFingerprint: true,
      status: true,
      finishedAt: true,
      createdAt: true,
    },
  })
}

/** 深度报告额外签名：文档正文、截图与人工结论变化都应触发新版本 */
async function computeDeepResourceSignature(projectId: string): Promise<unknown> {
  const resources = await prisma.dDModuleResource.findMany({
    where: { projectId },
    select: { moduleKey: true, documents: true, screenshots: true, conclusion: true },
  })

  return resources.map(resource => {
    let docs: Array<{ id: string; fileName: string; len: number; head: string; tail: string }> = []
    try {
      const parsed = resource.documents ? JSON.parse(resource.documents) : []
      if (Array.isArray(parsed)) {
        docs = parsed.map((doc: { id?: unknown; fileName?: unknown; text?: unknown }) => {
          const text = typeof doc?.text === 'string' ? doc.text : ''
          return {
            id: String(doc?.id || ''),
            fileName: String(doc?.fileName || ''),
            len: text.length,
            head: text.slice(0, 200),
            tail: text.slice(-200),
          }
        })
      }
    } catch {
      docs = []
    }

    let shots: string[] = []
    try {
      const parsed = resource.screenshots ? JSON.parse(resource.screenshots) : []
      shots = Array.isArray(parsed)
        ? parsed.map((shot: { id?: unknown; url?: unknown }) => String(shot?.url || shot?.id || '')).filter(Boolean)
        : []
    } catch {
      shots = []
    }

    return {
      moduleKey: resource.moduleKey,
      docs,
      shots,
      conclusionLen: (resource.conclusion || '').length,
    }
  }).sort((a, b) => a.moduleKey.localeCompare(b.moduleKey))
}

/** 报告指纹：研究结果 + 模块资料更新时间（模块报告/上传资料变化都会触发新版本） */
export async function computeDeckFingerprint(
  projectId: string,
  type: DeckType
): Promise<{ fingerprint: string; researchRunId: string | null; researchFingerprint: string }> {
  const [researchFingerprint, run, resources, deepSignature] = await Promise.all([
    computeResearchFingerprint(projectId),
    latestResearchRun(projectId),
    prisma.dDModuleResource.findMany({
      where: { projectId },
      select: { moduleKey: true, updatedAt: true },
    }),
    type === 'DEEP' ? computeDeepResourceSignature(projectId) : Promise.resolve(null),
  ])

  const fingerprint = hash({
    v: DD_DECK_VERSION,
    type,
    researchFingerprint,
    researchRunId: run?.id || null,
    researchFinishedAt: run?.finishedAt?.toISOString() || null,
    resources: resources
      .map(r => ({ moduleKey: r.moduleKey, updatedAt: r.updatedAt.toISOString() }))
      .sort((a, b) => a.moduleKey.localeCompare(b.moduleKey)),
    ...(type === 'DEEP' ? { deepSignature } : {}),
  })

  return { fingerprint, researchRunId: run?.id || null, researchFingerprint }
}
