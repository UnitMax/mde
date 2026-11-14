import { create } from 'zustand'

/** The colour a toast takes, the same tones as the Inbox status chips. */
export type ToastTone = 'ok' | 'accent' | 'danger' | 'muted'

/** The picture at a toast's side; the component maps each to an icon. */
export type ToastIcon =
  | 'done'
  | 'input'
  | 'permission'
  | 'failed'
  | 'woke'
  | 'background'
  | 'agent-thread'
  | 'agent-terminal'
  | 'approval'

export interface ToastInput {
  /** A toast with the same key takes the place of the one already shown, so one thread never stacks up. */
  key?: string
  tone: ToastTone
  icon: ToastIcon
  /** The kind of news, small and coloured: "Done", "Needs input". */
  label: string
  /** What it is about, such as the thread's title. */
  title: string
  /** A quieter second line, such as the project. */
  detail?: string
  /** What a click on the toast does; the toast goes away after it. */
  onOpen?: () => void
  /** Milliseconds on screen while the window is in use and the pointer is not over the toasts. */
  duration?: number
}

export interface Toast extends ToastInput {
  id: string
  duration: number
  /** Set while it plays its way out. */
  leaving?: boolean
}

/** Toasts on screen at once; an older one goes when a new one comes. */
export const TOAST_LIMIT = 4
export const TOAST_DURATION_MS = 6000
/** How long a toast takes to play its way out. */
export const TOAST_LEAVE_MS = 180

interface Store {
  toasts: Toast[]
  show: (toast: ToastInput) => string
  /** Lets a toast play its way out, then removes it. */
  dismiss: (id: string) => void
  clear: () => void
}

let counter = 0

/** The toasts on screen. There is no history: a toast that goes is gone. */
export const useToasts = create<Store>((set, get) => ({
  toasts: [],

  show: (input) => {
    counter += 1
    const toast: Toast = { ...input, id: `toast-${counter}`, duration: input.duration ?? TOAST_DURATION_MS }
    set((state) => {
      const others = state.toasts.filter((item) => !(input.key && item.key === input.key))
      // Ones already on their way out do not count against the limit; they are about to go.
      const staying = others.filter((item) => !item.leaving)
      const drop = new Set(staying.slice(0, Math.max(0, staying.length - (TOAST_LIMIT - 1))).map((item) => item.id))
      return { toasts: [...others.filter((item) => !drop.has(item.id)), toast] }
    })
    return toast.id
  },

  dismiss: (id) => {
    const toast = get().toasts.find((item) => item.id === id)
    if (!toast || toast.leaving) return
    set((state) => ({ toasts: state.toasts.map((item) => (item.id === id ? { ...item, leaving: true } : item)) }))
    window.setTimeout(() => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })), TOAST_LEAVE_MS)
  },

  clear: () => set({ toasts: [] }),
}))
