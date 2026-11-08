// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../src/renderer/components/SettingsDialog'
import { useWorkspace } from '../src/renderer/store/workspace'
import { getTerminalSettings, saveTerminalSettings } from '../src/renderer/terminal/terminal-settings'
import { APPLICATION_THEMES, DARK_THEMES, LIGHT_THEMES } from '../src/renderer/theme/themes'

// xterm.js needs a real browser, and the dialog only asks the sessions to restyle themselves.
vi.mock('../src/renderer/terminal/sessions', () => ({
  applyTerminalSettings: vi.fn(),
  fitSession: () => ({ cols: 80, rows: 24 }),
  getSession: () => undefined,
}))

let root: Root
let container: HTMLDivElement
const windowChromeSet = vi.fn(async () => undefined)

const trigger = (): HTMLElement => {
  const label = Array.from(document.body.querySelectorAll('label')).find((element) => element.textContent?.startsWith('Application theme'))!
  return label.querySelector<HTMLElement>('[role="combobox"]')!
}
const options = (): HTMLElement[] => Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'))

async function show(): Promise<void> {
  useWorkspace.setState({ settingsDialog: { open: true, section: 'appearance' } })
  await act(async () => root.render(createElement(SettingsDialog, { terminalIds: [] })))
}

async function openList(): Promise<void> {
  await act(async () => {
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-mode')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('api', { windowChrome: { set: windowChromeSet } })
  windowChromeSet.mockClear()
  // Radix scrolls the highlighted option into view, which happy-dom has no layout for.
  Element.prototype.scrollIntoView = vi.fn()
  useWorkspace.setState({
    platform: { platform: 'linux', isWindows: false }, wslAvailable: false, distros: [],
    settingsDialog: { open: false, section: 'appearance' },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('Settings → Appearance → Application theme', () => {
  it('shows the saved theme with its swatch', async () => {
    saveTerminalSettings({ ...getTerminalSettings(), theme: 'catppuccin-latte' })
    await show()

    expect(trigger().textContent).toContain('Catppuccin Latte')
    expect(trigger().querySelector('[data-testid="theme-swatch-catppuccin-latte"]')).not.toBeNull()
  })

  it('lists the dark themes and the light themes in two groups, each with a swatch', async () => {
    await show()
    await openList()

    const groups = Array.from(document.body.querySelectorAll<HTMLElement>('[role="group"]'))
    expect(groups.map((group) => group.querySelector('[role="presentation"], div')?.textContent?.trim())).toEqual(['Dark', 'Light'])
    const names = (group: HTMLElement): string[] => Array.from(group.querySelectorAll('[role="option"]')).map((option) => option.textContent!.trim())
    expect(names(groups[0]!)).toEqual(DARK_THEMES.map((theme) => theme.label))
    expect(names(groups[1]!)).toEqual(LIGHT_THEMES.map((theme) => theme.label))
    expect(options()).toHaveLength(APPLICATION_THEMES.length)
    for (const theme of APPLICATION_THEMES) {
      expect(document.body.querySelectorAll(`[role="option"] [data-testid="theme-swatch-${theme.id}"]`)).toHaveLength(1)
    }
  })

  it('applies a light theme at once, saves it, and tells the window', async () => {
    await show()
    await openList()
    const choice = options().find((option) => option.textContent!.includes('Solarized Light'))!
    await act(async () => {
      choice.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
      choice.click()
    })

    expect(document.documentElement.dataset.theme).toBe('solarized-light')
    expect(document.documentElement.dataset.mode).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#fdf6e3')
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light')
    expect(getTerminalSettings().theme).toBe('solarized-light')
    expect(windowChromeSet).toHaveBeenCalledWith({ color: '#eee8d5', symbolColor: '#546a70' })
  })
})
