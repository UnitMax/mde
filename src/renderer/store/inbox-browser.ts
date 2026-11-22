import { create } from 'zustand'
import type { BrowserAction, BrowserHistoryEntry, BrowserState } from '@shared/browser'
import { ipcErrorMessage } from '@/lib/ipc-error'

const EMPTY: BrowserState = { enabled: false, webrtc: false, webrtcUnsaved: false, tabs: [], activeId: null, allowedHosts: [], unsavedRemovals: [] }

interface Store {
  /** The browser as the main process last reported it. */
  state: BrowserState
  /** Whether it has been read from the main process yet. */
  loaded: boolean
  /** The last call that failed (the tab limit, an address that is not a web address), or null. */
  error: string | null
  /** The pages opened in the browser, newest first, as last read for the address field. */
  history: BrowserHistoryEntry[]
  /** Reads the history again; the address field does when it offers it. */
  loadHistory: () => Promise<void>
  clearError: () => void
  /** Reads the browser and follows its changes; once per page. */
  init: () => void
  setEnabled: (enabled: boolean) => Promise<boolean>
  setWebRTC: (allowed: boolean) => Promise<boolean>
  open: (url: string) => Promise<boolean>
  newTab: () => Promise<void>
  navigate: (tabId: string, url: string) => Promise<void>
  act: (tabId: string, action: BrowserAction) => Promise<void>
  select: (tabId: string) => Promise<void>
  close: (tabId: string) => Promise<void>
  allowHost: (host: string) => Promise<boolean>
  removeHost: (host: string) => Promise<void>
  /** True only when all of the browsing data was cleared. */
  clearData: () => Promise<boolean>
}

let following = false

/** The MDE browser's tabs and allowed hosts, kept by the main process and mirrored here. */
export const useInboxBrowser = create<Store>((set, get) => {
  // Every call answers with the whole state; one that fails says why in `error`.
  const run = async (call: () => Promise<BrowserState | void>): Promise<boolean> => {
    try {
      const next = await call()
      set(next ? { state: next, loaded: true, error: null } : { error: null })
      return true
    } catch (error) {
      set({ error: ipcErrorMessage(error, 'The MDE browser could not do that.') })
      return false
    }
  }
  return {
    state: EMPTY,
    loaded: false,
    error: null,
    history: [],
    loadHistory: async () => {
      try {
        set({ history: await window.api.browser.history() })
      } catch {
        // The history is only a convenience; the field works without it.
      }
    },
    clearError: () => set({ error: null }),
    init: () => {
      if (following || typeof window === 'undefined' || !window.api?.browser) return
      following = true
      window.api.browser.onChanged((state) => set({ state, loaded: true }))
      void window.api.browser.state().then((state) => set({ state, loaded: true }), () => undefined)
    },
    setEnabled: (enabled) => run(() => window.api.browser.setEnabled(enabled)),
    setWebRTC: (allowed) => run(() => window.api.browser.setWebRTC(allowed)),
    open: (url) => {
      get().init()
      return run(() => window.api.browser.open(url))
    },
    newTab: async () => { await run(() => window.api.browser.newTab()) },
    navigate: async (tabId, url) => { await run(() => window.api.browser.navigate(tabId, url)) },
    act: async (tabId, action) => { await run(() => window.api.browser.act(tabId, action)) },
    select: async (tabId) => { await run(() => window.api.browser.select(tabId)) },
    close: async (tabId) => { await run(() => window.api.browser.close(tabId)) },
    allowHost: (host) => run(() => window.api.browser.allowHost(host)),
    removeHost: async (host) => { await run(() => window.api.browser.removeHost(host)) },
    clearData: async () => {
      const cleared = await run(() => window.api.browser.clearData())
      // Even when a part failed, the history may be gone; what is left is read again next time.
      set({ history: [] })
      return cleared
    },
  }
})
