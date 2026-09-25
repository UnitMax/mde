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
          note: 'Available from a focused WSL terminal.'
        }
      ]
    },
    {
      id: 'terminal',
      label: 'Terminal',
      shortcuts: [
        {
          id: 'terminal-layout',
          keys: ['Ctrl+1–7'],
          description: 'Choose a terminal layout.',
          note: '1 pane, 2 columns, 3 terminals, 4 quadrant, 5 grid, 6 grid, 7 columns. Numpad digits also work.'
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
          keys: ['Ctrl+Shift+1–6'],
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
