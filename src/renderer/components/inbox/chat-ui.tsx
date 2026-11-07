import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight, CircleAlert, CircleDashed, Copy, LoaderCircle, type LucideIcon } from 'lucide-react'
import type { ChatToolStatus } from '@shared/types'
import { plural } from '@/lib/chat-tools'
import { cn } from '@/lib/utils'

/*
 * The pieces every part of a conversation is built from, so that a tool call, a thought, a note and a card read as
 * one family: a row (icon, what happened, what it was about, a little detail on the right) that opens onto a panel
 * hung from a rail, and a surface for whatever the panel shows.
 */

/** Horizontal placement shared by a row and the rail under it: the rail runs down the middle of the row's icon. */
const RAIL = 'ml-[13px] border-l border-line'

/** The mark in front of a row: its kind of work, a spinner while it runs, a warning when it went wrong. */
export function Glyph({
  icon: Icon,
  status = 'completed',
  failed = false,
  className,
}: {
  icon: LucideIcon
  status?: ChatToolStatus
  failed?: boolean
  className?: string
}): JSX.Element {
  if (status === 'running') {
    return <LoaderCircle aria-hidden className={cn('h-3.5 w-3.5 shrink-0 animate-spin text-accent motion-reduce:animate-none', className)} />
  }
  if (status === 'pending') {
    return <CircleDashed aria-hidden className={cn('h-3.5 w-3.5 shrink-0 text-accent/70', className)} />
  }
  if (failed || status === 'error') return <CircleAlert aria-hidden className={cn('h-3.5 w-3.5 shrink-0 text-danger', className)} />
  return <Icon aria-hidden className={cn('h-3.5 w-3.5 shrink-0 text-fg-subtle transition-colors group-hover/row:text-fg-muted', className)} />
}

export interface ActivityRowProps {
  icon: LucideIcon
  status?: ChatToolStatus
  /** Ended badly although the tool itself did not fail, such as a command that exited with an error. */
  failed?: boolean
  /** What happened: "Read", "Ran". */
  verb: ReactNode
  /** What it happened to: a file, a command. */
  subject?: ReactNode
  /** The small print at the right: a count, a time. */
  meta?: ReactNode
  /** What the row opens onto. A row without it is not a button. */
  detail?: ReactNode
  defaultOpen?: boolean
  /** Keeps the row open or shut from the outside, until the person clicks it. */
  open?: boolean
  onToggle?: (open: boolean) => void
  testId?: string
  title?: string
  /** Names the row for assistive technology where the verb and subject alone would be read apart. */
  label?: string
  className?: string
  /** The verb is drawn as in progress even though the work is done, such as the thought still being written. */
  shimmer?: boolean
  /** The row says something in passing rather than something that was done, such as a note. */
  quiet?: boolean
  /** Classes for the icon, such as a color for a row that stands for something. */
  iconClassName?: string
  /** Attributes for the row's container, such as the `data-` ones a test or a style looks for. */
  attrs?: Record<`data-${string}`, string | number | undefined>
}

/**
 * One line of activity. Quiet when it went well, the icon and the verb tell what happened and the subject what it
 * was about; running work shimmers and spins, and a failure turns the whole line red. The chevron shows on hover.
 */
export function ActivityRow({
  icon,
  status = 'completed',
  failed = false,
  verb,
  subject,
  meta,
  detail,
  defaultOpen = false,
  open: controlled,
  onToggle,
  testId,
  title,
  label,
  className,
  shimmer = false,
  quiet = false,
  attrs,
  iconClassName,
}: ActivityRowProps): JSX.Element {
  const [own, setOwn] = useState(defaultOpen)
  const open = controlled ?? own
  const expandable = detail !== undefined && detail !== null && detail !== false
  const active = status === 'running' || status === 'pending'
  const bad = failed || status === 'error'
  const line = (
    <>
      <Glyph icon={icon} status={status} failed={failed} className={iconClassName} />
      <span className={cn('shrink-0', bad ? 'text-danger' : quiet ? 'text-fg-subtle' : 'text-fg-muted', (active || shimmer) && 'chat-shimmer')}>{verb}</span>
      {subject !== undefined && subject !== null && (
        <>
          {' '}
          <span className={cn('min-w-0 flex-1 truncate', bad ? 'text-danger/90' : 'text-fg')}>{subject}</span>
        </>
      )}
      {(subject === undefined || subject === null) && <span className="flex-1" />}
      {meta !== undefined && meta !== null && (
        <span className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-[11.5px] tabular-nums text-fg-subtle">{meta}</span>
      )}
      {expandable && (
        <ChevronRight
          aria-hidden
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-fg-subtle transition-[transform,opacity] duration-150',
            open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100',
          )}
        />
      )}
    </>
  )
  const base = 'group/row flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-[5px] text-left text-[12.5px] leading-5'
  return (
    <div
      {...attrs}
      {...(label ? { role: 'group', 'aria-label': label } : {})}
      data-testid={testId}
      data-status={status}
      data-failed={bad ? '' : undefined}
      className={cn('min-w-0', active && 'chat-rise', className)}
    >
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          title={title}
          onClick={() => {
            onToggle?.(!open)
            if (controlled === undefined) setOwn(!open)
          }}
          className={cn(base, 'transition-colors hover:bg-hover/70 focus-visible:bg-hover/70 focus-visible:outline-none')}
        >
          {line}
        </button>
      ) : (
        <div title={title} className={base}>
          {line}
        </div>
      )}
      {expandable && open && <Rail>{detail}</Rail>}
    </div>
  )
}

/** What a row opens onto: hung from a line that runs down from the row's icon. */
export function Rail({ children, tight = false }: { children: ReactNode; tight?: boolean }): JSX.Element {
  return <div className={cn(RAIL, 'min-w-0 pb-1 pt-0.5', tight ? 'pl-1' : 'pl-[17px]')}>{children}</div>
}

/** The panel that shows a tool's input, output or results. */
export function Surface({
  children,
  className,
  testId,
  tone,
}: {
  children: ReactNode
  className?: string
  testId?: string
  tone?: 'danger'
}): JSX.Element {
  return (
    <div
      data-testid={testId}
      className={cn('min-w-0 overflow-hidden rounded-lg border bg-panel', tone === 'danger' ? 'border-danger/40' : 'border-line', className)}
    >
      {children}
    </div>
  )
}

/** The strip along the top of a surface: what it shows on the left, what can be done with it on the right. */
export function SurfaceHeader({ children, actions, className }: { children: ReactNode; actions?: ReactNode; className?: string }): JSX.Element {
  return (
    <div className={cn('flex min-h-[30px] min-w-0 items-center gap-2 border-b border-line px-2.5 py-1 text-[11.5px] text-fg-subtle', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  )
}

/** A small label above a part of a panel. */
export function Label({ children, tone }: { children: ReactNode; tone?: 'danger' }): JSX.Element {
  return (
    <p className={cn('mb-1 text-[10px] font-medium uppercase tracking-wide', tone === 'danger' ? 'text-danger' : 'text-fg-subtle')}>{children}</p>
  )
}

/** A short tag: the exit code, a server, how many. */
export function Chip({
  children,
  tone = 'neutral',
  title,
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'danger' | 'ok'
  title?: string
  className?: string
}): JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium leading-4',
        tone === 'neutral' && 'bg-active text-fg-muted',
        tone === 'accent' && 'bg-accent/12 text-accent',
        tone === 'danger' && 'bg-danger/12 text-danger',
        tone === 'ok' && 'bg-ok/12 text-ok',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Copies `text` and says so for a moment. The clipboard is the main process's, so it works in any window. */
export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = (): void => {
    const write = window.api?.clipboard?.writeText
    if (!write) return
    void Promise.resolve(write(text)).then(
      () => {
        setCopied(true)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopied(false), 1500)
      },
      () => undefined,
    )
  }
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={copy}
      className={cn(
        'flex h-5 w-5 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-hover hover:text-fg focus-visible:bg-hover focus-visible:outline-none',
        copied && 'text-ok hover:text-ok',
        className,
      )}
    >
      {copied ? <Check aria-hidden className="h-3 w-3" /> : <Copy aria-hidden className="h-3 w-3" />}
    </button>
  )
}

/**
 * A list kept to its first items until it is asked for in full. `children` draws what is shown; the button under
 * it says how many are left.
 */
export function Clamped<T>({
  items,
  limit,
  children,
  noun = 'line',
  flush = false,
}: {
  items: readonly T[]
  limit: number
  children: (shown: readonly T[]) => ReactNode
  noun?: string
  /** The button sits on the edge of a surface, so it gets a rule above it. */
  flush?: boolean
}): JSX.Element {
  const [all, setAll] = useState(false)
  const cut = !all && items.length > limit
  const shown = cut ? items.slice(0, limit) : items
  return (
    <>
      {children(shown)}
      {cut && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className={cn(
            'block w-full px-2.5 py-1.5 text-left text-[11.5px] text-accent transition-colors hover:bg-hover',
            flush ? 'border-t border-line' : 'rounded-md',
          )}
        >
          Show {plural(items.length - limit, noun)} more
        </button>
      )}
    </>
  )
}

/** Plain text in the code font, for output that has no better way to be drawn. */
export function CodeText({ text, className, testId }: { text: string; className?: string; testId?: string }): JSX.Element {
  return (
    <pre
      data-testid={testId}
      className={cn('inbox-code-font overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 text-[12px] leading-[1.55] text-fg-muted', className)}
    >
      {text}
    </pre>
  )
}

/** The note under a panel that its text was cut short. */
export function TruncatedNote(): JSX.Element {
  return <p className="px-1 pt-1 text-[11px] text-fg-subtle">Shortened; the full text is in OpenCode.</p>
}
