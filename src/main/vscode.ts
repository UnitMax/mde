import type { Session } from '@shared/types'

function validateVsCodeSession(session: Session, platform: NodeJS.Platform, directory: string): string {
  if (platform !== 'win32') {
    throw new Error('Opening WSL sessions in Windows VS Code is only supported on Windows')
  }
  if (session.kind !== 'wsl') {
    throw new Error('Only WSL sessions can be opened in Windows VS Code')
  }
  if (!session.distro) {
    throw new Error(`WSL session "${session.name}" has no distro`)
  }
  if (!directory.trim()) {
    throw new Error(`WSL session "${session.name}" has no project path`)
  }
  return session.distro
}

function encodeWslPath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

/**
 * Builds the Windows VS Code remote URI for a WSL session.
 *
 * The URI is handed to Windows through the registered VS Code protocol instead
 * of resolving the `code` command through the caller's PATH. The path stays in
 * Linux format so Remote - WSL opens the folder inside the selected distro.
 */
export function buildVsCodeRemoteUri(
  session: Session,
  platform: NodeJS.Platform,
  directory = session.path
): string {
  const distro = validateVsCodeSession(session, platform, directory)

  const path = directory.trim()
  // VS Code treats a path with a file-like extension as a file. The trailing
  // slash makes the intent unambiguous for dotted project directories.
  const folderPath = path.endsWith('/') ? path : `${path}/`
  const authority = `wsl+${encodeURIComponent(distro)}`

  return `vscode://vscode-remote/${authority}${encodeWslPath(folderPath)}`
}
