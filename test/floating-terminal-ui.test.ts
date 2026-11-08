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

import {
  FloatTerminalButton,
  FloatingTerminal,
  FloatingTerminalNotice
} from '../src/renderer/components/inbox/FloatingTerminal'
import { INBOX_FLOATING_TERMINAL_STORAGE_KEY } from '../src/renderer/lib/inbox-settings'
import { useInboxChanges } from '../src/renderer/store/inbox-changes'
import { useInboxFloatingTerminal } from '../src/renderer/store/inbox-floating-terminal'
import { useWorkspace } from '../src/renderer/store/workspace'

const VIEW = { width: 1000, height: 700 }
let root: Root
let container: HTMLDivElement
let toggleListener: (() => void) | null
const api = () => (window as unknown as { api: { floatingTerminal: { setActive: ReturnType<typeof vi.fn>; onToggle: ReturnType<typeof vi.fn> } } }).api.floatingTerminal
const query = <T extends HTMLElement = HTMLElement>(testId: string): T | null => container.querySelector<T>(`[data-testid="${testId}"]`)
const click = (testId: string): Promise<void> => act(async () => query(testId)!.click())
const stored = () => JSON.parse(localStorage.getItem(INBOX_FLOATING_TERMINAL_STORAGE_KEY) ?? 'null')
const pointer = (testId: string, type: string, x: number, y: number): Promise<void> =>
  act(async () => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    Object.assign(event, { pointerId: 1 })
    query(testId)!.dispatchEvent(event)
  })
const drag = async (testId: string, from: [number, number], to: [number, number]): Promise<void> => {
  await pointer(testId, 'pointerdown', ...from)
  await pointer(testId, 'pointermove', ...to)
  await pointer(testId, 'pointerup', ...to)
}
const windowBox = () => {
  const style = query('floating-terminal')!.style
  return { x: parseInt(style.left), y: parseInt(style.top), width: parseInt(style.width), height: parseInt(style.height) }
}

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
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ ...VIEW, x: 0, y: 0, top: 0, left: 0, right: VIEW.width, bottom: VIEW.height, toJSON: () => ({}) })
  useInboxFloatingTerminal.setState({ floating: false, visible: false, rect: null, maximized: false })
  useInboxChanges.setState({ tab: 'files' })
  useWorkspace.setState({ fileTreeCollapsed: false })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(Fragment, null, createElement(FloatingTerminal), createElement(FloatTerminalButton), createElement(FloatingTerminalNotice))))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('breaking the terminal out', () => {
  it('draws nothing while the terminal is in the sidebar, and does not claim F11', () => {
    expect(query('floating-terminal')).toBeNull()
    expect(api().setActive).not.toHaveBeenCalled()
  })

  it('floats the terminal over the conversation from the sidebar button, and keeps that', async () => {
    await click('floating-terminal-break-out')
    expect(query('floating-terminal')).not.toBeNull()
    expect(query('floating-terminal')!.getAttribute('aria-label')).toBe('Floating terminal')
    expect(query('floating-terminal')!.querySelector('[data-testid="inbox-terminal-stub"]')).not.toBeNull()
    expect(stored()).toEqual({ floating: true, rect: null, maximized: false })
  })

  it('opens at the default place and takes the keyboard', async () => {
    await click('floating-terminal-break-out')
    expect(windowBox()).toEqual({ x: 384, y: 334, width: 600, height: 350 })
    expect(terminal.mounted).toHaveBeenCalledWith({ focusOnMount: true })
  })

  it('offers the files again when the sidebar was showing the terminal', async () => {
    useInboxChanges.setState({ tab: 'terminal' })
    await click('floating-terminal-break-out')
    expect(useInboxChanges.getState().tab).toBe('files')
    // Another tab is left as it is.
    useInboxChanges.setState({ tab: 'changes' })
    await act(async () => useInboxFloatingTerminal.getState().breakOut())
    expect(useInboxChanges.getState().tab).toBe('changes')
  })
})

describe('F11', () => {
  it('claims the key from the main process while the terminal floats, and gives it back when it does not', async () => {
    await click('floating-terminal-break-out')
    expect(api().setActive).toHaveBeenLastCalledWith(true)
    await click('floating-terminal-dock')
    expect(api().setActive).toHaveBeenLastCalledWith(false)
    expect(toggleListener).toBeNull()
  })

  it('shows and hides the window, keeping the terminal and its place', async () => {
    await click('floating-terminal-break-out')
    await act(async () => toggleListener!())
    expect(query('floating-terminal')).toBeNull()
    expect(useInboxFloatingTerminal.getState().floating).toBe(true)
    await act(async () => toggleListener!())
    expect(query('floating-terminal')).not.toBeNull()
  })

  it('does nothing while the terminal is in the sidebar', async () => {
    await act(async () => useInboxFloatingTerminal.getState().toggle())
    expect(useInboxFloatingTerminal.getState().visible).toBe(false)
    await act(async () => useInboxFloatingTerminal.getState().show())
    expect(query('floating-terminal')).toBeNull()
  })

  it('starts hidden after a restart even when the terminal was floating, so it does not cover the conversation', async () => {
    localStorage.setItem(INBOX_FLOATING_TERMINAL_STORAGE_KEY, JSON.stringify({ floating: true, rect: null, maximized: false }))
    vi.resetModules()
    const { useInboxFloatingTerminal: fresh } = await import('../src/renderer/store/inbox-floating-terminal')
    expect(fresh.getState()).toMatchObject({ floating: true, visible: false })
  })

  it('hides from the window\'s own button', async () => {
    await click('floating-terminal-break-out')
    await click('floating-terminal-hide')
    expect(query('floating-terminal')).toBeNull()
    expect(useInboxFloatingTerminal.getState().floating).toBe(true)
  })
})

describe('moving and resizing', () => {
  beforeEach(async () => { await click('floating-terminal-break-out') })

  it('moves by dragging the title bar, stops at the edges of the view, and keeps the place', async () => {
    await drag('floating-terminal-titlebar', [500, 20], [400, -80])
    expect(windowBox()).toEqual({ x: 284, y: 234, width: 600, height: 350 })
    expect(stored().rect).toEqual(windowBox())
    await drag('floating-terminal-titlebar', [400, 20], [-9000, -9000])
    expect(windowBox()).toMatchObject({ x: 0, y: 0 })
  })

  it('does not start a move from a button in the title bar', async () => {
    const before = windowBox()
    await act(async () => {
      const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 5, clientY: 5, button: 0 })
      Object.assign(event, { pointerId: 1 })
      query('floating-terminal-hide')!.dispatchEvent(event)
    })
    await pointer('floating-terminal-titlebar', 'pointermove', 100, 100)
    expect(windowBox()).toEqual(before)
  })

  it('grows to the left and to the right, from the edges', async () => {
    await drag('floating-terminal-resize-w', [390, 400], [290, 400])
    expect(windowBox()).toEqual({ x: 284, y: 334, width: 700, height: 350 })
    await drag('floating-terminal-resize-e', [984, 400], [900, 400])
    expect(windowBox()).toEqual({ x: 284, y: 334, width: 616, height: 350 })
  })

  it('resizes from a corner and keeps the window above its minimum size', async () => {
    await drag('floating-terminal-resize-nw', [390, 340], [-9000, -9000])
    expect(windowBox()).toEqual({ x: 0, y: 0, width: 984, height: 684 })
    await drag('floating-terminal-resize-se', [984, 684], [0, 0])
    expect(windowBox()).toEqual({ x: 0, y: 0, width: 320, height: 180 })
  })

  it('has a handle on each edge and corner', () => {
    for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) expect(query(`floating-terminal-resize-${edge}`)).not.toBeNull()
  })

  it('comes back where it was left, and inside a window that has become smaller', async () => {
    useInboxFloatingTerminal.setState({ rect: { x: 800, y: 600, width: 600, height: 350 } })
    await act(async () => {})
    expect(windowBox()).toEqual({ x: 400, y: 350, width: 600, height: 350 })
  })
})

describe('maximizing', () => {
  beforeEach(async () => { await click('floating-terminal-break-out') })

  it('fills the conversation area, drops the resize handles, and restores the old size', async () => {
    await drag('floating-terminal-titlebar', [500, 20], [450, 20])
    const before = windowBox()
    await click('floating-terminal-maximize')
    expect(windowBox()).toEqual({ x: 0, y: 0, ...VIEW })
    expect(query('floating-terminal')!.getAttribute('data-maximized')).toBe('true')
    expect(query('floating-terminal-resize-e')).toBeNull()
    expect(query('floating-terminal-maximize')!.getAttribute('aria-label')).toBe('Restore terminal size')
    expect(stored().maximized).toBe(true)
    await click('floating-terminal-maximize')
    expect(windowBox()).toEqual(before)
    expect(stored().maximized).toBe(false)
  })

  it('maximizes and restores with a double-click on the title bar, but not on a button', async () => {
    await act(async () => query('floating-terminal-titlebar')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(windowBox()).toEqual({ x: 0, y: 0, ...VIEW })
    await act(async () => query('floating-terminal-maximize')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(windowBox()).toEqual({ x: 0, y: 0, ...VIEW })
    await act(async () => query('floating-terminal-titlebar')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(windowBox().width).toBe(600)
  })

  it('cannot be dragged while maximized', async () => {
    await click('floating-terminal-maximize')
    await drag('floating-terminal-titlebar', [500, 20], [100, 100])
    expect(windowBox()).toEqual({ x: 0, y: 0, ...VIEW })
  })
})

describe('docking back', () => {
  it('puts the terminal back in the sidebar, opens its tab, and gives it the keyboard', async () => {
    useWorkspace.setState({ fileTreeCollapsed: true })
    await click('floating-terminal-break-out')
    await click('floating-terminal-dock')
    expect(query('floating-terminal')).toBeNull()
    expect(useInboxFloatingTerminal.getState()).toMatchObject({ floating: false, visible: false })
    expect(useInboxChanges.getState().tab).toBe('terminal')
    expect(useWorkspace.getState().fileTreeCollapsed).toBe(false)
    expect(terminal.focusWhenShown).toHaveBeenCalledTimes(1)
    expect(stored().floating).toBe(false)
  })
})

describe('the sidebar while the terminal floats', () => {
  it('says where the terminal is, and shows or hides it, or docks it', async () => {
    await click('floating-terminal-break-out')
    expect(query('floating-terminal-notice')!.textContent).toContain('F11')
    expect(query('floating-terminal-notice-toggle')!.textContent).toBe('Hide terminal')
    await click('floating-terminal-notice-toggle')
    expect(query('floating-terminal')).toBeNull()
    expect(query('floating-terminal-notice-toggle')!.textContent).toBe('Show terminal')
    await click('floating-terminal-notice-toggle')
    expect(query('floating-terminal')).not.toBeNull()
    await click('floating-terminal-notice-dock')
    expect(useInboxFloatingTerminal.getState().floating).toBe(false)
  })
})
