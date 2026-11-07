// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../src/renderer/components/SettingsDialog'
import { getTerminalSettings, saveTerminalSettings } from '../src/renderer/terminal/terminal-settings'
import { useWorkspace } from '../src/renderer/store/workspace'

describe('Settings → OpenCode', () => {
  let root: Root
  let container: HTMLDivElement

  const entry = (): HTMLElement | null => document.body.querySelector<HTMLElement>('[data-testid="opencode-config-entry"]')
  const show = async (platform: 'darwin' | 'win32' | 'linux'): Promise<void> => {
    useWorkspace.setState({
      platform: { platform, isWindows: platform === 'win32' },
      settingsDialog: { open: true, section: 'opencode' },
      opencodeConfigDialog: { open: false },
    })
    await act(async () => root.render(createElement(SettingsDialog, { terminalIds: [] })))
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('api', { pty: { resize: vi.fn() } })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it.each(['darwin', 'win32'] as const)('offers the editor on %s, where OpenCode runs', async (platform) => {
    await show(platform)
    expect(entry()?.textContent).toContain('OpenCode configuration')
    expect(entry()?.querySelector('button')?.textContent).toBe('Edit configuration…')
  })

  const sectionTabs = (): string[] =>
    Array.from(document.body.querySelectorAll<HTMLElement>('[role="tab"]')).map((tab) => tab.textContent ?? '')
  const executable = (): HTMLInputElement | null =>
    document.body.querySelector<HTMLInputElement>('[data-testid="opencode-executable"]')
  const typeExecutable = async (value: string): Promise<void> => {
    const input = executable()!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('offers nothing on a platform without the Inbox', async () => {
    await show('linux')
    expect(sectionTabs()).not.toContain('OpenCode')
    expect(entry()).toBeNull()
    expect(executable()).toBeNull()
  })

  it.each(['darwin', 'win32'] as const)('lists the OpenCode section on %s', async (platform) => {
    await show(platform)
    expect(sectionTabs()).toContain('OpenCode')
    expect(sectionTabs()).not.toContain('Agents')
  })

  it('shows the saved executable and stores an edited one', async () => {
    saveTerminalSettings({ ...getTerminalSettings(), openCodeExecutable: 'opencode' })
    await show('darwin')
    expect(executable()?.value).toBe('opencode')
    await typeExecutable('/opt/opencode/bin/opencode')
    expect(getTerminalSettings().openCodeExecutable).toBe('/opt/opencode/bin/opencode')
    expect(document.body.querySelector('[data-testid="opencode-executable-error"]')).toBeNull()
  })

  it('explains an empty executable', async () => {
    await show('darwin')
    await typeExecutable('   ')
    expect(document.body.querySelector('[data-testid="opencode-executable-error"]')?.textContent)
      .toContain('Enter an executable name.')
  })

  it('swaps Settings for the editor when asked', async () => {
    await show('darwin')
    await act(async () => entry()!.querySelector<HTMLButtonElement>('button')!.click())
    expect(useWorkspace.getState().settingsDialog.open).toBe(false)
    expect(useWorkspace.getState().opencodeConfigDialog.open).toBe(true)
  })
})
