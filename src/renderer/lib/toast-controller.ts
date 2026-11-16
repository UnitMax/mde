import type { InboxThread } from '@shared/types'
import { useInboxChat } from '@/store/inbox-chat'
import { useToasts } from '@/store/toasts'
import { useWorkspace } from '@/store/workspace'
import { ALERT_SETTINGS_CHANGE_EVENT, getAlertSettings } from './alert-settings'
import { automationThreadToast, notify, spawnedThreadToast, threadDisplayTitle, threadToast, titleErrorToastKey } from './toasts'

function projectName(thread: InboxThread): string | undefined {
  return useInboxChat.getState().folders.find((folder) => folder.id === thread.folderId)?.name
}

/**
 * Starts showing toasts for the Inbox threads: one finished, failed, needs input or woke up, or an agent started
 * one, or an automation did. Other toasts (a chat started in the background, a terminal an agent opened) come from where those happen.
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
        // OpenCode can still rename the thread after the request for it gave up waiting; the new title answers it.
        if (previous.title !== thread.title) useToasts.getState().dismissKey(titleErrorToastKey(thread.id))
        const toast = threadToast(previous, thread, { project })
        if (toast) notify(toast)
        continue
      }
      const parentId = thread.spawnedBy?.threadId
      const parent = parentId ? state.inboxThreads.find((item) => item.id === parentId) : undefined
      const toast = spawnedThreadToast(thread, Date.now(), { project, ...(parent ? { parentTitle: threadDisplayTitle(parent) } : {}) })
        ?? automationThreadToast(thread, Date.now(), { project })
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
