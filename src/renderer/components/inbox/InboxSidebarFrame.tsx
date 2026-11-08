import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  INBOX_SIDEBAR_DEFAULT_WIDTH,
  INBOX_SIDEBAR_MAX_WIDTH,
  INBOX_SIDEBAR_MIN_WIDTH,
} from '@/lib/inbox-settings'
import { cn } from '@/lib/utils'
import { useInboxView } from '@/store/inbox-view'

const KEY_STEP = 16
const KEY_STEP_LARGE = 64

/**
 * The Inbox's right-hand sidebar: whichever panel it shows (files, changes or the terminal) fills it, and
 * dragging its left edge makes it wider or narrower. The width is one setting for all three, kept between runs,
 * and it never takes more than 70% of the window, whatever was set on a bigger one.
 */
export function InboxSidebarFrame({ children }: { children: ReactNode }): JSX.Element {
  const width = useInboxView((state) => state.sidebarWidth)
  const setWidth = useInboxView((state) => state.setSidebarWidth)
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const frame = useRef<HTMLDivElement>(null)

  /** The width the sidebar has on screen, which the window can hold below the one that was set. */
  const shownWidth = (): number => frame.current?.getBoundingClientRect().width || width

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: shownWidth() }
    setDragging(true)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    // The sidebar is on the right, so moving the pointer left makes it wider.
    setWidth(current.startWidth + (current.startX - event.clientX), false)
  }
  const finish = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setWidth(useInboxView.getState().sidebarWidth)
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    const next = event.key === 'ArrowLeft' ? width + step
      : event.key === 'ArrowRight' ? width - step
        : event.key === 'Home' ? INBOX_SIDEBAR_MIN_WIDTH
          : event.key === 'End' ? INBOX_SIDEBAR_MAX_WIDTH
            : null
    if (next === null) return
    event.preventDefault()
    setWidth(next)
  }

  return (
    <div
      ref={frame}
      data-testid="inbox-sidebar-frame"
      className="relative flex h-full min-h-0 shrink-0"
      style={{ width, maxWidth: '70vw' }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={INBOX_SIDEBAR_MIN_WIDTH}
        aria-valuemax={INBOX_SIDEBAR_MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        data-testid="inbox-sidebar-resize"
        data-dragging={dragging || undefined}
        className={cn(
          'group absolute inset-y-0 -left-1 z-20 flex w-2 cursor-col-resize touch-none justify-center outline-none',
          'focus-visible:[&>span]:bg-accent data-[dragging]:[&>span]:bg-accent'
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onDoubleClick={() => setWidth(INBOX_SIDEBAR_DEFAULT_WIDTH)}
        onKeyDown={onKeyDown}
      >
        <span aria-hidden className="h-full w-0.5 bg-transparent transition-colors group-hover:bg-accent/60" />
      </div>
      {children}
    </div>
  )
}
