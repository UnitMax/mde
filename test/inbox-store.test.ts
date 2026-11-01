import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxThread } from '../src/shared/types'
import {
  INBOX_MAX_THREADS,
  InboxStore,
  normalizeInboxFile,
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
      version: 1,
      threads: [expect.objectContaining({ id: 'ses_b' }), expect.objectContaining({ id: 'ses_a' })]
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
