import { useEffect, useRef, useState } from 'react'
import { Brain, ChevronRight, LoaderCircle } from 'lucide-react'
import { ActivityRow, Chip, Rail, useCompactChat } from '@/components/inbox/chat-ui'
import { ChatMarkdown } from '@/components/inbox/ChatMarkdown'
import { ToolCallView } from '@/components/inbox/ChatTools'
import { activitySummary, reasoningPreview, reasoningTitle, toolFailed, type ActivityItem } from '@/lib/chat-tools'
import { cn } from '@/lib/utils'

/** How long one line of the preview stays up before the next one may take its place. */
export const PREVIEW_HOLD_MS = 2600

/**
 * A value that stays put: when `value` changes, the change is shown at once if the last one has been up for `holdMs`,
 * and otherwise when it has. Whatever came in between is skipped, so a value that changes in a flurry is seen at a pace
 * that can be read. The first value, and the end of the values (null), are shown at once.
 */
export function useHeldValue(value: string | null, holdMs: number): string | null {
  const [shown, setShown] = useState(value)
  const shownAt = useRef(Date.now())
  const latest = useRef(value)
  latest.current = value
  useEffect(() => {
    if (value === shown) return
    const show = (): void => {
      shownAt.current = Date.now()
      setShown(latest.current)
    }
    const wait = value === null || shown === null ? 0 : shownAt.current + holdMs - Date.now()
    if (wait <= 0) return show()
    const timer = setTimeout(show, wait)
    return () => clearTimeout(timer)
  }, [value, shown, holdMs])
  return shown
}

/**
 * The model's reasoning, as a row like any other step. While it is written the row names what the model is on now: the
 * latest finished heading, else the latest finished sentence, each held long enough to read and faded in rather than
 * typed over. Once it is done it says "Thought" and the heading it began with. Opened, it shows the reasoning as Markdown.
 */
export function ThoughtRow({ text, live }: { text: string; live: boolean }): JSX.Element | null {
  const preview = useHeldValue(live ? reasoningPreview(text) : null, PREVIEW_HOLD_MS)
  if (!text.trim()) return null
  const subject = live ? preview : reasoningTitle(text)
  return (
    <ActivityRow
      testId="chat-reasoning"
      icon={Brain}
      status={live ? 'running' : 'completed'}
      verb={live ? 'Thinking' : 'Thought'}
      subject={subject ? <span key={subject} className={cn(live ? 'chat-swap text-fg-subtle' : 'text-fg-muted')}>{subject}</span> : undefined}
      detail={<ChatMarkdown text={text} variant="reasoning" />}
    />
  )
}

/**
 * A run of steps (thoughts, reads, searches, commands) folded into one line that sums them up. It is open while the
 * agent is still at it, so that the work can be followed, and shuts when the agent moves on to something else; in the
 * compact layout it is never open of itself, and a live one only spins and shimmers. A click on it is the person's
 * choice, and stays.
 */
export function ActivityGroup({
  items,
  directory,
  live,
}: {
  items: ActivityItem[]
  directory: string
  /** The agent is still at these steps, which are at the end of what it has written. */
  live: boolean
}): JSX.Element {
  const compact = useCompactChat()
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? (live && !compact)
  const parts = items.map((item) => item.part)
  const failed = parts.filter(toolFailed).length
  return (
    <div data-testid="chat-activity" data-open={open ? '' : undefined} data-live={live ? '' : undefined} className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setChosen(!open)}
        className="group/row flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-[5px] text-left text-[12.5px] leading-5 transition-colors hover:bg-hover/70 focus-visible:bg-hover/70 focus-visible:outline-none"
      >
        {live ? (
          <LoaderCircle aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin text-accent motion-reduce:animate-none" />
        ) : (
          <ChevronRight aria-hidden className={cn('h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform duration-150', open && 'rotate-90')} />
        )}
        <span data-testid="chat-activity-summary" className={cn('min-w-0 flex-1 truncate', live ? 'chat-shimmer' : 'text-fg-muted transition-colors group-hover/row:text-fg')}>
          {activitySummary(parts, live)}
        </span>
        {failed > 0 && <Chip tone="danger">{failed} failed</Chip>}
      </button>
      {open && (
        <Rail tight>
          <div className="flex min-w-0 flex-col">
            {items.map(({ part, index, messageId }, position) => {
              if (part.kind === 'tool') return <ToolCallView key={part.id} part={part} directory={directory} />
              // Text never joins a group; only thoughts and tool calls do. The thought being written is the last step.
              return part.kind === 'reasoning'
                ? <ThoughtRow key={`${messageId ?? ''}:${index}`} text={part.text} live={live && position === items.length - 1} />
                : null
            })}
          </div>
        </Rail>
      )}
    </div>
  )
}
