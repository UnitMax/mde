import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Session } from '../src/shared/types'
import { inboxTerminalSession } from '../src/shared/inbox-terminal'
import { TerminalDirectoryStore, TERMINAL_DIRECTORIES_FILE } from '../src/main/pty/directories'

const session: Session = {
  id: 'session-1', name: 'Work', kind: 'native', createdAt: '',
}
let directory: string
const stores: TerminalDirectoryStore[] = []

async function open(): Promise<TerminalDirectoryStore> {
  const store = new TerminalDirectoryStore()
  stores.push(store)
  await store.configure(directory)
  return store
}

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'mde-terminal-directories-'))
})

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.flush()))
  await fs.rm(directory, { recursive: true, force: true })
})

describe('saved terminal directories', () => {
  it('restores separate pane directories across application runs', async () => {
    const first = await open()
    first.remember('pane-a', session, join(directory, 'folder with spaces'))
    first.remember('pane-b', session, join(directory, 'other'))
    first.remember('pane-a', session, join(directory, 'most recent'))
    await first.flush()

    const nextRun = await open()
    expect(nextRun.get('pane-a', session)).toBe(join(directory, 'most recent'))
    expect(nextRun.get('pane-b', session)).toBe(join(directory, 'other'))
    expect(nextRun.get('new-pane', session)).toBeUndefined()
    const stored = JSON.parse(await fs.readFile(join(directory, TERMINAL_DIRECTORIES_FILE), 'utf8'))
    expect(Object.keys(stored.terminals[0]).sort()).toEqual(['directory', 'kind', 'sessionId', 'terminalId'])
  })

  it('keeps the shared Inbox terminal directory under its stable identity', async () => {
    const inbox = inboxTerminalSession('darwin', [])!
    const pane = `${inbox.id}:tab:default:pane:1`
    const store = await open()
    store.remember(pane, inbox, directory)
    await store.flush()
    expect((await open()).get(pane, inboxTerminalSession('darwin', [])!)).toBe(directory)
  })

  it('does not share directories between owners, native targets or WSL distros', async () => {
    const store = await open()
    const wsl = { ...session, kind: 'wsl' as const, distro: 'Ubuntu-24.04' }
    store.remember('pane', wsl, '/home/me/project')
    expect(store.get('pane', wsl)).toBe('/home/me/project')
    expect(store.get('pane', { ...wsl, id: 'other-session' })).toBeUndefined()
    expect(store.get('pane', { ...wsl, distro: 'Debian' })).toBeUndefined()
    expect(store.get('pane', session)).toBeUndefined()
  })

  it('forgets removed panes and sessions even when their terminals are not running', async () => {
    const store = await open()
    store.remember('pane-a', session, directory)
    store.remember('pane-b', session, directory)
    store.remember('pane-c', { ...session, id: 'other' }, directory)
    store.forget('pane-a')
    store.forgetSession(session.id)
    await store.flush()
    const nextRun = await open()
    expect(nextRun.get('pane-a', session)).toBeUndefined()
    expect(nextRun.get('pane-b', session)).toBeUndefined()
    expect(nextRun.get('pane-c', { ...session, id: 'other' })).toBe(directory)
  })

  it('flushes the newest records when directories change during an earlier save', async () => {
    const store = await open()
    store.remember('pane', session, directory)
    const pending = store.flush()
    store.remember('pane', session, join(directory, 'newest'))
    await Promise.all([pending, store.flush()])
    expect((await open()).get('pane', session)).toBe(join(directory, 'newest'))
  })

  it('ignores corrupt records and never treats relative or control-containing paths as saved directories', async () => {
    const entry = { terminalId: 'pane', sessionId: session.id, kind: 'native', directory }
    await fs.writeFile(join(directory, TERMINAL_DIRECTORIES_FILE), JSON.stringify({ terminals: [
      null, { ...entry, terminalId: 'relative', directory: '../relative' },
      { ...entry, terminalId: 'control', directory: '/tmp/line\nfeed' },
      { ...entry, terminalId: 'x'.repeat(2049) }, entry,
    ] }))
    const store = await open()
    expect(store.get('pane', session)).toBe(directory)
    expect(store.get('relative', session)).toBeUndefined()
    expect(store.get('control', session)).toBeUndefined()
    await fs.writeFile(join(directory, TERMINAL_DIRECTORIES_FILE), 'invalid JSON')
    expect((await open()).get('pane', session)).toBeUndefined()
  })

  it('leaves Inbox conversation terminal directories to the recorded API thread', async () => {
    const store = await open()
    const thread = { ...session, id: 'inbox-thread:ses_one' }
    store.remember(thread.id, thread, directory)
    expect(store.get(thread.id, thread)).toBeUndefined()
  })
})
