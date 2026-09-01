import type { PtyDropRejection, TerminalDropMode } from '@shared/ipc'

/** Identifies native file drags without claiming text or internal UI drags. */
export function isFileDrop(
  dataTransfer: Pick<DataTransfer, 'types' | 'items'> | null
): boolean {
  if (!dataTransfer) return false
  if (Array.from(dataTransfer.types).includes('Files')) return true

  for (let index = 0; index < dataTransfer.items.length; index += 1) {
    if (dataTransfer.items[index]?.kind === 'file') return true
  }
  return false
}

/** Keeps only file URLs from the browser's optional URI-list drag payload. */
export function fileDropUris(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .filter((line) => line.toLowerCase().startsWith('file:'))
}

/**
 * Chooses how dropped paths are laid out: one insertion per file for an agent
 * TUI, or a single quoted argument list for a shell.
 *
 * This is a formatting hint and must never gate shell safety. Terminal output
 * controls alternate-screen state, so a program can enter it and never restore
 * it, leaving a real shell prompt drawing in the alternate buffer. The main
 * process quotes any path a shell would act on regardless of the mode it is
 * handed — see `isShellInertPath` in `src/main/pty/drop.ts`.
 */
export function terminalDropMode(bufferType: 'normal' | 'alternate'): TerminalDropMode {
  return bufferType === 'alternate' ? 'tui' : 'shell'
}

/** Explains a quoted insertion in a pane the drop treated as an agent TUI. */
export function terminalDropQuotingNotice(count: number): string {
  const subject = count === 1 ? 'One path was' : `${count} paths were`
  return `${subject} quoted because the name contains characters a shell would run. Remove the quotes if the pane is an agent prompt.`
}

function rejectionName(rejection: PtyDropRejection): string {
  return rejection.name || 'The dropped file'
}

/** Produces a safe, actionable notice without exposing host paths or command output. */
export function terminalDropNotice(rejections: readonly PtyDropRejection[]): string {
  const messages = rejections.slice(0, 2).map((rejection) => {
    const name = rejectionName(rejection)
    const distro = rejection.distro ? ` in ${rejection.distro}` : ''

    switch (rejection.code) {
      case 'path-unresolved':
        return `${name}: MDE could not obtain a filesystem path from this drop.`
      case 'invalid-path':
        return `${name}: this path cannot be used by the terminal.`
      case 'wrong-distro':
        return `${name}: the file belongs to a different WSL distro${distro}.`
      case 'translation-failed':
        return `${name}: MDE could not translate the Windows path for${distro}; check that WSL is running.`
      case 'inaccessible':
        return `${name}: the file is not visible${distro}; verify the Windows drive is mounted under /mnt.`
      case 'wsl-unavailable':
        return `${name}: WSL is unavailable${distro}; start the distro and try again.`
      case 'terminal-unavailable':
        return `${name}: the terminal is no longer running.`
    }
  })

  if (messages.length === 0) return 'The dropped files could not be added to this terminal.'
  const remaining = rejections.length - messages.length
  return `${messages.join(' ')}${remaining > 0 ? ` ${remaining} more file${remaining === 1 ? '' : 's'} could not be added.` : ''}`
}
