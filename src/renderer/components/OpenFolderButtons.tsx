import { Code, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/store/workspace'

/**
 * Whose folder to open: a live terminal's current directory, or the folder of an Inbox thread (`ses_…`) or
 * project (`fld_…`). Either way only the ID goes to the main process, which finds and verifies the folder.
 */
export type OpenFolderTarget = { terminalId: string; inboxId?: never } | { inboxId: string; terminalId?: never }

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
  const isWindows = useWorkspace((state) => state.platform?.isWindows === true)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  const canOpenInVsCode = isWindows && wslAvailable && kind === 'wsl' && Boolean(distro)
  const openInVsCode = (): void => {
    void (target.terminalId !== undefined
      ? window.api.paths.openTerminalInVsCode(target.terminalId)
      : window.api.paths.openInboxInVsCode(target.inboxId))
  }
  const reveal = (): void => {
    void (target.terminalId !== undefined
      ? window.api.paths.revealTerminal(target.terminalId)
      : window.api.paths.revealInbox(target.inboxId))
  }
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
