import { ChevronDown, Code, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useWorkspace } from '@/store/workspace'

/**
 * Whose folder to open: a live terminal's current directory, or the folder of an Inbox thread (`ses_…`) or
 * project (`fld_…`). Either way only the ID goes to the main process, which finds and verifies the folder.
 */
export type OpenFolderTarget = { terminalId: string; inboxId?: never } | { inboxId: string; terminalId?: never }

function useOpenFolder(target: OpenFolderTarget, kind: 'native' | 'wsl', distro: string | undefined): {
  canOpenInVsCode: boolean
  openInVsCode: () => void
  reveal: () => void
} {
  const isWindows = useWorkspace((state) => state.platform?.isWindows === true)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  return {
    canOpenInVsCode: isWindows && wslAvailable && kind === 'wsl' && Boolean(distro),
    openInVsCode: () => {
      void (target.terminalId !== undefined
        ? window.api.paths.openTerminalInVsCode(target.terminalId)
        : window.api.paths.openInboxInVsCode(target.inboxId))
    },
    reveal: () => {
      void (target.terminalId !== undefined
        ? window.api.paths.revealTerminal(target.terminalId)
        : window.api.paths.revealInbox(target.inboxId))
    }
  }
}

/**
 * The "Open folder in VS Code" and "Open folder in File Explorer" icon buttons, shared by the Files sidebar
 * of both views and the Inbox thread header. VS Code is offered only where main can hand it the folder: a
 * WSL folder, from Windows with WSL installed. The file manager works for a Mac folder as well.
 */
export function OpenFolderButtons({
  target,
  kind,
  distro,
  className = 'shrink-0'
}: {
  target: OpenFolderTarget
  /** Where the folder lives: the host, or a WSL distro. */
  kind: 'native' | 'wsl'
  distro?: string
  className?: string
}): JSX.Element {
  const { canOpenInVsCode, openInVsCode, reveal } = useOpenFolder(target, kind, distro)
  return (
    <>
      {canOpenInVsCode && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={className}
          onClick={openInVsCode}
          title="Open folder in VS Code"
          aria-label="Open folder in VS Code"
        >
          <Code className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className={className}
        onClick={reveal}
        title="Open folder in File Explorer"
        aria-label="Open folder in File Explorer"
      >
        <FolderOpen className="h-3.5 w-3.5" />
      </Button>
    </>
  )
}

/**
 * One "Open" button for a thread's header: it opens the folder in the file manager, and where main can also hand
 * the folder to VS Code, a chevron beside it offers that too.
 */
export function OpenFolderMenu({
  target,
  kind,
  distro
}: {
  target: OpenFolderTarget
  kind: 'native' | 'wsl'
  distro?: string
}): JSX.Element {
  const { canOpenInVsCode, openInVsCode, reveal } = useOpenFolder(target, kind, distro)
  return (
    <div className="flex shrink-0 items-center" data-testid="open-folder-menu">
      <Button
        variant="ghost"
        size="sm"
        className={canOpenInVsCode ? 'rounded-r-none pr-1.5' : undefined}
        onClick={reveal}
        title="Open folder in File Explorer"
        aria-label="Open folder in File Explorer"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="@max-[38rem]/thread:hidden">Open</span>
      </Button>
      {canOpenInVsCode && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="w-5 rounded-l-none" aria-label="More ways to open the folder" title="More ways to open the folder">
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={reveal}>
              <FolderOpen className="h-3.5 w-3.5" />
              Open folder in File Explorer
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={openInVsCode}>
              <Code className="h-3.5 w-3.5" />
              Open folder in VS Code
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
