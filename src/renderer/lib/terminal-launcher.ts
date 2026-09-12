import type { TerminalLaunchDirectory } from '@shared/types'

export interface TerminalLauncherShortcutInput {
  type?: string
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing?: boolean
}

export function isTerminalLauncherShortcut(input: TerminalLauncherShortcutInput): boolean {
  return (
    (input.type === undefined || input.type === 'keydown') &&
    input.key.toLowerCase() === 'n' &&
    (input.ctrlKey || input.metaKey) &&
    !input.altKey &&
    !input.shiftKey &&
    !input.isComposing
  )
}

export function defaultTerminalLaunchDirectory(
  terminalDirectory: string | undefined
): TerminalLaunchDirectory {
  return terminalDirectory?.trim() ? 'terminal' : 'session'
}

export function terminalLaunchDirectoryPath(
  directory: TerminalLaunchDirectory,
  terminalDirectory: string | undefined,
  sessionDirectory: string
): string | undefined {
  if (directory === 'terminal') return terminalDirectory?.trim() ? terminalDirectory : undefined
  return sessionDirectory.trim() ? sessionDirectory : undefined
}

export function terminalLaunchDirectoryDisabled(
  directory: TerminalLaunchDirectory,
  terminalDirectory: string | undefined,
  sessionDirectory: string
): boolean {
  if (directory === 'terminal') return !terminalDirectory?.trim()
  return (
    !sessionDirectory.trim() ||
    (Boolean(terminalDirectory?.trim()) && terminalDirectory === sessionDirectory)
  )
}

export function toggleTerminalLaunchDirectory(
  selected: TerminalLaunchDirectory,
  terminalDirectory: string | undefined,
  sessionDirectory: string
): TerminalLaunchDirectory {
  const next = selected === 'terminal' ? 'session' : 'terminal'
  return terminalLaunchDirectoryDisabled(next, terminalDirectory, sessionDirectory)
    ? selected
    : next
}
