import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChatDraft, ChatDraftKey } from '@shared/types'

export const ATTACHMENT_LIMIT = 20 * 1024 * 1024
export const DRAFT_STORAGE_LIMIT = 200 * 1024 * 1024
const empty = (): ChatDraft => ({ revision: 0, text: '', attachments: [] })

function validDraft(draft: ChatDraft): boolean {
  if (!draft || typeof draft.text !== 'string' || draft.text.length > 100_000 ||
    !Number.isSafeInteger(draft.revision) || draft.revision < 0 ||
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
  private drafts: Record<string, ChatDraft> = {}
  private queue: Promise<unknown> = Promise.resolve()
  private loaded = false
  private readonly previews = new Map<string, string | undefined>()
  constructor(private readonly directory: string, private readonly thumbnail: (bytes: Buffer) => string | undefined = () => undefined, private readonly validOwner: (key: string) => boolean = () => true) {}

  private async load(): Promise<void> {
    if (this.loaded) return
    this.drafts = {}
    await fs.mkdir(join(this.directory, 'attachments'), { recursive: true, mode: 0o700 })
    try {
      const raw = JSON.parse(await fs.readFile(join(this.directory, 'index.json'), 'utf8'))
      if (raw.version !== 1 || !raw.drafts || typeof raw.drafts !== 'object' || Array.isArray(raw.drafts)) throw new Error('Invalid draft index')
      for (const [key, value] of Object.entries(raw.drafts)) {
        const draft = value as ChatDraft
        if (!/^(thread:ses_[\w-]+|folder:fld_[\w-]+)$/.test(key) || !validDraft(draft)) {
          throw new Error('Invalid draft index')
        }
        // Preview data is regenerated from the copy; never trust stored HTML or URLs.
        this.drafts[key] = { ...draft, attachments: draft.attachments.map(({ thumbnail: _preview, ...file }) => file) }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Could not load saved Inbox drafts. The saved files have been kept.')
    }
    for (const key of Object.keys(this.drafts)) if (!this.validOwner(key)) delete this.drafts[key]
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
      const draft = structuredClone(this.drafts[key] ?? empty())
      for (const file of draft.attachments) {
        try {
          if (!this.previews.has(file.id)) this.previews.set(file.id, this.thumbnail(await fs.readFile(join(this.directory, 'attachments', file.id))))
          file.thumbnail = this.previews.get(file.id)
        } catch { /* Sending reports a missing copy; keep the draft. */ }
      }
      return draft
    })
  }

  text(key: ChatDraftKey, text: string): Promise<void> {
    return this.run(async () => {
      const draft = this.drafts[key] ?? empty()
      this.drafts[key] = { ...draft, text, revision: draft.revision + 1 }
      await this.persist()
    })
  }

  add(key: ChatDraftKey, name: string, mime: string, bytes: Uint8Array): Promise<void> {
    return this.run(async () => {
      const draft = this.drafts[key] ?? empty()
      const total = draft.attachments.reduce((sum, file) => sum + file.size, 0)
      if (draft.attachments.length >= 10 || bytes.byteLength + total > ATTACHMENT_LIMIT) throw new Error('A draft can contain up to 10 files and 20 MiB in total.')
      const stored = Object.values(this.drafts).flatMap((item) => item.attachments).reduce((sum, file) => sum + file.size, 0)
      if (stored + bytes.byteLength > DRAFT_STORAGE_LIMIT) throw new Error('Saved attachments exceed 200 MiB. Remove files from other drafts and try again.')
      const id = randomUUID()
      await fs.writeFile(join(this.directory, 'attachments', id), bytes, { flag: 'wx', mode: 0o600 })
      this.drafts[key] = { ...draft, revision: draft.revision + 1, attachments: [...draft.attachments, { id, name, mime, size: bytes.byteLength }] }
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
      if (id) this.drafts[key] = { ...draft, revision: draft.revision + 1, attachments: draft.attachments.filter((file) => file.id !== id) }
      else delete this.drafts[key]
      await this.persist()
      for (const file of removed) this.previews.delete(file.id)
      for (const file of removed) await fs.unlink(join(this.directory, 'attachments', file.id)).catch(() => {})
    })
  }

  move(from: ChatDraftKey, to: ChatDraftKey): Promise<void> {
    return this.run(async () => {
      if (this.drafts[from]) { this.drafts[to] = this.drafts[from]; delete this.drafts[from]; await this.persist() }
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
