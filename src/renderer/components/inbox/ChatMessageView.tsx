import { memo, useMemo, useState } from 'react'
import { AlertTriangle, Brain, ChevronRight, Info, LoaderCircle, Undo2, Wrench } from 'lucide-react'
import type { ChatMessage, ChatPart } from '@shared/types'
import { FileChangeView } from '@/components/inbox/ChatFileChange'
import { ChatMarkdown } from '@/components/inbox/ChatMarkdown'
import { SubagentGroup } from '@/components/inbox/ChatSubagents'
import { ToolIcon } from '@/components/inbox/ToolIcon'
import { messageBlocks, toolSummary } from '@/lib/chat'
import { toolFileChanges } from '@/lib/diff'
import { cn } from '@/lib/utils'

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
      <pre className="inbox-code-font max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-bg px-2.5 py-2 text-[12px] leading-snug text-fg-muted">
        {text}
      </pre>
    </div>
  )
}

export function ToolCallView({ part, directory }: { part: Extract<ChatPart, { kind: 'tool' }>; directory: string }): JSX.Element {
  // A fresh fetch brings new objects with the same content; the diff is only worked out again when the content changes.
  const patches = part.patches?.map((patch) => `${patch.path}\u0000${patch.patch}`).join('\u0001')
  const changes = useMemo(
    () => toolFileChanges(part),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [part.name, part.status, part.input, patches, part.existed],
  )
  // A failed edit keeps the plain row, which carries OpenCode's reason.
  if (changes && part.status !== 'error') return <FileChangeView part={part} changes={changes} directory={directory} />
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
  onRevert,
}: {
  message: ChatMessage
  directory: string
  /** Offered on the user's own messages: asks to revert the conversation to just before this one. */
  onRevert?: (message: Extract<ChatMessage, { kind: 'user' }>) => void
}): JSX.Element | null {
  if (message.kind === 'user') {
    return (
      <div className="group flex items-start justify-end gap-1.5" data-testid={`chat-message-${message.id}`}>
        {onRevert && (
          <button
            type="button"
            aria-label="Revert to before this message"
            title="Revert to here"
            data-testid={`chat-revert-to-${message.id}`}
            onClick={() => onRevert(message)}
            className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-hover hover:text-fg focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
          >
            <Undo2 aria-hidden className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-active px-3.5 py-2 text-[14px] leading-relaxed text-fg">
          {message.attachments?.length ? <div className="flex flex-wrap gap-2 pb-2">{message.attachments.map((file) => <div key={file.id} className="max-w-48 rounded border border-line p-2 text-xs" title={`${file.name} (${file.size.toLocaleString()} bytes)`}>
            {file.thumbnail && <img src={file.thumbnail} alt={file.name} className="mb-1 h-24 w-32 object-contain" />}
            <span className="block truncate">{file.name}</span><span className="text-fg-subtle">{Math.ceil(file.size / 1024)} KB</span>
          </div>)}</div> : null}
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
      {messageBlocks(message.parts).map((block) => {
        if (block.kind === 'subagents') return <SubagentGroup key={`subagents-${block.index}`} parts={block.parts} />
        const { part, index } = block
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
