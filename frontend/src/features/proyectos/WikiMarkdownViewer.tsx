import type { ReactNode } from 'react'

function inlineMarkdown(value: string): ReactNode[] {
  const tokens = value.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return tokens.filter(Boolean).map((token, index) => {
    if (token.startsWith('`') && token.endsWith('`')) return <code key={index}>{token.slice(1, -1)}</code>
    if (token.startsWith('**') && token.endsWith('**')) return <strong key={index}>{token.slice(2, -2)}</strong>
    if (token.startsWith('*') && token.endsWith('*')) return <em key={index}>{token.slice(1, -1)}</em>
    return token
  })
}

/** Lightweight, safe Markdown view for project documentation. HTML is always text. */
export function WikiMarkdownViewer({ content }: { content?: string }) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let listItems: string[] = []

  const flushList = () => {
    if (!listItems.length) return
    blocks.push(<ul key={`list-${blocks.length}`} className="mb-4 ps-4">{listItems.map((item, index) => <li key={index}>{inlineMarkdown(item)}</li>)}</ul>)
    listItems = []
  }

  lines.forEach((line, index) => {
    const list = line.match(/^\s*[-*]\s+(.+)$/)
    if (list) {
      listItems.push(list[1])
      return
    }
    flushList()
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const Tag = `h${heading[1].length}` as 'h1' | 'h2' | 'h3'
      const className = heading[1].length === 1 ? 'h3 fw-bold mt-2 mb-3' : heading[1].length === 2 ? 'h5 fw-bold mt-4 mb-2' : 'h6 fw-bold mt-3 mb-2'
      blocks.push(<Tag key={`heading-${index}`} className={className}>{inlineMarkdown(heading[2])}</Tag>)
    } else if (line.trim()) {
      blocks.push(<p key={`paragraph-${index}`} className="mb-3">{inlineMarkdown(line)}</p>)
    }
  })
  flushList()
  return <div className="markdown-preview text-dark" style={{ lineHeight: '1.75' }}>{blocks}</div>
}
