import { supportsAgentIntegration } from '@shared/agent-support'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties
} from 'react'
import { FolderOpen, Plus, X } from 'lucide-react'
import type { FileTreeDropEntry } from '@shared/ipc'
import type {
  OpenCodeTuiInstanceStatus,
  OpenCodeResumeLaunch,
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
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useWorkspace } from '@/store/workspace'
import {
  attachSession,
  detachSession,
  fitSession,
  getSession
} from '@/terminal/sessions'
import {
  subscribeOsc52,
  type Osc52Notice,
  type Osc52Prompt
} from '@/terminal/osc52-notices'
import { terminalSizeAction } from '@/terminal/terminal-compat'
import { viewportSettle } from '@/terminal/viewport-settle'
import {
  getTerminalSettings,
  subscribeTerminalSettings,
  type TerminalSettings
} from '@/terminal/terminal-settings'
import { getTerminalPalette } from '@/theme/themes'
import {
  isTerminalPaneClosable,
  MAX_TERMINAL_COUNT,
  swapTerminalPanes,
  terminalLayoutGeometry,
  terminalSplitRatio,
  type SessionTerminalLayout,
  type TerminalSplitSide,
  type TerminalPaneState,
  type RuntimeTerminalLaunch,
  type TerminalResizeAxis,
} from '@/terminal/layout'
import {
  isTerminalFullscreenShortcut,
  shouldExitTerminalFullscreen,
  terminalFullscreenPane
} from '@/terminal/fullscreen'
import {
  getTerminalPaneSwitchIndex,
  PANE_OVERLAY_DELAY_MS,
  terminalPaneSwitchTarget
} from '@/terminal/pane-switch'
import {
  fileDropUris,
  readFileTreeDrop,
  isFileDrop,
  terminalDropMode,
  terminalDropNotice,
  terminalDropQuotingNotice
} from '@/terminal/drop'
import { terminalPrimarySelectionMode } from '@/terminal/clipboard'
import { sessionTabs } from '@/terminal/tabs'
import { TerminalPaneHeader } from '@/components/TerminalPaneHeader'
import { TerminalPaneHighlight } from '@/components/TerminalPaneHighlight'
import { TerminalPaneOverlay } from '@/components/TerminalPaneOverlay'
import { TerminalLauncher } from '@/components/TerminalLauncher'
import { OpenCodeSessionsDialog } from '@/components/OpenCodeSessionsDialog'
import { isOpenCodeSessionsShortcut } from '@/lib/opencode-sessions'
import { isTerminalLauncherShortcut } from '@/lib/terminal-launcher'

const FALLBACK_SIZE: PtySize = { cols: 80, rows: 24 }
const noop = (): void => {}
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
  /**
   * Drawn inside another view, as the Inbox does in its sidebar: one tab with no strip, and keyboard
   * shortcuts that act only while the keyboard is in this view. The tab callbacks are not needed then.
   */
  embedded?: boolean
  onSelectTab?: (tabId: string) => void
  onAddTab?: () => void
  onTabRenameStart?: () => void
  onRenameTab?: (tabId: string, name: string) => void
  onCloseTab?: (tabId: string) => void
  onSplitPane: (terminalId: string, side: TerminalSplitSide) => void
  onLayoutResize: (splitId: string, ratio: number) => void
  onPaneOrderChange: (terminalIds: readonly string[]) => void
  onAddPane: (sourceTerminalId: string, launch: RuntimeTerminalLaunch) => void
  onClosePane: (terminalId: string) => void
  onPaneFocus: (terminalId: string) => void
  onPaneTitleChange: (terminalId: string, title: string | null) => void
}

interface TerminalSurfaceProps {
  session: Session
  pane: TerminalPaneState
  onFocus: () => void
  isFullscreen: boolean
}

function osc52NoticeMessage(notice: Osc52Notice): string {
  if (notice.kind === 'too-large') {
    return 'Ignored a clipboard write from this terminal: the payload was too large.'
  }

  const characters = `${notice.preview.length} ${notice.preview.length === 1 ? 'character' : 'characters'}`
  if (notice.kind === 'written') return `A program set the clipboard (${characters}).`

  if (notice.reason === 'deny-policy') {
    return 'Blocked a clipboard write from this terminal. Change this in Settings, under Terminal.'
  }
  if (notice.reason === 'deny-stale') {
    return 'Blocked a clipboard write from this terminal: it did not follow anything you typed.'
  }
  return 'Blocked a clipboard write from a terminal that was not in the foreground.'
}

export function TerminalSurface({
  session: sourceSession,
  pane,
  onFocus,
  isFullscreen
}: TerminalSurfaceProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const scheduleSizeSyncRef = useRef<((forceResize?: boolean) => void) | null>(null)
  const previousFullscreenRef = useRef<boolean | null>(null)
  const dragDepthRef = useRef(0)
  const dropQueueRef = useRef(Promise.resolve())
  const dropNoticeTimerRef = useRef<number | undefined>(undefined)
  const clipboardNoticeTimerRef = useRef<number | undefined>(undefined)
  const [fileDragOver, setFileDragOver] = useState(false)
  const [dropNotice, setDropNotice] = useState<string | null>(null)
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null)
  const [osc52Prompt, setOsc52Prompt] = useState<Osc52Prompt | null>(null)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [launchAttempt, setLaunchAttempt] = useState(0)
  const setStatus = useWorkspace((state) => state.setStatus)
  const platform = useWorkspace((state) => state.platform)
  const primarySelectionMode = terminalPrimarySelectionMode(
    platform?.platform ?? 'other',
    sourceSession.kind
  )

  const announceDrop = (message: string): void => {
    setDropNotice(message)
    window.clearTimeout(dropNoticeTimerRef.current)
    dropNoticeTimerRef.current = window.setTimeout(() => {
      setDropNotice(null)
      dropNoticeTimerRef.current = undefined
    }, 3500)
  }

  // Clipboard activity driven by terminal output is always announced in the
  // pane that caused it, so a write can never happen entirely unseen.
  useEffect(() => {
    const announceClipboard = (message: string): void => {
      setClipboardNotice(message)
      window.clearTimeout(clipboardNoticeTimerRef.current)
      clipboardNoticeTimerRef.current = window.setTimeout(() => {
        setClipboardNotice(null)
        clipboardNoticeTimerRef.current = undefined
      }, 5000)
    }

    const unsubscribe = subscribeOsc52(pane.terminalId, (event) => {
      if (event.kind === 'prompt') {
        setOsc52Prompt(event.prompt)
        return
      }
      if (event.kind === 'prompt-cleared') {
        setOsc52Prompt(null)
        return
      }
      announceClipboard(osc52NoticeMessage(event.notice))
    })

    return () => {
      unsubscribe()
      window.clearTimeout(clipboardNoticeTimerRef.current)
      setOsc52Prompt(null)
      setClipboardNotice(null)
    }
  }, [pane.terminalId])

  const enqueueFileDrop = (
    files: File[],
    uriList: string[],
    mode: 'shell' | 'tui',
    treeEntry?: FileTreeDropEntry,
  ): void => {
    const task = async (): Promise<void> => {
      try {
        const result = await window.api.pty.dropFiles({
          terminalId: pane.terminalId,
          files,
          uriList,
          treeEntry,
          mode
        })
        const terminal = getSession(pane.terminalId)
        if (result.insertions.length > 0 && terminal) {
          terminal.term.focus()
          for (const insertion of result.insertions) terminal.term.paste(insertion)
        }

        if (result.rejections.length > 0) announceDrop(terminalDropNotice(result.rejections))
        else if (result.quotedForSafety) announceDrop(terminalDropQuotingNotice(result.quotedForSafety))
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
    const treeEntry = readFileTreeDrop(event.dataTransfer)
    if (files.length > 0 || treeEntry) {
      onFocus()
      const terminal = getSession(pane.terminalId)
      const mode = terminalDropMode(terminal?.term.buffer.active.type ?? 'normal')
      const uriList = fileDropUris(event.dataTransfer.getData('text/uri-list'))
      enqueueFileDrop(files, uriList, mode, treeEntry ?? undefined)
    }
  }

  useEffect(() => {
    const resetDrag = (): void => {
      dragDepthRef.current = 0
      setFileDragOver(false)
    }
    window.addEventListener('dragend', resetDrag)
    window.addEventListener('drop', resetDrag)
    window.addEventListener('blur', resetDrag)
    return () => {
      window.clearTimeout(dropNoticeTimerRef.current)
      window.removeEventListener('dragend', resetDrag)
      window.removeEventListener('drop', resetDrag)
      window.removeEventListener('blur', resetDrag)
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    setLaunchError(null)

    // Re-parents the existing terminal, or builds it on first view of this session.
    const terminal = attachSession(pane.terminalId, host, { primarySelectionMode })
    let cancelled = false
    let ensured = false
    let previousSize: PtySize | null = null
    let ensurePromise: Promise<void> | null = null
    let retry: number | undefined
    let debounce: number | undefined
    let forceResize = false
    let launchFailed = false

    const syncSize = (): void => {
      if (cancelled || launchFailed) return
      // Measured before the window has settled, the host can be a sliver, and fitting it would
      // shrink the live PTY and its TUI to a few columns and straight back.
      if (!viewportSettle.isSettled()) return

      const action = terminalSizeAction(fitSession(terminal), ensured, previousSize, forceResize)
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
          palette: getTerminalPalette(terminal.themeId),
          launch: pane.launch
        }).then((status) => {
          if (cancelled) return
          setLaunchError(null)
          setStatus(pane.terminalId, status)
          if (!textInputHasFocus()) terminal.term.focus()
        }).catch((error: unknown) => {
          console.error('[terminal] PTY ensure failed:', error)
          if (!cancelled) {
            setLaunchError(ipcErrorMessage(error, 'Could not start this terminal.'))
          }
          ensured = false
          previousSize = null
          launchFailed = true
          window.clearTimeout(retry)
          retry = undefined
        }).finally(() => {
          ensurePromise = null
          if (!cancelled && !launchFailed) syncSize()
        })
        return
      }

      if (ensurePromise) {
        return
      }

      previousSize = action.size
      forceResize = false
      void window.api.pty.resize({ terminalId: pane.terminalId, size: action.size })
    }

    const scheduleSizeSync = (requestForceResize = false): void => {
      forceResize ||= requestForceResize
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => {
        debounce = undefined
        syncSize()
      }, RESIZE_DEBOUNCE_MS)
    }

    const observer = new ResizeObserver(() => {
      // Resizing on every observer callback would flood the PTY with SIGWINCH
      // and leave TUIs redrawing against a stale geometry.
      scheduleSizeSync()
    })
    const onWindowResize = (): void => scheduleSizeSync()

    scheduleSizeSyncRef.current = scheduleSizeSync
    observer.observe(host)
    window.addEventListener('resize', onWindowResize)
    const stopWaitingForViewport = viewportSettle.onSettled(() => scheduleSizeSync())
    const frame = requestAnimationFrame(syncSize)

    return () => {
      cancelled = true
      if (scheduleSizeSyncRef.current === scheduleSizeSync) scheduleSizeSyncRef.current = null
      cancelAnimationFrame(frame)
      window.clearTimeout(debounce)
      window.clearTimeout(retry)
      observer.disconnect()
      window.removeEventListener('resize', onWindowResize)
      stopWaitingForViewport()
      // Detach only: the process, its scrollback and its cursor all stay alive.
      detachSession(pane.terminalId)
    }
  }, [launchAttempt, pane.terminalId, primarySelectionMode, setStatus, sourceSession.id])

  useEffect(() => {
    const previousFullscreen = previousFullscreenRef.current
    previousFullscreenRef.current = isFullscreen
    if (previousFullscreen === null || previousFullscreen === isFullscreen) return

    const frame = window.requestAnimationFrame(() => {
      scheduleSizeSyncRef.current?.(true)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isFullscreen])

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
      {launchError && (
        <div
          className="pointer-events-auto absolute inset-x-3 top-3 z-20 rounded-md border border-danger/40 bg-panel/95 p-3 text-xs text-danger shadow-lg"
          data-testid="terminal-launch-error"
          role="alert"
        >
          <p>{launchError}</p>
          <p className="mt-1 text-fg-subtle">
            Check that the selected directory is available, then try again.
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => {
              setLaunchError(null)
              setLaunchAttempt((attempt) => attempt + 1)
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {fileDragOver && (
        <div
          className="terminal-file-drop-preview pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-accent bg-bg/80 text-sm font-medium text-fg"
          data-testid="terminal-file-drop-overlay"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <FolderOpen className="h-6 w-6" />
          </span>
          <span>Drop file or folder to insert its path</span>
          <span className="text-xs font-normal text-fg-muted">Paste into this terminal</span>
        </div>
      )}
      {(dropNotice || clipboardNotice || osc52Prompt) && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-col gap-2">
          {dropNotice && (
            <div
              className="rounded-md border border-border bg-panel/95 px-3 py-2 text-xs text-muted-fg shadow-lg"
              role="status"
              aria-live="polite"
            >
              {dropNotice}
            </div>
          )}
          {clipboardNotice && (
            <div
              className="rounded-md border border-border bg-panel/95 px-3 py-2 text-xs text-muted-fg shadow-lg"
              role="status"
              aria-live="polite"
              data-testid="terminal-osc52-notice"
            >
              {clipboardNotice}
            </div>
          )}
          {osc52Prompt && (
            <div
              className="pointer-events-auto rounded-md border border-line-strong bg-panel px-3 py-2 text-xs text-fg-muted shadow-lg"
              role="alertdialog"
              aria-label="Clipboard write requested by a terminal program"
              data-testid="terminal-osc52-prompt"
            >
              <p className="font-medium text-fg">A program wants to set the clipboard</p>
              <p className="mt-1 break-all font-mono text-fg-subtle">
                {osc52Prompt.preview.preview}
                {osc52Prompt.preview.truncated ? '…' : ''}
              </p>
              <p className="mt-1 text-fg-subtle">
                {osc52Prompt.preview.length}
                {osc52Prompt.preview.length === 1 ? ' character' : ' characters'}
              </p>
              {osc52Prompt.preview.endsWithNewline && (
                <p className="mt-1 font-medium text-danger">
                  Ends with a newline: pasting this into a shell runs it immediately.
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => osc52Prompt.approve('once')}>
                  Allow once
                </Button>
                <Button size="sm" variant="secondary" onClick={() => osc52Prompt.approve('terminal')}>
                  Allow in this terminal
                </Button>
                <Button size="sm" variant="ghost" onClick={() => osc52Prompt.deny()}>
                  Block
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RestartConfirmDialog({
  open,
  onOpenChange,
  onConfirm
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}): JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="restart-terminal-confirmation">
        <AlertDialogTitle>Restart terminal?</AlertDialogTitle>
        <AlertDialogDescription>
          Restarting this terminal will interrupt any running command or OpenCode task. This cannot be undone.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Restart terminal</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function TerminalPane({
  session,
  pane,
  terminalLayout,
  openCodeInstance,
  onClose,
  onFocus,
  isFullscreen,
  onToggleFullscreen,
  onTitleChange,
  onOpenCodeSessions,
  reorderState = 'none',
  paneOverlayVisible = false,
  paneOverlayNumber = null,
  paneOverlayActive = false,
  splitControlsVisible = false,
  onSplit,
}: {
  session: Session
  pane: TerminalPaneState
  terminalLayout: SessionTerminalLayout
  openCodeInstance?: OpenCodeTuiInstanceStatus
  onClose: () => void
  onFocus: () => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
  onTitleChange: (title: string | null) => void
  onOpenCodeSessions: () => void
  reorderState?: 'none' | 'candidate' | 'active' | 'target'
  paneOverlayVisible?: boolean
  paneOverlayNumber?: number | null
  paneOverlayActive?: boolean
  splitControlsVisible?: boolean
  onSplit: (side: TerminalSplitSide) => void
}): JSX.Element {
  const clearExit = useWorkspace((state) => state.clearExit)
  const setStatus = useWorkspace((state) => state.setStatus)
  const exit = useWorkspace((state) => state.exits[pane.terminalId])
  const [restartConfirmationOpen, setRestartConfirmationOpen] = useState(false)

  const restart = async (): Promise<void> => {
    const terminal = getSession(pane.terminalId)
    terminal?.term.reset()
    const size = (terminal && fitSession(terminal)) || FALLBACK_SIZE
    clearExit(pane.terminalId)
    try {
      const status = await window.api.pty.restart({
        terminalId: pane.terminalId,
        sessionId: session.id,
        size,
        palette: getTerminalPalette(terminal?.themeId ?? getTerminalSettings().theme)
      })
      setStatus(pane.terminalId, status)
    } catch (error) {
      console.error('[terminal] PTY restart failed:', error)
      setStatus(pane.terminalId, 'none')
    }
  }

  const requestRestart = (): void => {
    setRestartConfirmationOpen(true)
  }

  const confirmRestart = (): void => {
    setRestartConfirmationOpen(false)
    void restart()
  }

  const borderClass = reorderState === 'active'
    ? 'border-accent'
    : reorderState === 'candidate' || reorderState === 'target'
      ? 'border-accent/70'
      : paneOverlayVisible && paneOverlayActive
        ? 'border-accent'
        : 'border-line'

  return (
    <div
      onPointerDown={onFocus}
      onFocusCapture={onFocus}
      className={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden border ${borderClass} bg-bg ${
        reorderState === 'active' ? 'opacity-45' : ''
      }`}
    >
      <TerminalPaneHeader
        session={session}
        pane={pane}
        terminalLayout={terminalLayout}
        openCodeInstance={openCodeInstance}
        focused={paneOverlayActive}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        onTitleChange={onTitleChange}
        onOpenCodeSessions={onOpenCodeSessions}
        onRestart={requestRestart}
        onClose={onClose}
        onSplit={onSplit}
      />
      {exit && (
        <div
          className="flex shrink-0 items-center gap-3 border-b border-danger/30 bg-danger/10 px-3 py-1.5"
          data-testid="terminal-pane-exit"
        >
          <span className="text-xs text-danger">
            Process exited (code {exit.exitCode}
            {exit.signal ? `, signal ${exit.signal}` : ''})
          </span>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={requestRestart}>
            Restart
          </Button>
        </div>
      )}
      <TerminalSurface
        session={session}
        pane={pane}
        onFocus={onFocus}
        isFullscreen={isFullscreen}
      />
      <TerminalPaneOverlay
        visible={paneOverlayVisible}
        number={paneOverlayNumber}
        active={paneOverlayActive}
        isFullscreen={isFullscreen}
      />
      {splitControlsVisible && (
        <div aria-label="Add terminal" role="group" data-testid="terminal-split-controls">
          {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
            <button
              key={side}
              type="button"
              aria-label={`Add terminal ${side === 'top' ? 'above' : side === 'bottom' ? 'below' : `to the ${side}`}`}
              title={`Add terminal ${side === 'top' ? 'above' : side === 'bottom' ? 'below' : `to the ${side}`}`}
              data-testid={`terminal-split-${side}`}
              className={`absolute z-30 flex h-7 w-7 items-center justify-center rounded border border-accent/60 bg-panel text-accent shadow-md hover:bg-accent hover:text-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                side === 'left' ? 'left-1 top-1/2 -translate-y-1/2'
                  : side === 'right' ? 'right-1 top-1/2 -translate-y-1/2'
                    : side === 'top' ? 'left-1/2 top-8 -translate-x-1/2'
                      : 'bottom-1 left-1/2 -translate-x-1/2'
              }`}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                event.stopPropagation()
                onSplit(side)
              }}
              onClick={(event) => {
                // Keyboard activation; pointer activation happens before a macOS Ctrl-click context menu.
                if (event.detail === 0) onSplit(side)
              }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <Plus className="h-4 w-4" />
            </button>
          ))}
        </div>
      )}
      <TerminalPaneHighlight terminalId={pane.terminalId} />
      {reorderState === 'target' && (
        <div
          aria-hidden="true"
          className="terminal-pane-drop-preview pointer-events-none absolute inset-1 z-40"
          data-testid="terminal-pane-drop-preview"
        />
      )}
      <RestartConfirmDialog
        open={restartConfirmationOpen}
        onOpenChange={setRestartConfirmationOpen}
        onConfirm={confirmRestart}
      />
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
  targetTerminalId: string | null
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

interface TerminalResizeHandleProps {
  splitId: string
  axis: TerminalResizeAxis
  ratio: number
  style: CSSProperties
  onResize: (ratio: number) => void
}

interface TerminalDragState {
  pointerId: number
  pendingRatio: number
  frame?: number
  previousCursor: string
  previousUserSelect: string
}

function TerminalResizeHandle({
  splitId,
  axis,
  ratio,
  style,
  onResize
}: TerminalResizeHandleProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
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
    if (!container || event.button !== 0) return

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

  const position = `calc(${ratio * 100}% + ${0.5 - ratio}px)`
  return (
    <div ref={containerRef} className="pointer-events-none absolute" style={style}>
      <div
        role="separator"
        aria-label={axis === 'column' ? 'Resize terminal columns' : 'Resize terminal rows'}
        aria-orientation={axis === 'column' ? 'vertical' : 'horizontal'}
        data-testid={`terminal-resize-${splitId}`}
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        onKeyDown={(event) => {
          const decrease = axis === 'column' ? 'ArrowLeft' : 'ArrowUp'
          const increase = axis === 'column' ? 'ArrowRight' : 'ArrowDown'
          if (event.key !== decrease && event.key !== increase) return
          event.preventDefault()
          event.stopPropagation()
          const bounds = containerRef.current?.getBoundingClientRect()
          const size = bounds ? axis === 'column' ? bounds.width : bounds.height : 0
          const target = ratio + (event.key === decrease ? -0.02 : 0.02)
          onResize(size > 0 ? terminalSplitRatio(target * (size - 1) + 0.5, size) : Math.max(0.05, Math.min(0.95, target)))
        }}
        className={`group pointer-events-auto absolute z-20 flex touch-none items-center justify-center ${handleClass}`}
        style={axis === 'column' ? { left: position, top: 0 } : { top: position, left: 0 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
      >
        <span className={`bg-transparent transition-colors group-hover:bg-accent group-focus-visible:bg-accent ${lineClass}`} />
      </div>
    </div>
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
  embedded = false,
  onSelectTab = noop,
  onAddTab = noop,
  onTabRenameStart = noop,
  onRenameTab = noop,
  onCloseTab = noop,
  onSplitPane,
  onLayoutResize,
  onPaneOrderChange,
  onAddPane,
  onClosePane,
  onPaneFocus,
  onPaneTitleChange
}: TerminalViewProps): JSX.Element {
  const platform = useWorkspace((state) => state.platform)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  const opencodeTuiInstances = useWorkspace(
    (state) => state.opencodeTuiInstances[selectedSession.id]
  )
  const terminalDirectories = useWorkspace((state) => state.terminalDirectories)
  const [splitModifierHeld, setSplitModifierHeld] = useState(false)
  const [reorderModifierHeld, setReorderModifierHeld] = useState(false)
  const [hoveredPaneId, setHoveredPaneId] = useState<string | null>(null)
  const [reorderSourceId, setReorderSourceId] = useState<string | null>(null)
  const [reorderTargetId, setReorderTargetId] = useState<string | null>(null)
  const [fullscreenTerminalId, setFullscreenTerminalId] = useState<string | null>(null)
  const [terminalLauncherOpen, setTerminalLauncherOpen] = useState(false)
  const [terminalLauncherSourceId, setTerminalLauncherSourceId] = useState<string | null>(null)
  const [openCodeSessionsOpen, setOpenCodeSessionsOpen] = useState(false)
  const [openCodeSessionsSourceId, setOpenCodeSessionsSourceId] = useState<string | null>(null)
  const openCodeSessionsSourceStatus = useWorkspace((state) => state.statuses[openCodeSessionsSourceId ?? ''])
  const [terminalSettings, setTerminalSettings] = useState<TerminalSettings>(() => getTerminalSettings())
  const rootRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  /** Whether a key press is this view's to act on: any, in the Projects view; only ones typed inside it, when embedded. */
  const handlesKey = useCallback(
    (event: KeyboardEvent): boolean =>
      !embedded || (event.target instanceof Node && rootRef.current?.contains(event.target) === true),
    [embedded]
  )
  const reorderDragRef = useRef<TerminalReorderDragState | null>(null)
  const focusedTerminalIdRef = useRef<string | null>(null)
  const [focusedTerminalId, setFocusedTerminalId] = useState<string | null>(null)
  const [paneOverlayVisible, setPaneOverlayVisible] = useState(false)
  const paneOverlayTimerRef = useRef<number | undefined>(undefined)

  const cancelPaneOverlayTimer = useCallback((): void => {
    window.clearTimeout(paneOverlayTimerRef.current)
    paneOverlayTimerRef.current = undefined
  }, [])

  const hidePaneOverlay = useCallback((): void => {
    cancelPaneOverlayTimer()
    setPaneOverlayVisible(false)
  }, [cancelPaneOverlayTimer])

  useEffect(() => {
    return subscribeTerminalSettings(() => setTerminalSettings(getTerminalSettings()))
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[role="dialog"]')) return
      const openHistory = isOpenCodeSessionsShortcut(event)
      if (!openHistory && !isTerminalLauncherShortcut(event)) return
      if (!supportsAgentIntegration(platform?.platform, selectedSession)) return
      if (openHistory && platform?.isWindows && !wslAvailable) return
      if (!(target instanceof Element) || !target.closest('.terminal-host')) return

      const sourceTerminalId = focusedTerminalIdRef.current
      if (!sourceTerminalId || !terminalLayout.panes.some((pane) => pane.terminalId === sourceTerminalId)) return

      event.preventDefault()
      event.stopPropagation()
      hidePaneOverlay()
      if (openHistory) {
        setOpenCodeSessionsSourceId(sourceTerminalId)
        setOpenCodeSessionsOpen(true)
      } else {
        setTerminalLauncherSourceId(sourceTerminalId)
        setTerminalLauncherOpen(true)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [selectedSession.kind, terminalLayout.panes, platform?.platform, platform?.isWindows, wslAvailable, selectedSession.distro, hidePaneOverlay])

  useEffect(() => {
    focusedTerminalIdRef.current = null
    setFocusedTerminalId(null)
    setSplitModifierHeld(false)
    setFullscreenTerminalId(null)
    setTerminalLauncherOpen(false)
    setTerminalLauncherSourceId(null)
    setOpenCodeSessionsOpen(false)
    setOpenCodeSessionsSourceId(null)
  }, [activeTab.id, selectedSession.id])

  // Replaces the picker's source pane in place: the process restarts there and no pane is added.
  const replaceOpenCodeSessionProcess = async (launch: OpenCodeResumeLaunch): Promise<void> => {
    const terminalId = launch.sourceTerminalId
    const terminal = getSession(terminalId)
    const size = (terminal && fitSession(terminal)) || FALLBACK_SIZE
    try {
      const status = await window.api.pty.restart({
        terminalId,
        sessionId: selectedSession.id,
        size,
        palette: getTerminalPalette(terminal?.themeId ?? getTerminalSettings().theme),
        launch
      })
      if (status === 'none') throw new Error('This terminal is no longer available.')
      // The old process's output all arrives before this reply, so clearing here cannot drop new output.
      getSession(terminalId)?.term.reset()
      useWorkspace.getState().clearExit(terminalId)
      useWorkspace.getState().setStatus(terminalId, status)
    } catch (error) {
      // A failure after the old process was stopped leaves the pane without one; reflect that.
      const statuses = await window.api.pty.statuses().catch(() => null)
      if (statuses) useWorkspace.getState().setStatus(terminalId, statuses[terminalId] ?? 'none')
      throw error
    }
  }

  const requestClosePane = (terminalId: string): void => {
    if (!isTerminalPaneClosable(terminalLayout.panes, terminalId)) return
    setFullscreenTerminalId(null)
    onClosePane(terminalId)
  }

  const cancelReorder = useCallback((): void => {
    const drag = reorderDragRef.current
    if (!drag) {
      setReorderSourceId(null)
      setReorderTargetId(null)
      return
    }

    if (drag.frame !== undefined) cancelAnimationFrame(drag.frame)
    const grid = gridRef.current
    reorderDragRef.current = null
    setReorderSourceId(null)
    setReorderTargetId(null)
    restoreTerminalReorderStyles(drag)

    if (grid?.hasPointerCapture(drag.pointerId)) {
      grid.releasePointerCapture(drag.pointerId)
    }
  }, [])

  // Panes stay in place while dragging; only the dashed target preview follows the pointer.
  const updateReorderTarget = (drag: TerminalReorderDragState, point: TerminalReorderPoint): void => {
    const grid = gridRef.current
    const targetSlot = grid ? terminalPaneSlotAtPoint(grid, point.clientX, point.clientY) : null
    const targetPane = targetSlot === null ? undefined : drag.originalPanes[targetSlot]
    const targetTerminalId = targetPane && targetPane.terminalId !== drag.sourceTerminalId
      ? targetPane.terminalId
      : null

    if (targetTerminalId === drag.targetTerminalId) return
    drag.targetTerminalId = targetTerminalId
    setReorderTargetId(targetTerminalId)
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
      target.closest('button, input, textarea, select, a, [role="separator"], [role="menu"]')
    ) {
      return
    }

    const grid = gridRef.current
    if (!grid) return

    event.preventDefault()
    event.stopPropagation()
    hidePaneOverlay()
    const drag: TerminalReorderDragState = {
      pointerId: event.pointerId,
      sourceTerminalId: terminalId,
      originalPanes: [...terminalLayout.panes],
      targetTerminalId: null,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect
    }
    reorderDragRef.current = drag
    setReorderSourceId(terminalId)
    setReorderTargetId(null)
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
      if (current.pendingPoint) updateReorderTarget(current, current.pendingPoint)
    })
  }

  const finishReorder = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = reorderDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    event.preventDefault()
    if (drag.frame !== undefined) cancelAnimationFrame(drag.frame)
    drag.frame = undefined
    updateReorderTarget(drag, {
      clientX: event.clientX,
      clientY: event.clientY
    })
    const { targetTerminalId } = drag
    const grid = gridRef.current
    reorderDragRef.current = null
    setReorderSourceId(null)
    setReorderTargetId(null)
    restoreTerminalReorderStyles(drag)

    if (grid?.hasPointerCapture(drag.pointerId)) {
      grid.releasePointerCapture(drag.pointerId)
    }
    if (targetTerminalId) {
      onPaneOrderChange(
        swapTerminalPanes(drag.originalPanes, drag.sourceTerminalId, targetTerminalId)
          .map((pane) => pane.terminalId)
      )
    }
  }

  useEffect(() => {
    const update = (event: KeyboardEvent): void => {
      const target = event.target
      const editing = target instanceof Element && target.closest('input, textarea, [contenteditable="true"]') &&
        !target.closest('.terminal-host')
      setSplitModifierHeld(event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey &&
        handlesKey(event) && !editing && !document.querySelector('[role="dialog"], [role="alertdialog"]'))
    }
    const clear = (): void => setSplitModifierHeld(false)
    const onFocus = (event: FocusEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if ((embedded && !rootRef.current?.contains(target)) ||
        (target.closest('input, textarea, [contenteditable="true"], [role="dialog"], [role="alertdialog"]') &&
          !target.closest('.terminal-host'))) clear()
    }
    document.addEventListener('focusin', onFocus)
    window.addEventListener('keydown', update, true)
    window.addEventListener('keyup', update, true)
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', clear)
    return () => {
      window.removeEventListener('keydown', update, true)
      window.removeEventListener('keyup', update, true)
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', clear)
      document.removeEventListener('focusin', onFocus)
    }
  }, [handlesKey, embedded])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && reorderDragRef.current) {
        event.preventDefault()
        event.stopPropagation()
        cancelReorder()
        return
      }
      const held = terminalReorderModifierActive(event)
      setReorderModifierHeld(held)

      const target = event.target
      const inDialog = target instanceof Element && target.closest('[role="dialog"]') !== null
      if (!held || inDialog) {
        hidePaneOverlay()
      } else if (event.key === 'Control' || event.key === 'Shift') {
        if (paneOverlayTimerRef.current === undefined && !reorderDragRef.current) {
          paneOverlayTimerRef.current = window.setTimeout(() => {
            paneOverlayTimerRef.current = undefined
            setPaneOverlayVisible(true)
          }, PANE_OVERLAY_DELAY_MS)
        }
      } else if (getTerminalPaneSwitchIndex({
        type: event.type,
        key: event.key,
        code: event.code,
        control: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        shift: event.shiftKey
      }) !== null) {
        // Keep the overlay up so the user can hop between panes while still holding Ctrl+Shift.
        cancelPaneOverlayTimer()
      } else {
        hidePaneOverlay()
      }
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      const active = terminalReorderModifierActive(event)
      setReorderModifierHeld(active)
      if (!active) hidePaneOverlay()
      if (!active && reorderDragRef.current) cancelReorder()
    }
    const onBlur = (): void => {
      setReorderModifierHeld(false)
      hidePaneOverlay()
      if (reorderDragRef.current) cancelReorder()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      cancelPaneOverlayTimer()
    }
  }, [cancelPaneOverlayTimer, cancelReorder, hidePaneOverlay])

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
      const inDialog = target instanceof Element && target.closest('[role="dialog"]') !== null
      if (!handlesKey(event)) return
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
  }, [fullscreenTerminalId, terminalSettings.escapeExitsFullscreen, handlesKey])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[role="dialog"]')) return
      if (!handlesKey(event)) return

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
  }, [terminalLayout.panes, handlesKey])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[role="dialog"]')) return
      if (!handlesKey(event)) return

      const index = getTerminalPaneSwitchIndex({
        type: event.type,
        key: event.key,
        code: event.code,
        control: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        shift: event.shiftKey
      })
      if (index === null || fullscreenTerminalId) return

      event.preventDefault()
      event.stopPropagation()
      const targetPane = terminalPaneSwitchTarget(terminalLayout.panes, index)
      if (targetPane) getSession(targetPane.terminalId)?.term.focus()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [fullscreenTerminalId, terminalLayout.panes, handlesKey])

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

  const location =
    selectedSession.kind === 'wsl'
      ? `${selectedSession.distro ?? 'WSL'} · ${selectedSession.path}`
      : selectedSession.path
  const renderedPanes = terminalLayout.panes
  const fullscreenPane = terminalFullscreenPane(renderedPanes, fullscreenTerminalId)
  const isFullscreen = fullscreenPane !== null
  const geometry = terminalLayoutGeometry(terminalLayout.tree)

  const renderPane = (pane: TerminalPaneState, index: number): JSX.Element => (
    <div
      key={pane.terminalId}
      data-terminal-pane-slot={index}
      className="absolute min-h-0 min-w-0"
      style={isFullscreen ? { inset: 0 } : geometry.panes[index]?.style}
      onPointerDownCapture={(event) => beginReorder(event, pane.terminalId)}
    >
      <TerminalPane
        session={selectedSession}
        pane={pane}
        terminalLayout={terminalLayout}
        openCodeInstance={opencodeTuiInstances?.find(
          (instance) => instance.terminalId === pane.terminalId
        )}
        onFocus={() => {
          focusedTerminalIdRef.current = pane.terminalId
          setFocusedTerminalId(pane.terminalId)
          onPaneFocus(pane.terminalId)
        }}
        onTitleChange={(title) => onPaneTitleChange(pane.terminalId, title)}
        onOpenCodeSessions={() => {
          hidePaneOverlay()
          setOpenCodeSessionsSourceId(pane.terminalId)
          setOpenCodeSessionsOpen(true)
        }}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => toggleFullscreen(pane.terminalId)}
        reorderState={
          reorderSourceId === pane.terminalId
            ? 'active'
            : reorderTargetId === pane.terminalId
              ? 'target'
              : reorderModifierHeld && hoveredPaneId === pane.terminalId
                ? 'candidate'
                : 'none'
        }
        paneOverlayVisible={paneOverlayVisible}
        paneOverlayNumber={isFullscreen ? null : index + 1}
        paneOverlayActive={pane.terminalId === focusedTerminalId}
        onClose={() => requestClosePane(pane.terminalId)}
        splitControlsVisible={splitModifierHeld && !reorderSourceId && !terminalLauncherOpen && !openCodeSessionsOpen && terminalLayout.panes.length < MAX_TERMINAL_COUNT}
        onSplit={(side) => {
          setFullscreenTerminalId(null)
          onSplitPane(pane.terminalId, side)
        }}
      />
    </div>
  )

  return (
    <div ref={rootRef} className="relative z-0 isolate flex h-full min-w-0 flex-col bg-bg">
      {!embedded && (
        <SessionTabStrip
          session={selectedSession}
          activeTab={activeTab}
          onSelect={onSelectTab}
          onAdd={onAddTab}
          onRenameStart={onTabRenameStart}
          onRename={onRenameTab}
          onClose={onCloseTab}
        />
      )}
      <header className={`flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel ${embedded ? 'px-2.5' : 'px-3'}`}>
        {!embedded && (
          <>
            <span
              className="min-w-0 max-w-[40%] truncate text-xs font-semibold text-fg"
              title={selectedSession.name}
            >
              {selectedSession.name}
            </span>
            <span aria-hidden="true" className="h-3 w-px shrink-0 bg-line-strong" />
          </>
        )}
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted"
          title={location}
        >
          {location}
        </span>
      </header>

      <div
        ref={gridRef}
        className="relative h-full min-h-0 flex-1 bg-line"
        onPointerMoveCapture={(event) => {
          setSplitModifierHeld(event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey &&
            !document.querySelector('[role="dialog"], [role="alertdialog"]'))
        }}
        onPointerMove={moveReorder}
        onPointerUp={finishReorder}
        onPointerCancel={cancelReorder}
        onLostPointerCapture={cancelReorder}
        onPointerLeave={() => {
          if (!reorderDragRef.current) setHoveredPaneId(null)
        }}
      >
        {(fullscreenPane ? [fullscreenPane] : renderedPanes).map((pane) => renderPane(pane, renderedPanes.indexOf(pane)))}
        {!isFullscreen && geometry.splits.map(({ node, style }) => (
          <TerminalResizeHandle
            key={node.id}
            splitId={node.id}
            axis={node.axis}
            ratio={node.ratio}
            style={style}
            onResize={(ratio) => onLayoutResize(node.id, ratio)}
          />
        ))}
      </div>

      <OpenCodeSessionsDialog
        open={openCodeSessionsOpen}
        onOpenChange={setOpenCodeSessionsOpen}
        session={selectedSession}
        sourceTerminalId={openCodeSessionsSourceId ?? ''}
        sourceRunning={openCodeSessionsSourceStatus === 'running'}
        currentDirectory={openCodeSessionsSourceId ? terminalDirectories[openCodeSessionsSourceId] : undefined}
        paneCount={terminalLayout.panes.length}
        onRestoreFocus={() => {
          if (openCodeSessionsSourceId) getSession(openCodeSessionsSourceId)?.term.focus()
        }}
        onSelect={(launch) => {
          setFullscreenTerminalId(null)
          onAddPane(launch.sourceTerminalId, launch)
          setOpenCodeSessionsOpen(false)
        }}
        onReplace={replaceOpenCodeSessionProcess}
      />

      <TerminalLauncher
        open={terminalLauncherOpen}
        onOpenChange={(open) => {
          setTerminalLauncherOpen(open)
          if (!open) setTerminalLauncherSourceId(null)
        }}
        session={selectedSession}
        sourceTerminalId={terminalLauncherSourceId ?? ''}
        directory={terminalLauncherSourceId
          ? terminalDirectories[terminalLauncherSourceId]
          : undefined}
        paneCount={terminalLayout.panes.length}
        onSelect={(launch) => {
          setFullscreenTerminalId(null)
          onAddPane(launch.sourceTerminalId, launch)
          setTerminalLauncherOpen(false)
          setTerminalLauncherSourceId(null)
        }}
      />

    </div>
  )
}
