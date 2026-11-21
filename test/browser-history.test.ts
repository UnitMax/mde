import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserHistory } from '../src/main/browser-history'
import { BROWSER_HISTORY_LIMIT, matchBrowserHistory, type BrowserHistoryEntry } from '../src/shared/browser'

let dir: string
let file: string
let clock: number

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mde-browser-history-'))
  file = join(dir, 'browser-history.json')
  clock = 1000
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

const make = (): BrowserHistory => new BrowserHistory(file, () => clock++)

describe('BrowserHistory', () => {
  it('keeps each page once, newest first, with the title it last had', async () => {
    const history = make()
    await history.load()
    history.visit('http://localhost:3000/', 'http://localhost:3000/')
    history.retitle('http://localhost:3000/', 'App')
    history.visit('http://localhost:3000/settings', 'App')
    history.visit('http://localhost:3000/', '')
    expect(history.list()).toEqual([
      { url: 'http://localhost:3000/', title: 'App', visitedAt: 1002 },
      { url: 'http://localhost:3000/settings', title: 'App', visitedAt: 1001 },
    ])
    // Not a web page, or not the address the browser would open: not kept.
    history.visit('about:blank', '')
    history.visit('data:text/html,hi', '')
    history.visit('http://localhost:3000', '')
    expect(history.list()).toHaveLength(2)
  })

  it('writes a burst of changes once, reads it back and drops what is not a web page', async () => {
    vi.useFakeTimers()
    const history = make()
    await history.load()
    history.visit('http://localhost:3000/', 'App')
    history.visit('http://localhost:4000/', 'Docs')
    await vi.advanceTimersByTimeAsync(1000)
    vi.useRealTimers()
    await history.flush()
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved.entries.map((entry: BrowserHistoryEntry) => entry.url)).toEqual(['http://localhost:4000/', 'http://localhost:3000/'])
    saved.entries.push({ url: 'file:///etc/passwd', title: 'x', visitedAt: 1 }, { url: 'http://localhost:3000/', title: 'twice', visitedAt: 1 }, 'junk')
    await writeFile(file, JSON.stringify(saved))
    const again = make()
    await again.load()
    expect(again.list().map((entry) => entry.title)).toEqual(['Docs', 'App'])
  })

  it('writes a waiting change on flush, and keeps at most the limit', async () => {
    const history = make()
    await history.load()
    for (let index = 0; index <= BROWSER_HISTORY_LIMIT; index += 1) history.visit(`http://localhost:3000/${index}`, '')
    await history.flush()
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved.entries).toHaveLength(BROWSER_HISTORY_LIMIT)
    expect(saved.entries[0].url).toBe(`http://localhost:3000/${BROWSER_HISTORY_LIMIT}`)
  })

  it('clears every page and removes the file, also when a write was still waiting', async () => {
    const history = make()
    await history.load()
    history.visit('http://localhost:3000/', 'App')
    await history.flush()
    history.visit('http://localhost:4000/', 'Docs')
    await history.clear()
    expect(history.list()).toEqual([])
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    // Nothing waiting is written back afterwards.
    await history.flush()
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await history.clear()
  })
})

describe('matchBrowserHistory', () => {
  const entries: BrowserHistoryEntry[] = [
    { url: 'http://localhost:5173/login', title: 'Sign in', visitedAt: 3 },
    { url: 'http://localhost:3000/', title: 'Dashboard', visitedAt: 2 },
    { url: 'https://gitlab.test/group/app', title: 'App · GitLab', visitedAt: 1 },
  ]
  it('matches every word in the address or the title, ignoring case, in history order', () => {
    expect(matchBrowserHistory(entries, '', 10)).toEqual(entries)
    expect(matchBrowserHistory(entries, 'LOCALHOST', 10).map((entry) => entry.visitedAt)).toEqual([3, 2])
    expect(matchBrowserHistory(entries, 'gitlab app', 10)).toEqual([entries[2]])
    expect(matchBrowserHistory(entries, 'sign 3000', 10)).toEqual([])
    expect(matchBrowserHistory(entries, '', 1)).toEqual([entries[0]])
  })
})
