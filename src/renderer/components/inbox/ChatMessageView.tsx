import { memo, useEffect, useRef, useState, type MouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronRight,
  CircleDashed,
  Info,
  LoaderCircle,
  Wrench,
  X,
} from 'lucide-react'
import type { ChatMessage, ChatPart } from '@shared/types'
import { toolSummary } from '@/lib/chat'
import { externalLinkUrl } from '@/lib/file-viewer'
import { markdownPreviewExtensions } from '@/lib/markdown-extensions'
import { cn } from '@/lib/utils'

/** Streaming text is re-parsed at most this often. */
const MARKDOWN_UPDATE_MS = 120

/** Read-only Markdown for assistant text; links open in the browser after the main process checks them. */
export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }): JSX.Element {
  const editor = useEditor(
    {
      extensions: markdownPreviewExtensions,
      content: text,
      contentType: 'markdown',
      editable: false,
      injectCSS: false,
      editorProps: { attributes: { class: 'markdown-prose chat-markdown', 'aria-label': 'Assistant message' } },
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
    },
    [],
  )
  const latest = useRef(text)
  latest.current = text

  useEffect(() => {
    const timer = window.setTimeout(() => {
      editor.commands.setContent(latest.current, { contentType: 'markdown', emitUpdate: false })
    }, MARKDOWN_UPDATE_MS)
    return () => window.clearTimeout(timer)
  }, [text, editor])

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const href = (event.target as HTMLElement).closest('a')?.getAttribute('href')
    if (!href) return
    event.preventDefault()
    const external = externalLinkUrl(href)
    if (external) window.open(external, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="min-w-0 text-[14px] leading-relaxed text-fg" onClick={onClick}>
      <EditorContent editor={editor} />
    </div>
  )
})

function Disclosure({
  summary,
  icon,
  children,
  tone = 'muted',
  defaultOpen = false,
  testId,
}: {
  summary: React.ReactNode
  icon: React.ReactNode
  children: React.ReactNode
  tone?: 'muted' | 'danger'
  defaultOpen?: boolean
  testId?: string
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div data-testid={testId} className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'group flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-hover',
          tone === 'danger' ? 'text-danger' : 'text-fg-muted hover:text-fg',
        )}
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} />
        {icon}
        <span className="min-w-0 flex-1 truncate">{summary}</span>
      </button>
      {open && <div className="ml-[1.4rem] mt-1 min-w-0">{children}</div>}
    </div>
  )
}

function CodeBlock({ label, text }: { label: string; text: string }): JSX.Element {
  return (
    <div className="mb-1.5 min-w-0">
      <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-bg px-2.5 py-2 font-mono text-[12px] leading-snug text-fg-muted">
        {text}
      </pre>
    </div>
  )
}

function ToolIcon({ status }: { status: Extract<ChatPart, { kind: 'tool' }>['status'] }): JSX.Element {
  if (status === 'completed') return <Check className="h-3.5 w-3.5 shrink-0 text-ok" />
  if (status === 'error') return <X className="h-3.5 w-3.5 shrink-0 text-danger" />
  if (status === 'running') return <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
  return <CircleDashed className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
}

export function ToolCallView({ part, directory }: { part: Extract<ChatPart, { kind: 'tool' }>; directory: string }): JSX.Element {
  return (
    <Disclosure
      testId={`chat-tool-${part.id}`}
      icon={<ToolIcon status={part.status} />}
      tone={part.status === 'error' ? 'danger' : 'muted'}
      summary={
        <>
          {toolSummary(part, directory)}
          {part.error && <span className="text-danger"> — {part.error}</span>}
        </>
      }
    >
      <p className="mb-1 flex items-center gap-1 text-[11px] text-fg-subtle">
        <Wrench className="h-3 w-3" />
        {part.name}
      </p>
      {part.input && <CodeBlock label="Input" text={part.input} />}
      {part.output && <CodeBlock label="Output" text={part.output} />}
      {part.error && <CodeBlock label="Error" text={part.error} />}
      {part.truncated && <p className="text-[11px] text-fg-subtle">Shortened; the full text is in OpenCode.</p>}
    </Disclosure>
  )
}

function ReasoningView({ text, active }: { text: string; active: boolean }): JSX.Element | null {
  if (!text.trim()) return null
  return (
    <Disclosure
      testId="chat-reasoning"
      icon={active ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Brain className="h-3.5 w-3.5 shrink-0" />}
      summary={active ? 'Thinking…' : 'Thought'}
    >
      <p className="whitespace-pre-wrap break-words border-l-2 border-line pl-3 text-[12.5px] italic leading-relaxed text-fg-subtle">
        {text}
      </p>
    </Disclosure>
  )
}

/** One message of the conversation. */
export const ChatMessageView = memo(function ChatMessageView({
  message,
  directory,
}: {
  message: ChatMessage
  directory: string
}): JSX.Element | null {
  if (message.kind === 'user') {
    return (
      <div className="flex justify-end" data-testid={`chat-message-${message.id}`}>
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-active px-3.5 py-2 text-[14px] leading-relaxed text-fg">
          {message.text}
        </div>
      </div>
    )
  }
  if (message.kind === 'note') {
    const icon = message.tone === 'error'
      ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      : <Info className="h-3.5 w-3.5 shrink-0" />
    if (message.detail) {
      return (
        <div data-testid={`chat-message-${message.id}`} className={message.tone === 'error' ? 'text-danger' : undefined}>
          <Disclosure icon={icon} summary={message.text} tone={message.tone === 'error' ? 'danger' : 'muted'}>
            <CodeBlock label="Details" text={message.detail} />
          </Disclosure>
        </div>
      )
    }
    return (
      <div
        data-testid={`chat-message-${message.id}`}
        className={cn('flex items-center gap-1.5 px-1.5 text-[12px]', message.tone === 'error' ? 'text-danger' : 'text-fg-subtle')}
      >
        {icon}
        <span className="min-w-0">{message.text}</span>
      </div>
    )
  }

  const lastIndex = message.parts.length - 1
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid={`chat-message-${message.id}`}>
      {message.parts.map((part, index) => {
        if (part.kind === 'text') return part.text.trim() ? <ChatMarkdown key={index} text={part.text} /> : null
        if (part.kind === 'reasoning') {
          return <ReasoningView key={index} text={part.text} active={!message.completed && index === lastIndex} />
        }
        return <ToolCallView key={part.id} part={part} directory={directory} />
      })}
      {message.error && (
        <div role="alert" className="flex items-start gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[12px] text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 whitespace-pre-wrap break-words">{message.error}</span>
        </div>
      )}
    </div>
  )
})
