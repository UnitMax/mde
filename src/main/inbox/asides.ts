import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { ChatAsideEntry } from '@shared/types'
import { writeJsonAtomic } from '../store/atomic-json'

/** How many answered side questions a thread keeps; the oldest go first. */
export const ASIDE_HISTORY_LIMIT = 20
/** An answer longer than this is kept cut short, so one runaway answer cannot bloat the file. */
export const ASIDE_ANSWER_LIMIT = 100_000

interface Stored {
  version: 1
  threads: Record<string, ChatAsideEntry[]>
}

function entry(value: unknown): ChatAsideEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const { id, question, answer, askedAt } = value as Record<string, unknown>
  if (typeof id !== 'string' || !id || typeof question !== 'string' || typeof answer !== 'string') return null
  if (typeof askedAt !== 'number' || !Number.isFinite(askedAt)) return null
  return { id, question, answer, askedAt }
}

/** What a file holds, with anything malformed left out. */
export function parseAsideHistory(raw: string): Record<string, ChatAsideEntry[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  const threads = (parsed as Partial<Stored> | null)?.threads
  if (typeof threads !== 'object' || threads === null || Array.isArray(threads)) return {}
  const result: Record<string, ChatAsideEntry[]> = {}
  for (const [threadId, list] of Object.entries(threads)) {
    if (!Array.isArray(list)) continue
    const entries = list.map(entry).filter((item): item is ChatAsideEntry => item !== null).slice(-ASIDE_HISTORY_LIMIT)
    if (entries.length > 0) result[threadId] = entries
  }
  return result
}

/**
 * The answered side questions (`/btw`) of each thread, so they can be looked at again after their card is
 * closed and after a restart. Held in memory and written to one file when a question is answered or a
 * thread goes; a write that fails never fails the question, and is tried again with the next change.
 */
export class InboxAsideHistory {
  private threads: Record<string, ChatAsideEntry[]> | null = null
  private loading: Promise<void> | null = null
  private writing: Promise<void> = Promise.resolve()
  private failing = false

  constructor(
    private readonly file: string,
    /** Whether a thread still exists; the history of one that does not is dropped when the file is read. */
    private readonly alive: (threadId: string) => boolean = () => true,
    private readonly now: () => number = Date.now,
  ) {}

  private load(): Promise<void> {
    this.loading ??= (async () => {
      let raw = ''
      try {
        raw = await fs.readFile(this.file, 'utf8')
      } catch {
        // No file yet, or one that cannot be read: start empty.
      }
      const read = raw ? parseAsideHistory(raw) : {}
      const kept = Object.fromEntries(Object.entries(read).filter(([threadId]) => this.alive(threadId)))
      this.threads = kept
      if (Object.keys(kept).length !== Object.keys(read).length) this.save()
    })()
    return this.loading
  }

  /** Queues a write of what is held now. Never rejects. */
  private save(): Promise<void> {
    this.writing = this.writing.then(async () => {
      try {
        await writeJsonAtomic(this.file, { version: 1, threads: this.threads ?? {} } satisfies Stored)
        this.failing = false
      } catch (error) {
        // Once, and without the path: it names the user's profile folder.
        if (!this.failing) console.warn(`[inbox] Could not save side questions (${(error as NodeJS.ErrnoException).code ?? 'error'}); they are kept in memory.`)
        this.failing = true
      }
    })
    return this.writing
  }

  /** A thread's answered side questions, oldest first. */
  async list(threadId: string): Promise<ChatAsideEntry[]> {
    await this.load()
    return [...(this.threads![threadId] ?? [])]
  }

  /** Keeps an answered question, and gives it back as it is kept. */
  async add(threadId: string, question: string, answer: string): Promise<ChatAsideEntry> {
    await this.load()
    const added: ChatAsideEntry = { id: randomUUID(), question, answer: answer.slice(0, ASIDE_ANSWER_LIMIT), askedAt: this.now() }
    this.threads![threadId] = [...(this.threads![threadId] ?? []), added].slice(-ASIDE_HISTORY_LIMIT)
    void this.save()
    return added
  }

  /** Forgets a thread's side questions; they go with the thread. */
  async remove(threadId: string): Promise<void> {
    await this.load()
    if (!(threadId in this.threads!)) return
    delete this.threads![threadId]
    await this.save()
  }

  /** Resolves once everything queued has been written (or has failed to be). */
  flush(): Promise<void> {
    return this.writing
  }
}
