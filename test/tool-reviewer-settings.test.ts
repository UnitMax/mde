import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolReviewerSettingsStore, type KeyCipher } from '../src/main/inbox/tool-reviewer-settings'

/** Stands in for safeStorage: reversible, but nothing like the clear text. */
const cipher = (available = true): KeyCipher => ({
  available: () => available,
  encrypt: (text) => Buffer.from(`enc:${[...text].reverse().join('')}`),
  decrypt: (data) => {
    const text = data.toString()
    if (!text.startsWith('enc:')) throw new Error('not ours')
    return [...text.slice(4)].reverse().join('')
  },
})

const folders: string[] = []
async function file(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'mde-reviewer-'))
  folders.push(folder)
  return join(folder, 'tool-reviewer.json')
}
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

describe('tool reviewer settings', () => {
  it('starts switched off', async () => {
    const store = new ToolReviewerSettingsStore(await file(), cipher())
    await expect(store.get()).resolves.toEqual({ baseUrl: '', model: '', askMediumRisk: true, hasKey: false })
    await expect(store.endpoint()).resolves.toBeNull()
  })

  it('keeps the key only encrypted, tells the page only that there is one, and hands it to a review', async () => {
    const path = await file()
    const store = new ToolReviewerSettingsStore(path, cipher())
    const saved = await store.save({ baseUrl: ' https://openrouter.ai/api/v1 ', model: 'vendor/model:free', askMediumRisk: false, key: 'sk-secret-123' })
    expect(saved).toEqual({ baseUrl: 'https://openrouter.ai/api/v1', model: 'vendor/model:free', askMediumRisk: false, hasKey: true })
    const written = await readFile(path, 'utf8')
    expect(written).not.toContain('sk-secret-123')
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    // A fresh store reads it back from the file.
    const again = new ToolReviewerSettingsStore(path, cipher())
    await expect(again.endpoint()).resolves.toEqual({ baseUrl: 'https://openrouter.ai/api/v1', model: 'vendor/model:free', askMediumRisk: false, key: 'sk-secret-123' })
  })

  it('keeps the key when it is left out, and removes it when asked', async () => {
    const store = new ToolReviewerSettingsStore(await file(), cipher())
    await store.save({ baseUrl: 'https://r.example/v1', model: 'm', askMediumRisk: true, key: 'sk-1' })
    await store.save({ baseUrl: 'https://r.example/v2', model: 'm', askMediumRisk: true })
    await expect(store.endpoint()).resolves.toMatchObject({ baseUrl: 'https://r.example/v2', key: 'sk-1' })
    await expect(store.save({ baseUrl: 'https://r.example/v2', model: 'm', askMediumRisk: true, key: null })).resolves.toMatchObject({ hasKey: false })
    await expect(store.endpoint()).resolves.not.toHaveProperty('key')
  })

  it('refuses a key it cannot encrypt, and settings it cannot use', async () => {
    const store = new ToolReviewerSettingsStore(await file(), cipher(false))
    await expect(store.save({ baseUrl: 'https://r.example/v1', model: 'm', askMediumRisk: true, key: 'sk-1' })).rejects.toThrow('encrypted')
    await expect(store.save({ baseUrl: 'http://r.example/v1', model: 'm', askMediumRisk: true })).rejects.toThrow('https')
    await expect(store.save({ baseUrl: 'https://r.example/v1', model: '', askMediumRisk: true })).rejects.toThrow('model')
    await expect(store.save({ baseUrl: 'https://r.example/v1', model: 'm', askMediumRisk: true, key: 'two words' })).rejects.toThrow('API key')
  })

  it('counts a key it cannot decrypt as no reviewer', async () => {
    const path = await file()
    await new ToolReviewerSettingsStore(path, cipher()).save({ baseUrl: 'https://r.example/v1', model: 'm', askMediumRisk: true, key: 'sk-1' })
    const other: KeyCipher = { ...cipher(), decrypt: () => { throw new Error('another user') } }
    await expect(new ToolReviewerSettingsStore(path, other).endpoint()).resolves.toBeNull()
  })
})
