export const INBOX_SIDEBAR_CHANGES_STORAGE_KEY = 'mde.inbox-sidebar-changes'

/** Whether each thread in the Inbox list shows its Git changes. Off unless it was turned on, and off when unreadable. */
export function getInboxSidebarChanges(): boolean {
  try {
    return localStorage.getItem(INBOX_SIDEBAR_CHANGES_STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export function saveInboxSidebarChanges(on: boolean): void {
  try {
    localStorage.setItem(INBOX_SIDEBAR_CHANGES_STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // A restricted storage environment keeps the choice for this session only.
  }
}
