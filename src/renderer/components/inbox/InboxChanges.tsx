import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, FileDiff, GitBranch, LoaderCircle, PanelRightClose, RefreshCw, X } from 'lucide-react'
import type { GitChangeStatus, InboxChangeDiff, InboxChangedFile, InboxChangesResponse, Session } from '@shared/types'
import { Button } from '@/components/ui/button'
import { FileTreePanel } from '@/components/FileTreePanel'
import { DiffBody } from './ChatFileChange'
import { focusInboxTerminalWhenShown, InboxTerminal } from './InboxTerminal'
import { InboxSidebarFrame } from './InboxSidebarFrame'
import { parseUnifiedDiff } from '@/lib/diff'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { cn } from '@/lib/utils'
import { useInboxChanges, inboxChangesKey, type ChangesState } from '@/store/inbox-changes'
import { useWorkspace } from '@/store/workspace'
import { codeViewerFontFamily, getTerminalSettings, subscribeTerminalSettings } from '@/terminal/terminal-settings'

export const GIT_CHANGES_NOTE = 'Uncommitted changes against HEAD, including staged, unstaged, and untracked files.'

/** The popover lists this many files; a checkout with more says how many it left out. */
export const CHANGES_LIST_LIMIT = 200
/** Rest on the chip this long before the list opens, and leave it this long before it closes. */
const OPEN_DELAY_MS = 180
const CLOSE_DELAY_MS = 140
const POPOVER_GAP = 10
const POPOVER_MARGIN = 12

const STATUS: Record<GitChangeStatus, { mark: string; label: string; tone: string }> = {
  added: { mark: 'A', label: 'Added', tone: 'bg-ok/15 text-ok' },
  untracked: { mark: 'U', label: 'Untracked', tone: 'bg-ok/15 text-ok' },
  modified: { mark: 'M', label: 'Modified', tone: 'bg-warn/15 text-warn' },
  'type-changed': { mark: 'T', label: 'Type changed', tone: 'bg-warn/15 text-warn' },
  renamed: { mark: 'R', label: 'Renamed', tone: 'bg-accent/15 text-accent' },
  copied: { mark: 'C', label: 'Copied', tone: 'bg-accent/15 text-accent' },
  deleted: { mark: 'D', label: 'Deleted', tone: 'bg-danger/15 text-danger' },
  unmerged: { mark: '!', label: 'Conflicted', tone: 'bg-danger/15 text-danger' },
}

function fileCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`
}

function splitPath(path: string): { directory: string; name: string } {
  const slash = path.lastIndexOf('/') + 1
  return { directory: path.slice(0, slash), name: path.slice(slash) }
}

function StatusMark({ status }: { status: GitChangeStatus }): JSX.Element {
  const { mark, label, tone } = STATUS[status]
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold leading-none', tone)}
    >
      {mark}
    </span>
  )
}

/** `+12 −3`; a side with nothing on it is left out, and a binary file has no line counts to give. */
function ChangeCounts({ additions, deletions, binary = false }: { additions: number; deletions: number; binary?: boolean }): JSX.Element | null {
  if (binary) return <span className="shrink-0 text-fg-subtle">binary</span>
  if (additions === 0 && deletions === 0) return null
  return (
    <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
      {additions > 0 && <span className="text-ok">+{additions}</span>}
      {deletions > 0 && <span className="text-danger">−{deletions}</span>}
    </span>
  )
}

function ChangedFileItem({ file, selected, onOpen }: { file: InboxChangedFile; selected: boolean; onOpen: (path: string) => void }): JSX.Element {
  const { directory, name } = splitPath(file.path)
  const counts = file.binary ? 'binary' : `${file.additions} additions, ${file.deletions} deletions`
  return (
    <button
      type="button"
      title={file.path}
      aria-label={`${file.path}, ${STATUS[file.status].label}, ${counts}`}
      data-testid="inbox-changes-file"
      data-changes-item
      aria-current={selected || undefined}
      onClick={() => onOpen(file.path)}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:-outline-offset-2',
        selected && 'bg-active'
      )}
    >
      <StatusMark status={file.status} />
      <span className="inbox-code-font min-w-0 flex-1 truncate text-[11.5px]">
        <span className="text-fg">{name}</span>
        {directory && <span className="ml-1.5 text-fg-subtle">{directory}</span>}
      </span>
      <span className="inbox-code-font text-[11px]">
        <ChangeCounts additions={file.additions} deletions={file.deletions} binary={file.binary} />
      </span>
    </button>
  )
}

function ListMessage({ children, role }: { children: string; role?: 'status' }): JSX.Element {
  return (
    <p role={role} className="flex items-center gap-2 px-3 py-4 text-[12px] text-fg-muted">
      {role === 'status' && <LoaderCircle className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" aria-hidden />}
      {children}
    </p>
  )
}

function ChangesList({ value, state, fill, threadId, onOpen }: { value?: InboxChangesResponse; state: ChangesState; fill: boolean; threadId: string; onOpen: (path: string) => void }): JSX.Element | null {
  const selectedPath = useInboxChanges((s) => s.selectedPath)
  if (!value) return state.error ? null : <ListMessage role="status">Loading changes…</ListMessage>
  if (!value.available) return <ListMessage>{value.reason ?? 'Git changes are not available here.'}</ListMessage>
  if (value.fileCount === 0) return <ListMessage>No uncommitted changes.</ListMessage>
  if (!value.files) return <ListMessage role="status">Loading changes…</ListMessage>
  const shown = value.files.slice(0, CHANGES_LIST_LIMIT)
  const hidden = value.files.length - shown.length
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto p-1', !fill && 'max-h-[22rem]')}>
      {shown.map((file) => (
        <ChangedFileItem key={file.path} file={file} selected={selectedPath?.threadId === threadId && selectedPath.path === file.path} onOpen={onOpen} />
      ))}
      {hidden > 0 && <p className="px-2 py-1.5 text-[11px] text-fg-subtle">and {fileCountLabel(hidden)} more not shown</p>}
    </div>
  )
}

/**
 * The changes in a thread's checkout: its branch and totals, the files, and what is being compared. Both the
 * popover under a thread and the sidebar's Changes tab show it; `fill` lets the list take the height it is given.
 */
function ChangesDetails({ threadId, state, fill = false, onOpened }: { threadId: string; state: ChangesState; fill?: boolean; onOpened?: () => void }): JSX.Element {
  const value = state.value
  const available = value?.available ? value : undefined
  return (
    <>
      <div className="flex shrink-0 items-start gap-3 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
            <span className="min-w-0 truncate" title={available?.branch ?? undefined}>
              {available ? available.branch ?? 'Detached HEAD' : 'Git changes'}
            </span>
          </p>
          {available && <p className="mt-0.5 text-[11px] text-fg-subtle">{fileCountLabel(available.fileCount)} changed</p>}
        </div>
        {available && (
          <span className="inbox-code-font pt-px text-[12px]">
            <ChangeCounts additions={available.additions} deletions={available.deletions} />
          </span>
        )}
      </div>
      {state.error && (
        <p role="alert" className="flex shrink-0 items-start gap-1.5 border-b border-line bg-danger/10 px-3 py-2 text-[11.5px] leading-snug text-danger">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{state.error}{state.stale ? ' Showing the last result.' : ''}</span>
        </p>
      )}
      <ChangesList
        value={value}
        state={state}
        fill={fill}
        threadId={threadId}
        onOpen={(path) => {
          onOpened?.()
          useInboxChanges.getState().openFile(threadId, path)
        }}
      />
      <p className="shrink-0 border-t border-line px-3 py-2 text-[11px] leading-snug text-fg-subtle">
        {GIT_CHANGES_NOTE}
        {available?.uncounted ? ` Line counts leave out ${fileCountLabel(available.uncounted)} that Git does not track.` : ''}
      </p>
    </>
  )
}

/**
 * Floats beside its anchor (the thread's row, so it opens past the sidebar rather than over the other threads),
 * to the right where there is room and to the left where there is not, and keeps
 * inside the window as the content grows or the list behind it scrolls. It is portaled so the sidebar's
 * scrolling cannot clip it.
 */
function Popover({
  anchor, label, elementRef: ref, focusOnOpen, onPointerEnter, onPointerLeave, onKeyDown, children,
}: {
  anchor: HTMLElement
  label: string
  /** The popover's own element, for the badge's outside-press and Escape checks. */
  elementRef: { current: HTMLDivElement | null }
  focusOnOpen: boolean
  onPointerEnter: () => void
  onPointerLeave: () => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}): JSX.Element {
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (): void => {
      const box = anchor.getBoundingClientRect()
      const width = element.offsetWidth
      const height = element.offsetHeight
      const right = box.right + POPOVER_GAP
      const left = right + width <= window.innerWidth - POPOVER_MARGIN
        ? right
        : Math.max(POPOVER_MARGIN, box.left - POPOVER_GAP - width)
      const top = Math.max(POPOVER_MARGIN, Math.min(box.top - 6, window.innerHeight - POPOVER_MARGIN - height))
      setPlace((previous) => previous?.left === left && previous.top === top ? previous : { left, top })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(element)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer?.disconnect()
    }
  }, [anchor, ref])
  // Focus waits for the first measurement: an element that is still hidden cannot take it.
  const placed = place !== null
  useEffect(() => { if (focusOnOpen && placed) ref.current?.focus() }, [focusOnOpen, placed, ref])
  // Native listeners: React's own enter and leave events follow the component tree, and do not reach a
  // portaled element when the pointer arrives from the sidebar's row.
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.addEventListener('pointerenter', onPointerEnter)
    element.addEventListener('pointerleave', onPointerLeave)
    return () => {
      element.removeEventListener('pointerenter', onPointerEnter)
      element.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [ref, onPointerEnter, onPointerLeave])
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      data-testid="inbox-changes-popover"
      onKeyDown={onKeyDown}
      style={{
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        maxHeight: `calc(100vh - ${POPOVER_MARGIN * 2}px)`,
        // Measured before it is shown, so it never flashes at the corner of the window.
        visibility: place ? 'visible' : 'hidden',
      }}
      className={cn(
        'fixed z-50 flex w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-md border border-line-strong bg-elevated outline-none',
        'shadow-xl shadow-black/50 [animation:mde-menu-in_90ms_ease-out]'
      )}
    >
      {children}
    </div>,
    document.body
  )
}

/** Arrow keys walk the changed files; the list is otherwise ordinary buttons. */
function walkItems(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-changes-item]'))
  if (!items.length) return
  event.preventDefault()
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1) : Math.max(0, at <= 0 ? 0 : at - 1)
  items[next]?.focus()
}

type OpenMode = 'closed' | 'hover' | 'pinned'

/**
 * The changes in a thread's checkout, as a line under the thread in the sidebar. Resting on it lists the changed
 * files in a popover; choosing one reviews its diff. Clicking, or Enter, keeps the list open until it is dismissed.
 * A checkout with no changes, or none at all, leaves no line.
 */
export function InboxChangesBadge({ threadId }: { threadId: string }): JSX.Element {
  const rowRef = useRef<HTMLDivElement>(null)
  /** The thread's whole row: the popover opens beside it, and stays open while the pointer is anywhere on it. */
  const [row, setRow] = useState<HTMLElement | null>(null)
  const [chip, setChip] = useState<HTMLButtonElement | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<'hover' | 'closed' | null>(null)
  const keyboardOpen = useRef(false)
  const [mode, setMode] = useState<OpenMode>('closed')
  const popover = useRef<HTMLDivElement | null>(null)
  const state = useInboxChanges((s) => s.entries[inboxChangesKey(threadId)])
  const open = mode !== 'closed'

  // Rows scrolled out of the list stop asking Git. The element is observed even when it draws nothing: an
  // empty box inside the viewport still counts as intersecting.
  useEffect(() => {
    let stop: (() => void) | undefined
    if (!window.IntersectionObserver) return useInboxChanges.getState().watch(threadId)
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !stop) stop = useInboxChanges.getState().watch(threadId)
      else if (!entry?.isIntersecting && stop) {
        stop()
        stop = undefined
      }
    })
    if (rowRef.current) observer.observe(rowRef.current)
    return () => { observer.disconnect(); stop?.() }
  }, [threadId])

  // While the list is open it needs the files, and fresh ones.
  useEffect(() => {
    if (!open) return
    const stop = useInboxChanges.getState().watch(threadId, true)
    void useInboxChanges.getState().load(threadId, true, true)
    return stop
  }, [open, threadId])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const value = state?.value
  const changed = value?.available ? value : undefined
  const visible = Boolean(changed?.fileCount) || (!value && Boolean(state?.error))
  // A line that goes away must not come back already open.
  useEffect(() => { if (!visible) setMode('closed') }, [visible])

  // A list kept open is dismissed by Escape, or by pressing anywhere else.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const hadFocus = popover.current?.contains(document.activeElement) ?? false
      setMode('closed')
      if (hadFocus) chip?.focus()
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!popover.current?.contains(target) && !chip?.contains(target)) setMode('closed')
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open, chip])

  const cancel = useCallback((): void => {
    window.clearTimeout(timer.current)
    pending.current = null
  }, [])
  const schedule = useCallback((target: 'hover' | 'closed'): void => {
    window.clearTimeout(timer.current)
    pending.current = target
    timer.current = window.setTimeout(() => {
      pending.current = null
      setMode((current) => target === 'hover' ? (current === 'closed' ? 'hover' : current) : (current === 'hover' ? 'closed' : current))
    }, target === 'hover' ? OPEN_DELAY_MS : CLOSE_DELAY_MS)
  }, [])
  // Coming back onto the row or the popover calls off a closing, not an opening: the pointer enters the row
  // on its way onto the chip, and that must not cancel the chip's own wait.
  const hold = useCallback((): void => { if (pending.current === 'closed') cancel() }, [cancel])

  const leave = useCallback((): void => schedule('closed'), [schedule])

  // The popover opens beside the row, so the pointer has the row and a gap to cross on its way in.
  // Resting on the chip opens it; being anywhere on the row or the popover keeps it.
  useLayoutEffect(() => setRow(rowRef.current?.parentElement ?? null), [])
  useEffect(() => {
    if (!row) return
    row.addEventListener('pointerenter', hold)
    row.addEventListener('pointerleave', leave)
    return () => {
      row.removeEventListener('pointerenter', hold)
      row.removeEventListener('pointerleave', leave)
    }
  }, [row, hold, leave])

  const label = changed
    ? `Git changes: ${fileCountLabel(changed.fileCount)}, ${changed.additions} additions, ${changed.deletions} deletions`
    : 'Git changes unavailable'

  return (
    <div ref={rowRef} className={cn(visible && 'px-2 pb-1.5')}>
      {visible && (
        <button
          ref={setChip}
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-state={open ? 'open' : 'closed'}
          data-testid={`inbox-changes-${threadId}`}
          data-stale={state?.stale || undefined}
          className={cn(
            '-ml-1 flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-[11px] tabular-nums transition-colors',
            'hover:bg-fg/10 hover:text-fg-muted data-[state=open]:bg-fg/10 data-[state=open]:text-fg-muted',
            changed ? 'text-fg-subtle' : 'text-warn'
          )}
          onClick={(event) => {
            cancel()
            keyboardOpen.current = event.detail === 0
            setMode((current) => current === 'pinned' ? 'closed' : 'pinned')
          }}
          onPointerEnter={() => schedule('hover')}
        >
          {changed ? <FileDiff className="h-3 w-3 shrink-0" aria-hidden /> : <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />}
          {changed ? (
            <>
              <span>{fileCountLabel(changed.fileCount)}</span>
              <span className="inbox-code-font flex items-center gap-1.5 text-[10.5px]">
                <ChangeCounts additions={changed.additions} deletions={changed.deletions} />
              </span>
              {state?.stale && <AlertCircle className="h-3 w-3 shrink-0 text-warn" aria-hidden />}
            </>
          ) : <span>Changes unavailable</span>}
        </button>
      )}
      {visible && open && chip && row && state && (
        <Popover
          anchor={row}
          label="Git changes"
          elementRef={popover}
          focusOnOpen={mode === 'pinned' && keyboardOpen.current}
          onPointerEnter={hold}
          onPointerLeave={leave}
          onKeyDown={walkItems}
        >
          <ChangesDetails threadId={threadId} state={state} onOpened={() => setMode('closed')} />
        </Popover>
      )}
    </div>
  )
}

const SIDEBAR_TABS = ['files', 'changes', 'terminal'] as const
type SidebarTab = (typeof SIDEBAR_TABS)[number]
const SIDEBAR_TAB_LABELS: Record<SidebarTab, string> = { files: 'Files', changes: 'Changes', terminal: 'Terminal' }
/** A thread has changes to show; the page for a new one has none yet, so it offers the other two. */
const tabsFor = (threadId: string | undefined): readonly SidebarTab[] => threadId ? SIDEBAR_TABS : SIDEBAR_TABS.filter((item) => item !== 'changes')
/**
 * Each panel draws its own tabs in its header, so switching replaces the strip that has focus. The tab that was
 * chosen is focused again in the one that takes its place.
 */
let refocusTab: SidebarTab | null = null

/**
 * Files, Changes (of an open thread) and Terminal, in the place of the file tree's title. Left and Right (or
 * Home and End) move between them.
 */
function SidebarTabs({ threadId }: { threadId?: string }): JSX.Element {
  const stored = useInboxChanges((s) => s.tab)
  const tabs = tabsFor(threadId)
  const tab = tabs.includes(stored) ? stored : 'files'
  const count = useInboxChanges((s) => {
    const value = threadId ? s.entries[inboxChangesKey(threadId)]?.value : undefined
    return value?.available ? value.fileCount : 0
  })
  const choose = (next: SidebarTab, pointer = false): void => {
    // Nothing is replaced when the tab is already showing, so nothing would take the focus back.
    if (tab === next) return
    // A tab chosen with the pointer hands the keyboard to the terminal; one chosen with the keyboard keeps it.
    if (next === 'terminal' && pointer) focusInboxTerminalWhenShown()
    refocusTab = next
    useInboxChanges.getState().setTab(next)
  }
  const strip = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!refocusTab) return
    strip.current?.querySelector<HTMLButtonElement>(`[data-tab="${refocusTab}"]`)?.focus()
    refocusTab = null
  }, [])
  return (
    <div
      ref={strip}
      role="tablist"
      aria-label="Thread sidebar"
      className="flex min-w-0 flex-1 items-center gap-4"
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const at = tabs.indexOf(tab)
        const next = event.key === 'Home' ? tabs[0]
          : event.key === 'End' ? tabs[tabs.length - 1]
            : tabs[(at + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
        if (next) choose(next)
      }}
    >
      {tabs.map((item) => {
        const selected = tab === item
        return (
          <button
            key={item}
            type="button"
            role="tab"
            data-tab={item}
            data-testid={`inbox-sidebar-tab-${item}`}
            id={`inbox-${item}-tab`}
            aria-selected={selected}
            aria-controls={`inbox-${item}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={(event) => choose(item, event.detail > 0)}
            className={cn(
              'relative flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide transition-colors',
              selected
                ? 'text-fg after:absolute after:inset-x-0 after:-bottom-1.5 after:h-0.5 after:rounded-full after:bg-accent'
                : 'text-fg-subtle hover:text-fg-muted'
            )}
          >
            {SIDEBAR_TAB_LABELS[item]}
            {item === 'changes' && count > 0 && (
              <span className="rounded-full bg-fg/10 px-1.5 py-px text-[10px] normal-case leading-none tabular-nums text-fg-muted">{count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** The Changes tab: the same view as the popover, in the sidebar, for the thread that is open. */
function ChangesAside({ threadId }: { threadId: string }): JSX.Element {
  const state = useInboxChanges((s) => s.entries[inboxChangesKey(threadId)])
  const toggle = useWorkspace((s) => s.toggleFileTree)
  useEffect(() => {
    const stop = useInboxChanges.getState().watch(threadId, true)
    void useInboxChanges.getState().load(threadId, true, true)
    return stop
  }, [threadId])
  return (
    <aside data-testid="inbox-changes-panel" className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-line bg-panel">
      <div className="flex items-center gap-1 px-3 pb-2 pt-3">
        <SidebarTabs threadId={threadId} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          title="Refresh changes"
          aria-label="Refresh changes"
          disabled={state?.loading}
          onClick={() => void useInboxChanges.getState().load(threadId, true, true)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="shrink-0" title="Collapse sidebar" aria-label="Collapse sidebar" onClick={toggle}>
          <PanelRightClose className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div
        role="tabpanel"
        id="inbox-changes-panel"
        aria-labelledby="inbox-changes-tab"
        className="flex min-h-0 flex-1 flex-col border-t border-line"
        onKeyDown={walkItems}
      >
        {state ? (
          <ChangesDetails threadId={threadId} state={state} fill />
        ) : (
          <ListMessage role="status">Loading changes…</ListMessage>
        )}
      </div>
    </aside>
  )
}

/**
 * The Terminal tab: the Inbox's one terminal. It is the same whichever thread is open, so it is not tied to
 * one, and it is shown with the new-thread page as well.
 */
function TerminalAside({ threadId }: { threadId?: string }): JSX.Element {
  const toggle = useWorkspace((s) => s.toggleFileTree)
  return (
    <aside data-testid="inbox-terminal-panel" className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-line bg-panel">
      <div className="flex items-center gap-1 px-3 pb-2 pt-3">
        <SidebarTabs threadId={threadId} />
        <Button variant="ghost" size="icon-sm" className="shrink-0" title="Collapse sidebar" aria-label="Collapse sidebar" onClick={toggle}>
          <PanelRightClose className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div
        role="tabpanel"
        id="inbox-terminal-panel"
        aria-labelledby="inbox-terminal-tab"
        className="flex min-h-0 flex-1 flex-col border-t border-line"
      >
        <InboxTerminal />
      </div>
    </aside>
  )
}

/**
 * The right-hand sidebar of the Inbox: the files of the open thread's folder (or of the folder a new thread
 * starts in), the thread's Git changes, and the terminal. A new thread has no changes yet, so it offers
 * only the other two. It can be dragged wider, which the terminal in particular wants.
 */
export function InboxSidebar({ session, threadId }: { session: Session; threadId?: string }): JSX.Element {
  const stored = useInboxChanges((s) => s.tab)
  const collapsed = useWorkspace((s) => s.fileTreeCollapsed)
  // Changes belong to a thread. Without one, that tab is not offered and Files shows in its place.
  const tab = tabsFor(threadId).includes(stored) ? stored : 'files'
  const shown = Boolean(threadId) && !collapsed
  // The tab's count stays current while the sidebar is open: one thread, so one cheap read.
  useEffect(() => {
    if (threadId && shown) return useInboxChanges.getState().watch(threadId)
  }, [threadId, shown])
  if (collapsed) return <FileTreePanel session={session} browseOnly />
  return (
    <InboxSidebarFrame>
      {/* Kept mounted while another tab is showing, so the tree comes back with its folders open. Only the
          copy on screen carries the tabs. */}
      <div
        role="tabpanel"
        id="inbox-files-panel"
        aria-labelledby="inbox-files-tab"
        className={tab === 'files' ? 'contents' : 'hidden'}
        data-testid="inbox-files-panel"
      >
        <FileTreePanel session={session} browseOnly fill heading={tab === 'files' ? <SidebarTabs threadId={threadId} /> : undefined} />
      </div>
      {tab === 'changes' && threadId && <ChangesAside threadId={threadId} />}
      {tab === 'terminal' && <TerminalAside threadId={threadId} />}
    </InboxSidebarFrame>
  )
}

function PathCrumbs({ path }: { path: string }): JSX.Element {
  const segments = path.split('/')
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 text-[12px]" title={path}>
      {segments.map((segment, index) => (
        <span key={index} className="flex min-w-0 items-center gap-1">
          {index > 0 && <span className="text-fg-subtle">/</span>}
          <span className={cn('truncate', index === segments.length - 1 ? 'font-medium text-fg' : 'text-fg-muted')}>{segment}</span>
        </span>
      ))}
    </div>
  )
}

function ViewerMessage({ children, tone = 'muted', role }: { children: string; tone?: 'muted' | 'danger'; role?: 'status' | 'alert' }): JSX.Element {
  return (
    <p role={role} className={cn('flex items-center justify-center gap-2 p-6 text-center text-xs', tone === 'danger' ? 'text-danger' : 'text-fg-muted')}>
      {tone === 'danger' && <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />}
      {children}
    </p>
  )
}

/** A read-only review of one changed file's diff, laid over the conversation like a file opened from the tree. */
export function InboxChangeViewer({ threadId }: { threadId: string }): JSX.Element | null {
  const selected = useInboxChanges((s) => s.selectedPath)
  const state = useInboxChanges((s) => s.entries[inboxChangesKey(threadId)])
  // A file opened from the tree lands beneath this review; it takes over.
  const treeFile = useWorkspace((s) => s.openFiles[threadId])
  const [preview, setPreview] = useState<{ threadId: string; path: string; value?: InboxChangeDiff; error?: string } | null>(null)
  const [family, setFamily] = useState(() => getTerminalSettings().codeFamily)
  const ref = useRef<HTMLDivElement>(null)
  const file = selected?.threadId === threadId ? state?.value?.files?.find((f) => f.path === selected.path) : undefined
  useEffect(() => {
    if (!file) return
    let current = true
    setPreview((previous) => previous?.threadId === threadId && previous.path === file.path
      ? { ...previous, error: undefined }
      : { threadId, path: file.path })
    void window.api.inbox.changeDiff({ threadId, path: file.path }).then(
      (value) => { if (current) setPreview({ threadId, path: file.path, value }) },
      (error) => {
        if (current) setPreview((previous) => ({
          threadId, path: file.path,
          ...(previous?.threadId === threadId && previous.path === file.path ? { value: previous.value } : {}),
          error: ipcErrorMessage(error, 'Could not read Git diff.'),
        }))
      },
    )
    return () => { current = false }
  }, [threadId, file?.path, state?.value])
  useEffect(() => subscribeTerminalSettings(() => setFamily(getTerminalSettings().codeFamily)), [])
  useEffect(() => {
    if (!file) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [file?.path])
  useEffect(() => {
    if (treeFile !== undefined) useInboxChanges.getState().closeFile()
  }, [treeFile])
  // Leaving the thread, or the Inbox, ends the review rather than saving it for the thread's next visit.
  useEffect(() => () => {
    if (useInboxChanges.getState().selectedPath?.threadId === threadId) useInboxChanges.getState().closeFile()
  }, [threadId])
  const patch = preview?.threadId === threadId && preview.path === file?.path ? preview : null
  const hunks = useMemo(() => parseUnifiedDiff(patch?.value?.diff ?? ''), [patch?.value?.diff])
  if (!file) return null
  const close = (): void => useInboxChanges.getState().closeFile()
  const checkout = state?.value?.available ? state.value : undefined
  const binary = patch?.value?.binary || file.binary

  let body: JSX.Element | null = null
  if (patch?.value) {
    body = binary
      ? <ViewerMessage>Binary file — no text preview.</ViewerMessage>
      : hunks.length === 0
        ? <ViewerMessage>No line changes to show.</ViewerMessage>
        : (
          <div className="m-4 overflow-hidden rounded-lg border border-line bg-bg">
            <DiffBody
              expanded
              onExpand={() => undefined}
              change={{ path: file.path, action: 'edit', numbered: true, additions: file.additions, deletions: file.deletions, hunks }}
            />
            {patch.value.truncated && (
              <p className="border-t border-line bg-panel px-3 py-1.5 text-[11px] text-fg-subtle">
                Preview shortened to the first 64 KiB; the counts include the complete change.
              </p>
            )}
          </div>
        )
  } else if (!patch?.error) {
    body = <ViewerMessage role="status">Loading Git diff…</ViewerMessage>
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-bg outline-none"
      data-testid="inbox-change-viewer"
      style={{ '--inbox-code-font': codeViewerFontFamily(family) } as CSSProperties}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel pl-3 pr-1.5">
        <FileDiff className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
        <PathCrumbs path={file.path} />
        <StatusMark status={file.status} />
        <span className="inbox-code-font text-[11.5px]">
          <ChangeCounts additions={file.additions} deletions={file.deletions} binary={file.binary} />
        </span>
        <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Close change review" title="Close (Esc)" onClick={close}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="flex shrink-0 items-center gap-1.5 border-b border-line px-4 py-1.5 text-[11px] text-fg-subtle">
        {checkout && (
          <>
            <GitBranch className="h-3 w-3 shrink-0" aria-hidden />
            <span className="max-w-[40%] shrink-0 truncate text-fg-muted">{checkout.branch ?? 'Detached HEAD'}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span className="min-w-0 truncate">{GIT_CHANGES_NOTE}{state?.stale ? ' Previous counts may be out of date.' : ''}</span>
      </p>
      <div className="min-h-0 flex-1 overflow-auto">
        {patch?.error && <ViewerMessage tone="danger" role="alert">{patch.error}</ViewerMessage>}
        {body}
      </div>
    </div>
  )
}
