import { create } from 'zustand'
import type {
  ChatEvent,
  ChatFormValue,
  ChatMessage,
  ChatOptions,
  ChatRequests,
  InboxAddFolderRequest,
  InboxComposerState,
  InboxFolder,
  InboxThread,
  OpenCodeModelRef,
} from '@shared/types'
import { appendLive, pruneLive, type LivePart } from '@/lib/chat'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { getTerminalSettings, subscribeTerminalSettings } from '@/terminal/terminal-settings'
import { useWorkspace } from '@/store/workspace'

export interface ChatThreadState {
  messages: ChatMessage[]
  /** Cursor for older messages, or null when the start is loaded. */
  older: string | null
  running: boolean
  loading: boolean
  loadingOlder: boolean
  error: string | null
  requests: ChatRequests
  live: LivePart[]
}

export type OptionsState =
  | { status: 'loading' }
  | { status: 'ready'; value: ChatOptions }
  | { status: 'error'; error: string }

/** Threads kept in memory so switching back to one is instant. */
export const CHAT_THREAD_CACHE = 10
/** Bursts of service events collapse into one refetch. */
export const CHAT_REFRESH_DELAY_MS = 150

const emptyThread = (): ChatThreadState => ({
  messages: [],
  older: null,
  running: false,
  loading: true,
  loadingOlder: false,
  error: null,
  requests: { permissions: [], forms: [] },
  live: [],
})

/** Keeps the newest page when a refetch arrives: earlier pages stay loaded. */
function mergeNewest(current: readonly ChatMessage[], newest: readonly ChatMessage[]): ChatMessage[] {
  const first = newest[0]
  if (!first) return [...current]
  const cut = current.findIndex((message) => message.id === first.id)
  if (cut < 0) return [...newest]
  return [...current.slice(0, cut), ...newest]
}

interface InboxChatStore {
  folders: InboxFolder[]
  composer: InboxComposerState
  foldersLoaded: boolean
  /** Options keyed by `folder:<id>` or `thread:<id>`. */
  options: Record<string, OptionsState>
  threads: Record<string, ChatThreadState>
  /** Most recently opened first; bounds the cache. */
  recent: string[]

  init: () => () => void
  addFolder: (request: InboxAddFolderRequest) => Promise<InboxFolder>
  removeFolder: (id: string) => Promise<void>
  setComposer: (patch: InboxComposerState) => void
  loadOptions: (key: { folderId: string } | { threadId: string }, force?: boolean) => Promise<void>
  createThread: (input: { folderId: string; text: string; agent: string; model: OpenCodeModelRef }) => Promise<InboxThread>
  openThread: (threadId: string) => () => void
  refresh: (threadId: string) => Promise<void>
  refreshRequests: (threadId: string) => Promise<void>
  loadOlder: (threadId: string) => Promise<void>
  send: (threadId: string, text: string, choice?: { agent?: string; model?: OpenCodeModelRef }) => Promise<void>
  interrupt: (threadId: string) => Promise<void>
  replyPermission: (threadId: string, requestId: string, decision: 'once' | 'always' | 'reject') => Promise<void>
  replyForm: (threadId: string, formId: string, answer: Record<string, ChatFormValue>) => Promise<void>
  applyEvent: (event: ChatEvent) => void
}

export function optionsKey(key: { folderId: string } | { threadId: string }): string {
  return 'folderId' in key ? `folder:${key.folderId}` : `thread:${key.threadId}`
}

/** Fire-and-forget IPC: failures are not worth surfacing and must not go unhandled. */
function quietly(call: () => PromiseLike<unknown>): void {
  void Promise.resolve().then(call).catch(() => {})
}

const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
const refreshing = new Map<string, Promise<void>>()

export const useInboxChat = create<InboxChatStore>((set, get) => {
  const patchThread = (threadId: string, patch: Partial<ChatThreadState> | ((thread: ChatThreadState) => Partial<ChatThreadState>)): void => {
    set((state) => {
      const thread = state.threads[threadId]
      if (!thread) return {}
      const next = typeof patch === 'function' ? patch(thread) : patch
      return { threads: { ...state.threads, [threadId]: { ...thread, ...next } } }
    })
  }

  const scheduleRefresh = (threadId: string): void => {
    if (refreshTimers.has(threadId)) return
    refreshTimers.set(threadId, setTimeout(() => {
      refreshTimers.delete(threadId)
      void get().refresh(threadId)
    }, CHAT_REFRESH_DELAY_MS))
  }

  return {
    folders: [],
    composer: {},
    foldersLoaded: false,
    options: {},
    threads: {},
    recent: [],

    init: () => {
      const configure = (): void => {
        const executable = getTerminalSettings().agents.opencode.executable.trim()
        if (executable) quietly(() => window.api.chat.configure({ executable }))
      }
      configure()
      const unsubscribeSettings = subscribeTerminalSettings(configure)
      const unsubscribeEvents = window.api.chat.onEvent((event) => get().applyEvent(event))
      void Promise.resolve()
        .then(() => window.api.inbox.folders())
        .then((state) => set({ folders: state?.folders ?? [], composer: state?.composer ?? {}, foldersLoaded: true }))
        .catch(() => set({ foldersLoaded: true }))
      return () => {
        unsubscribeSettings()
        unsubscribeEvents()
      }
    },

    addFolder: async (request) => {
      const folder = await window.api.inbox.addFolder(request)
      set((state) => ({
        folders: [folder, ...state.folders.filter((item) => item.id !== folder.id)],
        composer: { ...state.composer, folderId: folder.id },
      }))
      return folder
    },

    removeFolder: async (id) => {
      await window.api.inbox.removeFolder({ id })
      set((state) => {
        const { folderId: _removed, ...rest } = state.composer
        return {
          folders: state.folders.filter((folder) => folder.id !== id),
          composer: state.composer.folderId === id ? rest : state.composer,
        }
      })
    },

    setComposer: (patch) => {
      const composer = { ...get().composer, ...patch }
      set({ composer })
      quietly(() => window.api.inbox.setComposer(composer))
    },

    loadOptions: async (key, force = false) => {
      const id = optionsKey(key)
      const current = get().options[id]
      if (!force && current && current.status !== 'error') return
      set((state) => ({ options: { ...state.options, [id]: { status: 'loading' } } }))
      try {
        const value = await window.api.chat.options(key)
        set((state) => ({ options: { ...state.options, [id]: { status: 'ready', value } } }))
      } catch (error) {
        set((state) => ({ options: { ...state.options, [id]: { status: 'error', error: ipcErrorMessage(error, 'Something went wrong.') } } }))
      }
    },

    createThread: async (input) => {
      const thread = await window.api.chat.create(input)
      set((state) => ({
        composer: { folderId: input.folderId, agent: input.agent, model: input.model },
        folders: state.folders.map((folder) => (folder.id === input.folderId ? { ...folder, lastUsedAt: Date.now() } : folder)),
      }))
      const workspace = useWorkspace.getState()
      workspace.upsertInboxThread(thread)
      workspace.selectInboxThread(thread.id)
      return thread
    },

    openThread: (threadId) => {
      set((state) => {
        const recent = [threadId, ...state.recent.filter((id) => id !== threadId)]
        const keep = new Set(recent.slice(0, CHAT_THREAD_CACHE))
        const threads: Record<string, ChatThreadState> = {}
        for (const [id, thread] of Object.entries(state.threads)) if (keep.has(id)) threads[id] = thread
        threads[threadId] = state.threads[threadId] ?? emptyThread()
        return { recent: recent.slice(0, CHAT_THREAD_CACHE), threads }
      })
      quietly(() => window.api.chat.subscribe({ threadId }))
      void get().refresh(threadId)
      void get().refreshRequests(threadId)
      return () => {
        quietly(() => window.api.chat.unsubscribe({ threadId }))
      }
    },

    refresh: (threadId) => {
      const pending = refreshing.get(threadId)
      if (pending) {
        // One refetch at a time; a change during it schedules one more.
        scheduleRefresh(threadId)
        return pending
      }
      const run = (async () => {
        try {
          const page = await window.api.chat.messages({ threadId })
          patchThread(threadId, (thread) => {
            const messages = mergeNewest(thread.messages, page.messages)
            const keptOlder = thread.messages.length > 0 && messages.length > page.messages.length
            return {
              messages,
              older: keptOlder ? thread.older : page.older,
              running: page.running,
              loading: false,
              error: null,
              live: page.running ? pruneLive(messages, thread.live) : [],
            }
          })
        } catch (error) {
          patchThread(threadId, { loading: false, error: ipcErrorMessage(error, 'Something went wrong.') })
        } finally {
          refreshing.delete(threadId)
        }
      })()
      refreshing.set(threadId, run)
      return run
    },

    refreshRequests: async (threadId) => {
      try {
        const requests = await window.api.chat.requests({ threadId })
        patchThread(threadId, { requests })
      } catch {
        // Requests are refetched on the next change; the conversation still shows.
      }
    },

    loadOlder: async (threadId) => {
      const thread = get().threads[threadId]
      if (!thread?.older || thread.loadingOlder) return
      const cursor = thread.older
      patchThread(threadId, { loadingOlder: true })
      try {
        const page = await window.api.chat.messages({ threadId, cursor })
        patchThread(threadId, (current) => {
          const known = new Set(current.messages.map((message) => message.id))
          return {
            messages: [...page.messages.filter((message) => !known.has(message.id)), ...current.messages],
            older: page.older,
            loadingOlder: false,
          }
        })
      } catch (error) {
        patchThread(threadId, { loadingOlder: false, error: ipcErrorMessage(error, 'Something went wrong.') })
      }
    },

    send: async (threadId, text, choice = {}) => {
      await window.api.chat.send({ threadId, text, ...choice })
      if (choice.agent || choice.model) {
        set((state) => ({ composer: { ...state.composer, ...choice } }))
      }
      patchThread(threadId, { running: true })
      scheduleRefresh(threadId)
    },

    interrupt: async (threadId) => {
      await window.api.chat.interrupt({ threadId })
    },

    replyPermission: async (threadId, requestId, decision) => {
      await window.api.chat.replyPermission({ threadId, requestId, decision })
      patchThread(threadId, (thread) => ({
        requests: { ...thread.requests, permissions: thread.requests.permissions.filter((item) => item.id !== requestId) },
      }))
    },

    replyForm: async (threadId, formId, answer) => {
      await window.api.chat.replyForm({ threadId, formId, answer })
      patchThread(threadId, (thread) => ({
        requests: { ...thread.requests, forms: thread.requests.forms.filter((item) => item.id !== formId) },
      }))
    },

    applyEvent: (event) => {
      if (!get().threads[event.threadId]) return
      switch (event.type) {
        case 'delta':
          patchThread(event.threadId, (thread) => ({ live: appendLive(thread.live, event), running: true }))
          return
        case 'messages':
          scheduleRefresh(event.threadId)
          return
        case 'requests':
          void get().refreshRequests(event.threadId)
          return
        case 'running':
          patchThread(event.threadId, { running: event.running })
          scheduleRefresh(event.threadId)
          if (!event.running) void get().refreshRequests(event.threadId)
          return
        case 'reconnected':
          scheduleRefresh(event.threadId)
          void get().refreshRequests(event.threadId)
      }
    },
  }
})
