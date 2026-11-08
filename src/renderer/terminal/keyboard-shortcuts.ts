import type { HostPlatform } from '@shared/types'

/**
 * Where a shortcut works. A group's id is its scope: the same chord may appear in two scopes (Ctrl+F finds in
 * the Inbox and in the file viewer), but never in `global` and another scope, and never twice in one scope.
 */
export type KeyboardShortcutScope = 'global' | 'inbox' | 'terminal' | 'files-todo'

export interface KeyboardShortcutEntry {
  id: string
  keys: string[]
  /** One line. Longer explanations belong in docs/architecture.md. */
  description: string
  /** Only when it changes what the person does, such as a setting the shortcut depends on. */
  note?: string
}

export interface KeyboardShortcutGroup {
  id: KeyboardShortcutScope
  label: string
  /** Where the group's shortcuts work. */
  where: string
  shortcuts: KeyboardShortcutEntry[]
}

/**
 * Keys that every list, menu and dialog answers to. They are not listed row by row: nobody needs to look them up.
 */
export const LIST_KEYS_NOTE = 'In every list, menu and dialog: ↑ ↓ move, Enter selects, Esc closes.'

const MAC_SYMBOLS: Record<string, string> = { Cmd: '⌘', Ctrl: '⌃', Shift: '⇧', Alt: '⌥' }

/** A chord as shown on this platform: ⌘⇧F on a Mac, Ctrl+Shift+F elsewhere. */
export function formatShortcutKey(key: string, platform: HostPlatform): string {
  if (platform !== 'darwin') return key
  const hold = key.startsWith('Hold ')
  const parts = (hold ? key.slice(5) : key).split('+')
  const modifiers = parts.filter((part) => part in MAC_SYMBOLS).map((part) => MAC_SYMBOLS[part]).join('')
  const named = parts.find((part) => !(part in MAC_SYMBOLS))
  const main = named === undefined ? '' : named.length === 1 ? named.toUpperCase() : named
  // A named key (Enter, Click, 1–9) stands apart from the symbols; a single letter runs on: ⌘⇧F.
  const text = modifiers + (modifiers && main.length > 1 ? ' ' : '') + main
  return hold ? `Hold ${text}` : text
}

export function getKeyboardShortcutGroups(
  platform: HostPlatform,
  escapeExitsFullscreen: boolean
): KeyboardShortcutGroup[] {
  const primaryModifier = platform === 'darwin' ? 'Cmd' : 'Ctrl'

  return [
    {
      id: 'global',
      label: 'Everywhere',
      where: 'Works in every view.',
      shortcuts: [
        { id: 'session-switcher-open', keys: [`${primaryModifier}+O`], description: 'Switch to another session.' },
        { id: 'mini-window-toggle', keys: ['F12'], description: 'Shrink MDE into the always-on-top mini Inbox window, and back.' },
        {
          id: 'inbox-floating-terminal',
          keys: ['F11'],
          description: 'Show or hide the floating Inbox terminal.',
          note: 'Until the terminal has been floated out of the sidebar, F11 puts the window in full screen.'
        },
        { id: 'zoom', keys: [`${primaryModifier}+Plus`, `${primaryModifier}+Minus`, `${primaryModifier}+0`], description: 'Zoom in, zoom out, reset zoom.' },
        { id: 'rename-session-or-tab', keys: ['F2'], description: 'Rename the focused session row or terminal tab.' }
      ]
    },
    {
      id: 'inbox',
      label: 'Inbox',
      where: 'Works in the Inbox view.',
      shortcuts: [
        { id: 'inbox-new-thread', keys: ['Ctrl+N'], description: 'Start a new thread, setting aside any current draft.' },
        { id: 'inbox-find', keys: [`${primaryModifier}+F`], description: 'Find in the open thread. Enter and Shift+Enter step through the matches.' },
        { id: 'inbox-search-all', keys: [`${primaryModifier}+Shift+F`], description: 'Search the text of every thread.' },
        { id: 'inbox-save-draft', keys: [`${primaryModifier}+S`], description: 'On the new-thread page, save what you typed as a draft.' },
        {
          id: 'inbox-send-background',
          keys: platform === 'darwin' ? ['Cmd+Enter', 'Ctrl+Enter'] : ['Ctrl+Enter'],
          description: 'On the new-thread page, start the thread in the background and keep the page open.'
        },
        { id: 'inbox-cycle-agent', keys: ['Shift+Tab'], description: 'Cycle through the available agents in the message box.' },
        { id: 'inbox-newline', keys: ['Shift+Enter', 'Ctrl+J'], description: 'Insert a newline in the message box.' },
        { id: 'inbox-message-history', keys: ['Up'], description: 'In an empty message box, recall earlier messages; Down moves forward.' },
        { id: 'inbox-skill-picker', keys: ['$'], description: 'Start a word with $ to pick a skill.' },
        { id: 'inbox-slash-picker', keys: ['/'], description: 'Start a message with / to pick a command: /btw, /fork, /compact, /goal.' },
        {
          id: 'inbox-multi-select',
          keys: platform === 'darwin' ? ['Ctrl+Click', 'Cmd+Click'] : ['Ctrl+Click'],
          description: 'Select several threads to pin, mark unread or park.'
        }
      ]
    },
    {
      id: 'terminal',
      label: 'Terminal',
      where: 'Works while a terminal has the keyboard (Sessions view, and the Inbox terminal).',
      shortcuts: [
        {
          id: 'terminal-fullscreen',
          keys: ['Ctrl+Shift+Enter'],
          description: 'Toggle fullscreen for the focused terminal.',
          note: escapeExitsFullscreen
            ? 'Esc also exits fullscreen (Terminal settings).'
            : 'To exit with Esc too, turn on “Exit fullscreen with Escape” in Terminal settings.'
        },
        {
          id: 'terminal-pane-switch',
          keys: ['Ctrl+Shift+1–9'],
          description: 'Focus a terminal by its number. Hold Ctrl+Shift to see the numbers.',
          note: 'Ignored while a terminal is fullscreen.'
        },
        {
          id: 'terminal-split',
          keys: ['Hold Ctrl'],
          description: 'Show + buttons on every edge of a pane; click one to split that way.'
        },
        {
          id: 'terminal-copy-paste',
          keys: platform === 'darwin' ? ['Cmd+C', 'Cmd+V'] : ['Ctrl+C', 'Ctrl+V'],
          description: 'Copy the selected text; paste from the clipboard.',
          note: platform === 'darwin'
            ? undefined
            : 'Ctrl+C with nothing selected is still the interrupt. Ctrl+Shift+C and Ctrl+Shift+V always copy and paste.'
        },
        {
          id: 'terminal-enter-newline',
          keys: ['Ctrl+Enter'],
          description: 'Send a newline to a full-screen terminal program.'
        }
      ]
    },
    {
      id: 'files-todo',
      label: 'Files and To Do',
      where: 'Works in the file viewer and in a To Do project.',
      shortcuts: [
        { id: 'find-in-view', keys: [`${primaryModifier}+F`], description: 'Search the open file, or the tasks of the open To Do project.' }
      ]
    }
  ]
}
