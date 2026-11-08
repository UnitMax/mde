import { create } from 'zustand'
import type { InboxChangesResponse } from '@shared/types'
import { useWorkspace } from './workspace'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { getInboxSidebarChanges, saveInboxSidebarChanges } from '@/lib/inbox-settings'

export interface ChangesState {
  value?: InboxChangesResponse
  loading: boolean
  stale: boolean
  error?: string
}
interface Store {
  entries: Record<string, ChangesState>
  /** Show each thread's changes in the Inbox list (a preference, off by default). */
  sidebarChanges: boolean
  setSidebarChanges: (on: boolean) => void
  /** Which tab the right-hand sidebar shows. */
  tab: 'files' | 'changes' | 'terminal'
  setTab: (tab: 'files' | 'changes' | 'terminal') => void
  /** The changed file open in the review above the conversation. */
  selectedPath: { threadId: string; path: string } | null
  /** Selects the thread and shows one of its changed files in the review. */
  openFile: (threadId: string, path: string) => void
  closeFile: () => void
  /** `refresh` reads again even when a fresh result is already held. */
  load: (threadId: string, details?: boolean, refresh?: boolean) => Promise<void>
  scheduleRefresh: (threadId: string) => void
  watch: (threadId: string, details?: boolean) => () => void
  prune: (ids: string[]) => void
}
let running = 0
const queue: Array<{ id: string; resume: () => void }> = []
async function limited<T>(id: string, priority: boolean, run: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((resume) => {
    const entry = { id, resume }
    if (priority) queue.unshift(entry)
    else queue.push(entry)
  })
  else running += 1
  try {
    return await run()
  } finally {
    const next = queue.shift()
    if (next) next.resume()
    else running -= 1
  }
}
const watchers = new Map<string, Map<symbol, { threadId: string; details: boolean }>>()
const pollers = new Map<string, { interval: number; onFocus: () => void }>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const revisions = new Map<string, number>()
const pending = new Map<string, { details: boolean; promise: Promise<void> }>()
const detailsRecent: string[] = []

export function inboxChangesKey(threadId: string): string {
  const thread = useWorkspace.getState().inboxThreads.find((item) => item.id === threadId)
  if (!thread) return `deleted:${threadId}`
  return JSON.stringify([thread.target.kind, thread.target.kind === 'wsl' ? thread.target.distro : '', thread.worktree?.root ?? thread.directory])
}

export const useInboxChanges = create<Store>((set, get) => ({
  entries: {}, selectedPath: null, tab: 'files',
  sidebarChanges: getInboxSidebarChanges(),
  setSidebarChanges: (on) => {
    saveInboxSidebarChanges(on)
    set({ sidebarChanges: on })
  },
  setTab: (tab) => set({ tab }),
  openFile: (threadId, path) => {
    const workspace = useWorkspace.getState()
    workspace.selectInboxThread(threadId)
    // Only one review at a time: a file opened from the tree gives way to the diff.
    workspace.closeFile(threadId)
    set({ selectedPath: { threadId, path } })
  },
  closeFile: () => set({ selectedPath: null }),
  load: async (threadId, details = false, refresh = false) => {
    if (!useWorkspace.getState().inboxThreads.some((t) => t.id === threadId)) return
    const key = inboxChangesKey(threadId)
    const old = get().entries[key]
    // A row refresh must not replace a cached file list with a summary response.
    const includeDetails = details || Boolean(old?.value?.files) ||
      [...(watchers.get(key)?.values() ?? [])].some((watch) => watch.details)
    const existing = pending.get(key)
    if (existing) {
      if (includeDetails) {
        const index = queue.findIndex((entry) => entry.id === key)
        if (index >= 0) queue.unshift(queue.splice(index, 1)[0]!)
      }
      await existing.promise
      if (includeDetails && !existing.details) return get().load(threadId, true, refresh)
      return
    }
    if (!refresh && old?.value && !old.stale && (!includeDetails || old.value.files)) return
    const revision = revisions.get(key) ?? 0
    const patch = (state: ChangesState): void => set((s) => ({ entries: { ...s.entries, [key]: state } }))
    patch({ ...old, loading: true, stale: old?.stale ?? false })
    const promise = limited(key, includeDetails, async () => {
      try {
        const value = await window.api.inbox.changes({ threadId, details: includeDetails })
        if ((revisions.get(key) ?? 0) !== revision || !useWorkspace.getState().inboxThreads.some((t) => inboxChangesKey(t.id) === key)) return
        patch({ value, loading: false, stale: false })
        const selected = get().selectedPath
        if (includeDetails && selected && inboxChangesKey(selected.threadId) === key && !value.files?.some((f) => f.path === selected.path)) set({ selectedPath: null })
        if (includeDetails) {
          const index = detailsRecent.indexOf(key)
          if (index >= 0) detailsRecent.splice(index, 1)
          detailsRecent.push(key)
          while (detailsRecent.length > 10) {
            const evicted = detailsRecent.shift()!
            const entry = get().entries[evicted]
            if (entry?.value) {
              const { files: _files, ...summary } = entry.value
              set((s) => ({ entries: { ...s.entries, [evicted]: { ...entry, value: summary } } }))
            }
          }
        }
      } catch (error) {
        if ((revisions.get(key) ?? 0) === revision && useWorkspace.getState().inboxThreads.some((t) => inboxChangesKey(t.id) === key)) {
          patch({ ...old, loading: false, stale: Boolean(old?.value), error: ipcErrorMessage(error, 'Could not load changes.') })
        }
      }
    })
    pending.set(key, { details: includeDetails, promise })
    await promise
    if (pending.get(key)?.promise === promise) pending.delete(key)
    if ((revisions.get(key) ?? 0) !== revision && watchers.has(key)) {
      const active = [...watchers.get(key)!.values()]
      const valid = active.find((watch) => useWorkspace.getState().inboxThreads.some((t) => t.id === watch.threadId))
      if (valid) void get().load(valid.threadId, active.some((watch) => watch.details), true)
    }
  },
  scheduleRefresh: (threadId) => {
    const key = inboxChangesKey(threadId)
    if (!watchers.has(key) || timers.has(key)) return
    timers.set(key, setTimeout(() => {
      timers.delete(key)
      const active = [...(watchers.get(key)?.values() ?? [])]
      const valid = active.find((watch) => useWorkspace.getState().inboxThreads.some((t) => t.id === watch.threadId))
      if (valid) void get().load(valid.threadId, active.some((watch) => watch.details), true)
    }, 500))
  },
  watch: (threadId, details = false) => {
    const key = inboxChangesKey(threadId)
    const token = Symbol()
    const active = watchers.get(key) ?? new Map<symbol, { threadId: string; details: boolean }>()
    active.set(token, { threadId, details })
    watchers.set(key, active)
    void get().load(threadId, details)
    if (!pollers.has(key)) {
      const refresh = (): void => {
        // A minimized or hidden window has nobody to show the counts to; focus brings them back up to date.
        if (document.hidden) return
        const valid = [...active.values()].find((watch) =>
          useWorkspace.getState().inboxThreads.some((thread) => thread.id === watch.threadId))
        if (valid) get().scheduleRefresh(valid.threadId)
      }
      window.addEventListener('focus', refresh)
      pollers.set(key, { interval: window.setInterval(refresh, 10_000), onFocus: refresh })
    }
    return () => {
      active.delete(token)
      if (!active.size) {
        const poller = pollers.get(key)
        if (poller) {
          window.removeEventListener('focus', poller.onFocus)
          window.clearInterval(poller.interval)
          pollers.delete(key)
        }
        watchers.delete(key)
        clearTimeout(timers.get(key))
        timers.delete(key)
      }
    }
  },
  prune: (ids) => {
    const keep = new Set(ids.map(inboxChangesKey))
    const entries = { ...get().entries }
    for (const id of Object.keys(entries)) if (!keep.has(id)) {
      delete entries[id]
      revisions.set(id, (revisions.get(id) ?? 0) + 1)
    }
    set({ entries })
  },
}))
