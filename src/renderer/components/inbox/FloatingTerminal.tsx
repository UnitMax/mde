import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AppWindow, Maximize2, Minimize2, Minus, PanelRight, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  clampFloatingRect,
  defaultFloatingRect,
  FLOATING_EDGES,
  moveFloatingRect,
  resizeFloatingRect,
  type FloatingBounds,
  type FloatingEdge,
  type FloatingRect
} from '@/lib/floating-window'
import { useInboxFloatingTerminal } from '@/store/inbox-floating-terminal'
import { focusInboxTerminalWhenShown, InboxTerminal } from './InboxTerminal'

const EDGE_STYLES: Record<FloatingEdge, string> = {
  n: 'inset-x-3 top-0 h-1.5 cursor-ns-resize',
  s: 'inset-x-3 bottom-0 h-1.5 cursor-ns-resize',
  e: 'inset-y-3 right-0 w-1.5 cursor-ew-resize',
  w: 'inset-y-3 left-0 w-1.5 cursor-ew-resize',
  ne: 'right-0 top-0 h-3 w-3 cursor-nesw-resize',
  nw: 'left-0 top-0 h-3 w-3 cursor-nwse-resize',
  se: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize',
  sw: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize',
}

interface Gesture {
  pointerId: number
  startX: number
  startY: number
  start: FloatingRect
  /** The edge being dragged; none when the whole window moves. */
  edge?: FloatingEdge
}

/** Puts the terminal back in the sidebar, and gives it the keyboard there. */
function dockTerminal(): void {
  focusInboxTerminalWhenShown()
  useInboxFloatingTerminal.getState().dock()
}

/** The button in the sidebar's Terminal tab that lifts the terminal out into a floating window. */
export function FloatTerminalButton(): JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      title="Float terminal over the conversation (then F11 shows and hides it)"
      aria-label="Float terminal"
      data-testid="floating-terminal-break-out"
      onClick={() => useInboxFloatingTerminal.getState().breakOut()}
    >
      <AppWindow className="h-3.5 w-3.5" />
    </Button>
  )
}

/** What the sidebar's Terminal tab shows while the terminal floats, since it cannot be in two places. */
export function FloatingTerminalNotice(): JSX.Element {
  const visible = useInboxFloatingTerminal((state) => state.visible)
  return (
    <div data-testid="floating-terminal-notice" role="status" className="flex flex-col items-start gap-3 p-4 text-[12px] leading-snug text-fg-muted">
      <p>The terminal is floating over the conversation. Press F11 to show or hide it.</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          data-testid="floating-terminal-notice-toggle"
          onClick={() => useInboxFloatingTerminal.getState().toggle()}
        >
          {visible ? 'Hide terminal' : 'Show terminal'}
        </Button>
        <Button variant="secondary" size="sm" data-testid="floating-terminal-notice-dock" onClick={dockTerminal}>
          <PanelRight className="h-3.5 w-3.5" />
          Move back to the sidebar
        </Button>
      </div>
    </div>
  )
}

function FloatingTerminalWindow({ bounds }: { bounds: FloatingBounds }): JSX.Element {
  const stored = useInboxFloatingTerminal((state) => state.rect)
  const maximized = useInboxFloatingTerminal((state) => state.maximized)
  const setRect = useInboxFloatingTerminal((state) => state.setRect)
  const gesture = useRef<Gesture | null>(null)
  // What the window is being dragged to, and how. Only the final place is kept in the store, on release.
  const [drag, setDrag] = useState<{ mode: 'move' | 'resize'; rect: FloatingRect } | null>(null)
  const dragging = drag !== null
  // Where the keyboard was, so hiding the window hands it back there instead of leaving it nowhere.
  const [before] = useState(() => document.activeElement)
  useEffect(() => () => {
    if (before instanceof HTMLElement && before.isConnected && (!document.activeElement || document.activeElement === document.body)) before.focus()
  }, [before])

  const placed = maximized
    ? { x: 0, y: 0, width: bounds.width, height: bounds.height }
    : clampFloatingRect(stored ?? defaultFloatingRect(bounds), bounds)
  // A move shows the window following the pointer; a resize leaves it as it is and draws an outline, because
  // resizing a live terminal refits it (and its shell) on every step and makes its content flicker.
  const rect = drag?.mode === 'move' ? drag.rect : placed

  const begin = (event: ReactPointerEvent<HTMLElement>, edge?: FloatingEdge): void => {
    if (event.button !== 0 || maximized) return
    if (!edge && (event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, start: placed, edge }
    setDrag({ mode: edge ? 'resize' : 'move', rect: placed })
  }
  const next = (event: ReactPointerEvent<HTMLElement>, current: Gesture): FloatingRect => {
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    return current.edge
      ? resizeFloatingRect(current.start, current.edge, dx, dy, bounds)
      : moveFloatingRect(current.start, dx, dy, bounds)
  }
  const move = (event: ReactPointerEvent<HTMLElement>): void => {
    const current = gesture.current
    if (current && current.pointerId === event.pointerId) setDrag({ mode: current.edge ? 'resize' : 'move', rect: next(event, current) })
  }
  const finish = (event: ReactPointerEvent<HTMLElement>): void => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    gesture.current = null
    setDrag(null)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setRect(next(event, current))
  }
  const toggleMaximized = (): void => useInboxFloatingTerminal.getState().toggleMaximized()
  const gestureProps = { onPointerMove: move, onPointerUp: finish, onPointerCancel: finish }

  return (
    <>
    <section
      aria-label="Floating terminal"
      data-testid="floating-terminal"
      data-maximized={maximized || undefined}
      data-dragging={dragging || undefined}
      data-drag-mode={drag?.mode}
      className={cn(
        'pointer-events-auto absolute flex min-h-0 flex-col overflow-hidden border border-line bg-panel shadow-2xl shadow-black/40',
        maximized ? 'rounded-none border-0' : 'rounded-lg'
      )}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      <div
        data-testid="floating-terminal-titlebar"
        className={cn(
          'flex h-8 shrink-0 select-none items-center gap-1 border-b border-line bg-panel px-2',
          maximized ? '' : 'cursor-grab data-[dragging]:cursor-grabbing'
        )}
        data-dragging={dragging || undefined}
        onPointerDown={(event) => begin(event)}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest('button')) toggleMaximized()
        }}
        {...gestureProps}
      >
        <Terminal className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-fg-subtle">Terminal</span>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Move back to the sidebar"
          aria-label="Move terminal back to the sidebar"
          data-testid="floating-terminal-dock"
          onClick={dockTerminal}
        >
          <PanelRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={maximized ? 'Restore size' : 'Fill the whole window'}
          aria-label={maximized ? 'Restore terminal size' : 'Maximize terminal'}
          data-testid="floating-terminal-maximize"
          onClick={toggleMaximized}
        >
          {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Hide (F11)"
          aria-label="Hide terminal"
          data-testid="floating-terminal-hide"
          onClick={() => useInboxFloatingTerminal.getState().hide()}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {/* Kept mounted but not painted while the window is carried, so its shell and screen are untouched and
          nothing flickers; the panel colour shows through in its place. */}
      <div className={cn('flex min-h-0 flex-1 flex-col', drag?.mode === 'move' && 'invisible')} data-testid="floating-terminal-body">
        <InboxTerminal focusOnMount />
      </div>
      {!maximized && FLOATING_EDGES.map((edge) => (
        <div
          key={edge}
          aria-hidden
          data-testid={`floating-terminal-resize-${edge}`}
          className={cn('absolute z-10 touch-none', EDGE_STYLES[edge])}
          onPointerDown={(event) => begin(event, edge)}
          {...gestureProps}
        />
      ))}
    </section>
    {drag?.mode === 'resize' && (
      <div
        aria-hidden
        data-testid="floating-terminal-outline"
        className="pointer-events-none absolute rounded-lg border-2 border-accent bg-accent/10"
        style={{ left: drag.rect.x, top: drag.rect.y, width: drag.rect.width, height: drag.rect.height }}
      />
    )}
    </>
  )
}

/**
 * The Inbox's terminal as a window floating inside the app window, over everything under the title bar (both
 * sidebars and the conversation): it can be moved,
 * resized from every edge, maximized and put back in the sidebar, and F11 shows and hides it. It is the
 * same terminal as the sidebar's (one set of shells), so only one of the two is ever on screen.
 * Mounted once by the Inbox view; draws nothing until the terminal has been broken out of the sidebar.
 */
export function FloatingTerminal(): JSX.Element | null {
  const floating = useInboxFloatingTerminal((state) => state.floating)
  const visible = useInboxFloatingTerminal((state) => state.visible)
  const layer = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState<FloatingBounds | null>(null)

  // While the terminal floats, the main process hands F11 to it rather than putting the window in full screen.
  useEffect(() => {
    if (!floating) return
    const api = window.api.floatingTerminal
    void api.setActive(true)
    const stop = api.onToggle(() => useInboxFloatingTerminal.getState().toggle())
    return () => {
      stop()
      void api.setActive(false)
    }
  }, [floating])

  useLayoutEffect(() => {
    const element = layer.current
    if (!element) return
    const measure = (): void => {
      const { width, height } = element.getBoundingClientRect()
      setBounds((current) => current && current.width === width && current.height === height ? current : { width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [floating, visible])

  if (!floating || !visible) return null
  return (
    <div ref={layer} data-testid="floating-terminal-layer" className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {bounds && bounds.width > 0 && bounds.height > 0 && <FloatingTerminalWindow bounds={bounds} />}
    </div>
  )
}
