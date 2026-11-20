import { memo, useMemo, useState } from 'react'
import { BookOpen, ChevronRight, CircleAlert, FoldVertical, GitFork, Target, Undo2 } from 'lucide-react'
import type { ChatFileMention, ChatMessage, ChatModel } from '@shared/types'
import { ActivityGroup, NoteRow, ThoughtRow } from '@/components/inbox/ChatActivity'
import { ChatMarkdown } from '@/components/inbox/ChatMarkdown'
import { ChatQuoteCard } from '@/components/inbox/ChatQuoteCard'
import { SubagentGroup } from '@/components/inbox/ChatSubagents'
import { ToolCallView } from '@/components/inbox/ChatTools'
import { ActivityRow, CopyButton, flowAttrs, Surface, type FlowKind } from '@/components/inbox/chat-ui'
import { formatTokens, messageBlocks } from '@/lib/chat'
import type { RenderBlock } from '@/lib/chat-tools'
import { splitQuotes } from '@/lib/chat-quote'
import { splitMentions, type MentionPart } from '@/lib/file-mentions'
import { splitTerminalReferences, type TerminalReferenceToken } from '@shared/terminal-references'
import { TerminalReferenceChip } from '@/components/inbox/TerminalReferenceChip'
import { dayTimeLabel } from '@/lib/time-label'
import { cn } from '@/lib/utils'

/**
 * The text of a message with the files and folders it named marked, as they are in the box they were written in,
 * and the terminals it points at shown as chips.
 */
function MentionedText({ text, mentions }: { text: string; mentions: readonly ChatFileMention[] }): JSX.Element {
  const parts = useMemo(() => splitTerminalReferences(text).flatMap((piece): (MentionPart & { terminal?: TerminalReferenceToken })[] => piece.reference
    ? [{ text: piece.text, terminal: piece.reference }]
    : splitMentions(piece.text, mentions)), [text, mentions])
  return (
    <>
      {parts.map((part, index) => part.terminal
        ? <TerminalReferenceChip key={index} reference={part.terminal} text={part.text} />
        : part.mention
          ? <span key={index} data-testid="chat-file-mention" title={part.mention.path} className="rounded bg-accent/15 text-accent">{part.text}</span>
          : part.text)}
    </>
  )
}

/** What the person wrote, with the quotes in it set apart from the rest of the text. */
function BubbleText({ text, mentions = NO_MENTIONS }: { text: string; mentions?: readonly ChatFileMention[] }): JSX.Element {
  const segments = useMemo(() => splitQuotes(text), [text])
  const [only] = segments
  // Without a quote, or with only an empty one, the text is shown as it is.
  // What the person wrote is what the search looks through; the files and skills around it are not text of theirs.
  if (segments.length === 0 || (segments.length === 1 && only?.kind === 'text')) return <div data-chat-searchable><MentionedText text={text} mentions={mentions} /></div>
  return (
    <div data-chat-searchable>
      {segments.map((segment, index) =>
        segment.kind === 'quote'
          ? <ChatQuoteCard key={index} text={segment.text} />
          : <span key={index} className="block"><MentionedText text={segment.text} mentions={mentions} /></span>,
      )}
    </div>
  )
}

const NO_MENTIONS: readonly ChatFileMention[] = []

/**
 * The bubble of one of the user's messages: its text, files and skills. `pending` draws it as a message
 * the agent has not taken up yet, with a dashed outline; the size is the same, so that it does not
 * move when the real message takes its place.
 */
export function UserBubble({ message, pending = false }: { message: Extract<ChatMessage, { kind: 'user' }>; pending?: boolean }): JSX.Element {
  return (
    <div
      className={cn(
        'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border px-3.5 py-2 text-[14px] leading-[1.65]',
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
      <BubbleText text={message.text} mentions={message.mentions} />
    </div>
  )
}

/**
 * When one of the user's messages was sent, and a button that copies it: a quiet line under the bubble that shows
 * while the message is hovered or has focus. It hangs in the room under the message, so showing it moves nothing.
 * `now` is when the line was last shown, so that "today" stays true on a thread left open overnight.
 */
function UserMessageFooter({ message, now }: { message: Extract<ChatMessage, { kind: 'user' }>; now: number }): JSX.Element {
  return (
    <div
      data-testid={`chat-sent-footer-${message.id}`}
      className="absolute right-0 top-full mt-1 flex items-center gap-1 text-[11px] text-fg-subtle opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
    >
      {message.time > 0 && (
        <time
          data-testid={`chat-sent-time-${message.id}`}
          dateTime={new Date(message.time).toISOString()}
          title={new Date(message.time).toLocaleString()}
          className="select-none tabular-nums"
        >
          {dayTimeLabel(message.time, now)}
        </time>
      )}
      <CopyButton text={message.text} label="Copy message" />
    </div>
  )
}

/** The small buttons beside one of the user's messages, which show while the message is hovered or has focus. */
const MESSAGE_ACTION =
  'mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-hover hover:text-fg focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100'

/** One message of the conversation. */
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
  const [now, setNow] = useState(Date.now)
  if (message.kind === 'user') {
    return (
      // The line under the bubble sits outside the message's own element, so that it is no part of what is
      // quoted, found or copied of the message.
      <div className="group relative" onPointerEnter={() => setNow(Date.now())} onFocus={() => setNow(Date.now())} {...flowAttrs('user')}>
        <div className="flex items-start justify-end gap-1.5" data-testid={`chat-message-${message.id}`} data-chat-message={message.id}>
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
        <UserMessageFooter message={message} now={now} />
      </div>
    )
  }
  if (message.kind === 'note' && message.compaction?.status === 'running') {
    return (
      <div role="status" data-testid={`chat-message-${message.id}`} data-chat-message={message.id} data-compaction="running" {...flowAttrs('step', 'step', true)}>
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
      <div data-testid={`chat-message-${message.id}`} data-chat-message={message.id} data-goal-note={message.goal} {...flowAttrs('step', 'step', true)}>
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
    if (plan?.length === 0) return null
    return (
      <div data-testid={`chat-message-${message.id}`} data-chat-message={message.id} {...flowAttrs('step', 'step', true)}>
        {plan ? plan.map((block) => block.kind === 'activity'
          ? <ActivityGroup key={`activity-${block.index}`} items={block.items} directory={directory} models={models} live={block.live ?? false} />
          : null) : <NoteRow message={message} />}
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
  const blocks = useMemo(() => plan ?? messageBlocks(message.parts), [plan, message.parts])
  // Words or a thought with nothing in them draw nothing, and take no room in the flow either.
  const drawn = useMemo(
    () => blocks.filter((block) => block.kind !== 'part' || block.part.kind === 'tool' || block.part.text.trim()),
    [blocks],
  )
  // In the compact layout the activity of a step may be drawn with an earlier one; a step left with nothing draws nothing.
  if (plan && drawn.length === 0 && !message.error) return null
  const kinds = drawn.map(blockFlow)
  return (
    <div
      className="chat-flow min-w-0"
      data-testid={`chat-message-${message.id}`}
      data-chat-message={message.id}
      {...flowAttrs(kinds[0] ?? 'text', message.error ? 'text' : kinds[kinds.length - 1] ?? 'text')}
    >
      {drawn.map((block, position) => {
        const tail = position === drawn.length - 1
        const kind = kinds[position]!
        const key = block.kind === 'part' && block.part.kind === 'tool' ? block.part.id : `${block.kind}-${block.index}`
        let body: JSX.Element
        if (block.kind === 'subagents') body = <SubagentGroup parts={block.parts} models={models} />
        else if (block.kind === 'activity') {
          body = <ActivityGroup items={block.items} directory={directory} models={models} live={block.live ?? (live && tail)} />
        } else {
          const { part, index } = block
          if (part.kind === 'text') body = <ChatMarkdown text={part.text} />
          else if (part.kind === 'reasoning') body = <ThoughtRow text={part.text} live={live && index === lastIndex} />
          else body = <ToolCallView part={part} directory={directory} />
        }
        return <div key={key} className="min-w-0" {...flowAttrs(kind, kind, kind === 'step')}>{body}</div>
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

/** Words are text in the flow of the conversation; everything else the agent did is a step. */
function blockFlow(block: RenderBlock): FlowKind {
  return block.kind === 'part' && block.part.kind === 'text' ? 'text' : 'step'
}
