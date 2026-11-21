import { promises as fs } from 'node:fs'
import {
  BROWSER_HISTORY_LIMIT,
  BROWSER_HISTORY_TITLE_LIMIT,
  browserUrl,
  type BrowserHistoryEntry,
} from '@shared/browser'
import { writeJsonAtomic } from './store/atomic-json'

export const BROWSER_HISTORY_FILE = 'browser-history.json'

/** How long a change waits before it is written, so a burst of page loads is one write. */
const WRITE_DELAY_MS = 1000

const title = (value: string): string => value.trim().slice(0, BROWSER_HISTORY_TITLE_LIMIT)

/**
 * The pages opened in the MDE browser, newest first and once per address, kept in `browser-history.json` so the
 * address field can offer them again. Clearing the browsing data clears it and removes the file.
 */
export class BrowserHistory {
  private entries: BrowserHistoryEntry[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  /** The write under way; writes and the removal run one after another. */
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Reads the history; a missing or unreadable file is an empty one, and entries that are not web pages are dropped. */
  async load(): Promise<void> {
    this.entries = []
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as { entries?: unknown }
      const seen = new Set<string>()
      for (const item of Array.isArray(raw.entries) ? raw.entries : []) {
        if (!item || typeof item !== 'object') continue
        const { url, title: name, visitedAt } = item as Record<string, unknown>
        if (typeof url !== 'string' || browserUrl(url) !== url || seen.has(url)) continue
        seen.add(url)
        this.entries.push({
          url,
          title: typeof name === 'string' ? title(name) : '',
          visitedAt: typeof visitedAt === 'number' && Number.isFinite(visitedAt) ? visitedAt : 0,
        })
        if (this.entries.length >= BROWSER_HISTORY_LIMIT) break
      }
    } catch {
      this.entries = []
    }
  }

  list(): BrowserHistoryEntry[] {
    return this.entries.map((entry) => ({ ...entry }))
  }

  /** A page was opened: it moves to the top, with the title it has so far. Only http and https pages are kept. */
  visit(url: string, name: string): void {
    if (browserUrl(url) !== url) return
    const earlier = this.entries.find((entry) => entry.url === url)
    // Chromium gives the address as the title of a page that has none (yet).
    const given = name === url ? '' : title(name)
    const entry = { url, title: given || earlier?.title || '', visitedAt: this.now() }
    this.entries = [entry, ...this.entries.filter((item) => item.url !== url)].slice(0, BROWSER_HISTORY_LIMIT)
    this.schedule()
  }

  /** A page's title arrived or changed. */
  retitle(url: string, name: string): void {
    const entry = this.entries.find((item) => item.url === url)
    const next = name === url ? '' : title(name)
    if (!entry || !next || entry.title === next) return
    entry.title = next
    this.schedule()
  }

  /** Forgets every page and removes the file, after any write under way. */
  async clear(): Promise<void> {
    this.entries = []
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const removal = this.writing.catch(() => undefined).then(() => fs.rm(this.file, { force: true }))
    this.writing = removal
    await removal
  }

  /** Writes a change that is still waiting, now; for quitting. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
      this.write()
    }
    await this.writing.catch(() => undefined)
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.write()
    }, WRITE_DELAY_MS)
  }

  private write(): void {
    // Each write takes the entries in force when its turn comes.
    this.writing = this.writing.catch(() => undefined).then(() =>
      writeJsonAtomic(this.file, { version: 1, entries: this.entries }),
    )
    // A failed write is tried again with the next change.
    this.writing.catch(() => undefined)
  }
}
