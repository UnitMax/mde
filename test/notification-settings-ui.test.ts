// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../src/renderer/components/SettingsDialog'
import { startAlerts } from '../src/renderer/lib/alert-controller'
import {
  ALERT_SETTINGS_STORAGE_KEY,
  DEFAULT_ALERT_SETTINGS,
  resetAlertSettingsCache,
  saveAlertSettings
} from '../src/renderer/lib/alert-settings'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { InboxThread } from '../src/shared/types'

vi.mock('../src/renderer/terminal/sessions', () => ({ disposeSession: vi.fn() }))
const played = vi.hoisted(() => vi.fn())
vi.mock('../src/renderer/lib/alert-sound', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/lib/alert-sound')>()),
  playAlertChoice: played
}))

let root: Root
let container: HTMLDivElement
const query = (selector: string): HTMLElement => document.body.querySelector<HTMLElement>(selector)!
const click = (element: HTMLElement): Promise<void> => act(async () => element.click())
const press = (element: HTMLElement, key: string): Promise<void> => act(async () => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
})
const stored = () => JSON.parse(localStorage.getItem(ALERT_SETTINGS_STORAGE_KEY) ?? 'null')
const choose = async (testId: string, name: string) => {
  await press(query(`[data-testid="${testId}"]`), 'Enter')
  const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find((item) => item.textContent === name)!
  await press(option, 'Enter')
}

beforeEach(async () => {
  localStorage.clear()
  resetAlertSettingsCache()
  played.mockClear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
  vi.stubGlobal('api', { attention: { update: vi.fn(async () => undefined), beep: vi.fn(async () => undefined) } })
  useWorkspace.setState({ platform: { platform: 'win32', isWindows: true }, settingsDialog: { open: false, section: 'appearance' } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(SettingsDialog, { terminalIds: [] })))
  await act(async () => useWorkspace.getState().openSettings('notifications'))
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Settings → Notifications', () => {
  it('opens as its own section with the defaults', () => {
    expect(query('[role="tab"][aria-selected="true"]').textContent).toBe('Notifications')
    expect(query('[data-testid="alert-sound"]').getAttribute('aria-checked')).toBe('true')
    expect(query('[data-testid="alert-sound-done"]').textContent).toContain('Chime')
    expect(query('[data-testid="alert-sound-input"]').textContent).toContain('Bell')
    expect(query('[data-testid="alert-sound-failed"]').textContent).toContain('Pluck')
    expect(query('[data-testid="alert-flash"]').textContent).toContain('A few times')
    expect(query('[data-testid="alert-badge"]').getAttribute('aria-checked')).toBe('true')
  })

  it('saves a switch and keeps it when the dialog is opened again', async () => {
    await click(query('[data-testid="alert-sound"]'))
    expect(stored().sound).toBe(false)
    expect(query('[data-testid="alert-sound-done"]').hasAttribute('data-disabled') || (query('[data-testid="alert-sound-done"]') as HTMLButtonElement).disabled).toBe(true)
    await click(query('[data-testid="alert-only-away"]'))
    expect(query('[data-testid="alert-only-away"]').getAttribute('aria-checked')).toBe('false')
    await act(async () => useWorkspace.getState().closeSettings())
    await act(async () => useWorkspace.getState().openSettings('notifications'))
    expect(query('[data-testid="alert-sound"]').getAttribute('aria-checked')).toBe('false')
  })

  it('saves a volume', async () => {
    const volume = query('[data-testid="alert-volume"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(volume, '25')
      volume.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(stored().volume).toBe(0.25)
  })

  it('plays a sound as it is chosen, and again from its play button', async () => {
    await choose('alert-sound-done', 'Bell')
    expect(stored().sounds).toEqual({ ...DEFAULT_ALERT_SETTINGS.sounds, done: 'bell' })
    expect(played).toHaveBeenCalledExactlyOnceWith('done', 'bell', 0.6)
    await click(query('[data-testid="alert-play-done"]'))
    expect(played).toHaveBeenLastCalledWith('done', 'bell', 0.6)
    await choose('alert-sound-input', 'Off')
    expect(played).toHaveBeenCalledTimes(2)
    expect((query('[data-testid="alert-play-input"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('chooses how the taskbar flashes', async () => {
    await choose('alert-flash', 'Until I come back to MDE')
    expect(stored().flash).toBe('until-focus')
  })

  it('offers the colour and badge only on Windows', async () => {
    await act(async () => useWorkspace.setState({ platform: { platform: 'linux', isWindows: false } as never }))
    expect(document.body.querySelector('[data-testid="alert-badge"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="alert-flash"]')).not.toBeNull()
  })
})

describe('startAlerts', () => {
  const thread = (patch: Partial<InboxThread> = {}): InboxThread => ({
    id: 'ses_1',
    target: { kind: 'native' },
    directory: '/home/me/project',
    title: 'Thread',
    status: 'working',
    lastActivityAt: 100,
    readAt: 100,
    ...patch
  }) as InboxThread
  const update = () => (window as unknown as { api: { attention: { update: ReturnType<typeof vi.fn> } } }).api.attention.update
  let stop: () => void
  let focused: boolean

  beforeEach(() => {
    focused = false
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
    useWorkspace.setState({ inboxThreads: [thread()], windowMode: 'normal', activeWorkspaceView: 'inbox', selectedInboxThreadId: null })
    saveAlertSettings({ ...DEFAULT_ALERT_SETTINGS, flash: 'brief' })
    stop = startAlerts()
  })
  afterEach(() => stop())

  it('plays a sound and flashes when a thread in the list finishes while the window is in the background', () => {
    useWorkspace.setState({ inboxThreads: [thread({ status: 'completed', lastActivityAt: 200 })] })
    expect(played).toHaveBeenCalledExactlyOnceWith('done', 'chime', 0.6)
    expect(update()).toHaveBeenCalledWith({ indicator: { tone: 'done', count: 1 }, flash: 'brief' })
  })

  it('says nothing for the threads the list starts with, or a thread new to it', () => {
    stop()
    useWorkspace.setState({ inboxThreads: [] })
    stop = startAlerts()
    useWorkspace.setState({ inboxThreads: [thread({ status: 'completed', lastActivityAt: 200 })] })
    expect(played).not.toHaveBeenCalled()
  })

  it('says nothing about the thread being read in the window in use', () => {
    focused = true
    useWorkspace.setState({ selectedInboxThreadId: 'ses_1' })
    useWorkspace.setState({ inboxThreads: [thread({ status: 'error', lastActivityAt: 200 })] })
    expect(played).not.toHaveBeenCalled()
  })

  it('clears the taskbar when the window gets focus and sets it again when it is left', () => {
    useWorkspace.setState({ inboxThreads: [thread({ status: 'attention', lastActivityAt: 200 })] })
    update().mockClear()
    focused = true
    window.dispatchEvent(new Event('focus'))
    expect(update()).toHaveBeenCalledExactlyOnceWith({ indicator: null, flash: 'none' })
    update().mockClear()
    focused = false
    window.dispatchEvent(new Event('blur'))
    expect(update()).toHaveBeenCalledExactlyOnceWith({ indicator: { tone: 'input', count: 1 } })
  })

  it('stops listening when stopped', () => {
    stop()
    useWorkspace.setState({ inboxThreads: [thread({ status: 'completed', lastActivityAt: 200 })] })
    expect(played).not.toHaveBeenCalled()
  })
})
