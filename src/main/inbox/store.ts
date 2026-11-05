import { promises as fs } from 'node:fs'
import type {
  InboxComposerState,
  InboxFolder,
  InboxThread,
  InboxWorktree,
  OpenCodeModelRef,
  OpenCodeTarget,
  InboxThreadStatus
} from '@shared/types'
import { normalizeInboxFolderIcon } from '@shared/inbox-folder-icons'
import { writeJsonAtomic } from '../store/atomic-json'

export const INBOX_FILE = 'inbox.json'
export const INBOX_FILE_VERSION = 1
/** Oldest threads (by last activity) are dropped beyond this many. */
export const INBOX_MAX_THREADS = 1000
export const INBOX_MAX_FOLDERS = 200
/** Worktree folders have a limit of their own, so a run of worktrees cannot push the folders out. */
export const INBOX_MAX_WORKTREE_FOLDERS = 100
export const INBOX_WRITE_DELAY_MS = 500
export const INBOX_TITLE_MAX_LENGTH = 512
export const INBOX_DIRECTORY_MAX_LENGTH = 4096
const INBOX_SHORT_TEXT_MAX_LENGTH = 512

const SESSION_ID = /^ses_[A-Za-z0-9_-]{1,200}$/
const FOLDER_ID = /^fld_[A-Za-z0-9-]{1,64}$/
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const DISTRO = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/

export function isInboxThreadId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value)
}

export function isInboxFolderId(value: unknown): value is string {
  return typeof value === 'string' && FOLDER_ID.test(value)
}

export function isChatAgentId(value: unknown): value is string {
  return typeof value === 'string' && AGENT_ID.test(value)
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !CONTROLS.test(value)
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isStatus(value: unknown): value is InboxThreadStatus {
  return value === 'idle' || value === 'working' || value === 'attention' ||
    value === 'completed' || value === 'error'
}

function validateTarget(value: unknown): OpenCodeTarget | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.kind === 'native') return { kind: 'native' }
  if (record.kind === 'wsl' && typeof record.distro === 'string' && DISTRO.test(record.distro)) {
    return { kind: 'wsl', distro: record.distro }
  }
  return null
}

export function validateModel(value: unknown): OpenCodeModelRef | undefined | null {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!text(record.id, INBOX_SHORT_TEXT_MAX_LENGTH) || !text(record.providerId, INBOX_SHORT_TEXT_MAX_LENGTH)) return null
  if (record.variant !== undefined && !text(record.variant, INBOX_SHORT_TEXT_MAX_LENGTH)) return null
  return {
    id: record.id,
    providerId: record.providerId,
    ...(record.variant !== undefined ? { variant: record.variant as string } : {})
  }
}

/** Returns a clean copy of one stored thread, or null when any field is malformed. */
export function validateInboxThread(raw: unknown): InboxThread | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (!isInboxThreadId(record.id)) return null
  if (record.mode !== undefined && record.mode !== 'gui' && record.mode !== 'terminal') return null
  if (!text(record.title, INBOX_TITLE_MAX_LENGTH)) return null
  if (!text(record.directory, INBOX_DIRECTORY_MAX_LENGTH)) return null
  const target = validateTarget(record.target)
  if (!target) return null
  if (record.branch !== null && !text(record.branch, INBOX_SHORT_TEXT_MAX_LENGTH)) return null
  const model = validateModel(record.model)
  if (model === null) return null
  if (!isStatus(record.status)) return null
  const attentionReason = record.attentionReason
  if (record.status === 'attention'
    ? attentionReason !== 'permission' && attentionReason !== 'question'
    : attentionReason !== undefined) return null
  if (!timestamp(record.createdAt) || !timestamp(record.lastActivityAt) || !timestamp(record.readAt)) return null
  if (typeof record.archived !== 'boolean') return null
  if (!isInboxFolderId(record.folderId)) return null
  const worktree = validateWorktree(record.worktree)
  return {
    id: record.id,
    ...(record.mode === 'terminal' ? { mode: 'terminal' as const } : {}),
    title: record.title,
    ...(text(record.customTitle, INBOX_TITLE_MAX_LENGTH) ? { customTitle: record.customTitle.trim() } : {}),
    directory: record.directory,
    target,
    branch: record.branch as string | null,
    ...(model ? { model } : {}),
    status: record.status,
    ...(record.status === 'attention' ? { attentionReason: attentionReason as 'permission' | 'question' } : {}),
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
    readAt: record.readAt,
    archived: record.archived,
    ...(typeof record.pinned === 'boolean' ? { pinned: record.pinned } : {}),
    folderId: record.folderId,
    // Only a pointer for the header, so a bad one is dropped instead of losing the thread.
    ...(isInboxThreadId(record.forkedFrom) ? { forkedFrom: record.forkedFrom } : {}),
    // Without its record the thread still works; only removing its worktree from the Inbox is lost.
    ...(worktree ? { worktree } : {})
  }
}

function validateWorktree(raw: unknown): InboxWorktree | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (!text(record.repository, INBOX_DIRECTORY_MAX_LENGTH) || !text(record.root, INBOX_DIRECTORY_MAX_LENGTH)) return null
  if (!text(record.branch, INBOX_SHORT_TEXT_MAX_LENGTH) || !text(record.base, INBOX_SHORT_TEXT_MAX_LENGTH)) return null
  return { repository: record.repository, root: record.root, branch: record.branch, base: record.base }
}

/** Returns a clean copy of one stored folder, or null when any field is malformed. */
export function validateInboxFolder(raw: unknown): InboxFolder | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (!isInboxFolderId(record.id)) return null
  if (!text(record.name, INBOX_TITLE_MAX_LENGTH)) return null
  if (!text(record.directory, INBOX_DIRECTORY_MAX_LENGTH)) return null
  const target = validateTarget(record.target)
  if (!target) return null
  if (!timestamp(record.createdAt) || !timestamp(record.lastUsedAt)) return null
  // Without its record the folder is still a folder; only what says it is a worktree is lost.
  const worktree = validateWorktree(record.worktree)
  // Only decoration, so a bad one is dropped and the project shows the plain folder picture.
  const icon = normalizeInboxFolderIcon(record.icon)
  return {
    id: record.id,
    name: record.name,
    directory: record.directory,
    target,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    ...(icon ? { icon } : {}),
    ...(worktree ? { worktree } : {})
  }
}

export function validateComposer(raw: unknown): InboxComposerState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as Record<string, unknown>
  const model = validateModel(record.model)
  return {
    ...(isInboxFolderId(record.folderId) ? { folderId: record.folderId } : {}),
    ...(isChatAgentId(record.agent) ? { agent: record.agent } : {}),
    ...(model ? { model } : {})
  }
}

function byRecentUse(a: InboxFolder, b: InboxFolder): number {
  return b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name)
}

/** Keeps the most recently used folders of each kind, within that kind's limit. `sorted` is most recent first. */
function limitFolders(sorted: InboxFolder[]): InboxFolder[] {
  let plain = 0
  let worktrees = 0
  return sorted.filter((folder) => (folder.worktree ? ++worktrees <= INBOX_MAX_WORKTREE_FOLDERS : ++plain <= INBOX_MAX_FOLDERS))
}

/** The valid folders of the stored file, most recently used first. */
export function normalizeInboxFolders(raw: unknown): InboxFolder[] {
  const list = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).folders
    : undefined
  if (!Array.isArray(list)) return []
  const folders = new Map<string, InboxFolder>()
  for (const item of list) {
    const folder = validateInboxFolder(item)
    if (folder && !folders.has(folder.id)) folders.set(folder.id, folder)
  }
  return limitFolders([...folders.values()].sort(byRecentUse))
}

function byRecentActivity(a: InboxThread, b: InboxThread): number {
  return b.lastActivityAt - a.lastActivityAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
}

/**
 * Validates the stored file. Nothing is live right after a start, so a thread
 * that was still working when MDE closed is shown as idle.
 */
export function normalizeInboxFile(raw: unknown): InboxThread[] {
  const list = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).threads
    : undefined
  if (!Array.isArray(list)) return []
  const threads = new Map<string, InboxThread>()
  for (const item of list) {
    const thread = validateInboxThread(item)
    if (!thread || threads.has(thread.id)) continue
    threads.set(thread.id, thread.status === 'working' ? { ...thread, status: 'idle' } : thread)
  }
  return [...threads.values()].sort(byRecentActivity).slice(0, INBOX_MAX_THREADS)
}

export interface InboxStoreDependencies {
  readFile(path: string): Promise<string>
  writeFile(path: string, value: unknown): Promise<void>
  writeDelayMs: number
}

const defaultDependencies: InboxStoreDependencies = {
  readFile: (path) => fs.readFile(path, 'utf8'),
  writeFile: writeJsonAtomic,
  writeDelayMs: INBOX_WRITE_DELAY_MS
}

/**
 * MDE's own record of OpenCode threads and the Inbox's folders, kept in
 * memory and saved to `inbox.json`.
 */
export class InboxStore {
  private readonly threads = new Map<string, InboxThread>()
  private readonly folderMap = new Map<string, InboxFolder>()
  private composerState: InboxComposerState = {}
  private readonly dependencies: InboxStoreDependencies
  private timer: ReturnType<typeof setTimeout> | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    dependencies: Partial<InboxStoreDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  async load(): Promise<void> {
    this.threads.clear()
    this.folderMap.clear()
    this.composerState = {}
    let source: string
    try {
      source = await this.dependencies.readFile(this.file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[inbox] could not read inbox.json, starting empty:', error)
      }
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch (error) {
      console.warn('[inbox] inbox.json is not valid JSON, starting empty:', error)
      return
    }
    for (const thread of normalizeInboxFile(parsed)) this.threads.set(thread.id, thread)
    for (const folder of normalizeInboxFolders(parsed)) this.folderMap.set(folder.id, folder)
    const composer = validateComposer((parsed as Record<string, unknown> | null)?.composer)
    if (composer.folderId && !this.folderMap.has(composer.folderId)) delete composer.folderId
    this.composerState = composer
  }

  /** Most recently used first. */
  folders(): InboxFolder[] {
    return [...this.folderMap.values()].sort(byRecentUse)
  }

  folder(id: string): InboxFolder | undefined {
    return this.folderMap.get(id)
  }

  putFolder(folder: InboxFolder): void {
    this.folderMap.set(folder.id, folder)
    const kept = new Set(limitFolders(this.folders()).map((item) => item.id))
    for (const id of [...this.folderMap.keys()]) if (!kept.has(id)) this.folderMap.delete(id)
    this.scheduleSave()
  }

  removeFolder(id: string): boolean {
    const removed = this.folderMap.delete(id)
    if (removed) {
      if (this.composerState.folderId === id) {
        const { folderId: _removed, ...rest } = this.composerState
        this.composerState = rest
      }
      this.scheduleSave()
    }
    return removed
  }

  composer(): InboxComposerState {
    return { ...this.composerState }
  }

  setComposer(composer: InboxComposerState): void {
    this.composerState = { ...composer }
    this.scheduleSave()
  }

  /** Most recent activity first. */
  list(): InboxThread[] {
    return [...this.threads.values()].sort(byRecentActivity)
  }

  get(id: string): InboxThread | undefined {
    return this.threads.get(id)
  }

  put(thread: InboxThread): void {
    this.threads.set(thread.id, thread)
    if (this.threads.size > INBOX_MAX_THREADS) {
      for (const stale of this.list().slice(INBOX_MAX_THREADS)) this.threads.delete(stale.id)
    }
    this.scheduleSave()
  }

  remove(id: string): boolean {
    const removed = this.threads.delete(id)
    if (removed) this.scheduleSave()
    return removed
  }

  /** Writes any pending change now; used on quit and by tests. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
      this.enqueueSave()
    }
    return this.writeQueue
  }

  private scheduleSave(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.enqueueSave()
    }, this.dependencies.writeDelayMs)
    this.timer.unref?.()
  }

  private enqueueSave(): void {
    const snapshot = {
      version: INBOX_FILE_VERSION,
      threads: this.list(),
      folders: this.folders(),
      composer: this.composerState
    }
    this.writeQueue = this.writeQueue
      .then(() => this.dependencies.writeFile(this.file, snapshot))
      .catch((error: unknown) => console.warn('[inbox] could not save inbox.json:', error))
  }
}
