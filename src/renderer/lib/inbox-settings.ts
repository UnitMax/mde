import { isTerminalLayoutTree } from '@shared/terminal-layouts'
import type { TerminalLayoutNode } from '@shared/types'
import { isFloatingRect, type FloatingRect } from './floating-window'

export const INBOX_SIDEBAR_CHANGES_STORAGE_KEY = 'mde.inbox-sidebar-changes'
export const INBOX_WORKING_SECTION_STORAGE_KEY = 'mde.inbox-working-section'
export const INBOX_WORKING_COLLAPSED_STORAGE_KEY = 'mde.inbox-working-collapsed'
export const INBOX_DRAFTS_COLLAPSED_STORAGE_KEY = 'mde.inbox-drafts-collapsed'
export const INBOX_TITLE_ICONS_STORAGE_KEY = 'mde.inbox-title-icons'
export const INBOX_COMPACT_CHAT_STORAGE_KEY = 'mde.inbox-compact-chat'
export const INBOX_MODEL_QUICK_SWITCH_STORAGE_KEY = 'mde.inbox-model-quick-switch'
export const INBOX_PROJECT_FILTER_STORAGE_KEY = 'mde.inbox-project-filter'
export const INBOX_SIDEBAR_WIDTH_STORAGE_KEY = 'mde.inbox-sidebar-width'
export const INBOX_TERMINAL_LAYOUT_STORAGE_KEY = 'mde.inbox-terminal-layout'
export const INBOX_TERMINAL_DISTRO_STORAGE_KEY = 'mde.inbox-terminal-distro'
export const INBOX_FLOATING_TERMINAL_STORAGE_KEY = 'mde.inbox-floating-terminal'

/** No saved choice follows the Windows default distribution. */
export function getInboxTerminalDistro(): string | null {
  try {
    return localStorage.getItem(INBOX_TERMINAL_DISTRO_STORAGE_KEY) || null
  } catch {
    return null
  }
}

export function saveInboxTerminalDistro(distro: string | null): void {
  try {
    if (distro === null) localStorage.removeItem(INBOX_TERMINAL_DISTRO_STORAGE_KEY)
    else localStorage.setItem(INBOX_TERMINAL_DISTRO_STORAGE_KEY, distro)
  } catch {
    // A restricted storage environment keeps the choice for this session only.
  }
}

/** The right-hand sidebar is this wide until it is dragged, and never narrower. */
export const INBOX_SIDEBAR_DEFAULT_WIDTH = 260
export const INBOX_SIDEBAR_MIN_WIDTH = 260
export const INBOX_SIDEBAR_MAX_WIDTH = 1200

/** `on` when it was turned on; off for anything else and when storage cannot be read. */
function readSwitch(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'on'
  } catch {
    return false
  }
}

/** `off` when it was turned off; on for anything else, and when storage cannot be read. */
function readSwitchOnByDefault(key: string): boolean {
  try {
    return localStorage.getItem(key) !== 'off'
  } catch {
    return true
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

/** Whether each row of the thread list shows its project's icon in front of the title. Off unless turned on. */
export function getInboxTitleIcons(): boolean {
  return readSwitch(INBOX_TITLE_ICONS_STORAGE_KEY)
}

export function saveInboxTitleIcons(on: boolean): void {
  writeSwitch(INBOX_TITLE_ICONS_STORAGE_KEY, on)
}

/** Whether chat conversations are in compact mode: one line per stretch of activity. Off unless turned on. */
export function getInboxCompactChat(): boolean {
  return readSwitch(INBOX_COMPACT_CHAT_STORAGE_KEY)
}

export function saveInboxCompactChat(on: boolean): void {
  writeSwitch(INBOX_COMPACT_CHAT_STORAGE_KEY, on)
}

/** Whether the favorite models are offered as buttons above the message box. On unless turned off. */
export function getInboxModelQuickSwitch(): boolean {
  return readSwitchOnByDefault(INBOX_MODEL_QUICK_SWITCH_STORAGE_KEY)
}

export function saveInboxModelQuickSwitch(on: boolean): void {
  writeSwitch(INBOX_MODEL_QUICK_SWITCH_STORAGE_KEY, on)
}

/** The project the thread list is narrowed to, as the user last left it: its folder ID, or none. */
export function getInboxProjectFilter(): string | null {
  try {
    return localStorage.getItem(INBOX_PROJECT_FILTER_STORAGE_KEY) || null
  } catch {
    return null
  }
}

export function saveInboxProjectFilter(projectId: string | null): void {
  try {
    if (projectId === null) localStorage.removeItem(INBOX_PROJECT_FILTER_STORAGE_KEY)
    else localStorage.setItem(INBOX_PROJECT_FILTER_STORAGE_KEY, projectId)
  } catch {
    // A restricted storage environment keeps the choice for this session only.
  }
}

/** Whether that section is folded up. Open unless it was folded, and open when unreadable. */
export function getInboxWorkingCollapsed(): boolean {
  return readSwitch(INBOX_WORKING_COLLAPSED_STORAGE_KEY)
}

export function saveInboxWorkingCollapsed(collapsed: boolean): void {
  writeSwitch(INBOX_WORKING_COLLAPSED_STORAGE_KEY, collapsed)
}

/** Whether the Drafts section is folded up. Open unless it was folded, and open when unreadable. */
export function getInboxDraftsCollapsed(): boolean {
  return readSwitch(INBOX_DRAFTS_COLLAPSED_STORAGE_KEY)
}

export function saveInboxDraftsCollapsed(collapsed: boolean): void {
  writeSwitch(INBOX_DRAFTS_COLLAPSED_STORAGE_KEY, collapsed)
}

/** A width in pixels the sidebar can have, whatever was stored or dragged to. */
export function clampInboxSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return INBOX_SIDEBAR_DEFAULT_WIDTH
  return Math.round(Math.min(Math.max(width, INBOX_SIDEBAR_MIN_WIDTH), INBOX_SIDEBAR_MAX_WIDTH))
}

/** How wide the Inbox's right-hand sidebar was left. The default when never set, and when unreadable. */
export function getInboxSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(INBOX_SIDEBAR_WIDTH_STORAGE_KEY)
    return stored === null ? INBOX_SIDEBAR_DEFAULT_WIDTH : clampInboxSidebarWidth(Number(stored))
  } catch {
    return INBOX_SIDEBAR_DEFAULT_WIDTH
  }
}

export function saveInboxSidebarWidth(width: number): void {
  try {
    localStorage.setItem(INBOX_SIDEBAR_WIDTH_STORAGE_KEY, String(clampInboxSidebarWidth(width)))
  } catch {
    // A restricted storage environment keeps the width for this session only.
  }
}

/** Only pane identities, split directions and divider ratios are kept between runs. */
export interface StoredTerminalLayout {
  tree: TerminalLayoutNode
}

export function parseStoredTerminalLayout(raw: string | null): StoredTerminalLayout | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || !('tree' in value) || !isTerminalLayoutTree(value.tree)) return null
    return { tree: value.tree }
  } catch {
    return null
  }
}

export function getInboxTerminalLayout(): StoredTerminalLayout | null {
  try {
    return parseStoredTerminalLayout(localStorage.getItem(INBOX_TERMINAL_LAYOUT_STORAGE_KEY))
  } catch {
    return null
  }
}

export function saveInboxTerminalLayout(value: StoredTerminalLayout): void {
  try {
    localStorage.setItem(INBOX_TERMINAL_LAYOUT_STORAGE_KEY, JSON.stringify({ tree: value.tree }))
  } catch {
    // A restricted storage environment keeps the layout for this session only.
  }
}

/** Whether the Inbox's terminal floats over the conversation, and where its window was left. */
export interface StoredFloatingTerminal {
  floating: boolean
  /** Null until the window has been moved or resized: it then opens in its default place. */
  rect: FloatingRect | null
  maximized: boolean
}

export const DEFAULT_FLOATING_TERMINAL: StoredFloatingTerminal = { floating: false, rect: null, maximized: false }

export function parseStoredFloatingTerminal(raw: string | null): StoredFloatingTerminal {
  if (!raw) return DEFAULT_FLOATING_TERMINAL
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return DEFAULT_FLOATING_TERMINAL
    const { floating, rect, maximized } = value as Record<string, unknown>
    return {
      floating: floating === true,
      rect: isFloatingRect(rect) ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      maximized: maximized === true,
    }
  } catch {
    return DEFAULT_FLOATING_TERMINAL
  }
}

export function getInboxFloatingTerminal(): StoredFloatingTerminal {
  try {
    return parseStoredFloatingTerminal(localStorage.getItem(INBOX_FLOATING_TERMINAL_STORAGE_KEY))
  } catch {
    return DEFAULT_FLOATING_TERMINAL
  }
}

export function saveInboxFloatingTerminal(value: StoredFloatingTerminal): void {
  try {
    localStorage.setItem(INBOX_FLOATING_TERMINAL_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // A restricted storage environment keeps the window where it is for this session only.
  }
}
