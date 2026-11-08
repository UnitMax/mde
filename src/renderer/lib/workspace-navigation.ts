export type WorkspaceView = 'sessions' | 'todo' | 'inbox'

export interface WorkspaceNavigation {
  view: WorkspaceView
  selectedInboxThreadId: string | null
}

export const WORKSPACE_NAVIGATION_STORAGE_KEY = 'mde.workspace-navigation'

/** A missing or unreadable preference opens Sessions, as on a fresh install. */
export function getWorkspaceNavigation(): WorkspaceNavigation {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(WORKSPACE_NAVIGATION_STORAGE_KEY) ?? 'null')
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      return {
        view: record.view === 'todo' || record.view === 'inbox' ? record.view : 'sessions',
        selectedInboxThreadId: typeof record.selectedInboxThreadId === 'string' && /^ses_[A-Za-z0-9_-]{1,200}$/.test(record.selectedInboxThreadId)
          ? record.selectedInboxThreadId
          : null,
      }
    }
  } catch { /* Storage can be unavailable or contain an invalid value. */ }
  return { view: 'sessions', selectedInboxThreadId: null }
}

/** Save on navigation, so closing the window needs no final asynchronous write. */
export function saveWorkspaceNavigation(navigation: WorkspaceNavigation): void {
  try {
    localStorage.setItem(WORKSPACE_NAVIGATION_STORAGE_KEY, JSON.stringify(navigation))
  } catch { /* Navigation still works when storage is unavailable. */ }
}
