// @vitest-environment happy-dom
import { act, createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxSettingsMenu } from '../src/renderer/components/inbox/InboxSettingsMenu'
import { SettingsDialog } from '../src/renderer/components/SettingsDialog'
import { INBOX_TERMINAL_DISTRO_STORAGE_KEY } from '../src/renderer/lib/inbox-settings'
import { useInboxTerminal } from '../src/renderer/store/inbox-terminal'
import { useWorkspace } from '../src/renderer/store/workspace'
import { inboxTerminalSession, type InboxTerminalSettings } from '../src/shared/inbox-terminal'
import type { Distro } from '../src/shared/types'

vi.mock('../src/renderer/terminal/sessions', () => ({ disposeSession: vi.fn() }))

const distros: Distro[] = [
  { name: 'Ubuntu', state: 'Running', version: 2, isDefault: true },
  { name: 'Debian', state: 'Stopped', version: 2, isDefault: false },
]
const configureInbox = vi.fn(async ({ distro }: InboxTerminalSettings) => ({ session: inboxTerminalSession('win32', distros, distro), changed: distro !== useInboxTerminal.getState().session?.distro }))
let root: Root
let container: HTMLDivElement
const query = (selector: string): HTMLElement => document.body.querySelector<HTMLElement>(selector)!
const click = (element: HTMLElement): Promise<void> => act(async () => element.click())
const press = (element: HTMLElement, key: string): Promise<void> => act(async () => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
})
const openMenu = () => press(query('[data-testid="inbox-settings"]'), 'Enter')
const openDialog = () => act(async () => useWorkspace.getState().openSettings('terminal'))
const closeDialog = () => click(Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Close')!)
const choose = async (name: string) => {
  await press(query('[data-testid="inbox-terminal-distro"]'), 'Enter')
  const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find((item) => item.textContent === name)!
  await press(option, 'Enter')
}
const apply = () => click(Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Apply')!)

beforeEach(async () => {
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
  configureInbox.mockClear()
  vi.stubGlobal('api', { wsl: { distros: vi.fn(async () => distros) }, pty: { configureInbox } })
  useWorkspace.setState({ platform: { platform: 'win32', isWindows: true }, distros, settingsDialog: { open: false, section: 'appearance' } })
  useInboxTerminal.setState({ distro: null, session: inboxTerminalSession('win32', distros), configuring: false, error: null })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(Fragment, null,
    createElement(InboxSettingsMenu),
    createElement(SettingsDialog, { terminalIds: [] }),
  )))
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Settings → Terminal → Inbox sidebar terminal', () => {
  it('offers installed distros, applies the selection and restores the saved choice when reopened', async () => {
    await openDialog()
    expect(query('[role="tab"][aria-selected="true"]').textContent).toBe('Terminal')
    expect(query('[role="tabpanel"] [data-testid="inbox-terminal-settings"]').textContent).toContain('restarts all sidebar')
    expect(query('[data-testid="inbox-terminal-distro"]').textContent).toContain('Default WSL distribution')
    await choose('Debian')
    expect(configureInbox).not.toHaveBeenCalled()
    await apply()
    expect(configureInbox).toHaveBeenCalledWith({ distro: 'Debian' })
    expect(localStorage.getItem(INBOX_TERMINAL_DISTRO_STORAGE_KEY)).toBe('Debian')
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    await closeDialog()
    await openDialog()
    expect(query('[data-testid="inbox-terminal-distro"]').textContent).toContain('Debian')
    await choose('Default WSL distribution')
    await apply()
    expect(configureInbox).toHaveBeenLastCalledWith({ distro: null })
    expect(localStorage.getItem(INBOX_TERMINAL_DISTRO_STORAGE_KEY)).toBeNull()
  })

  it('keeps the running distro when Settings is closed without applying the selection', async () => {
    await openDialog()
    await choose('Debian')
    await closeDialog()
    expect(configureInbox).not.toHaveBeenCalled()
    expect(useInboxTerminal.getState().session).toMatchObject({ distro: 'Ubuntu' })
    await openDialog()
    expect(query('[data-testid="inbox-terminal-distro"]').textContent).toContain('Default WSL distribution')
  })

  it('keeps the dialog open and the old preference when main-process validation fails', async () => {
    configureInbox.mockRejectedValueOnce(new Error('The WSL distribution Debian was not found.'))
    await openDialog()
    await choose('Debian')
    await apply()
    expect(query('[role="alert"]').textContent).toContain('Debian was not found')
    expect(useInboxTerminal.getState().distro).toBeNull()
  })

  it('does not offer WSL settings on macOS', async () => {
    await act(async () => useWorkspace.setState({ platform: { platform: 'darwin', isWindows: false } }))
    await openDialog()
    expect(document.body.querySelector('[data-testid="inbox-terminal-settings"]')).toBeNull()
  })

  it('keeps the Inbox gear menu limited to display settings of the Inbox on Windows', async () => {
    await openMenu()
    const menu = query('[role="menu"]')
    expect(menu.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(4)
    expect(menu.textContent).not.toContain('terminal')
    expect(menu.querySelector('[role="menuitem"]')).toBeNull()
  })
})
