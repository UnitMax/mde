import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChatDraft, ChatDraftChoice, ChatDraftKey, ChatDraftSummary } from '@shared/types'

export const ATTACHMENT_LIMIT = 20 * 1024 * 1024
export const DRAFT_STORAGE_LIMIT = 200 * 1024 * 1024
/** The longest prompt text a draft holds, the same as the longest one MDE sends. */
export const DRAFT_TEXT_LIMIT = 100_000
/** How much of a new-thread draft's text its sidebar row is sent; the row shows a line or two. */
export const DRAFT_PREVIEW_LIMIT = 300
const empty = (): StoredDraft => ({ revision: 0, text: '', attachments: [] })

/**
 * What is kept for a draft. A new-thread draft (`draft:` key) also knows the folder it was written
 * for, how it would start and when it last changed, which the Inbox sidebar lists it by; a thread's
 * draft has none of these.
 */
interface StoredDraft extends ChatDraft {
  folderId?: string
  choice?: ChatDraftChoice
  updatedAt?: number
}

/** What a change to a new-thread draft says about it. */
export interface DraftMeta {
  folderId?: string
  choice?: ChatDraftChoice
}

const isNewThread = (key: string): boolean => key.startsWith('draft:')
const hasContent = (draft: ChatDraft): boolean => draft.text.trim().length > 0 || draft.attachments.length > 0
const plain = ({ folderId: _folder, choice: _choice, updatedAt: _time, ...draft }: StoredDraft): ChatDraft => draft
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const short = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max

/**
 * The remembered choice as it can be used: only what is well formed, so a hand-edited or damaged file
 * costs a draft its choices and nothing else.
 */
function cleanChoice(value: unknown): ChatDraftChoice | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { agent, model, worktree, mode } = value as Record<string, unknown>
  const choice: ChatDraftChoice = {}
  if (mode === 'gui' || mode === 'terminal') choice.mode = mode
  if (short(agent, 128)) choice.agent = agent
  if (model && typeof model === 'object') {
    const { id, providerId, variant } = model as Record<string, unknown>
    if (short(id, 512) && short(providerId, 512)) choice.model = { id, providerId, ...(short(variant, 512) ? { variant } : {}) }
  }
  if (worktree && typeof worktree === 'object') {
    const { base, branch } = worktree as Record<string, unknown>
    if (short(base, 256)) choice.worktree = { base, ...(short(branch, 256) ? { branch } : {}) }
  }
  return Object.keys(choice).length > 0 ? choice : undefined
}

function validDraft(draft: StoredDraft): boolean {
  if (!draft || typeof draft.text !== 'string' || draft.text.length > DRAFT_TEXT_LIMIT ||
    !Number.isSafeInteger(draft.revision) || draft.revision < 0 ||
    (draft.folderId !== undefined && !/^fld_[\w-]{1,64}$/.test(draft.folderId)) ||
    (draft.updatedAt !== undefined && !Number.isFinite(draft.updatedAt)) ||
    !Array.isArray(draft.attachments) || draft.attachments.length > 10) return false
  const ids = new Set<string>()
  let size = 0
  for (const file of draft.attachments) {
    if (!file || !/^[a-f0-9-]{36}$/.test(file.id) || ids.has(file.id) ||
      typeof file.name !== 'string' || file.name.length > 512 ||
      typeof file.mime !== 'string' || file.mime.length > 200 ||
      !Number.isSafeInteger(file.size) || file.size < 0 || file.size > ATTACHMENT_LIMIT) return false
    ids.add(file.id)
    size += file.size
  }
  return size <= ATTACHMENT_LIMIT
}

/** Private, atomic storage for unsent prompts; file names never become storage paths. */
export class InboxDraftStore {
  private drafts: Record<string, StoredDraft> = {}
  private queue: Promise<unknown> = Promise.resolve()
  private loaded = false
  private readonly previews = new Map<string, string | undefined>()
  constructor(
    private readonly directory: string,
    private readonly thumbnail: (bytes: Buffer) => string | undefined = () => undefined,
    private readonly validOwner: (key: string) => boolean = () => true,
    private readonly now: () => number = Date.now,
  ) {}

  private async load(): Promise<void> {
    if (this.loaded) return
    this.drafts = {}
    await fs.mkdir(join(this.directory, 'attachments'), { recursive: true, mode: 0o700 })
    try {
      const raw = JSON.parse(await fs.readFile(join(this.directory, 'index.json'), 'utf8'))
      if (raw.version !== 1 || !raw.drafts || typeof raw.drafts !== 'object' || Array.isArray(raw.drafts)) throw new Error('Invalid draft index')
      for (const [key, value] of Object.entries(raw.drafts)) {
        const draft = value as StoredDraft
        if (!/^(thread:ses_[\w-]+|draft:drf_[\w-]+|folder:fld_[\w-]+)$/.test(key) || !validDraft(draft)) {
          throw new Error('Invalid draft index')
        }
        // Preview data is regenerated from the copy; never trust stored HTML or URLs.
        const { choice: stored, ...rest } = draft
        const choice = cleanChoice(stored)
        const kept = { ...rest, ...(choice ? { choice } : {}), attachments: draft.attachments.map(({ thumbnail: _preview, ...file }) => file) }
        // The one draft a folder used to have is now a new-thread draft of its own, so it is listed too.
        if (key.startsWith('folder:')) this.drafts[`draft:drf_${randomUUID()}`] = { ...kept, folderId: key.slice('folder:'.length), updatedAt: this.now() }
        else this.drafts[key] = kept
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Could not load saved Inbox drafts. The saved files have been kept.')
    }
    for (const [key, draft] of Object.entries(this.drafts)) {
      // A new-thread draft with nothing in it is not kept: the box was cleared, or the page never got a word.
      const gone = isNewThread(key) ? !hasContent(draft) || !draft.folderId : false
      if (gone || !this.validOwner(key)) delete this.drafts[key]
    }
    await this.persist()
    const referenced = new Set(Object.values(this.drafts).flatMap((draft) => draft.attachments.map((file) => file.id)))
    for (const name of await fs.readdir(join(this.directory, 'attachments'))) {
      if (/^[a-f0-9-]{36}$/.test(name) && !referenced.has(name)) await fs.unlink(join(this.directory, 'attachments', name))
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    const target = join(this.directory, 'index.json')
    const tmp = `${target}.tmp`
    const handle = await fs.open(tmp, 'w', 0o600)
    try {
      await handle.writeFile(JSON.stringify({ version: 1, drafts: this.drafts }))
      await handle.sync()
    } finally { await handle.close() }
    await fs.rename(tmp, target)
  }

  private run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      await this.load()
      const previous = structuredClone(this.drafts)
      try { return await action() } catch (error) { this.drafts = previous; throw error }
    })
    this.queue = result.catch(() => {})
    return result
  }

  get(key: ChatDraftKey): Promise<ChatDraft> {
    return this.run(async () => {
      const draft = structuredClone(plain(this.drafts[key] ?? empty()))
      for (const file of draft.attachments) {
        try {
          if (!this.previews.has(file.id)) this.previews.set(file.id, this.thumbnail(await fs.readFile(join(this.directory, 'attachments', file.id))))
          file.thumbnail = this.previews.get(file.id)
        } catch { /* Sending reports a missing copy; keep the draft. */ }
      }
      return draft
    })
  }

  /** The draft after a change to it; a new-thread one also notes its folder, how it would start and the time. */
  private changed(key: ChatDraftKey, draft: StoredDraft, meta?: DraftMeta): StoredDraft {
    if (!isNewThread(key)) return draft
    return {
      ...draft,
      ...(meta?.folderId ? { folderId: meta.folderId } : {}),
      ...(meta?.choice ? { choice: meta.choice } : {}),
      updatedAt: this.now(),
    }
  }

  /** Keeps a new-thread draft only while it holds something. */
  private settle(key: ChatDraftKey): void {
    const draft = this.drafts[key]
    if (draft && isNewThread(key) && !hasContent(draft)) delete this.drafts[key]
  }

  text(key: ChatDraftKey, text: string, meta?: DraftMeta): Promise<void> {
    return this.run(async () => {
      const draft = this.drafts[key] ?? empty()
      const kept = key in this.drafts
      this.drafts[key] = this.changed(key, { ...draft, text, revision: draft.revision + 1 }, meta)
      this.settle(key)
      // A new-thread draft that is still empty was never kept, so there is nothing to write.
      if (!kept && !(key in this.drafts)) return
      await this.persist()
    })
  }

  /**
   * Puts text above what the draft already holds, with a blank line between. It is one step, so a
   * keystroke saved at the same moment is not lost. A draft that would grow past the limit is left
   * as it was.
   */
  prepend(key: ChatDraftKey, text: string, meta?: DraftMeta): Promise<void> {
    return this.run(async () => {
      if (!text.trim()) return
      const draft = this.drafts[key] ?? empty()
      const merged = draft.text.trim() ? `${text}\n\n${draft.text}` : text
      if (merged.length > DRAFT_TEXT_LIMIT) throw new Error('The text is too long to add to this draft.')
      this.drafts[key] = this.changed(key, { ...draft, text: merged, revision: draft.revision + 1 }, meta)
      await this.persist()
    })
  }

  add(key: ChatDraftKey, name: string, mime: string, bytes: Uint8Array, meta?: DraftMeta): Promise<void> {
    return this.run(async () => {
      const draft = this.drafts[key] ?? empty()
      const total = draft.attachments.reduce((sum, file) => sum + file.size, 0)
      if (draft.attachments.length >= 10 || bytes.byteLength + total > ATTACHMENT_LIMIT) throw new Error('A draft can contain up to 10 files and 20 MiB in total.')
      const stored = Object.values(this.drafts).flatMap((item) => item.attachments).reduce((sum, file) => sum + file.size, 0)
      if (stored + bytes.byteLength > DRAFT_STORAGE_LIMIT) throw new Error('Saved attachments exceed 200 MiB. Remove files from other drafts and try again.')
      const id = randomUUID()
      await fs.writeFile(join(this.directory, 'attachments', id), bytes, { flag: 'wx', mode: 0o600 })
      this.drafts[key] = this.changed(key, { ...draft, revision: draft.revision + 1, attachments: [...draft.attachments, { id, name, mime, size: bytes.byteLength }] }, meta)
      try { await this.persist() } catch (error) {
        await fs.unlink(join(this.directory, 'attachments', id)).catch(() => {})
        throw error
      }
    })
  }

  remove(key: ChatDraftKey, id?: string, revision?: number): Promise<void> {
    return this.run(async () => {
      const draft = this.drafts[key]
      if (!draft || (revision !== undefined && draft.revision !== revision)) return
      const removed = draft.attachments.filter((file) => !id || file.id === id)
      if (id) {
        this.drafts[key] = this.changed(key, { ...draft, revision: draft.revision + 1, attachments: draft.attachments.filter((file) => file.id !== id) })
        this.settle(key)
      } else delete this.drafts[key]
      await this.persist()
      for (const file of removed) this.previews.delete(file.id)
      for (const file of removed) await fs.unlink(join(this.directory, 'attachments', file.id)).catch(() => {})
    })
  }

  move(from: ChatDraftKey, to: ChatDraftKey): Promise<void> {
    return this.run(async () => {
      const draft = this.drafts[from]
      if (draft) { this.drafts[to] = isNewThread(to) ? draft : plain(draft); delete this.drafts[from]; await this.persist() }
    })
  }

  /** The new-thread drafts that hold something, most recently changed first. */
  list(): Promise<ChatDraftSummary[]> {
    return this.run(async () => Object.entries(this.drafts)
      .flatMap(([key, draft]) => {
        if (!isNewThread(key) || !draft.folderId || !hasContent(draft)) return []
        const first = draft.attachments[0]
        return [{
          id: key.slice('draft:'.length),
          folderId: draft.folderId,
          preview: draft.text.trimStart().slice(0, DRAFT_PREVIEW_LIMIT),
          attachments: draft.attachments.length,
          ...(first ? { attachmentName: first.name } : {}),
          updatedAt: draft.updatedAt ?? 0,
          ...(draft.choice ? { choice: draft.choice } : {}),
        }]
      })
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)))
  }

  /**
   * The threads whose box holds an unsent message, as the Inbox marks them. A thread's draft with
   * nothing in it, which is what a sent message leaves behind, does not count.
   */
  threadIds(): Promise<string[]> {
    return this.run(async () => Object.entries(this.drafts)
      .filter(([key, draft]) => key.startsWith('thread:') && hasContent(draft))
      .map(([key]) => key.slice('thread:'.length))
      .sort())
  }

  /**
   * Says that a new-thread draft is now shown for another folder, or with other choices, as when the
   * page's folder is changed. A draft that is not there, or already so, is left alone.
   */
  setMeta(key: ChatDraftKey, meta: DraftMeta): Promise<void> {
    return this.run(async () => {
      const draft = this.drafts[key]
      if (!draft || !isNewThread(key)) return
      const folderChanged = Boolean(meta.folderId) && draft.folderId !== meta.folderId
      const choiceChanged = Boolean(meta.choice) && !same(draft.choice, meta.choice)
      if (!folderChanged && !choiceChanged) return
      this.drafts[key] = this.changed(key, draft, meta)
      await this.persist()
    })
  }

  files(key: ChatDraftKey, ids: string[], revision?: number): Promise<{ uri: string; name: string }[]> {
    return this.run(async () => {
      const draft = this.drafts[key]
      if (!draft || draft.revision !== revision || ids.length !== new Set(ids).size) throw new Error('The draft changed. Try sending again.')
      return Promise.all(ids.map(async (id) => {
        const file = draft.attachments.find((entry) => entry.id === id)
        if (!file) throw new Error('Attachment does not belong to this draft.')
        const bytes = await fs.readFile(join(this.directory, 'attachments', id)).catch(() => { throw new Error(`Saved copy of ${file.name} is missing. Remove it and add it again.`) })
        if (bytes.length !== file.size || bytes.length > ATTACHMENT_LIMIT) throw new Error('The saved attachment changed. Add it again.')
        return { name: file.name, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }
      }))
    })
  }

  flush(): Promise<unknown> { return this.queue }
}
