import { create } from 'zustand'
import type { ChatMcpRequest, ChatMcpServer, OpenCodeTarget } from '@shared/types'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { mcpKey, mcpTargetKey } from '@/lib/mcp'

/** Where MCP servers are asked about: a folder (new thread) or a thread, and the service and directory behind it. */
export interface McpPlace {
  request: ChatMcpRequest
  target: OpenCodeTarget
  directory: string
}

export interface McpEntry {
  /** `ready` once a list has been read; the list is kept when a later read fails. */
  state: 'loading' | 'ready' | 'error' | 'unsupported'
  servers: ChatMcpServer[]
  /** The server names, the same array until the set of names changes, so that views using it do not redraw. */
  names: string[]
  /** Servers being switched right now. Their listed state is not believed until the switch has settled. */
  busy: Record<string, 'connecting' | 'disconnecting'>
  /** Why the last switch of a server failed. */
  rowError: Record<string, string>
  loadedAt: number
}

interface McpStore {
  entries: Record<string, McpEntry>
  /** Reads the list for a place (at most once every few seconds unless `force`d). */
  load: (place: McpPlace, force?: boolean) => Promise<void>
  /** Connects or disconnects a server, then reads the list again. */
  setEnabled: (place: McpPlace, server: string, enabled: boolean) => Promise<void>
  /** Reads again every watched place of a service; used when one of its servers changed. */
  refreshTarget: (targetKey: string, except?: string) => void
  /** Keeps a place's list fresh (on focus, on events, while a server connects) until the returned function is called. */
  watch: (place: McpPlace) => () => void
}

const FRESH_MS = 3000
const FOCUS_MS = 5000
const EVENT_DELAY_MS = 200
const SETTLE_MS = 1500
const SETTLE_TRIES = 20

const watchers = new Map<string, Map<symbol, McpPlace>>()
const inflight = new Map<string, Promise<void>>()
/**
 * Bumped when a switch starts and when it settles. A read that began before cannot know what the switch did, so
 * it does not get to put its (older) answer on screen; the list is read again instead.
 */
const revisions = new Map<string, number>()
const settleTimers = new Map<string, ReturnType<typeof setTimeout>>()
const settleTries = new Map<string, number>()
const eventTimers = new Map<string, ReturnType<typeof setTimeout>>()
let focusAttached = false
let lastFocus = 0

const EMPTY: McpEntry = { state: 'loading', servers: [], names: [], busy: {}, rowError: {}, loadedAt: 0 }

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index])
}

function placeOf(key: string): McpPlace | null {
  const places = watchers.get(key)
  if (!places) return null
  return [...places.values()].at(-1) ?? null
}

export const useInboxMcp = create<McpStore>((set, get) => {
  const patch = (key: string, change: (entry: McpEntry) => Partial<McpEntry>): void => {
    set((state) => {
      const entry = state.entries[key] ?? EMPTY
      return { entries: { ...state.entries, [key]: { ...entry, ...change(entry) } } }
    })
  }

  /** A server that is still connecting is looked at again soon, because the stream of events may not be open. */
  const settle = (key: string, place: McpPlace, entry: McpEntry): void => {
    const timer = settleTimers.get(key)
    if (timer) clearTimeout(timer)
    settleTimers.delete(key)
    const connecting = entry.servers.some((server) => server.status === 'connecting')
    if (!connecting) {
      settleTries.delete(key)
      return
    }
    const tries = (settleTries.get(key) ?? 0) + 1
    if (tries > SETTLE_TRIES) return
    settleTries.set(key, tries)
    settleTimers.set(key, setTimeout(() => {
      settleTimers.delete(key)
      if (watchers.has(key)) void get().load(placeOf(key) ?? place, true)
    }, SETTLE_MS))
  }

  return {
    entries: {},

    load: (place, force = false) => {
      const key = mcpKey(place.target, place.directory)
      const entry = get().entries[key]
      if (!force && entry?.state === 'ready' && Date.now() - entry.loadedAt < FRESH_MS) return Promise.resolve()
      const running = inflight.get(key)
      if (running) return running
      if (!entry) patch(key, () => ({}))
      const read = async (): Promise<void> => {
        // A read that a switch overtook is made again, so the caller's promise ends with the list as it is now.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const revision = revisions.get(key) ?? 0
          let state
          try {
            // A missing method (an older build, a test without it) is a failed read, which hides the chip.
            state = await Promise.resolve().then(() => window.api.chat.mcp(place.request))
          } catch {
            // The list on screen stays (stale); the next focus, event or open reads again.
            patch(key, (current) => ({ state: current.servers.length > 0 ? current.state : 'error' }))
            return
          }
          if ((revisions.get(key) ?? 0) !== revision) continue
          if (!state.supported) {
            patch(key, () => ({ state: 'unsupported', servers: [], names: [], loadedAt: Date.now() }))
            return
          }
          const names = state.servers.map((server) => server.name)
          patch(key, (current) => ({
            state: 'ready',
            servers: state.servers,
            names: sameNames(current.names, names) ? current.names : names,
            loadedAt: Date.now(),
          }))
          settle(key, place, get().entries[key] ?? EMPTY)
          return
        }
      }
      const run: Promise<void> = read().finally(() => {
        if (inflight.get(key) === run) inflight.delete(key)
      })
      inflight.set(key, run)
      return run
    },

    setEnabled: async (place, server, enabled) => {
      const key = mcpKey(place.target, place.directory)
      if (get().entries[key]?.busy[server]) return
      revisions.set(key, (revisions.get(key) ?? 0) + 1)
      patch(key, (entry) => {
        const { [server]: _cleared, ...rowError } = entry.rowError
        return { busy: { ...entry.busy, [server]: enabled ? 'connecting' : 'disconnecting' }, rowError }
      })
      try {
        await Promise.resolve().then(() => window.api.chat.setMcp({ ...place.request, server, enabled }))
      } catch (error) {
        patch(key, (entry) => ({ rowError: { ...entry.rowError, [server]: ipcErrorMessage(error, 'Could not change this server.') } }))
      } finally {
        revisions.set(key, (revisions.get(key) ?? 0) + 1)
      }
      // Whatever happened, the list OpenCode gives now is the truth; a timeout may still have connected the server.
      await get().load(place, true)
      patch(key, (entry) => {
        const { [server]: _done, ...busy } = entry.busy
        return { busy }
      })
      get().refreshTarget(mcpTargetKey(place.target), key)
    },

    refreshTarget: (targetKey, except) => {
      for (const [key] of watchers) {
        if (key === except || !key.startsWith(`${targetKey}\n`)) continue
        const timer = eventTimers.get(key)
        if (timer) clearTimeout(timer)
        eventTimers.set(key, setTimeout(() => {
          eventTimers.delete(key)
          const place = placeOf(key)
          if (place) void get().load(place, true)
        }, EVENT_DELAY_MS))
      }
    },

    watch: (place) => {
      const key = mcpKey(place.target, place.directory)
      const id = Symbol(key)
      let places = watchers.get(key)
      if (!places) watchers.set(key, (places = new Map()))
      places.set(id, place)
      if (!focusAttached && typeof window !== 'undefined') {
        focusAttached = true
        window.addEventListener('focus', () => {
          if (Date.now() - lastFocus < FOCUS_MS || document.visibilityState === 'hidden') return
          lastFocus = Date.now()
          for (const [watched] of watchers) {
            const current = placeOf(watched)
            if (current) void get().load(current, true)
          }
        })
      }
      void get().load(place)
      return () => {
        const current = watchers.get(key)
        current?.delete(id)
        if (current && current.size === 0) {
          watchers.delete(key)
          const timer = settleTimers.get(key)
          if (timer) clearTimeout(timer)
          settleTimers.delete(key)
          settleTries.delete(key)
          const event = eventTimers.get(key)
          if (event) clearTimeout(event)
          eventTimers.delete(key)
        }
      }
    },
  }
})
