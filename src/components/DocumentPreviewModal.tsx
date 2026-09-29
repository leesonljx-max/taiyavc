'use client'

import { useEffect } from 'react'

interface DocumentPreviewModalProps {
  open: boolean
  onClose: () => void
  fileName: string
  fileUrl: string
  fileType: string
  /** 服务端提取的文档全文（可选）：本地/内网环境无法使用 Office 在线预览时的回退阅览 */
  textContent?: string
}

/** 判断当前是否本地/内网环境（Office Online 无法回源拉取文件） */
function isLocalEnvironment(): boolean {
  if (typeof window === 'undefined') return true
  const h = window.location.hostname
  return (
    h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
    /^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  )
}

/** Office 文档扩展名判定 */
function isOfficeDoc(fileUrl: string, fileType: string): boolean {
  const url = fileUrl.toLowerCase()
  return (
    url.endsWith('.docx') || url.endsWith('.doc') ||
    url.endsWith('.xlsx') || url.endsWith('.xls') ||
    url.endsWith('.pptx') || url.endsWith('.ppt') ||
    fileType.includes('wordprocessing') || fileType.includes('spreadsheet') || fileType.includes('presentation') ||
    fileType.includes('ms-word') || fileType.includes('ms-excel') || fileType.includes('ms-powerpoint')
  )
}

function isTextDoc(fileUrl: string, fileType: string): boolean {
  const url = fileUrl.toLowerCase()
  return url.endsWith('.txt') || url.endsWith('.md') || fileType.startsWith('text/')
}

/**
 * 文档预览模态框
 * - PDF / txt / md：浏览器原生 iframe 预览
 * - Word / Excel / PPT：公网部署环境使用微软 Office Online 在线阅览（原格式渲染）
 *   本地/内网环境回退为提取文本阅览（服务端提取的全文）
 *
 * 模态框尺寸适中（屏幕 80% 宽高），内容区域支持鼠标滚动
 */
export default function DocumentPreviewModal({
  open,
  onClose,
  fileName,
  fileUrl,
  fileType,
  textContent,
}: DocumentPreviewModalProps) {
  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [open, onClose])

  if (!open) return null

  const isPdf = fileType === 'application/pdf' || fileUrl.toLowerCase().endsWith('.pdf')
  const isOffice = isOfficeDoc(fileUrl, fileType)
  const isText = isTextDoc(fileUrl, fileType)
  const local = isLocalEnvironment()

  // Office 在线预览地址（文件需公网可达；/api/uploads 白名单路由无需登录）
  const absoluteUrl = fileUrl.startsWith('http') ? fileUrl : `${window.location.origin}${fileUrl}`
  const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absoluteUrl)}`

  const downloadButton = (large = false) => (
    <a
      href={fileUrl}
      download={fileName}
      className={`inline-flex items-center gap-2 ${large ? 'px-5 py-2.5 bg-primary-500 text-white shadow-md shadow-primary-500/30' : 'px-3 py-1.5 bg-primary-50 text-primary-700'} text-sm font-medium rounded-xl hover:${large ? 'bg-primary-600' : 'bg-primary-100'} transition-colors`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      下载文件
    </a>
  )

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col"
        style={{ width: '80vw', height: '80vh', maxWidth: '1200px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-5 h-5 text-primary-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <h3 className="text-base font-semibold text-gray-900 truncate" title={fileName}>
              {fileName}
            </h3>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href={fileUrl}
              download={fileName}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-50 text-primary-700 text-sm font-medium rounded-lg hover:bg-primary-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              下载
            </a>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="关闭"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 内容区：支持鼠标滚动 */}
        <div className="flex-1 overflow-auto bg-gray-50">
          {isPdf || isText ? (
            /* PDF / txt / md：浏览器原生渲染 */
            <iframe
              src={fileUrl}
              title={fileName}
              className="w-full h-full border-0"
              style={{ minHeight: '100%' }}
            />
          ) : isOffice && !local ? (
            /* Office 文档（公网部署）：微软 Office Online 原格式在线阅览 */
            <div className="flex flex-col h-full">
              <p className="px-4 py-1.5 text-[11px] text-gray-400 bg-white border-b border-gray-100 flex-shrink-0">
                📄 由 Office Online 在线渲染 · 如加载缓慢请稍候或点击右上角下载
              </p>
              <iframe
                src={officeViewerUrl}
                title={fileName}
                className="w-full flex-1 border-0"
              />
            </div>
          ) : isOffice && local && textContent ? (
            /* Office 文档（本地/内网）：提取文本阅览 */
            <div className="flex flex-col h-full">
              <p className="px-4 py-1.5 text-[11px] text-amber-600 bg-amber-50 border-b border-amber-100 flex-shrink-0">
                💡 本地环境以提取文本方式阅览（部署到公网后支持 Word/Excel/PPT 原格式在线预览）
              </p>
              <pre className="flex-1 px-5 py-4 text-xs text-gray-700 whitespace-pre-wrap leading-relaxed font-sans overflow-auto">{textContent}</pre>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <h4 className="text-lg font-semibold text-gray-900 mb-2">
                {isOffice ? '本地环境暂无法在线预览该文档' : '不支持预览的文件类型'}
              </h4>
              <p className="text-sm text-gray-500 mb-6">
                {isOffice ? '请下载后查看，或部署到公网环境使用 Office 在线预览。' : '请下载文件后查看。'}
              </p>
              {downloadButton(true)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
