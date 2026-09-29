/**
 * 尽调工作台 v2：模块资料中心共用工具
 *
 * DDModuleResource（projectId × moduleKey 唯一）承载九大模块的
 * 文档/文本框/截图与分模块 AI 报告；本模块提供 JSON 解析与完整性判断。
 */

import prisma from '@/lib/prisma'
import { DD_TEMPLATE_MODULES } from './template'

// ── JSON 字段结构 ──

export interface DDResourceDoc {
  id: string
  fileName: string
  fileUrl: string
  fileType: string
  fileSize: number
  /** 上传时提取的文档全文（报告生成输入） */
  text: string
  uploadedAt: string
}

export interface DDTextBlock {
  id: string
  content: string
  createdAt: string
}

export interface DDScreenshot {
  id: string
  url: string
  fileName: string
  uploadedAt: string
}

export interface DDModuleReport {
  summary: string
  opportunities: string[]
  risks: string[]
  generatedAt: string
}

/** 解析后的模块资料 */
export interface ParsedModuleResource {
  moduleKey: string
  moduleName: string
  documents: DDResourceDoc[]
  textBlocks: DDTextBlock[]
  screenshots: DDScreenshot[]
  report: DDModuleReport | null
  updatedAt: string
}

function safeParseArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as T[]) : []
  } catch {
    return []
  }
}

/** 模块是否资料完整（任一：文档 ≥1 / 非空文本框 ≥1 / 截图 ≥1） */
export function isModuleComplete(res: Pick<ParsedModuleResource, 'documents' | 'textBlocks' | 'screenshots'>): boolean {
  return (
    res.documents.length > 0 ||
    res.screenshots.length > 0 ||
    res.textBlocks.some(t => t.content.trim().length > 0)
  )
}

/** 完整性检查：返回缺失模块名列表（全部完整时为空） */
export function findMissingModules(resources: ParsedModuleResource[]): string[] {
  return resources.filter(r => !isModuleComplete(r)).map(r => r.moduleName)
}

/** 报告是否已生成（九大模块全部有 reportJson） */
export function isReportReady(resources: ParsedModuleResource[]): boolean {
  return resources.length === DD_TEMPLATE_MODULES.length && resources.every(r => r.report !== null)
}

/** 读取项目九大模块资料（无记录的模块补空壳，顺序与模板一致） */
export async function getProjectModuleResources(projectId: string): Promise<ParsedModuleResource[]> {
  const records = await prisma.dDModuleResource.findMany({ where: { projectId } })
  const byKey = new Map(records.map(r => [r.moduleKey, r]))

  return DD_TEMPLATE_MODULES.map(tpl => {
    const r = byKey.get(tpl.key)
    const documents = safeParseArray<DDResourceDoc>(r?.documents)
    const textBlocks = safeParseArray<DDTextBlock>(r?.textBlocks)
    const screenshots = safeParseArray<DDScreenshot>(r?.screenshots)
    let report: DDModuleReport | null = null
    if (r?.reportJson) {
      try {
        const parsed = JSON.parse(r.reportJson) as DDModuleReport
        if (parsed && typeof parsed.summary === 'string') report = parsed
      } catch { report = null }
    }
    return {
      moduleKey: tpl.key,
      moduleName: tpl.name,
      documents,
      textBlocks,
      screenshots,
      report,
      updatedAt: (r?.updatedAt || new Date()).toISOString(),
    }
  })
}

/** 获取或创建模块资料记录（供上传/保存 upsert 用） */
export async function upsertModuleResource(projectId: string, moduleKey: string) {
  return prisma.dDModuleResource.upsert({
    where: { projectId_moduleKey: { projectId, moduleKey } },
    create: { projectId, moduleKey },
    update: {},
  })
}

/** 校验 moduleKey 是九大模块之一 */
export function isValidModuleKey(moduleKey: string): boolean {
  return DD_TEMPLATE_MODULES.some(m => m.key === moduleKey)
}
