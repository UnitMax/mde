import type { InboxThread } from '@shared/types'
import { useToasts, type ToastInput } from '@/store/toasts'
import { useWorkspace } from '@/store/workspace'
import { alertKind } from './alerts'
import { getAlertSettings } from './alert-settings'

/** Toasts that ask for the person (a question, a failure) stay longer than news. */
export const TOAST_URGENT_DURATION_MS = 10_000
/** A thread that appears this long after it was made is one loaded from disk, not one an agent just started. */
const FRESH_THREAD_MS = 2 * 60 * 1000

/**
 * Shows a toast unless they are turned off. The mini window has no room for them, and it lists the threads
 * already, so nothing is shown (or saved for later) while MDE is in it.
 */
export function notify(toast: ToastInput): void {
  if (!getAlertSettings().toasts) return
  if (useWorkspace.getState().windowMode !== 'normal') return
  useToasts.getState().show(toast)
}

/** Opens a thread a toast is about, in the Inbox, if it is still there. */
export function openThreadFromToast(threadId: string): void {
  const workspace = useWorkspace.getState()
  if (workspace.inboxThreads.some((thread) => thread.id === threadId)) workspace.selectInboxThread(threadId)
}

export function threadDisplayTitle(thread: InboxThread): string {
  return thread.customTitle?.trim() || thread.title.trim() || 'Untitled thread'
}

export interface ThreadToastContext {
  /** The name of the project the thread is in, when it is known. */
  project?: string
}

/** The toast for a thread that changed, or null for a change that is not news. */
export function threadToast(previous: InboxThread | undefined, next: InboxThread, context: ThreadToastContext = {}): ToastInput | null {
  if (!previous) return null
  const base = {
    key: `thread:${next.id}`,
    title: threadDisplayTitle(next),
    ...(context.project ? { detail: context.project } : {}),
    onOpen: () => openThreadFromToast(next.id),
  }
  const kind = alertKind(previous, next)
  if (kind === 'done') return { ...base, tone: 'ok', icon: 'done', label: 'Done' }
  if (kind === 'failed') return { ...base, tone: 'danger', icon: 'failed', label: 'Failed', duration: TOAST_URGENT_DURATION_MS }
  if (kind === 'input') {
    const permission = next.attentionReason === 'permission'
    return {
      ...base,
      tone: 'accent',
      icon: permission ? 'permission' : 'input',
      label: permission ? 'Needs permission' : 'Needs input',
      duration: TOAST_URGENT_DURATION_MS,
    }
  }
  if (!previous.woke && next.woke) return { ...base, tone: 'accent', icon: 'woke', label: 'Woke up' }
  return null
}

/** The toast for a thread an agent just started through the MDE MCP, or null for any other new thread. */
export function spawnedThreadToast(
  thread: InboxThread,
  now: number,
  context: ThreadToastContext & { parentTitle?: string } = {},
): ToastInput | null {
  if (!thread.spawnedBy || now - thread.createdAt > FRESH_THREAD_MS) return null
  const from = context.parentTitle ? `From ${context.parentTitle}` : 'From an agent'
  return {
    key: `thread:${thread.id}`,
    tone: 'muted',
    icon: 'agent-thread',
    label: 'Agent started a thread',
    title: threadDisplayTitle(thread),
    detail: context.project ? `${from} · ${context.project}` : from,
    onOpen: () => openThreadFromToast(thread.id),
  }
}

/** The toast for a chat the person started in the background (Ctrl+Enter), so they can still jump to it. */
export function backgroundThreadToast(thread: InboxThread, context: ThreadToastContext = {}): ToastInput {
  return {
    key: `thread:${thread.id}`,
    tone: 'muted',
    icon: 'background',
    label: 'Started in the background',
    title: threadDisplayTitle(thread),
    ...(context.project ? { detail: context.project } : {}),
    onOpen: () => openThreadFromToast(thread.id),
  }
}
