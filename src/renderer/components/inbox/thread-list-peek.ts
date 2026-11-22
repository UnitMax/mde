import { useEffect, useRef, useState, type FocusEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useInboxDrafts } from '@/store/inbox-drafts'
import { useWorkspace } from '@/store/workspace'

/** How long the pointer rests on the window's left edge before the hidden thread list slides in. */
export const THREAD_LIST_PEEK_OPEN_DELAY = 100
/** How long the pointer may be away from the shown list before it slides out again. */
export const THREAD_LIST_PEEK_CLOSE_DELAY = 300

const typing = (element: Element | null): boolean =>
  element instanceof HTMLElement && (element.matches('input, textarea, select') || element.isContentEditable)

export interface ThreadListPeek {
  /** The list is shown over the conversation for now. */
  shown: boolean
  edge: {
    onPointerEnter(event: ReactPointerEvent<HTMLElement>): void
    onPointerLeave(): void
  }
  list: {
    ref(element: HTMLElement | null): void
    onPointerEnter(): void
    onPointerLeave(): void
    onBlur(event: FocusEvent<HTMLElement>): void
  }
}

/**
 * While the Inbox thread list is hidden, resting the pointer on the left edge shows it over the conversation, like
 * a hidden Dock. It goes again when the pointer leaves it, unless a text field in it has the keyboard, and as soon as
 * a thread, a draft or a new thread is opened. Nothing is saved: only the thread list button shows it for good.
 */
export function useThreadListPeek(hidden: boolean): ThreadListPeek {
  const [shown, setShown] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inside = useRef(false)
  const listElement = useRef<HTMLElement | null>(null)

  const clear = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const hide = (): void => {
    clear()
    inside.current = false
    setShown(false)
    // Whatever in the list had the keyboard is out of sight now.
    const active = document.activeElement
    if (active instanceof HTMLElement && listElement.current?.contains(active)) active.blur()
  }
  const later = (run: () => void, delay: number): void => {
    clear()
    timer.current = setTimeout(() => {
      timer.current = null
      run()
    }, delay)
  }

  useEffect(() => {
    if (!hidden) {
      clear()
      inside.current = false
      setShown(false)
    }
  }, [hidden])
  useEffect(() => clear, [])

  // Opening something from the list is what the peek was for, so it goes away.
  useEffect(() => {
    if (!shown) return
    const stopThreads = useWorkspace.subscribe((state, previous) => {
      if (state.selectedInboxThreadId !== previous.selectedInboxThreadId) hide()
    })
    const stopDrafts = useInboxDrafts.subscribe((state, previous) => {
      if (state.page.id !== previous.page.id || state.page.opened !== previous.page.opened) hide()
    })
    return () => {
      stopThreads()
      stopDrafts()
    }
  }, [shown])

  return {
    shown: hidden && shown,
    edge: {
      onPointerEnter: (event) => {
        // A drag that passes the edge (a selection, a divider) is not asking for the list.
        if (!hidden || event.buttons !== 0) return
        later(() => setShown(true), THREAD_LIST_PEEK_OPEN_DELAY)
      },
      onPointerLeave: () => {
        if (!inside.current) clear()
      },
    },
    list: {
      ref: (element) => {
        listElement.current = element
      },
      onPointerEnter: () => {
        inside.current = true
        clear()
      },
      onPointerLeave: () => {
        inside.current = false
        if (!shown) return
        if (typing(document.activeElement) && listElement.current?.contains(document.activeElement)) return
        later(hide, THREAD_LIST_PEEK_CLOSE_DELAY)
      },
      onBlur: (event) => {
        const next = event.relatedTarget
        if (!shown || inside.current || (next instanceof Node && event.currentTarget.contains(next))) return
        later(hide, THREAD_LIST_PEEK_CLOSE_DELAY)
      },
    },
  }
}
