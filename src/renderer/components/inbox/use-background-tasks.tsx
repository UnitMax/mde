import { useEffect, useRef, useState } from 'react'
import type { ChatBackgroundState } from '@shared/types'
import { ipcErrorMessage } from '@/lib/ipc-error'

export const BACKGROUND_REFRESH_MS = 5000

interface State {
  snapshot: ChatBackgroundState | null
  error: string | null
}

/** Watch only the visible thread. Poll even when the agent is idle, and reconcile missed stream events. */
export function useBackgroundTasks(threadId: string) {
  const [state, setState] = useState<State>({ snapshot: null, error: null })
  const control = useRef<{ refresh(): Promise<void> }>()

  useEffect(() => {
    // Also allows a renderer left open during an update to keep working with an older preload.
    if (!window.api.chat.backgroundTasks) return undefined
    let disposed = false
    let supported = true
    let again = false
    let pending: Promise<void> | null = null
    const patch = (change: Partial<State>): void => { if (!disposed) setState((current) => ({ ...current, ...change })) }
    const refresh = (): Promise<void> => {
      again = true
      if (pending) return pending
      pending = (async () => {
        while (again && !disposed) {
          again = false
          try {
            const snapshot = await window.api.chat.backgroundTasks({ threadId })
            if (disposed) return
            supported = snapshot.supported
            patch({ snapshot, error: null })
          } catch (error) {
            patch({ error: ipcErrorMessage(error, 'Could not check background tasks.') })
          }
        }
      })().finally(() => { pending = null })
      return pending
    }
    control.current = { refresh }
    const focus = (): void => { if (document.visibilityState !== 'hidden') void refresh() }
    const unsubscribe = window.api.chat.onEvent?.((event) => {
      if ('threadId' in event && event.threadId === threadId &&
        (event.type === 'background' || event.type === 'reconnected' || event.type === 'running' || event.type === 'messages')) void refresh()
    })
    const timer = setInterval(() => { if (supported && document.visibilityState !== 'hidden') void refresh() }, BACKGROUND_REFRESH_MS)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    void refresh()
    return () => {
      disposed = true
      control.current = undefined
      clearInterval(timer)
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
      unsubscribe?.()
    }
  }, [threadId])

  return {
    ...state,
    refresh: () => { void control.current?.refresh() },
  }
}
