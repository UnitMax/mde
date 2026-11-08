import type { InboxThread } from '@shared/types'
import { useWorkspace } from '@/store/workspace'
import { createAlerts } from './alerts'
import { ALERT_SETTINGS_CHANGE_EVENT, getAlertSettings } from './alert-settings'
import { playAlertChoice } from './alert-sound'

/**
 * Starts telling the person about the threads: a sound and a flash when one finishes, fails or needs them, and the
 * colour and badge on the taskbar button while they are away. Returns what stops it.
 */
export function startAlerts(): () => void {
  const alerts = createAlerts({
    settings: getAlertSettings,
    threads: () => useWorkspace.getState().inboxThreads,
    focused: () => document.hasFocus(),
    viewing: (threadId) => {
      const state = useWorkspace.getState()
      return state.windowMode === 'normal' && state.activeWorkspaceView === 'inbox' && state.selectedInboxThreadId === threadId
    },
    now: () => Date.now(),
    play: playAlertChoice,
    send: (request) => {
      void window.api.attention.update(request).catch(() => {})
    }
  })

  const unsubscribe = useWorkspace.subscribe((state, previousState) => {
    if (state.inboxThreads === previousState.inboxThreads) return
    const before = new Map<string, InboxThread>(previousState.inboxThreads.map((thread) => [thread.id, thread]))
    for (const thread of state.inboxThreads) {
      const previous = before.get(thread.id)
      if (previous !== thread) alerts.threadChanged(previous, thread)
    }
    alerts.refresh()
  })
  const refresh = (): void => alerts.refresh()
  window.addEventListener('focus', refresh)
  window.addEventListener('blur', refresh)
  window.addEventListener(ALERT_SETTINGS_CHANGE_EVENT, refresh)
  refresh()

  return () => {
    unsubscribe()
    window.removeEventListener('focus', refresh)
    window.removeEventListener('blur', refresh)
    window.removeEventListener(ALERT_SETTINGS_CHANGE_EVENT, refresh)
  }
}
