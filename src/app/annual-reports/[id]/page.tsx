'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import PersonalReport from '@/components/annual-report/PersonalReport'
import CompanyReport from '@/components/annual-report/CompanyReport'
import type { AnnualReportData, AnnualReportStatus, AnnualReportType } from '@/lib/annual-report/types'
import { toPng } from 'html-to-image'
import JSZip from 'jszip'
import '../report.css'

interface ReportSummary {
  id: string
  year: number
  type: AnnualReportType
  status: AnnualReportStatus
  phase: string | null
  progress: number
  pageCount: number
  error?: string | null
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function phaseText(report: ReportSummary | null): string {
  if (!report) return '读取中…'
  if (report.status === 'QUEUED') return '已进入队列，等待生成…'
  if (report.status === 'FAILED') return report.error || '生成失败'
  if (report.status === 'READY') return '报告已生成'
  if (report.phase === 'RESEARCHING') return `正在检索公开融资进展… ${report.progress}%`
  if (report.phase === 'COMPOSING') return `正在生成年度摘要… ${report.progress}%`
  return `正在汇总年度数据… ${report.progress}%`
}

function safeName(raw: string): string {
  return raw.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '')
}

export default function AnnualReportViewerPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [report, setReport] = useState<ReportSummary | null>(null)
  const [data, setData] = useState<AnnualReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [mode, setMode] = useState<'IMAGE' | 'VECTOR'>('IMAGE')
  const [scale, setScale] = useState(0.5)
  const [zipBusy, setZipBusy] = useState(false)

  const captureRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const autoTriedRef = useRef(false)

  const fileNameBase = useMemo(() => {
    if (!data) return '泰亚投资_年度报告'
    const edition = data.meta.type === 'PERSONAL' ? data.meta.ownerName : '公司版'
    return safeName(`泰亚投资_${data.meta.year}年度报告_${edition}`)
  }, [data])

  // 拉取详情；未生成完成时轮询状态
  useEffect(() => {
    if (!id) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const load = async () => {
      try {
        const response = await fetch(`/api/annual-reports/${id}`, { cache: 'no-store' })
        const body = await response.json()
        if (cancelled) return
        if (!response.ok) throw new Error(body.error || '获取年报失败')
        setReport(body.report as ReportSummary)
        if (body.report?.status === 'READY' && body.data) {
          setData(body.data as AnnualReportData)
          setLoading(false)
          return
        }
        setLoading(false)
        if (body.report?.status === 'QUEUED' || body.report?.status === 'GENERATING') {
          timer = setTimeout(load, 3000)
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '获取年报失败')
        setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [id])

  // 预览缩放：按容器宽度等比缩放 1080 宽页面
  useEffect(() => {
    const node = previewRef.current
    if (!node) return
    const update = () => {
      const width = node.clientWidth
      setScale(width > 0 ? Math.min(1, width / 1080) : 0.5)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [data, mode])

  const exportImages = useCallback(async () => {
    if (!data) return
    setExporting(true)
    setExportProgress(0)
    setError('')
    try {
      await document.fonts?.ready
      const nodes = Array.from(
        captureRef.current?.querySelectorAll<HTMLElement>('[data-report-page]') ?? []
      )
      if (nodes.length === 0) throw new Error('未找到报告页面')
      const urls: string[] = []
      for (let index = 0; index < nodes.length; index += 1) {
        const url = await toPng(nodes[index], {
          pixelRatio: 2,
          width: 1080,
          height: 1440,
          backgroundColor: index === 0 ? '#0B1A2F' : '#FCF8F0',
          cacheBust: true,
          style: { transform: 'none', margin: '0', boxShadow: 'none' },
        })
        urls.push(url)
        setExportProgress(index + 1)
        // 让出主线程，避免连续截图造成页面卡顿
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      setImages(urls)
      setMode('IMAGE')
    } catch (err) {
      console.error('Annual report image export failed:', err)
      setError(`图片生成失败：${err instanceof Error ? err.message : '未知错误'}。已切换为排版预览，可稍后重试。`)
      setMode('VECTOR')
    } finally {
      setExporting(false)
    }
  }, [data])

  useEffect(() => {
    if (!data || autoTriedRef.current) return
    autoTriedRef.current = true
    const timer = setTimeout(() => {
      void exportImages()
    }, 400)
    return () => clearTimeout(timer)
  }, [data, exportImages])

  const downloadOne = (url: string, index: number) => {
    const link = document.createElement('a')
    link.href = url
    link.download = `${fileNameBase}_${pad(index + 1)}.png`
    link.click()
  }

  const downloadZip = async () => {
    if (images.length === 0) return
    setZipBusy(true)
    try {
      const zip = new JSZip()
      images.forEach((url, index) => {
        const base64 = url.split(',')[1]
        if (base64) zip.file(`${fileNameBase}_${pad(index + 1)}.png`, base64, { base64: true })
      })
      const blob = await zip.generateAsync({ type: 'blob' })
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `${fileNameBase}_图片版.zip`
      link.click()
      setTimeout(() => URL.revokeObjectURL(href), 4000)
    } catch (err) {
      setError(`打包下载失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setZipBusy(false)
    }
  }

  const actions = data ? (
    <div className="flex items-center gap-2">
      {images.length > 0 && (
        <button
          type="button"
          onClick={() => void downloadZip()}
          disabled={zipBusy}
          className="px-3 py-1.5 rounded-lg text-[13px] font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {zipBusy ? '打包中…' : `下载全部图片（${images.length} 页）`}
        </button>
      )}
      <button
        type="button"
        onClick={() => void exportImages()}
        disabled={exporting}
        className="px-3 py-1.5 rounded-lg text-[13px] border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
      >
        {exporting ? `生成图片 ${exportProgress}/${data.meta.pageCount}` : '重新生成图片'}
      </button>
      <button
        type="button"
        onClick={() => setMode(mode === 'IMAGE' ? 'VECTOR' : 'IMAGE')}
        disabled={images.length === 0 && mode === 'IMAGE'}
        className="px-3 py-1.5 rounded-lg text-[13px] border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
      >
        {mode === 'IMAGE' ? '查看排版' : '查看图片'}
      </button>
    </div>
  ) : null

  return (
    <DashboardLayout
      title={data ? `${data.meta.year} 年度报告` : '年度报告'}
      subtitle={data ? `${data.meta.scopeLabel} · ${data.meta.ownerName} · 共 ${data.meta.pageCount} 页` : '正在加载年报…'}
      back
      actions={actions}
    >
      {loading && (
        <div className="max-w-3xl mx-auto py-20 text-center">
          <div className="inline-block w-10 h-10 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
          <p className="mt-4 text-sm text-gray-500">正在读取年报…</p>
        </div>
      )}

      {!loading && !data && (
        <div className="max-w-xl mx-auto py-16 text-center">
          <div className="text-4xl mb-4">📄</div>
          <h2 className="text-lg font-semibold mb-2">
            {report?.status === 'FAILED' ? '年报生成失败' : '年报正在生成'}
          </h2>
          <p className="text-sm text-gray-500 leading-6">{phaseText(report)}</p>
          {report && (report.status === 'QUEUED' || report.status === 'GENERATING') && (
            <div className="mt-6 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full bg-primary-500 transition-all"
                style={{ width: `${Math.max(6, report.progress)}%` }}
              />
            </div>
          )}
          {report?.status === 'FAILED' && (
            <p className="mt-4 text-[12px] text-gray-400">
              可返回工作台点击「重试生成」，已完成的阶段数据不会丢失。
            </p>
          )}
        </div>
      )}

      {error && data && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-700">
          {error}
        </div>
      )}

      {data && (
        <div>
          {exporting && (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] text-blue-700">
              正在把 {data.meta.pageCount} 页报告渲染为 2160 × 2880 高清图片（{exportProgress}/{data.meta.pageCount}），
              完成后可直接下载或打包。
            </div>
          )}

          {mode === 'IMAGE' && images.length > 0 && (
            <div className="max-w-[860px] mx-auto">
              {images.map((url, index) => (
                <div key={index} className="ar-page-frame group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`${data.meta.year} 年度报告第 ${index + 1} 页`} />
                  <button
                    type="button"
                    onClick={() => downloadOne(url, index)}
                    className="absolute right-3 top-3 text-[11px] px-2.5 py-1 rounded-md bg-black/55 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    下载第 {index + 1} 页
                  </button>
                </div>
              ))}
            </div>
          )}

          {mode === 'VECTOR' && (
            <div ref={previewRef} className="max-w-[860px] mx-auto">
              <div style={{ height: 1440 * scale * data.meta.pageCount + 28 * data.meta.pageCount }}>
                <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: 1080 }}>
                  {data.meta.type === 'PERSONAL' ? <PersonalReport data={data} /> : <CompanyReport data={data} />}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 高清截图用的离屏全尺寸渲染（不显示给用户） */}
      {data && (
        <div
          ref={captureRef}
          aria-hidden
          style={{ position: 'fixed', left: '-12000px', top: 0, width: '1080px', pointerEvents: 'none' }}
        >
          {data.meta.type === 'PERSONAL' ? <PersonalReport data={data} /> : <CompanyReport data={data} />}
        </div>
      )}
    </DashboardLayout>
  )
}
