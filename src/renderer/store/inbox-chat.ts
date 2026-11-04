import { create } from 'zustand'
import type {
  ChatEvent,
  ChatFormValue,
  ChatMessage,
  ChatOptions,
  ChatDelivery,
  ChatPendingMessage,
  ChatRequests,
  ChatRevert,
  ChatUsage,
  InboxAddFolderRequest,
  InboxComposerState,
  InboxFolder,
  InboxThread,
  OpenCodeModelRef,
} from '@shared/types'
import { appendLive, mergePending, pruneLive, type LivePart } from '@/lib/chat'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { mcpTargetKey } from '@/lib/mcp'
import { useInboxMcp } from '@/store/inbox-mcp'
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
  /** The thread's totals from the last refetch; kept when a refetch brings none. */
  usage: ChatUsage | null
  /**
   * The revert OpenCode has staged, or null. `messages` still holds the hidden ones, so redoing
   * shows them at once; the view cuts them out. Kept when a refetch does not say.
   */
  revert: ChatRevert | null
  /** Something to tell the reader about the thread that is not an error of loading it; null for nothing. */
  notice: string | null
  /**
   * Messages OpenCode has accepted but holds for the agent, oldest first. They are not in `messages`
   * until delivered, and then they leave this list. Kept when a refetch cannot say.
   */
  pending: ChatPendingMessage[]
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
  usage: null,
  revert: null,
  notice: null,
  pending: [],
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
  titleRegenerations: Record<string, { pending: boolean; error: string | null }>
  regenerateTitle: (threadId: string) => Promise<void>
  folders: InboxFolder[]
  composer: InboxComposerState
  foldersLoaded: boolean
  /** Options keyed by `folder:<id>` or `thread:<id>`. */
  options: Record<string, OptionsState>
  threads: Record<string, ChatThreadState>
  /** Most recently opened first; bounds the cache. */
  recent: string[]
  /**
   * Set when text has been put in a thread's draft from outside the composer, so the composer that
   * shows it reads the draft again and takes focus. `caret` is where the added text ends. It stays
   * until a composer has taken it, so it does not matter whether the box was there yet.
   */
  draftReloads: Record<string, { id: number; caret: number }>

  /** Lets go of a draft reload a composer has taken, unless a newer one has been set since. */
  clearDraftReload: (threadId: string, id: number) => void
  init: () => () => void
  addFolder: (request: InboxAddFolderRequest) => Promise<InboxFolder>
  removeFolder: (id: string) => Promise<void>
  /** Reads the folders again, after main added or dropped one itself (a worktree was created or removed). */
  reloadFolders: () => Promise<void>
  setComposer: (patch: InboxComposerState) => void
  loadOptions: (key: { folderId: string } | { threadId: string }, force?: boolean) => Promise<void>
  createThread: (input: { folderId: string; text: string; agent: string; model: OpenCodeModelRef; attachmentIds?: string[]; draftRevision?: number; worktree?: { base: string; branch?: string } }) => Promise<InboxThread>
  openThread: (threadId: string) => () => void
  refresh: (threadId: string) => Promise<void>
  refreshRequests: (threadId: string) => Promise<void>
  loadOlder: (threadId: string) => Promise<void>
  send: (threadId: string, text: string, choice?: { agent?: string; model?: OpenCodeModelRef; attachmentIds?: string[]; draftRevision?: number; delivery?: ChatDelivery }) => Promise<void>
  interrupt: (threadId: string) => Promise<void>
  /**
   * Takes back a message OpenCode holds for the agent. It leaves the list at once; a rejection puts it
   * back and tells the reader why. One the agent took up in the meantime stays in the conversation.
   */
  discardPending: (threadId: string, messageId: string) => Promise<void>
  /**
   * Changes how a held message is delivered, steering or queued. It shows at once; a rejection puts the
   * old way back and tells the reader why. A message the agent took up in the meantime is shown in the
   * conversation by the next refetch.
   */
  setPendingDelivery: (threadId: string, messageId: string, delivery: ChatPendingMessage['delivery']) => Promise<void>
  /** Undoes a staged revert; the messages and files come back. A rejection leaves the thread as it was. */
  redo: (threadId: string) => Promise<void>
  /**
   * Reverts a thread to before one of its user messages and puts that message's text above whatever
   * is in the box. A rejection means nothing was reverted.
   */
  revert: (threadId: string, input: { messageId: string; text: string; files: boolean }) => Promise<void>
  /**
   * Forks a thread into a new one and opens it. Given a user message, the new thread starts from just
   * before it with its text in the box; otherwise it starts from the whole conversation, with the
   * text of an unfinished turn in the box when the fork was cut before one. The original is not
   * touched. A rejection means no thread was made.
   */
  forkThread: (threadId: string, input?: { messageId: string; text: string }) => Promise<InboxThread>
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
/**
 * When this app last changed the messages held for a thread's agent (sent one, took one back). A read
 * of the service that began before then cannot know of the change, so it does not get to undo it.
 */
const pendingChangedAt = new Map<string, number>()
/** Held messages whose way of delivery is being changed; a second change waits for the first to be answered. */
const switchingDelivery = new Set<string>()

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
    titleRegenerations: {},
    regenerateTitle: async (threadId) => {
      if (get().titleRegenerations[threadId]?.pending) return
      const patch = (pending: boolean, error: string | null): void => {
        set((state) => ({ titleRegenerations: { ...state.titleRegenerations, [threadId]: { pending, error } } }))
      }
      patch(true, null)
      try {
        await window.api.chat.regenerateTitle({ threadId })
        patch(false, null)
      } catch (error) {
        patch(false, ipcErrorMessage(error, 'Could not regenerate the title.'))
      }
    },
    folders: [],
    composer: {},
    foldersLoaded: false,
    options: {},
    threads: {},
    recent: [],
    draftReloads: {},

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

    reloadFolders: async () => {
      try {
        const state = await window.api.inbox.folders()
        if (state) set({ folders: state.folders, composer: state.composer })
      } catch {
        // The list on screen stays; the next start reads it again.
      }
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
      // A new worktree was added to the folder list by main, so that more threads can be started in it.
      if (input.worktree) void get().reloadFolders()
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
        const startedAt = Date.now()
        try {
          const page = await window.api.chat.messages({ threadId })
          // What was held when this read began is old news if this app changed it since.
          const read = (pendingChangedAt.get(threadId) ?? 0) >= startedAt ? undefined : page.pending
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
              usage: page.usage ?? thread.usage,
              revert: page.revert === undefined ? thread.revert : page.revert,
              pending: mergePending(thread.pending, read, messages),
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
      // Only a message sent to a busy agent is held; to an idle one it goes straight into the conversation.
      const busy = get().threads[threadId]?.running === true
      const held = await window.api.chat.send({ threadId, text, ...choice })
      const workspace = useWorkspace.getState()
      const record = workspace.inboxThreads.find((thread) => thread.id === threadId)
      if (record?.sendError) workspace.upsertInboxThread({ ...record, sendError: undefined })
      if (choice.agent || choice.model) {
        set((state) => ({
          composer: { ...state.composer, ...(choice.agent ? { agent: choice.agent } : {}), ...(choice.model ? { model: choice.model } : {}) },
        }))
      }
      // Shown at once, so it does not vanish from the box and reappear when the next refetch finds it.
      if (busy && held) pendingChangedAt.set(threadId, Date.now())
      patchThread(threadId, (thread) => ({
        running: true,
        notice: null,
        ...(busy && held && !thread.pending.some((entry) => entry.id === held.id) && !thread.messages.some((message) => message.id === held.id)
          ? { pending: [...thread.pending, held] }
          : {}),
      }))
      scheduleRefresh(threadId)
    },

    discardPending: async (threadId, messageId) => {
      const at = get().threads[threadId]?.pending.findIndex((entry) => entry.id === messageId) ?? -1
      const entry = at >= 0 ? get().threads[threadId]!.pending[at]! : undefined
      if (!entry) return
      pendingChangedAt.set(threadId, Date.now())
      patchThread(threadId, (thread) => ({ pending: thread.pending.filter((item) => item.id !== messageId) }))
      try {
        await window.api.chat.discardPending({ threadId, messageId })
      } catch (error) {
        pendingChangedAt.set(threadId, Date.now())
        patchThread(threadId, (thread) => ({
          pending: thread.pending.some((item) => item.id === messageId)
            ? thread.pending
            : [...thread.pending.slice(0, at), entry, ...thread.pending.slice(at)],
          notice: `The message could not be taken back: ${ipcErrorMessage(error, 'OpenCode did not answer.')}`,
        }))
      } finally {
        scheduleRefresh(threadId)
      }
    },

    setPendingDelivery: async (threadId, messageId, delivery) => {
      const entry = get().threads[threadId]?.pending.find((item) => item.id === messageId)
      if (!entry || entry.delivery === delivery || switchingDelivery.has(messageId)) return
      const before = entry.delivery
      const withDelivery = (value: ChatPendingMessage['delivery']) => (thread: ChatThreadState): Partial<ChatThreadState> => ({
        pending: thread.pending.map((item) => (item.id === messageId ? { ...item, delivery: value } : item)),
      })
      switchingDelivery.add(messageId)
      pendingChangedAt.set(threadId, Date.now())
      patchThread(threadId, withDelivery(delivery))
      try {
        await window.api.chat.setDelivery({ threadId, messageId, delivery })
      } catch (error) {
        pendingChangedAt.set(threadId, Date.now())
        patchThread(threadId, (thread) => ({
          ...withDelivery(before)(thread),
          notice: `The message could not be switched to ${delivery === 'queue' ? 'queued' : 'steering'}: ${ipcErrorMessage(error, 'OpenCode did not answer.')}`,
        }))
      } finally {
        switchingDelivery.delete(messageId)
        scheduleRefresh(threadId)
      }
    },

    interrupt: async (threadId) => {
      await window.api.chat.interrupt({ threadId })
    },

    redo: async (threadId) => {
      await window.api.chat.redo({ threadId })
      // The hidden messages were never dropped, so they are back at once; the service's events and
      // this refetch then confirm what it holds.
      patchThread(threadId, { revert: null, notice: null })
      scheduleRefresh(threadId)
    },

    revert: async (threadId, input) => {
      const revert = await window.api.chat.revert({ threadId, messageId: input.messageId, ...(input.files ? {} : { files: false }) })
      // The agent was stopped for this, and the messages stay loaded, only hidden.
      patchThread(threadId, { revert, running: false, notice: null })
      scheduleRefresh(threadId)
      if (!input.text.trim()) return
      // The text goes above whatever is in the box already. The revert has happened either way, so a
      // draft that cannot take the text is told to the reader, not thrown at the dialog that is closing.
      try {
        await window.api.chat.draft({ key: `thread:${threadId}`, action: 'prepend', text: input.text })
        set((state) => ({
          draftReloads: { ...state.draftReloads, [threadId]: { id: (state.draftReloads[threadId]?.id ?? 0) + 1, caret: input.text.length } },
        }))
      } catch (error) {
        patchThread(threadId, {
          notice: `The conversation was reverted, but the message could not be put back in the box: ${ipcErrorMessage(error, 'the draft could not be saved.')}`,
        })
      }
    },

    clearDraftReload: (threadId, id) => {
      set((state) => {
        if (state.draftReloads[threadId]?.id !== id) return {}
        const { [threadId]: _taken, ...rest } = state.draftReloads
        return { draftReloads: rest }
      })
    },

    forkThread: async (threadId, input) => {
      const result = await window.api.chat.fork({ threadId, ...(input ? { messageId: input.messageId } : {}) })
      const forkId = result.thread.id
      const workspace = useWorkspace.getState()
      workspace.upsertInboxThread(result.thread)
      workspace.selectInboxThread(forkId)
      const text = input?.text ?? result.text
      if (!text?.trim()) return result.thread
      // The new thread's box is shown by now, so it reads the draft again once the text is in it. The
      // fork has happened either way, so a draft that cannot take the text is told to the reader.
      try {
        await window.api.chat.draft({ key: `thread:${forkId}`, action: 'prepend', text })
        set((state) => ({
          draftReloads: { ...state.draftReloads, [forkId]: { id: (state.draftReloads[forkId]?.id ?? 0) + 1, caret: text.length } },
        }))
      } catch (error) {
        set((state) => ({ threads: { ...state.threads, [forkId]: { ...(state.threads[forkId] ?? emptyThread()), notice: `The thread was forked, but the message could not be put in its box: ${ipcErrorMessage(error, 'the draft could not be saved.')}` } } }))
      }
      return result.thread
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
      // An MCP server changed. It belongs to no thread, so it is passed on before the thread is looked up.
      if (event.type === 'mcp') {
        useInboxMcp.getState().refreshTarget(mcpTargetKey(event.target))
        return
      }
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
