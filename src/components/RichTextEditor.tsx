'use client'

import { useRef, useEffect, useState } from 'react'

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  rows?: number
  className?: string
}

/**
 * 富文本编辑器：支持粘贴截图（图片）+ 文字编辑
 * - 粘贴图片时自动上传到 /api/upload/image，插入 <img> 标签
 * - 粘贴文字时正常插入
 * - 输出 HTML 字符串
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder = '请输入内容，可粘贴截图',
  rows = 3,
  className = '',
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [uploading, setUploading] = useState(false)
  // 标记是否正在通过程序设置内容（避免 onChange 循环触发）
  const isSettingContent = useRef(false)

  // 同步外部 value 到编辑器（仅当 value 与编辑器内容不一致时）
  useEffect(() => {
    if (!editorRef.current) return
    if (isSettingContent.current) {
      isSettingContent.current = false
      return
    }
    const currentHtml = editorRef.current.innerHTML
    if (value !== currentHtml) {
      editorRef.current.innerHTML = value || ''
    }
  }, [value])

  // 触发 onChange
  const emitChange = () => {
    if (!editorRef.current) return
    onChange(editorRef.current.innerHTML)
  }

  // 上传图片并插入到编辑器
  const uploadAndInsertImage = async (file: File) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload/image', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || '图片上传失败')
        return
      }
      // 插入图片到光标位置
      const img = document.createElement('img')
      img.src = data.url
      img.alt = '截图'
      img.style.maxWidth = '100%'
      img.style.height = 'auto'
      img.style.borderRadius = '8px'
      img.style.margin = '4px 0'
      img.style.display = 'block'

      // 恢复光标位置并插入
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0 && editorRef.current?.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0)
        range.deleteContents()
        range.insertNode(img)
        // 移动光标到图片后面
        range.setStartAfter(img)
        range.collapse(true)
        selection.removeAllRanges()
        selection.addRange(range)
      } else {
        // 没有保存光标位置，追加到末尾
        editorRef.current?.appendChild(img)
      }
      emitChange()
    } catch (error) {
      console.error('Image upload error:', error)
      alert('图片上传失败')
    } finally {
      setUploading(false)
    }
  }

  // 处理粘贴事件
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    // 检查是否有图片
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          uploadAndInsertImage(file)
        }
        return
      }
    }

    // 普通文字粘贴：默认行为，但同步到 onChange
    // 使用 setTimeout 确保 DOM 更新后再读取内容
    setTimeout(() => emitChange(), 0)
  }

  // 处理输入事件
  const handleInput = () => {
    emitChange()
  }

  // 阻止拖拽图片的默认行为（避免浏览器直接显示 data URL）
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent) => {
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return
    e.preventDefault()
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.type.startsWith('image/')) {
        uploadAndInsertImage(file)
      }
    }
  }

  // 计算最小高度
  const minHeight = `${rows * 2.5}rem`

  return (
    <div className={`relative ${className}`}>
      <div
        ref={editorRef}
        contentEditable
        onPaste={handlePaste}
        onInput={handleInput}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        data-placeholder={placeholder}
        className="w-full px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth prose prose-sm max-w-none overflow-auto"
        style={{ minHeight }}
        suppressContentEditableWarning
      />
      {uploading && (
        <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 bg-primary-50 text-primary-700 rounded-lg text-xs">
          <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          上传图片中...
        </div>
      )}
      <style jsx>{`
        [contenteditable][data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
        }
        [contenteditable] img {
          max-width: 100%;
          height: auto;
          border-radius: 8px;
          margin: 4px 0;
          display: block;
        }
      `}</style>
    </div>
  )
}
