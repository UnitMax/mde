import { create } from 'zustand'
import { getInboxFloatingTerminal, saveInboxFloatingTerminal } from '@/lib/inbox-settings'
import type { FloatingRect } from '@/lib/floating-window'
import { useInboxChanges } from '@/store/inbox-changes'
import { useWorkspace } from '@/store/workspace'

interface Store {
  /** The terminal is out of the sidebar and floats over the conversation. Kept between runs. */
  floating: boolean
  /** The floating window is on screen. It starts hidden on every run, so a restart never covers the conversation. */
  visible: boolean
  /** Where the window was left; null until it has been moved or resized. Kept between runs. */
  rect: FloatingRect | null
  /** The window fills the conversation area. Kept between runs. */
  maximized: boolean
  /** Takes the terminal out of the sidebar and shows it floating. */
  breakOut: () => void
  /** Puts the terminal back in the sidebar's Terminal tab. */
  dock: () => void
  /** Shows or hides the floating window (F11). Does nothing while the terminal is in the sidebar. */
  toggle: () => void
  hide: () => void
  show: () => void
  /** Dragging sets the place without keeping it; `settle` is for the last step, so storage is written once. */
  setRect: (rect: FloatingRect, settle?: boolean) => void
  toggleMaximized: () => void
}

/** Whether the Inbox's terminal floats, and the window it floats in. The shells are `useInboxTerminal`'s. */
export const useInboxFloatingTerminal = create<Store>((set, get) => {
  const saved = getInboxFloatingTerminal()
  const keep = (): void => {
    const { floating, rect, maximized } = get()
    saveInboxFloatingTerminal({ floating, rect, maximized })
  }
  return {
    floating: saved.floating,
    visible: false,
    rect: saved.rect,
    maximized: saved.maximized,

    breakOut: () => {
      set({ floating: true, visible: true })
      keep()
      // The sidebar would show a notice in place of the terminal, so offer it the files again.
      if (useInboxChanges.getState().tab === 'terminal') useInboxChanges.getState().setTab('files')
    },

    dock: () => {
      set({ floating: false, visible: false })
      keep()
      useWorkspace.setState({ fileTreeCollapsed: false })
      useInboxChanges.getState().setTab('terminal')
    },

    toggle: () => {
      if (get().floating) set({ visible: !get().visible })
    },
    hide: () => set({ visible: false }),
    show: () => {
      if (get().floating) set({ visible: true })
    },

    setRect: (rect, settle = true) => {
      set({ rect })
      if (settle) keep()
    },

    toggleMaximized: () => {
      set({ maximized: !get().maximized })
      keep()
    },
  }
})
