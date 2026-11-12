// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../src/renderer/components/SettingsDialog'
import { getTerminalSettings, saveTerminalSettings } from '../src/renderer/terminal/terminal-settings'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { MdeMcpStatus, MdeMcpTerminalSettings, MdeMcpTerminalSettingsUpdate } from '../src/shared/mde-mcp'

const missing: MdeMcpStatus = { state: 'missing', file: '~/.config/opencode/opencode.jsonc', parseError: null }
const mdeMcp = {
  status: vi.fn(async (_req: unknown): Promise<MdeMcpStatus> => missing),
  install: vi.fn(async (_req: unknown): Promise<MdeMcpStatus> => ({ ...missing, state: 'installed' })),
  remove: vi.fn(async (_req: unknown) => missing),
  terminalSettings: vi.fn(async (): Promise<MdeMcpTerminalSettings> => ({ commands: 'ask', allowedUntil: null })),
  setTerminalSettings: vi.fn(async (req: MdeMcpTerminalSettingsUpdate): Promise<MdeMcpTerminalSettings> => ({ commands: req.commands, allowedUntil: null })),
}

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
    vi.stubGlobal('api', { pty: { resize: vi.fn() }, wsl: { distros: vi.fn(async () => []) }, mdeMcp })
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

  describe('MDE MCP', () => {
    const card = (): HTMLElement | null => document.body.querySelector<HTMLElement>('[data-testid="mde-mcp-settings"]')
    const button = (id: string): HTMLButtonElement | null => document.body.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
    beforeEach(() => {
      mdeMcp.status.mockClear()
      mdeMcp.install.mockClear()
      mdeMcp.remove.mockClear()
    })

    it('installs it in this computer’s OpenCode and then offers to remove it', async () => {
      await show('darwin')
      expect(mdeMcp.status).toHaveBeenCalledWith({ kind: 'native' })
      expect(card()?.textContent).toContain('Not installed.')
      expect(button('mde-mcp-remove')).toBeNull()
      await act(async () => button('mde-mcp-install')!.click())
      expect(mdeMcp.install).toHaveBeenCalledWith({ kind: 'native' })
      expect(card()?.textContent).toContain('Installed.')
      expect(button('mde-mcp-install')).toBeNull()
      await act(async () => button('mde-mcp-remove')!.click())
      expect(mdeMcp.remove).toHaveBeenCalledWith({ kind: 'native' })
      expect(card()?.textContent).toContain('Not installed.')
    })

    it('offers to update an entry that starts another copy of MDE', async () => {
      mdeMcp.status.mockResolvedValueOnce({ ...missing, state: 'outdated' })
      await show('darwin')
      expect(button('mde-mcp-install')?.textContent).toBe('Update')
      expect(button('mde-mcp-remove')).not.toBeNull()
    })

    it('leaves a file it cannot read alone and says why', async () => {
      mdeMcp.status.mockResolvedValueOnce({ ...missing, parseError: 'ValueExpected at offset 9' })
      await show('darwin')
      expect(card()?.textContent).toContain('cannot be read (ValueExpected at offset 9)')
      expect(button('mde-mcp-install')).toBeNull()
    })

    it('says until when commands in agents\' terminals run without asking, and asks again on request', async () => {
      mdeMcp.terminalSettings.mockResolvedValueOnce({ commands: 'ask', allowedUntil: Date.now() + 30 * 60_000 })
      await show('darwin')
      const setting = document.body.querySelector<HTMLElement>('[data-testid="mde-mcp-terminal-commands"]')!
      expect(setting.textContent).toContain('Commands in terminals agents open')
      expect(setting.textContent).toContain('Ask me first')
      expect(setting.textContent).toContain('run without asking until')
      const again = Array.from(setting.querySelectorAll('button')).find((item) => item.textContent === 'Ask again now')!
      await act(async () => again.click())
      expect(mdeMcp.setTerminalSettings).toHaveBeenCalledWith({ commands: 'ask', allowedUntil: null })
      expect(setting.textContent).not.toContain('run without asking until')
    })

    it('shows what went wrong', async () => {
      mdeMcp.install.mockRejectedValueOnce(new Error("Error invoking remote method 'mde-mcp:install': Error: Disk full"))
      await show('darwin')
      await act(async () => button('mde-mcp-install')!.click())
      expect(document.body.querySelector('[data-testid="mde-mcp-error"]')?.textContent).toContain('Disk full')
    })

    it('works in the default WSL distro on Windows', async () => {
      useWorkspace.setState({
        distros: [{ name: 'Debian', isDefault: false }, { name: 'Ubuntu-24.04', isDefault: true }],
        refreshDistros: vi.fn(async () => {}),
      } as never)
      await show('win32')
      expect(mdeMcp.status).toHaveBeenCalledWith({ kind: 'wsl', distro: 'Ubuntu-24.04' })
      expect(button('mde-mcp-distro')).not.toBeNull()
    })
  })
})
