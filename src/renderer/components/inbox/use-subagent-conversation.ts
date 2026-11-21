import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@shared/types'
import { ipcErrorMessage } from '@/lib/ipc-error'

export interface SubagentConversation {
  messages: ChatMessage[]
  /** Cursor for the page before the oldest loaded one; null when the conversation is loaded from its start. */
  older: string | null
  running: boolean
  loading: boolean
  loadingOlder: boolean
  error: string | null
}

const EMPTY: SubagentConversation = { messages: [], older: null, running: false, loading: true, loadingOlder: false, error: null }

/**
 * The newest page put together with what was already loaded: messages older than the page stay, everything the page
 * holds is taken from it. Message IDs sort in the order they were made.
 */
export function mergeNewestPage(loaded: readonly ChatMessage[], page: readonly ChatMessage[], pageIsComplete: boolean): ChatMessage[] {
  if (pageIsComplete || page.length === 0) return [...page]
  const first = page[0]!.id
  return [...loaded.filter((message) => message.id < first), ...page]
}

/**
 * A subagent's conversation, read-only: read through its thread (the main process checks the subagent belongs to it),
 * read again whenever OpenCode tells of a change in it, and paged back on request.
 */
export function useSubagentConversation(threadId: string, sessionId: string) {
  const [state, setState] = useState<SubagentConversation>(EMPTY)
  const current = useRef(state)
  current.current = state
  const control = useRef<{ refresh(): void; loadOlder(): Promise<void> }>()

  useEffect(() => {
    setState(EMPTY)
    let disposed = false
    let again = false
    let pending: Promise<void> | null = null
    const patch = (change: Partial<SubagentConversation>): void => {
      if (!disposed) setState((now) => ({ ...now, ...change }))
    }
    const refresh = (): void => {
      again = true
      if (pending) return
      pending = (async () => {
        while (again && !disposed) {
          again = false
          try {
            const page = await window.api.chat.messages({ threadId, sessionId })
            if (disposed) return
            setState((now) => ({
              ...now,
              messages: mergeNewestPage(now.messages, page.messages, page.older === null),
              // A first read, or a page that reaches the start, says what is older; otherwise pages loaded further back
              // keep their cursor.
              older: now.messages.length === 0 || page.older === null ? page.older : now.older,
              running: page.running,
              loading: false,
              error: null,
            }))
          } catch (error) {
            patch({ loading: false, error: ipcErrorMessage(error, 'Could not load the subagent’s conversation.') })
          }
        }
      })().finally(() => { pending = null })
    }
    const loadOlder = async (): Promise<void> => {
      const cursor = current.current.older
      if (!cursor || current.current.loadingOlder) return
      patch({ loadingOlder: true })
      try {
        const page = await window.api.chat.messages({ threadId, sessionId, cursor })
        if (disposed) return
        setState((now) => {
          const first = now.messages[0]?.id
          const older = first ? page.messages.filter((message) => message.id < first) : page.messages
          return { ...now, messages: [...older, ...now.messages], older: page.older, loadingOlder: false }
        })
      } catch (error) {
        patch({ loadingOlder: false, error: ipcErrorMessage(error, 'Could not load earlier messages.') })
      }
    }
    control.current = { refresh, loadOlder }
    const unsubscribe = window.api.chat.onEvent?.((event) => {
      if (event.type === 'subagent' && event.threadId === threadId && event.sessionId === sessionId) refresh()
      else if (event.type === 'reconnected' && event.threadId === threadId) refresh()
    })
    // Its changes are passed on only once the main process has checked it belongs to the thread; a refusal is told.
    let watching = false
    window.api.chat.watchSubagent?.({ threadId, sessionId })
      .then(() => {
        if (disposed) void window.api.chat.unwatchSubagent?.({ threadId, sessionId })
        else watching = true
      })
      .catch(() => { /* The read below fails the same way and says why. */ })
    refresh()
    return () => {
      disposed = true
      control.current = undefined
      unsubscribe?.()
      if (watching) void window.api.chat.unwatchSubagent?.({ threadId, sessionId })
    }
  }, [threadId, sessionId])

  return {
    ...state,
    refresh: useCallback(() => control.current?.refresh(), []),
    loadOlder: useCallback(() => control.current?.loadOlder() ?? Promise.resolve(), []),
  }
}
