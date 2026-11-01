import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxThread } from '../src/shared/types'
import type { InboxFolder } from '../src/shared/types'
import {
  INBOX_MAX_FOLDERS,
  INBOX_MAX_THREADS,
  InboxStore,
  normalizeInboxFile,
  normalizeInboxFolders,
  validateComposer,
  validateInboxFolder,
  validateInboxThread
} from '../src/main/inbox/store'

const directories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(join(tmpdir(), 'mde-inbox-test-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one',
    title: 'Fix login',
    directory: '/home/me/app',
    target: { kind: 'wsl', distro: 'Ubuntu-24.04' },
    mdeSessionId: 'session-1',
    branch: 'main',
    model: { id: 'model-1', providerId: 'provider-1' },
    status: 'completed',
    createdAt: 100,
    lastActivityAt: 200,
    readAt: 0,
    archived: false,
    ...overrides
  }
}

describe('inbox thread validation', () => {
  it('keeps a well-formed thread and drops unknown fields', () => {
    expect(validateInboxThread({ ...thread(), prompt: 'private' })).toEqual(thread())
    expect(validateInboxThread(thread({ status: 'attention', attentionReason: 'question' })))
      .toMatchObject({ status: 'attention', attentionReason: 'question' })
    expect(validateInboxThread(thread({ branch: null, model: undefined, mdeSessionId: undefined })))
      .toMatchObject({ branch: null })
  })

  it('rejects malformed threads', () => {
    for (const bad of [
      thread({ id: 'not-a-session' }),
      thread({ title: '   ' }),
      thread({ title: 'bad\u0007title' }),
      thread({ directory: '' }),
      thread({ target: { kind: 'wsl', distro: '../escape' } }),
      thread({ status: 'unknown' as never }),
      thread({ status: 'attention' }),
      thread({ status: 'completed', attentionReason: 'permission' }),
      thread({ lastActivityAt: Number.NaN }),
      thread({ readAt: -1 }),
      thread({ archived: 'no' as never }),
      thread({ model: { id: '', providerId: 'provider' } }),
      null,
      []
    ]) {
      expect(validateInboxThread(bad)).toBeNull()
    }
  })

  it('normalizes the file: drops bad and duplicate records, settles working threads, sorts and caps', () => {
    const threads = normalizeInboxFile({
      version: 1,
      threads: [
        thread({ id: 'ses_old', lastActivityAt: 100 }),
        thread({ id: 'ses_busy', status: 'working', lastActivityAt: 300 }),
        thread({ id: 'ses_old', title: 'Duplicate', lastActivityAt: 900 }),
        { id: 'broken' }
      ]
    })
    expect(threads.map((item) => [item.id, item.status])).toEqual([
      ['ses_busy', 'idle'],
      ['ses_old', 'completed']
    ])
    expect(normalizeInboxFile({ threads: 'nope' })).toEqual([])
    expect(normalizeInboxFile(null)).toEqual([])

    const many = Array.from({ length: INBOX_MAX_THREADS + 5 }, (_, index) =>
      thread({ id: `ses_${index}`, lastActivityAt: index }))
    const capped = normalizeInboxFile({ threads: many })
    expect(capped).toHaveLength(INBOX_MAX_THREADS)
    expect(capped[0]?.id).toBe(`ses_${INBOX_MAX_THREADS + 4}`)
  })
})

describe('inbox store', () => {
  it('starts empty without a file or with invalid JSON', async () => {
    const directory = await temporaryDirectory()
    const store = new InboxStore(join(directory, 'inbox.json'))
    await store.load()
    expect(store.list()).toEqual([])

    await fs.writeFile(join(directory, 'inbox.json'), '{not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await store.load()
    expect(store.list()).toEqual([])
    warn.mockRestore()
  })

  it('debounces writes and saves atomically in the stored order', async () => {
    const directory = await temporaryDirectory()
    const file = join(directory, 'inbox.json')
    const writeFile = vi.fn(async () => {})
    const store = new InboxStore(file, { writeFile, writeDelayMs: 60_000 })
    store.put(thread({ id: 'ses_a', lastActivityAt: 1 }))
    store.put(thread({ id: 'ses_b', lastActivityAt: 2 }))
    expect(writeFile).not.toHaveBeenCalled()
    await store.flush()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith(file, {
      version: 2,
      threads: [expect.objectContaining({ id: 'ses_b' }), expect.objectContaining({ id: 'ses_a' })],
      folders: [],
      composer: {}
    })
    await store.flush()
    expect(writeFile).toHaveBeenCalledTimes(1)
  })

  it('round-trips through the real file and leaves no temporary files behind', async () => {
    const directory = await temporaryDirectory()
    const file = join(directory, 'inbox.json')
    const store = new InboxStore(file)
    store.put(thread())
    store.put(thread({ id: 'ses_two', status: 'working', lastActivityAt: 50 }))
    expect(store.remove('ses_missing')).toBe(false)
    await store.flush()
    expect(await fs.readdir(directory)).toEqual(['inbox.json'])

    const reloaded = new InboxStore(file)
    await reloaded.load()
    expect(reloaded.list()).toEqual([thread(), thread({ id: 'ses_two', status: 'idle', lastActivityAt: 50 })])
  })

  it('drops the oldest threads beyond the cap', () => {
    const store = new InboxStore('/unused', { writeFile: async () => {}, writeDelayMs: 60_000 })
    for (let index = 0; index <= INBOX_MAX_THREADS; index += 1) {
      store.put(thread({ id: `ses_${index}`, lastActivityAt: index + 1 }))
    }
    expect(store.list()).toHaveLength(INBOX_MAX_THREADS)
    expect(store.get('ses_0')).toBeUndefined()
    void store.flush()
  })
})

function folder(overrides: Partial<InboxFolder> = {}): InboxFolder {
  return {
    id: 'fld_one',
    name: 'app',
    directory: '/home/me/app',
    target: { kind: 'wsl', distro: 'Ubuntu-24.04' },
    createdAt: 1,
    lastUsedAt: 2,
    ...overrides
  }
}

describe('inbox folders', () => {
  it('validates folders and composer choices', () => {
    expect(validateInboxFolder({ ...folder(), extra: true })).toEqual(folder())
    for (const bad of [
      folder({ id: 'one' }),
      folder({ id: 'fld_../x' }),
      folder({ name: '' }),
      folder({ directory: 'x'.repeat(5000) }),
      folder({ target: { kind: 'wsl', distro: '' } }),
      folder({ lastUsedAt: -1 })
    ]) {
      expect(validateInboxFolder(bad)).toBeNull()
    }
    expect(validateComposer({ folderId: 'fld_one', agent: 'plan', model: { id: 'm', providerId: 'p' }, other: 1 }))
      .toEqual({ folderId: 'fld_one', agent: 'plan', model: { id: 'm', providerId: 'p' } })
    expect(validateComposer({ folderId: 'nope', agent: '../x', model: { id: '' } })).toEqual({})
    expect(validateComposer(null)).toEqual({})
  })

  it('accepts chat threads and rejects a bad origin or folder', () => {
    expect(validateInboxThread(thread({ origin: 'chat', folderId: 'fld_one' })))
      .toMatchObject({ origin: 'chat', folderId: 'fld_one' })
    expect(validateInboxThread(thread({ origin: 'mail' as never }))).toBeNull()
    expect(validateInboxThread(thread({ folderId: 'one' }))).toBeNull()
  })

  it('migrates a version 1 file to no folders, and sorts and caps version 2 folders', () => {
    expect(normalizeInboxFolders({ version: 1, threads: [] })).toEqual([])
    const many = Array.from({ length: INBOX_MAX_FOLDERS + 3 }, (_, index) =>
      folder({ id: `fld_${index}`, lastUsedAt: index }))
    const folders = normalizeInboxFolders({ version: 2, folders: [...many, folder({ id: 'fld_0', name: 'Duplicate' })] })
    expect(folders).toHaveLength(INBOX_MAX_FOLDERS)
    expect(folders[0]?.id).toBe(`fld_${INBOX_MAX_FOLDERS + 2}`)
  })

  it('round-trips folders and the composer, and forgets a composer folder that was removed', async () => {
    const directory = await temporaryDirectory()
    const file = join(directory, 'inbox.json')
    await fs.writeFile(file, JSON.stringify({ version: 1, threads: [thread()] }))
    const store = new InboxStore(file)
    await store.load()
    expect(store.list()).toEqual([thread()])
    expect(store.folders()).toEqual([])
    store.putFolder(folder())
    store.putFolder(folder({ id: 'fld_two', name: 'api', lastUsedAt: 5 }))
    store.setComposer({ folderId: 'fld_one', agent: 'plan' })
    await store.flush()

    const reloaded = new InboxStore(file)
    await reloaded.load()
    expect(reloaded.folders().map((item) => item.id)).toEqual(['fld_two', 'fld_one'])
    expect(reloaded.composer()).toEqual({ folderId: 'fld_one', agent: 'plan' })
    expect(reloaded.removeFolder('fld_one')).toBe(true)
    expect(reloaded.composer()).toEqual({ agent: 'plan' })
    await reloaded.flush()

    await fs.writeFile(file, JSON.stringify({ version: 2, threads: [], folders: [], composer: { folderId: 'fld_gone' } }))
    await reloaded.load()
    expect(reloaded.composer()).toEqual({})
  })
})
