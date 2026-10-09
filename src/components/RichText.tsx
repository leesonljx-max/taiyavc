'use client'

/**
 * AI 输出通用富文本渲染（全系统排版统一：分点展示 + 重点加粗）
 *
 * - 按换行分点：每行独立成段（AI 按提示词以 1. 2. 3. / - 分点输出）
 * - **加粗** → <strong> 重点提亮（未匹配 ** 时原样展示，兼容旧数据）
 * - 空值显示占位符（默认 —）
 */
export default function RichText({
  text,
  className = '',
  lineClassName = 'leading-relaxed',
  strongClassName = 'font-bold text-gray-900',
  placeholder = '—',
}: {
  text: string | null | undefined
  /** 容器样式（字号/颜色/间距由调用方给） */
  className?: string
  /** 每行段落样式 */
  lineClassName?: string
  /** 加粗提亮样式 */
  strongClassName?: string
  /** 空值占位 */
  placeholder?: string
}) {
  const source = (text || '').trim()
  if (!source) return <p className={className}>{placeholder}</p>
  const lines = source.split('\n').filter(l => l.trim())

  const renderInline = (line: string) =>
    line.split(/\*\*(.+?)\*\*/g).map((part, j) =>
      j % 2 === 1 ? (
        <strong key={j} className={strongClassName}>
          {part}
        </strong>
      ) : (
        <span key={j}>{part}</span>
      )
    )

  // 单行文本：内联渲染（可跟随"前缀："同行展示）
  if (lines.length === 1) {
    return <span className={className}>{renderInline(lines[0])}</span>
  }
  // 多行分点：块级渲染（每行独立成段）
  return (
    <div className={className}>
      {lines.map((line, i) => (
        <p key={i} className={lineClassName}>
          {renderInline(line)}
        </p>
      ))}
    </div>
  )
}
