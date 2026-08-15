import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

export function safeMarkdownUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : ''
  } catch {
    return ''
  }
}

const components: Components = {
  a: ({ children, href }) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-accent underline decoration-accent/50 underline-offset-2 hover:text-accent-hover"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-line-strong pl-3 text-fg-subtle">{children}</blockquote>
  ),
  code: ({ children, className }) => (
    <code
      className={cn(
        'rounded bg-elevated px-1 py-0.5 font-mono text-[12px] text-fg',
        className
      )}
    >
      {children}
    </code>
  ),
  h1: ({ children }) => <h1 className="text-lg font-semibold text-fg">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold text-fg">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold text-fg">{children}</h3>,
  hr: () => <hr className="border-line" />,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  p: ({ children }) => <p className="min-h-[1.25em]">{children}</p>,
  pre: ({ children }) => (
    <pre className="max-w-full overflow-x-auto rounded bg-bg p-2 font-mono text-[12px] leading-5 text-fg-muted">
      {children}
    </pre>
  ),
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  table: ({ children }) => (
    <table className="block max-w-full overflow-x-auto border-collapse text-left text-[12px]">{children}</table>
  ),
  td: ({ children }) => <td className="border border-line px-2 py-1">{children}</td>,
  th: ({ children }) => <th className="border border-line-strong bg-elevated px-2 py-1 font-medium text-fg">{children}</th>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>
}

interface MarkdownMessageProps {
  text: string
  className?: string
  streaming?: boolean
}

export function MarkdownMessage({ text, className, streaming = false }: MarkdownMessageProps): JSX.Element {
  return (
    <div className={cn('markdown-message min-w-0 space-y-2 text-[13px] leading-5', className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeMarkdownUrl}
        components={components}
      >
        {text}
      </Markdown>
      {streaming && (
        <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-fg-subtle" />
      )}
    </div>
  )
}
