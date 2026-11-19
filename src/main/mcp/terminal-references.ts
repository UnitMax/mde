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
import { writeTextAtomic } from '../store/atomic-json'

/**
 * References to Inbox terminal panes that the person dragged into a message (see `@shared/terminal-references`).
 * Main keeps which pane each ref names, so a message holds only the ref and an agent can name no other pane. A
 * pane keeps its ref, so dragging it in again writes the same one. The refs are kept between runs, because the
 * Inbox terminal's panes keep their IDs between runs and an old message should still name its pane.
 *
 * A ref goes with its pane: the window says when a pane is closed, and at start which panes it brought back, so no
 * ref outlives the pane it was made for. No pane can then be read through a ref the person made for another one.
 */

export const TERMINAL_REFERENCES_FILE = 'terminal-references.json'
/** 2 since Inbox panes got keys that are never handed out again; refs of version 1 are not read. */
export const TERMINAL_REFERENCES_VERSION = 2
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
  title: string
  createdAt: number
}

export interface TerminalReferenceHost {
  /** Asks the window to read a pane; false when there is no window to ask. */
  send(request: TerminalReadRequest): boolean
  now(): number
}

interface Pending {
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
  private loaded: Promise<void> | null = null
  /** Whether the window has said which panes it brought back; until then a ref may still name a pane that is gone. */
  private retained = false
  private readonly pending = new Map<string, Pending>()

  constructor(
    private readonly userData: string,
    private readonly random: (size: number) => Uint8Array = (size) => randomBytes(size),
  ) {}

  /** Wired by the IPC layer, which owns the window. Until then no pane can be read. */
  attach(host: TerminalReferenceHost): void {
    this.host = host
  }

  private file(): string {
    return join(this.userData, TERMINAL_REFERENCES_FILE)
  }

  private async load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const parsed = JSON.parse(await fs.readFile(this.file(), 'utf8')) as unknown
        const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined
        // Refs written before panes had keys of their own may already name a pane that took a closed one's key, which
        // nothing can tell apart from the pane the person meant: they are dropped, and the person drags the pane in again.
        if (record?.version !== TERMINAL_REFERENCES_VERSION) return
        const list = record.references
        if (!Array.isArray(list)) return
        this.entries = list.flatMap((item): Entry[] => {
          if (!item || typeof item !== 'object') return []
          const { ref, terminalId, title, createdAt } = item as Record<string, unknown>
          if (!isTerminalRef(ref) || !isInboxTerminalPane(terminalId) || typeof title !== 'string' || typeof createdAt !== 'number') return []
          return [{ ref, terminalId, title: cleanTerminalTitle(title), createdAt }]
        }).slice(-TERMINAL_REFERENCE_LIMIT)
      } catch {
        // No file yet, or an unreadable one: no refs.
      }
    })()
    return this.loaded
  }

  private async save(): Promise<void> {
    await writeTextAtomic(this.file(), `${JSON.stringify({ version: TERMINAL_REFERENCES_VERSION, references: this.entries }, null, 2)}\n`)
  }

  /** The pane's ref, made now if it has none, with the title it is shown with. */
  async create(terminalId: string, title: string): Promise<TerminalReferenceCreated> {
    await this.load()
    if (!isInboxTerminalPane(terminalId)) throw new Error('Only a pane of the Inbox terminal can be put into a message.')
    const clean = cleanTerminalTitle(title)
    const now = this.host?.now() ?? Date.now()
    let entry = this.entries.find((item) => item.terminalId === terminalId)
    if (entry) {
      entry.title = clean
      // Used again, it is kept like a new one.
      this.entries = [...this.entries.filter((item) => item !== entry), entry]
    } else {
      let ref = terminalRefFrom(this.random(TERMINAL_REF_LENGTH))
      while (this.entries.some((item) => item.ref === ref)) ref = terminalRefFrom(this.random(TERMINAL_REF_LENGTH))
      entry = { ref, terminalId, title: clean, createdAt: now }
      this.entries = [...this.entries, entry].slice(-TERMINAL_REFERENCE_LIMIT)
    }
    await this.save()
    return { ref: entry.ref, text: terminalReferenceText(entry.ref, entry.title) }
  }

  /** Forgets the refs of panes that were closed. */
  async forget(terminalIds: readonly string[]): Promise<void> {
    await this.load()
    const gone = new Set(terminalIds)
    await this.keepOnly((entry) => !gone.has(entry.terminalId))
  }

  /** Forgets the refs of every pane but these, the ones the window brought back at start. Reading waits for this. */
  async retain(terminalIds: readonly string[]): Promise<void> {
    await this.load()
    const kept = new Set(terminalIds)
    await this.keepOnly((entry) => kept.has(entry.terminalId))
    this.retained = true
  }

  private async keepOnly(keep: (entry: Entry) => boolean): Promise<void> {
    const entries = this.entries.filter(keep)
    if (entries.length === this.entries.length) return
    this.entries = entries
    await this.save()
  }

  /** The pane a ref names, or undefined when MDE made no such ref (or has let it go). */
  async resolve(ref: string): Promise<{ terminalId: string; title: string } | undefined> {
    await this.load()
    if (!isTerminalRef(ref)) return undefined
    const entry = this.entries.find((item) => item.ref === ref)
    return entry ? { terminalId: entry.terminalId, title: entry.title } : undefined
  }

  /** What the pane a ref names shows: its last `lines` lines. Throws with a reason the agent reads. */
  async read(ref: string, lines: number): Promise<TerminalReading> {
    const entry = await this.resolve(ref)
    if (!entry) throw new Error(`MDE has no terminal ${ref}: its pane was closed, or it was never put into a message. Only a terminal the person dragged into a message can be read.`)
    const host = this.host
    if (!host || !this.retained) throw new Error('MDE is still starting. Try again in a moment.')
    if (this.pending.size >= TERMINAL_READ_PENDING_LIMIT) throw new Error('MDE is still reading other terminals. Try again in a moment.')
    const requestId = randomUUID()
    return new Promise<TerminalReading>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return
        reject(new Error('MDE’s window did not answer. Is MDE showing a dialog, or still loading?'))
      }, TERMINAL_READ_TIMEOUT_MS)
      this.pending.set(requestId, { resolve, reject, timer })
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
    else pending.resolve(answer.reading)
  }
}
