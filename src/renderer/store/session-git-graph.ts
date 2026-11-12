import { create } from 'zustand'

interface Store {
  /** The terminal whose checkout the Sessions Git graph shows, laid over that session's terminals. */
  terminalId: string | null
  /** Opens the graph for a terminal, or closes it when that terminal's graph is already open. */
  toggle: (terminalId: string) => void
  close: () => void
}

export const useSessionGitGraph = create<Store>((set, get) => ({
  terminalId: null,
  toggle: (terminalId) => set({ terminalId: get().terminalId === terminalId ? null : terminalId }),
  close: () => set({ terminalId: null }),
}))
