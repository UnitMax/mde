export const INBOX_SIDEBAR_CHANGES_STORAGE_KEY = 'mde.inbox-sidebar-changes'
export const INBOX_WORKING_SECTION_STORAGE_KEY = 'mde.inbox-working-section'
export const INBOX_WORKING_COLLAPSED_STORAGE_KEY = 'mde.inbox-working-collapsed'

/** `on` when it was turned on; off for anything else and when storage cannot be read. */
function readSwitch(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'on'
  } catch {
    return false
  }
}

function writeSwitch(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off')
  } catch {
    // A restricted storage environment keeps the choice for this session only.
  }
}

/** Whether each thread in the Inbox list shows its Git changes. Off unless it was turned on, and off when unreadable. */
export function getInboxSidebarChanges(): boolean {
  return readSwitch(INBOX_SIDEBAR_CHANGES_STORAGE_KEY)
}

export function saveInboxSidebarChanges(on: boolean): void {
  writeSwitch(INBOX_SIDEBAR_CHANGES_STORAGE_KEY, on)
}

/** Whether the Inbox lists the threads that are working in a section of their own. Off unless turned on. */
export function getInboxWorkingSection(): boolean {
  return readSwitch(INBOX_WORKING_SECTION_STORAGE_KEY)
}

export function saveInboxWorkingSection(on: boolean): void {
  writeSwitch(INBOX_WORKING_SECTION_STORAGE_KEY, on)
}

/** Whether that section is folded up. Open unless it was folded, and open when unreadable. */
export function getInboxWorkingCollapsed(): boolean {
  return readSwitch(INBOX_WORKING_COLLAPSED_STORAGE_KEY)
}

export function saveInboxWorkingCollapsed(collapsed: boolean): void {
  writeSwitch(INBOX_WORKING_COLLAPSED_STORAGE_KEY, collapsed)
}
