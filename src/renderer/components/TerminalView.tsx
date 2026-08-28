import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import {
  Code,
  CircleX,
  FolderOpen,
  Maximize2,
  Minimize2,
  Plus,
  RotateCw,
  Settings2,
  X
} from 'lucide-react'
import type {
  OpenCodeTuiPluginState,
  OpenCodeTuiInstanceLabelMode,
  OpenCodeTuiSettings,
  OpenCodePluginTarget,
  OpenCodeTokenRatePluginState,
  OpenCodeAlertSettings,
  PtySize,
  Session,
  SessionTab
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
import { ipcErrorMessage } from '@/lib/ipc-error'
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
  subscribeTerminalSettings,
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
  terminalColumnRatios,
  terminalColumnSplitRatio,
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
  type TerminalColumnIndex,
  type TerminalResizeAxis,
  type TerminalResizeScope
} from '@/terminal/layout'
import {
  isTerminalFullscreenShortcut,
  shouldExitTerminalFullscreen,
  terminalFullscreenPane
} from '@/terminal/fullscreen'
import { fileDropUris, isFileDrop, terminalDropMode, terminalDropNotice } from '@/terminal/drop'
import { sessionTabs } from '@/terminal/tabs'

const FALLBACK_SIZE: PtySize = { cols: 80, rows: 24 }
const RESIZE_DEBOUNCE_MS = 100

function textInputHasFocus(): boolean {
  const active = document.activeElement
  return active instanceof HTMLElement && (
    active.matches('input, textarea, select') || active.isContentEditable
  )
}

interface TerminalViewProps {
  session: Session
  activeTab: SessionTab
  terminalLayout: SessionTerminalLayout
  onSelectTab: (tabId: string) => void
  onAddTab: () => void
  onTabRenameStart: () => void
  onRenameTab: (tabId: string, name: string) => void
  onCloseTab: (tabId: string) => void
  onLayoutChange: (layout: TerminalLayout) => void
  onLayoutResize: (axis: TerminalResizeAxis, ratio: number, columnIndex?: TerminalColumnIndex) => void
  onPaneOrderChange: (terminalIds: readonly string[]) => void
  onReduceLayout: (layout: TerminalLayout, paneIds: string[]) => void
  onClosePane: (terminalId: string) => void
  onRestartPrimary: () => void
}

interface TerminalSurfaceProps {
  session: Session
  pane: TerminalPaneState
  onFocus: () => void
}

function TerminalSurface({ session: sourceSession, pane, onFocus }: TerminalSurfaceProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const dragDepthRef = useRef(0)
  const dropQueueRef = useRef(Promise.resolve())
  const dropNoticeTimerRef = useRef<number | undefined>(undefined)
  const [fileDragOver, setFileDragOver] = useState(false)
  const [dropNotice, setDropNotice] = useState<string | null>(null)
  const setStatus = useWorkspace((state) => state.setStatus)

  const announceDrop = (message: string): void => {
    setDropNotice(message)
    window.clearTimeout(dropNoticeTimerRef.current)
    dropNoticeTimerRef.current = window.setTimeout(() => {
      setDropNotice(null)
      dropNoticeTimerRef.current = undefined
    }, 3500)
  }

  const enqueueFileDrop = (files: File[], uriList: string[], mode: 'shell' | 'tui'): void => {
    const task = async (): Promise<void> => {
      try {
        const result = await window.api.pty.dropFiles({
          terminalId: pane.terminalId,
          files,
          uriList,
          mode
        })
        const terminal = getSession(pane.terminalId)
        if (result.insertions.length > 0 && terminal) {
          terminal.term.focus()
          for (const insertion of result.insertions) terminal.term.paste(insertion)
        }

        if (result.rejections.length > 0) announceDrop(terminalDropNotice(result.rejections))
      } catch (error) {
        console.warn('[terminal] file drop failed:', error)
        announceDrop('Could not add the dropped files to this terminal.')
      }
    }

    dropQueueRef.current = dropQueueRef.current.then(task, task)
  }

  const handleDragEnter = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!isFileDrop(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    dragDepthRef.current += 1
    setFileDragOver(true)
  }

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!isFileDrop(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setFileDragOver(true)
  }

  const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!isFileDrop(event.dataTransfer)) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setFileDragOver(false)
  }

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!isFileDrop(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = 0
    setFileDragOver(false)

    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) {
      const terminal = getSession(pane.terminalId)
      const mode = terminalDropMode(terminal?.term.buffer.active.type ?? 'normal')
      const uriList = fileDropUris(event.dataTransfer.getData('text/uri-list'))
      enqueueFileDrop(files, uriList, mode)
    }
  }

  useEffect(() => {
    return () => window.clearTimeout(dropNoticeTimerRef.current)
  }, [])

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
          setStatus(pane.terminalId, status)
          if (!textInputHasFocus()) terminal.term.focus()
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

  return (
    <div
      ref={hostRef}
      className="terminal-host relative min-h-0 flex-1 overflow-hidden"
      onFocus={onFocus}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {fileDragOver && (
        <div
          className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-md border border-dashed border-accent bg-bg/80 text-sm font-medium text-fg"
          data-testid="terminal-file-drop-overlay"
        >
          Drop files to attach or insert paths
        </div>
      )}
      {dropNotice && (
        <div
          className="pointer-events-none absolute bottom-3 left-3 z-30 max-w-[calc(100%-1.5rem)] rounded-md border border-border bg-panel/95 px-3 py-2 text-xs text-muted-fg shadow-lg"
          role="status"
          aria-live="polite"
        >
          {dropNotice}
        </div>
      )}
    </div>
  )
}

function TerminalPane({
  session,
  pane,
  onClose,
  onFocus,
  isFullscreen,
  onToggleFullscreen,
  reorderState = 'none'
}: {
  session: Session
  pane: TerminalPaneState
  onClose: () => void
  onFocus: () => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
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
    if (pane.primary) clearExit(pane.terminalId)
    const status = await window.api.pty.restart({
      terminalId: pane.terminalId,
      sessionId: session.id,
      size,
      palette: getTerminalPalette(terminal?.themeId ?? getTerminalSettings().theme)
    })
    setStatus(pane.terminalId, status)
  }

  const borderClass = reorderState === 'active'
    ? 'border-accent'
    : reorderState === 'candidate'
      ? 'border-accent/70'
      : 'border-line'

  return (
    <div className={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border ${borderClass} bg-bg`}>
      <TerminalSurface session={session} pane={pane} onFocus={onFocus} />
      <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
        {platform?.isWindows === true &&
          wslAvailable &&
          session.kind === 'wsl' &&
          Boolean(session.distro) && (
            <>
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
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Open terminal directory in File Explorer"
                title={currentDirectory ? 'Open current directory in File Explorer' : 'Waiting for terminal directory'}
                disabled={!currentDirectory}
                onClick={() => void window.api.paths.revealTerminal(pane.terminalId)}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={isFullscreen ? 'Exit terminal fullscreen' : 'Enter terminal fullscreen'}
          aria-pressed={isFullscreen}
          data-testid={`terminal-fullscreen-toggle-${pane.terminalId}`}
          title={isFullscreen
            ? 'Exit terminal fullscreen (Ctrl+Shift+F)'
            : 'Enter terminal fullscreen (Ctrl+Shift+F)'}
          onClick={onToggleFullscreen}
        >
          {isFullscreen
            ? <Minimize2 className="h-3.5 w-3.5" />
            : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
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
  const columns = layout === 'single'
    ? 'grid-cols-1'
    : layout === 'threeColumns' || layout === 'sixGrid'
      ? 'grid-cols-3'
      : 'grid-cols-2'
  const rows = layout === 'single' || layout === 'columns' || layout === 'threeColumns'
    ? 'grid-rows-1'
    : 'grid-rows-2'
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
  layout: TerminalLayout
  axis: TerminalResizeAxis
  scope: TerminalResizeScope
  columnIndex?: TerminalColumnIndex
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

function splitLinePosition(ratio: number, gapCount = 1, dividerIndex = 0): string {
  return `calc(${ratio * 100}% + ${dividerIndex + 0.5 - ratio * gapCount}px)`
}

function terminalResizeHandleStyle(
  layout: TerminalLayout,
  axis: TerminalResizeAxis,
  scope: TerminalResizeScope,
  sizes: SessionTerminalLayout['sizes'],
  columnIndex: TerminalColumnIndex | undefined
): CSSProperties {
  if (axis === 'column') {
    const dividerIndex = columnIndex ?? 0
    const [firstColumnRatio, secondColumnRatio] = terminalColumnRatios(sizes)
    const ratio = dividerIndex === 0 ? firstColumnRatio : secondColumnRatio
    const gapCount = layout === 'threeColumns' || layout === 'sixGrid' ? 2 : 1
    return {
      left: splitLinePosition(ratio, gapCount, dividerIndex),
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
  layout,
  axis,
  scope,
  columnIndex,
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
    drag.pendingRatio = axis === 'column' &&
      (layout === 'threeColumns' || layout === 'sixGrid') &&
      columnIndex !== undefined
      ? terminalColumnSplitRatio(pointerPosition, trackSize, columnIndex, sizes)
      : terminalSplitRatio(pointerPosition, trackSize)

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
      data-testid={`terminal-resize-${axis}-${scope}${columnIndex === undefined || columnIndex === 0 ? '' : '-1'}`}
      className={`group absolute z-20 flex touch-none items-center justify-center ${handleClass}`}
      style={terminalResizeHandleStyle(layout, axis, scope, sizes, columnIndex)}
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

type SettingsSection = 'appearance' | 'terminal' | 'sidebar' | 'opencode' | 'about'

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'sidebar', label: 'Sidebar' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'about', label: 'About' }
]

function SettingsToggle({
  checked,
  label,
  description,
  testId,
  onClick
}: {
  checked: boolean
  label: string
  description: string
  testId: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={onClick}
      className="flex w-full items-center justify-between rounded border border-line bg-panel px-3 py-2 text-left text-xs text-fg-muted hover:bg-hover"
    >
      <span>
        <span className="block font-medium text-fg">{label}</span>
        <span className="mt-0.5 block text-fg-subtle">{description}</span>
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-line-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  )
}

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
            failures.push(ipcErrorMessage(result.reason, 'Could not inspect this WSL distro.'))
          }
        })
        setTuiSettings(nextSettings)
        setPluginStates(nextStates)
        if (failures.length > 0) setTuiError(failures[0] ?? 'Could not inspect one or more WSL distros.')
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTuiError(ipcErrorMessage(error, 'Could not update the OpenCode status plugin.'))
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
            failures.push(ipcErrorMessage(result.reason, 'Could not inspect the token-rate plugin.'))
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
        if (!cancelled) setAlertError(ipcErrorMessage(error, 'Could not update OpenCode alerts.'))
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
      setTuiError(ipcErrorMessage(error, 'Could not update the OpenCode status plugin.'))
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
      setTuiError(ipcErrorMessage(error, 'Could not update the OpenCode status plugin.'))
    }
  }

  const setAlertsEnabled = async (): Promise<void> => {
    setAlertError(null)
    setAlertLoading(true)
    try {
      const next = await window.api.opencodeAlerts.setEnabled({ enabled: !alertSettings.enabled })
      setAlertSettings(next)
    } catch (error) {
      setAlertError(ipcErrorMessage(error, 'Could not update OpenCode alerts.'))
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
      setTuiError(ipcErrorMessage(error, 'Could not update the OpenCode status plugin.'))
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
      setTokenRateError(ipcErrorMessage(error, 'Could not update the token-rate plugin.'))
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

            {activeSection === 'terminal' && (
              <section className="space-y-3" aria-labelledby="terminal-settings">
                <div>
                  <h3 id="terminal-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    Terminal
                  </h3>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Configure terminal behavior and keyboard shortcuts.
                  </p>
                </div>
                <SettingsToggle
                  checked={settings.escapeExitsFullscreen}
                  label="Exit fullscreen with Escape"
                  description="Press Escape to leave the temporary fullscreen terminal view."
                  testId="terminal-escape-fullscreen"
                  onClick={() => updateSettings({ escapeExitsFullscreen: !settings.escapeExitsFullscreen })}
                />
              </section>
            )}

            {activeSection === 'sidebar' && (
              <section className="space-y-3" aria-labelledby="sidebar-settings">
                <div>
                  <h3 id="sidebar-settings" className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    Sidebar
                  </h3>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Choose which individual terminal activity appears beneath each session.
                  </p>
                </div>
                <SettingsToggle
                  checked={settings.showTerminalInstances}
                  label="Show terminal instances"
                  description="List ordinary terminal panes beneath their session."
                  testId="sidebar-terminal-instances"
                  onClick={() => updateSettings({ showTerminalInstances: !settings.showTerminalInstances })}
                />
                <SettingsToggle
                  checked={settings.showOpenCodeInstances}
                  label="Show OpenCode instances"
                  description="List active OpenCode instances beneath their session."
                  testId="sidebar-opencode-instances"
                  onClick={() => updateSettings({ showOpenCodeInstances: !settings.showOpenCodeInstances })}
                />
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

function SessionTabStrip({
  session,
  activeTab,
  onSelect,
  onAdd,
  onRenameStart,
  onRename,
  onClose
}: {
  session: Session
  activeTab: SessionTab
  onSelect: (tabId: string) => void
  onAdd: () => void
  onRenameStart: () => void
  onRename: (tabId: string, name: string) => void
  onClose: (tabId: string) => void
}): JSX.Element {
  const tabs = sessionTabs(session)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!renamingTabId) return
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [renamingTabId])

  const beginRename = (tab: SessionTab): void => {
    onRenameStart()
    setRenamingTabId(tab.id)
    setDraftName(tab.name)
  }

  const commitRename = (): void => {
    if (!renamingTabId) return
    const name = draftName.trim()
    if (name) onRename(renamingTabId, name)
    setRenamingTabId(null)
  }

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
      <div
        role="tablist"
        aria-label={`${session.name} terminal tabs`}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const selected = tab.id === activeTab.id
          const renaming = tab.id === renamingTabId
          return (
            <div
              key={tab.id}
              className={`group flex min-w-[7rem] max-w-[13rem] items-center rounded-t border border-b-0 ${
                selected ? 'border-line bg-bg text-fg' : 'border-transparent text-fg-subtle hover:bg-hover hover:text-fg'
              }`}
            >
              {renaming ? (
                <input
                  ref={renameInputRef}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename()
                    if (event.key === 'Escape') setRenamingTabId(null)
                    event.stopPropagation()
                  }}
                  className="h-7 w-full min-w-0 flex-1 rounded-sm border border-accent bg-bg px-2 text-xs text-fg outline-none"
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onSelect(tab.id)}
                  onMouseDown={(event) => {
                    if (event.detail > 1) event.preventDefault()
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (!selected) onSelect(tab.id)
                    beginRename(tab)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'F2') {
                      event.preventDefault()
                      beginRename(tab)
                    }
                  }}
                  className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs"
                  title={`${tab.name} · Double-click or press F2 to rename`}
                >
                  {tab.name}
                </button>
              )}
              <button
                type="button"
                aria-label={`Close ${tab.name}`}
                title={tabs.length <= 1 ? 'A session must keep one tab' : `Close ${tab.name}`}
                disabled={tabs.length <= 1}
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(tab.id)
                }}
                className="mr-1 rounded p-1 text-fg-subtle hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>
      <Button variant="ghost" size="icon-sm" onClick={onAdd} title="New terminal tab" aria-label="New terminal tab">
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export function TerminalView({
  session: selectedSession,
  activeTab,
  terminalLayout,
  onSelectTab,
  onAddTab,
  onTabRenameStart,
  onRenameTab,
  onCloseTab,
  onLayoutChange,
  onLayoutResize,
  onPaneOrderChange,
  onReduceLayout,
  onClosePane,
  onRestartPrimary
}: TerminalViewProps): JSX.Element {
  const clearExit = useWorkspace((state) => state.clearExit)
  const setStatus = useWorkspace((state) => state.setStatus)
  const primaryPane = terminalLayout.panes.find((pane) => pane.primary)
  const exit = useWorkspace((state) => primaryPane ? state.exits[primaryPane.terminalId] : undefined)
  const [pendingReduction, setPendingReduction] = useState<{
    layout: TerminalLayout
    paneIds: string[]
    closingPane: boolean
  } | null>(null)
  const [reorderModifierHeld, setReorderModifierHeld] = useState(false)
  const [hoveredPaneId, setHoveredPaneId] = useState<string | null>(null)
  const [reorderSourceId, setReorderSourceId] = useState<string | null>(null)
  const [reorderPreviewPanes, setReorderPreviewPanes] = useState<TerminalPaneState[] | null>(null)
  const [fullscreenTerminalId, setFullscreenTerminalId] = useState<string | null>(null)
  const [terminalSettings, setTerminalSettings] = useState<TerminalSettings>(() => getTerminalSettings())
  const gridRef = useRef<HTMLDivElement>(null)
  const reorderDragRef = useRef<TerminalReorderDragState | null>(null)
  const focusedTerminalIdRef = useRef<string | null>(null)

  useEffect(() => {
    return subscribeTerminalSettings(() => setTerminalSettings(getTerminalSettings()))
  }, [])

  useEffect(() => {
    focusedTerminalIdRef.current = null
    setFullscreenTerminalId(null)
  }, [activeTab.id, selectedSession.id])

  const restart = useCallback(async () => {
    onRestartPrimary()
    const primary = terminalLayout.panes.find((pane) => pane.primary)
    if (!primary) return
    const session = getSession(primary.terminalId)
    if (!session) return
    session?.term.reset()
    const size = (session && fitSession(session)) || FALLBACK_SIZE
    clearExit(primary.terminalId)
    const status = await window.api.pty.restart({
      terminalId: primary.terminalId,
      sessionId: selectedSession.id,
      size,
      palette: getTerminalPalette(session?.themeId ?? getTerminalSettings().theme)
    })
    setStatus(primary.terminalId, status)
    session?.term.focus()
  }, [clearExit, onRestartPrimary, selectedSession.id, setStatus, terminalLayout.panes])

  const requestLayout = useCallback((layout: TerminalLayout): void => {
    const targetCount = terminalCount(layout)
    if (targetCount >= terminalLayout.panes.length) {
      setFullscreenTerminalId(null)
      onLayoutChange(layout)
      return
    }
    setPendingReduction({
      layout,
      paneIds: panesToTrim(terminalLayout.panes, targetCount),
      closingPane: false
    })
  }, [onLayoutChange, terminalLayout.panes.length])

  const requestClosePane = (terminalId: string): void => {
    if (terminalLayout.layout === 'sixGrid') {
      const targetLayout: TerminalLayout = 'quadrant'
      setPendingReduction({
        layout: targetLayout,
        paneIds: panesToTrim(terminalLayout.panes, terminalCount(targetLayout), terminalId),
        closingPane: true
      })
      return
    }
    setFullscreenTerminalId(null)
    onClosePane(terminalId)
  }

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      const inDialog = target instanceof Element && target.closest('[role="dialog"]') !== null
      if (!shouldExitTerminalFullscreen({
        key: event.key,
        escapeExitsFullscreen: terminalSettings.escapeExitsFullscreen,
        fullscreenTerminalId,
        inDialog
      })) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setFullscreenTerminalId(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [fullscreenTerminalId, terminalSettings.escapeExitsFullscreen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[role="dialog"]')) return

      if (!isTerminalFullscreenShortcut({
        type: event.type,
        key: event.key,
        code: event.code,
        control: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        shift: event.shiftKey
      })) {
        return
      }

      const focusedPane = terminalFullscreenPane(
        terminalLayout.panes,
        focusedTerminalIdRef.current
      )
      if (!focusedPane) return

      event.preventDefault()
      event.stopPropagation()
      setFullscreenTerminalId((current) =>
        current === focusedPane.terminalId ? null : focusedPane.terminalId
      )
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [terminalLayout.panes])

  useEffect(() => {
    if (
      fullscreenTerminalId &&
      !terminalLayout.panes.some((pane) => pane.terminalId === fullscreenTerminalId)
    ) {
      setFullscreenTerminalId(null)
    }
  }, [fullscreenTerminalId, terminalLayout.panes])

  const toggleFullscreen = (terminalId: string): void => {
    setFullscreenTerminalId((current) => current === terminalId ? null : terminalId)
  }

  const confirmReduceLayout = (): void => {
    if (!pendingReduction) return
    setFullscreenTerminalId(null)
    onReduceLayout(pendingReduction.layout, pendingReduction.paneIds)
    setPendingReduction(null)
  }

  const location =
    selectedSession.kind === 'wsl'
      ? `${selectedSession.distro ?? 'WSL'} · ${selectedSession.path}`
      : selectedSession.path
  const renderedPanes = reorderPreviewPanes ?? terminalLayout.panes
  const fullscreenPane = terminalFullscreenPane(renderedPanes, fullscreenTerminalId)
  const isFullscreen = fullscreenPane !== null
  const visiblePanes = fullscreenPane ? [fullscreenPane] : renderedPanes
  const gridTemplates = isFullscreen
    ? { columns: 'minmax(0, 1fr)', rows: 'minmax(0, 1fr)' }
    : terminalGridTemplates(terminalLayout.layout, terminalLayout.sizes)
  const resizeHandles = isFullscreen ? [] : terminalResizeHandles(terminalLayout.layout)

  return (
    <div className="flex h-full min-w-0 flex-col bg-bg">
      <SessionTabStrip
        session={selectedSession}
        activeTab={activeTab}
        onSelect={onSelectTab}
        onAdd={onAddTab}
        onRenameStart={onTabRenameStart}
        onRename={onRenameTab}
        onClose={onCloseTab}
      />
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
              title={`${candidate.label} (Ctrl+${candidate.shortcut})`}
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
          {visiblePanes.map((pane, index) => (
            <div
              key={pane.terminalId}
              data-terminal-pane-slot={index}
              className={`h-full min-h-0 min-w-0 ${isFullscreen ? '' : paneClass(terminalLayout.layout, index)}`}
              onPointerDownCapture={(event) => beginReorder(event, pane.terminalId)}
            >
              <TerminalPane
                session={selectedSession}
                pane={pane}
                onFocus={() => {
                  focusedTerminalIdRef.current = pane.terminalId
                }}
                isFullscreen={isFullscreen}
                onToggleFullscreen={() => toggleFullscreen(pane.terminalId)}
                reorderState={
                  reorderSourceId === pane.terminalId
                    ? 'active'
                    : reorderModifierHeld && hoveredPaneId === pane.terminalId
                      ? 'candidate'
                      : 'none'
                }
                onClose={() => requestClosePane(pane.terminalId)}
              />
            </div>
          ))}
          {resizeHandles.map(({ axis, scope, columnIndex }) => (
            <TerminalResizeHandle
              key={`${axis}-${scope}-${columnIndex ?? 0}`}
              layout={terminalLayout.layout}
              axis={axis}
              scope={scope}
              columnIndex={columnIndex}
              ratio={axis === 'column'
                ? terminalColumnRatios(terminalLayout.sizes)[columnIndex ?? 0]
                : terminalLayout.sizes.rowRatio}
              sizes={terminalLayout.sizes}
              containerRef={gridRef}
              onResize={(ratio) => onLayoutResize(axis, ratio, columnIndex)}
            />
          ))}
      </div>

      <AlertDialog
        open={pendingReduction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingReduction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Close extra terminals?</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingReduction?.closingPane
              ? 'Closing a terminal from the six-terminal layout will switch to four terminals and close one additional split terminal.'
              : `Changing to ${pendingReduction ? TERMINAL_LAYOUTS.find((candidate) => candidate.value === pendingReduction.layout)?.label.toLowerCase() : 'a smaller layout'} will close the extra split terminals.`}
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
