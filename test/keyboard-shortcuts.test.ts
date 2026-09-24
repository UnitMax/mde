// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyboardShortcutsSettings } from '../src/renderer/components/KeyboardShortcutsSettings'

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

  it('renders the app, terminal, and app-specific dialog shortcuts without editing controls', () => {
    const { container } = renderSettings('win32', false)
    const section = container.querySelector<HTMLElement>('[data-testid="keyboard-shortcuts-settings"]')

    expect(section).not.toBeNull()
    expect(section?.querySelectorAll('[data-testid^="keyboard-shortcut-row-"]')).toHaveLength(25)
    expect(section?.querySelectorAll('button')).toHaveLength(0)
    const rows = Array.from(section?.querySelectorAll<HTMLElement>('[data-testid^="keyboard-shortcut-row-"]') ?? [])
    expect(rows.every((row) => row.classList.contains('grid-cols-[12rem_minmax(0,1fr)]'))).toBe(true)
    expect(section?.querySelector('[data-testid="keyboard-shortcut-keys-zoom-in"]')?.classList.contains('flex-col')).toBe(true)
    expect(section?.textContent).toContain('Ctrl+O')
    expect(section?.textContent).toContain('Ctrl+N')
    expect(section?.textContent).toContain('Ctrl+1–7')
    expect(section?.textContent).toContain('Ctrl+Shift+F')
    expect(section?.textContent).toContain('Ctrl+Shift+1–6')
    expect(section?.textContent).toContain('Ctrl+Insert')
    expect(section?.textContent).toContain('Ctrl+Enter')
    expect(section?.textContent).toContain('Tab')
    expect(section?.textContent).toContain('Home')
    expect(section?.textContent).toContain('Search in the open code file.')
    expect(section?.textContent).toContain('Shift+F3')
    expect(section?.textContent).toContain('Exit fullscreen with Escape” in Terminal settings')
  })

  it('uses Command labels on macOS and reflects the Escape setting state', () => {
    const { container, root } = renderSettings('darwin', true)
    const section = container.querySelector<HTMLElement>('[data-testid="keyboard-shortcuts-settings"]')

    expect(section?.textContent).toContain('Cmd+O')
    expect(section?.textContent).toContain('Cmd+N')
    expect(section?.textContent).toContain('Cmd+C')
    expect(section?.textContent).toContain('Cmd+V')
    expect(section?.textContent).toContain('Ctrl+Shift+F')
    expect(section?.textContent).toContain('Enabled in Terminal settings; ignored while a dialog is open.')

    act(() => {
      root.render(createElement(KeyboardShortcutsSettings, {
        platform: 'darwin',
        escapeExitsFullscreen: false
      }))
    })

    expect(section?.textContent).toContain('Disabled. Enable “Exit fullscreen with Escape” in Terminal settings to use it.')
  })
})
