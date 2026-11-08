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
 * Search over the text of every thread's messages: what the person and the agent wrote, not the tool calls. OpenCode
 * keeps the conversations, so they are read from it, newest thread first, in the background, and the text is held in
 * memory only (never written to disk). A thread is read again when it has had activity since, so asking is cheap
 * once the threads are read. An answer has what is read so far; the renderer asks again until it is all read.
 */
export class InboxSearch {
  private readonly texts = new Map<string, ThreadText>()
  private reading = false

  constructor(private readonly dependencies: InboxSearchDependencies) {}

  search(request: ChatSearchRequest): ChatSearchResponse {
    if (!this.dependencies.enabled()) return { results: [], indexed: 0, total: 0, truncated: false }
    const threads = this.dependencies.store.list()
    const known = new Set(threads.map((thread) => thread.id))
    for (const id of this.texts.keys()) if (!known.has(id)) this.texts.delete(id)
    this.read(threads)

    const query = request.query.trim()
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
    return { results, indexed, total: threads.length, truncated }
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

  /** Reads the threads whose text is missing or stale, a few at a time, until none is; a second call while reading only adds to the work. */
  private read(threads: readonly InboxThread[]): void {
    if (this.reading || !threads.some((thread) => this.stale(thread))) return
    this.reading = true
    void (async () => {
      try {
        for (;;) {
          const queue = this.dependencies.store.list().filter((thread) => this.stale(thread))
          if (queue.length === 0) return
          await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
            for (let thread = queue.shift(); thread; thread = queue.shift()) await this.readThread(thread)
          }))
        }
      } finally {
        this.reading = false
      }
    })()
  }

  private async readThread(thread: InboxThread): Promise<void> {
    const stamp = thread.lastActivityAt
    try {
      this.texts.set(thread.id, { stamp, at: this.dependencies.now(), failed: false, entries: await this.readMessages(thread) })
    } catch {
      // The service may be down or the thread gone; what was read before stays searchable, and a retry comes later.
      const before = this.texts.get(thread.id)
      this.texts.set(thread.id, { stamp, at: this.dependencies.now(), failed: true, entries: before?.entries ?? [] })
    }
  }

  private async readMessages(thread: InboxThread): Promise<Entry[]> {
    // Pages come newest first; each is put in front of the ones read before it.
    let entries: Entry[] = []
    let size = 0
    let cursor: string | undefined
    let pageSize = PAGE_SIZE
    for (let pages = 0; pages < MAX_PAGES && size < MAX_THREAD_CHARS; pages += 1) {
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
      size += found.reduce((total, entry) => total + entry.text.length, 0)
      entries = [...found, ...entries]
      if (!page.older) break
      cursor = page.older
    }
    return entries
  }
}
