// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../src/renderer/components/SettingsDialog'
import { useWorkspace } from '../src/renderer/store/workspace'

describe('Settings → Agents → OpenCode configuration', () => {
  let root: Root
  let container: HTMLDivElement

  const entry = (): HTMLElement | null => document.body.querySelector<HTMLElement>('[data-testid="opencode-config-entry"]')
  const show = async (platform: 'darwin' | 'win32' | 'linux'): Promise<void> => {
    useWorkspace.setState({
      platform: { platform, isWindows: platform === 'win32' },
      settingsDialog: { open: true, section: 'agents' },
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

  it('offers nothing on a platform without the Inbox', async () => {
    await show('linux')
    expect(document.body.textContent).toContain('Configure the commands available')
    expect(entry()).toBeNull()
  })

  it('swaps Settings for the editor when asked', async () => {
    await show('darwin')
    await act(async () => entry()!.querySelector<HTMLButtonElement>('button')!.click())
    expect(useWorkspace.getState().settingsDialog.open).toBe(false)
    expect(useWorkspace.getState().opencodeConfigDialog.open).toBe(true)
  })
})
