import type { AnnualReport } from '@prisma/client'

export interface AnnualReportSummary {
  id: string
  year: number
  type: string
  ownerKey: string
  ownerId: string | null
  status: string
  phase: string | null
  progress: number
  version: number
  pageCount: number
  generatedAt: Date | null
  createdAt: Date
  error: string | null
  theme?: string
  overview?: string
  keywords?: string[]
}

export function toReportSummary(report: AnnualReport): AnnualReportSummary {
  let extra: { theme?: string; overview?: string; keywords?: string[] } = {}
  if (report.summaryJson) {
    try {
      extra = JSON.parse(report.summaryJson)
    } catch {
      extra = {}
    }
  }
  return {
    id: report.id,
    year: report.year,
    type: report.type,
    ownerKey: report.ownerKey,
    ownerId: report.ownerId,
    status: report.status,
    phase: report.phase,
    progress: report.progress,
    version: report.version,
    pageCount: report.pageCount,
    generatedAt: report.generatedAt,
    createdAt: report.createdAt,
    error: report.error,
    ...extra,
  }
}
