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

export function terminalDropMode(bufferType: 'normal' | 'alternate'): TerminalDropMode {
  return bufferType === 'alternate' ? 'tui' : 'shell'
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
