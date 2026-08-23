import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import {
  Code,
  CircleX,
  RotateCw,
  Settings2
} from 'lucide-react'
import type {
  OpenCodeTuiPluginState,
  OpenCodeTuiInstanceLabelMode,
  OpenCodeTuiSettings,
  OpenCodePluginTarget,
  OpenCodeTokenRatePluginState,
  OpenCodeAlertSettings,
  PtySize,
  Session
} from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { AboutSettingsPanel } from '@/components/AboutSettingsPanel'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useWorkspace } from '@/store/workspace'
import {
  applyTerminalSettings,
  attachSession,
  detachSession,
  fitSession,
  getSession
} from '@/terminal/sessions'
import { terminalSizeAction } from '@/terminal/terminal-compat'
import {
  getTerminalSettings,
  listTerminalFonts,
  saveTerminalSettings,
  TERMINAL_LINE_HEIGHTS,
  TERMINAL_FONT_SIZES,
  type TerminalSettings
} from '@/terminal/terminal-settings'
import {
  APPLICATION_THEMES,
  applyApplicationTheme,
  getTerminalPalette
} from '@/theme/themes'
import {
  terminalGridTemplates,
  layoutClass,
  paneClass,
  panesToTrim,
  TERMINAL_LAYOUTS,
  terminalCount,
  getTerminalLayoutShortcut,
  swapTerminalPanes,
  terminalResizeHandles,
  terminalSplitRatio,
  type SessionTerminalLayout,
  type TerminalLayout,
  type TerminalPaneState,
  type TerminalResizeAxis,
  type TerminalResizeScope
} from '@/terminal/layout'

const FALLBACK_SIZE: PtySize = { cols: 80, rows: 24 }
const RESIZE_DEBOUNCE_MS = 100

interface TerminalViewProps {
  session: Session
  terminalLayout: SessionTerminalLayout
  onLayoutChange: (layout: TerminalLayout) => void
  onLayoutResize: (axis: TerminalResizeAxis, ratio: number) => void
  onPaneOrderChange: (terminalIds: readonly string[]) => void
  onReduceLayout: (layout: TerminalLayout, paneIds: string[]) => void
  onClosePane: (terminalId: string) => void
  onRestartPrimary: () => void
}

interface TerminalSurfaceProps {
  session: Session
  pane: TerminalPaneState
}

function TerminalSurface({ session: sourceSession, pane }: TerminalSurfaceProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const setStatus = useWorkspace((state) => state.setStatus)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Re-parents the existing terminal, or builds it on first view of this session.
    const terminal = attachSession(pane.terminalId, host)
    let cancelled = false
    let ensured = false
    let previousSize: PtySize | null = null
    let ensurePromise: Promise<void> | null = null
    let retry: number | undefined

    const syncSize = (): void => {
      if (cancelled) return

      const action = terminalSizeAction(fitSession(terminal), ensured, previousSize)
      if (action.type === 'wait') {
        if (!ensured && retry === undefined) {
          retry = window.setTimeout(() => {
            retry = undefined
            syncSize()
          }, RESIZE_DEBOUNCE_MS)
        }
        return
      }

      if (action.type === 'ensure') {
        ensured = true
        previousSize = action.size
        ensurePromise = window.api.pty.ensure({
          terminalId: pane.terminalId,
          sessionId: sourceSession.id,
          size: action.size,
          palette: getTerminalPalette(terminal.themeId)
        }).then((status) => {
          if (cancelled) return
          if (pane.primary) setStatus(sourceSession.id, status)
          terminal.term.focus()
        }).catch((error: unknown) => {
          console.warn('[terminal] PTY ensure failed:', error)
          ensured = false
          previousSize = null
        }).finally(() => {
          ensurePromise = null
          if (!cancelled) syncSize()
        })
        return
      }

      if (ensurePromise) {
        return
      }

      previousSize = action.size
      void window.api.pty.resize({ terminalId: pane.terminalId, size: action.size })
    }

    let debounce: number | undefined
    const observer = new ResizeObserver(() => {
      window.clearTimeout(debounce)
      // Resizing on every observer callback would flood the PTY with SIGWINCH
      // and leave TUIs redrawing against a stale geometry.
      debounce = window.setTimeout(() => {
        syncSize()
      }, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(host)
    const frame = requestAnimationFrame(syncSize)

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      window.clearTimeout(debounce)
      window.clearTimeout(retry)
      observer.disconnect()
      // Detach only: the process, its scrollback and its cursor all stay alive.
      detachSession(pane.terminalId)
    }
  }, [pane.primary, pane.terminalId, setStatus, sourceSession.id])

  return <div ref={hostRef} className="terminal-host relative min-h-0 flex-1 overflow-hidden" />
}

function TerminalPane({
  session,
  pane,
  onClose,
  reorderState = 'none'
}: {
  session: Session
  pane: TerminalPaneState
  onClose: () => void
  reorderState?: 'none' | 'candidate' | 'active'
}): JSX.Element {
  const clearExit = useWorkspace((state) => state.clearExit)
  const setStatus = useWorkspace((state) => state.setStatus)
  const platform = useWorkspace((state) => state.platform)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  const currentDirectory = useWorkspace((state) => state.terminalDirectories[pane.terminalId])

  const restart = async (): Promise<void> => {
    const terminal = getSession(pane.terminalId)
    terminal?.term.reset()
    const size = (terminal && fitSession(terminal)) || FALLBACK_SIZE
    if (pane.primary) clearExit(session.id)
    const status = await window.api.pty.restart({
      terminalId: pane.terminalId,
      sessionId: session.id,
      size,
      palette: getTerminalPalette(terminal?.themeId ?? getTerminalSettings().theme)
    })
    if (pane.primary) setStatus(session.id, status)
  }

  const borderClass = reorderState === 'active'
    ? 'border-accent'
    : reorderState === 'candidate'
      ? 'border-accent/70'
      : 'border-line'

  return (
    <div className={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border ${borderClass} bg-bg`}>
      <TerminalSurface session={session} pane={pane} />
      <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
        {platform?.isWindows === true &&
          wslAvailable &&
          session.kind === 'wsl' &&
          Boolean(session.distro) && (
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label="Open terminal directory in VS Code"
              title={currentDirectory ? 'Open current directory in VS Code' : 'Waiting for terminal directory'}
              disabled={!currentDirectory}
              onClick={() => void window.api.paths.openTerminalInVsCode(pane.terminalId)}
            >
              <Code className="h-3.5 w-3.5" />
            </Button>
          )}
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Restart terminal"
          title="Restart terminal"
          onClick={() => void restart()}
        >
          <RotateCw className="h-3.5 w-3.5" />
        </Button>
        {!pane.primary && (
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label="Close terminal"
            title="Close terminal"
            onClick={onClose}
          >
            <CircleX className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

interface TerminalReorderPoint {
  clientX: number
  clientY: number
}

interface TerminalReorderDragState {
  pointerId: number
  sourceTerminalId: string
  originalPanes: TerminalPaneState[]
  previewPanes: TerminalPaneState[]
  pendingPoint?: TerminalReorderPoint
  frame?: number
  previousCursor: string
  previousUserSelect: string
}

function terminalReorderModifierActive(event: {
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}): boolean {
  return event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey
}

function terminalPaneSlotAtPoint(
  container: HTMLDivElement,
  clientX: number,
  clientY: number
): number | null {
  const element = document.elementFromPoint(clientX, clientY)
  if (!element || !container.contains(element)) return null

  const slot = element.closest<HTMLElement>('[data-terminal-pane-slot]')
  if (!slot || !container.contains(slot)) return null

  const index = Number(slot.dataset.terminalPaneSlot)
  return Number.isInteger(index) ? index : null
}

function restoreTerminalReorderStyles(drag: TerminalReorderDragState): void {
  document.body.style.cursor = drag.previousCursor
  document.body.style.userSelect = drag.previousUserSelect
}

function LayoutGlyph({ layout }: { layout: TerminalLayout }): JSX.Element {
  const count = terminalCount(layout)
  const columns = layout === 'single' ? 'grid-cols-1' : 'grid-cols-2'
  const rows = layout === 'single' || layout === 'columns' ? 'grid-rows-1' : 'grid-rows-2'
  return (
    <span className={`grid h-3.5 w-4 gap-px ${columns} ${rows}`} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={`rounded-[1px] bg-current ${layout === 'three' && index === 2 ? 'col-span-2' : ''}`}
        />
      ))}
    </span>
  )
}

interface TerminalResizeHandleProps {
  axis: TerminalResizeAxis
  scope: TerminalResizeScope
  ratio: number
  sizes: SessionTerminalLayout['sizes']
  containerRef: RefObject<HTMLDivElement>
  onResize: (ratio: number) => void
}

interface TerminalDragState {
  pointerId: number
  pendingRatio: number
  frame?: number
  previousCursor: string
  previousUserSelect: string
}

function splitLinePosition(ratio: number): string {
  return `calc(${ratio * 100}% + ${0.5 - ratio}px)`
}

function terminalResizeHandleStyle(
  axis: TerminalResizeAxis,
  scope: TerminalResizeScope,
  sizes: SessionTerminalLayout['sizes']
): CSSProperties {
  if (axis === 'column') {
    return {
      left: splitLinePosition(sizes.columnRatio),
      top: 0,
      height: scope === 'top' ? splitLinePosition(sizes.rowRatio) : '100%'
    }
  }

  return {
    left: 0,
    top: splitLinePosition(sizes.rowRatio),
    width: '100%'
  }
}

function TerminalResizeHandle({
  axis,
  scope,
  ratio,
  sizes,
  containerRef,
  onResize
}: TerminalResizeHandleProps): JSX.Element {
  const dragRef = useRef<TerminalDragState | null>(null)

  const restoreDocumentStyles = (drag: TerminalDragState): void => {
    document.body.style.cursor = drag.previousCursor
    document.body.style.userSelect = drag.previousUserSelect
  }

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    if (drag.frame !== undefined) cancelAnimationFrame(drag.frame)
    onResize(drag.pendingRatio)
    dragRef.current = null
    restoreDocumentStyles(drag)

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  useEffect(() => {
    return () => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.frame !== undefined) cancelAnimationFrame(drag.frame)
      restoreDocumentStyles(drag)
    }
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const container = containerRef.current
    if (!container) return

    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      pointerId: event.pointerId,
      pendingRatio: ratio,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect
    }
    document.body.style.cursor = axis === 'column' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    const container = containerRef.current
    if (!drag || drag.pointerId !== event.pointerId || !container) return

    event.preventDefault()
    const bounds = container.getBoundingClientRect()
    const pointerPosition = axis === 'column'
      ? event.clientX - bounds.left
      : event.clientY - bounds.top
    const trackSize = axis === 'column' ? bounds.width : bounds.height
    drag.pendingRatio = terminalSplitRatio(pointerPosition, trackSize)

    if (drag.frame !== undefined) return
    drag.frame = requestAnimationFrame(() => {
      const current = dragRef.current
      if (!current) return
      current.frame = undefined
      onResize(current.pendingRatio)
    })
  }

  const lineClass = axis === 'column' ? 'h-full w-px' : 'h-px w-full'
  const handleClass = axis === 'column'
    ? 'h-full w-2 -translate-x-1/2 cursor-col-resize flex-col'
    : 'h-2 w-full -translate-y-1/2 cursor-row-resize flex-row'

  return (
    <div
      role="separator"
      aria-label={axis === 'column' ? 'Resize terminal columns' : 'Resize terminal rows'}
      aria-orientation={axis === 'column' ? 'vertical' : 'horizontal'}
      data-testid={`terminal-resize-${axis}-${scope}`}
      className={`group absolute z-20 flex touch-none items-center justify-center ${handleClass}`}
      style={terminalResizeHandleStyle(axis, scope, sizes)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
    >
      <span className={`bg-transparent transition-colors group-hover:bg-accent ${lineClass}`} />
    </div>
  )
}

function pluginStatusLabel(state: OpenCodeTuiPluginState | undefined): string {
  if (!state) return 'Checking…'
  if (state.status === 'installed') return `Installed · v${state.installedVersion}`
  if (state.status === 'outdated') {
    return `Update available · v${state.installedVersion ?? 'unknown'} → v${state.currentVersion}`
  }
  if (state.status === 'conflict') return 'Another plugin owns this file'
  return 'Not installed'
}

function tokenRateTargetKey(target: OpenCodePluginTarget): string {
  return target.kind === 'native' ? 'native' : 'wsl:' + target.distro
}

function tokenRateTargetLabel(target: OpenCodePluginTarget): string {
  return target.kind === 'native' ? 'Native Linux' : target.distro + ' (WSL 2)'
}

function tokenRatePluginStatusLabel(state: OpenCodeTokenRatePluginState | undefined): string {
  if (!state) return 'Checking…'
  if (state.status === 'installed') {
    return 'Installed · v' + (state.installedVersion ?? state.currentVersion) +
      (state.opencodeVersion ? ' · OpenCode v' + state.opencodeVersion : '')
  }
  if (state.status === 'outdated') {
    return 'Update available · v' + (state.installedVersion ?? 'unknown') + ' → v' + state.currentVersion
  }
  if (state.status === 'conflict') return 'Another plugin owns the MDE plugin file'
  if (state.status === 'unsupported') return 'Requires OpenCode 1.18.18 or newer'
  if (state.status === 'unavailable') return 'Could not detect OpenCode from the target login shell'
  if (state.status === 'repair-needed') return 'Installed file needs registration repair'
  return 'Not installed'
}

type SettingsSection = 'appearance' | 'opencode' | 'about'

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'about', label: 'About' }
]

function SettingsControl({ terminalIds }: { terminalIds: string[] }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')
  const sectionButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [settings, setSettings] = useState<TerminalSettings>(() => getTerminalSettings())
  const [availableFonts] = useState(() => listTerminalFonts())
  const platform = useWorkspace((state) => state.platform)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  const distros = useWorkspace((state) => state.distros)
  const refreshDistros = useWorkspace((state) => state.refreshDistros)
  const opencodeTuiInstanceLabelMode = useWorkspace((state) => state.opencodeTuiInstanceLabelMode)
  const setOpenCodeTuiInstanceLabelMode = useWorkspace(
    (state) => state.setOpenCodeTuiInstanceLabelMode
  )
  const [tuiSettings, setTuiSettings] = useState<OpenCodeTuiSettings>({
    enabled: false,
    currentPluginVersion: '',
    instanceLabelMode: 'numbered'
  })
  const [pluginStates, setPluginStates] = useState<Record<string, OpenCodeTuiPluginState>>({})
  const [tuiLoading, setTuiLoading] = useState(false)
  const [tuiBusyDistro, setTuiBusyDistro] = useState<string | null>(null)
  const [tuiError, setTuiError] = useState<string | null>(null)
  const [tokenRateStates, setTokenRateStates] = useState<Record<string, OpenCodeTokenRatePluginState>>({})
  const [tokenRateLoading, setTokenRateLoading] = useState(false)
  const [tokenRateBusyTarget, setTokenRateBusyTarget] = useState<string | null>(null)
  const [tokenRateError, setTokenRateError] = useState<string | null>(null)
  const [alertSettings, setAlertSettings] = useState<OpenCodeAlertSettings>({ enabled: true })
  const [alertLoading, setAlertLoading] = useState(false)
  const [alertError, setAlertError] = useState<string | null>(null)

  const canManageTui = platform?.isWindows === true && wslAvailable
  const canManageTokenRate =
    platform?.platform === 'linux' || (platform?.isWindows === true && wslAvailable)
  const tokenRateTargets: OpenCodePluginTarget[] =
    platform?.platform === 'linux'
      ? [{ kind: 'native' }]
      : distros.map((distro) => ({ kind: 'wsl', distro: distro.name }))

  useEffect(() => {
    if (open) setActiveSection('appearance')
  }, [open])

  const selectSection = (section: SettingsSection): void => {
    setActiveSection(section)
  }

  const moveSection = (currentIndex: number, delta: number): void => {
    const nextIndex = (currentIndex + delta + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length
    const nextSection = SETTINGS_SECTIONS[nextIndex]
    if (!nextSection) return
    setActiveSection(nextSection.id)
    sectionButtonRefs.current[nextIndex]?.focus()
  }

  const handleSectionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      moveSection(index, 1)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      moveSection(index, -1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      const firstSection = SETTINGS_SECTIONS[0]
      if (firstSection) {
        setActiveSection(firstSection.id)
        sectionButtonRefs.current[0]?.focus()
      }
    } else if (event.key === 'End') {
      event.preventDefault()
      const lastIndex = SETTINGS_SECTIONS.length - 1
      const lastSection = SETTINGS_SECTIONS[lastIndex]
      if (lastSection) {
        setActiveSection(lastSection.id)
        sectionButtonRefs.current[lastIndex]?.focus()
      }
    }
  }

  useEffect(() => {
    if (open && canManageTui) void refreshDistros()
  }, [canManageTui, open, refreshDistros])

  const updateSettings = (patch: Partial<TerminalSettings>): void => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveTerminalSettings(next)
    applyApplicationTheme(next.theme)
    applyTerminalSettings(next)

    terminalIds.forEach((terminalId) => {
      const terminal = getSession(terminalId)
      const size = terminal ? fitSession(terminal) : null
      if (size) void window.api.pty.resize({ terminalId, size })
    })
  }

  useEffect(() => {
    if (!open || !canManageTui) return
    let cancelled = false
    setTuiLoading(true)
    setTuiError(null)
    void Promise.all([
      window.api.opencodeTui.settings(),
      Promise.allSettled(
        distros.map((distro) => window.api.opencodeTui.pluginState({ distro: distro.name }))
      )
    ])
      .then(([nextSettings, stateResults]) => {
        if (cancelled) return
        const nextStates: Record<string, OpenCodeTuiPluginState> = {}
        const failures: string[] = []
        stateResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            nextStates[result.value.distro] = result.value
          } else {
            failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
          }
        })
        setTuiSettings(nextSettings)
        setPluginStates(nextStates)
        if (failures.length > 0) setTuiError(failures[0] ?? 'Could not inspect one or more WSL distros.')
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTuiError(error instanceof Error ? error.message : String(error))
        }
      })
      .finally(() => {
        if (!cancelled) setTuiLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canManageTui, distros, open])

  useEffect(() => {
    if (!open || !canManageTokenRate) return
    let cancelled = false
    const targets: OpenCodePluginTarget[] =
      platform?.platform === 'linux'
        ? [{ kind: 'native' }]
        : distros.map((distro) => ({ kind: 'wsl', distro: distro.name }))
    setTokenRateLoading(true)
    setTokenRateError(null)
    void Promise.allSettled(
      targets.map((target) => window.api.opencodeTokenRate.pluginState({ target }))
    )
      .then((results) => {
        if (cancelled) return
        const nextStates: Record<string, OpenCodeTokenRatePluginState> = {}
        const failures: string[] = []
        results.forEach((result, index) => {
          const target = targets[index]
          if (!target) return
          if (result.status === 'fulfilled') {
            nextStates[tokenRateTargetKey(result.value.target)] = result.value
          } else {
            failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
          }
        })
        setTokenRateStates(nextStates)
        if (failures.length > 0) setTokenRateError(failures[0] ?? 'Could not inspect the token-rate plugin.')
      })
      .finally(() => {
        if (!cancelled) setTokenRateLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canManageTokenRate, distros, open, platform?.platform])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setAlertLoading(true)
    setAlertError(null)
    void window.api.opencodeAlerts
      .settings()
      .then((next) => {
        if (!cancelled) setAlertSettings(next)
      })
      .catch((error: unknown) => {
        if (!cancelled) setAlertError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setAlertLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const setTuiEnabled = async (): Promise<void> => {
    setTuiError(null)
    try {
      const next = await window.api.opencodeTui.setEnabled({ enabled: !tuiSettings.enabled })
      setTuiSettings(next)
    } catch (error) {
      setTuiError(error instanceof Error ? error.message : String(error))
    }
  }

  const changeTuiInstanceLabelMode = async (
    mode: OpenCodeTuiInstanceLabelMode
  ): Promise<void> => {
    setTuiError(null)
    try {
      await setOpenCodeTuiInstanceLabelMode(mode)
      setTuiSettings((current) => ({ ...current, instanceLabelMode: mode }))
    } catch (error) {
      setTuiError(error instanceof Error ? error.message : String(error))
    }
  }

  const setAlertsEnabled = async (): Promise<void> => {
    setAlertError(null)
    setAlertLoading(true)
    try {
      const next = await window.api.opencodeAlerts.setEnabled({ enabled: !alertSettings.enabled })
      setAlertSettings(next)
    } catch (error) {
      setAlertError(error instanceof Error ? error.message : String(error))
    } finally {
      setAlertLoading(false)
    }
  }

  const changePlugin = async (distro: string, action: 'install' | 'remove'): Promise<void> => {
    setTuiBusyDistro(distro)
    setTuiError(null)
    try {
      const state =
        action === 'install'
          ? await window.api.opencodeTui.install({ distro })
          : await window.api.opencodeTui.remove({ distro })
      setPluginStates((current) => ({ ...current, [distro]: state }))
    } catch (error) {
      setTuiError(error instanceof Error ? error.message : String(error))
    } finally {
      setTuiBusyDistro(null)
    }
  }

  const changeTokenRatePlugin = async (target: OpenCodePluginTarget, action: 'install' | 'remove'): Promise<void> => {
    const key = tokenRateTargetKey(target)
    setTokenRateBusyTarget(key)
    setTokenRateError(null)
    try {
      const state =
        action === 'install'
          ? await window.api.opencodeTokenRate.install({ target })
          : await window.api.opencodeTokenRate.remove({ target })
      setTokenRateStates((current) => ({ ...current, [key]: state }))
    } catch (error) {
      setTokenRateError(error instanceof Error ? error.message : String(error))
    } finally {
      setTokenRateBusyTarget(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        aria-label="Change settings"
        data-testid="terminal-settings-control"
        title="Settings"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-xs text-fg-subtle hover:bg-hover hover:text-fg"
      >
        <Settings2 className="h-3.5 w-3.5" />
        Settings
      </button>

      <DialogContent animated={false} className="flex h-[min(42rem,85vh)] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Appearance changes apply immediately. Plugin changes apply after OpenCode is restarted.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[10rem_minmax(0,1fr)] gap-5 overflow-hidden">
          <div className="min-w-0 border-r border-line pr-3">
            <div
              role="tablist"
              aria-label="Settings sections"
              aria-orientation="vertical"
              className="flex flex-col gap-1"
            >
              {SETTINGS_SECTIONS.map((section, index) => {
                const active = activeSection === section.id
                return (
                  <button
                    key={section.id}
                    ref={(element) => {
                      sectionButtonRefs.current[index] = element
                    }}
                    type="button"
                    id={`terminal-settings-tab-${section.id}`}
                    role="tab"
                    aria-selected={active}
                    aria-controls="terminal-settings-panel"
                    tabIndex={active ? 0 : -1}
                    onClick={() => selectSection(section.id)}
                    onKeyDown={(event) => handleSectionKeyDown(event, index)}
                    className={`w-full rounded px-3 py-2 text-left text-xs font-medium transition-colors ${
                      active ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
                    }`}
                  >
                    {section.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div
            id="terminal-settings-panel"
            role="tabpanel"
            aria-labelledby={`terminal-settings-tab-${activeSection}`}
            tabIndex={0}
            className="min-w-0 min-h-0 overflow-y-auto pr-1"
          >
            {activeSection === 'appearance' && (
              <section className="space-y-3" aria-labelledby="appearance-settings">
                <h3 id="appearance-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                  Appearance
                </h3>
                <div className="space-y-4">
                  <label className="block text-xs font-medium text-fg-muted">
                    Application theme
                    <Select
                      value={settings.theme}
                      onValueChange={(value) => {
                        const theme = APPLICATION_THEMES.find((option) => option.id === value)
                        if (theme) updateSettings({ theme: theme.id })
                      }}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {APPLICATION_THEMES.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="block text-xs font-medium text-fg-muted">
                    Font family
                    <Select value={settings.family} onValueChange={(family) => updateSettings({ family })}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableFonts.map((font) => (
                          <SelectItem key={font.family} value={font.family}>
                            {font.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="block text-xs font-medium text-fg-muted">
                    Font size
                    <Select
                      value={String(settings.size)}
                      onValueChange={(value) => {
                        const size = TERMINAL_FONT_SIZES.find((candidate) => String(candidate) === value)
                        if (size !== undefined) updateSettings({ size })
                      }}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TERMINAL_FONT_SIZES.map((size) => (
                          <SelectItem key={size} value={String(size)}>
                            {size}px
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="block text-xs font-medium text-fg-muted">
                    Line height
                    <Select
                      value={String(settings.lineHeight)}
                      onValueChange={(value) => {
                        const lineHeight = TERMINAL_LINE_HEIGHTS.find(
                          (candidate) => String(candidate) === value
                        )
                        if (lineHeight !== undefined) updateSettings({ lineHeight })
                      }}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TERMINAL_LINE_HEIGHTS.map((lineHeight) => (
                          <SelectItem key={lineHeight} value={String(lineHeight)}>
                            {lineHeight.toFixed(1)}×
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              </section>
            )}

            {activeSection === 'opencode' && (
              <section className="space-y-6" aria-labelledby="opencode-settings">
                <div>
                  <h3 id="opencode-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    OpenCode
                  </h3>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Configure desktop alerts, session status reporting, and token-rate display.
                  </p>
                </div>

                <section className="space-y-3" aria-labelledby="opencode-alert-settings">
                  <div>
                    <h4 id="opencode-alert-settings" className="text-xs font-medium text-fg">
                      Alerts
                    </h4>
                    <p className="mt-1 text-xs text-fg-subtle">
                      Flash the taskbar and play a sound when OpenCode finishes, needs input, or encounters an error while MDE is unfocused.
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={alertSettings.enabled}
                    data-testid="opencode-alerts-enabled"
                    disabled={alertLoading}
                    onClick={() => void setAlertsEnabled()}
                    className="flex w-full items-center justify-between rounded border border-line bg-panel px-3 py-2 text-left text-xs text-fg-muted hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span>
                      <span className="block font-medium text-fg">Enable OpenCode alerts</span>
                      <span className="mt-0.5 block text-fg-subtle">
                        {alertSettings.enabled ? 'Alerts are enabled.' : 'Alerts are disabled.'}
                      </span>
                    </span>
                    <span
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                        alertSettings.enabled ? 'bg-accent' : 'bg-line-strong'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                          alertSettings.enabled ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </span>
                  </button>
                  {alertError && <p className="text-xs text-danger">{alertError}</p>}
                </section>

                <section
                  className="space-y-3 border-t border-line pt-5"
                  aria-labelledby="opencode-tui-settings"
                >
                  <div>
                    <h4 id="opencode-tui-settings" className="text-xs font-medium text-fg">
                      Session status
                    </h4>
                    <p className="mt-1 text-xs text-fg-subtle">
                      Install the status plugin per WSL distro and control reporting across new sessions.
                    </p>
                  </div>

                  {!canManageTui ? (
                    <p className="rounded border border-line bg-panel px-3 py-2 text-xs text-fg-subtle">
                      This integration is available only on Windows with WSL 2.
                    </p>
                  ) : (
                    <>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={tuiSettings.enabled}
                        data-testid="opencode-tui-enabled"
                        disabled={tuiLoading || !tuiSettings.currentPluginVersion}
                        onClick={() => void setTuiEnabled()}
                        className="flex w-full items-center justify-between rounded border border-line bg-panel px-3 py-2 text-left text-xs text-fg-muted hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
                      >
                        <span>
                          <span className="block font-medium text-fg">Enable status reporting</span>
                          <span className="mt-0.5 block text-fg-subtle">
                            {tuiSettings.enabled
                              ? 'New and restarted terminals will report OpenCode TUI status.'
                              : 'Status reporting is disabled until you enable it.'}
                          </span>
                        </span>
                        <span
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                            tuiSettings.enabled ? 'bg-accent' : 'bg-line-strong'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                              tuiSettings.enabled ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                          />
                        </span>
                      </button>

                      <label className="block text-xs font-medium text-fg-muted">
                        Instance labels
                        <Select
                          value={opencodeTuiInstanceLabelMode}
                          onValueChange={(value) => {
                            if (value === 'numbered' || value === 'title') {
                              void changeTuiInstanceLabelMode(value)
                            }
                          }}
                        >
                          <SelectTrigger className="mt-1" data-testid="opencode-tui-instance-labels">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="numbered">OpenCode 1, 2, …</SelectItem>
                            <SelectItem value="title">OpenCode session titles</SelectItem>
                          </SelectContent>
                        </Select>
                        <span className="mt-1 block text-[11px] font-normal text-fg-subtle">
                          Session titles stay in MDE's local runtime status snapshot. Numbered labels are used when a title is unavailable.
                        </span>
                      </label>

                      <div className="space-y-2">
                        {distros.length === 0 ? (
                          <p className="text-xs text-fg-subtle">No WSL 2 distros found.</p>
                        ) : (
                          distros.map((distro) => {
                            const state = pluginStates[distro.name]
                            const busy = tuiBusyDistro === distro.name
                            const action = state?.status === 'installed' ? 'remove' : 'install'
                            const actionLabel =
                              state?.status === 'outdated'
                                ? 'Replace'
                                : state?.status === 'installed'
                                  ? 'Uninstall'
                                  : state?.status === 'conflict'
                                    ? 'Unavailable'
                                    : 'Install'
                            return (
                              <div
                                key={distro.name}
                                className="flex items-center gap-3 rounded border border-line bg-panel px-3 py-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-xs font-medium text-fg">{distro.name}</div>
                                  <div className="truncate text-[11px] text-fg-subtle">
                                    {distro.state} · {pluginStatusLabel(state)}
                                  </div>
                                </div>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={busy || state?.status === 'conflict' || !state}
                                  onClick={() => void changePlugin(distro.name, action)}
                                >
                                  {busy ? 'Working…' : actionLabel}
                                </Button>
                              </div>
                            )
                          })
                        )}
                      </div>
                      <p className="text-[11px] text-fg-subtle">
                        Current plugin version: v{tuiSettings.currentPluginVersion || '…'}. Restart OpenCode after installing,
                        replacing, or uninstalling the plugin.
                      </p>
                    </>
                  )}
                  {tuiError && <p className="text-xs text-danger">{tuiError}</p>}
                </section>

                <section
                  className="space-y-3 border-t border-line pt-5"
                  aria-labelledby="opencode-token-rate-settings"
                >
                  <div>
                    <h4 id="opencode-token-rate-settings" className="text-xs font-medium text-fg">
                      Token rate
                    </h4>
                    <p className="mt-1 text-xs text-fg-subtle">
                      A separate TUI plugin shows live estimated and final provider-reported tokens per second beside the prompt.
                      It is installed independently from status reporting and does not add a sidebar metric.
                    </p>
                  </div>

                  {!canManageTokenRate ? (
                    <p className="rounded border border-line bg-panel px-3 py-2 text-xs text-fg-subtle">
                      This integration is available on Linux and on Windows WSL 2 targets.
                    </p>
                  ) : tokenRateTargets.length === 0 ? (
                    <p className="text-xs text-fg-subtle">No WSL 2 distros found.</p>
                  ) : (
                    <div className="space-y-2">
                      {tokenRateTargets.map((target) => {
                        const key = tokenRateTargetKey(target)
                        const state = tokenRateStates[key]
                        const busy = tokenRateBusyTarget === key
                        const blocked =
                          state?.status === 'conflict' ||
                          state?.status === 'unsupported' ||
                          state?.status === 'unavailable' ||
                          !state
                        const action = state?.status === 'installed' ? 'remove' : 'install'
                        const actionLabel =
                          state?.status === 'outdated'
                            ? 'Replace'
                            : state?.status === 'repair-needed'
                              ? 'Repair'
                              : state?.status === 'installed'
                                ? 'Uninstall'
                                : 'Install'
                        return (
                          <div key={key} className="flex items-center gap-3 rounded border border-line bg-panel px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-medium text-fg">{tokenRateTargetLabel(target)}</div>
                              <div className="truncate text-[11px] text-fg-subtle">
                                {tokenRatePluginStatusLabel(state)}
                              </div>
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busy || blocked || tokenRateLoading}
                              onClick={() => void changeTokenRatePlugin(target, action)}
                            >
                              {busy ? 'Working…' : actionLabel}
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <p className="text-[11px] text-fg-subtle">
                    Restart OpenCode after installing, replacing, or uninstalling. No token-rate fallback is emitted when this plugin is unavailable.
                  </p>
                  {tokenRateError && <p className="text-xs text-danger">{tokenRateError}</p>}
                </section>
              </section>
            )}

            {activeSection === 'about' && <AboutSettingsPanel />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function TerminalView({
  session: selectedSession,
  terminalLayout,
  onLayoutChange,
  onLayoutResize,
  onPaneOrderChange,
  onReduceLayout,
  onClosePane,
  onRestartPrimary
}: TerminalViewProps): JSX.Element {
  const clearExit = useWorkspace((state) => state.clearExit)
  const setStatus = useWorkspace((state) => state.setStatus)
  const exit = useWorkspace((state) => state.exits[selectedSession.id])
  const [pendingLayout, setPendingLayout] = useState<TerminalLayout | null>(null)
  const [reorderModifierHeld, setReorderModifierHeld] = useState(false)
  const [hoveredPaneId, setHoveredPaneId] = useState<string | null>(null)
  const [reorderSourceId, setReorderSourceId] = useState<string | null>(null)
  const [reorderPreviewPanes, setReorderPreviewPanes] = useState<TerminalPaneState[] | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const reorderDragRef = useRef<TerminalReorderDragState | null>(null)

  const restart = useCallback(async () => {
    onRestartPrimary()
    const session = getSession(selectedSession.id)
    session?.term.reset()
    const size = (session && fitSession(session)) || FALLBACK_SIZE
    clearExit(selectedSession.id)
    const status = await window.api.pty.restart({
      terminalId: selectedSession.id,
      sessionId: selectedSession.id,
      size,
      palette: getTerminalPalette(session?.themeId ?? getTerminalSettings().theme)
    })
    setStatus(selectedSession.id, status)
    session?.term.focus()
  }, [clearExit, onRestartPrimary, selectedSession.id, setStatus])

  const requestLayout = useCallback((layout: TerminalLayout): void => {
    const targetCount = terminalCount(layout)
    if (targetCount >= terminalLayout.panes.length) {
      onLayoutChange(layout)
      return
    }
    setPendingLayout(layout)
  }, [onLayoutChange, terminalLayout.panes.length])

  const cancelReorder = useCallback((): void => {
    const drag = reorderDragRef.current
    if (!drag) {
      setReorderSourceId(null)
      setReorderPreviewPanes(null)
      return
    }

    if (drag.frame !== undefined) cancelAnimationFrame(drag.frame)
    const grid = gridRef.current
    reorderDragRef.current = null
    setReorderSourceId(null)
    setReorderPreviewPanes(null)
    restoreTerminalReorderStyles(drag)

    if (grid?.hasPointerCapture(drag.pointerId)) {
      grid.releasePointerCapture(drag.pointerId)
    }
  }, [])

  const updateReorderPreview = (drag: TerminalReorderDragState, point: TerminalReorderPoint): boolean => {
    const grid = gridRef.current
    if (!grid) return false

    const targetSlot = terminalPaneSlotAtPoint(grid, point.clientX, point.clientY)
    if (targetSlot === null) return false

    const targetPane = drag.previewPanes[targetSlot]
    if (!targetPane || targetPane.terminalId === drag.sourceTerminalId) return true

    drag.previewPanes = swapTerminalPanes(
      drag.previewPanes,
      drag.sourceTerminalId,
      targetPane.terminalId
    )
    setReorderPreviewPanes(drag.previewPanes)
    return true
  }

  const beginReorder = (event: ReactPointerEvent<HTMLDivElement>, terminalId: string): void => {
    if (
      event.pointerType !== 'mouse' ||
      !event.isPrimary ||
      event.button !== 0 ||
      !terminalReorderModifierActive(event) ||
      reorderDragRef.current
    ) {
      return
    }

    const target = event.target
    if (
      target instanceof Element &&
      target.closest('button, input, textarea, select, a, [role="separator"]')
    ) {
      return
    }

    const grid = gridRef.current
    if (!grid) return

    event.preventDefault()
    event.stopPropagation()
    const drag: TerminalReorderDragState = {
      pointerId: event.pointerId,
      sourceTerminalId: terminalId,
      originalPanes: [...terminalLayout.panes],
      previewPanes: [...terminalLayout.panes],
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect
    }
    reorderDragRef.current = drag
    setReorderSourceId(terminalId)
    setReorderPreviewPanes(drag.previewPanes)
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    grid.setPointerCapture(event.pointerId)
  }

  const moveReorder = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = reorderDragRef.current
    const grid = gridRef.current
    if (!grid) return

    if (!drag) {
      if (event.pointerType !== 'mouse') return
      const slot = terminalPaneSlotAtPoint(grid, event.clientX, event.clientY)
      setHoveredPaneId(slot === null ? null : terminalLayout.panes[slot]?.terminalId ?? null)
      return
    }

    if (drag.pointerId !== event.pointerId) return
    event.preventDefault()
    drag.pendingPoint = { clientX: event.clientX, clientY: event.clientY }

    if (drag.frame !== undefined) return
    drag.frame = requestAnimationFrame(() => {
      const current = reorderDragRef.current
      if (!current) return
      current.frame = undefined
      if (current.pendingPoint) updateReorderPreview(current, current.pendingPoint)
    })
  }

  const finishReorder = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = reorderDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    event.preventDefault()
    if (drag.frame !== undefined) cancelAnimationFrame(drag.frame)
    drag.frame = undefined
    const validTarget = updateReorderPreview(drag, {
      clientX: event.clientX,
      clientY: event.clientY
    })
    const finalOrder = drag.previewPanes.map((pane) => pane.terminalId)
    const grid = gridRef.current
    reorderDragRef.current = null
    setReorderSourceId(null)
    setReorderPreviewPanes(null)
    restoreTerminalReorderStyles(drag)

    if (grid?.hasPointerCapture(drag.pointerId)) {
      grid.releasePointerCapture(drag.pointerId)
    }
    if (validTarget) onPaneOrderChange(finalOrder)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && reorderDragRef.current) {
        event.preventDefault()
        event.stopPropagation()
        cancelReorder()
        return
      }
      setReorderModifierHeld(terminalReorderModifierActive(event))
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      const active = terminalReorderModifierActive(event)
      setReorderModifierHeld(active)
      if (!active && reorderDragRef.current) cancelReorder()
    }
    const onBlur = (): void => {
      setReorderModifierHeld(false)
      if (reorderDragRef.current) cancelReorder()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [cancelReorder])

  useEffect(() => {
    const drag = reorderDragRef.current
    if (!drag) return

    const currentIds = terminalLayout.panes.map((pane) => pane.terminalId)
    const originalIds = drag.originalPanes.map((pane) => pane.terminalId)
    if (
      currentIds.length !== originalIds.length ||
      currentIds.some((terminalId) => !originalIds.includes(terminalId))
    ) {
      cancelReorder()
    }
  }, [cancelReorder, terminalLayout.panes])

  useEffect(() => {
    return () => {
      const drag = reorderDragRef.current
      if (!drag) return
      if (drag.frame !== undefined) cancelAnimationFrame(drag.frame)
      reorderDragRef.current = null
      restoreTerminalReorderStyles(drag)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('[role="dialog"]')) return

      const layout = getTerminalLayoutShortcut({
        type: event.type,
        key: event.key,
        code: event.code,
        control: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        shift: event.shiftKey
      })
      if (!layout) return

      event.preventDefault()
      event.stopPropagation()
      requestLayout(layout)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [requestLayout])

  const confirmReduceLayout = (): void => {
    if (!pendingLayout) return
    onReduceLayout(pendingLayout, panesToTrim(terminalLayout.panes, terminalCount(pendingLayout)))
    setPendingLayout(null)
  }

  const location =
    selectedSession.kind === 'wsl'
      ? `${selectedSession.distro ?? 'WSL'} · ${selectedSession.path}`
      : selectedSession.path
  const gridTemplates = terminalGridTemplates(terminalLayout.layout, terminalLayout.sizes)
  const resizeHandles = terminalResizeHandles(terminalLayout.layout)
  const renderedPanes = reorderPreviewPanes ?? terminalLayout.panes

  return (
    <div className="flex h-full min-w-0 flex-col bg-bg">
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-line bg-panel/50 px-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span
            className="min-w-0 max-w-[40%] truncate text-[13px] font-semibold leading-5 text-fg"
            title={selectedSession.name}
          >
            {selectedSession.name}
          </span>
          <span aria-hidden="true" className="h-3 w-px shrink-0 self-center bg-line-strong" />
          <span
            className="min-w-0 flex-1 truncate font-mono text-xs leading-5 text-fg-muted"
            title={location}
          >
            {location}
          </span>
        </div>

        <div
          aria-label="Terminal layout"
          role="group"
          className="flex shrink-0 items-center gap-0.5 rounded border border-line bg-panel p-0.5"
        >
          {TERMINAL_LAYOUTS.map((candidate) => (
            <button
              key={candidate.value}
              type="button"
              aria-label={candidate.label}
              aria-pressed={terminalLayout.layout === candidate.value}
              data-testid={`terminal-layout-${candidate.value}`}
              title={`${candidate.label} (Ctrl+${candidate.count})`}
              onClick={() => requestLayout(candidate.value)}
              className={
                terminalLayout.layout === candidate.value
                  ? 'rounded-sm bg-active px-1.5 py-1 text-fg'
                  : 'rounded-sm px-1.5 py-1 text-fg-subtle hover:bg-hover hover:text-fg'
              }
            >
              <LayoutGlyph layout={candidate.value} />
            </button>
          ))}
        </div>
        <SettingsControl terminalIds={terminalLayout.panes.map((pane) => pane.terminalId)} />

        <Button
          variant="ghost"
          size="sm"
          className="ml-auto shrink-0"
          onClick={() => void restart()}
          title="Restart the shell for this session"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Restart
        </Button>
      </header>

      {exit && (
        <div className="flex shrink-0 items-center gap-3 border-b border-danger/30 bg-danger/10 px-3 py-1.5">
          <span className="text-xs text-danger">
            Process exited (code {exit.exitCode}
            {exit.signal ? `, signal ${exit.signal}` : ''})
          </span>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => void restart()}>
            Restart
          </Button>
        </div>
      )}

      <div
          ref={gridRef}
          className={`relative grid h-full min-h-0 flex-1 gap-px bg-line ${layoutClass(terminalLayout.layout)}`}
          style={{
            gridTemplateColumns: gridTemplates.columns,
            gridTemplateRows: gridTemplates.rows
          }}
          onPointerMove={moveReorder}
          onPointerUp={finishReorder}
          onPointerCancel={cancelReorder}
          onLostPointerCapture={cancelReorder}
          onPointerLeave={() => {
            if (!reorderDragRef.current) setHoveredPaneId(null)
          }}
        >
          {renderedPanes.map((pane, index) => (
            <div
              key={pane.terminalId}
              data-terminal-pane-slot={index}
              className={`h-full min-h-0 min-w-0 ${paneClass(terminalLayout.layout, index)}`}
              onPointerDownCapture={(event) => beginReorder(event, pane.terminalId)}
            >
              <TerminalPane
                session={selectedSession}
                pane={pane}
                reorderState={
                  reorderSourceId === pane.terminalId
                    ? 'active'
                    : reorderModifierHeld && hoveredPaneId === pane.terminalId
                      ? 'candidate'
                      : 'none'
                }
                onClose={() => onClosePane(pane.terminalId)}
              />
            </div>
          ))}
          {resizeHandles.map(({ axis, scope }) => (
            <TerminalResizeHandle
              key={`${axis}-${scope}`}
              axis={axis}
              scope={scope}
              ratio={axis === 'column' ? terminalLayout.sizes.columnRatio : terminalLayout.sizes.rowRatio}
              sizes={terminalLayout.sizes}
              containerRef={gridRef}
              onResize={(ratio) => onLayoutResize(axis, ratio)}
            />
          ))}
      </div>

      <AlertDialog
        open={pendingLayout !== null}
        onOpenChange={(open) => {
          if (!open) setPendingLayout(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Close extra terminals?</AlertDialogTitle>
          <AlertDialogDescription>
            Changing to {pendingLayout ? TERMINAL_LAYOUTS.find((candidate) => candidate.value === pendingLayout)?.label.toLowerCase() : 'a smaller layout'} will close the extra split terminals.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current layout</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReduceLayout}>Close terminals</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
