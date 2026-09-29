'use client'

import { useEffect } from 'react'

interface DocumentPreviewModalProps {
  open: boolean
  onClose: () => void
  fileName: string
  fileUrl: string
  fileType: string
  /** 服务端提取的文档全文（pptx 等无法还原版式格式的文本阅览） */
  textContent?: string
  /** 服务端渲染的 HTML（docx/xlsx 在线阅览，自渲染不依赖外部服务） */
  previewHtml?: string
}

/** 文本类文件判定 */
function isTextDoc(fileUrl: string, fileType: string): boolean {
  const url = fileUrl.toLowerCase()
  return url.endsWith('.txt') || url.endsWith('.md') || fileType.startsWith('text/')
}

/**
 * 文档预览模态框（自渲染，不依赖外部服务，HTTP 公网 IP 部署可用）
 * - PDF / txt / md：浏览器原生 iframe 渲染
 * - Word / Excel：previewHtml（服务端 mammoth / SheetJS 转的 HTML）
 * - PPT 及其他：textContent 提取文本阅览（pptx 按页展示）
 *
 * 模态框尺寸为屏幕 80% 宽高，内容区域支持鼠标滚动
 */
export default function DocumentPreviewModal({
  open,
  onClose,
  fileName,
  fileUrl,
  fileType,
  textContent,
  previewHtml,
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
  const isText = isTextDoc(fileUrl, fileType)

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
          {previewHtml ? (
            /* Word / Excel：服务端渲染的 HTML 在线阅览 */
            <div className="bg-white">
              <style>{`
                .preview-html { padding: 24px 32px; max-width: 100%; }
                .preview-html h1, .preview-html h2, .preview-html h3 { font-weight: 700; margin: 1em 0 0.5em; color: #111827; }
                .preview-html h1 { font-size: 1.25rem; }
                .preview-html h2 { font-size: 1.1rem; }
                .preview-html h3 { font-size: 1rem; }
                .preview-html p { margin: 0.5em 0; font-size: 0.8125rem; line-height: 1.75; color: #374151; }
                .preview-html ul, .preview-html ol { padding-left: 1.5em; margin: 0.5em 0; }
                .preview-html li { font-size: 0.8125rem; line-height: 1.6; color: #374151; margin: 0.25em 0; }
                .preview-html table { border-collapse: collapse; margin: 0.75em 0; max-width: 100%; }
                .preview-html th, .preview-html td { border: 1px solid #e5e7eb; padding: 4px 10px; font-size: 0.75rem; color: #374151; white-space: nowrap; }
                .preview-html img { max-width: 100%; }
              `}</style>
              <div className="preview-html" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          ) : isPdf || isText ? (
            /* PDF / txt / md：浏览器原生渲染 */
            <iframe
              src={fileUrl}
              title={fileName}
              className="w-full h-full border-0"
              style={{ minHeight: '100%' }}
            />
          ) : textContent ? (
            /* PPT 及其他：提取文本阅览（pptx 按页展示） */
            <div className="flex flex-col h-full">
              <p className="px-4 py-1.5 text-[11px] text-amber-600 bg-amber-50 border-b border-amber-100 flex-shrink-0">
                💡 该格式以提取文本方式阅览（PPT 按页展示文字内容）
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
              <h4 className="text-lg font-semibold text-gray-900 mb-2">该文件暂无可阅览的内容</h4>
              <p className="text-sm text-gray-500 mb-6">请下载文件后查看，或联系维护人重新上传可提取文本的版本。</p>
              <a
                href={fileUrl}
                download={fileName}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-500 text-white text-sm font-medium rounded-xl shadow-md shadow-primary-500/30 hover:bg-primary-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                下载文件
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
