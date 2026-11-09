// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FancyBackground } from '../src/renderer/components/FancyBackground'
import { InboxPanel } from '../src/renderer/components/InboxPanel'
import { SettingsDialog } from '../src/renderer/components/SettingsDialog'
import { ThreadEffect } from '../src/renderer/components/ThreadEffect'
import { DEFAULT_FANCY_SETTINGS, FANCY_SETTINGS_STORAGE_KEY } from '../src/renderer/fancy/settings'
import { useFancyMode } from '../src/renderer/store/fancy-mode'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { InboxThread } from '../src/shared/types'

// xterm.js needs a real browser; the settings dialog only needs the functions that apply settings to terminals.
vi.mock('../src/renderer/terminal/sessions', () => ({
  applyTerminalSettings: vi.fn(),
  fitSession: () => null,
  getSession: () => undefined,
}))

const css = readFileSync(join(__dirname, '..', 'src', 'renderer', 'index.css'), 'utf8')
const roots: Root[] = []

async function render(element: Parameters<Root['render']>[0]): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(element))
  return container
}

const click = (element: Element): Promise<void> => act(async () => (element as HTMLElement).click())
const byId = (id: string): HTMLElement | null => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const setFancy = (patch: Partial<typeof DEFAULT_FANCY_SETTINGS>): Promise<void> =>
  act(async () => useFancyMode.getState().update(patch))

function thread(overrides: Partial<InboxThread>): InboxThread {
  return {
    id: 'ses_one',
    title: 'Fix login',
    directory: '/home/me/app',
    target: { kind: 'wsl', distro: 'Ubuntu' },
    branch: null,
    model: { id: 'model-1', providerId: 'provider-1' },
    status: 'completed',
    createdAt: 1,
    lastActivityAt: Date.now() - 60_000,
    readAt: Date.now(),
    archived: false,
    folderId: 'fld_app',
    ...overrides
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', {
    inbox: { setRead: vi.fn(async () => null), setArchived: vi.fn(async () => null), setPinned: vi.fn(async () => null), remove: vi.fn(async () => undefined), folders: vi.fn(async () => ({ folders: [], composer: {} })) },
    chat: { draft: vi.fn(async () => ({ text: '', revision: 0, attachments: [] })), subscribe: vi.fn(async () => undefined), unsubscribe: vi.fn(async () => undefined) },
    pty: { resize: vi.fn(async () => undefined) }
  })
  useInboxChat.setState({ threads: {}, recent: [], draftReloads: {} })
  useWorkspace.setState({
    platform: { platform: 'darwin', isWindows: false },
    wslAvailable: false,
    inboxThreads: [],
    selectedInboxThreadId: null,
    inboxMarkedUnread: {},
    inboxCues: {},
    activeWorkspaceView: 'inbox',
    settingsDialog: { open: false, section: 'appearance' }
  })
  useFancyMode.setState({ settings: DEFAULT_FANCY_SETTINGS })
})

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()))
  document.body.innerHTML = ''
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('the fancy background', () => {
  it('draws nothing while fancy mode is off', async () => {
    await render(createElement(FancyBackground))
    expect(byId('fancy-background')).toBeNull()
  })

  it('is a canvas that lets every click through and is hidden from assistive technology, once it is on', async () => {
    await render(createElement(FancyBackground))
    await setFancy({ enabled: true })
    const canvas = byId('fancy-background')!
    expect(canvas.tagName).toBe('CANVAS')
    expect(canvas.getAttribute('aria-hidden')).toBe('true')
    expect(canvas.dataset.background).toBe('aurora')
    expect(canvas.className).toContain('pointer-events-none')
    // Behind the panels: a negative z-index inside the app's isolated root.
    expect(canvas.className).toContain('-z-10')

    await setFancy({ background: 'contours' })
    expect(byId('fancy-background')!.dataset.background).toBe('contours')
    await setFancy({ backgroundEnabled: false })
    expect(byId('fancy-background')).toBeNull()
    await setFancy({ backgroundEnabled: true })
    expect(byId('fancy-background')!.dataset.background).toBe('contours')
    await setFancy({ enabled: false })
    expect(byId('fancy-background')).toBeNull()
  })
})

describe('the effect behind a thread row', () => {
  it('follows the settings: fancy mode and thread effects must both be on', async () => {
    await render(createElement(ThreadEffect, { kind: 'unread', seed: 'a' }))
    expect(byId('fancy-thread-effect')).toBeNull()
    await setFancy({ enabled: true })
    expect(byId('fancy-thread-effect')!.dataset.effect).toBe('unread')
    await setFancy({ backgroundEnabled: false })
    expect(byId('fancy-thread-effect')).not.toBeNull()
    await setFancy({ threadEffects: false })
    expect(byId('fancy-thread-effect')).toBeNull()
  })

  it('shows whatever the settings say when forced, for the preview in Settings', async () => {
    await render(createElement(ThreadEffect, { kind: 'working', seed: 'a', force: true }))
    const canvas = byId('fancy-thread-effect')!
    expect(canvas.dataset.effect).toBe('working')
    expect(canvas.getAttribute('aria-hidden')).toBe('true')
    expect(canvas.className).toContain('pointer-events-none')
  })
})

describe('thread rows in the Inbox', () => {
  const rows = (): Record<string, string | null> =>
    Object.fromEntries(
      ['ses_unread', 'ses_working', 'ses_read', 'ses_both'].map((id) => [
        id,
        byId(`inbox-thread-${id}`)?.closest('.group')?.querySelector<HTMLElement>('[data-testid="fancy-thread-effect"]')?.dataset.effect ?? null
      ])
    )

  async function showThreads(): Promise<void> {
    const now = Date.now()
    useWorkspace.setState({
      wslAvailable: true,
      inboxThreads: [
        thread({ id: 'ses_unread', title: 'Unread one', status: 'attention', readAt: 0, lastActivityAt: now - 1000 }),
        thread({ id: 'ses_working', title: 'Working one', status: 'working', workingSince: now - 5000, lastActivityAt: now - 2000, readAt: now }),
        thread({ id: 'ses_read', title: 'Read one', status: 'completed', readAt: now, lastActivityAt: now - 90_000 }),
        thread({ id: 'ses_both', title: 'Both', status: 'working', workingSince: now - 5000, readAt: 0, lastActivityAt: now - 500 })
      ] as InboxThread[]
    })
    await render(createElement(InboxPanel))
  }

  it('has no effects while fancy mode is off', async () => {
    await showThreads()
    expect(rows()).toEqual({ ses_unread: null, ses_working: null, ses_read: null, ses_both: null })
  })

  it('lights unread threads with lightning and working ones with rain, unread first, and leaves read ones alone', async () => {
    await setFancy({ enabled: true })
    await showThreads()
    expect(rows()).toEqual({ ses_unread: 'unread', ses_working: 'working', ses_read: null, ses_both: 'unread' })
  })

  it('isolates each lit row, so the effect sits above its color and below its text', async () => {
    await setFancy({ enabled: true })
    await showThreads()
    const row = byId('inbox-thread-ses_unread')!.closest('.group')!
    expect(row.className).toContain('isolate')
    expect(row.querySelector('[data-testid="fancy-thread-effect"]')!.className).toContain('-z-10')
  })

  it('has none of them when only the thread effects are off', async () => {
    await setFancy({ enabled: true, threadEffects: false })
    await showThreads()
    expect(rows()).toEqual({ ses_unread: null, ses_working: null, ses_read: null, ses_both: null })
  })

  it('shows and removes the effects as the setting changes', async () => {
    await showThreads()
    expect(rows().ses_unread).toBeNull()
    await setFancy({ enabled: true })
    expect(rows().ses_unread).toBe('unread')
    await setFancy({ enabled: false })
    expect(rows().ses_unread).toBeNull()
  })
})

describe('the fancy mode settings', () => {
  async function openSettings(): Promise<void> {
    useWorkspace.setState({ settingsDialog: { open: true, section: 'appearance' } })
    await render(createElement(SettingsDialog, { terminalIds: [] }))
  }

  it('is in Appearance, off, with nothing else to choose until it is turned on', async () => {
    await openSettings()
    const toggle = byId('fancy-mode')!
    expect(toggle.getAttribute('role')).toBe('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(byId('fancy-background-aurora')).toBeNull()
    expect(byId('fancy-thread-effects')).toBeNull()
  })

  it('turns on, offers the three backgrounds with the aurora chosen, and keeps what is chosen', async () => {
    await openSettings()
    await click(byId('fancy-mode')!)
    expect(useFancyMode.getState().settings.enabled).toBe(true)
    expect(byId('fancy-mode')!.getAttribute('aria-checked')).toBe('true')
    expect(JSON.parse(localStorage.getItem(FANCY_SETTINGS_STORAGE_KEY)!).enabled).toBe(true)

    const choices = ['aurora', 'constellation', 'contours'].map((id) => byId(`fancy-background-${id}`)!)
    expect(choices.map((choice) => choice.getAttribute('role'))).toEqual(['radio', 'radio', 'radio'])
    expect(choices.map((choice) => choice.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])

    await click(choices[2]!)
    expect(useFancyMode.getState().settings.background).toBe('contours')
    expect(byId('fancy-background-contours')!.getAttribute('aria-checked')).toBe('true')
    expect(byId('fancy-background-aurora')!.getAttribute('aria-checked')).toBe('false')
    expect(JSON.parse(localStorage.getItem(FANCY_SETTINGS_STORAGE_KEY)!).background).toBe('contours')
  })

  it('toggles the background independently and remembers the selected style', async () => {
    await openSettings()
    await click(byId('fancy-mode')!)
    await click(byId('fancy-background-contours')!)
    await click(byId('fancy-background-enabled')!)
    expect(JSON.parse(localStorage.getItem(FANCY_SETTINGS_STORAGE_KEY)!).backgroundEnabled).toBe(false)
    expect(byId('fancy-background-contours')).toBeNull()
    expect(byId('fancy-thread-preview')).not.toBeNull()
    await click(byId('fancy-background-enabled')!)
    expect(byId('fancy-background-contours')!.getAttribute('aria-checked')).toBe('true')
  })

  it('turns the thread effects off and on, with a preview of both while they are on', async () => {
    await openSettings()
    await click(byId('fancy-mode')!)
    const preview = byId('fancy-thread-preview')!
    expect(preview.querySelectorAll('[data-testid="fancy-thread-effect"]')).toHaveLength(2)
    expect(Array.from(preview.querySelectorAll<HTMLElement>('[data-testid="fancy-thread-effect"]')).map((canvas) => canvas.dataset.effect)).toEqual(['unread', 'working'])

    await click(byId('fancy-thread-effects')!)
    expect(useFancyMode.getState().settings.threadEffects).toBe(false)
    expect(byId('fancy-thread-preview')).toBeNull()
    await click(byId('fancy-thread-effects')!)
    expect(byId('fancy-thread-preview')).not.toBeNull()
  })

  it('hides its choices again when it is turned off, and keeps them for the next time', async () => {
    await openSettings()
    await click(byId('fancy-mode')!)
    await click(byId('fancy-background-constellation')!)
    await click(byId('fancy-mode')!)
    expect(byId('fancy-background-aurora')).toBeNull()
    await click(byId('fancy-mode')!)
    expect(byId('fancy-background-constellation')!.getAttribute('aria-checked')).toBe('true')
  })
})

describe('the stylesheet', () => {
  it('turns panels into glass only while the background is on, and never leaves them see-through otherwise', () => {
    // Every rule that thins a panel's color sits under the attribute the app sets only while fancy mode is on.
    const rules = Array.from(css.matchAll(/([^{}]*\.fancy-glass[^{}]*)\{([^}]*)\}/g))
    expect(rules.length).toBeGreaterThan(0)
    for (const [, selector, body] of rules) {
      expect(selector).toContain('[data-fancy-bg]')
      expect(body).toContain('backdrop-filter')
    }
  })

  it('is what the app sets on its root, which is isolated so the background sits behind the panels', () => {
    const app = readFileSync(join(__dirname, '..', 'src', 'renderer', 'App.tsx'), 'utf8')
    expect(app).toMatch(/className="relative isolate [^"]*bg-bg"[^>]*data-fancy-bg=\{fancyBackground \|\| undefined\}/)
    expect(app).toContain('<FancyBackground />')
  })
})
