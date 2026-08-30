import { createPortal } from 'react-dom'
import * as React from 'react'
import { Monitor, Terminal } from 'lucide-react'
import type { Session } from '@shared/types'
import { cn } from '@/lib/utils'

const PANEL_WIDTH = 256
const VIEWPORT_PADDING = 8
const PANEL_GAP = 8
const HOVER_OPEN_DELAY_MS = 180
const CLOSE_DELAY_MS = 120

interface SessionEnvironmentPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  session: Session
  children: React.ReactElement
}

interface PanelPosition {
  left: number
  top: number
}

function setRef<T>(ref: React.ForwardedRef<T>, value: T | null): void {
  if (typeof ref === 'function') ref(value)
  else if (ref) (ref as React.MutableRefObject<T | null>).current = value
}

function EnvironmentDetail({ label, value, mono = false }: {
  label: string
  value: string
  mono?: boolean
}): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className={cn('mt-0.5 min-w-0 text-[12px] text-fg', mono && 'break-all font-mono')}>
        {value}
      </dd>
    </div>
  )
}

export const SessionEnvironmentPanel = React.forwardRef<
  HTMLDivElement,
  SessionEnvironmentPanelProps
>(function SessionEnvironmentPanel({ session, children, className, ...props }, forwardedRef) {
  const anchorRef = React.useRef<HTMLDivElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const openTimerRef = React.useRef<number | undefined>(undefined)
  const closeTimerRef = React.useRef<number | undefined>(undefined)
  const anchorHoveredRef = React.useRef(false)
  const anchorFocusedRef = React.useRef(false)
  const panelHoveredRef = React.useRef(false)
  const [open, setOpen] = React.useState(false)
  const [position, setPosition] = React.useState<PanelPosition>({ left: 0, top: 0 })
  const panelId = `session-environment-${session.id}`
  const isWsl = session.kind === 'wsl'
  const EnvironmentIcon = isWsl ? Terminal : Monitor

  const clearCloseTimer = React.useCallback((): void => {
    if (closeTimerRef.current === undefined) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = undefined
  }, [])

  const clearOpenTimer = React.useCallback((): void => {
    if (openTimerRef.current === undefined) return
    window.clearTimeout(openTimerRef.current)
    openTimerRef.current = undefined
  }, [])

  const positionPanel = React.useCallback((): void => {
    const anchor = anchorRef.current
    if (!anchor) return

    const anchorRect = anchor.getBoundingClientRect()
    const panelRect = panelRef.current?.getBoundingClientRect()
    const panelWidth = panelRect?.width || PANEL_WIDTH
    const panelHeight = panelRect?.height || 180
    const rightPosition = anchorRect.right + PANEL_GAP
    const left =
      rightPosition + panelWidth <= window.innerWidth - VIEWPORT_PADDING
        ? rightPosition
        : Math.max(VIEWPORT_PADDING, anchorRect.left - panelWidth - PANEL_GAP)
    const top = Math.max(
      VIEWPORT_PADDING,
      Math.min(anchorRect.top, window.innerHeight - panelHeight - VIEWPORT_PADDING)
    )

    setPosition({ left, top })
  }, [])

  const openPanel = React.useCallback((): void => {
    clearOpenTimer()
    clearCloseTimer()
    setOpen(true)
    positionPanel()
  }, [clearCloseTimer, clearOpenTimer, positionPanel])

  const scheduleHoverOpen = React.useCallback((): void => {
    clearOpenTimer()
    clearCloseTimer()
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = undefined
      if (anchorHoveredRef.current) openPanel()
    }, HOVER_OPEN_DELAY_MS)
  }, [clearCloseTimer, clearOpenTimer, openPanel])

  const scheduleClose = React.useCallback((): void => {
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined
      if (!anchorHoveredRef.current && !anchorFocusedRef.current && !panelHoveredRef.current) {
        setOpen(false)
      }
    }, CLOSE_DELAY_MS)
  }, [clearCloseTimer])

  React.useLayoutEffect(() => {
    if (!open) return
    positionPanel()
  }, [open, positionPanel])

  React.useEffect(() => {
    if (!open) return

    const closeOnScroll = (): void => setOpen(false)
    window.addEventListener('resize', positionPanel)
    document.addEventListener('scroll', closeOnScroll, true)
    return () => {
      window.removeEventListener('resize', positionPanel)
      document.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [open, positionPanel])

  React.useEffect(() => {
    return () => {
      clearOpenTimer()
      clearCloseTimer()
    }
  }, [clearCloseTimer, clearOpenTimer])

  const assignAnchorRef = (node: HTMLDivElement | null): void => {
    anchorRef.current = node
    setRef(forwardedRef, node)
  }

  const trigger = React.cloneElement(children, {
    'aria-describedby': panelId
  })

  const panel = open ? createPortal(
    <div
      ref={panelRef}
      id={panelId}
      role="tooltip"
      data-testid="session-environment-panel"
      className="pointer-events-auto fixed z-50 w-64 max-w-[calc(100vw-1rem)] rounded-md border border-line-strong bg-elevated p-2.5 text-fg shadow-xl shadow-black/50 [animation:mde-menu-in_90ms_ease-out]"
      style={{ left: position.left, top: position.top }}
      onMouseEnter={() => {
        panelHoveredRef.current = true
        clearCloseTimer()
      }}
      onMouseLeave={() => {
        panelHoveredRef.current = false
        scheduleClose()
      }}
    >
      <div className="flex items-start gap-2 border-b border-line pb-2">
        <EnvironmentIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
            Environment
          </div>
          <div className="mt-0.5 truncate text-xs font-medium text-fg">{session.name}</div>
        </div>
      </div>
      <dl className="mt-2 space-y-2">
        <EnvironmentDetail label="Runtime" value={isWsl ? 'WSL' : 'Native'} />
        {isWsl && (
          <EnvironmentDetail label="Distribution" value={session.distro ?? 'Not configured'} />
        )}
        <EnvironmentDetail label="Working directory" value={session.path} mono />
      </dl>
    </div>,
    document.body
  ) : null

  return (
    <div
      ref={assignAnchorRef}
      {...props}
      className={cn('relative', className)}
      onMouseEnter={() => {
        anchorHoveredRef.current = true
        scheduleHoverOpen()
      }}
      onMouseLeave={() => {
        anchorHoveredRef.current = false
        clearOpenTimer()
        scheduleClose()
      }}
      onFocus={() => {
        anchorFocusedRef.current = true
        openPanel()
      }}
      onBlur={(event) => {
        const relatedTarget = event.relatedTarget
        if (
          relatedTarget instanceof Node &&
          (event.currentTarget.contains(relatedTarget) || panelRef.current?.contains(relatedTarget))
        ) {
          return
        }
        anchorFocusedRef.current = false
        scheduleClose()
      }}
    >
      {trigger}
      {panel}
    </div>
  )
})

SessionEnvironmentPanel.displayName = 'SessionEnvironmentPanel'
