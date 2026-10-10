'use client'

/**
 * AI 输出通用富文本渲染（全系统排版统一：分点展示 + 重点加粗 + 表格）
 *
 * - 按换行分点：每行独立成段（AI 按提示词以 1. 2. 3. / - 分点输出）
 * - **加粗** → <strong> 重点提亮（未匹配 ** 时原样展示，兼容旧数据）
 * - markdown 表格（| a | b | 连续行）→ 真表格渲染（thead/tbody/斑马纹/对齐），
 *   解决 AI 输出的对比表按纯文本渲染时竖线错位难看的问题
 * - 空值显示占位符（默认 —）
 */

type Block = { type: 'line'; text: string } | { type: 'table'; rows: string[][] }

/** 逐行解析：连续的 |...| 行聚合为表格块（|---|---| 分隔行跳过） */
function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let tableBuffer: string[][] = []
  const flushTable = () => {
    if (tableBuffer.length > 0) {
      blocks.push({ type: 'table', rows: tableBuffer })
      tableBuffer = []
    }
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) {
      const cells = trimmed.slice(1, -1).split('|').map(c => c.trim())
      // 分隔行（|---|---| 或 |:---:|）跳过
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue
      tableBuffer.push(cells)
    } else {
      flushTable()
      blocks.push({ type: 'line', text: line })
    }
  }
  flushTable()
  return blocks
}

export default function RichText({
  text,
  className = '',
  lineClassName = 'leading-relaxed',
  strongClassName = 'font-bold text-gray-900',
  placeholder = '—',
}: {
  text: string | null | undefined
  className?: string
  lineClassName?: string
  strongClassName?: string
  placeholder?: string
}) {
  const source = (text || '').trim()
  if (!source) return <p className={className}>{placeholder}</p>
  const lines = source.split('\n').filter(l => l.trim())
  const blocks = parseBlocks(lines)

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

  // 纯单行文本（无表格）：内联渲染（可跟随"前缀："同行展示）
  if (blocks.length === 1 && blocks[0].type === 'line') {
    return <span className={className}>{renderInline(blocks[0].text)}</span>
  }

  return (
    <div className={className}>
      {blocks.map((block, i) =>
        block.type === 'table' ? (
          <div key={i} className="my-2 overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr>
                  {(block.rows[0] || []).map((cell, ci) => (
                    <th
                      key={ci}
                      className="border border-gray-200 bg-slate-50 px-2.5 py-1.5 text-left font-bold text-gray-700 whitespace-nowrap"
                    >
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.slice(1).map((row, ri) => {
                  const headerLen = (block.rows[0] || []).length
                  const cells = row.length === headerLen ? row : [...row, ...Array(Math.max(0, headerLen - row.length)).fill('')]
                  return (
                    <tr key={ri} className={ri % 2 === 1 ? 'bg-slate-50/50' : ''}>
                      {cells.map((cell, ci) => (
                        <td key={ci} className="border border-gray-200 px-2.5 py-1.5 text-gray-600 align-top">
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p key={i} className={lineClassName}>
            {renderInline(block.text)}
          </p>
        )
      )}
    </div>
  )
}
