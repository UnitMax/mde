import type { InboxThread } from '@shared/types'
import { useInboxChat } from '@/store/inbox-chat'
import { useToasts } from '@/store/toasts'
import { useWorkspace } from '@/store/workspace'
import { ALERT_SETTINGS_CHANGE_EVENT, getAlertSettings } from './alert-settings'
import { notify, spawnedThreadToast, threadDisplayTitle, threadToast } from './toasts'

function projectName(thread: InboxThread): string | undefined {
  return useInboxChat.getState().folders.find((folder) => folder.id === thread.folderId)?.name
}

/**
 * Starts showing toasts for the Inbox threads: one finished, failed, needs input or woke up, or an agent started
 * one. Other toasts (a chat started in the background, a terminal an agent opened) come from where those happen.
 * Returns what stops it.
 */
export function startToasts(): () => void {
  const unsubscribe = useWorkspace.subscribe((state, previousState) => {
    if (state.inboxThreads === previousState.inboxThreads) return
    // The first list is what was there before MDE started, not news.
    if (!previousState.ready || !state.ready) return
    const before = new Map<string, InboxThread>(previousState.inboxThreads.map((thread) => [thread.id, thread]))
    for (const thread of state.inboxThreads) {
      const previous = before.get(thread.id)
      if (previous === thread) continue
      const project = projectName(thread)
      if (previous) {
        const toast = threadToast(previous, thread, { project })
        if (toast) notify(toast)
        continue
      }
      const parentId = thread.spawnedBy?.threadId
      const parent = parentId ? state.inboxThreads.find((item) => item.id === parentId) : undefined
      const toast = spawnedThreadToast(thread, Date.now(), { project, ...(parent ? { parentTitle: threadDisplayTitle(parent) } : {}) })
      if (toast) notify(toast)
    }
  })

  // Turning them off takes away the ones on screen too; so does going to the mini window.
  const settingsChanged = (): void => {
    if (!getAlertSettings().toasts) useToasts.getState().clear()
  }
  const unsubscribeMode = useWorkspace.subscribe((state, previousState) => {
    if (state.windowMode !== previousState.windowMode && state.windowMode !== 'normal') useToasts.getState().clear()
  })
  window.addEventListener(ALERT_SETTINGS_CHANGE_EVENT, settingsChanged)

  return () => {
    unsubscribe()
    unsubscribeMode()
    window.removeEventListener(ALERT_SETTINGS_CHANGE_EVENT, settingsChanged)
  }
}
