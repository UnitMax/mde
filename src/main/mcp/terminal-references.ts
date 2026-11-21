import { randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  cleanTerminalTitle,
  isTerminalRef,
  terminalRefFrom,
  terminalReferenceText,
  TERMINAL_REF_LENGTH,
  type TerminalReadAnswer,
  type TerminalReading,
  type TerminalReadRequest,
  type TerminalReferenceCreated,
} from '@shared/terminal-references'
import { INBOX_TERMINAL_SESSION_ID } from '@shared/inbox-terminal'

/**
 * References to Inbox terminal panes that the person dragged into a message (see `@shared/terminal-references`).
 * Main keeps which pane each ref names, so a message holds only the ref and an agent can name no other pane.
 *
 * A ref names one shell, not just its pane: what the person shared is what that shell showed. A pane's terminal ID
 * outlives its shell (Restart, a WSL distribution change, a new start of MDE all start a fresh one under it), so
 * each ref also keeps the shell's random ID (`PtyManager.shellId`) and stops working once the pane runs another
 * shell; dragging the pane in again makes a new ref. Refs are kept in memory only: no shell outlives MDE, so a ref
 * from an earlier run could only ever read a shell the person never shared.
 */

/** Where refs were kept between runs before they were tied to one shell; removed at start. */
export const TERMINAL_REFERENCES_FILE = 'terminal-references.json'
/** The most refs kept; the oldest go first. */
export const TERMINAL_REFERENCE_LIMIT = 200
/** How long the window has to read a pane before the agent is told it could not. */
export const TERMINAL_READ_TIMEOUT_MS = 5_000
/** Readings the window has not answered yet; more are refused, so a looping agent cannot pile them up. */
export const TERMINAL_READ_PENDING_LIMIT = 8

const TERMINAL_ID_LIMIT = 300

interface Entry {
  ref: string
  terminalId: string
  /** The shell the pane ran when it was shared. */
  shellId: string
  title: string
  createdAt: number
}

export interface TerminalReferenceHost {
  /** Asks the window to read a pane; false when there is no window to ask. */
  send(request: TerminalReadRequest): boolean
  /** The shell a terminal runs now (see `PtyManager.shellId`), undefined when it has none. */
  shellId(terminalId: string): string | undefined
  now(): number
}

interface Pending {
  entry: Entry
  resolve: (reading: TerminalReading) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** Whether a terminal ID is a pane of the Inbox terminal, the only terminal a message can point at. */
export function isInboxTerminalPane(terminalId: unknown): terminalId is string {
  return typeof terminalId === 'string'
    && terminalId.length <= TERMINAL_ID_LIMIT
    && terminalId.startsWith(`${INBOX_TERMINAL_SESSION_ID}:tab:`)
    // eslint-disable-next-line no-control-regex
    && !/[\u0000-\u001f\u007f]/.test(terminalId)
}

export class TerminalReferences {
  private host: TerminalReferenceHost | null = null
  private entries: Entry[] = []
  private readonly pending = new Map<string, Pending>()
  private readonly cleared: Promise<void>

  constructor(
    userData: string,
    private readonly random: (size: number) => Uint8Array = (size) => randomBytes(size),
  ) {
    // Refs an earlier run kept name shells that are gone.
    this.cleared = fs.rm(join(userData, TERMINAL_REFERENCES_FILE), { force: true }).catch(() => undefined)
  }

  /** Wired by the IPC layer, which owns the window and the shells. Until then no pane can be shared or read. */
  attach(host: TerminalReferenceHost): void {
    this.host = host
  }

  /** Whether a ref still names the shell it was made for; one that does not is forgotten. */
  private current(entry: Entry): boolean {
    if (this.host?.shellId(entry.terminalId) === entry.shellId) return true
    this.entries = this.entries.filter((item) => item !== entry)
    return false
  }

  /** The ref of the shell the pane runs now, made now if it has none, with the title it is shown with. */
  async create(terminalId: string, title: string): Promise<TerminalReferenceCreated> {
    await this.cleared
    if (!isInboxTerminalPane(terminalId)) throw new Error('Only a pane of the Inbox terminal can be put into a message.')
    const shellId = this.host?.shellId(terminalId)
    if (!shellId) throw new Error('That terminal is not running.')
    const clean = cleanTerminalTitle(title)
    const now = this.host?.now() ?? Date.now()
    // A ref made for an earlier shell of this pane goes: the new one names only what the person shares now.
    let entry = this.entries.find((item) => item.terminalId === terminalId && this.current(item))
    if (entry) {
      entry.title = clean
      // Used again, it is kept like a new one.
      this.entries = [...this.entries.filter((item) => item !== entry), entry]
    } else {
      let ref = terminalRefFrom(this.random(TERMINAL_REF_LENGTH))
      while (this.entries.some((item) => item.ref === ref)) ref = terminalRefFrom(this.random(TERMINAL_REF_LENGTH))
      entry = { ref, terminalId, shellId, title: clean, createdAt: now }
      this.entries = [...this.entries, entry].slice(-TERMINAL_REFERENCE_LIMIT)
    }
    return { ref: entry.ref, text: terminalReferenceText(entry.ref, entry.title) }
  }

  /** Forgets the refs of panes that were closed. */
  forget(terminalIds: readonly string[]): void {
    const gone = new Set(terminalIds)
    this.entries = this.entries.filter((entry) => !gone.has(entry.terminalId))
  }

  private entry(ref: string): Entry | undefined {
    if (!isTerminalRef(ref)) return undefined
    const entry = this.entries.find((item) => item.ref === ref)
    return entry && this.current(entry) ? entry : undefined
  }

  /** The pane a ref names, or undefined when MDE made no such ref, or its pane was closed or runs another shell. */
  async resolve(ref: string): Promise<{ terminalId: string; title: string } | undefined> {
    await this.cleared
    const entry = this.entry(ref)
    return entry ? { terminalId: entry.terminalId, title: entry.title } : undefined
  }

  /** What the pane a ref names shows: its last `lines` lines. Throws with a reason the agent reads. */
  async read(ref: string, lines: number): Promise<TerminalReading> {
    await this.cleared
    const entry = this.entry(ref)
    if (!entry) throw new Error(`MDE has no terminal ${ref}: its pane was closed or its shell restarted since then (also when MDE restarted), or it was never put into a message. Only the shell the person dragged into a message can be read; they can drag the terminal in again.`)
    const host = this.host
    if (!host) throw new Error('MDE is still starting. Try again in a moment.')
    if (this.pending.size >= TERMINAL_READ_PENDING_LIMIT) throw new Error('MDE is still reading other terminals. Try again in a moment.')
    const requestId = randomUUID()
    return new Promise<TerminalReading>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return
        reject(new Error('MDE’s window did not answer. Is MDE showing a dialog, or still loading?'))
      }, TERMINAL_READ_TIMEOUT_MS)
      this.pending.set(requestId, { entry, resolve, reject, timer })
      if (!host.send({ requestId, terminalId: entry.terminalId, lines })) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(new Error('MDE has no window open, so it cannot read the terminal.'))
      }
    })
  }

  /** The window's answer to a reading. */
  answer(answer: TerminalReadAnswer): void {
    const pending = this.pending.get(answer.requestId)
    if (!pending) return
    this.pending.delete(answer.requestId)
    clearTimeout(pending.timer)
    if ('error' in answer) pending.reject(new Error(answer.error))
    // The window read the pane's screen, which a restart while it was asked has already cleared for a new shell.
    else if (!this.current(pending.entry)) pending.reject(new Error('That terminal\'s shell restarted while it was being read, so it no longer shows what the person shared. They can drag the terminal in again.'))
    else pending.resolve(answer.reading)
  }
}
