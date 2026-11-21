import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  INBOX_BESIDE_FILE_DEFAULT_SHARE,
  INBOX_BESIDE_FILE_MAX_SHARE,
  INBOX_BESIDE_FILE_MIN_SHARE,
  INBOX_BESIDE_MIN_WIDTH,
  clampInboxBesideFileShare,
  getInboxBesideFileShare,
  saveInboxBesideFileShare,
} from '@/lib/inbox-settings'
import { cn } from '@/lib/utils'

const KEY_STEP = 0.02
const KEY_STEP_LARGE = 0.1

/**
 * The column at the right of the conversation that a file opened beside it stands in. Dragging its left edge gives
 * the file more or less of the room; the share is one setting, kept between runs. Neither the file nor the
 * conversation gets narrower than INBOX_BESIDE_MIN_WIDTH while the window has room for both.
 */
export function BesideFilePane({ children }: { children: ReactNode }): JSX.Element {
  const [share, setShare] = useState(getInboxBesideFileShare)
  const [dragging, setDragging] = useState(false)
  const pane = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; room: number } | null>(null)

  const place = (next: number, keep: boolean): void => {
    const value = clampInboxBesideFileShare(next)
    setShare(value)
    if (keep) saveInboxBesideFileShare(value)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const element = pane.current
    const room = element?.parentElement?.getBoundingClientRect().width ?? 0
    if (event.button !== 0 || !element || !(room > 0)) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: element.getBoundingClientRect().width, room }
    setDragging(true)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    // The file is on the right, so moving the pointer left makes it wider.
    place((current.startWidth + current.startX - event.clientX) / current.room, false)
  }
  const finish = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    saveInboxBesideFileShare(share)
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    const next = event.key === 'ArrowLeft' ? share + step
      : event.key === 'ArrowRight' ? share - step
        : event.key === 'Home' ? INBOX_BESIDE_FILE_MIN_SHARE
          : event.key === 'End' ? INBOX_BESIDE_FILE_MAX_SHARE
            : null
    if (next === null) return
    event.preventDefault()
    place(next, true)
  }

  return (
    <div
      ref={pane}
      data-testid="inbox-beside-file"
      // Its own stacking layer, so the floating sidebar card stays above the file as it does above the conversation.
      className="relative isolate h-full shrink-0 border-l border-line"
      style={{
        width: `${share * 100}%`,
        minWidth: `min(${INBOX_BESIDE_MIN_WIDTH}px, 50%)`,
        maxWidth: `max(calc(100% - ${INBOX_BESIDE_MIN_WIDTH}px), 50%)`,
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the file beside the chat"
        aria-valuemin={Math.round(INBOX_BESIDE_FILE_MIN_SHARE * 100)}
        aria-valuemax={Math.round(INBOX_BESIDE_FILE_MAX_SHARE * 100)}
        aria-valuenow={Math.round(share * 100)}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        data-testid="inbox-beside-file-resize"
        data-dragging={dragging || undefined}
        className={cn(
          'group absolute inset-y-0 -left-1 z-40 flex w-2 cursor-col-resize touch-none justify-center outline-none',
          'focus-visible:[&>span]:bg-accent data-[dragging]:[&>span]:bg-accent',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onDoubleClick={() => place(INBOX_BESIDE_FILE_DEFAULT_SHARE, true)}
        onKeyDown={onKeyDown}
      >
        <span aria-hidden className="h-full w-0.5 bg-transparent transition-colors group-hover:bg-accent/60" />
      </div>
      {children}
    </div>
  )
}
