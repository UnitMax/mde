import { useEffect, useRef, useState } from 'react'
import {
  Code,
  Columns2,
  Ellipsis,
  FolderOpen,
  Maximize2,
  Minimize2,
  Pencil,
  RotateCw,
  Rows2,
  X
} from 'lucide-react'
import type { Session } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { TerminalFullscreenIndicator } from '@/components/TerminalFullscreenIndicator'
import { TerminalGitInfo } from '@/components/TerminalGitInfo'
import { directoryLeafName } from '@/lib/terminal-title'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'
import {
  isTerminalPaneClosable,
  MAX_TERMINAL_COUNT,
  type SessionTerminalLayout,
  type TerminalPaneState,
  type TerminalSplitSide
} from '@/terminal/layout'
import { getSession } from '@/terminal/sessions'

const ACTION_BUTTON_CLASS =
  'pointer-events-auto text-fg-muted hover:bg-hover hover:text-fg active:bg-active data-[state=open]:bg-active data-[state=open]:text-fg'
const MENU_ICON_CLASS = 'h-3.5 w-3.5 shrink-0 text-fg-muted'

export interface TerminalPaneHeaderProps {
  session: Session
  pane: TerminalPaneState
  terminalLayout: SessionTerminalLayout
  /** The pane that last took focus; only singled out when there is another pane to tell it from. */
  focused: boolean
  isFullscreen: boolean
  onToggleFullscreen: () => void
  onTitleChange: (title: string | null) => void
  onRestart: () => void
  onClose: () => void
  onSplit: (side: TerminalSplitSide) => void
}

/**
 * The bar above a terminal pane: its title and Git state on the left, and on the
 * right the actions, which stay out of sight until the pane is hovered, focused or holding an open menu
 * so the title keeps the whole width. The actions overlay the bar instead of sitting in its flow, so
 * showing them never moves the title. The bar is also the container that the Git chip's narrow-pane
 * rules measure (`@container/pane`).
 */
export function TerminalPaneHeader({
  session,
  pane,
  terminalLayout,
  focused,
  isFullscreen,
  onToggleFullscreen,
  onTitleChange,
  onRestart,
  onClose,
  onSplit
}: TerminalPaneHeaderProps): JSX.Element {
  const terminalId = pane.terminalId
  const platform = useWorkspace((state) => state.platform)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  const directory = useWorkspace((state) => state.terminalDirectories[terminalId])
  const [renaming, setRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  // What the open menu was closed by, so focus goes where the choice needs it (see onCloseAutoFocus).
  const menuChoiceRef = useRef<'rename' | 'action' | null>(null)

  const defaultTitle = directoryLeafName(directory) ?? 'terminal'
  const title = pane.title?.trim() || defaultTitle
  const paneCount = terminalLayout.panes.length
  const showFocus = focused && paneCount > 1
  const closable = isTerminalPaneClosable(terminalLayout.panes, terminalId)
  const canSplit = paneCount < MAX_TERMINAL_COUNT
  const canOpenExternally =
    platform?.isWindows === true && wslAvailable && session.kind === 'wsl' && Boolean(session.distro)

  useEffect(() => {
    if (!renaming) return
    const frame = window.requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [renaming])

  const beginRename = (): void => {
    setDraftTitle(title)
    setRenaming(true)
  }

  const commitRename = (): void => {
    if (!renaming) return
    const normalized = draftTitle.trim()
    // Keeping the derived name stores nothing, so the title goes on following the folder.
    onTitleChange(normalized && normalized !== defaultTitle ? normalized : null)
    setRenaming(false)
  }

  const choose = (action: () => void) => (): void => {
    menuChoiceRef.current = 'action'
    action()
  }

  return (
    <header
      aria-label={title}
      className={cn(
        'group/header @container/pane relative flex h-7 shrink-0 items-center gap-2 border-b bg-panel pl-2.5 pr-1',
        showFocus ? 'border-accent/50' : 'border-line'
      )}
      data-focused={focused ? 'true' : 'false'}
      data-testid="terminal-pane-title-bar"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {renaming ? (
          <input
            ref={titleInputRef}
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename()
              if (event.key === 'Escape') setRenaming(false)
              event.stopPropagation()
            }}
            onClick={(event) => event.stopPropagation()}
            className="h-5 min-w-0 flex-1 rounded-sm border border-accent bg-bg px-1.5 text-xs text-fg outline-none"
            data-testid="terminal-pane-title-input"
            aria-label="Terminal title"
          />
        ) : (
          <span
            className="min-w-0 truncate text-xs font-medium text-fg"
            data-testid="terminal-pane-title"
            title={[title, directory, 'Double-click to rename'].filter(Boolean).join(' · ')}
            onDoubleClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              beginRename()
            }}
          >
            {title}
          </span>
        )}
        {/* While renaming, the input has the whole bar. The chip stays mounted (hidden) so its polling carries on. */}
        <div className={renaming ? 'hidden' : 'contents'}>
          <TerminalGitInfo terminalId={terminalId} />
          <TerminalFullscreenIndicator isFullscreen={isFullscreen} />
        </div>
      </div>

      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 bg-linear-to-l from-panel from-70% to-transparent pl-8 pr-1',
          'opacity-0 transition-opacity motion-reduce:transition-none',
          'group-hover/header:opacity-100 group-data-[focused=true]/header:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100',
          isFullscreen && 'opacity-100',
          renaming && 'invisible'
        )}
        data-testid="terminal-pane-actions"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className={ACTION_BUTTON_CLASS}
          aria-label={isFullscreen ? 'Exit terminal fullscreen' : 'Enter terminal fullscreen'}
          aria-pressed={isFullscreen}
          data-testid={`terminal-fullscreen-toggle-${terminalId}`}
          title={isFullscreen
            ? 'Exit terminal fullscreen (Ctrl+Shift+F)'
            : 'Enter terminal fullscreen (Ctrl+Shift+F)'}
          onClick={onToggleFullscreen}
        >
          {isFullscreen
            ? <Minimize2 className="h-3.5 w-3.5" />
            : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={ACTION_BUTTON_CLASS}
              aria-label="Terminal actions"
              title="Terminal actions"
              data-testid={`terminal-pane-menu-${terminalId}`}
            >
              <Ellipsis className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={4}
            className="w-72 whitespace-nowrap"
            data-testid="terminal-pane-menu"
            onCloseAutoFocus={(event) => {
              // Radix hands focus back to the ⋯ button a tick after the menu closes. That races the title
              // input's own focus when renaming (and blurring that input commits the rename), and it is
              // pointless when the choice opens a dialog that takes focus itself. Only a plain dismissal
              // returns to the terminal, so typing can carry on.
              event.preventDefault()
              if (menuChoiceRef.current === null) getSession(terminalId)?.term.focus()
              menuChoiceRef.current = null
            }}
          >
            <DropdownMenuItem
              data-testid={`terminal-rename-${terminalId}`}
              onSelect={() => {
                menuChoiceRef.current = 'rename'
                beginRename()
              }}
            >
              <Pencil className={MENU_ICON_CLASS} aria-hidden="true" />
              Rename…
            </DropdownMenuItem>

            {canSplit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  title="Or hold Ctrl and click a + at the pane edge"
                  data-testid={`terminal-split-right-${terminalId}`}
                  onSelect={choose(() => onSplit('right'))}
                >
                  <Columns2 className={MENU_ICON_CLASS} aria-hidden="true" />
                  Split right
                </DropdownMenuItem>
                <DropdownMenuItem
                  title="Or hold Ctrl and click a + at the pane edge"
                  data-testid={`terminal-split-down-${terminalId}`}
                  onSelect={choose(() => onSplit('bottom'))}
                >
                  <Rows2 className={MENU_ICON_CLASS} aria-hidden="true" />
                  Split down
                </DropdownMenuItem>
              </>
            )}

            {canOpenExternally && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!directory}
                  title={directory ? undefined : 'Waiting for terminal directory'}
                  data-testid={`terminal-open-vscode-${terminalId}`}
                  onSelect={choose(() => void window.api.paths.openTerminalInVsCode(terminalId))}
                >
                  <Code className={MENU_ICON_CLASS} aria-hidden="true" />
                  Open in VS Code
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!directory}
                  title={directory ? undefined : 'Waiting for terminal directory'}
                  data-testid={`terminal-reveal-${terminalId}`}
                  onSelect={choose(() => void window.api.paths.revealTerminal(terminalId))}
                >
                  <FolderOpen className={MENU_ICON_CLASS} aria-hidden="true" />
                  Show in File Explorer
                </DropdownMenuItem>
              </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-danger data-[highlighted]:bg-danger/15"
              data-testid={`terminal-restart-${terminalId}`}
              onSelect={choose(onRestart)}
            >
              <RotateCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Restart terminal
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {closable && (
          <Button
            variant="ghost"
            size="icon-sm"
            className={ACTION_BUTTON_CLASS}
            aria-label="Close terminal"
            title="Close terminal"
            data-testid={`terminal-close-${terminalId}`}
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </header>
  )
}
