import { memo, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, ChevronRight, CircleAlert, FoldVertical, GitFork, Info, Target, Undo2 } from 'lucide-react'
import type { ChatMessage, ChatModel } from '@shared/types'
import { ActivityGroup, ThoughtRow } from '@/components/inbox/ChatActivity'
import { ChatMarkdown } from '@/components/inbox/ChatMarkdown'
import { ChatQuoteCard } from '@/components/inbox/ChatQuoteCard'
import { SubagentGroup } from '@/components/inbox/ChatSubagents'
import { ToolCallView } from '@/components/inbox/ChatTools'
import { ActivityRow, CodeText, Surface } from '@/components/inbox/chat-ui'
import { formatTokens, messageBlocks } from '@/lib/chat'
import { activityBlocks, type RenderBlock } from '@/lib/chat-tools'
import { splitQuotes } from '@/lib/chat-quote'
import { cn } from '@/lib/utils'

/** What the person wrote, with the quotes in it set apart from the rest of the text. */
function BubbleText({ text }: { text: string }): JSX.Element {
  const segments = useMemo(() => splitQuotes(text), [text])
  const [only] = segments
  // Without a quote, or with only an empty one, the text is shown as it is.
  if (segments.length === 0 || (segments.length === 1 && only?.kind === 'text')) return <>{text}</>
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'quote'
          ? <ChatQuoteCard key={index} text={segment.text} />
          : <span key={index} className="block">{segment.text}</span>,
      )}
    </>
  )
}

/**
 * The bubble of one of the user's messages: its text, files and skills. `pending` draws it as a message
 * the agent has not taken up yet, with a dashed outline; the size is the same, so that it does not
 * move when the real message takes its place.
 */
export function UserBubble({ message, pending = false }: { message: Extract<ChatMessage, { kind: 'user' }>; pending?: boolean }): JSX.Element {
  return (
    <div
      className={cn(
        'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border px-3.5 py-2 text-[14px] leading-relaxed',
        pending ? 'border-dashed border-line-strong bg-active/40 text-fg-muted' : 'border-transparent bg-active text-fg',
      )}
    >
      {message.attachments?.length ? <div className="flex flex-wrap gap-2 pb-2">{message.attachments.map((file) => <div key={file.id} className="max-w-48 rounded border border-line p-2 text-xs" title={`${file.name} (${file.size.toLocaleString()} bytes)`}>
        {file.thumbnail && <img src={file.thumbnail} alt={file.name} className="mb-1 h-24 w-32 object-contain" />}
        <span className="block truncate">{file.name}</span><span className="text-fg-subtle">{Math.ceil(file.size / 1024)} KB</span>
      </div>)}</div> : null}
      {message.skills?.length ? <div className="flex flex-wrap gap-1.5 pb-2" aria-label="Skills used">
        {message.skills.map((skill) => <span key={skill.id} data-testid={`chat-skill-${skill.id}`} title={`$${skill.id}`} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line-strong px-2 py-0.5 text-xs text-fg-muted">
          <BookOpen aria-hidden className="h-3 w-3 shrink-0 text-accent" />
          <span className="truncate">{skill.name}</span>
        </span>)}
      </div> : null}
      <BubbleText text={message.text} />
    </div>
  )
}

/** One message of the conversation. */
/** The small buttons beside one of the user's messages, which show while the message is hovered or has focus. */
const MESSAGE_ACTION =
  'mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-hover hover:text-fg focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100'

export const ChatMessageView = memo(function ChatMessageView({
  message,
  directory,
  models,
  onRevert,
  onFork,
  working = true,
  plan,
}: {
  message: ChatMessage
  directory: string
  models?: readonly ChatModel[]
  /** The agent is at work on this message; false for one the agent left unfinished. */
  working?: boolean
  /** What to draw of an agent's step instead of laying it out alone: the compact layout, which reaches across steps. */
  plan?: readonly RenderBlock[]
  /** Offered on the user's own messages: asks to revert the conversation to just before this one. */
  onRevert?: (message: Extract<ChatMessage, { kind: 'user' }>) => void
  /** Offered on the user's own messages: starts a new thread from just before this message. */
  onFork?: (message: Extract<ChatMessage, { kind: 'user' }>) => void
}): JSX.Element | null {
  if (message.kind === 'user') {
    return (
      <div className="group flex items-start justify-end gap-1.5" data-testid={`chat-message-${message.id}`} data-chat-message={message.id}>
        {onFork && (
          <button
            type="button"
            aria-label="Fork from before this message"
            title="Fork from here"
            data-testid={`chat-fork-from-${message.id}`}
            onClick={() => onFork(message)}
            className={MESSAGE_ACTION}
          >
            <GitFork aria-hidden className="h-3.5 w-3.5" />
          </button>
        )}
        {onRevert && (
          <button
            type="button"
            aria-label="Revert to before this message"
            title="Revert to here"
            data-testid={`chat-revert-to-${message.id}`}
            onClick={() => onRevert(message)}
            className={MESSAGE_ACTION}
          >
            <Undo2 aria-hidden className="h-3.5 w-3.5" />
          </button>
        )}
        <UserBubble message={message} />
      </div>
    )
  }
  if (message.kind === 'note' && message.compaction?.status === 'running') {
    return (
      <div role="status" data-testid={`chat-message-${message.id}`} data-chat-message={message.id} data-compaction="running" className="-my-1">
        <ActivityRow icon={FoldVertical} status="running" verb={message.text} shimmer />
      </div>
    )
  }
  if (message.kind === 'note' && message.compaction?.status === 'completed' && message.detail) {
    return <CompactionDivider message={message} detail={message.detail} />
  }
  if (message.kind === 'note' && message.goal) {
    // What the goal wrote into the conversation: the objective when it was set or resumed, and what the reviewer found
    // missing each time it sent the agent back to work. Prose, not code.
    return (
      <div data-testid={`chat-message-${message.id}`} data-chat-message={message.id} data-goal-note={message.goal} className="-my-1">
        <ActivityRow
          icon={Target}
          iconClassName="text-accent"
          verb={message.text}
          detail={message.detail ? (
            <Surface>
              <p className="chat-selectable max-h-60 overflow-y-auto whitespace-pre-wrap break-words px-2.5 py-2 text-[12.5px] leading-5 text-fg-muted" data-testid="chat-goal-note-detail">
                {message.detail}
              </p>
            </Surface>
          ) : undefined}
        />
      </div>
    )
  }
  if (message.kind === 'note') {
    const error = message.tone === 'error'
    return (
      <div data-testid={`chat-message-${message.id}`} data-chat-message={message.id} className="-my-1">
        <ActivityRow
          icon={error ? AlertTriangle : Info}
          failed={error}
          quiet={!error}
          verb={<span className="whitespace-normal break-words">{message.text}</span>}
          detail={message.detail ? <Surface tone={error ? 'danger' : undefined}><CodeText text={message.detail} className="max-h-80" /></Surface> : undefined}
        />
      </div>
    )
  }

  return <AssistantMessage message={message} directory={directory} models={models} working={working} plan={plan} />
})

/** A finished compaction: a rule across the conversation where it happened, which opens onto the summary the agent now remembers. */
function CompactionDivider({ message, detail }: { message: Extract<ChatMessage, { kind: 'note' }>; detail: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const summaryTokens = message.compaction?.status === 'completed' ? message.compaction.summaryTokens : undefined
  return (
    <div data-testid={`chat-message-${message.id}`} data-chat-message={message.id} data-compaction="completed">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group/row flex w-full min-w-0 items-center gap-3 rounded-md px-1.5 py-1 text-[11.5px] text-fg-subtle transition-colors hover:text-fg-muted focus-visible:text-fg-muted focus-visible:outline-none"
      >
        <span aria-hidden className="h-px min-w-4 flex-1 bg-gradient-to-r from-transparent to-line-strong" />
        <FoldVertical aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {message.text}
          {summaryTokens ? <span> · summary of about {formatTokens(summaryTokens)} tokens</span> : null}
        </span>
        <ChevronRight aria-hidden className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-150', open && 'rotate-90')} />
        <span aria-hidden className="h-px min-w-4 flex-1 bg-gradient-to-l from-transparent to-line-strong" />
      </button>
      {open && (
        <Surface className="mt-1.5">
          {/* The summary is what the agent now remembers of the conversation; it is Markdown, so it is shown as such. */}
          <div className="max-h-96 min-w-0 overflow-auto px-3 py-2 text-[13px]" data-testid="chat-compaction-summary">
            <ChatMarkdown text={detail} label="Summary of the conversation" />
          </div>
        </Surface>
      )}
    </div>
  )
}

/** What the agent did and said in one step: its text, thoughts and tool calls, in the order it did them. */
function AssistantMessage({
  message,
  directory,
  models,
  working,
  plan,
}: {
  message: Extract<ChatMessage, { kind: 'assistant' }>
  directory: string
  models?: readonly ChatModel[]
  working: boolean
  plan?: readonly RenderBlock[]
}): JSX.Element | null {
  // The step is live while it is being written and the agent is at work; one that was left unfinished is not.
  const live = !message.completed && working
  const lastIndex = message.parts.length - 1
  const blocks = useMemo(() => plan ?? activityBlocks(messageBlocks(message.parts)), [plan, message.parts])
  // In the compact layout the activity of a step may be drawn with an earlier one; a step left with nothing draws nothing.
  if (plan && blocks.length === 0 && !message.error) return null
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid={`chat-message-${message.id}`} data-chat-message={message.id}>
      {blocks.map((block, position) => {
        const tail = position === blocks.length - 1
        if (block.kind === 'subagents') return <SubagentGroup key={`subagents-${block.index}`} parts={block.parts} models={models} />
        if (block.kind === 'activity') {
          return <ActivityGroup key={`activity-${block.index}`} items={block.items} directory={directory} live={block.live ?? (live && tail)} />
        }
        const { part, index } = block
        if (part.kind === 'text') return part.text.trim() ? <ChatMarkdown key={index} text={part.text} /> : null
        if (part.kind === 'reasoning') return <ThoughtRow key={index} text={part.text} live={live && index === lastIndex} />
        return <ToolCallView key={part.id} part={part} directory={directory} />
      })}
      {message.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
          <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 whitespace-pre-wrap break-words">{message.error}</span>
        </div>
      )}
    </div>
  )
}
