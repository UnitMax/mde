import type { HostPlatform } from '@shared/types'

export interface KeyboardShortcutEntry {
  id: string
  keys: string[]
  description: string
  note?: string
}

export interface KeyboardShortcutGroup {
  id: string
  label: string
  shortcuts: KeyboardShortcutEntry[]
}

export function getKeyboardShortcutGroups(
  platform: HostPlatform,
  escapeExitsFullscreen: boolean
): KeyboardShortcutGroup[] {
  const primaryModifier = platform === 'darwin' ? 'Cmd' : 'Ctrl'
  const clipboardCopyKeys = platform === 'darwin'
    ? ['Cmd+C', 'Cmd+Shift+C']
    : ['Ctrl+C', 'Ctrl+Shift+C', 'Ctrl+Insert']
  const clipboardPasteKeys = platform === 'darwin'
    ? ['Cmd+V', 'Cmd+Shift+V', 'Shift+Insert']
    : ['Ctrl+V', 'Ctrl+Shift+V', 'Shift+Insert']

  return [
    {
      id: 'inbox-chat',
      label: 'Inbox chat',
      shortcuts: [
        { id: 'inbox-changes-tabs', keys: ['Left', 'Right', 'Home', 'End'], description: 'Switch Files and Changes when a thread sidebar tab is focused.' },
        { id: 'inbox-close-changes', keys: ['Escape'], description: 'Close the Git change review, or the changed-file list under a thread.' },
        { id: 'inbox-paste-image', keys: [`${primaryModifier}+V`], description: 'Paste clipboard images as attachments in the message box; text pastes normally.' },
        { id: 'inbox-skill-picker', keys: ['$'], description: 'Start a word with $ in the message box to pick a skill; keep typing to narrow the list.' },
        { id: 'inbox-skill-picker-keys', keys: ['Up', 'Down', 'Tab', 'Enter', 'Escape'], description: 'In the skill list: Up and Down move, Tab or Enter insert the skill, Escape closes the list.' },
        { id: 'inbox-send', keys: ['Enter'], description: 'Send the message and attachments.' },
        { id: 'inbox-send-background', keys: platform === 'darwin' ? ['Cmd+Enter', 'Ctrl+Enter'] : ['Ctrl+Enter'], description: 'On the new-thread page, start a thread in the background and keep the composer open for the next thread.' },
        { id: 'inbox-save-draft', keys: [`${primaryModifier}+S`], description: 'On the new-thread page, save what you typed as a draft and start a blank page.' },
        { id: 'inbox-message-history', keys: ['Up', 'Down'], description: 'With an empty message box, Up recalls earlier messages in this thread. Down moves forward to the empty box; editing ends history navigation.' },
        { id: 'inbox-newline', keys: ['Shift+Enter', 'Ctrl+J'], description: 'Insert a newline in the message box; continue a bullet list, or leave it when its last item is empty.' }
      ]
    },
    {
      id: 'workspace',
      label: 'Workspace',
      shortcuts: [
        {
          id: 'session-switcher-open',
          keys: [`${primaryModifier}+O`],
          description: 'Open the session switcher.'
        },
        {
          id: 'todo-search-open',
          keys: [`${primaryModifier}+F`],
          description: 'Search tasks in the open To Do project.',
          note: 'Available in the To Do view.'
        },
        {
          id: 'terminal-launcher-open',
          keys: [`${primaryModifier}+N`],
          description: 'Open the terminal launcher.',
          note: 'Available from a focused Mac or Windows/WSL terminal.'
        },
        {
          id: 'opencode-sessions-open',
          keys: ['Ctrl+Shift+O'],
          description: 'Browse OpenCode sessions from every directory on this Mac or in the current WSL distro.',
          note: 'Available from a focused Mac or Windows/WSL terminal.'
        },
        {
          id: 'mini-window-toggle',
          keys: ['F12'],
          description: 'Toggle the always-on-top mini window that lists your agents.',
          note: 'Works while MDE is focused. Clicking an agent restores the full window, focuses its terminal, and highlights it.'
        }
      ]
    },
    {
      id: 'terminal',
      label: 'Terminal',
      shortcuts: [
        {
          id: 'terminal-layout',
          keys: ['Ctrl+1–9'],
          description: 'Choose a terminal layout.',
          note: 'Choose 1–9 terminals using the corresponding digit. Numpad digits also work.'
        },
        {
          id: 'terminal-fullscreen',
          keys: ['Ctrl+Shift+F'],
          description: 'Toggle terminal fullscreen.'
        },
        {
          id: 'terminal-pane-overlay',
          keys: ['Ctrl+Shift'],
          description: 'Hold to number the terminals and highlight the focused one.'
        },
        {
          id: 'terminal-pane-switch',
          keys: ['Ctrl+Shift+1–9'],
          description: 'Focus a terminal by its number.',
          note: 'Numpad digits also work. Ignored while a terminal is fullscreen.'
        },
        {
          id: 'terminal-fullscreen-escape',
          keys: ['Escape'],
          description: 'Exit fullscreen.',
          note: escapeExitsFullscreen
            ? 'Enabled in Terminal settings; ignored while a dialog is open.'
            : 'Disabled. Enable “Exit fullscreen with Escape” in Terminal settings to use it.'
        },
        {
          id: 'zoom-in',
          keys: [
            `${primaryModifier}+plus`,
            `${primaryModifier}+equals`,
            `${primaryModifier}+Numpad plus`
          ],
          description: 'Zoom in.',
          note: 'The plus key may require Shift on your keyboard.'
        },
        {
          id: 'zoom-out',
          keys: [
            `${primaryModifier}+minus`,
            `${primaryModifier}+underscore`,
            `${primaryModifier}+Numpad minus`
          ],
          description: 'Zoom out.'
        },
        {
          id: 'zoom-reset',
          keys: [`${primaryModifier}+0`],
          description: 'Reset zoom.'
        },
        {
          id: 'rename-session-or-tab',
          keys: ['F2'],
          description: 'Rename the focused session row or terminal tab.'
        }
      ]
    },
    {
      id: 'terminal-input',
      label: 'Terminal input',
      shortcuts: [
        {
          id: 'terminal-copy',
          keys: clipboardCopyKeys,
          description: 'Copy selected terminal text.',
          note: platform === 'darwin'
            ? 'Copy only applies when text is selected.'
            : 'Copy only applies when text is selected. Ctrl+C without a selection remains the terminal interrupt.'
        },
        {
          id: 'terminal-paste',
          keys: clipboardPasteKeys,
          description: 'Paste from the system clipboard.'
        },
        {
          id: 'terminal-enter-newline',
          keys: ['Ctrl+Enter'],
          description: 'Send a newline to an alternate-screen terminal program.'
        }
      ]
    },
    {
      id: 'files',
      label: 'Files',
      shortcuts: [
        {
          id: 'file-tree-move',
          keys: ['↑', '↓', '←', '→'],
          description: 'Move through the file tree; ← and → collapse and expand folders.'
        },
        {
          id: 'file-tree-open',
          keys: ['Enter', 'Space'],
          description: 'Open the focused file, or toggle the focused folder.'
        },
        {
          id: 'file-viewer-search',
          keys: [`${primaryModifier}+F`],
          description: 'Search in the open code file.',
          note: 'Available while the code viewer is focused. Esc closes the search bar.'
        },
        {
          id: 'file-viewer-search-next',
          keys: ['F3', 'Shift+F3'],
          description: 'Jump to the next or previous search match.'
        }
      ]
    },
    {
      id: 'dialogs',
      label: 'Dialogs',
      shortcuts: [
        {
          id: 'session-switcher-move',
          keys: ['↑', '↓'],
          description: 'Move through matching sessions in the session switcher.'
        },
        {
          id: 'session-switcher-select',
          keys: ['Enter'],
          description: 'Switch to the selected session.'
        },
        {
          id: 'session-switcher-close',
          keys: ['Esc'],
          description: 'Close the session switcher.'
        },
        {
          id: 'opencode-sessions-move',
          keys: ['↑', '↓'],
          description: 'Move through OpenCode sessions across directory groups.'
        },
        {
          id: 'opencode-sessions-select',
          keys: ['Enter'],
          description: 'Resume the selected OpenCode session in a new terminal.'
        },
        {
          id: 'opencode-sessions-replace',
          keys: ['Shift+Enter'],
          description: 'Resume the selected OpenCode session in the terminal the picker was opened from.',
          note: 'Asks first when that terminal is running, since it interrupts the current command or task.'
        },
        {
          id: 'opencode-sessions-close',
          keys: ['Esc'],
          description: 'Close the OpenCode session picker.'
        },
        {
          id: 'todo-search-move',
          keys: ['↑', '↓'],
          description: 'Move through matching tasks in the To Do search.'
        },
        {
          id: 'todo-search-select',
          keys: ['Enter'],
          description: 'Open the selected task.'
        },
        {
          id: 'todo-search-close',
          keys: ['Esc'],
          description: 'Close the To Do search.'
        },
        {
          id: 'terminal-launcher-source',
          keys: ['Tab'],
          description: 'Switch between terminal and session directories in the terminal launcher.',
          note: 'Available when both directory choices are available.'
        },
        {
          id: 'terminal-launcher-move',
          keys: ['↑', '↓'],
          description: 'Move through terminal launcher commands.'
        },
        {
          id: 'terminal-launcher-ends',
          keys: ['Home', 'End'],
          description: 'Select the first or last terminal launcher command.'
        },
        {
          id: 'terminal-launcher-select',
          keys: ['Enter'],
          description: 'Launch the selected terminal command.'
        }
      ]
    }
  ]
}
