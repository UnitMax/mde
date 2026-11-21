import type { ChatMessage, ChatSearchHit, ChatSearchRequest, ChatSearchResponse, ChatSearchResult, InboxThread } from '@shared/types'
import { findOffsets } from '@shared/text-search'
import type { OpenCodeServiceClient } from '../opencode/service/client'
import { parseMessagesPage } from '../opencode/service/parse'
import type { InboxStore } from './store'

/** Messages are read this many to a page. */
const PAGE_SIZE = 50
/** A thread is read back at most this many pages, and at most this much text, newest first. */
const MAX_PAGES = 40
const MAX_THREAD_CHARS = 2_000_000
/**
 * The most text held for all threads together. The threads with the most recent activity have it first; older ones
 * past it are not read, and are reported as left out.
 */
export const SEARCH_MAX_TOTAL_CHARS = 50_000_000
/** Reading stops when nobody has asked for this long; the next question starts it again. */
const IDLE_STOP_MS = 30_000
/** Threads are read this many at a time. */
const CONCURRENCY = 3
/** A thread that is working has new text all the time, so what was read of it is read again after this long. */
const WORKING_REREAD_MS = 5_000
/** A thread that could not be read is tried again after this long. */
const FAILED_RETRY_MS = 30_000

/** The most threads, and the most messages of each, that an answer lists. */
export const SEARCH_MAX_RESULTS = 100
export const SEARCH_HITS_PER_THREAD = 3

/** How much of the text around a match is shown. */
const CONTEXT_BEFORE = 48
const CONTEXT_AFTER = 96

export interface InboxSearchDependencies {
  client: Pick<OpenCodeServiceClient, 'request'>
  store: Pick<InboxStore, 'list'>
  enabled(): boolean
  now(): number
}

interface Entry {
  id: string
  role: 'user' | 'assistant'
  text: string
}

interface ThreadText {
  /** What the thread's last activity was when it was read; a later one makes the text stale. */
  stamp: number
  at: number
  failed: boolean
  /** Oldest first. */
  entries: Entry[]
  /** Characters in `entries`. */
  size: number
}

function sizeOf(entries: readonly Entry[]): number {
  return entries.reduce((total, entry) => total + entry.text.length, 0)
}

/** The newest entries that fit in `limit` characters; a single entry bigger than that keeps its end. */
function newestWithin(entries: readonly Entry[], limit: number): Entry[] {
  const kept: Entry[] = []
  let size = 0
  for (let index = entries.length - 1; index >= 0 && size < limit; index -= 1) {
    const entry = entries[index]!
    const room = limit - size
    kept.unshift(entry.text.length <= room ? entry : { ...entry, text: entry.text.slice(entry.text.length - room) })
    size += Math.min(entry.text.length, room)
  }
  return kept
}

function entriesOf(messages: readonly ChatMessage[]): Entry[] {
  const entries: Entry[] = []
  for (const message of messages) {
    if (message.kind === 'user') {
      if (message.text.trim()) entries.push({ id: message.id, role: 'user', text: message.text })
    } else if (message.kind === 'assistant') {
      const text = message.parts.flatMap((part) => (part.kind === 'text' && part.text.trim() ? [part.text] : [])).join('\n\n')
      if (text) entries.push({ id: message.id, role: 'assistant', text })
    }
  }
  return entries
}

const squash = (text: string): string => text.replace(/\s+/g, ' ')

/** The text around the match at `at`, cut into what comes before it, the match, and what follows; long text is cut with an ellipsis. */
export function snippet(text: string, at: number, length: number): Pick<ChatSearchHit, 'before' | 'match' | 'after'> {
  const from = Math.max(0, at - CONTEXT_BEFORE)
  const to = Math.min(text.length, at + length + CONTEXT_AFTER)
  const before = squash(text.slice(from, at)).trimStart()
  const after = squash(text.slice(at + length, to)).trimEnd()
  return {
    before: `${from > 0 ? '…' : ''}${before}`,
    match: squash(text.slice(at, at + length)),
    after: `${after}${to < text.length ? '…' : ''}`,
  }
}

/**
 * Search over the text of every thread's messages (parked threads only when asked): what the person and the agent wrote, not the tool calls. OpenCode
 * keeps the conversations, so they are read from it, newest thread first, in the background, and the text is held in
 * memory only (never written to disk). A thread is read again when it has had activity since, so asking is cheap
 * once the threads are read. An answer has what is read so far; the renderer asks again until it is all read.
 */
export class InboxSearch {
  private readonly texts = new Map<string, ThreadText>()
  private reading = false
  private includeParked = false
  private lastAsked = 0

  constructor(private readonly dependencies: InboxSearchDependencies) {}

  search(request: ChatSearchRequest): ChatSearchResponse {
    if (!this.dependencies.enabled()) return { results: [], indexed: 0, total: 0, truncated: false, leftOut: 0 }
    this.includeParked = request.includeParked === true
    this.lastAsked = this.dependencies.now()
    const threads = this.scope()
    this.read(threads)

    const query = request.query.trim()
    const allowances = this.allowances(threads)
    const leftOut = threads.filter((thread) => !this.texts.has(thread.id) && allowances.get(thread.id)! <= 0).length
    const indexed = threads.filter((thread) => this.texts.has(thread.id)).length
    const results: ChatSearchResult[] = []
    let truncated = false
    if (query) {
      for (const thread of threads) {
        const result = this.match(thread.id, query)
        if (!result) continue
        if (results.length >= SEARCH_MAX_RESULTS) {
          truncated = true
          break
        }
        results.push(result)
      }
    }
    return { results, indexed, total: threads.length - leftOut, truncated, leftOut }
  }

  /**
   * The threads searched, the most recent activity first: parked ones only when asked for. Text of the others is
   * let go, so leaving parked threads out also frees what was read of them.
   */
  private scope(): InboxThread[] {
    const threads = this.dependencies.store.list().filter((thread) => this.includeParked || !thread.archived)
    const known = new Set(threads.map((thread) => thread.id))
    for (const id of this.texts.keys()) if (!known.has(id)) this.texts.delete(id)
    return threads
  }

  /** How many characters each thread may hold: what the threads before it have not used of the total, up to the per-thread most. */
  private allowances(threads: readonly InboxThread[]): Map<string, number> {
    const allowances = new Map<string, number>()
    let used = 0
    for (const thread of threads) {
      allowances.set(thread.id, Math.min(MAX_THREAD_CHARS, SEARCH_MAX_TOTAL_CHARS - used))
      used += this.texts.get(thread.id)?.size ?? 0
    }
    return allowances
  }

  /** Lets go of the text of the oldest threads once the total is over: a newer thread read since has it first. */
  private trim(threads: readonly InboxThread[]): void {
    let used = 0
    for (const thread of threads) {
      const text = this.texts.get(thread.id)
      if (!text) continue
      if (used + text.size > SEARCH_MAX_TOTAL_CHARS) this.texts.delete(thread.id)
      else used += text.size
    }
  }

  private match(threadId: string, query: string): ChatSearchResult | null {
    const text = this.texts.get(threadId)
    if (!text) return null
    const hits: ChatSearchHit[] = []
    let hitCount = 0
    for (let index = text.entries.length - 1; index >= 0; index -= 1) {
      const entry = text.entries[index]!
      const [at] = findOffsets(entry.text, query)
      if (at === undefined) continue
      hitCount += 1
      if (hits.length < SEARCH_HITS_PER_THREAD) hits.push({ messageId: entry.id, role: entry.role, ...snippet(entry.text, at, query.length) })
    }
    return hitCount > 0 ? { threadId, hits, hitCount } : null
  }

  private stale(thread: InboxThread): boolean {
    const text = this.texts.get(thread.id)
    if (!text) return true
    const age = this.dependencies.now() - text.at
    if (text.failed) return age >= FAILED_RETRY_MS
    if (text.stamp !== thread.lastActivityAt) return true
    return (thread.status === 'working' || thread.status === 'attention') && age >= WORKING_REREAD_MS
  }

  /** The threads whose text is missing or stale and that have room left in the total. */
  private due(threads: readonly InboxThread[]): Array<{ thread: InboxThread; allowance: number }> {
    const allowances = this.allowances(threads)
    return threads
      .map((thread) => ({ thread, allowance: allowances.get(thread.id)! }))
      .filter(({ thread, allowance }) => allowance > 0 && this.stale(thread))
  }

  private idle(): boolean {
    return this.dependencies.now() - this.lastAsked >= IDLE_STOP_MS
  }

  /**
   * Reads the threads whose text is missing or stale, a few at a time, until none is or nobody has asked for a while
   * (the search is closed); a second call while reading only adds to the work.
   */
  private read(threads: readonly InboxThread[]): void {
    if (this.reading || this.due(threads).length === 0) return
    this.reading = true
    void (async () => {
      try {
        for (;;) {
          const queue = this.due(this.scope()).map(({ thread }) => thread)
          if (queue.length === 0 || this.idle()) return
          await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
            for (let thread = queue.shift(); thread && !this.idle(); thread = queue.shift()) {
              // What is left of the total is known only once the threads before it are read.
              const allowance = this.allowances(this.scope()).get(thread.id) ?? 0
              if (allowance <= 0) continue
              await this.readThread(thread, allowance)
              this.trim(this.scope())
            }
          }))
        }
      } finally {
        this.reading = false
      }
    })()
  }

  private async readThread(thread: InboxThread, allowance: number): Promise<void> {
    const stamp = thread.lastActivityAt
    try {
      const entries = newestWithin(await this.readMessages(thread, allowance), allowance)
      this.texts.set(thread.id, { stamp, at: this.dependencies.now(), failed: false, entries, size: sizeOf(entries) })
    } catch {
      // The service may be down or the thread gone; what was read before stays searchable, and a retry comes later.
      const entries = this.texts.get(thread.id)?.entries ?? []
      this.texts.set(thread.id, { stamp, at: this.dependencies.now(), failed: true, entries, size: sizeOf(entries) })
    }
  }

  private async readMessages(thread: InboxThread, allowance: number): Promise<Entry[]> {
    // Pages come newest first; each is put in front of the ones read before it.
    let entries: Entry[] = []
    let size = 0
    let cursor: string | undefined
    let pageSize = PAGE_SIZE
    for (let pages = 0; pages < MAX_PAGES && size < allowance; pages += 1) {
      let answer: unknown
      try {
        answer = await this.dependencies.client.request(thread.target, 'session.message.list', {
          params: { sessionID: thread.id },
          query: { limit: String(pageSize), ...(cursor ? { cursor } : { order: 'desc' }) },
        })
      } catch (error) {
        // A page too big for the client to accept is asked again in smaller pieces, as the conversation view does.
        if (!(error instanceof Error) || error.message !== 'The OpenCode service sent more data than MDE accepts.' || pageSize === 1) throw error
        pageSize = Math.max(1, Math.floor(pageSize / 2))
        pages -= 1
        continue
      }
      const page = parseMessagesPage(answer, false, pageSize)
      const found = entriesOf(page.messages)
      size += sizeOf(found)
      entries = [...found, ...entries]
      if (!page.older) break
      cursor = page.older
    }
    return entries
  }
}
