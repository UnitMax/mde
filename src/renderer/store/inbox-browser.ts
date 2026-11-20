import { create } from 'zustand'
import type { BrowserAction, BrowserState } from '@shared/browser'
import { ipcErrorMessage } from '@/lib/ipc-error'

const EMPTY: BrowserState = { tabs: [], activeId: null, allowedHosts: [] }

interface Store {
  /** The browser as the main process last reported it. */
  state: BrowserState
  /** Whether it has been read from the main process yet. */
  loaded: boolean
  /** The last call that failed (the tab limit, an address that is not a web address), or null. */
  error: string | null
  clearError: () => void
  /** Reads the browser and follows its changes; once per page. */
  init: () => void
  open: (url: string) => Promise<boolean>
  newTab: () => Promise<void>
  navigate: (tabId: string, url: string) => Promise<void>
  act: (tabId: string, action: BrowserAction) => Promise<void>
  select: (tabId: string) => Promise<void>
  close: (tabId: string) => Promise<void>
  allowHost: (host: string) => Promise<boolean>
  removeHost: (host: string) => Promise<void>
  clearData: () => Promise<void>
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
    clearError: () => set({ error: null }),
    init: () => {
      if (following || typeof window === 'undefined' || !window.api?.browser) return
      following = true
      window.api.browser.onChanged((state) => set({ state, loaded: true }))
      void window.api.browser.state().then((state) => set({ state, loaded: true }), () => undefined)
    },
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
    clearData: async () => { await run(() => window.api.browser.clearData()) },
  }
})
