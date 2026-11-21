import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Minus, PanelRight, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  INBOX_BOTTOM_TERMINAL_DEFAULT_HEIGHT,
  INBOX_BOTTOM_TERMINAL_MIN_HEIGHT,
  INBOX_CONVERSATION_MIN_HEIGHT,
} from '@/lib/inbox-settings'
import { cn } from '@/lib/utils'
import { useInboxFloatingTerminal } from '@/store/inbox-floating-terminal'
import { dockTerminal, FloatTerminalButton } from './FloatingTerminal'
import { InboxTerminal } from './InboxTerminal'

const KEY_STEP = 16
const KEY_STEP_LARGE = 64

/**
 * The Inbox's terminal as a panel along the bottom of the conversation, like an editor's bottom panel: the thread
 * list and the right-hand sidebar keep their full height. Its top edge drags it taller or shorter, never under
 * INBOX_BOTTOM_TERMINAL_MIN_HEIGHT and never so tall that the conversation above gets under
 * INBOX_CONVERSATION_MIN_HEIGHT; the height is kept between runs. F11 shows and hides it. It is the same terminal
 * as the sidebar's and the floating one (one set of shells), so only one of them is ever on screen.
 * Mounted by the Inbox view below the conversation; draws nothing unless the terminal was moved to the bottom.
 */
export function BottomTerminal(): JSX.Element | null {
  const shown = useInboxFloatingTerminal((state) => state.placement === 'bottom' && state.visible)
  // Shown with F11 or the hidden reminder, it takes the keyboard; there when the Inbox opens, it leaves it where it is.
  const wasShown = useRef(shown)
  const opened = shown && !wasShown.current
  useEffect(() => { wasShown.current = shown })
  if (!shown) return null
  return <BottomTerminalPanel focusOnMount={opened} />
}

function BottomTerminalPanel({ focusOnMount }: { focusOnMount: boolean }): JSX.Element {
  const height = useInboxFloatingTerminal((state) => state.bottomHeight)
  const setHeight = useInboxFloatingTerminal((state) => state.setBottomHeight)
  const panel = useRef<HTMLElement>(null)
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  /** The tallest the panel can be in this window; Infinity until the column it sits in has been measured. */
  const [room, setRoom] = useState(Infinity)
  const limit = Math.max(INBOX_BOTTOM_TERMINAL_MIN_HEIGHT, room)
  const shownHeight = Math.min(height, limit)
  // Where the keyboard was, so hiding the panel hands it back there instead of leaving it nowhere.
  const [before] = useState(() => document.activeElement)
  useEffect(() => () => {
    if (before instanceof HTMLElement && before.isConnected && (!document.activeElement || document.activeElement === document.body)) before.focus()
  }, [before])

  useLayoutEffect(() => {
    const column = panel.current?.parentElement
    if (!column) return
    const measure = (): void => setRoom(Math.floor(column.getBoundingClientRect().height - INBOX_CONVERSATION_MIN_HEIGHT))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(column)
    return () => observer.disconnect()
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: shownHeight }
    setDragging(true)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    // The panel is at the bottom, so moving the pointer up makes it taller.
    setHeight(Math.min(limit, current.startHeight + (current.startY - event.clientY)), false)
  }
  const finish = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setHeight(useInboxFloatingTerminal.getState().bottomHeight)
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    const next = event.key === 'ArrowUp' ? shownHeight + step
      : event.key === 'ArrowDown' ? shownHeight - step
        : event.key === 'Home' ? INBOX_BOTTOM_TERMINAL_MIN_HEIGHT
          : event.key === 'End' ? limit
            : null
    if (next === null) return
    event.preventDefault()
    setHeight(Math.min(limit, next))
  }

  return (
    <section
      ref={panel}
      aria-label="Terminal panel"
      data-testid="bottom-terminal"
      className="relative flex shrink-0 flex-col border-t border-line bg-panel"
      style={{ height: shownHeight }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal panel"
        aria-valuemin={INBOX_BOTTOM_TERMINAL_MIN_HEIGHT}
        aria-valuemax={Number.isFinite(limit) ? limit : undefined}
        aria-valuenow={shownHeight}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        data-testid="bottom-terminal-resize"
        data-dragging={dragging || undefined}
        className={cn(
          'group absolute inset-x-0 -top-1 z-20 flex h-2 cursor-row-resize touch-none flex-col justify-center outline-none',
          'focus-visible:[&>span]:bg-accent data-[dragging]:[&>span]:bg-accent'
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onDoubleClick={() => setHeight(Math.min(limit, INBOX_BOTTOM_TERMINAL_DEFAULT_HEIGHT))}
        onKeyDown={onKeyDown}
      >
        <span aria-hidden className="h-0.5 w-full bg-transparent transition-colors group-hover:bg-accent/60" />
      </div>
      <div className="flex h-8 shrink-0 select-none items-center gap-1 border-b border-line px-2">
        <Terminal className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-fg-subtle">Terminal</span>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Move back to the sidebar"
          aria-label="Move terminal back to the sidebar"
          data-testid="bottom-terminal-dock"
          onClick={dockTerminal}
        >
          <PanelRight className="h-3.5 w-3.5" />
        </Button>
        <FloatTerminalButton />
        <Button
          variant="ghost"
          size="icon-sm"
          title="Hide (F11)"
          aria-label="Hide terminal"
          data-testid="bottom-terminal-hide"
          onClick={() => useInboxFloatingTerminal.getState().hide()}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="bottom-terminal-body">
        <InboxTerminal focusOnMount={focusOnMount} />
      </div>
    </section>
  )
}
