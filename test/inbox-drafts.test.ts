import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InboxDraftStore, ATTACHMENT_LIMIT } from '../src/main/inbox/drafts'

const directories: string[] = []
afterEach(async () => { for (const path of directories.splice(0)) await fs.rm(path, { recursive: true, force: true }) })
async function setup() {
  const path = await fs.mkdtemp(join(tmpdir(), 'mde-drafts-test-'))
  directories.push(path)
  return { path, store: new InboxDraftStore(path, () => 'data:image/png;base64,eA==') }
}
const key = 'folder:fld_one' as const

describe('Inbox saved drafts', () => {
  it('restores copied contents and text after restarting, independently of the original', async () => {
    const { path, store } = await setup()
    const bytes = new Uint8Array([1, 2, 3])
    await store.text(key, 'Explain this')
    await store.add(key, 'screenshot.png', 'image/png', bytes)
    bytes.fill(0)
    const restarted = new InboxDraftStore(path)
    const draft = await restarted.get(key)
    expect(draft.text).toBe('Explain this')
    expect(draft.attachments[0]).toMatchObject({ name: 'screenshot.png', size: 3 })
    expect(await restarted.files(key, [draft.attachments[0]!.id], draft.revision)).toEqual([{ name: 'screenshot.png', uri: 'data:application/octet-stream;base64,AQID' }])
  })

  it('puts text above the draft in one step, and leaves an empty or oversized addition alone', async () => {
    const { path, store } = await setup()
    await store.prepend(key, 'Restored message')
    expect((await store.get(key)).text).toBe('Restored message')
    const first = await store.get(key)
    await store.text(key, 'Something I was typing')
    await store.prepend(key, 'Second restored')
    expect((await store.get(key)).text).toBe('Second restored\n\nSomething I was typing')
    expect((await store.get(key)).revision).toBeGreaterThan(first.revision)
    // Blank text changes nothing, not even the revision a send is checked against.
    const before = await store.get(key)
    await store.prepend(key, '  \n ')
    expect(await store.get(key)).toEqual(before)
    // A draft that would pass the limit stays as it was.
    await expect(store.prepend(key, 'x'.repeat(100_000))).rejects.toThrow('too long')
    expect(await store.get(key)).toEqual(before)
    // And what was written survives a restart.
    expect((await new InboxDraftStore(path).get(key)).text).toBe('Second restored\n\nSomething I was typing')
  })

  it('puts text above the newest text, including a keystroke saved a moment before', async () => {
    const { store } = await setup()
    await store.text(key, 'typed')
    // Neither call has finished when the other is made, as when typing and a revert overlap.
    const typed = store.text(key, 'typed more')
    const added = store.prepend(key, 'Restored')
    await Promise.all([typed, added])
    expect((await store.get(key)).text).toBe('Restored\n\ntyped more')
  })

  it('rejects stale revisions and attachments from another draft', async () => {
    const { store } = await setup()
    await store.add(key, 'file.bin', 'application/octet-stream', new Uint8Array([4]))
    const draft = await store.get(key)
    await expect(store.files('thread:ses_other', [draft.attachments[0]!.id], draft.revision)).rejects.toThrow('draft changed')
    await store.text(key, 'newer edit')
    await store.remove(key, undefined, draft.revision)
    expect((await store.get(key)).text).toBe('newer edit')
    await expect(store.files(key, [draft.attachments[0]!.id], draft.revision)).rejects.toThrow('draft changed')
  })

  it('moves a new-chat draft into its created thread and cleans copies on successful send', async () => {
    const { path, store } = await setup()
    await store.add(key, 'file.txt', 'text/plain', new Uint8Array([4]))
    await store.move(key, 'thread:ses_new')
    expect((await store.get(key)).attachments).toEqual([])
    const draft = await store.get('thread:ses_new')
    await store.remove('thread:ses_new', undefined, draft.revision)
    expect(await fs.readdir(join(path, 'attachments'))).toEqual([])
  })

  it('keeps a missing attachment visible and reports it when sending', async () => {
    const { path, store } = await setup()
    await store.add(key, 'gone.txt', 'text/plain', new Uint8Array([1]))
    const draft = await store.get(key)
    await fs.unlink(join(path, 'attachments', draft.attachments[0]!.id))
    expect((await new InboxDraftStore(path).get(key)).attachments).toHaveLength(1)
    await expect(store.files(key, [draft.attachments[0]!.id], draft.revision)).rejects.toThrow('missing')
  })

  it('enforces combined size and count without dropping accepted files', async () => {
    const { store } = await setup()
    await store.add(key, 'large', 'application/octet-stream', new Uint8Array(ATTACHMENT_LIMIT))
    await expect(store.add(key, 'extra', 'text/plain', new Uint8Array([1]))).rejects.toThrow('20 MiB')
    expect((await store.get(key)).attachments).toHaveLength(1)
    for (let index = 0; index < 10; index++) await store.add('thread:ses_count', 'empty', 'text/plain', new Uint8Array())
    await expect(store.add('thread:ses_count', 'extra', 'text/plain', new Uint8Array())).rejects.toThrow('10 files')
  })

  it('prunes orphaned copies and removed owners, but preserves corrupt storage for recovery', async () => {
    const { path, store } = await setup()
    await store.add(key, 'copy', 'text/plain', new Uint8Array([1]))
    await new InboxDraftStore(path, undefined, () => false).get(key)
    expect(await fs.readdir(join(path, 'attachments'))).toEqual([])
    await fs.writeFile(join(path, 'index.json'), '{broken')
    await expect(new InboxDraftStore(path).get(key)).rejects.toThrow('saved files have been kept')
    expect(await fs.readFile(join(path, 'index.json'), 'utf8')).toBe('{broken')
  })
})
