// @vitest-environment happy-dom
import { act, createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const terminal = vi.hoisted(() => ({ mounted: vi.fn(), focusWhenShown: vi.fn() }))
vi.mock('../src/renderer/components/inbox/InboxTerminal', () => ({
  // The real one draws xterm.js, which needs a real browser; its own tests use a stand-in for the terminal view.
  InboxTerminal: (props: { focusOnMount?: boolean }) => {
    terminal.mounted(props)
    return createElement('button', { 'data-testid': 'inbox-terminal-stub' }, 'shell')
  },
  focusInboxTerminalWhenShown: terminal.focusWhenShown,
}))

import { BottomTerminal } from '../src/renderer/components/inbox/BottomTerminal'
import { BottomTerminalButton, FloatingTerminal, FloatingTerminalNotice } from '../src/renderer/components/inbox/FloatingTerminal'
import {
  INBOX_BOTTOM_TERMINAL_DEFAULT_HEIGHT,
  INBOX_BOTTOM_TERMINAL_MIN_HEIGHT,
  INBOX_CONVERSATION_MIN_HEIGHT,
  INBOX_FLOATING_TERMINAL_STORAGE_KEY,
} from '../src/renderer/lib/inbox-settings'
import { useInboxChanges } from '../src/renderer/store/inbox-changes'
import { useInboxFloatingTerminal } from '../src/renderer/store/inbox-floating-terminal'
import { useWorkspace } from '../src/renderer/store/workspace'

// The column the panel sits in, under the conversation.
const COLUMN = { width: 1000, height: 700 }
const ROOM = COLUMN.height - INBOX_CONVERSATION_MIN_HEIGHT
let root: Root
let container: HTMLDivElement
let toggleListener: (() => void) | null
const api = () => (window as unknown as { api: { floatingTerminal: { setActive: ReturnType<typeof vi.fn> } } }).api.floatingTerminal
const query = <T extends HTMLElement = HTMLElement>(testId: string): T | null => container.querySelector<T>(`[data-testid="${testId}"]`)
const click = (testId: string): Promise<void> => act(async () => query(testId)!.click())
const stored = () => JSON.parse(localStorage.getItem(INBOX_FLOATING_TERMINAL_STORAGE_KEY) ?? 'null')
const panelHeight = (): number => parseInt(query('bottom-terminal')!.style.height)
const pointer = (type: string, y: number): Promise<void> =>
  act(async () => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: y, button: 0 })
    Object.assign(event, { pointerId: 1 })
    query('bottom-terminal-resize')!.dispatchEvent(event)
  })
const key = (name: string): Promise<void> =>
  act(async () => { query('bottom-terminal-resize')!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })) })

beforeEach(async () => {
  localStorage.clear()
  terminal.mounted.mockClear()
  terminal.focusWhenShown.mockClear()
  toggleListener = null
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('api', {
    floatingTerminal: {
      setActive: vi.fn(async () => undefined),
      onToggle: vi.fn((listener: () => void) => {
        toggleListener = listener
        return () => { toggleListener = null }
      }),
    },
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ ...COLUMN, x: 0, y: 0, top: 0, left: 0, right: COLUMN.width, bottom: COLUMN.height, toJSON: () => ({}) })
  useInboxFloatingTerminal.setState({ placement: 'sidebar', floating: false, visible: false, rect: null, maximized: false, bottomHeight: INBOX_BOTTOM_TERMINAL_DEFAULT_HEIGHT })
  useInboxChanges.setState({ tab: 'terminal' })
  useWorkspace.setState({ fileTreeCollapsed: false })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(Fragment, null,
    createElement('div', null, createElement(BottomTerminal)),
    createElement(FloatingTerminal),
    createElement(BottomTerminalButton),
    createElement(FloatingTerminalNotice))))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the terminal at the bottom', () => {
  it('draws nothing while the terminal is in the sidebar', () => {
    expect(query('bottom-terminal')).toBeNull()
  })

  it('moves below the conversation from the sidebar button, takes the keyboard and keeps the place', async () => {
    await click('bottom-terminal-move')
    expect(query('bottom-terminal')!.querySelector('[data-testid="inbox-terminal-stub"]')).not.toBeNull()
    expect(panelHeight()).toBe(INBOX_BOTTOM_TERMINAL_DEFAULT_HEIGHT)
    expect(useInboxFloatingTerminal.getState()).toMatchObject({ placement: 'bottom', floating: false, visible: true })
    expect(stored().placement).toBe('bottom')
    expect(terminal.focusWhenShown).toHaveBeenCalledTimes(1)
    // The sidebar offers its files instead of a notice, and is not covered by a floating window.
    expect(useInboxChanges.getState().tab).toBe('files')
    expect(query('floating-terminal')).toBeNull()
    expect(query('floating-terminal-notice')!.textContent).toContain('panel below the conversation')
  })

  it('is shown when the Inbox opens, without taking the keyboard, unlike the floating window', async () => {
    localStorage.setItem(INBOX_FLOATING_TERMINAL_STORAGE_KEY, JSON.stringify({ placement: 'bottom', bottomHeight: 260 }))
    vi.resetModules()
    const { useInboxFloatingTerminal: fresh } = await import('../src/renderer/store/inbox-floating-terminal')
    expect(fresh.getState()).toMatchObject({ placement: 'bottom', visible: true, bottomHeight: 260 })
    // The Inbox opening with the terminal already at the bottom.
    await act(async () => root.unmount())
    useInboxFloatingTerminal.setState({ placement: 'bottom', visible: true })
    root = createRoot(container)
    await act(async () => root.render(createElement('div', null, createElement(BottomTerminal))))
    expect(query('bottom-terminal')).not.toBeNull()
    expect(terminal.mounted).toHaveBeenLastCalledWith({ focusOnMount: false })
  })

  it('hides and shows with F11, taking the keyboard when it comes back', async () => {
    await click('bottom-terminal-move')
    expect(api().setActive).toHaveBeenLastCalledWith(true)
    await act(async () => toggleListener!())
    expect(query('bottom-terminal')).toBeNull()
    await act(async () => toggleListener!())
    expect(query('bottom-terminal')).not.toBeNull()
    expect(terminal.mounted).toHaveBeenLastCalledWith({ focusOnMount: true })
    await click('bottom-terminal-hide')
    expect(query('bottom-terminal')).toBeNull()
    expect(useInboxFloatingTerminal.getState().placement).toBe('bottom')
  })

  it('starts hidden when it was hidden when MDE was closed, and shown again once shown', async () => {
    await click('bottom-terminal-move')
    await click('bottom-terminal-hide')
    expect(stored()).toMatchObject({ placement: 'bottom', bottomHidden: true })
    vi.resetModules()
    let fresh = (await import('../src/renderer/store/inbox-floating-terminal')).useInboxFloatingTerminal
    expect(fresh.getState()).toMatchObject({ placement: 'bottom', visible: false })
    // F11 brings it back, and that is kept too.
    await act(async () => toggleListener!())
    expect(stored()).toMatchObject({ placement: 'bottom', bottomHidden: false })
    vi.resetModules()
    fresh = (await import('../src/renderer/store/inbox-floating-terminal')).useInboxFloatingTerminal
    expect(fresh.getState()).toMatchObject({ placement: 'bottom', visible: true })
  })

  it('goes back to the sidebar, or floats, from its own header', async () => {
    await click('bottom-terminal-move')
    await click('floating-terminal-break-out')
    expect(query('bottom-terminal')).toBeNull()
    expect(query('floating-terminal')).not.toBeNull()
    await click('floating-terminal-bottom')
    expect(query('floating-terminal')).toBeNull()
    expect(query('bottom-terminal')).not.toBeNull()
    await click('bottom-terminal-dock')
    expect(query('bottom-terminal')).toBeNull()
    expect(useInboxFloatingTerminal.getState()).toMatchObject({ placement: 'sidebar', visible: false })
    expect(useInboxChanges.getState().tab).toBe('terminal')
    expect(api().setActive).toHaveBeenLastCalledWith(false)
  })
})

describe('resizing the bottom panel', () => {
  beforeEach(async () => { await click('bottom-terminal-move') })

  it('grows when its top edge is dragged up, but leaves the conversation its minimum, and keeps the height on release', async () => {
    await pointer('pointerdown', 400)
    await pointer('pointermove', 300)
    expect(panelHeight()).toBe(INBOX_BOTTOM_TERMINAL_DEFAULT_HEIGHT + 100)
    expect(stored().bottomHeight).toBe(INBOX_BOTTOM_TERMINAL_DEFAULT_HEIGHT)
    await pointer('pointermove', -5000)
    await pointer('pointerup', -5000)
    expect(panelHeight()).toBe(ROOM)
    expect(stored().bottomHeight).toBe(ROOM)
  })

  it('never gets shorter than the minimum, and the keys move it too', async () => {
    await pointer('pointerdown', 400)
    await pointer('pointermove', 5000)
    await pointer('pointerup', 5000)
    expect(panelHeight()).toBe(INBOX_BOTTOM_TERMINAL_MIN_HEIGHT)
    await key('ArrowUp')
    expect(panelHeight()).toBe(INBOX_BOTTOM_TERMINAL_MIN_HEIGHT + 16)
    await key('End')
    expect(panelHeight()).toBe(ROOM)
    await key('Home')
    expect(panelHeight()).toBe(INBOX_BOTTOM_TERMINAL_MIN_HEIGHT)
  })

  it('shows a height set in a taller window only as tall as this one allows, and keeps it', async () => {
    await act(async () => useInboxFloatingTerminal.getState().setBottomHeight(2000))
    expect(panelHeight()).toBe(ROOM)
    expect(useInboxFloatingTerminal.getState().bottomHeight).toBe(2000)
  })
})
