import { create } from 'zustand'
import {
  getInboxFloatingTerminal,
  INBOX_BOTTOM_TERMINAL_MIN_HEIGHT,
  saveInboxFloatingTerminal,
  type InboxTerminalPlacement,
} from '@/lib/inbox-settings'
import type { FloatingRect } from '@/lib/floating-window'
import { useInboxChanges } from '@/store/inbox-changes'
import { useWorkspace } from '@/store/workspace'

interface Store {
  /** Where the terminal is: the sidebar's Terminal tab, the panel below the conversation, or floating. Kept between runs. */
  placement: InboxTerminalPlacement
  /** The terminal is out of the sidebar and floats over the conversation (`placement === 'floating'`). */
  floating: boolean
  /**
   * The bottom panel or the floating window is on screen (F11 shows and hides either). The floating window starts
   * hidden on every run, so a restart never covers the conversation; the bottom panel covers nothing and starts shown.
   */
  visible: boolean
  /** Where the window was left; null until it has been moved or resized. Kept between runs. */
  rect: FloatingRect | null
  /** The window fills the conversation area. Kept between runs. */
  maximized: boolean
  /** The bottom panel's height in pixels. Kept between runs. */
  bottomHeight: number
  /** Moves the terminal to `placement` and shows it there. */
  place: (placement: InboxTerminalPlacement) => void
  /** Takes the terminal out of the sidebar and shows it floating. */
  breakOut: () => void
  /** Puts the terminal back in the sidebar's Terminal tab. */
  dock: () => void
  /** Shows or hides the floating window or the bottom panel (F11). Does nothing while the terminal is in the sidebar. */
  toggle: () => void
  hide: () => void
  show: () => void
  /** Dragging sets the place without keeping it; `settle` is for the last step, so storage is written once. */
  setRect: (rect: FloatingRect, settle?: boolean) => void
  toggleMaximized: () => void
  /** Like `setRect`, for the bottom panel's height. */
  setBottomHeight: (height: number, settle?: boolean) => void
}

/** Where the Inbox's terminal is, and the window or panel it is in outside the sidebar. The shells are `useInboxTerminal`'s. */
export const useInboxFloatingTerminal = create<Store>((set, get) => {
  const saved = getInboxFloatingTerminal()
  const keep = (): void => {
    const { placement, rect, maximized, bottomHeight } = get()
    saveInboxFloatingTerminal({ placement, rect, maximized, bottomHeight })
  }
  const place = (placement: InboxTerminalPlacement): void => {
    set({ placement, floating: placement === 'floating', visible: placement !== 'sidebar' })
    keep()
    if (placement === 'sidebar') {
      useWorkspace.setState({ fileTreeCollapsed: false })
      useInboxChanges.getState().setTab('terminal')
    } else if (useInboxChanges.getState().tab === 'terminal') {
      // The sidebar would show a notice in place of the terminal, so offer it the files again.
      useInboxChanges.getState().setTab('files')
    }
  }
  return {
    placement: saved.placement,
    floating: saved.placement === 'floating',
    visible: saved.placement === 'bottom',
    rect: saved.rect,
    maximized: saved.maximized,
    bottomHeight: saved.bottomHeight,

    place,
    breakOut: () => place('floating'),
    dock: () => place('sidebar'),

    toggle: () => {
      if (get().placement !== 'sidebar') set({ visible: !get().visible })
    },
    hide: () => set({ visible: false }),
    show: () => {
      if (get().placement !== 'sidebar') set({ visible: true })
    },

    setRect: (rect, settle = true) => {
      set({ rect })
      if (settle) keep()
    },

    toggleMaximized: () => {
      set({ maximized: !get().maximized })
      keep()
    },

    setBottomHeight: (height, settle = true) => {
      set({ bottomHeight: Math.max(INBOX_BOTTOM_TERMINAL_MIN_HEIGHT, Math.round(height)) })
      if (settle) keep()
    },
  }
})
