// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyboardShortcutsSettings } from '../src/renderer/components/KeyboardShortcutsSettings'
import { getKeyboardShortcutGroups } from '../src/renderer/terminal/keyboard-shortcuts'

const roots: Root[] = []
const containers: HTMLDivElement[] = []

function renderSettings(
  platform: 'darwin' | 'win32',
  escapeExitsFullscreen: boolean
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)

  act(() => {
    root.render(createElement(KeyboardShortcutsSettings, { platform, escapeExitsFullscreen }))
  })

  return { container, root }
}

describe('KeyboardShortcutsSettings', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  })

  afterEach(() => {
    act(() => {
      roots.splice(0).forEach((root) => root.unmount())
    })
    containers.splice(0).forEach((container) => container.remove())
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('lists the shortcuts worth looking up, grouped by where they work, without editing controls', () => {
    const { container } = renderSettings('win32', false)
    const section = container.querySelector<HTMLElement>('[data-testid="keyboard-shortcuts-settings"]')

    expect(section).not.toBeNull()
    expect(section?.querySelectorAll('[data-testid^="keyboard-shortcut-row-"]')).toHaveLength(22)
    expect(section?.querySelectorAll('button')).toHaveLength(0)
    expect(Array.from(section?.querySelectorAll('h4') ?? []).map((heading) => heading.textContent))
      .toEqual(['Everywhere', 'Inbox', 'Terminal', 'Files and To Do'])
    expect(section?.textContent).toContain('In every list, menu and dialog')
    expect(section?.querySelector('[data-testid="keyboard-shortcut-keys-terminal-fullscreen"]')?.textContent).toBe('Ctrl+Shift+Enter')
    expect(section?.querySelector('[data-testid="keyboard-shortcut-keys-inbox-search-all"]')?.textContent).toBe('Ctrl+Shift+F')
    expect(section?.querySelector('[data-testid="keyboard-shortcut-keys-inbox-find"]')?.textContent).toBe('Ctrl+F')
    expect(section?.querySelector('[data-testid="keyboard-shortcut-keys-zoom"]')?.classList.contains('flex-col')).toBe(true)
    expect(section?.textContent).toContain('Ctrl+O')
    expect(section?.textContent).toContain('Ctrl+Shift+1–9')
    expect(section?.textContent).toContain('Ctrl+Shift+C and Ctrl+Shift+V always copy and paste')
    expect(section?.querySelector('[data-testid="keyboard-shortcut-row-inbox-cycle-agent"]')?.textContent).toContain('Shift+Tab')
    expect(section?.textContent).toContain('To exit with Esc too, turn on “Exit fullscreen with Escape” in Terminal settings.')
    // The keys every list answers to are one note, not a row each.
    expect(section?.querySelector('[data-testid="keyboard-shortcut-row-session-switcher-move"]')).toBeNull()
  })

  it('uses Mac symbols on macOS and reflects the Escape setting state', () => {
    const { container, root } = renderSettings('darwin', true)
    const section = container.querySelector<HTMLElement>('[data-testid="keyboard-shortcuts-settings"]')

    expect(section?.querySelector('[data-testid="keyboard-shortcut-keys-session-switcher-open"]')?.textContent).toBe('⌘O')
    expect(section?.querySelector('[data-testid="keyboard-shortcut-keys-inbox-search-all"]')?.textContent).toBe('⌘⇧F')
    expect(section?.querySelector('[data-testid="keyboard-shortcut-keys-terminal-fullscreen"]')?.textContent).toBe('⌃⇧ Enter')
    expect(section?.querySelector('[data-testid="keyboard-shortcut-keys-terminal-copy-paste"]')?.textContent).toBe('⌘C⌘V')
    expect(section?.textContent).toContain('Esc also exits fullscreen (Terminal settings).')

    act(() => {
      root.render(createElement(KeyboardShortcutsSettings, {
        platform: 'darwin',
        escapeExitsFullscreen: false
      }))
    })

    expect(section?.textContent).toContain('To exit with Esc too, turn on')
  })

  it('narrows the list by the words typed, on the keys or the description, and says when nothing matches', () => {
    const { container } = renderSettings('win32', false)
    const section = container.querySelector<HTMLElement>('[data-testid="keyboard-shortcuts-settings"]')!
    const search = section.querySelector<HTMLInputElement>('[data-testid="keyboard-shortcuts-search"]')!
    const type = (value: string): void => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, value)
        search.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    const rowIds = (): string[] =>
      Array.from(section.querySelectorAll('[data-testid^="keyboard-shortcut-row-"]'))
        .map((row) => row.getAttribute('data-testid')!.replace('keyboard-shortcut-row-', ''))

    type('fullscreen')
    expect(rowIds()).toEqual(expect.arrayContaining(['terminal-fullscreen', 'terminal-pane-switch']))
    expect(rowIds()).not.toContain('inbox-find')

    type('shift+f')
    expect(rowIds()).toContain('inbox-search-all')

    type('zzzz')
    expect(rowIds()).toEqual([])
    expect(section.querySelector('[data-testid="keyboard-shortcuts-empty"]')?.textContent).toContain('zzzz')
  })

  it('never gives one chord to two shortcuts that can both be reached', () => {
    for (const platform of ['win32', 'darwin'] as const) {
      const groups = getKeyboardShortcutGroups(platform, false)
      const seen = new Map<string, string>()
      for (const group of groups) {
        for (const shortcut of group.shortcuts) {
          for (const key of shortcut.keys) {
            // A chord in the global group is taken in every view; in another group it is taken in that group alone.
            const clashes = [
              `global:${key}`,
              ...(group.id === 'global' ? groups.map((other) => `${other.id}:${key}`) : [`${group.id}:${key}`])
            ]
            for (const clash of clashes) {
              const owner = seen.get(clash)
              if (owner && owner !== shortcut.id) {
                throw new Error(`${platform}: ${key} is both ${owner} and ${shortcut.id}`)
              }
            }
            seen.set(`${group.id}:${key}`, shortcut.id)
          }
        }
      }
      expect(seen.size).toBeGreaterThan(20)
    }
  })

  it('keeps the entry ids unique', () => {
    const ids = getKeyboardShortcutGroups('win32', false).flatMap((group) => group.shortcuts.map((shortcut) => shortcut.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
})
