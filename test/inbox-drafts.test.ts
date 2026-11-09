import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InboxDraftStore, ATTACHMENT_LIMIT, DRAFT_PREVIEW_LIMIT } from '../src/main/inbox/drafts'

const directories: string[] = []
afterEach(async () => { for (const path of directories.splice(0)) await fs.rm(path, { recursive: true, force: true }) })
/** `clock.now` is what the store takes for the time; tests move it by hand. */
const clock = { now: 1_000 }
async function setup() {
  const path = await fs.mkdtemp(join(tmpdir(), 'mde-drafts-test-'))
  directories.push(path)
  return { path, store: new InboxDraftStore(path, () => 'data:image/png;base64,eA==', undefined, () => clock.now) }
}
const key = 'thread:ses_one' as const
/** A new thread that was started and not sent. */
const draftKey = 'draft:drf_one' as const
const folder = { folderId: 'fld_one' }

describe('Inbox saved drafts', () => {
  it('keeps typing in memory and writes it only when asked to save, or once typing has paused', async () => {
    const path = await fs.mkdtemp(join(tmpdir(), 'mde-drafts-test-'))
    directories.push(path)
    const store = new InboxDraftStore(path, undefined, undefined, undefined, 30)
    await store.text(key, 'First words')
    await store.text(key, 'First words, and more')
    expect((await store.get(key)).text).toBe('First words, and more')
    await expect(fs.access(join(path, 'index.json'))).rejects.toThrow()
    await store.save()
    expect((await new InboxDraftStore(path).get(key)).text).toBe('First words, and more')
    // Left alone, the newest text reaches the disk by itself.
    await store.text(key, 'Typed and left')
    await vi.waitFor(async () => expect((await new InboxDraftStore(path).get(key)).text).toBe('Typed and left'))
    // The index is replaced, not added to: no temporary file stays behind.
    expect((await fs.readdir(path)).sort()).toEqual(['attachments', 'index.json'])
  })

  it('does not fail a change when the index cannot be written, and writes it the next time', async () => {
    const { path, store } = await setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await store.text(key, 'Kept')
      await store.save()
      // A directory in the way of the index is a rename that cannot succeed.
      await fs.rm(join(path, 'index.json'))
      await fs.mkdir(join(path, 'index.json', 'blocked'), { recursive: true })
      await store.text(key, 'Kept and changed')
      await store.add(key, 'note.txt', 'text/plain', new Uint8Array([1]))
      await store.save()
      await store.save()
      expect((await store.get(key)).text).toBe('Kept and changed')
      expect((await store.get(key)).attachments).toHaveLength(1)
      // Said once, with no path in it.
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]![0])).not.toContain(path)
      await fs.rm(join(path, 'index.json'), { recursive: true })
      await store.flush()
      const restored = await new InboxDraftStore(path).get(key)
      expect(restored.text).toBe('Kept and changed')
      expect(restored.attachments).toHaveLength(1)
    } finally { warn.mockRestore() }
  })

  it('restores a new thread draft with its chosen chat interface', async () => {
    const { path, store } = await setup()
    await store.text(draftKey, 'Review this', { ...folder, choice: { mode: 'terminal', agent: 'plan', model: { id: 'm', providerId: 'p' } } })
    await store.save()
    const restarted = new InboxDraftStore(path)
    expect((await restarted.list())[0]?.choice).toMatchObject({ mode: 'terminal', agent: 'plan' })
    await restarted.setMeta(draftKey, { ...folder, choice: { mode: 'gui', agent: 'plan' } })
    expect((await new InboxDraftStore(path).list())[0]?.choice).toEqual({ mode: 'gui', agent: 'plan' })
  })

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
    await store.add(draftKey, 'file.txt', 'text/plain', new Uint8Array([4]), folder)
    await store.move(draftKey, 'thread:ses_new')
    expect((await store.get(draftKey)).attachments).toEqual([])
    expect(await store.list()).toEqual([])
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

describe('Inbox new-thread drafts', () => {
  const other = 'draft:drf_two' as const
  const third = 'draft:drf_three' as const

  it('lists the new threads that hold something, the newest change first, with what a row shows', async () => {
    const { store } = await setup()
    clock.now = 1_000
    await store.text(draftKey, '\n  Fix the login redirect\nthen add a test', folder)
    clock.now = 2_000
    await store.add(other, 'screen.png', 'image/png', new Uint8Array([1]), { folderId: 'fld_two' })
    await store.add(other, 'second.png', 'image/png', new Uint8Array([2]), { folderId: 'fld_two' })
    // A thread's own draft is not a new thread, however much it holds.
    await store.text(key, 'A follow-up I was typing')
    expect(await store.list()).toEqual([
      { id: 'drf_two', folderId: 'fld_two', preview: '', attachments: 2, attachmentName: 'screen.png', updatedAt: 2_000 },
      { id: 'drf_one', folderId: 'fld_one', preview: 'Fix the login redirect\nthen add a test', attachments: 0, updatedAt: 1_000 },
    ])
    // Changing the older one puts it first.
    clock.now = 3_000
    await store.text(draftKey, 'Fix the login redirect, and add a test', folder)
    expect((await store.list()).map((draft) => draft.id)).toEqual(['drf_one', 'drf_two'])
  })

  it('sends only the start of a long text to the list', async () => {
    const { store } = await setup()
    await store.text(draftKey, 'x'.repeat(DRAFT_PREVIEW_LIMIT + 500), folder)
    expect((await store.list())[0]!.preview).toHaveLength(DRAFT_PREVIEW_LIMIT)
    // The draft itself is whole.
    expect((await store.get(draftKey)).text).toHaveLength(DRAFT_PREVIEW_LIMIT + 500)
  })

  it('does not keep a new thread that was emptied, or one that never had a word', async () => {
    const { path, store } = await setup()
    await store.text(draftKey, '', folder)
    expect(await store.list()).toEqual([])
    // Nothing was kept, so there is nothing to write either.
    await store.save()
    await expect(fs.access(join(path, 'index.json'))).rejects.toThrow()
    await store.text(draftKey, 'Something', folder)
    await store.text(draftKey, '   \n', folder)
    expect(await store.list()).toEqual([])
    await store.save()
    expect(JSON.parse(await fs.readFile(join(path, 'index.json'), 'utf8')).drafts).toEqual({})
    // Taking the last file off leaves it empty too, and the copy goes.
    await store.add(draftKey, 'a.txt', 'text/plain', new Uint8Array([1]), folder)
    const { attachments } = await store.get(draftKey)
    await store.remove(draftKey, attachments[0]!.id)
    expect(await store.list()).toEqual([])
    expect(await fs.readdir(join(path, 'attachments'))).toEqual([])
    // A thread's draft is not given the same treatment: it keeps its revision count.
    await store.text(key, '')
    expect((await store.get(key)).revision).toBe(1)
  })

  it('remembers the folder and the time through a restart, and gives the composer only the draft', async () => {
    const { path, store } = await setup()
    clock.now = 5_000
    await store.text(draftKey, 'Carry on', folder)
    expect(await store.get(draftKey)).toEqual({ revision: 1, text: 'Carry on', attachments: [] })
    await store.save()
    const restarted = new InboxDraftStore(path, undefined, undefined, () => 9_000)
    expect(await restarted.list()).toEqual([{ id: 'drf_one', folderId: 'fld_one', preview: 'Carry on', attachments: 0, updatedAt: 5_000 }])
  })

  it('moves a draft to another folder, and leaves a missing one or one already there alone', async () => {
    const { path, store } = await setup()
    clock.now = 1_000
    await store.setMeta(draftKey, { folderId: 'fld_two' })
    expect(await store.list()).toEqual([])
    await store.text(draftKey, 'Hello', folder)
    clock.now = 2_000
    await store.setMeta(draftKey, { folderId: 'fld_one' })
    expect((await store.list())[0]).toMatchObject({ folderId: 'fld_one', updatedAt: 1_000 })
    await store.setMeta(draftKey, { folderId: 'fld_two' })
    expect((await store.list())[0]).toMatchObject({ folderId: 'fld_two', updatedAt: 2_000 })
    expect((await new InboxDraftStore(path).list())[0]).toMatchObject({ folderId: 'fld_two' })
    // A thread's draft has no folder to move.
    await store.text(key, 'Hi')
    await store.setMeta(key, { folderId: 'fld_two' })
    await store.save()
    expect(JSON.parse(await fs.readFile(join(path, 'index.json'), 'utf8')).drafts[key]).not.toHaveProperty('folderId')
  })

  it('keeps a draft whose folder has gone, since its owner is not a place any more', async () => {
    const { path, store } = await setup()
    await store.text(draftKey, 'Still mine', folder)
    const asked: string[] = []
    await store.save()
    const restarted = new InboxDraftStore(path, undefined, (owner) => { asked.push(owner); return !owner.startsWith('thread:') })
    expect((await restarted.list()).map((draft) => draft.id)).toEqual(['drf_one'])
    expect(asked).toEqual(['draft:drf_one'])
  })

  it('lists the one draft a folder used to have as a new thread of its own, and drops an empty one', async () => {
    const { path, store } = await setup()
    await store.add('thread:ses_one', 'kept.txt', 'text/plain', new Uint8Array([7]))
    const { attachments } = await store.get('thread:ses_one')
    await store.save()
    const index = JSON.parse(await fs.readFile(join(path, 'index.json'), 'utf8'))
    index.drafts['folder:fld_old'] = { revision: 3, text: 'Written before drafts were listed', attachments }
    index.drafts['folder:fld_blank'] = { revision: 1, text: '  ', attachments: [] }
    delete index.drafts['thread:ses_one']
    await fs.writeFile(join(path, 'index.json'), JSON.stringify(index))
    const restarted = new InboxDraftStore(path, undefined, undefined, () => 7_000)
    const [converted, ...rest] = await restarted.list()
    expect(rest).toEqual([])
    expect(converted).toMatchObject({ folderId: 'fld_old', preview: 'Written before drafts were listed', attachments: 1, updatedAt: 7_000 })
    // Its file is still there, and the old key is gone from storage.
    expect(await fs.readdir(join(path, 'attachments'))).toEqual([attachments[0]!.id])
    expect(Object.keys(JSON.parse(await fs.readFile(join(path, 'index.json'), 'utf8')).drafts)).toEqual([`draft:${converted!.id}`])
  })

  describe('how a draft would start', () => {
    const model = { id: 'free-1', providerId: 'opencode' }
    const choice = { agent: 'build', model, worktree: { base: 'main', branch: 'topic/x' } }
    const raw = async (path: string): Promise<Record<string, any>> => JSON.parse(await fs.readFile(join(path, 'index.json'), 'utf8')).drafts

    it('is kept with the draft, listed for a row, and still there after a restart', async () => {
      const { path, store } = await setup()
      await store.text(draftKey, 'Try it', { ...folder, choice })
      expect((await store.list())[0]).toMatchObject({ id: 'drf_one', choice })
      await store.save()
      expect((await new InboxDraftStore(path).list())[0]!.choice).toEqual(choice)
      // The composer is given the text and files only.
      expect(await store.get(draftKey)).toEqual({ revision: 1, text: 'Try it', attachments: [] })
    })

    it('is replaced as a whole by the next one, so leaving a worktree takes it away', async () => {
      const { store } = await setup()
      await store.text(draftKey, 'Try it', { ...folder, choice })
      await store.text(draftKey, 'Try it again', { ...folder, choice: { agent: 'plan', model } })
      expect((await store.list())[0]!.choice).toEqual({ agent: 'plan', model })
    })

    it('is kept when a change says nothing about it, as before the options were known', async () => {
      const { store } = await setup()
      await store.text(draftKey, 'Try it', { ...folder, choice })
      await store.text(draftKey, 'Try it harder', folder)
      expect((await store.list())[0]).toMatchObject({ preview: 'Try it harder', choice })
    })

    it('is not stored for a thread, whose box has no start to choose', async () => {
      const { path, store } = await setup()
      await store.text(key, 'Hi', { choice })
      await store.save()
      expect((await raw(path))[key]).not.toHaveProperty('choice')
    })

    it('can be changed on its own, which counts as a change but only when it is one', async () => {
      const { path, store } = await setup()
      clock.now = 1_000
      await store.text(draftKey, 'Try it', { ...folder, choice })
      clock.now = 2_000
      await store.setMeta(draftKey, { choice })
      expect((await store.list())[0]!.updatedAt).toBe(1_000)
      await store.setMeta(draftKey, { choice: { ...choice, agent: 'plan' } })
      expect((await store.list())[0]).toMatchObject({ updatedAt: 2_000, folderId: 'fld_one', choice: { ...choice, agent: 'plan' } })
      // Nothing is made of a draft that is not there, and saying nothing changes nothing.
      clock.now = 3_000
      await store.setMeta('draft:drf_none', { folderId: 'fld_one', choice })
      await store.setMeta(draftKey, { folderId: 'fld_one' })
      expect((await store.list()).map((draft) => [draft.id, draft.updatedAt])).toEqual([['drf_one', 2_000]])
      expect(Object.keys(await raw(path))).toEqual([draftKey])
    })

    it('loses only what is damaged when the file was edited by hand', async () => {
      const { path, store } = await setup()
      await store.text(draftKey, 'One', { ...folder, choice })
      await store.text(other, 'Two', { folderId: 'fld_two', choice })
      await store.text(third, 'Three', { folderId: 'fld_three', choice })
      await store.save()
      const drafts = await raw(path)
      drafts[draftKey].choice = { agent: 7, model: { id: 'free-1' }, worktree: { base: '' }, extra: true }
      drafts[other].choice = 'build'
      drafts[third].choice = { agent: 'plan', model: { id: 'x'.repeat(600), providerId: 'opencode' }, worktree: { base: 'main', branch: 5 } }
      await fs.writeFile(join(path, 'index.json'), JSON.stringify({ version: 1, drafts }))
      const list = await new InboxDraftStore(path).list()
      const byId = Object.fromEntries(list.map((draft) => [draft.id, draft]))
      expect(Object.keys(byId).sort()).toEqual(['drf_one', 'drf_three', 'drf_two'])
      expect(byId.drf_one).not.toHaveProperty('choice')
      expect(byId.drf_two).not.toHaveProperty('choice')
      expect(byId.drf_three!.choice).toEqual({ agent: 'plan', worktree: { base: 'main' } })
      expect(byId.drf_three!.preview).toBe('Three')
    })
  })

  describe('threads with an unsent message', () => {
    it('are the ones whose box holds text or a file, and not one a sent message emptied', async () => {
      const { store } = await setup()
      expect(await store.threadIds()).toEqual([])
      await store.text('thread:ses_b', 'Second thought')
      await store.add('thread:ses_a', 'a.txt', 'text/plain', new Uint8Array([1]))
      await store.text('thread:ses_c', 'Typed')
      await store.text('thread:ses_c', '  \n')
      await store.text('thread:ses_d', '')
      // A new thread is a draft of its own, listed elsewhere.
      await store.text(draftKey, 'A new one', folder)
      expect(await store.threadIds()).toEqual(['ses_a', 'ses_b'])
    })
  })

  it('refuses a folder that is not a folder id', async () => {
    const { path, store } = await setup()
    await store.text(draftKey, 'Hello', folder)
    await store.save()
    const index = JSON.parse(await fs.readFile(join(path, 'index.json'), 'utf8'))
    index.drafts[draftKey].folderId = '../outside'
    await fs.writeFile(join(path, 'index.json'), JSON.stringify(index))
    await expect(new InboxDraftStore(path).list()).rejects.toThrow('saved files have been kept')
  })
})
