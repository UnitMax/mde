import { promises as fs } from 'node:fs'
import { join, posix, win32 } from 'node:path'
import type { Session } from '@shared/types'
import { inboxTerminalThreadId } from '@shared/inbox-thread-terminal'
import { writeJsonAtomic } from '../store/atomic-json'
import { isPlainAbsolutePath } from '../wsl/paths'

export const TERMINAL_DIRECTORIES_FILE = 'terminal-directories.json'
const SAVE_DELAY_MS = 200

interface SavedDirectory {
  terminalId: string
  sessionId: string
  kind: Session['kind']
  distro?: string
  directory: string
}

function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
}

function savedDirectory(value: unknown): value is SavedDirectory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  if (!text(entry.terminalId, 2048) || !text(entry.sessionId, 512) || !text(entry.directory, 32768)) return false
  if (inboxTerminalThreadId(entry.sessionId)) return false
  if (entry.kind === 'wsl') return text(entry.distro, 128) && isPlainAbsolutePath(entry.directory)
  if (entry.kind !== 'native') return false
  return process.platform === 'win32'
    ? win32.isAbsolute(entry.directory) && (/^[A-Za-z]:[\\/]/.test(entry.directory) || entry.directory.startsWith('\\\\'))
    : posix.isAbsolute(entry.directory)
}

/** Last known directories belong to terminal identities, independently of layout writes. */
export class TerminalDirectoryStore {
  private readonly entries = new Map<string, SavedDirectory>()
  private file: string | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private dirty = false
  private writing: Promise<void> = Promise.resolve()

  async configure(userData: string): Promise<void> {
    this.file = join(userData, TERMINAL_DIRECTORIES_FILE)
    try {
      const value: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'))
      if (!value || typeof value !== 'object' || !('terminals' in value) || !Array.isArray(value.terminals)) return
      for (const entry of value.terminals) {
        if (savedDirectory(entry)) this.entries.set(entry.terminalId, entry)
      }
    } catch {
      // Missing or damaged records mean fresh shells start at home.
    }
  }

  get(terminalId: string, session: Session): string | undefined {
    const entry = this.entries.get(terminalId)
    return entry?.sessionId === session.id && entry.kind === session.kind &&
      (session.kind !== 'wsl' || entry.distro === session.distro) ? entry.directory : undefined
  }

  remember(terminalId: string, session: Session, directory: string): void {
    const entry: SavedDirectory = {
      terminalId, sessionId: session.id, kind: session.kind,
      ...(session.kind === 'wsl' ? { distro: session.distro } : {}), directory,
    }
    if (!savedDirectory(entry) || this.get(terminalId, session) === directory) return
    this.entries.set(terminalId, entry)
    this.changed()
  }

  forget(terminalId: string): void {
    if (this.entries.delete(terminalId)) this.changed()
  }

  forgetSession(sessionId: string): void {
    for (const [terminalId, entry] of this.entries) {
      if (entry.sessionId === sessionId) this.forget(terminalId)
    }
  }

  private changed(): void {
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush().catch(() => console.warn('[terminal] Could not save terminal directories.'))
    }, SAVE_DELAY_MS)
    this.timer.unref?.()
  }

  /** Includes pending writes; shutdown calls this after stopping the PTYs. */
  flush(): Promise<void> {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.file || !this.dirty) return this.writing
    this.dirty = false
    const file = this.file
    const snapshot = { terminals: [...this.entries.values()] }
    this.writing = this.writing.catch(() => {}).then(() => writeJsonAtomic(file, snapshot)).catch((error) => {
      this.dirty = true
      throw error
    })
    return this.writing
  }
}
